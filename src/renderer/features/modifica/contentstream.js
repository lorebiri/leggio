// Tokenizer, parser e riscrittore di content stream PDF. Puro: niente DOM, niente pdf-lib.
//
// Principio di sicurezza: la riscrittura copia byte per byte tutto ciò che non viene toccato
// (operatori, spazi, commenti, immagini in linea, perfino sequenze malformate). Solo gli operatori
// a cui si assegna esplicitamente una sostituzione vengono riscritti. Così un content stream
// insolito non può essere "normalizzato" in modo sbagliato.

const WS = new Uint8Array(256);
for (const c of [0, 9, 10, 12, 13, 32]) WS[c] = 1;
const DELIM = new Uint8Array(256);
for (const c of '()<>[]{}/%') DELIM[c.charCodeAt(0)] = 1;

export const isWhite = (c) => WS[c] === 1;
const isRegular = (c) => !WS[c] && !DELIM[c];

const MAX_DEPTH = 64; // annidamento massimo di array/dizionari negli operandi

/**
 * Analizza un content stream.
 * @param {Uint8Array} bytes
 * @returns {{ ops: Array<{op:string, operands:any[], start:number, end:number, data?:Uint8Array}>, bytes:Uint8Array, warnings:string[] }}
 *  - start/end: intervallo di byte dell'operazione (dal primo operando all'operatore compreso)
 *  - operandi: {t:'num',v,raw} {t:'str',b} {t:'hex',b} {t:'name',v} {t:'arr',v:[]} {t:'dict',v:{}} {t:'bool',v} {t:'null'}
 *  - per BI: op === 'BI', operands[0] è il dizionario dell'immagine, data i byte grezzi; end comprende "EI"
 * Non lancia mai eccezioni per input malformati: salta i byte incomprensibili e annota un avviso.
 */
export function parseContentStream(bytes) {
  if (!(bytes instanceof Uint8Array)) bytes = new Uint8Array(bytes || []);
  const n = bytes.length;
  const ops = [];
  const warnings = [];
  let pos = 0;
  let operands = [];
  let opStart = -1;

  const warn = (m) => { if (warnings.length < 50) warnings.push(m); };

  function skipWs() {
    while (pos < n) {
      const c = bytes[pos];
      if (WS[c]) { pos++; continue; }
      if (c === 37) { // % commento fino a fine riga
        while (pos < n && bytes[pos] !== 10 && bytes[pos] !== 13) pos++;
        continue;
      }
      break;
    }
  }

  function readLiteralString() {
    // pos è su '('
    pos++;
    const out = [];
    let depth = 1;
    while (pos < n) {
      const c = bytes[pos++];
      if (c === 92) { // backslash
        if (pos >= n) break;
        const d = bytes[pos++];
        switch (d) {
          case 110: out.push(10); break; // n
          case 114: out.push(13); break; // r
          case 116: out.push(9); break; // t
          case 98: out.push(8); break; // b
          case 102: out.push(12); break; // f
          case 40: out.push(40); break;
          case 41: out.push(41); break;
          case 92: out.push(92); break;
          case 13: if (bytes[pos] === 10) pos++; break; // continuazione di riga
          case 10: break;
          default:
            if (d >= 48 && d <= 55) {
              let v = d - 48;
              for (let k = 0; k < 2 && pos < n && bytes[pos] >= 48 && bytes[pos] <= 55; k++) v = v * 8 + (bytes[pos++] - 48);
              out.push(v & 255);
            } else out.push(d); // escape sconosciuto: si ignora il backslash
        }
        continue;
      }
      if (c === 40) depth++;
      else if (c === 41) { depth--; if (depth === 0) return { t: 'str', b: Uint8Array.from(out) }; }
      if (c === 13) { out.push(10); if (bytes[pos] === 10) pos++; continue; } // EOL normalizzato
      out.push(c);
    }
    warn('stringa non terminata');
    return { t: 'str', b: Uint8Array.from(out) };
  }

  function readHexString() {
    pos++; // '<'
    const out = [];
    let hi = -1;
    while (pos < n) {
      const c = bytes[pos++];
      if (c === 62) break; // '>'
      let v = -1;
      if (c >= 48 && c <= 57) v = c - 48;
      else if (c >= 65 && c <= 70) v = c - 55;
      else if (c >= 97 && c <= 102) v = c - 87;
      else continue; // spazi e caratteri estranei ignorati
      if (hi < 0) hi = v; else { out.push(hi * 16 + v); hi = -1; }
    }
    if (hi >= 0) out.push(hi * 16);
    return { t: 'hex', b: Uint8Array.from(out) };
  }

  function readName() {
    pos++; // '/'
    let s = '';
    while (pos < n && isRegular(bytes[pos])) {
      const c = bytes[pos];
      if (c === 35 && pos + 2 < n) { // #xx
        const hx = String.fromCharCode(bytes[pos + 1], bytes[pos + 2]);
        if (/^[0-9a-fA-F]{2}$/.test(hx)) { s += String.fromCharCode(parseInt(hx, 16)); pos += 3; continue; }
      }
      s += String.fromCharCode(c); pos++;
    }
    return { t: 'name', v: s };
  }

  function readKeyword() {
    const s0 = pos;
    while (pos < n && isRegular(bytes[pos])) pos++;
    let s = '';
    for (let i = s0; i < pos; i++) s += String.fromCharCode(bytes[i]);
    return s;
  }

  function keywordToObject(s) {
    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(s)) return { t: 'num', v: parseFloat(s), raw: s };
    if (/^[+-]*\d*\.?\d*$/.test(s) && /\d/.test(s)) { // numeri malformati tipo "--5" o "4.5.6"
      const m = s.replace(/^[+-]+/, (x) => (x.split('-').length % 2 === 0 ? '-' : ''));
      const v = parseFloat(m); return { t: 'num', v: Number.isFinite(v) ? v : 0, raw: s };
    }
    if (s === 'true') return { t: 'bool', v: true };
    if (s === 'false') return { t: 'bool', v: false };
    if (s === 'null') return { t: 'null' };
    return null; // è un operatore
  }

  // legge un oggetto (operando). Ritorna undefined se trova un operatore (keyword) — in tal caso kw contiene il nome
  let kw = null;
  function readObject(depth) {
    skipWs();
    if (pos >= n) return undefined;
    const c = bytes[pos];
    if (c === 40) return readLiteralString();
    if (c === 60) {
      if (bytes[pos + 1] === 60) { pos += 2; return readDict(depth + 1); }
      return readHexString();
    }
    if (c === 47) return readName();
    if (c === 91) { pos++; return readArray(depth + 1); }
    if (c === 93 || c === 62 || c === 41 || c === 123 || c === 125) {
      // delimitatore isolato: lo saltiamo (resta comunque nei byte copiati)
      pos++; warn('delimitatore inatteso a ' + (pos - 1));
      return { t: 'junk' };
    }
    const s = readKeyword();
    if (!s) { pos++; return { t: 'junk' }; }
    const o = keywordToObject(s);
    if (o) return o;
    kw = s;
    return undefined;
  }

  function readArray(depth) {
    const v = [];
    while (pos < n) {
      skipWs();
      if (pos >= n) break;
      if (bytes[pos] === 93) { pos++; return { t: 'arr', v }; }
      if (depth > MAX_DEPTH) { pos++; continue; }
      const save = pos;
      const o = readObject(depth);
      if (o === undefined) {
        // operatore dentro un array: array non chiuso. Torniamo indietro e chiudiamo qui.
        pos = save; kw = null; warn('array non chiuso');
        return { t: 'arr', v, unterminated: true };
      }
      if (o.t !== 'junk') v.push(o);
    }
    warn('array non chiuso');
    return { t: 'arr', v, unterminated: true };
  }

  function readDict(depth) {
    const v = {};
    let key = null;
    while (pos < n) {
      skipWs();
      if (pos >= n) break;
      if (bytes[pos] === 62 && bytes[pos + 1] === 62) { pos += 2; return { t: 'dict', v }; }
      if (depth > MAX_DEPTH) { pos++; continue; }
      const save = pos;
      const o = readObject(depth);
      if (o === undefined) { pos = save; kw = null; warn('dizionario non chiuso'); return { t: 'dict', v }; }
      if (o.t === 'junk') continue;
      if (key === null) { if (o.t === 'name') key = o.v; } else { v[key] = o; key = null; }
    }
    return { t: 'dict', v };
  }

  function readInlineImage(start) {
    // dopo BI: coppie chiave/valore fino a ID
    const dict = {};
    let key = null;
    while (pos < n) {
      skipWs();
      if (pos >= n) break;
      const save = pos;
      const o = readObject(1);
      if (o === undefined) {
        if (kw === 'ID') { kw = null; break; }
        kw = null; // parola chiave estranea nel dizionario: ignorata
        if (pos === save) pos++;
        continue;
      }
      if (o.t === 'junk') continue;
      if (key === null) { if (o.t === 'name') key = o.v; } else { dict[key] = o; key = null; }
    }
    // un solo spazio bianco dopo ID
    if (pos < n && WS[bytes[pos]]) pos++;
    const dataStart = pos;
    const dataEnd = findInlineImageEnd(bytes, dataStart, dict);
    pos = dataEnd;
    // salta "EI"
    let end = n;
    if (dataEnd < n) {
      let p = dataEnd;
      while (p < n && WS[bytes[p]]) p++;
      if (bytes[p] === 69 && bytes[p + 1] === 73) end = p + 2; else end = p;
    }
    pos = end;
    ops.push({ op: 'BI', operands: [{ t: 'dict', v: dict }], start, end, data: bytes.subarray(dataStart, dataEnd) });
  }

  let guard = 0;
  const maxIter = n * 4 + 100;
  while (pos < n) {
    if (++guard > maxIter) { warn('analisi interrotta (protezione da cicli)'); break; }
    skipWs();
    if (pos >= n) break;
    const before = pos;
    if (opStart < 0) opStart = pos;
    kw = null;
    const o = readObject(0);
    if (o !== undefined) {
      if (o.t !== 'junk') operands.push(o);
      else if (!operands.length) opStart = -1;
      if (pos === before) pos++; // garanzia di avanzamento
      if (operands.length > 10000) { operands = []; opStart = -1; warn('troppi operandi'); }
      continue;
    }
    const name = kw; kw = null;
    if (name === 'BI') {
      readInlineImage(opStart);
      operands = []; opStart = -1;
      continue;
    }
    ops.push({ op: name, operands, start: opStart, end: pos });
    operands = []; opStart = -1;
    if (pos === before) pos++;
  }
  return { ops, bytes, warnings, trailingOperands: operands.length };
}

/** Lettura di un intero da un operando dizionario di immagine in linea (con abbreviazioni). */
function dictNum(dict, ...keys) {
  for (const k of keys) { const o = dict[k]; if (o && o.t === 'num') return o.v; }
  return undefined;
}

/**
 * Trova la fine dei dati di un'immagine in linea.
 * 1) se c'è /L o /Length si usa quella; 2) se non ci sono filtri si calcola la dimensione dai parametri;
 * 3) altrimenti si cerca "EI" circondato da spazi e seguito da contenuto plausibile (come fa pdf.js).
 */
export function findInlineImageEnd(bytes, start, dict) {
  const n = bytes.length;
  const len = dictNum(dict, 'L', 'Length');
  if (len != null && len >= 0 && start + len <= n) {
    let p = start + len;
    while (p < n && WS[bytes[p]]) p++;
    if (bytes[p] === 69 && bytes[p + 1] === 73) return start + len;
  }
  const filter = dict.F || dict.Filter;
  const hasFilter = filter && !(filter.t === 'arr' && filter.v.length === 0);
  if (!hasFilter) {
    const w = dictNum(dict, 'W', 'Width'), h = dictNum(dict, 'H', 'Height');
    let bpc = dictNum(dict, 'BPC', 'BitsPerComponent');
    const im = dict.IM || dict.ImageMask;
    let comps = 1;
    const cs = dict.CS || dict.ColorSpace;
    if (im && im.v === true) { bpc = 1; comps = 1; }
    else if (cs && cs.t === 'name') comps = { RGB: 3, DeviceRGB: 3, CMYK: 4, DeviceCMYK: 4, G: 1, DeviceGray: 1, I: 1, Indexed: 1 }[cs.v] || 0;
    else if (cs && cs.t === 'arr') comps = cs.v[0] && /^I(ndexed)?$/.test(cs.v[0].v) ? 1 : 0;
    if (w > 0 && h > 0 && bpc > 0 && comps > 0) {
      const size = Math.ceil((w * comps * bpc) / 8) * h;
      if (start + size <= n) {
        let p = start + size;
        while (p < n && WS[bytes[p]]) p++;
        if (bytes[p] === 69 && bytes[p + 1] === 73 && (p + 2 >= n || WS[bytes[p + 2]] || DELIM[bytes[p + 2]])) return start + size;
      }
    }
  }
  // ricerca euristica di EI
  let first = -1;
  for (let i = start; i < n - 1; i++) {
    if (bytes[i] !== 69 || bytes[i + 1] !== 73) continue;
    if (i > start && !WS[bytes[i - 1]]) continue;
    const after = bytes[i + 2];
    if (i + 2 < n && !WS[after]) continue;
    if (first < 0) first = i;
    // dopo EI devono seguire byte "da content stream" (ASCII stampabili) per un tratto
    let ok = true;
    const lim = Math.min(n, i + 2 + 48);
    for (let k = i + 2; k < lim; k++) {
      const c = bytes[k];
      if (c > 127 || (c < 32 && !WS[c])) { ok = false; break; }
    }
    if (ok) return i > start && WS[bytes[i - 1]] ? i - 1 : i;
  }
  if (first >= 0) return first > start && WS[bytes[first - 1]] ? first - 1 : first;
  return n;
}

// ------------------------------------------------------------------ serializzazione

const enc = new TextEncoder();

/** Serializza un operando (per gli operatori riscritti). Le stringhe vanno sempre in esadecimale. */
export function serializeOperand(o) {
  switch (o.t) {
    case 'num': return o.raw != null ? o.raw : fmtNum(o.v);
    case 'str': case 'hex': return '<' + toHex(o.b) + '>';
    case 'name': return '/' + escapeName(o.v);
    case 'arr': return '[' + o.v.map(serializeOperand).join(' ') + ']';
    case 'dict': return '<<' + Object.entries(o.v).map(([k, v]) => '/' + escapeName(k) + ' ' + serializeOperand(v)).join(' ') + '>>';
    case 'bool': return o.v ? 'true' : 'false';
    case 'null': return 'null';
    default: return '';
  }
}

export function escapeName(s) {
  let out = '';
  for (const ch of s) {
    const c = ch.charCodeAt(0);
    if (c < 33 || c > 126 || DELIM[c] || c === 35) out += '#' + (c & 255).toString(16).padStart(2, '0');
    else out += ch;
  }
  return out;
}

export function toHex(b) {
  let s = '';
  for (let i = 0; i < b.length; i++) s += b[i].toString(16).padStart(2, '0');
  return s;
}

/** Numero compatto per i content stream (max 4 decimali, niente notazione esponenziale). */
export function fmtNum(v) {
  if (!Number.isFinite(v)) return '0';
  if (Math.abs(v) < 1e-6) return '0';
  let s = (Math.round(v * 10000) / 10000).toFixed(4);
  s = s.replace(/\.?0+$/, '');
  return s === '-0' ? '0' : s;
}

/**
 * Ricostruisce il content stream applicando le sostituzioni.
 * replacements: Map<indiceOperazione, string|Uint8Array> ('' = elimina l'operazione).
 * Tutto il resto viene copiato byte per byte.
 */
export function rewriteContentStream(parsed, replacements) {
  const { bytes, ops } = parsed;
  const chunks = [];
  let cursor = 0;
  let total = 0;
  const push = (u8) => { chunks.push(u8); total += u8.length; };
  const idx = [...replacements.keys()].filter((i) => i >= 0 && i < ops.length).sort((a, b) => a - b);
  for (const i of idx) {
    const op = ops[i];
    if (op.start < cursor) continue; // sovrapposizione impossibile, prudenza
    push(bytes.subarray(cursor, op.start));
    let r = replacements.get(i);
    if (typeof r === 'string') r = enc.encode(r);
    // separatori attorno alla sostituzione, così non si fonde con i token vicini
    push(enc.encode(' ')); push(r); push(enc.encode(' '));
    cursor = op.end;
  }
  push(bytes.subarray(cursor));
  const out = new Uint8Array(total);
  let p = 0;
  for (const c of chunks) { out.set(c, p); p += c.length; }
  return out;
}

/** Concatena più content stream (come fa un lettore PDF: separati da uno spazio bianco). */
export function concatStreams(list) {
  const total = list.reduce((s, b) => s + b.length + 1, 0);
  const out = new Uint8Array(total);
  let p = 0;
  for (const b of list) { out.set(b, p); p += b.length; out[p++] = 10; }
  return out;
}

export function latin1(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
  return s;
}
