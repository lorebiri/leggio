// Caricamento delle risorse statiche dell'app (funziona da http:// e da file:// nell'app Electron).
// fetch non supporta file:// in Chromium: si ripiega su XMLHttpRequest e, nell'app, sul processo main.

function xhr(url) {
  return new Promise((resolve, reject) => {
    const r = new XMLHttpRequest();
    r.open('GET', url, true);
    r.responseType = 'arraybuffer';
    r.onload = () => ((r.status === 200 || r.status === 0) && r.response && r.response.byteLength ? resolve(new Uint8Array(r.response)) : reject(new Error('HTTP ' + r.status)));
    r.onerror = () => reject(new Error('lettura non riuscita'));
    r.send();
  });
}

/** Byte di una risorsa. url: assoluto o relativo al documento. relPath: percorso dentro dist/ per il ripiego IPC. */
export async function caricaRisorsa(url, relPath) {
  const abs = new URL(url, document.baseURI).href;
  const errors = [];
  if (!abs.startsWith('file:')) {
    try {
      const r = await fetch(abs);
      if (r.ok) return new Uint8Array(await r.arrayBuffer());
      errors.push('HTTP ' + r.status);
    } catch (e) { errors.push(e.message); }
  }
  try { return await xhr(abs); } catch (e) { errors.push(e.message); }
  const native = window.leggio;
  if (native) {
    const rel = relPath || decodeURIComponent(abs.replace(new URL('./', document.baseURI).href, ''));
    try { return new Uint8Array(await native.invoke('feat:conversione:risorsa', rel)); } catch (e) { errors.push(e.message); }
  }
  throw new Error(`Risorsa non disponibile: ${url} (${errors.join('; ')})`);
}

const blobCache = new Map();
/** URL blob (in cache) di una risorsa. */
export async function blobRisorsa(url, type = 'application/octet-stream') {
  if (blobCache.has(url)) return blobCache.get(url);
  const p = caricaRisorsa(url).then((bytes) => URL.createObjectURL(new Blob([bytes], { type })));
  blobCache.set(url, p);
  p.catch(() => blobCache.delete(url));
  return p;
}
