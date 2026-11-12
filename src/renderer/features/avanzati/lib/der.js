// Lettore ASN.1 BER/DER minimale su Uint8Array (nessuna dipendenza, nessun DOM).
// Gestisce lunghezze indefinite e stringhe "costruite" (frequenti nei file .p7m prodotti dai
// software di firma italiani). Pensato per essere robusto: limiti di profondità e di nodi,
// errori leggibili invece di eccezioni oscure.

export class Asn1Error extends Error {}

const MAX_DEPTH = 64;
const MAX_NODES = 2_000_000;

/**
 * Nodo: { cls, constructed, tag, start (inizio intestazione), hdr (lunghezza intestazione),
 *         len (lunghezza contenuto, -1 se indefinita prima del calcolo), end, children? }
 * I byte del contenuto: bytes.subarray(start + hdr, start + hdr + contentLen).
 */
export function parseDer(bytes, { offset = 0, end = bytes.length, maxNodes = MAX_NODES } = {}) {
  const state = { count: 0, maxNodes };
  const node = readNode(bytes, offset, end, 0, state);
  return node;
}

function readNode(b, pos, limit, depth, state) {
  if (depth > MAX_DEPTH) throw new Asn1Error('Struttura troppo annidata');
  if (++state.count > state.maxNodes) throw new Asn1Error('Struttura troppo grande');
  const start = pos;
  if (pos >= limit) throw new Asn1Error('Dati troncati');
  const id = b[pos++];
  const cls = id >> 6;
  const constructed = (id & 0x20) !== 0;
  let tag = id & 0x1f;
  if (tag === 0x1f) {
    tag = 0;
    let n = 0;
    do {
      if (pos >= limit || ++n > 4) throw new Asn1Error('Etichetta non valida');
      tag = (tag << 7) | (b[pos] & 0x7f);
    } while (b[pos++] & 0x80);
  }
  if (pos >= limit) throw new Asn1Error('Dati troncati');
  let len = b[pos++];
  let indefinite = false;
  if (len === 0x80) {
    if (!constructed) throw new Asn1Error('Lunghezza indefinita su elemento semplice');
    indefinite = true; len = -1;
  } else if (len & 0x80) {
    const nb = len & 0x7f;
    if (nb > 6 || pos + nb > limit) throw new Asn1Error('Lunghezza non valida');
    len = 0;
    for (let i = 0; i < nb; i++) len = len * 256 + b[pos++];
  }
  const hdr = pos - start;
  const node = { cls, constructed, tag, start, hdr, len, end: 0, children: null };
  if (!indefinite) {
    if (pos + len > limit) throw new Asn1Error('Dati troncati (il file è incompleto o danneggiato)');
    node.end = pos + len;
    if (constructed) {
      node.children = [];
      let p = pos;
      while (p < node.end) { const c = readNode(b, p, node.end, depth + 1, state); node.children.push(c); p = c.end; }
    }
  } else {
    node.children = [];
    let p = pos;
    for (;;) {
      if (p + 2 > limit) throw new Asn1Error('Dati troncati (fine mancante)');
      if (b[p] === 0 && b[p + 1] === 0) { p += 2; break; }
      const c = readNode(b, p, limit, depth + 1, state); node.children.push(c); p = c.end;
    }
    node.end = p;
    node.len = p - 2 - (start + hdr);
  }
  return node;
}

/** Byte del contenuto (senza intestazione). */
export function content(b, n) { return b.subarray(n.start + n.hdr, n.start + n.hdr + n.len); }
/** Byte dell'intero elemento (intestazione compresa). */
export function whole(b, n) { return b.subarray(n.start, n.end); }

/** Contenuto di una OCTET STRING, anche se costruita (concatena i pezzi). */
export function octets(b, n) {
  if (!n.constructed) return content(b, n);
  const parts = [];
  const walk = (x) => { if (x.constructed) x.children.forEach(walk); else parts.push(content(b, x)); };
  walk(n);
  if (parts.length === 1) return parts[0];
  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

export function oid(b, n) {
  const c = content(b, n);
  if (!c.length) return '';
  const out = [];
  let v = 0;
  for (let i = 0; i < c.length; i++) {
    v = v * 128 + (c[i] & 0x7f);
    if (!(c[i] & 0x80)) {
      if (!out.length) { const first = v < 80 ? Math.floor(v / 40) : 2; out.push(first, v - first * 40); }
      else out.push(v);
      v = 0;
    }
  }
  return out.join('.');
}

export function integerHex(b, n) {
  let c = content(b, n);
  let s = '';
  for (const x of c) s += x.toString(16).padStart(2, '0');
  s = s.replace(/^(00)+(?=.)/, '');
  return s.toUpperCase();
}

const decUtf8 = new TextDecoder('utf-8', { fatal: false });
const decLatin1 = new TextDecoder('latin1');

export function str(b, n) {
  const c = octets(b, n);
  switch (n.tag) {
    case 0x1e: { // BMPString (UTF-16BE)
      let s = ''; for (let i = 0; i + 1 < c.length; i += 2) s += String.fromCharCode((c[i] << 8) | c[i + 1]); return s;
    }
    case 0x1c: { // UniversalString (UTF-32BE)
      let s = ''; for (let i = 0; i + 3 < c.length; i += 4) s += String.fromCodePoint(((c[i] << 24) | (c[i + 1] << 16) | (c[i + 2] << 8) | c[i + 3]) >>> 0); return s;
    }
    case 0x0c: return decUtf8.decode(c);
    default: return decLatin1.decode(c);
  }
}

/** UTCTime / GeneralizedTime → Date (o null). */
export function time(b, n) {
  const s = decLatin1.decode(content(b, n));
  let m;
  if (n.tag === 0x17) {
    m = s.match(/^(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?(Z|[+-]\d{4})?$/);
    if (!m) return null;
    const yy = +m[1]; const year = yy >= 50 ? 1900 + yy : 2000 + yy;
    return mkDate(year, m[2], m[3], m[4], m[5], m[6] || '0', '', m[7]);
  }
  if (n.tag === 0x18) {
    m = s.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})?(\d{2})?([.,]\d+)?(Z|[+-]\d{4})?$/);
    if (!m) return null;
    return mkDate(+m[1], m[2], m[3], m[4], m[5] || '0', m[6] || '0', m[7] || '', m[8]);
  }
  return null;
}
function mkDate(y, mo, d, hh, mi, ss, frac, tz) {
  let t = Date.UTC(y, +mo - 1, +d, +hh, +mi, +ss, frac ? Math.round(parseFloat('0' + frac.replace(',', '.')) * 1000) : 0);
  if (tz && tz !== 'Z') { const sign = tz[0] === '-' ? -1 : 1; t -= sign * (parseInt(tz.slice(1, 3), 10) * 60 + parseInt(tz.slice(3), 10)) * 60000; }
  const dt = new Date(t);
  return isNaN(dt) ? null : dt;
}

/** Codifica una lunghezza DER. */
export function derLength(len) {
  if (len < 0x80) return [len];
  const out = [];
  while (len > 0) { out.unshift(len & 0xff); len = Math.floor(len / 256); }
  return [0x80 | out.length, ...out];
}
