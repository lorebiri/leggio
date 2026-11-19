// Assistente IA — download dei componenti (motore e modelli) con ripresa e verifica SHA-256.
// Il file si scarica in «.part»; se il download si interrompe, riparte da dove era (richiesta Range).
// Solo quando dimensione e impronta SHA-256 corrispondono il file prende il nome definitivo.
// fetchFn: nell'app è net.fetch di Electron (usa il proxy di sistema dell'ufficio); nei test il fetch di Node.
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const crypto = require('node:crypto');
const path = require('node:path');

/** Host da cui si accettano i download (anche dopo i reindirizzamenti verso le CDN). */
const HOST_AMMESSI = [/^github\.com$/, /^objects\.githubusercontent\.com$/, /^release-assets\.githubusercontent\.com$/,
  /^huggingface\.co$/, /(^|\.)hf\.co$/, /(^|\.)huggingface\.co$/, /(^|\.)xethub\.hf\.co$/];

function hostAmmesso(url, extra = []) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' && !(extra.length && u.protocol === 'http:')) return false;
    return [...HOST_AMMESSI, ...extra].some((re) => re.test(u.hostname));
  } catch { return false; }
}

async function impronta(file) {
  const h = crypto.createHash('sha256');
  await new Promise((ok, ko) => fs.createReadStream(file).on('data', (d) => h.update(d)).on('end', ok).on('error', ko));
  return h.digest('hex');
}

class ErroreDownload extends Error {
  constructor(msg, codice) { super(msg); this.codice = codice; }
}

/**
 * Scarica url in dest verificando dimensione e SHA-256.
 * opts: { sha256, byte, fetchFn, onProgress({ fatti, totale }), signal, hostExtra: [RegExp] }
 */
async function scarica(url, dest, { sha256, byte, fetchFn = globalThis.fetch, onProgress, signal, hostExtra = [] } = {}) {
  if (!/^[0-9a-f]{64}$/.test(sha256 || '')) throw new ErroreDownload('Impronta SHA-256 mancante: download rifiutato.', 'impronta');
  if (!hostAmmesso(url, hostExtra)) throw new ErroreDownload('Indirizzo di download non ammesso.', 'host');
  await fsp.mkdir(path.dirname(dest), { recursive: true });
  const part = dest + '.part';
  let gia = 0;
  try { gia = (await fsp.stat(part)).size; } catch { gia = 0; }
  if (byte && gia > byte) { await fsp.rm(part, { force: true }); gia = 0; }
  if (!(byte && gia === byte)) {
    const headers = gia > 0 ? { Range: `bytes=${gia}-` } : {};
    let res;
    try { res = await fetchFn(url, { headers, signal, redirect: 'follow' }); }
    catch (e) {
      if (signal?.aborted) throw new ErroreDownload('Download interrotto.', 'annullato');
      throw new ErroreDownload('Rete non raggiungibile: controlla la connessione o il proxy dell\'ufficio. ' + (e?.message || ''), 'rete');
    }
    if (res.url && !hostAmmesso(res.url, hostExtra)) throw new ErroreDownload('Il download è stato reindirizzato verso un indirizzo non ammesso.', 'host');
    if (res.status === 416 && byte && gia === byte) { /* già completo */ }
    else {
      if (!(res.status === 200 || res.status === 206)) throw new ErroreDownload(`Il server ha risposto ${res.status}.`, 'http');
      if (res.status === 200 && gia > 0) gia = 0; // il server non riprende: si ricomincia
      const totale = byte || (Number(res.headers.get('content-length')) || 0) + gia;
      const out = fs.createWriteStream(part, { flags: gia > 0 ? 'a' : 'w' });
      let fatti = gia; let ultimo = 0;
      try {
        const reader = res.body.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          fatti += value.length;
          if (byte && fatti > byte) throw new ErroreDownload('Il file scaricato è più grande del previsto.', 'dimensione');
          if (!out.write(value)) await new Promise((r) => out.once('drain', r));
          const ora = Date.now();
          if (onProgress && ora - ultimo > 250) { ultimo = ora; onProgress({ fatti, totale }); }
        }
      } catch (e) {
        out.destroy();
        if (signal?.aborted) throw new ErroreDownload('Download interrotto: riprendendo, ripartirà da dove era arrivato.', 'annullato');
        if (e instanceof ErroreDownload) { await fsp.rm(part, { force: true }); throw e; }
        throw new ErroreDownload('Download interrotto (' + (e?.message || 'rete') + '). Riprova: ripartirà da dove era arrivato.', 'rete');
      }
      await new Promise((ok, ko) => out.end((e) => (e ? ko(e) : ok())));
      onProgress?.({ fatti, totale });
    }
  }
  const st = await fsp.stat(part);
  if (byte && st.size !== byte) throw new ErroreDownload('Download incompleto: riprova.', 'dimensione');
  const h = await impronta(part);
  if (h !== sha256) {
    await fsp.rm(part, { force: true });
    throw new ErroreDownload('Il file scaricato non corrisponde all\'impronta attesa ed è stato cancellato.', 'impronta');
  }
  await fsp.rename(part, dest);
  return { file: dest, sha256: h, byte: st.size };
}

/** Copia un file scelto dall'utente (chiavetta, cartella di rete) dopo averne verificato dimensione e impronta. */
async function importa(origine, dest, { sha256, byte }) {
  const st = await fsp.stat(origine);
  if (byte && st.size !== byte) throw new ErroreDownload('Questo file non è quello atteso (dimensione diversa).', 'dimensione');
  const h = await impronta(origine);
  if (h !== sha256) throw new ErroreDownload('Questo file non è quello atteso (impronta SHA-256 diversa).', 'impronta');
  await fsp.mkdir(path.dirname(dest), { recursive: true });
  const tmp = dest + '.part';
  await fsp.copyFile(origine, tmp);
  if ((await impronta(tmp)) !== sha256) { await fsp.rm(tmp, { force: true }); throw new ErroreDownload('Copia non riuscita: riprova.', 'impronta'); }
  await fsp.rename(tmp, dest);
  return { file: dest, sha256: h, byte: st.size };
}

module.exports = { scarica, importa, impronta, hostAmmesso, ErroreDownload };
