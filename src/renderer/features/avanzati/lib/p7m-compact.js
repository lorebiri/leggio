// Le viste (subarray) su un buffer grande, se clonate, copierebbero tutto il file: le rendiamo indipendenti.
const own = (u8) => (u8 && (u8.byteOffset !== 0 || u8.byteLength !== u8.buffer.byteLength) ? u8.slice() : u8);
export function compactResult(r) {
  r.content = own(r.content);
  const fixSigner = (s) => { if (s.certificate) s.certificate.der = own(s.certificate.der); s.counterSigners?.forEach(fixSigner); };
  for (const l of r.levels) { l.certificates?.forEach((c) => { c.der = own(c.der); }); l.signers.forEach(fixSigner); }
  return r;
}
