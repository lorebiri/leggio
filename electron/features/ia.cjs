// Leggio — assistente IA locale, processo principale (vedi docs/aree/ia.md).
//
// Tutto sul computer dell'utente: il motore (llama.cpp) e i modelli NON sono nel pacchetto di Leggio,
// si scaricano solo se l'utente attiva l'assistente (da fonti fisse, con verifica SHA-256) oppure si
// importano da file (chiavetta, cartella di rete). Il calcolo gira in processi separati (llama-server),
// in ascolto solo su 127.0.0.1 con chiave casuale. Nessun dato dei documenti esce dal PC.
//
// Canali 'feat:ia:*' (risposta { ok, value } | { ok:false, error }); avanzamento su 'feat:ia:avanzamento'.
// All'avvio di Leggio questo modulo non fa nulla: niente processi, niente letture di file, niente rete.
const path = require('node:path');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const { MODELLI, motorePer, TAG_MOTORE } = require('../ia/catalogo.cjs');
const { scarica, importa, ErroreDownload } = require('../ia/scarica.cjs');
const { estrai, trova } = require('../ia/archivi.cjs');
const { Motore } = require('../ia/server.cjs');
const { Indice } = require('../ia/indice.cjs');

const S = {
  dir: '', // userData/ia
  motore: null, // istanza di Motore (processi llama-server)
  indice: null,
  download: null, // { componente, fatti, totale, controller }
  richieste: new Map(), // id → AbortController
  log: null,
  fetchFn: null,
};

const COMPONENTI = ['motore', 'principale', 'leggero', 'embedding'];
const MAX_TESTO = 400000; // caratteri di contesto accettati per una richiesta (il renderer manda molto meno)

class UserError extends Error {}

// ---------------- percorsi e stato ----------------
const cartella = (...p) => path.join(S.dir, ...p);
const fileModello = (k) => cartella('modelli', MODELLI[k].file);
const cartellaMotore = () => cartella('motore', TAG_MOTORE);
const nomeBinario = () => (process.platform === 'win32' ? 'llama-server.exe' : 'llama-server');

function binario() {
  const dir = cartellaMotore();
  if (!fs.existsSync(path.join(dir, '.verificato'))) return null;
  return trova(dir, nomeBinario());
}

function installato(k) {
  if (k === 'motore') return !!binario();
  try { return fs.statSync(fileModello(k)).size === MODELLI[k].byte; } catch { return false; }
}

/**
 * Il processore ha AVX2? (senza AVX2 il motore funziona ma è molto lento: l'assistente lo sconsiglia)
 * → true | false | null (non si sa). Calcolato una volta sola, solo quando serve.
 */
let avx2Cache;
function controllaAvx2() {
  if (avx2Cache !== undefined) return avx2Cache;
  const { execFileSync } = require('node:child_process');
  avx2Cache = null;
  try {
    if (process.arch === 'arm64') avx2Cache = null; // ARM (Apple M, Snapdragon): AVX2 non esiste, si usano altre istruzioni
    else if (process.platform === 'linux') avx2Cache = /\bavx2\b/.test(fs.readFileSync('/proc/cpuinfo', 'utf8'));
    else if (process.platform === 'darwin') avx2Cache = /AVX2/.test(execFileSync('sysctl', ['-n', 'machdep.cpu.leaf7_features'], { encoding: 'utf8', timeout: 5000 }));
    else if (process.platform === 'win32') {
      const cmd = 'Add-Type -Namespace L -Name C -MemberDefinition \'[DllImport("kernel32.dll")] public static extern bool IsProcessorFeaturePresent(uint f);\'; [L.C]::IsProcessorFeaturePresent(40)';
      avx2Cache = /True/i.test(execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', cmd], { encoding: 'utf8', timeout: 15000, windowsHide: true }));
    }
  } catch { avx2Cache = null; }
  return avx2Cache;
}

async function stato({ controllaCpu = false } = {}) {
  const m = motorePer();
  const modelli = {};
  for (const [k, v] of Object.entries(MODELLI)) {
    modelli[k] = { nome: v.nome, autore: v.autore, licenza: v.licenza, licenzaUrl: v.licenzaUrl, descrizione: v.descrizione, byte: v.byte, ram: v.ram, installato: installato(k) };
  }
  let disco = null;
  try { const st = await fsp.statfs(S.dir && fs.existsSync(S.dir) ? S.dir : os.homedir()); disco = st.bavail * st.bsize; } catch { disco = null; }
  return {
    piattaformaSupportata: !!m,
    piattaforma: `${process.platform}-${process.arch}`,
    motore: m ? { nome: m.nome, licenza: m.licenza, byte: m.byte, installato: installato('motore') } : null,
    modelli,
    ram: { totale: os.totalmem(), libera: os.freemem() },
    cpu: { modello: os.cpus()?.[0]?.model?.trim() || '', logici: os.cpus()?.length || 0, arch: process.arch, avx2: controllaCpu ? controllaAvx2() : (avx2Cache ?? null) },
    discoLibero: disco,
    download: S.download ? { componente: S.download.componente, fatti: S.download.fatti, totale: S.download.totale, fase: S.download.fase } : null,
    processi: S.motore ? S.motore.stato() : null,
    cartella: S.dir,
  };
}

// ---------------- download e importazione ----------------
function avvisa(getWindow, dati) {
  const w = getWindow?.();
  if (w && !w.isDestroyed()) w.webContents.send('feat:ia:avanzamento', dati);
}

async function installaMotore(file) {
  const dest = cartellaMotore();
  await fsp.rm(dest, { recursive: true, force: true });
  await estrai(file, dest);
  const bin = trova(dest, nomeBinario());
  if (!bin) throw new UserError('Il pacchetto del motore non contiene llama-server.');
  if (process.platform !== 'win32') await fsp.chmod(bin, 0o755);
  await fsp.writeFile(path.join(dest, '.verificato'), JSON.stringify({ tag: TAG_MOTORE, sha256: motorePer().sha256, data: new Date().toISOString() }));
  await fsp.rm(file, { force: true });
}

async function scaricaComponenti(componenti, getWindow) {
  if (S.download) throw new UserError('C\'è già un download in corso.');
  const lista = componenti.filter((c) => COMPONENTI.includes(c) && !installato(c));
  const controller = new AbortController();
  S.download = { componente: null, fatti: 0, totale: 0, fase: 'inizio', controller };
  (async () => {
    try {
      for (const c of lista) {
        const spec = c === 'motore' ? motorePer() : MODELLI[c];
        if (!spec) throw new UserError('Questo sistema non è supportato dall\'assistente.');
        Object.assign(S.download, { componente: c, fatti: 0, totale: spec.byte, fase: 'scarico' });
        avvisa(getWindow, { componente: c, fase: 'scarico', fatti: 0, totale: spec.byte });
        const dest = c === 'motore' ? cartella('scaricati', spec.file) : fileModello(c);
        await scarica(spec.url, dest, {
          sha256: spec.sha256, byte: spec.byte, fetchFn: S.fetchFn, signal: controller.signal,
          onProgress: ({ fatti, totale }) => { S.download.fatti = fatti; S.download.totale = totale; avvisa(getWindow, { componente: c, fase: 'scarico', fatti, totale }); },
        });
        if (c === 'motore') { S.download.fase = 'installo'; avvisa(getWindow, { componente: c, fase: 'installo' }); await installaMotore(dest); }
        S.log?.('info', 'ia: componente installato', { componente: c });
        avvisa(getWindow, { componente: c, fase: 'fatto' });
      }
      avvisa(getWindow, { fase: 'finito' });
    } catch (e) {
      S.log?.('warn', 'ia: download non riuscito', { componente: S.download?.componente, errore: e.message, codice: e.codice });
      avvisa(getWindow, { componente: S.download?.componente, fase: e.codice === 'annullato' ? 'annullato' : 'errore', errore: e.message });
    } finally { S.download = null; }
  })();
  return { avviato: lista };
}

async function importaComponente(componente, origine) {
  if (!COMPONENTI.includes(componente)) throw new UserError('Componente sconosciuto.');
  if (S.download) throw new UserError('Attendi la fine del download in corso.');
  if (componente === 'motore') {
    const spec = motorePer();
    if (!spec) throw new UserError('Questo sistema non è supportato dall\'assistente.');
    const tmp = cartella('scaricati', spec.file);
    await importa(origine, tmp, spec);
    await installaMotore(tmp);
  } else {
    await importa(origine, fileModello(componente), MODELLI[componente]);
  }
  S.log?.('info', 'ia: componente importato da file', { componente });
  return true;
}

async function rimuovi(componente) {
  await S.motore?.ferma();
  S.motore = null;
  if (componente === 'tutto') {
    await fsp.rm(S.dir, { recursive: true, force: true });
    S.indice = null;
    return true;
  }
  if (componente === 'motore') await fsp.rm(cartella('motore'), { recursive: true, force: true });
  else if (MODELLI[componente]) await fsp.rm(fileModello(componente), { force: true });
  else throw new UserError('Componente sconosciuto.');
  return true;
}

// ---------------- uso del motore ----------------
function motore() {
  const bin = binario();
  if (!bin) throw new UserError('Il motore dell\'assistente non è installato: attivalo dalle Impostazioni.');
  if (!S.motore || S.motore.binario !== bin) {
    S.motore = new Motore({ binario: bin, cartellaRegistri: S.dir, log: S.log, fetchFn: S.fetchFn || globalThis.fetch });
    S.motore.binario = bin;
  }
  return S.motore;
}

function modelloPronto(k) {
  if (!MODELLI[k] || k === 'embedding') throw new UserError('Modello sconosciuto.');
  if (!installato(k)) throw new UserError(`Il modello ${MODELLI[k].nome} non è installato.`);
  return fileModello(k);
}

function messaggiValidi(m) {
  if (!Array.isArray(m) || !m.length || m.length > 20) throw new UserError('Richiesta non valida.');
  let n = 0;
  for (const x of m) {
    if (!x || !['system', 'user', 'assistant'].includes(x.role) || typeof x.content !== 'string') throw new UserError('Richiesta non valida.');
    n += x.content.length;
  }
  if (n > MAX_TESTO) throw new UserError('Il testo è troppo lungo per l\'assistente.');
  return m.map((x) => ({ role: x.role, content: x.content }));
}

async function chiedi({ modello = 'principale', messaggi, schema = null, maxToken = 300, id } = {}) {
  const file = modelloPronto(modello);
  const msg = messaggiValidi(messaggi);
  const ctrl = new AbortController();
  if (typeof id === 'string' && id.length < 100) S.richieste.set(id, ctrl);
  try {
    return await motore().chat(file, { messaggi: msg, schema: schema && typeof schema === 'object' ? schema : null, maxToken: Math.max(1, Math.min(1000, Number(maxToken) || 300)) }, { signal: ctrl.signal });
  } catch (e) {
    if (ctrl.signal.aborted) throw new UserError('Interrotto.');
    throw e;
  } finally { if (id) S.richieste.delete(id); }
}

/** Vettori dei testi; i testi troppo lunghi per il modello (512 token) vengono accorciati. */
async function vettori(testi, { signal } = {}) {
  if (!Array.isArray(testi) || testi.length > 2000 || testi.some((t) => typeof t !== 'string')) throw new UserError('Richiesta non valida.');
  if (!installato('embedding')) throw new UserError('Il modello per la ricerca per significato non è installato.');
  const m = motore();
  const file = fileModello('embedding');
  const out = [];
  for (let i = 0; i < testi.length; i += 64) {
    const gruppo = testi.slice(i, i + 64).map((t) => t.slice(0, 2400));
    try { out.push(...await m.embed(file, gruppo, { signal })); }
    catch (e) {
      if (signal?.aborted) throw e;
      // uno dei testi supera il limite del modello: si accorcia uno per uno
      for (let t of gruppo) {
        let n = await m.tokens('embed', t);
        while (n && n > 500) { t = t.slice(0, Math.floor((t.length * 500) / n * 0.95)); n = await m.tokens('embed', t); }
        out.push(...await m.embed(file, [t], { signal }));
      }
    }
  }
  return out;
}

async function indice() {
  if (!S.indice) S.indice = new Indice(cartella('indice'));
  await S.indice.carica();
  return S.indice;
}

const validaImpronta = (s) => { if (typeof s !== 'string' || !/^[0-9a-f]{16,64}$/i.test(s)) throw new UserError('Impronta non valida.'); return s; };

async function indiceAggiungi({ documenti }) {
  if (!Array.isArray(documenti) || documenti.length > 50) throw new UserError('Richiesta non valida.');
  const ix = await indice();
  let n = 0;
  for (const d of documenti) {
    const imp = validaImpronta(d.impronta);
    const pz = (Array.isArray(d.passaggi) ? d.passaggi : []).filter((p) => p && typeof p.testo === 'string' && p.testo.trim() && Number.isInteger(p.pagina)).slice(0, 3000);
    const v = pz.length ? await vettori(pz.map((p) => p.testo)) : [];
    ix.metti(imp, MODELLI.embedding.sha256, pz, v);
    n += pz.length;
  }
  await ix.salva();
  return { passaggi: n, ...ix.info() };
}

async function indiceCerca({ domanda, k = 20, impronte = null }) {
  if (typeof domanda !== 'string' || !domanda.trim() || domanda.length > 2000) throw new UserError('Scrivi cosa cercare.');
  const ix = await indice();
  if (!ix.doc.size) return [];
  const [q] = await vettori([domanda.trim()]);
  return ix.cerca(q, { k: Math.max(1, Math.min(200, Number(k) || 20)), filtro: Array.isArray(impronte) ? new Set(impronte) : null });
}

// ---------------- registrazione ----------------
function wrap(fn) {
  return async (_e, a) => {
    try { return { ok: true, value: await fn(a || {}) }; }
    catch (e) {
      const leggibile = e instanceof UserError || e instanceof ErroreDownload || /motore|modello|assistente/i.test(e.message || '');
      if (!leggibile) S.log?.('error', 'ia: errore', { errore: e.message });
      return { ok: false, error: leggibile ? e.message : 'Operazione non riuscita: ' + (e.message || 'errore sconosciuto'), code: e.codice };
    }
  };
}

function register({ ipcMain, app, dialog, getWindow, log }) {
  S.dir = path.join(app.getPath('userData'), 'ia');
  S.log = log;
  try { S.fetchFn = require('electron').net?.fetch?.bind(require('electron').net) || globalThis.fetch; } catch { S.fetchFn = globalThis.fetch; }
  const h = (name, fn) => { ipcMain.removeHandler('feat:ia:' + name); ipcMain.handle('feat:ia:' + name, wrap(fn)); };
  h('stato', stato);
  h('scarica', ({ componenti }) => scaricaComponenti(Array.isArray(componenti) ? componenti : [], getWindow));
  h('annulla-download', async () => { S.download?.controller.abort(); return true; });
  h('importa', async ({ componente }) => {
    if (!COMPONENTI.includes(componente)) throw new UserError('Componente sconosciuto.');
    const atteso = componente === 'motore' ? motorePer()?.file : MODELLI[componente].file;
    const r = await dialog.showOpenDialog(getWindow(), {
      title: `Scegli il file ${atteso}`, buttonLabel: 'Importa',
      properties: ['openFile'], filters: [{ name: componente === 'motore' ? 'Pacchetto del motore' : 'Modello GGUF', extensions: componente === 'motore' ? ['zip', 'gz', 'tgz'] : ['gguf'] }],
    });
    if (r.canceled || !r.filePaths[0]) return null;
    return importaComponente(componente, r.filePaths[0]);
  });
  h('rimuovi', ({ componente }) => rimuovi(componente));
  h('chiedi', chiedi);
  h('interrompi', async ({ id }) => { S.richieste.get(id)?.abort(); return true; });
  h('vettori', async ({ testi }) => vettori(testi));
  h('ferma', async () => { await S.motore?.ferma(); return true; });
  h('indice-info', async () => (await indice()).info());
  h('indice-impronte', async () => (await indice()).impronte(MODELLI.embedding.sha256));
  h('indice-aggiungi', indiceAggiungi);
  h('indice-togli', async ({ impronte }) => { const ix = await indice(); const n = ix.togli((impronte || []).filter((x) => typeof x === 'string')); await ix.salva(); return n; });
  h('indice-cerca', indiceCerca);
  h('indice-cancella', async () => { await (await indice()).cancella(); return true; });
  // all'uscita i processi del motore si chiudono con l'app
  app.on('will-quit', () => { S.motore?.ferma(); S.download?.controller.abort(); });
}

module.exports = {
  register,
  _test: {
    S, stato, scaricaComponenti, importaComponente, rimuovi, chiedi, vettori, indiceAggiungi, indiceCerca, installato, binario,
    init(dir, { fetchFn } = {}) { S.dir = dir; S.motore = null; S.indice = null; S.download = null; S.fetchFn = fetchFn || globalThis.fetch; },
  },
};
