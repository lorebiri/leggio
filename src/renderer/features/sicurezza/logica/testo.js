// Geometria del testo estratto con pdf.js (getTextContent): parole con riquadri in coordinate PDF,
// testo di pagina per la ricerca con mappa carattere → elemento, rettangoli delle occorrenze.
// Logica pura (nessun DOM): usata sia nell'app sia nei test in node.

const ASC = 0.92; // frazione della dimensione del carattere sopra la linea di base
const DESC = 0.26; // sotto la linea di base

/** Geometria di un elemento di testo pdf.js: origine, direzione, dimensione. */
export function itemGeometry(it) {
  const [a, b, c, d, e, f] = it.transform;
  const len = Math.hypot(a, b) || 1;
  const dir = [a / len, b / len];
  const size = Math.abs(-dir[1] * c + dir[0] * d) || Math.hypot(c, d) || it.height || 1;
  return { origin: [e, f], dir, up: [-dir[1], dir[0]], size, width: it.width || 0 };
}

/** Riquadro (allineato agli assi) della porzione [x0, x1] (distanze lungo la linea di base). */
export function spanRect(g, x0, x1) {
  const xs = []; const ys = [];
  for (const s of [x0, x1]) for (const v of [-DESC * g.size, ASC * g.size]) {
    xs.push(g.origin[0] + g.dir[0] * s + g.up[0] * v); ys.push(g.origin[1] + g.dir[1] * s + g.up[1] * v);
  }
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

/** Funzione di misura opzionale (browser): measure(str, fontFamily) → larghezze relative dei caratteri. */
let measureFn = null; let stylesRef = null;
export function setMeasure(fn) { measureFn = fn; }
export function setStyles(styles) { stylesRef = styles || null; }

/** Larghezze dei caratteri normalizzate sulla larghezza dell'elemento (misurate se possibile, altrimenti stimate). */
function estimateWidths(it, g) {
  const n = it.str.length;
  if (!n) return null;
  if (measureFn) {
    try {
      const fam = stylesRef?.[it.fontName]?.fontFamily || 'sans-serif';
      const m = measureFn(it.str, fam);
      if (m && m.length === n) { const tot = m.reduce((s, x) => s + x, 0); if (tot > 0) return m.map((x) => (x / tot) * g.width); }
    } catch { /* ripiega sulla stima */ }
  }
  const w = [];
  for (let i = 0; i < n; i++) {
    const ch = it.str[i];
    w.push(/\s/.test(ch) ? 0.28 : /[iljtfrI.,;:'!|]/.test(ch) ? 0.3 : /[mwMW]/.test(ch) ? 0.85 : /[A-Z]/.test(ch) ? 0.68 : 0.55);
  }
  const tot = w.reduce((s, x) => s + x, 0) || 1;
  return w.map((x) => (x / tot) * g.width);
}
function charPos(widths, k) { let s = 0; for (let i = 0; i < k; i++) s += widths ? widths[i] : 0; return s; }

/**
 * Prepara il testo di una pagina. items = textContent.items di pdf.js.
 * → { text, map (indice elemento per carattere, -1 = separatore), off, items: [{it, g, widths}] }
 */
export function buildPageText(items, styles) {
  setStyles(styles);
  const parts = []; const map = []; const off = []; const prepared = [];
  items.forEach((it, idx) => {
    if (typeof it.str !== 'string') { prepared.push(null); return; }
    const g = itemGeometry(it);
    prepared.push({ it, g, widths: estimateWidths(it, g) });
    for (let k = 0; k < it.str.length; k++) { parts.push(it.str[k]); map.push(idx); off.push(k); }
    const sep = it.hasEOL ? '\n' : (it.str && !/\s$/.test(it.str) ? ' ' : '');
    if (sep) { parts.push(sep); map.push(-1); off.push(-1); }
  });
  return { text: parts.join(''), map: Int32Array.from(map), off: Int32Array.from(off), items: prepared };
}

/** Rettangoli PDF che coprono i caratteri [start, end) del testo di pagina. */
export function rangeRects(pt, start, end) {
  const byItem = new Map();
  for (let i = start; i < end; i++) {
    const idx = pt.map[i]; if (idx < 0) continue;
    const k = pt.off[i];
    const r = byItem.get(idx);
    if (!r) byItem.set(idx, [k, k + 1]); else { r[0] = Math.min(r[0], k); r[1] = Math.max(r[1], k + 1); }
  }
  const rects = [];
  for (const [idx, [k0, k1]] of byItem) {
    const p = pt.items[idx]; if (!p) continue;
    // margine orizzontale generoso (0,2 em): meglio coprire un po' di spazio che lasciare scoperto un carattere
    const ext = p.g.size * 0.2;
    rects.push(padRect(spanRect(p.g, charPos(p.widths, k0) - ext, charPos(p.widths, k1) + ext), p.g.size * 0.08));
  }
  return rects;
}

export function padRect(r, m) { return [r[0] - m, r[1] - m, r[2] + m, r[3] + m]; }
export function normRect(r) { return [Math.min(r[0], r[2]), Math.min(r[1], r[3]), Math.max(r[0], r[2]), Math.max(r[1], r[3])]; }
export function intersects(a, b) { return a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3]; }
export function intersectsAny(r, rects) { return rects.some((x) => intersects(r, x)); }

/** Parole della pagina con riquadro e dati per ricostruire un livello di testo invisibile. */
export function pageWords(items, styles) {
  if (styles !== undefined) setStyles(styles);
  const words = [];
  for (const it of items) {
    if (typeof it.str !== 'string' || !it.str.trim()) continue;
    const g = itemGeometry(it);
    const widths = estimateWidths(it, g);
    const re = /\S+/g; let m;
    while ((m = re.exec(it.str))) {
      const x0 = charPos(widths, m.index); const x1 = charPos(widths, m.index + m[0].length);
      words.push({
        text: m[0], rect: spanRect(g, x0, x1), size: g.size, width: Math.max(0.01, x1 - x0), dir: g.dir,
        origin: [g.origin[0] + g.dir[0] * x0, g.origin[1] + g.dir[1] * x0],
      });
    }
  }
  return words;
}

/** Riquadro "interno" della parola: i margini delle aree oscurate che sfiorano una parola vicina non la tolgono. */
export function coreRect(w) {
  const dx = Math.min(w.size * 0.25, w.width * 0.3); const dy = w.size * 0.3;
  const r = w.rect;
  return [r[0] + dx, r[1] + dy, r[2] - dx, r[3] - dy];
}
/** La parola tocca un'area da oscurare? (una parola coperta anche solo in parte viene tolta tutta) */
export function wordHit(w, rects) { return intersectsAny(coreRect(w), rects); }
/** Parole che NON toccano nessuna area da oscurare. */
export function wordsOutside(words, rects) { return words.filter((w) => !wordHit(w, rects)); }
