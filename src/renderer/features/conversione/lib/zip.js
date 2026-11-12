// Archivio ZIP minimo (metodo "store", senza compressione) per scrivere xlsx, pptx e odt
// senza dipendenze. I contenuti grandi (immagini) sono già compressi; l'XML pesa poco.

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const enc = new TextEncoder();

/**
 * Crea uno ZIP. files: [{ name, data: Uint8Array|string }] (l'ordine è conservato:
 * per ODT il primo file deve essere "mimetype").
 */
export function zip(files, date = new Date()) {
  const dosTime = ((date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1)) & 0xffff;
  const dosDate = (((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()) & 0xffff;
  const entries = files.map((f) => {
    const name = enc.encode(f.name);
    const data = typeof f.data === 'string' ? enc.encode(f.data) : f.data;
    return { name, data, crc: crc32(data) };
  });
  let size = 22;
  for (const e of entries) size += 30 + e.name.length + e.data.length + 46 + e.name.length;
  if (size > 0xffffffff) throw new Error('Archivio troppo grande');
  const out = new Uint8Array(size);
  const dv = new DataView(out.buffer);
  let p = 0;
  const offsets = [];
  for (const e of entries) {
    offsets.push(p);
    dv.setUint32(p, 0x04034b50, true); dv.setUint16(p + 4, 20, true); dv.setUint16(p + 6, 0x0800, true); // UTF-8
    dv.setUint16(p + 8, 0, true); dv.setUint16(p + 10, dosTime, true); dv.setUint16(p + 12, dosDate, true);
    dv.setUint32(p + 14, e.crc, true); dv.setUint32(p + 18, e.data.length, true); dv.setUint32(p + 22, e.data.length, true);
    dv.setUint16(p + 26, e.name.length, true); dv.setUint16(p + 28, 0, true);
    out.set(e.name, p + 30); p += 30 + e.name.length;
    out.set(e.data, p); p += e.data.length;
  }
  const cdStart = p;
  entries.forEach((e, i) => {
    dv.setUint32(p, 0x02014b50, true); dv.setUint16(p + 4, 20, true); dv.setUint16(p + 6, 20, true); dv.setUint16(p + 8, 0x0800, true);
    dv.setUint16(p + 10, 0, true); dv.setUint16(p + 12, dosTime, true); dv.setUint16(p + 14, dosDate, true);
    dv.setUint32(p + 16, e.crc, true); dv.setUint32(p + 20, e.data.length, true); dv.setUint32(p + 24, e.data.length, true);
    dv.setUint16(p + 28, e.name.length, true); dv.setUint16(p + 30, 0, true); dv.setUint16(p + 32, 0, true);
    dv.setUint16(p + 34, 0, true); dv.setUint16(p + 36, 0, true); dv.setUint32(p + 38, 0, true); dv.setUint32(p + 42, offsets[i], true);
    out.set(e.name, p + 46); p += 46 + e.name.length;
  });
  dv.setUint32(p, 0x06054b50, true); dv.setUint16(p + 8, entries.length, true); dv.setUint16(p + 10, entries.length, true);
  dv.setUint32(p + 12, p - cdStart, true); dv.setUint32(p + 16, cdStart, true);
  return out;
}
