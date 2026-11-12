// Riconoscimento veloce dei PDF firmati digitalmente (PAdES / firme PDF classiche).
// Una firma vera è un dizionario con /ByteRange e /Contents (il valore /V di un campo /FT /Sig):
// lo cerchiamo nei byte, a blocchi, senza analizzare tutto il documento. I dizionari di firma
// non possono stare negli object stream (devono essere diretti per calcolare il ByteRange).
// Un campo firma vuoto (da firmare) non ha /ByteRange e non conta come firmato.

const NEEDLE = [0x2f, 0x42, 0x79, 0x74, 0x65, 0x52, 0x61, 0x6e, 0x67, 0x65]; // "/ByteRange"

/** @param {Uint8Array} bytes */
export function isSignedPdf(bytes) {
  if (!bytes?.length) return false;
  const n = NEEDLE.length;
  const first = NEEDLE[0];
  for (let i = bytes.indexOf(first); i !== -1 && i <= bytes.length - n; i = bytes.indexOf(first, i + 1)) {
    let k = 1;
    while (k < n && bytes[i + k] === NEEDLE[k]) k++;
    if (k === n) {
      // dopo /ByteRange deve venire un array di numeri: [0 123 456 789]
      let j = i + n;
      while (j < bytes.length && (bytes[j] === 0x20 || bytes[j] === 0x0a || bytes[j] === 0x0d || bytes[j] === 0x09)) j++;
      if (bytes[j] === 0x5b) return true;
    }
  }
  return false;
}
