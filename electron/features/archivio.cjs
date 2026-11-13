// Leggio — area «archivio», processo principale.
//
// L'archivio d'ufficio lavora SOPRA le cartelle che l'ufficio già usa: Leggio non sposta né
// modifica mai i file originali. Qui stanno solo le operazioni sul disco:
//   - elenco delle cartelle collegate (scelte dall'utente con il dialogo), salvato in userData;
//   - scansione delle cartelle (dimensione e data di ogni file) e lettura dei file con impronta SHA-256;
//   - indice a blocchi NDJSON + manifesto, scritti in modo atomico (vedi lib/blocchi.js);
//   - stati e note d'ufficio (stati.json, con copia di riserva stati.json.bak);
//   - copie dei risultati delle azioni (mai sopra un file esistente).
// L'indice contiene testo dei documenti (dati personali): resta solo in userData/archivio, non va
// mai in rete; «Cancella indice» lo elimina.
//
// Canali 'feat:archivio:*' (argomenti validati, risposta { ok, value } | { ok:false, error }).
const path = require('node:path');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const crypto = require('node:crypto');
const { safeWrite } = require('../core/safe-write.cjs');

const MB = 1024 * 1024;
const MAX_LETTURA = 200 * MB; // oltre: il file viene indicizzato solo per nome e impronta
const MAX_FILE_ELENCO = 100000;
const MAX_TESTO_BLOCCO = 256 * MB;
const ESTENSIONI = new Set(['.pdf', '.p7m', '.xml', '.eml']);
const TEMPO_CARTELLA = 45000; // una cartella di rete che non risponde non deve bloccare tutto
const RE_BLOCCO = /^b-[a-z0-9]+-[a-z0-9]+\.ndjson$/;

class UserError extends Error {}

// ---------------- validazione ----------------
function str(v, name, max = 4096) {
  if (typeof v !== 'string' || !v.length || v.length > max || v.includes('\0')) throw new UserError(`Parametro non valido: ${name}`);
  return v;
}
function absPath(p, name = 'percorso') {
  str(p, name, 32767);
  if (!path.isAbsolute(p)) throw new UserError(`Percorso non valido: ${name}`);
  return path.resolve(p);
}
function bytesArg(v, max = 1024 * MB) {
  let b = v;
  if (b instanceof ArrayBuffer) b = new Uint8Array(b);
  if (!(b instanceof Uint8Array)) throw new UserError('Dati non validi');
  if (b.length > max) throw new UserError('Il file è troppo grande.');
  return b;
}
function safeName(n, fallback = 'documento.pdf') {
  let s = String(n || '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/^[.\s]+/, '').replace(/[.\s]+$/, '').slice(0, 200);
  if (!s) s = fallback;
  if (/^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i.test(s)) s = '_' + s;
  return s;
}
const caseInsensitive = process.platform === 'win32' || process.platform === 'darwin';
const chiave = (p) => (caseInsensitive ? path.resolve(p).toLowerCase() : path.resolve(p));
function dentro(root, p) {
  const rel = path.relative(chiave(root), chiave(p));
  return rel === '' || (!!rel && rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel));
}
function conTempo(promise, ms, msg) {
  let t;
  return Promise.race([promise, new Promise((_, rej) => { t = setTimeout(() => rej(Object.assign(new Error(msg), { code: 'ETIMEDOUT' })), ms); })]).finally(() => clearTimeout(t));
}

// ---------------- stato del modulo ----------------
const S = {
  dir: null, // userData/archivio
  config: { versione: 1, cartelle: [] },
  destinazioni: new Set(), // cartelle scelte con il dialogo per salvare copie (solo per questa sessione)
  scritture: Promise.resolve(), // le scritture dell'indice vanno una alla volta
};
const dirIndice = () => path.join(S.dir, 'indice');
const fileConfig = () => path.join(S.dir, 'config.json');
const fileStati = () => path.join(S.dir, 'stati.json');

async function scriviAtomico(p, testo) {
  await fsp.mkdir(path.dirname(p), { recursive: true });
  await safeWrite(p, Buffer.from(testo, 'utf8'));
  // rende permanente anche il rename (dove il sistema lo consente)
  if (process.platform !== 'win32') {
    try { const fh = await fsp.open(path.dirname(p), 'r'); try { await fh.sync(); } finally { await fh.close(); } } catch { /* non essenziale */ }
  }
}

function leggiConfig() {
  try {
    const c = JSON.parse(fs.readFileSync(fileConfig(), 'utf8'));
    if (c && Array.isArray(c.cartelle)) {
      S.config = { versione: 1, ...c, cartelle: c.cartelle.filter((x) => x && typeof x.percorso === 'string' && path.isAbsolute(x.percorso) && typeof x.id === 'string') };
    }
  } catch { /* prima volta o file rovinato: si riparte senza cartelle (l'indice resta) */ }
}
async function salvaConfig() { await scriviAtomico(fileConfig(), JSON.stringify(S.config, null, 1)); }

const idCartella = (p) => crypto.createHash('sha1').update(chiave(p)).digest('hex').slice(0, 12);
function cartellaDi(p) {
  return S.config.cartelle.find((c) => dentro(c.percorso, p)) || null;
}
function mustBeInArchivio(p) {
  const abs = absPath(p);
  if (!cartellaDi(abs)) throw new UserError('Questo file non sta in una cartella collegata all\'archivio.');
  return abs;
}

// ---------------- cartelle ----------------
async function aggiungiCartella(percorso) {
  const abs = path.resolve(percorso);
  let st;
  try { st = await fsp.stat(abs); } catch { throw new UserError('La cartella non è raggiungibile.'); }
  if (!st.isDirectory()) throw new UserError('Non è una cartella.');
  const gia = S.config.cartelle.find((c) => dentro(c.percorso, abs));
  if (gia) return { cartella: gia, avviso: chiave(gia.percorso) === chiave(abs) ? 'Questa cartella è già collegata all\'archivio.' : `Questa cartella è già compresa in «${gia.nome}».` };
  // se contiene cartelle già collegate, la nuova le sostituisce (stessi documenti)
  const assorbite = S.config.cartelle.filter((c) => dentro(abs, c.percorso));
  S.config.cartelle = S.config.cartelle.filter((c) => !assorbite.includes(c));
  const c = { id: idCartella(abs), percorso: abs, nome: path.basename(abs) || abs, aggiunta: Date.now() };
  S.config.cartelle.push(c);
  await salvaConfig();
  return { cartella: c, assorbite: assorbite.map((x) => x.id), avviso: assorbite.length ? `La nuova cartella comprende ${assorbite.length === 1 ? 'una cartella già collegata' : assorbite.length + ' cartelle già collegate'}: ora c'è una voce sola.` : '' };
}

/** Elenco dei documenti di una cartella collegata. → { raggiungibile, errore, file:[[rel,size,mtime]], illeggibili, troncato } */
async function scansiona({ id }) {
  const c = S.config.cartelle.find((x) => x.id === id);
  if (!c) throw new UserError('Cartella non collegata.');
  const root = c.percorso;
  try {
    const st = await conTempo(fsp.stat(root), TEMPO_CARTELLA, 'La cartella non risponde.');
    if (!st.isDirectory()) throw Object.assign(new Error('non è una cartella'), { code: 'ENOTDIR' });
  } catch (err) {
    return { id, raggiungibile: false, errore: messaggioCartella(err, c), file: [], illeggibili: [], troncato: false };
  }
  const file = []; const illeggibili = []; let troncato = false;
  const t0 = Date.now();
  async function walk(dir, depth) {
    if (file.length >= MAX_FILE_ELENCO) { troncato = true; return; }
    let entries;
    try { entries = await conTempo(fsp.readdir(dir, { withFileTypes: true }), TEMPO_CARTELLA, 'La cartella non risponde.'); }
    catch (err) { illeggibili.push({ rel: path.relative(root, dir) || '.', errore: messaggioCartella(err, c) }); return; }
    const sub = [];
    const stats = [];
    for (const e of entries) {
      const n = e.name;
      if (n.startsWith('.') || n.startsWith('~$') || n.endsWith('.leggio-tmp') || n.endsWith('.leggio-bak')) continue;
      if (e.isSymbolicLink()) continue; // niente cicli
      const p = path.join(dir, n);
      if (e.isDirectory()) { if (depth < 30) sub.push(p); continue; }
      if (!e.isFile() || !ESTENSIONI.has(path.extname(n).toLowerCase())) continue;
      stats.push(p);
    }
    // stat in parallelo (dischi di rete: molto più veloce)
    for (let i = 0; i < stats.length; i += 32) {
      const part = await Promise.all(stats.slice(i, i + 32).map((p) => fsp.stat(p).then((st) => [p, st]).catch(() => null)));
      for (const x of part) {
        if (!x) continue;
        if (file.length >= MAX_FILE_ELENCO) { troncato = true; break; }
        file.push([path.relative(root, x[0]), x[1].size, Math.round(x[1].mtimeMs)]);
      }
    }
    for (const s of sub) await walk(s, depth + 1);
  }
  await walk(root, 0);
  return { id, raggiungibile: true, errore: '', file, illeggibili, troncato, ms: Date.now() - t0 };
}

function messaggioCartella(err, c) {
  const n = `«${c.nome}»`;
  const m = {
    ENOENT: `La cartella ${n} non è raggiungibile (disco di rete scollegato, chiavetta tolta o cartella spostata). L'indice resta: i documenti torneranno disponibili quando la cartella sarà di nuovo raggiungibile.`,
    ETIMEDOUT: `La cartella ${n} non risponde (rete lenta o scollegata). Riprova più tardi.`,
    EACCES: `Non hai i permessi per leggere la cartella ${n}.`, EPERM: `Non hai i permessi per leggere la cartella ${n}.`,
    EHOSTDOWN: `Il computer che condivide ${n} non è raggiungibile.`, ENOTCONN: `Il disco di rete di ${n} è scollegato.`,
  }[err?.code];
  return m || `La cartella ${n} non è leggibile (${err?.code || err?.message}).`;
}

/** Legge un file di una cartella collegata e ne calcola l'impronta. */
async function leggi({ path: p, maxBytes }) {
  const abs = mustBeInArchivio(p);
  const limite = Number.isFinite(maxBytes) ? Math.min(Math.max(1, maxBytes), MAX_LETTURA) : MAX_LETTURA;
  const st = await fsp.stat(abs);
  if (!st.isFile()) throw new UserError('Non è un file.');
  if (st.size > limite) {
    // troppo grande per essere letto per intero: solo impronta (a flusso, memoria costante)
    const h = crypto.createHash('sha256');
    await new Promise((resolve, reject) => fs.createReadStream(abs, { highWaterMark: 4 * MB }).on('data', (d) => h.update(d)).on('end', resolve).on('error', reject));
    return { bytes: null, impronta: h.digest('hex'), size: st.size, mtime: Math.round(st.mtimeMs), troppoGrande: true };
  }
  const b = await fsp.readFile(abs);
  const impronta = crypto.createHash('sha256').update(b).digest('hex');
  return { bytes: new Uint8Array(b.buffer, b.byteOffset, b.byteLength), impronta, size: b.length, mtime: Math.round(st.mtimeMs), troppoGrande: false };
}

// ---------------- indice ----------------
async function indiceManifesto() {
  await fsp.mkdir(dirIndice(), { recursive: true });
  let manifesto = null;
  try { manifesto = JSON.parse(await fsp.readFile(path.join(dirIndice(), 'manifesto.json'), 'utf8')); } catch { manifesto = null; }
  const validi = new Set((manifesto?.blocchi || []).map((b) => b?.file).filter((f) => typeof f === 'string'));
  // blocchi orfani (scrittura interrotta prima del manifesto) e temporanei: si eliminano
  let orfani = 0;
  for (const f of await fsp.readdir(dirIndice()).catch(() => [])) {
    if (f === 'manifesto.json') continue;
    if ((RE_BLOCCO.test(f) && !validi.has(f)) || f.endsWith('.leggio-tmp')) { await fsp.unlink(path.join(dirIndice(), f)).catch(() => {}); orfani++; }
  }
  return { manifesto, orfani };
}
async function indiceBlocco({ file }) {
  if (typeof file !== 'string' || !RE_BLOCCO.test(file)) throw new UserError('Blocco non valido');
  try { return await fsp.readFile(path.join(dirIndice(), file), 'utf8'); } catch { return null; }
}
function indiceScrivi({ scrivi, manifesto, elimina }) {
  if (!Array.isArray(scrivi) || !Array.isArray(elimina) || !manifesto || typeof manifesto !== 'object') throw new UserError('Dati dell\'indice non validi');
  const lavoro = async () => {
    let tot = 0;
    for (const b of scrivi) {
      if (!RE_BLOCCO.test(b?.file) || typeof b.testo !== 'string') throw new UserError('Blocco non valido');
      tot += b.testo.length;
      if (tot > MAX_TESTO_BLOCCO) throw new UserError('Scrittura dell\'indice troppo grande');
      await scriviAtomico(path.join(dirIndice(), b.file), b.testo);
    }
    await scriviAtomico(path.join(dirIndice(), 'manifesto.json'), JSON.stringify(manifesto));
    for (const f of elimina) if (RE_BLOCCO.test(f)) await fsp.unlink(path.join(dirIndice(), f)).catch(() => {});
    return true;
  };
  const p = S.scritture.then(lavoro, lavoro);
  S.scritture = p.catch(() => {});
  return p;
}

async function statiLeggi() {
  for (const f of [fileStati(), fileStati() + '.bak']) {
    try { const t = await fsp.readFile(f, 'utf8'); JSON.parse(t); return { testo: t, riserva: f.endsWith('.bak') }; } catch { /* prova la riserva */ }
  }
  return { testo: null, riserva: false };
}
async function statiScrivi({ testo }) {
  str(testo, 'stati', 200 * MB);
  JSON.parse(testo); // mai scrivere un file rovinato
  const lavoro = async () => {
    try { const cur = await fsp.readFile(fileStati(), 'utf8'); JSON.parse(cur); await scriviAtomico(fileStati() + '.bak', cur); } catch { /* primo salvataggio */ }
    await scriviAtomico(fileStati(), testo);
    return true;
  };
  const p = S.scritture.then(lavoro, lavoro);
  S.scritture = p.catch(() => {});
  return p;
}

async function cancellaIndice({ anche }) {
  await S.scritture;
  await fsp.rm(dirIndice(), { recursive: true, force: true });
  if (anche === 'tutto') {
    await fsp.rm(fileStati(), { force: true });
    await fsp.rm(fileStati() + '.bak', { force: true });
    S.config.cartelle = [];
    await salvaConfig();
  }
  return true;
}

async function dimensioneDati() {
  let tot = 0;
  async function walk(d) {
    for (const e of await fsp.readdir(d, { withFileTypes: true }).catch(() => [])) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) await walk(p); else tot += (await fsp.stat(p).catch(() => ({ size: 0 }))).size;
    }
  }
  await walk(S.dir);
  return tot;
}

// ---------------- sorveglianza delle cartelle ----------------
// fs.watch (ricorsivo su macOS e Windows) segnala in pochi secondi i file nuovi nelle cartelle LOCALI
// (comprese quelle sincronizzate da OneDrive). Sulle cartelle di rete non è affidabile: lì vale solo il
// controllo periodico leggero fatto dal renderer. Gli eventi sono solo un campanello: il renderer poi
// rifà la scansione incrementale della cartella (dimensione e data), che è la fonte di verità.
const sorveglianti = new Map(); // id → watcher
function cartellaDiRete(p) {
  // Windows: i percorsi \\server\condivisione; una lettera di unità mappata non si distingue senza moduli
  // nativi: si prova a sorvegliarla e, se non funziona, resta il controllo periodico
  if (process.platform === 'win32') return /^\\\\/.test(p);
  if (process.platform === 'darwin') return /^\/Volumes\//.test(p);
  return /^\/(mnt|media|net)\//.test(p);
}
function sorveglia(c, notifica) {
  smetti(c.id);
  if (cartellaDiRete(c.percorso) || !['darwin', 'win32'].includes(process.platform)) return false;
  try {
    let t = null;
    const w = fs.watch(c.percorso, { recursive: true, persistent: false }, (_ev, nome) => {
      const n = String(nome || '');
      if (n && (path.basename(n).startsWith('.') || n.endsWith('.leggio-tmp'))) return;
      clearTimeout(t);
      t = setTimeout(() => notifica(c.id), 2500); // si aspetta che la copia dei file finisca
    });
    w.on('error', () => smetti(c.id));
    sorveglianti.set(c.id, w);
    return true;
  } catch { return false; }
}
function smetti(id) { try { sorveglianti.get(id)?.close(); } catch { /* */ } sorveglianti.delete(id); }

// ---------------- copie ----------------
async function percorsoLibero(dir, name) {
  const ext = path.extname(name); const base = name.slice(0, name.length - ext.length);
  let p = path.join(dir, name); let i = 2;
  while (fs.existsSync(p)) { p = path.join(dir, `${base} (${i++})${ext}`); if (i > 9999) throw new UserError('Troppi file con lo stesso nome.'); }
  return p;
}
/** Dove salvare: cartella «Elaborati» accanto all'originale (in una cartella collegata) o cartella scelta. */
async function cartellaUscita({ origine, cartella, sotto }) {
  let dir;
  if (cartella) {
    dir = absPath(cartella, 'cartella');
    if (![...S.destinazioni].some((d) => dentro(d, dir))) throw new UserError('Scegli di nuovo la cartella in cui salvare.');
  } else {
    const o = mustBeInArchivio(origine);
    dir = path.dirname(o);
    const sub = String(sotto || 'Elaborati').split(/[\\/]+/).filter((s) => s && s !== '.' && s !== '..').map((s) => safeName(s, 'Elaborati')).slice(0, 4);
    if (sub.length) dir = path.join(dir, ...sub);
  }
  await fsp.mkdir(dir, { recursive: true });
  return dir;
}
async function scriviCopia({ origine, cartella, sotto, nome, bytes }) {
  const data = bytesArg(bytes);
  const dir = await cartellaUscita({ origine, cartella, sotto });
  const p = await percorsoLibero(dir, safeName(nome));
  await safeWrite(p, data);
  return p;
}
async function copiaFile({ path: p, cartella, sotto, nome }) {
  const src = mustBeInArchivio(p);
  const dir = await cartellaUscita({ origine: src, cartella, sotto });
  const dest = await percorsoLibero(dir, safeName(nome || path.basename(src)));
  await fsp.copyFile(src, dest, fs.constants.COPYFILE_EXCL);
  return dest;
}

// ---------------- registrazione ----------------
function wrap(fn) {
  return async (_e, args) => {
    try { return { ok: true, value: await fn(args || {}) }; }
    catch (err) {
      if (!(err instanceof UserError) && !err?.userMessage) console.error('[leggio archivio]', err);
      const msg = err instanceof UserError ? err.message : err?.userMessage || ({
        ENOENT: 'Il file o la cartella non esiste più (spostato, eliminato o disco scollegato).', EACCES: 'Accesso negato: controlla i permessi della cartella.',
        EPERM: 'Accesso negato: controlla i permessi della cartella.', ENOSPC: 'Spazio su disco esaurito.', EBUSY: 'Il file è in uso da un altro programma.',
        ETIMEDOUT: 'Il disco di rete non risponde.', EIO: 'Errore di lettura del disco.',
      }[err?.code]) || 'Operazione non riuscita: ' + (err?.message || err);
      return { ok: false, error: msg, code: err?.code || null };
    }
  };
}

function register({ ipcMain, app, dialog, getWindow }) {
  S.dir = path.join(app.getPath('userData'), 'archivio');
  leggiConfig();
  // solo per il collaudo automatico (mai nell'app installata): cartelle senza dialogo
  const prova = process.env.LEGGIO_ARCHIVIO_TEST === '1' && !app.isPackaged;
  const h = (name, fn) => { ipcMain.removeHandler('feat:archivio:' + name); ipcMain.handle('feat:archivio:' + name, (e, a) => { if (!senderOk(e)) return { ok: false, error: 'Mittente non autorizzato' }; return wrap(fn)(e, a); }); };
  h('cartelle', async () => ({ cartelle: S.config.cartelle, dati: S.dir }));
  h('aggiungi-cartella', async ({ percorso }) => {
    if (percorso && prova) return aggiungiCartella(absPath(percorso));
    const r = await dialog.showOpenDialog(getWindow(), { title: 'Collega una cartella all\'archivio', buttonLabel: 'Collega questa cartella', properties: ['openDirectory'] });
    if (r.canceled || !r.filePaths[0]) return null;
    return aggiungiCartella(r.filePaths[0]);
  });
  h('togli-cartella', async ({ id }) => {
    const n = S.config.cartelle.length;
    S.config.cartelle = S.config.cartelle.filter((c) => c.id !== id);
    smetti(id);
    if (S.config.cartelle.length !== n) await salvaConfig();
    return true;
  });
  h('scansiona', scansiona);
  const notifica = (id) => { const w = getWindow(); if (w && !w.isDestroyed()) w.webContents.send('feat:archivio:cambiata', { id }); };
  h('sorveglia', async () => {
    const out = {};
    for (const id of [...sorveglianti.keys()]) if (!S.config.cartelle.some((c) => c.id === id)) smetti(id);
    for (const c of S.config.cartelle) out[c.id] = sorveglianti.has(c.id) || sorveglia(c, notifica);
    return out;
  });
  h('leggi', leggi);
  h('indice-manifesto', indiceManifesto);
  h('indice-blocco', indiceBlocco);
  h('indice-scrivi', indiceScrivi);
  h('stati-leggi', statiLeggi);
  h('stati-scrivi', statiScrivi);
  h('cancella-indice', cancellaIndice);
  h('dimensione', dimensioneDati);
  h('scegli-destinazione', async ({ title }) => {
    const r = await dialog.showOpenDialog(getWindow(), { title: typeof title === 'string' ? title.slice(0, 200) : 'Dove salvare le copie', buttonLabel: 'Salva qui', properties: ['openDirectory', 'createDirectory'] });
    if (r.canceled || !r.filePaths[0]) return null;
    S.destinazioni.add(path.resolve(r.filePaths[0]));
    return r.filePaths[0];
  });
  h('scrivi-copia', scriviCopia);
  h('copia-file', copiaFile);
}

// Stesso controllo del nucleo: solo la pagina dell'app può usare questi canali.
function senderOk(e) {
  const url = String(e?.senderFrame?.url || '');
  const dev = process.env.LEGGIO_DEV_URL;
  if (dev && url.startsWith(dev)) return true;
  const index = require('node:url').pathToFileURL(path.join(__dirname, '..', '..', 'dist', 'index.html')).href;
  return url.split('#')[0].split('?')[0] === index;
}

/** Il percorso sta in una cartella collegata all'archivio (scelta dall'utente): gli altri moduli possono usarlo. */
function pathAllowed(p) { try { return typeof p === 'string' && path.isAbsolute(p) && !!cartellaDi(p); } catch { return false; } }

module.exports = {
  pathAllowed,
  register,
  _test: { S, cartellaDiRete, aggiungiCartella, scansiona, leggi, indiceManifesto, indiceBlocco, indiceScrivi, statiLeggi, statiScrivi, cancellaIndice, scriviCopia, copiaFile, leggiConfig, dentro, safeName, UserError, init(dir) { S.dir = dir; S.config = { versione: 1, cartelle: [] }; S.destinazioni.clear(); } },
};
