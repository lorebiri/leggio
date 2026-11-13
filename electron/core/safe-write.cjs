// Scrittura sicura di un file: l'originale non viene mai lasciato a metà.
//
// 1. si scrive un file temporaneo nella stessa cartella (stesso disco → rename atomico), con fsync;
// 2. si rilegge il temporaneo e lo si confronta byte per byte con quanto voluto
//    (scopre chiavette difettose, dischi di rete e cartelle sincronizzate che troncano);
// 3. si sostituisce l'originale con rename. Su Windows rename su un file aperto da un altro
//    programma (antivirus, OneDrive, anteprima di Esplora risorse) può fallire con EPERM/EBUSY:
//    si riprova con attese crescenti; se non basta si copia il contenuto sopra l'originale
//    dopo averne fatto una copia di riserva, si verifica, e solo allora si elimina la riserva.
// In ogni caso di errore l'originale resta intatto (o viene ripristinato dalla riserva) e
// l'errore porta un messaggio comprensibile (err.userMessage).
const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');
const crypto = require('node:crypto');

const MAX_BYTES = 2 * 1024 * 1024 * 1024 - 1;
const RETRY_CODES = new Set(['EPERM', 'EBUSY', 'EACCES', 'EAGAIN', 'UNKNOWN']);

function friendly(err, target, phase) {
  const name = path.basename(target);
  const dir = path.dirname(target);
  const map = {
    ENOSPC: `Spazio su disco esaurito: «${name}» non è stato salvato. Libera spazio o salva altrove con «Salva con nome».`,
    EDQUOT: `Hai superato lo spazio disponibile: «${name}» non è stato salvato. Libera spazio o salva altrove.`,
    EACCES: `Non hai i permessi per scrivere in «${dir}». Salva in un'altra cartella con «Salva con nome».`,
    EPERM: `Il file «${name}» è bloccato (forse è aperto in un altro programma, è in sola lettura o la cartella è protetta). Chiudi gli altri programmi o usa «Salva con nome».`,
    EBUSY: `Il file «${name}» è in uso da un altro programma. Chiudilo e riprova, oppure usa «Salva con nome».`,
    EROFS: `Il disco di «${name}» è di sola lettura. Salva in un'altra posizione.`,
    ENOENT: `La cartella «${dir}» non è più raggiungibile (chiavetta scollegata, disco di rete disconnesso o cartella eliminata). Ricollegala oppure usa «Salva con nome».`,
    ENOTDIR: `Il percorso «${dir}» non è una cartella valida.`,
    EIO: `Errore di lettura/scrittura del disco salvando «${name}». Se è una chiavetta o un disco di rete, controlla il collegamento e riprova.`,
    ENAMETOOLONG: `Il percorso di «${name}» è troppo lungo. Scegli una cartella più vicina alla radice o un nome più corto.`,
    EMFILE: 'Troppi file aperti: chiudi qualche documento e riprova.',
    ETIMEDOUT: `Il disco di rete non risponde: «${name}» non è stato salvato. Riprova o salva in locale.`,
  };
  const msg = map[err.code] || `Salvataggio di «${name}» non riuscito (${err.code || err.message}).`;
  const e = new Error(msg);
  e.code = err.code; e.userMessage = msg; e.phase = phase; e.cause = err;
  return e;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function retry(fn, { tries = 6, base = 60 } = {}) {
  let last;
  for (let i = 0; i < tries; i++) {
    try { return await fn(); } catch (err) {
      last = err;
      if (!RETRY_CODES.has(err.code)) throw err;
      if (i < tries - 1) await sleep(base * 2 ** i); // 60, 120, 240, 480, 960 ms (niente attesa dopo l'ultimo tentativo)
    }
  }
  throw last;
}

/** Inizio comune dei temporanei di un file: il nome è accorciato (in byte) perché il temporaneo
 *  non superi i 255 byte ammessi per un nome di file (prima i nomi oltre ~234 byte non si salvavano). */
function tempPrefix(target) {
  let base = '';
  for (const ch of Array.from(path.basename(target))) {
    if (Buffer.byteLength(base + ch) > 200) break;
    base += ch;
  }
  return '.' + base + '.';
}
const tempName = (target) => `${tempPrefix(target)}${crypto.randomBytes(4).toString('hex')}.leggio-tmp`;

async function writeAndSync(file, data) {
  const fh = await fsp.open(file, 'wx', 0o644);
  try {
    let off = 0;
    const CH = 16 * 1024 * 1024;
    while (off < data.length) {
      const { bytesWritten } = await fh.write(data, off, Math.min(CH, data.length - off));
      if (bytesWritten <= 0) throw Object.assign(new Error('scrittura interrotta'), { code: 'EIO' });
      off += bytesWritten;
    }
    await fh.sync();
  } finally { await fh.close(); }
}

/** Confronta il contenuto di file con data (a blocchi, senza caricare tutto). */
async function sameContent(file, data) {
  const st = await fsp.stat(file);
  if (st.size !== data.length) return false;
  const fh = await fsp.open(file, 'r');
  try {
    const CH = 8 * 1024 * 1024; const buf = Buffer.allocUnsafe(Math.min(CH, Math.max(1, data.length)));
    let off = 0;
    while (off < data.length) {
      const n = Math.min(CH, data.length - off);
      const { bytesRead } = await fh.read(buf, 0, n, off);
      if (bytesRead !== n) return false;
      if (Buffer.compare(buf.subarray(0, n), data.subarray(off, off + n)) !== 0) return false;
      off += n;
    }
    return true;
  } finally { await fh.close(); }
}

/**
 * Scrive data in target in modo sicuro.
 * @param {string} target percorso assoluto
 * @param {Uint8Array|Buffer} bytes
 * @param {{ verify?: boolean, onStep?: (s:string)=>void }} [opts]
 * @returns {Promise<{ path: string, strategy: 'rename'|'copy'|'new' }>}
 */
async function safeWrite(target, bytes, opts = {}) {
  const verify = opts.verify !== false;
  const step = opts.onStep || (() => {});
  if (typeof target !== 'string' || !path.isAbsolute(target)) throw friendly(Object.assign(new Error('percorso non valido'), { code: 'EINVAL' }), String(target), 'check');
  const data = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (data.length > MAX_BYTES) {
    const e = new Error('Il file supera i 2 GB: Leggio non può salvarlo. Riduci le immagini o dividi il documento.');
    e.userMessage = e.message; e.code = 'EFBIG'; throw e;
  }
  // un collegamento simbolico si aggiorna nel file a cui punta (il rename lo sostituirebbe con un file
  // normale lasciando vecchio l'originale)
  try { if ((await fsp.lstat(target)).isSymbolicLink()) target = await fsp.realpath(target); } catch { /* non esiste ancora */ }
  const dir = path.dirname(target);
  try { const st = await fsp.stat(dir); if (!st.isDirectory()) throw Object.assign(new Error('non è una cartella'), { code: 'ENOTDIR' }); }
  catch (err) { throw friendly(err, target, 'check'); }

  let existing = null;
  try { existing = await fsp.stat(target); } catch (err) { if (err.code !== 'ENOENT') throw friendly(err, target, 'check'); }
  if (existing && existing.isDirectory()) throw friendly(Object.assign(new Error(), { code: 'EISDIR' }), target, 'check');

  const tmp = path.join(dir, tempName(target));
  const cleanupTmp = () => fsp.unlink(tmp).catch(() => {});
  // 1. temporaneo
  step('tmp');
  try { await writeAndSync(tmp, data); }
  catch (err) { await cleanupTmp(); throw friendly(err, target, 'write'); }
  // 2. verifica del temporaneo
  if (verify) {
    step('verify');
    let ok = false;
    try { ok = await sameContent(tmp, data); } catch (err) { await cleanupTmp(); throw friendly(err, target, 'verify'); }
    if (!ok) { await cleanupTmp(); throw friendly(Object.assign(new Error(), { code: 'EIO' }), target, 'verify'); }
  }
  // conserva i permessi dell'originale
  if (existing) { try { await fsp.chmod(tmp, existing.mode & 0o7777); } catch { /* non essenziale (FAT, rete) */ } }
  // 3a. sostituzione atomica
  step('rename');
  try {
    await retry(() => fsp.rename(tmp, target), { tries: opts.renameTries ?? 6 });
    return { path: target, strategy: existing ? 'rename' : 'new' };
  } catch (renameErr) {
    if (!existing || !RETRY_CODES.has(renameErr.code)) { await cleanupTmp(); throw friendly(renameErr, target, 'rename'); }
  }
  // 3b. ripiego: copia di riserva + copia sopra l'originale + verifica
  step('fallback');
  const bak = target + '.leggio-bak';
  try { await retry(() => fsp.copyFile(target, bak)); }
  catch (err) { await cleanupTmp(); throw friendly(err, target, 'backup'); }
  try {
    await retry(() => fsp.copyFile(tmp, target));
    if (verify && !(await sameContent(target, data))) throw Object.assign(new Error('verifica fallita'), { code: 'EIO' });
  } catch (err) {
    // ripristino dell'originale dalla riserva
    let restored = false;
    try { await retry(() => fsp.copyFile(bak, target)); restored = true; } catch { /* resta la riserva */ }
    await cleanupTmp();
    const e = friendly(err, target, 'copy');
    if (restored) await fsp.unlink(bak).catch(() => {});
    else { e.userMessage = e.message = `${e.message} L'originale è conservato in «${bak}».`; }
    throw e;
  }
  await cleanupTmp();
  await fsp.unlink(bak).catch(() => {});
  return { path: target, strategy: 'copy' };
}

/** Elimina temporanei rimasti da salvataggi interrotti accanto a un file (best effort). */
async function cleanStaleTemps(target) {
  try {
    const dir = path.dirname(target); const base = tempPrefix(target);
    for (const f of await fsp.readdir(dir)) if (f.startsWith(base) && f.endsWith('.leggio-tmp')) await fsp.unlink(path.join(dir, f)).catch(() => {});
  } catch { /* cartella non leggibile */ }
}

module.exports = { safeWrite, friendly, cleanStaleTemps, tempName, MAX_BYTES, sameContent };
