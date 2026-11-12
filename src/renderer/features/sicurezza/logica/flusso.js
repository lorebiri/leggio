// Lettore minimale dei flussi di contenuto PDF: operatori con operandi e posizione in byte.
// Serve a: trovare dove e quanto grandi sono disegnate le immagini (DPI effettivi) e togliere il
// contenuto dei livelli nascosti. Logica pura, robusta a input malformati (non lancia).

const WS = new Set([0, 9, 10, 12, 13, 32]);
const DELIM = new Set([40, 41, 60, 62, 91, 93, 123, 125, 47, 37]);
const isWs = (c) => WS.has(c);
const isDelim = (c) => DELIM.has(c);
const dec = (bytes, a, b) => { let s = ''; for (let i = a; i < b; i++) s += String.fromCharCode(bytes[i]); return s; };

/** → [{ op, args, start, end }] ; start = inizio del primo operando, end = fine dell'operatore. */
export function parseOps(bytes, { maxOps = 5_000_000 } = {}) {
  const ops = []; const n = bytes.length;
  let i = 0; let stack = []; let argStart = -1; let depth = 0;
  const skipWs = () => {
    while (i < n) {
      const c = bytes[i];
      if (isWs(c)) i++;
      else if (c === 37) { while (i < n && bytes[i] !== 10 && bytes[i] !== 13) i++; }
      else break;
    }
  };
  function readValue() {
    if (++depth > 64) { depth--; i++; return null; }
    try {
      const c = bytes[i];
      if (c === 47) {
        const s = ++i; while (i < n && !isWs(bytes[i]) && !isDelim(bytes[i])) i++;
        return { name: dec(bytes, s, i).replace(/#([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16))) };
      }
      if (c === 40) {
        let lvl = 1; i++; const out = [];
        while (i < n) {
          const ch = bytes[i++];
          if (ch === 92) { out.push(92, bytes[i++]); continue; }
          if (ch === 40) lvl++;
          else if (ch === 41 && --lvl === 0) break;
          out.push(ch);
        }
        return { str: out };
      }
      if (c === 60 && bytes[i + 1] === 60) {
        i += 2; const d = {};
        for (;;) {
          skipWs(); if (i >= n) break;
          if (bytes[i] === 62 && bytes[i + 1] === 62) { i += 2; break; }
          const k = readValue(); skipWs(); if (i >= n) break;
          if (bytes[i] === 62 && bytes[i + 1] === 62) { i += 2; break; }
          const v = readValue();
          if (k && k.name != null) d[k.name] = v;
        }
        return { dict: d };
      }
      if (c === 60) { const s = ++i; while (i < n && bytes[i] !== 62) i++; i++; return { hex: dec(bytes, s, i - 1) }; }
      if (c === 91) {
        i++; const arr = [];
        for (;;) { skipWs(); if (i >= n) break; if (bytes[i] === 93) { i++; break; } arr.push(readValue()); }
        return arr;
      }
      if (c === 41 || c === 62 || c === 93 || c === 123 || c === 125) { i++; return null; }
      const s = i; while (i < n && !isWs(bytes[i]) && !isDelim(bytes[i])) i++;
      if (i === s) { i++; return null; }
      const tok = dec(bytes, s, i);
      if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(tok)) return Number(tok);
      return { op: tok };
    } finally { depth--; }
  }
  while (i < n && ops.length < maxOps) {
    skipWs(); if (i >= n) break;
    const tokStart = i;
    const v = readValue();
    if (v && typeof v === 'object' && !Array.isArray(v) && v.op != null) {
      if (v.op === 'true' || v.op === 'false' || v.op === 'null') { if (argStart < 0) argStart = tokStart; stack.push(v.op === 'true' ? true : v.op === 'false' ? false : null); continue; }
      if (v.op === 'BI') { // immagine in linea: salta fino a EI
        const s = argStart >= 0 ? argStart : tokStart;
        let j = i;
        while (j < n - 1 && !(bytes[j] === 73 && bytes[j + 1] === 68 && isWs(bytes[j - 1] ?? 32) && isWs(bytes[j + 2] ?? 32))) j++;
        j += 3;
        while (j < n - 1 && !(isWs(bytes[j - 1]) && bytes[j] === 69 && bytes[j + 1] === 73 && (j + 2 >= n || isWs(bytes[j + 2]) || isDelim(bytes[j + 2])))) j++;
        i = Math.min(n, j + 2);
        ops.push({ op: 'BI', args: [], start: s, end: i });
      } else ops.push({ op: v.op, args: stack, start: argStart >= 0 ? argStart : tokStart, end: i });
      stack = []; argStart = -1;
    } else {
      if (argStart < 0) argStart = tokStart;
      stack.push(v);
    }
  }
  return ops;
}

export function mulMatrix(m, n) {
  return [
    m[0] * n[0] + m[1] * n[2], m[0] * n[1] + m[1] * n[3],
    m[2] * n[0] + m[3] * n[2], m[2] * n[1] + m[3] * n[3],
    m[4] * n[0] + m[5] * n[2] + n[4], m[4] * n[1] + m[5] * n[3] + n[5],
  ];
}

/** Dove viene disegnato ogni XObject (Do). → [{ name, ctm }] */
export function xobjectPlacements(ops, baseCtm = [1, 0, 0, 1, 0, 0]) {
  const out = []; const st = []; let ctm = baseCtm;
  for (const o of ops) {
    if (o.op === 'q') st.push(ctm);
    else if (o.op === 'Q') ctm = st.pop() || baseCtm;
    else if (o.op === 'cm' && o.args.length === 6 && o.args.every((x) => typeof x === 'number')) ctm = mulMatrix(o.args, ctm);
    else if (o.op === 'Do' && o.args[0]?.name) out.push({ name: o.args[0].name, ctm });
  }
  return out;
}

/** Dimensioni (in punti) di un'immagine disegnata con la matrice ctm. */
export function placedSize(ctm) { return { w: Math.hypot(ctm[0], ctm[1]), h: Math.hypot(ctm[2], ctm[3]) }; }

/**
 * Intervalli di byte da togliere per eliminare il contenuto dei livelli nascosti.
 * isHiddenProp(nome) → /OC /nome è un livello spento; isHiddenXObject(nome) → XObject in livello spento.
 */
export function hiddenRanges(ops, { isHiddenProp = () => false, isHiddenXObject = () => false } = {}) {
  const ranges = []; const stack = []; let hiddenDepth = 0;
  for (const o of ops) {
    if (o.op === 'BDC' || o.op === 'BMC') {
      const hidden = o.op === 'BDC' && o.args[0]?.name === 'OC' && o.args[1]?.name != null && isHiddenProp(o.args[1].name);
      stack.push({ hidden, start: o.start });
      if (hidden) hiddenDepth++;
    } else if (o.op === 'EMC') {
      const top = stack.pop();
      if (top?.hidden) { hiddenDepth--; if (hiddenDepth === 0) ranges.push([top.start, o.end]); }
    } else if (o.op === 'Do' && hiddenDepth === 0 && o.args[0]?.name && isHiddenXObject(o.args[0].name)) {
      ranges.push([o.start, o.end]);
    }
  }
  const open = stack.find((s) => s.hidden);
  if (open) ranges.push([open.start, ops.length ? ops[ops.length - 1].end : open.start]);
  ranges.sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const r of ranges) { const l = merged[merged.length - 1]; if (l && r[0] <= l[1]) l[1] = Math.max(l[1], r[1]); else merged.push([...r]); }
  return merged;
}

/** Copia dei byte senza gli intervalli indicati (sostituiti da uno spazio). */
export function cutRanges(bytes, ranges) {
  if (!ranges.length) return bytes;
  const out = new Uint8Array(bytes.length + ranges.length); let o = 0; let pos = 0;
  for (const [a, b] of ranges) { out.set(bytes.subarray(pos, a), o); o += a - pos; out[o++] = 32; pos = b; }
  out.set(bytes.subarray(pos), o); o += bytes.length - pos;
  return out.slice(0, o);
}
