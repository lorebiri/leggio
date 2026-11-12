// Riconoscimento veloce dei PDF firmati digitalmente (PAdES / firme PDF classiche).
// Una firma vera è un dizionario con /ByteRange e /Contents (il valore /V di un campo /FT /Sig):
// lo cerchiamo nei byte, a blocchi, senza analizzare tutto il documento. I dizionari di firma
// non possono stare negli object stream (devono essere diretti per calcolare il ByteRange).
// Un campo firma vuoto (da firmare) non ha /ByteRange e non conta come firmato.

const CHUNK = 8 * 1024 * 1024;
const dec = typeof TextDecoder !== 'undefined' ? new TextDecoder('latin1') : null;

/** @param {Uint8Array} bytes */
export function isSignedPdf(bytes) {
  if (!bytes?.length || !dec) return false;
  // a blocchi da 8 MB con 64 byte di sovrapposizione; la ricerca nativa nelle stringhe è molto veloce
  for (let off = 0; off < bytes.length; off += CHUNK) {
    const str = dec.decode(bytes.subarray(off, Math.min(bytes.length, off + CHUNK + 64)));
    let i = str.indexOf('/ByteRange');
    while (i !== -1) {
      if (/^\/ByteRange\s*\[/.test(str.slice(i, i + 40))) return true;
      i = str.indexOf('/ByteRange', i + 10);
    }
  }
  return false;
}
