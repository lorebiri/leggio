// Interprete minimo di content stream: segue stato grafico e stato del testo per sapere
// dove cade ogni glifo e ogni immagine. Puro: niente DOM, niente pdf-lib.

export const IDENT = [1, 0, 0, 1, 0, 0];
/** Prodotto di matrici PDF (convenzione a vettore riga): prima m1 poi m2. */
export function mul(m1, m2) {
  return [
    m1[0] * m2[0] + m1[1] * m2[2], m1[0] * m2[1] + m1[1] * m2[3],
    m1[2] * m2[0] + m1[3] * m2[2], m1[2] * m2[1] + m1[3] * m2[3],
    m1[4] * m2[0] + m1[5] * m2[2] + m2[4], m1[4] * m2[1] + m1[5] * m2[3] + m2[5],
  ];
}
export function inv(m) {
  const det = m[0] * m[3] - m[1] * m[2];
  if (!det || !Number.isFinite(det)) return null;
  return [m[3] / det, -m[1] / det, -m[2] / det, m[0] / det, (m[2] * m[5] - m[3] * m[4]) / det, (m[1] * m[4] - m[0] * m[5]) / det];
}
export function apply(m, x, y) { return [x * m[0] + y * m[2] + m[4], x * m[1] + y * m[3] + m[5]]; }

const num = (o, d = 0) => (o && o.t === 'num' && Number.isFinite(o.v) ? o.v : d);
const nums = (ops, k) => { const a = []; for (let i = 0; i < k; i++) a.push(num(ops[i])); return a; };

function cmykToRgb(c, m, y, k) { return [(1 - c) * (1 - k), (1 - m) * (1 - k), (1 - y) * (1 - k)]; }
function colorFrom(vals) {
  const v = vals.filter((x) => Number.isFinite(x));
  if (v.length === 1) return [v[0], v[0], v[0]];
  if (v.length === 3) return v;
  if (v.length === 4) return cmykToRgb(...v);
  return null;
}

/**
 * Interpreta le operazioni di un content stream.
 * res: { font(name) → modello | null, xobject(name) → { subtype, matrix?, bbox?, open() → { parsed, res } } | null }
 * opts: { maxOps, maxDepth, collectForms (default true) }
 * Ritorna { shows, images, forms, unbalanced, finalDepth, endCtmIdentity, opCount, truncated }
 *  shows[i]: { opIndex, op, fontName, font, fs, th, tc, tw, rise, color, tm(matrice testo iniziale), ctm, glyphs:[…], inForm, formPath }
 *  glyph: { el (indice elemento TJ o 0), code, len, offset, w, u, space, adv (avanzamento in unità testo, senza Th),
 *           x0 (posizione in unità testo all'inizio del glifo, relativa all'inizio dell'operatore), p: [x,y] centro in spazio pagina,
 *           o: [x,y] origine in spazio pagina, e: [x,y] fine in spazio pagina }
 */
export function interpret(parsed, res, opts = {}) {
  const maxOps = opts.maxOps ?? 2_000_000;
  const maxDepth = opts.maxDepth ?? 8;
  const out = { shows: [], images: [], forms: [], opCount: 0, truncated: false, unbalanced: false, finalDepth: 0, endCtmIdentity: true, unsupportedFonts: new Set() };
  run(parsed, res, IDENT, out, 0, null, maxOps, maxDepth);
  return out;
}

function run(parsed, res, baseCtm, out, depth, formPath, maxOps, maxDepth) {
  const stack = [];
  let gs = { ctm: baseCtm, fontName: null, font: null, fs: 0, tc: 0, tw: 0, th: 1, tl: 0, rise: 0, tr: 0, fill: [0, 0, 0] };
  let tm = IDENT, tlm = IDENT;
  const ops = parsed.ops;
  for (let i = 0; i < ops.length; i++) {
    if (++out.opCount > maxOps) { out.truncated = true; return; }
    const { op, operands: a } = ops[i];
    switch (op) {
      case 'q': stack.push(gs); gs = { ...gs }; if (stack.length > 4096) stack.shift(); break;
      case 'Q': if (stack.length) gs = stack.pop(); else if (!formPath) out.unbalanced = true; break;
      case 'cm': if (a.length >= 6) gs.ctm = mul(nums(a, 6), gs.ctm); break;
      case 'BT': tm = IDENT; tlm = IDENT; break;
      case 'ET': break;
      case 'Tf': gs.fontName = a[0]?.t === 'name' ? a[0].v : null; gs.fs = num(a[1]); gs.font = gs.fontName != null ? safeFont(res, gs.fontName, out) : null; break;
      case 'Tc': gs.tc = num(a[0]); break;
      case 'Tw': gs.tw = num(a[0]); break;
      case 'Tz': gs.th = num(a[0], 100) / 100; break;
      case 'TL': gs.tl = num(a[0]); break;
      case 'Ts': gs.rise = num(a[0]); break;
      case 'Tr': gs.tr = num(a[0]); break;
      case 'Td': tlm = mul([1, 0, 0, 1, num(a[0]), num(a[1])], tlm); tm = tlm; break;
      case 'TD': gs.tl = -num(a[1]); tlm = mul([1, 0, 0, 1, num(a[0]), num(a[1])], tlm); tm = tlm; break;
      case 'Tm': if (a.length >= 6) { tlm = nums(a, 6); tm = tlm; } break;
      case 'T*': tlm = mul([1, 0, 0, 1, 0, -gs.tl], tlm); tm = tlm; break;
      case 'Tj': case 'TJ': case "'": case '"': {
        if (op === "'" || op === '"') {
          if (op === '"') { gs.tw = num(a[0]); gs.tc = num(a[1]); }
          tlm = mul([1, 0, 0, 1, 0, -gs.tl], tlm); tm = tlm;
        }
        const strOp = op === 'TJ' ? a[0] : a[a.length - 1];
        tm = showText(op, strOp, i, gs, tm, out, formPath);
        break;
      }
      case 'g': gs.fill = colorFrom([num(a[0])]) || gs.fill; break;
      case 'rg': gs.fill = colorFrom(nums(a, 3)) || gs.fill; break;
      case 'k': gs.fill = colorFrom(nums(a, 4)) || gs.fill; break;
      case 'sc': case 'scn': { const c = colorFrom(a.filter((o) => o.t === 'num').map((o) => o.v)); if (c) gs.fill = c; break; }
      case 'cs': gs.fill = [0, 0, 0]; break;
      case 'Do': {
        const name = a[0]?.t === 'name' ? a[0].v : null;
        if (name == null) break;
        let xo = null;
        try { xo = res?.xobject?.(name) || null; } catch { xo = null; }
        if (!xo) break;
        if (xo.subtype === 'Image') {
          out.images.push({ opIndex: i, name, ctm: gs.ctm, inForm: !!formPath, formPath, ...corners(gs.ctm) });
        } else if (xo.subtype === 'Form') {
          const fm = Array.isArray(xo.matrix) && xo.matrix.length === 6 ? xo.matrix : IDENT;
          const ctm = mul(fm, gs.ctm);
          out.forms.push({ opIndex: i, name, ctm, inForm: !!formPath });
          if (depth < maxDepth && xo.open) {
            let sub = null;
            try { sub = xo.open(); } catch { sub = null; }
            if (sub && sub.parsed) run(sub.parsed, sub.res || res, ctm, out, depth + 1, [...(formPath || []), { opIndex: i, name }], maxOps, maxDepth);
          }
        }
        break;
      }
      default: break;
    }
  }
  if (!formPath) {
    out.finalDepth = stack.length;
    const c = gs.ctm;
    out.endCtmIdentity = Math.abs(c[0] - 1) < 1e-9 && Math.abs(c[1]) < 1e-9 && Math.abs(c[2]) < 1e-9 && Math.abs(c[3] - 1) < 1e-9 && Math.abs(c[4]) < 1e-9 && Math.abs(c[5]) < 1e-9;
  }
}

function safeFont(res, name, out) {
  try {
    const f = res?.font?.(name) || null;
    if (f && !f.supported) out.unsupportedFonts.add(name);
    return f;
  } catch { return null; }
}

function corners(ctm) {
  const pts = [apply(ctm, 0, 0), apply(ctm, 1, 0), apply(ctm, 1, 1), apply(ctm, 0, 1)];
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  return { quad: pts, rect: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] };
}

function showText(op, strOp, opIndex, gs, tm, out, formPath) {
  const elements = op === 'TJ' ? (strOp?.t === 'arr' ? strOp.v : []) : [strOp];
  const font = gs.font;
  const show = { opIndex, op, fontName: gs.fontName, font, fs: gs.fs, th: gs.th, tc: gs.tc, tw: gs.tw, rise: gs.rise, tr: gs.tr, color: gs.fill, tm, ctm: gs.ctm, glyphs: [], inForm: !!formPath, formPath, elements };
  let x = 0; // avanzamento in unità testo (senza Th), dall'inizio dell'operatore
  const fs = gs.fs, th = gs.th;
  const base = mul(tm, gs.ctm);
  elements.forEach((el, ei) => {
    if (!el) return;
    if (el.t === 'num') { x -= (el.v / 1000) * fs; return; }
    if (el.t !== 'str' && el.t !== 'hex') return;
    const glyphs = font ? font.decode(el.b) : [...el.b].map((c, k) => ({ code: c, len: 1, offset: k, w: 500, u: null, space: c === 32 }));
    for (const g of glyphs) {
      const w0 = (g.w || 0) / 1000;
      const adv = w0 * fs + gs.tc + (g.space ? gs.tw : 0);
      // spazio testo → pagina: [fs*th 0 0 fs 0 rise] ricondotto qui con x in unità già moltiplicate per fs
      const toPage = (gx, gy) => apply(base, gx * th, gy + gs.rise);
      g.el = ei; g.x0 = x; g.adv = adv;
      g.o = toPage(x, 0);
      g.e = toPage(x + w0 * fs, 0);
      g.p = toPage(x + (w0 * fs) / 2, 0.3 * fs);
      g.top = toPage(x, 0.75 * fs);
      show.glyphs.push(g);
      x += adv;
    }
  });
  show.advance = x;
  out.shows.push(show);
  // la matrice testo avanza della larghezza totale
  return mul([1, 0, 0, 1, x * th, 0], tm);
}

/** Dimensione effettiva del font in spazio pagina per un'operazione di testo. */
export function effectiveFontSize(show) {
  const m = mul(show.tm, show.ctm);
  return Math.abs(show.fs) * Math.hypot(m[2], m[3]);
}
/** Angolo (gradi) della linea di base in spazio pagina. */
export function showAngle(show) {
  const m = mul(show.tm, show.ctm);
  return (Math.atan2(m[1], m[0]) * 180) / Math.PI;
}
