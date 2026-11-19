// Archivio personale cifrato di Leggio: firme, sigle, timbri, rubrica, modelli, registro degli utilizzi.
// Gira SOLO nel processo principale. Il renderer riceve i dati che gli servono, mai le chiavi.
//
// Struttura su disco (cartella dati dell'app, sottocartella «personale»):
//   chiave.json        chiave dati (DEK, 256 bit) protetta: dal sistema (safeStorage), da una password,
//                      oppure — ripiego documentato — solo dai permessi del file (vedi docs/aree/personale.md)
//   indice.dat         indice JSON cifrato (contatti, metadati delle firme, modelli, registro, profilo)
//   indice.dat.bak     versione precedente dell'indice (backup automatico dell'ultima versione)
//   blob/<id>.dat      immagini delle firme e dei timbri, PDF dei modelli: un file cifrato ciascuno
//
// Ogni file cifrato: "LGV1" + IV (12 byte) + tag (16 byte) + dati AES-256-GCM. I dati aggiuntivi
// autenticati (AAD) legano il contenuto al suo nome (un blob non può essere scambiato con un altro).
// Le scritture sono atomiche (temporaneo + fsync + verifica + rename: core/safe-write.cjs).
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');
const zlib = require('node:zlib');
const { safeWrite } = require('../core/safe-write.cjs');

const MAGIC = Buffer.from('LGV1');
const BACKUP_MAGIC = 'LEGGIO-BACKUP-1\n';
const MAX_INDICE = 64 * 1024 * 1024;
const MAX_BLOB = 64 * 1024 * 1024;
const MAX_BACKUP = 1024 * 1024 * 1024;
const ID_RE = /^[a-z0-9][a-z0-9_-]{3,63}$/;
// scrypt: ~50-100 ms su un PC d'ufficio, 32 MB di memoria
const KDF = { N: 32768, r: 8, p: 1 };
const KDF_MAXMEM = 128 * 1024 * 1024;
const MIN_PASSWORD = 8;

class ErroreArchivio extends Error {
  constructor(msg, code) { super(msg); this.name = 'ErroreArchivio'; this.code = code || 'archivio'; this.userMessage = msg; }
}

// --------------------------------------------------------------------------------- cifratura
function cifra(key, plain, aad) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  if (aad) c.setAAD(Buffer.from(aad, 'utf8'));
  const ct = Buffer.concat([c.update(plain), c.final()]);
  return Buffer.concat([MAGIC, iv, c.getAuthTag(), ct]);
}
function decifra(key, buf, aad) {
  if (!Buffer.isBuffer(buf) || buf.length < 32 || !buf.subarray(0, 4).equals(MAGIC)) throw new ErroreArchivio('File dell\'archivio non riconosciuto o danneggiato.', 'danneggiato');
  const iv = buf.subarray(4, 16); const tag = buf.subarray(16, 32);
  const d = crypto.createDecipheriv('aes-256-gcm', key, iv);
  if (aad) d.setAAD(Buffer.from(aad, 'utf8'));
  d.setAuthTag(tag);
  try { return Buffer.concat([d.update(buf.subarray(32)), d.final()]); }
  catch { throw new ErroreArchivio('File dell\'archivio danneggiato o chiave errata.', 'danneggiato'); }
}
function derivaChiave(password, salt, params = KDF) {
  return crypto.scryptSync(Buffer.from(String(password).normalize('NFC'), 'utf8'), salt, 32, { N: params.N, r: params.r, p: params.p, maxmem: KDF_MAXMEM });
}
/** Avvolge la DEK con una password. → oggetto JSON */
function avvolgiConPassword(dek, password) {
  const salt = crypto.randomBytes(16);
  const kek = derivaChiave(password, salt);
  const box = cifra(kek, dek, 'leggio-dek');
  return { kdf: 'scrypt', ...KDF, salt: salt.toString('base64'), dati: box.toString('base64') };
}
function svolgiConPassword(w, password) {
  if (!w || w.kdf !== 'scrypt') throw new ErroreArchivio('Chiave dell\'archivio non riconosciuta.', 'danneggiato');
  const params = { N: num(w.N, 1024, 1 << 20), r: num(w.r, 1, 32), p: num(w.p, 1, 16) };
  const kek = derivaChiave(password, Buffer.from(w.salt, 'base64'), params);
  try { return decifra(kek, Buffer.from(w.dati, 'base64'), 'leggio-dek'); }
  catch { throw new ErroreArchivio('Password errata.', 'password-errata'); }
}
function num(v, min, max) { const n = Number(v); if (!Number.isInteger(n) || n < min || n > max) throw new ErroreArchivio('Chiave dell\'archivio non valida.', 'danneggiato'); return n; }

// --------------------------------------------------------------------------------- protezione dal sistema
/**
 * safeStorage di Electron: Portachiavi (macOS), DPAPI (Windows), libsecret/kwallet (Linux).
 * Su Linux senza portachiavi Electron ripiega su «basic_text» (una chiave fissa, nessuna vera protezione):
 * in quel caso lo consideriamo NON disponibile e usiamo il ripiego documentato.
 */
function sistemaDisponibile(safeStorage, platform = process.platform) {
  try {
    if (!safeStorage || !safeStorage.isEncryptionAvailable()) return false;
    if (platform === 'linux' && typeof safeStorage.getSelectedStorageBackend === 'function') {
      const b = safeStorage.getSelectedStorageBackend();
      if (b === 'basic_text' || b === 'unknown') return false;
    }
    return true;
  } catch { return false; }
}
function nomeSistema(platform = process.platform) {
  return platform === 'darwin' ? 'Portachiavi di macOS' : platform === 'win32' ? 'protezione dati di Windows (DPAPI)' : 'portachiavi del sistema (libsecret)';
}

// --------------------------------------------------------------------------------- utilità file
async function leggiSe(p) { try { return await fsp.readFile(p); } catch (e) { if (e.code === 'ENOENT') return null; throw e; } }
async function scriviAtomico(p, buf) { await safeWrite(p, buf); }
async function scriviPrivato(p, buf) {
  await scriviAtomico(p, buf);
  try { await fsp.chmod(p, 0o600); } catch { /* FAT, Windows: non essenziale */ }
}
function controllaId(id) { if (typeof id !== 'string' || !ID_RE.test(id)) throw new ErroreArchivio('Identificativo non valido.', 'argomenti'); return id; }
function comeBuffer(v, max, cosa) {
  let b;
  if (Buffer.isBuffer(v)) b = v;
  else if (v instanceof Uint8Array) b = Buffer.from(v.buffer, v.byteOffset, v.byteLength);
  else if (v instanceof ArrayBuffer) b = Buffer.from(v);
  else throw new ErroreArchivio(`Dati non validi: ${cosa}.`, 'argomenti');
  if (b.length > max) throw new ErroreArchivio(`${cosa} troppo grande (${Math.round(b.length / 1048576)} MB).`, 'argomenti');
  return b;
}

/** Raccoglie i valori delle chiavi «blob» in tutto l'indice (riferimenti ai file cifrati). */
function blobUsati(indice, out = new Set()) {
  if (Array.isArray(indice)) { for (const x of indice) blobUsati(x, out); return out; }
  if (indice && typeof indice === 'object') {
    for (const [k, v] of Object.entries(indice)) {
      if (k === 'blob' && typeof v === 'string' && ID_RE.test(v)) out.add(v);
      else if (v && typeof v === 'object') blobUsati(v, out);
    }
  }
  return out;
}

/** Controllo di forma dell'indice (arriva dal renderer: non ci si fida). */
function controllaIndice(indice) {
  if (!indice || typeof indice !== 'object' || Array.isArray(indice)) throw new ErroreArchivio('Indice dell\'archivio non valido.', 'argomenti');
  const json = JSON.stringify(indice);
  if (json.length > MAX_INDICE) throw new ErroreArchivio('L\'archivio personale ha superato i 64 MB di dati di testo.', 'argomenti');
  // profondità limitata (niente strutture patologiche)
  const prof = (v, d) => { if (d > 12) throw new ErroreArchivio('Indice dell\'archivio troppo annidato.', 'argomenti'); if (v && typeof v === 'object') for (const x of Object.values(v)) prof(x, d + 1); };
  prof(indice, 0);
  return json;
}

// --------------------------------------------------------------------------------- archivio
/**
 * createCassaforte({ dir, safeStorage, platform, log })
 * Le operazioni sono messe in coda (una alla volta): niente scritture intrecciate.
 */
function createCassaforte({ dir, safeStorage = null, platform = process.platform, log = () => {} }) {
  const P = {
    chiave: path.join(dir, 'chiave.json'),
    indice: path.join(dir, 'indice.dat'),
    bak: path.join(dir, 'indice.dat.bak'),
    blob: path.join(dir, 'blob'),
  };
  let dek = null;            // chiave dati in memoria (solo da sbloccato)
  let info = null;           // contenuto di chiave.json
  let ripristinato = false;  // l'indice era danneggiato ed è stato letto dal backup
  let errori = 0;            // password sbagliate di fila (rallentamento)
  let pulizia = false;       // pulizia degli orfani già programmata in questa sessione
  let coda = Promise.resolve();
  const inCoda = (fn) => { const r = coda.then(fn, fn); coda = r.catch(() => {}); return r; };

  async function assicuraCartelle() {
    await fsp.mkdir(P.blob, { recursive: true, mode: 0o700 });
  }
  async function leggiInfo() {
    const b = await leggiSe(P.chiave);
    if (!b) return null;
    try { const o = JSON.parse(b.toString('utf8')); if (o && o.formato === 'leggio-chiave' && o.versione === 1) return o; } catch { /* sotto */ }
    throw new ErroreArchivio('Il file della chiave dell\'archivio personale è danneggiato.', 'danneggiato');
  }
  /** Protegge una stringa con il sistema (se disponibile). → { metodo, dati } */
  function proteggi(testo) {
    if (sistemaDisponibile(safeStorage, platform)) return { metodo: 'sistema', dati: safeStorage.encryptString(testo).toString('base64') };
    return { metodo: 'file', dati: Buffer.from(testo, 'utf8').toString('base64') };
  }
  function sproteggi(p) {
    if (p.metodo === 'sistema') {
      if (!safeStorage) throw new ErroreArchivio('Protezione del sistema non disponibile.', 'sistema');
      try { return safeStorage.decryptString(Buffer.from(p.dati, 'base64')); }
      catch { throw new ErroreArchivio(`Il ${nomeSistema(platform)} non riesce ad aprire la chiave dell'archivio personale (è cambiato l'utente del computer o il portachiavi è stato azzerato?). Puoi ripristinare un file di backup oppure ricominciare con un archivio vuoto.`, 'sistema'); }
    }
    if (p.metodo === 'file') return Buffer.from(p.dati, 'base64').toString('utf8');
    throw new ErroreArchivio('Metodo di protezione sconosciuto.', 'danneggiato');
  }
  async function scriviInfo(nuovo) {
    await scriviPrivato(P.chiave, Buffer.from(JSON.stringify(nuovo, null, 1), 'utf8'));
    info = nuovo;
  }
  function infoDaDek(chiaveDati, password) {
    if (password) return { formato: 'leggio-chiave', versione: 1, password: true, protetta: proteggi(JSON.stringify(avvolgiConPassword(chiaveDati, password))) };
    return { formato: 'leggio-chiave', versione: 1, password: false, protetta: proteggi(chiaveDati.toString('base64')) };
  }

  async function inizializza() {
    await assicuraCartelle();
    info = await leggiInfo();
    if (!info) {
      const nuova = crypto.randomBytes(32);
      await scriviInfo(infoDaDek(nuova, null));
      dek = nuova;
      log('info', 'archivio personale creato', { metodo: info.protetta.metodo });
      return;
    }
    if (!info.password && !dek) {
      dek = Buffer.from(sproteggi(info.protetta), 'base64');
      if (dek.length !== 32) { dek = null; throw new ErroreArchivio('Chiave dell\'archivio non valida.', 'danneggiato'); }
      // il sistema ora offre una protezione migliore del ripiego: si passa a quella, senza chiedere nulla
      if (info.protetta.metodo === 'file' && sistemaDisponibile(safeStorage, platform)) {
        await scriviInfo(infoDaDek(dek, null));
        log('info', 'chiave dell\'archivio personale ora protetta dal sistema');
      }
      programmaPulizia();
    }
  }

  /** Pulizia degli orfani una volta per sessione, poco dopo l'apertura (in coda, non blocca nulla). */
  function programmaPulizia() {
    if (pulizia) return; pulizia = true;
    const t = setTimeout(() => { inCoda(() => pulisciBlob()).catch(() => {}); }, 8000);
    t.unref?.();
  }

  function stato() {
    const metodo = info?.protetta?.metodo || (sistemaDisponibile(safeStorage, platform) ? 'sistema' : 'file');
    return {
      pronto: !!info,
      bloccato: !dek,
      password: !!info?.password,
      protezione: metodo,               // 'sistema' | 'file'
      sistema: nomeSistema(platform),
      sistemaDisponibile: sistemaDisponibile(safeStorage, platform),
      ripristinato,
      cartella: dir,
    };
  }
  function richiediSbloccato() { if (!dek) throw new ErroreArchivio('L\'archivio personale è bloccato: inserisci la password.', 'bloccato'); }

  async function sblocca(password) {
    if (!info) await inizializza();
    if (dek) return stato();
    if (!info.password) { await inizializza(); return stato(); }
    if (typeof password !== 'string' || !password) throw new ErroreArchivio('Inserisci la password dell\'archivio personale.', 'password-errata');
    if (errori >= 3) await new Promise((r) => setTimeout(r, Math.min(8000, 500 * 2 ** (errori - 3))));
    let w;
    try { w = JSON.parse(sproteggi(info.protetta)); } catch (e) { if (e instanceof ErroreArchivio) throw e; throw new ErroreArchivio('Chiave dell\'archivio danneggiata.', 'danneggiato'); }
    try { dek = svolgiConPassword(w, password); errori = 0; }
    catch (e) { errori++; throw e; }
    if (info.protetta.metodo === 'file' && sistemaDisponibile(safeStorage, platform)) await scriviInfo(infoDaDek(dek, password));
    programmaPulizia();
    return stato();
  }
  function blocca() { if (info?.password) { dek?.fill(0); dek = null; } return stato(); }

  async function impostaPassword(attuale, nuova) {
    if (!info) await inizializza();
    if (info.password) {
      // verifica della password attuale anche da sbloccato
      const w = JSON.parse(sproteggi(info.protetta));
      const k = svolgiConPassword(w, String(attuale || ''));
      dek = k;
    } else richiediSbloccato();
    if (nuova) {
      if (typeof nuova !== 'string' || nuova.length < MIN_PASSWORD) throw new ErroreArchivio(`La password deve avere almeno ${MIN_PASSWORD} caratteri.`, 'argomenti');
      if (nuova.length > 1024) throw new ErroreArchivio('Password troppo lunga.', 'argomenti');
    }
    await scriviInfo(infoDaDek(dek, nuova || null));
    log('info', nuova ? 'password dell\'archivio personale impostata' : 'password dell\'archivio personale tolta');
    return stato();
  }

  async function leggiIndice() {
    richiediSbloccato();
    const leggiDa = async (p, aad) => { const b = await leggiSe(p); if (!b) return null; return JSON.parse(decifra(dek, b, aad).toString('utf8')); };
    try {
      const v = await leggiDa(P.indice, 'indice');
      if (v) return v;
    } catch (e) {
      log('warn', 'indice dell\'archivio personale illeggibile: provo il backup', { error: e.message });
      const v = await leggiDa(P.bak, 'indice').catch(() => null);
      if (v) { ripristinato = true; return v; }
      throw new ErroreArchivio('L\'archivio personale è danneggiato e il backup automatico non è leggibile. Ripristina un file di backup esportato.', 'danneggiato');
    }
    // nessun indice: forse un salvataggio interrotto prima del rename; il backup è l'ultima versione buona
    const v = await leggiDa(P.bak, 'indice').catch(() => null);
    return v || null;
  }
  /** opzioni.purga: anche il backup prende la nuova versione (dopo una cancellazione per GDPR). */
  async function salvaIndice(indice, opzioni = {}) {
    richiediSbloccato();
    const json = controllaIndice(indice);
    const enc = cifra(dek, Buffer.from(json, 'utf8'), 'indice');
    if (opzioni.purga) await scriviPrivato(P.bak, enc);
    else {
      // se l'indice era danneggiato (letto dal backup) il backup buono NON va sovrascritto con quello rotto
      const cur = ripristinato ? null : await leggiSe(P.indice);
      if (cur) await scriviPrivato(P.bak, cur);
    }
    await scriviPrivato(P.indice, enc);
    ripristinato = false;
    return { byte: enc.length };
  }

  const percorsoBlob = (id) => path.join(P.blob, controllaId(id) + '.dat');
  async function leggiBlob(id) {
    richiediSbloccato();
    const b = await leggiSe(percorsoBlob(id));
    if (!b) throw new ErroreArchivio('Elemento dell\'archivio non trovato (forse è stato eliminato).', 'mancante');
    return decifra(dek, b, 'blob:' + id);
  }
  async function scriviBlob(id, dati) {
    richiediSbloccato();
    const buf = comeBuffer(dati, MAX_BLOB, 'Immagine o documento');
    await assicuraCartelle();
    await scriviPrivato(percorsoBlob(id), cifra(dek, buf, 'blob:' + id));
    return { byte: buf.length };
  }
  async function cancellaBlob(id) {
    const p = percorsoBlob(id);
    // sovrascrittura prima della cancellazione (best effort: su SSD non è garantita)
    try { const st = await fsp.stat(p); await fsp.writeFile(p, crypto.randomBytes(Math.min(st.size, 4 * 1024 * 1024))); } catch { /* non c'è */ }
    await fsp.rm(p, { force: true });
  }
  /** Elimina i blob non più citati dall'indice e più vecchi di un giorno (mai quelli appena scritti). */
  async function pulisciBlob({ eta = 24 * 3600 * 1000 } = {}) {
    if (!dek) return 0;
    const indice = await leggiIndice().catch(() => null);
    if (!indice) return 0;
    const usati = blobUsati(indice);
    let n = 0;
    let files = [];
    try { files = await fsp.readdir(P.blob); } catch { return 0; }
    for (const f of files) {
      const id = f.replace(/\.dat$/, '');
      if (!f.endsWith('.dat') || usati.has(id) || !ID_RE.test(id)) continue;
      try { const st = await fsp.stat(path.join(P.blob, f)); if (Date.now() - st.mtimeMs < eta) continue; } catch { continue; }
      await cancellaBlob(id); n++;
    }
    if (n) log('info', 'archivio personale: elementi orfani eliminati', { n });
    return n;
  }

  // ------------------------------------------------------------------------------- backup esportato
  /** File di backup portabile: cifrato con una password scelta all'esportazione (le chiavi del sistema non viaggiano). */
  async function esportaBackup(password) {
    richiediSbloccato();
    if (typeof password !== 'string' || password.length < MIN_PASSWORD) throw new ErroreArchivio(`Scegli una password di almeno ${MIN_PASSWORD} caratteri per il file di backup.`, 'argomenti');
    const indice = (await leggiIndice()) || {};
    const blob = {};
    for (const id of blobUsati(indice)) {
      try { blob[id] = (await leggiBlob(id)).toString('base64'); } catch (e) { log('warn', 'backup: elemento mancante', { id, error: e.message }); }
    }
    const payload = zlib.gzipSync(Buffer.from(JSON.stringify({ formato: 'leggio-archivio-personale', versione: 1, creato: new Date().toISOString(), indice, blob }), 'utf8'));
    const salt = crypto.randomBytes(16);
    const key = derivaChiave(password, salt);
    const head = { formato: 'leggio-backup', versione: 1, kdf: 'scrypt', ...KDF, salt: salt.toString('base64'), creato: new Date().toISOString() };
    const body = cifra(key, payload, 'leggio-backup');
    return Buffer.concat([Buffer.from(BACKUP_MAGIC + JSON.stringify(head) + '\n', 'utf8'), body]);
  }
  /** Legge un file di backup. → { indice, blob: Map(id → Buffer) } (non scrive nulla) */
  function leggiBackup(buf, password) {
    buf = comeBuffer(buf, MAX_BACKUP, 'File di backup');
    const s = buf.subarray(0, Math.min(buf.length, 4096)).toString('utf8');
    if (!s.startsWith(BACKUP_MAGIC)) throw new ErroreArchivio('Il file scelto non è un backup dell\'archivio personale di Leggio.', 'formato');
    const nl = s.indexOf('\n', BACKUP_MAGIC.length);
    if (nl < 0) throw new ErroreArchivio('File di backup danneggiato.', 'formato');
    let head;
    try { head = JSON.parse(s.slice(BACKUP_MAGIC.length, nl)); } catch { throw new ErroreArchivio('File di backup danneggiato.', 'formato'); }
    if (head.formato !== 'leggio-backup' || head.versione !== 1 || head.kdf !== 'scrypt') throw new ErroreArchivio('Versione del file di backup non supportata: aggiorna Leggio.', 'formato');
    const offset = Buffer.byteLength(s.slice(0, nl + 1), 'utf8');
    const key = derivaChiave(String(password || ''), Buffer.from(head.salt, 'base64'), { N: num(head.N, 1024, 1 << 20), r: num(head.r, 1, 32), p: num(head.p, 1, 16) });
    let payload;
    try { payload = decifra(key, buf.subarray(offset), 'leggio-backup'); }
    catch { throw new ErroreArchivio('Password del backup errata, oppure il file è danneggiato.', 'password-errata'); }
    let o;
    try { o = JSON.parse(zlib.gunzipSync(payload, { maxOutputLength: 2 * MAX_BACKUP }).toString('utf8')); }
    catch { throw new ErroreArchivio('Contenuto del backup danneggiato.', 'formato'); }
    if (!o || o.formato !== 'leggio-archivio-personale') throw new ErroreArchivio('Contenuto del backup non riconosciuto.', 'formato');
    const blob = new Map();
    for (const [id, b64] of Object.entries(o.blob || {})) if (ID_RE.test(id) && typeof b64 === 'string') blob.set(id, Buffer.from(b64, 'base64'));
    return { indice: o.indice && typeof o.indice === 'object' ? o.indice : {}, blob, creato: o.creato || head.creato || null };
  }
  /** Importa i blob di un backup nell'archivio (cifrati con la chiave locale). L'indice lo unisce il renderer. */
  async function importaBackup(buf, password) {
    richiediSbloccato();
    const b = leggiBackup(buf, password);
    for (const [id, dati] of b.blob) await scriviBlob(id, dati);
    return { indice: b.indice, creato: b.creato, elementi: b.blob.size };
  }

  /** Archivio illeggibile: lo si mette da parte (mai cancellato) e se ne crea uno nuovo. */
  async function azzera() {
    const dest = `${dir}-illeggibile-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    try { await fsp.rename(dir, dest); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    dek?.fill(0); dek = null; info = null; ripristinato = false;
    await inizializza();
    log('warn', 'archivio personale illeggibile messo da parte', { dest });
    return { ...stato(), messoDaParte: dest };
  }

  return {
    percorsi: P,
    inizializza: () => inCoda(inizializza),
    stato,
    sblocca: (pw) => inCoda(() => sblocca(pw)),
    blocca: () => inCoda(async () => blocca()),
    impostaPassword: (a, n) => inCoda(() => impostaPassword(a, n)),
    leggiIndice: () => inCoda(leggiIndice),
    salvaIndice: (i, o) => inCoda(() => salvaIndice(i, o)),
    leggiBlob: (id) => inCoda(() => leggiBlob(id)),
    scriviBlob: (id, d) => inCoda(() => scriviBlob(id, d)),
    cancellaBlob: (id) => inCoda(async () => { controllaId(id); return cancellaBlob(id); }),
    pulisciBlob: (o) => inCoda(() => pulisciBlob(o)),
    esportaBackup: (pw) => inCoda(() => esportaBackup(pw)),
    leggiBackup,
    importaBackup: (buf, pw) => inCoda(() => importaBackup(buf, pw)),
    azzera: () => inCoda(azzera),
  };
}

module.exports = { createCassaforte, ErroreArchivio, sistemaDisponibile, blobUsati, cifra, decifra, MIN_PASSWORD, ID_RE };
