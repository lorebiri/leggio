// Archivio personale cifrato di Leggio: firme, sigle, timbri, rubrica, modelli, registro degli utilizzi.
// Gira SOLO nel processo principale. Il renderer riceve i dati che gli servono, mai le chiavi.
//
// Struttura su disco (cartella dati dell'app, sottocartella «personale»):
//   chiave.json        chiave dati (DEK, 256 bit) protetta: dal sistema (safeStorage), da una password,
//                      oppure — ripiego documentato — solo dai permessi del file (vedi docs/aree/personale.md)
//   chiave.json.bak    copia di riserva identica di chiave.json (0.3.1): se chiave.json si rovina, la chiave
//                      si recupera da qui. È sempre la versione attuale, mai una password vecchia.
//   indice.dat         indice JSON cifrato (contatti, metadati delle firme, modelli, registro, profilo)
//   indice.dat.bak     versione precedente dell'indice (backup automatico dell'ultima versione)
//   blob/<id>.dat      immagini delle firme e dei timbri, PDF dei modelli: un file cifrato ciascuno
//
// Ogni file cifrato: "LGV1" + IV (12 byte) + tag (16 byte) + dati AES-256-GCM. I dati aggiuntivi
// autenticati (AAD) legano il contenuto al suo nome (un blob non può essere scambiato con un altro).
// Le scritture sono atomiche (temporaneo + fsync + verifica + rename: core/safe-write.cjs).
//
// Password: scrypt N=131072, r=8, p=1 (128 MB, ~0,3 s), calcolato in modo asincrono (pool di libuv) per non
// bloccare il processo principale e quindi l'interfaccia. Le chiavi della 0.3.0 (N=32768) vengono rafforzate
// al primo sblocco riuscito: la nuova chiave si verifica in memoria e si scrive in modo atomico; se la
// scrittura non riesce resta valida quella vecchia (l'archivio si apre sempre).
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
// scrypt: ~0,3 s su un PC d'ufficio, 128 MB di memoria (0.3.0: N=32768, ~70 ms, 32 MB)
const KDF = Object.freeze({ N: 131072, r: 8, p: 1 });
// parametri letti da file (chiave o backup): oltre questo si rifiuta, così un file manomesso non può far allocare
// memoria a piacere. I nostri (N=131072, r=8) usano ~128 MB: metà del limite.
const KDF_MAX_MEM = 256 * 1024 * 1024;
const MIN_PASSWORD = 8;
const MAX_PASSWORD = 1024;

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
/** Memoria che scrypt usa davvero (stesso conto di OpenSSL). */
const memoriaKdf = (k) => 128 * k.r * (k.N + k.p + 2);
/** Parametri scrypt letti da un file (chiave o backup): controllati, mai fidarsi. */
function paramsKdf(o, cosa = 'Chiave dell\'archivio') {
  const k = { N: num(o?.N, 1024, 1 << 20, cosa), r: num(o?.r, 1, 32, cosa), p: num(o?.p, 1, 16, cosa) };
  if ((k.N & (k.N - 1)) !== 0) throw new ErroreArchivio(`${cosa} non valida.`, 'danneggiato');
  // regola di scrypt: N < 2^(16·r) (altrimenti OpenSSL rifiuta con un errore poco chiaro)
  if (Math.log2(k.N) >= 16 * k.r) throw new ErroreArchivio(`${cosa}: protezione non supportata da questa versione di Leggio. Aggiorna Leggio.`, 'formato');
  if (memoriaKdf(k) > KDF_MAX_MEM) throw new ErroreArchivio(`${cosa}: protezione non supportata da questa versione di Leggio. Aggiorna Leggio.`, 'formato');
  return k;
}
/** La chiave è avvolta con parametri più deboli di quelli attuali (es. archivio della 0.3.0)? */
const kdfDebole = (k) => k.N * k.r * k.p < KDF.N * KDF.r * KDF.p;
/** scrypt asincrono: gira nel pool di libuv, il processo principale (e l'interfaccia) non si ferma. */
function derivaChiave(password, salt, params = KDF) {
  const k = paramsKdf(params);
  return new Promise((resolve, reject) => {
    const nonRiuscito = () => new ErroreArchivio('Impossibile verificare la password: memoria del computer insufficiente. Chiudi qualche programma e riprova.', 'memoria');
    try {
    crypto.scrypt(Buffer.from(String(password).normalize('NFC'), 'utf8'), salt, 32, { ...k, maxmem: memoriaKdf(k) + 32 * 1024 * 1024 }, (err, key) => {
      if (err) reject(new ErroreArchivio('Impossibile verificare la password: memoria del computer insufficiente. Chiudi qualche programma e riprova.', 'memoria'));
      else resolve(key);
    });
    } catch { reject(nonRiuscito()); } // parametri rifiutati subito da OpenSSL: mai un errore grezzo
  });
}
/** Avvolge la DEK con una password (e verifica subito che si svolga). → oggetto JSON */
async function avvolgiConPassword(dek, password, params = KDF) {
  const salt = crypto.randomBytes(16);
  const kek = await derivaChiave(password, salt, params);
  const box = cifra(kek, dek, 'leggio-dek');
  if (!decifra(kek, box, 'leggio-dek').equals(dek)) throw new ErroreArchivio('Verifica della nuova chiave non riuscita.', 'verifica');
  return { kdf: 'scrypt', ...params, salt: salt.toString('base64'), dati: box.toString('base64') };
}
async function svolgiConPassword(w, password) {
  if (!w || w.kdf !== 'scrypt' || typeof w.salt !== 'string' || typeof w.dati !== 'string') throw new ErroreArchivio('Chiave dell\'archivio non riconosciuta.', 'danneggiato');
  const kek = await derivaChiave(password, Buffer.from(w.salt, 'base64'), paramsKdf(w));
  let dek;
  try { dek = decifra(kek, Buffer.from(w.dati, 'base64'), 'leggio-dek'); }
  catch { throw new ErroreArchivio('Password errata.', 'password-errata'); }
  if (dek.length !== 32) throw new ErroreArchivio('Chiave dell\'archivio non valida.', 'danneggiato');
  return dek;
}
function num(v, min, max, cosa = 'Chiave dell\'archivio') { const n = Number(v); if (!Number.isInteger(n) || n < min || n > max) throw new ErroreArchivio(`${cosa} non valida.`, 'danneggiato'); return n; }

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
/** Errore di scrittura → messaggio per l'utente. L'originale resta sempre intatto (scrittura atomica). */
function erroreScrittura(err) {
  if (err instanceof ErroreArchivio) return err;
  const code = err?.code;
  if (code === 'ENOSPC' || code === 'EDQUOT') return new ErroreArchivio('Spazio su disco esaurito: l\'ultima modifica all\'archivio personale non è stata salvata. I dati salvati prima sono intatti. Libera spazio sul disco: Leggio riproverà da solo.', 'disco-pieno');
  if (['EACCES', 'EPERM', 'EROFS', 'EBUSY'].includes(code)) return new ErroreArchivio(`Leggio non riesce a scrivere nella cartella dell'archivio personale (${code}): l'ultima modifica non è stata salvata, i dati salvati prima sono intatti. Controlla che la cartella non sia in sola lettura o bloccata da un altro programma.`, 'scrittura');
  return new ErroreArchivio(`Salvataggio dell'archivio personale non riuscito (${code || err?.message || err}). I dati salvati prima sono intatti.`, 'scrittura');
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
function createCassaforte({ dir, safeStorage = null, platform = process.platform, log = () => {}, scrivi = safeWrite }) {
  const P = {
    chiave: path.join(dir, 'chiave.json'),
    chiaveBak: path.join(dir, 'chiave.json.bak'),
    indice: path.join(dir, 'indice.dat'),
    bak: path.join(dir, 'indice.dat.bak'),
    blob: path.join(dir, 'blob'),
  };
  let dek = null;            // chiave dati in memoria (solo da sbloccato)
  let info = null;           // contenuto di chiave.json
  let ripristinato = false;  // l'indice era danneggiato ed è stato letto dal backup
  let errori = 0;            // password sbagliate di fila (rallentamento)
  let pulizia = false;       // pulizia degli orfani già programmata in questa sessione
  let riserva = null;        // chiave.json.bak se diversa da chiave.json (ultima risorsa)
  let creatoOra = false;     // archivio creato in questa sessione
  let chiaveRecuperata = false; // chiave.json era danneggiato: ripristinato dalla copia di riserva
  let kdfRafforzato = false; // chiave della 0.3.0 rafforzata in questa sessione
  let coda = Promise.resolve();
  const inCoda = (fn) => { const r = coda.then(fn, fn); coda = r.catch(() => {}); return r; };

  async function scriviPrivato(p, buf) {
    try { await scrivi(p, buf); } catch (e) { throw erroreScrittura(e); }
    try { await fsp.chmod(p, 0o600); } catch { /* FAT, Windows: non essenziale */ }
  }
  async function assicuraCartelle() {
    try { await fsp.mkdir(P.blob, { recursive: true, mode: 0o700 }); } catch (e) { throw erroreScrittura(e); }
  }
  const infoValida = (b) => {
    if (!b) return null;
    try {
      const o = JSON.parse(b.toString('utf8'));
      if (o && o.formato === 'leggio-chiave' && o.versione === 1 && o.protetta && typeof o.protetta.metodo === 'string' && typeof o.protetta.dati === 'string') return o;
    } catch { /* sotto */ }
    return null;
  };
  /** Legge chiave.json; se è rovinato usa (e rimette a posto) la copia di riserva. */
  async function leggiInfo() {
    const main = await leggiSe(P.chiave);
    const bak = await leggiSe(P.chiaveBak);
    const o = infoValida(main); const ob = infoValida(bak);
    riserva = ob && !(main && bak.equals(main)) ? ob : null;
    if (o) return o;
    if (ob) {
      log('warn', 'chiave dell\'archivio personale danneggiata: uso la copia di riserva');
      chiaveRecuperata = true; riserva = null;
      try { await scriviPrivato(P.chiave, bak); } catch (e) { log('warn', 'chiave.json non ripristinato', { error: e.message }); }
      return ob;
    }
    if (main || bak) throw new ErroreArchivio('Il file della chiave dell\'archivio personale (chiave.json) è danneggiato e anche la sua copia di riserva. Senza la chiave i dati non si possono aprire. Puoi mettere da parte questo archivio (non viene cancellato) e ripristinare un backup esportato.', 'chiave-danneggiata');
    return null;
  }
  /** C'è già un archivio cifrato in questa cartella (anche senza chiave)? */
  async function datiPresenti() {
    if ((await leggiSe(P.indice)) || (await leggiSe(P.bak))) return true;
    try { return (await fsp.readdir(P.blob)).some((f) => f.endsWith('.dat')); } catch { return false; }
  }
  /** Tiene chiave.json.bak uguale a chiave.json (dopo un'apertura riuscita: la chiave è buona). */
  async function sincronizzaRiserva() {
    try {
      const m = await leggiSe(P.chiave); const b = await leggiSe(P.chiaveBak);
      if (m && infoValida(m) && !(b && b.equals(m))) await scriviPrivato(P.chiaveBak, m);
      riserva = null;
    } catch (e) {
      log('warn', 'copia di riserva della chiave non aggiornata', { error: e.message });
      // una copia diversa da chiave.json non deve restare (potrebbe avere una protezione vecchia)
      await fsp.rm(P.chiaveBak, { force: true }).catch(() => {});
    }
  }
  /** Protegge una stringa con il sistema (se disponibile). → { metodo, dati } */
  function proteggi(testo) {
    if (sistemaDisponibile(safeStorage, platform)) {
      // la si usa solo se si rilegge subito: una chiave che il portachiavi non sa riaprire non va mai scritta
      try {
        const dati = safeStorage.encryptString(testo).toString('base64');
        if (safeStorage.decryptString(Buffer.from(dati, 'base64')) === testo) return { metodo: 'sistema', dati };
      } catch { /* sotto */ }
      log('warn', 'il portachiavi del sistema non rilegge la chiave: uso la protezione di base');
    }
    return { metodo: 'file', dati: Buffer.from(testo, 'utf8').toString('base64') };
  }
  function sproteggi(p) {
    if (p.metodo === 'sistema') {
      if (!safeStorage) throw new ErroreArchivio('Protezione del sistema non disponibile.', 'sistema');
      try { return safeStorage.decryptString(Buffer.from(p.dati, 'base64')); }
      catch { throw new ErroreArchivio(`Il ${nomeSistema(platform)} non riesce ad aprire la chiave dell'archivio personale (è cambiato l'utente del computer o il portachiavi è stato azzerato?). I dati non sono stati toccati. Puoi riprovare dopo aver sbloccato il portachiavi, oppure mettere da parte questo archivio (non viene cancellato) e ripristinare un backup esportato.`, 'sistema'); }
    }
    if (p.metodo === 'file') return Buffer.from(p.dati, 'base64').toString('utf8');
    throw new ErroreArchivio('Metodo di protezione sconosciuto.', 'danneggiato');
  }
  /** Toglie la copia di riserva. Se non si riesce a toglierla si lancia l'errore (e nulla viene cambiato). */
  async function togliRiserva() {
    try { await fsp.rm(P.chiaveBak, { force: true }); } catch (e) { throw erroreScrittura(e); }
  }
  /**
   * Scrive chiave.json (atomico) e poi la copia di riserva identica. La copia vecchia si toglie PRIMA: così non
   * può mai restare una copia con una protezione vecchia (una password cambiata, la chiave in chiaro di prima
   * della password), nemmeno se la scrittura si interrompe o il computer si spegne a metà. Nel frattempo
   * chiave.json resta valido (la scrittura è atomica): l'archivio si apre sempre.
   * opzioni.daRiserva: si sta ricopiando proprio la copia di riserva su chiave.json rovinato: la copia NON si
   * toglie (è l'unica buona).
   */
  async function scriviInfo(nuovo, { daRiserva = false } = {}) {
    const buf = Buffer.from(JSON.stringify(nuovo, null, 1), 'utf8');
    if (!daRiserva) await togliRiserva();
    riserva = null;
    await scriviPrivato(P.chiave, buf);
    info = nuovo;
    if (daRiserva) return; // la copia è già identica
    try { await scriviPrivato(P.chiaveBak, buf); }
    catch (e) {
      log('warn', 'copia di riserva della chiave non scritta', { error: e.message });
      await fsp.rm(P.chiaveBak, { force: true }).catch(() => {});
    }
  }
  /** Nuovo contenuto di chiave.json, verificato: deve restituire la stessa chiave dati prima di essere scritto. */
  async function infoDaDek(chiaveDati, password) {
    const testo = password ? JSON.stringify(await avvolgiConPassword(chiaveDati, password)) : chiaveDati.toString('base64');
    const protetta = proteggi(testo);
    if (sproteggi(protetta) !== testo) throw new ErroreArchivio('Verifica della nuova chiave non riuscita: nulla è stato cambiato.', 'verifica');
    return { formato: 'leggio-chiave', versione: 1, password: !!password, protetta };
  }
  function leggiAvvolta(inf) {
    try { return JSON.parse(sproteggi(inf.protetta)); }
    catch (e) { if (e instanceof ErroreArchivio) throw e; throw new ErroreArchivio('Chiave dell\'archivio danneggiata.', 'danneggiato'); }
  }
  function dekSenzaPassword(inf) {
    const d = Buffer.from(sproteggi(inf.protetta), 'base64');
    if (d.length !== 32) throw new ErroreArchivio('Il file della chiave dell\'archivio personale è danneggiato.', 'chiave-danneggiata');
    return d;
  }

  async function inizializza() {
    if (info && dek) return;
    await assicuraCartelle();
    info = await leggiInfo();
    if (!info) {
      // dati cifrati senza chiave: MAI crearne una nuova sopra (si perderebbe la possibilità di recuperarli)
      if (await datiPresenti()) throw new ErroreArchivio('Manca il file della chiave dell\'archivio personale (chiave.json), ma i dati cifrati ci sono ancora: senza la chiave non si possono aprire. Se hai una copia della cartella rimetti chiave.json al suo posto; altrimenti puoi mettere da parte questo archivio (non viene cancellato) e ripristinare un backup esportato.', 'chiave-mancante');
      const nuova = crypto.randomBytes(32);
      await scriviInfo(await infoDaDek(nuova, null));
      dek = nuova; creatoOra = true;
      log('info', 'archivio personale creato', { metodo: info.protetta.metodo });
      return;
    }
    if (!info.password && !dek) {
      try { dek = dekSenzaPassword(info); }
      catch (e) {
        // chiave.json leggibile ma il contenuto non si apre: si prova la copia di riserva, se è diversa
        if (!riserva || riserva.password) throw e;
        try { dek = dekSenzaPassword(riserva); } catch { throw e; }
        log('warn', 'chiave dell\'archivio personale illeggibile: usata la copia di riserva');
        chiaveRecuperata = true;
        try { await scriviInfo(riserva, { daRiserva: true }); } catch (e2) { log('warn', 'chiave.json non ripristinato', { error: e2.message }); }
      }
      // il sistema ora offre una protezione migliore del ripiego: si passa a quella, senza chiedere nulla
      if (info.protetta.metodo === 'file' && sistemaDisponibile(safeStorage, platform)) {
        try { const n = await infoDaDek(dek, null); if (n.protetta.metodo === 'sistema') { await scriviInfo(n); log('info', 'chiave dell\'archivio personale ora protetta dal sistema'); } }
        catch (e) { log('warn', 'passaggio alla protezione del sistema rimandato', { error: e.message }); }
      }
      await sincronizzaRiserva();
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
      // senza portachiavi e senza password l'archivio è protetto solo dai permessi del file: l'interfaccia avvisa
      avvisoPortachiavi: metodo === 'file' && !info?.password,
      creatoOra,
      chiaveRecuperata,
      kdfRafforzato,
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
    try { w = leggiAvvolta(info); }
    catch (e) {
      // contenuto di chiave.json illeggibile: si prova la copia di riserva (mai per una password sbagliata:
      // la riserva potrebbe essere di un attimo prima di un cambio di password)
      if (!riserva?.password) throw e;
      try { w = leggiAvvolta(riserva); } catch { throw e; }
      const k = await svolgiConPassword(w, password).catch((e2) => { errori++; throw e2; });
      log('warn', 'chiave dell\'archivio personale illeggibile: usata la copia di riserva');
      chiaveRecuperata = true;
      try { await scriviInfo(riserva, { daRiserva: true }); } catch (e2) { log('warn', 'chiave.json non ripristinato', { error: e2.message }); }
      dek = k;
    }
    if (!dek) {
      try { dek = await svolgiConPassword(w, password); }
      catch (e) { errori++; throw e; }
    }
    errori = 0;
    if (kdfDebole(paramsKdf(w))) await rafforza(password);
    else if (info.protetta.metodo === 'file' && sistemaDisponibile(safeStorage, platform)) {
      try { const n = await infoDaDek(dek, password); if (n.protetta.metodo === 'sistema') await scriviInfo(n); } catch (e) { log('warn', 'passaggio alla protezione del sistema rimandato', { error: e.message }); }
    }
    await sincronizzaRiserva();
    programmaPulizia();
    return stato();
  }
  /**
   * Chiave della 0.3.0 (scrypt N=32768): la si riavvolge con i parametri attuali. La nuova chiave è verificata
   * prima di scriverla e la scrittura è atomica; se qualcosa va storto si tiene quella vecchia (che continua
   * ad aprirsi) e si riprova al prossimo sblocco. Non fa mai fallire lo sblocco.
   */
  async function rafforza(password) {
    try {
      await scriviInfo(await infoDaDek(dek, password));
      kdfRafforzato = true;
      log('info', 'chiave dell\'archivio personale rafforzata', { N: KDF.N });
    } catch (e) { log('warn', 'rafforzamento della chiave rimandato', { error: e.message }); }
  }
  function blocca() { if (info?.password) { dek?.fill(0); dek = null; } return stato(); }

  async function impostaPassword(attuale, nuova) {
    if (!info) await inizializza();
    if (nuova) {
      if (typeof nuova !== 'string' || nuova.length < MIN_PASSWORD) throw new ErroreArchivio(`La password deve avere almeno ${MIN_PASSWORD} caratteri.`, 'argomenti');
      if (nuova.length > MAX_PASSWORD) throw new ErroreArchivio('Password troppo lunga.', 'argomenti');
    }
    if (info.password) {
      // verifica della password attuale anche da sbloccato
      dek = await svolgiConPassword(leggiAvvolta(info), String(attuale || ''));
    } else richiediSbloccato();
    await scriviInfo(await infoDaDek(dek, nuova || null));
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
  /**
   * File di backup portabile: TUTTO l'archivio (indice, immagini di firme e timbri, PDF dei modelli), compresso e
   * cifrato con una password scelta all'esportazione (le chiavi del sistema non viaggiano). Prima di restituirlo
   * lo si riapre con la stessa password e si controlla che contenga tutto.
   * → { dati: Buffer, elementi, mancanti: [id] }  (mancanti: elementi citati dall'indice ma illeggibili)
   */
  async function esportaBackup(password) {
    richiediSbloccato();
    if (typeof password !== 'string' || password.length < MIN_PASSWORD) throw new ErroreArchivio(`Scegli una password di almeno ${MIN_PASSWORD} caratteri per il file di backup.`, 'argomenti');
    if (password.length > MAX_PASSWORD) throw new ErroreArchivio('Password troppo lunga.', 'argomenti');
    const indice = (await leggiIndice()) || {};
    const blob = {}; const mancanti = [];
    for (const id of blobUsati(indice)) {
      try { blob[id] = (await leggiBlob(id)).toString('base64'); }
      catch (e) { mancanti.push(id); log('warn', 'backup: elemento mancante', { id, error: e.message }); }
    }
    const creato = new Date().toISOString();
    const payload = zlib.gzipSync(Buffer.from(JSON.stringify({ formato: 'leggio-archivio-personale', versione: 1, creato, indice, blob, mancanti }), 'utf8'));
    const salt = crypto.randomBytes(16);
    const key = await derivaChiave(password, salt);
    const head = { formato: 'leggio-backup', versione: 1, kdf: 'scrypt', ...KDF, salt: salt.toString('base64'), creato };
    const dati = Buffer.concat([Buffer.from(BACKUP_MAGIC + JSON.stringify(head) + '\n', 'utf8'), cifra(key, payload, 'leggio-backup')]);
    // verifica: si riapre con la password scelta e contiene esattamente quello che c'è nell'archivio
    const prova = await leggiBackup(dati, password);
    const n = Object.keys(blob).length;
    if (prova.blob.size !== n || JSON.stringify(prova.indice) !== JSON.stringify(indice) || [...prova.blob].some(([id, b]) => b.toString('base64') !== blob[id])) {
      throw new ErroreArchivio('Verifica del file di backup non riuscita: il backup non è stato salvato. Riprova.', 'backup');
    }
    return { dati, elementi: n, mancanti };
  }
  /** Legge un file di backup. → { indice, blob: Map(id → Buffer), creato, mancanti } (non scrive nulla) */
  async function leggiBackup(buf, password) {
    buf = comeBuffer(buf, MAX_BACKUP, 'File di backup');
    const s = buf.subarray(0, Math.min(buf.length, 4096)).toString('utf8');
    if (!s.startsWith(BACKUP_MAGIC)) throw new ErroreArchivio('Il file scelto non è un backup dell\'archivio personale di Leggio.', 'formato');
    const nl = s.indexOf('\n', BACKUP_MAGIC.length);
    if (nl < 0) throw new ErroreArchivio('File di backup danneggiato.', 'formato');
    let head;
    try { head = JSON.parse(s.slice(BACKUP_MAGIC.length, nl)); } catch { throw new ErroreArchivio('File di backup danneggiato.', 'formato'); }
    if (head.formato !== 'leggio-backup' || head.versione !== 1 || head.kdf !== 'scrypt' || typeof head.salt !== 'string') throw new ErroreArchivio('Versione del file di backup non supportata: aggiorna Leggio.', 'formato');
    const offset = Buffer.byteLength(s.slice(0, nl + 1), 'utf8');
    const key = await derivaChiave(String(password || ''), Buffer.from(head.salt, 'base64'), paramsKdf(head, 'File di backup'));
    let payload;
    try { payload = decifra(key, buf.subarray(offset), 'leggio-backup'); }
    catch { throw new ErroreArchivio('Password del backup errata, oppure il file è danneggiato.', 'password-errata'); }
    let o;
    try { o = JSON.parse(zlib.gunzipSync(payload, { maxOutputLength: 2 * MAX_BACKUP }).toString('utf8')); }
    catch { throw new ErroreArchivio('Contenuto del backup danneggiato.', 'formato'); }
    if (!o || o.formato !== 'leggio-archivio-personale') throw new ErroreArchivio('Contenuto del backup non riconosciuto.', 'formato');
    const blob = new Map();
    for (const [id, b64] of Object.entries(o.blob || {})) if (ID_RE.test(id) && typeof b64 === 'string') blob.set(id, Buffer.from(b64, 'base64'));
    const mancanti = Array.isArray(o.mancanti) ? o.mancanti.filter((x) => typeof x === 'string' && ID_RE.test(x)) : [];
    return { indice: o.indice && typeof o.indice === 'object' ? o.indice : {}, blob, creato: o.creato || head.creato || null, mancanti };
  }
  /** Importa i blob di un backup nell'archivio (cifrati con la chiave locale). L'indice lo unisce il renderer. */
  async function importaBackup(buf, password) {
    richiediSbloccato();
    const b = await leggiBackup(buf, password);
    for (const [id, dati] of b.blob) await scriviBlob(id, dati);
    return { indice: b.indice, creato: b.creato, elementi: b.blob.size, mancanti: b.mancanti.length };
  }

  /** Archivio illeggibile: lo si mette da parte (mai cancellato) e se ne crea uno nuovo. */
  async function azzera() {
    const dest = `${dir}-illeggibile-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    try { await fsp.rename(dir, dest); }
    catch (e) { if (e.code !== 'ENOENT') throw new ErroreArchivio(`Non riesco a mettere da parte l'archivio (${e.code || e.message}): forse un altro programma sta usando la cartella. Chiudi gli altri programmi e riprova. Nulla è stato cancellato.`, 'scrittura'); }
    dek?.fill(0); dek = null; info = null; ripristinato = false; riserva = null; chiaveRecuperata = false; kdfRafforzato = false; errori = 0;
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

module.exports = { createCassaforte, ErroreArchivio, sistemaDisponibile, blobUsati, cifra, decifra, derivaChiave, KDF, MIN_PASSWORD, ID_RE };
