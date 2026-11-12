// Raggruppamento del testo della pagina in righe e paragrafi (blocchi modificabili) e utilità di testo.
// Puro: lavora sugli item di getTextContent di pdf.js oppure sui glifi dell'interprete.

const rad = (d) => (d * Math.PI) / 180;
/** Da spazio pagina a riferimento locale ruotato di -angle. */
export function toLocal(angle, x, y) { const r = rad(angle), c = Math.cos(r), s = Math.sin(r); return [x * c + y * s, -x * s + y * c]; }
export function fromLocal(angle, lx, ly) { const r = rad(angle), c = Math.cos(r), s = Math.sin(r); return [lx * c - ly * s, lx * s + ly * c]; }

/** Quadrilatero e rettangolo in spazio pagina di un box locale [x0,y0,x1,y1]. */
export function boxToPage(angle, box) {
  const [x0, y0, x1, y1] = box;
  const quad = [fromLocal(angle, x0, y0), fromLocal(angle, x1, y0), fromLocal(angle, x1, y1), fromLocal(angle, x0, y1)];
  const xs = quad.map((p) => p[0]), ys = quad.map((p) => p[1]);
  return { quad, rect: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] };
}

/**
 * Raggruppa gli item di pdf.js in blocchi.
 * @param items  textContent.items
 * @param styles textContent.styles (facoltativo)
 * @returns blocks: [{ id, angle, box:[x0,y0,x1,y1] locale, quad, rect, lines:[{text,left,right,base,fs}], text, fontSize, lineHeight, fontName, fontFamily }]
 */
export function groupTextItems(items, styles = {}) {
  const els = [];
  for (const it of items || []) {
    if (!it || typeof it.str !== 'string' || !it.transform) continue;
    const [a, b, c, d, e, f] = it.transform;
    const fs = Math.hypot(c, d) || Math.hypot(a, b) || it.height || 0;
    if (!(fs > 0.5)) continue;
    let angle = (Math.atan2(b, a) * 180) / Math.PI;
    angle = Math.round(angle * 2) / 2;
    if (Math.abs(angle) < 0.5) angle = 0;
    const [lx, ly] = toLocal(angle, e, f);
    const w = Math.abs(it.width || 0);
    if (!it.str.length && !w) continue;
    els.push({ str: it.str, lx, ly, w, fs, angle, fontName: it.fontName, eol: !!it.hasEOL });
  }
  els.sort((p, q) => p.angle - q.angle || q.ly - p.ly || p.lx - q.lx);
  // righe
  const lines = [];
  let cur = null;
  for (const el of els) {
    const blank = !el.str.trim();
    if (cur && cur.angle === el.angle && Math.abs(cur.base - el.ly) < 0.35 * Math.max(cur.fs, el.fs) && el.lx > cur.right - 0.6 * el.fs && el.lx - cur.right < 2.2 * el.fs) {
      if (!blank) {
        const gap = el.lx - cur.right;
        if (gap > 0.12 * el.fs && !cur.text.endsWith(' ') && !el.str.startsWith(' ')) cur.text += ' ';
        cur.text += el.str;
        cur.fs = Math.max(cur.fs, el.fs);
      } else if (!cur.text.endsWith(' ')) cur.text += ' ';
      cur.right = Math.max(cur.right, el.lx + el.w);
      cur.fontNames.push(el.fontName);
      continue;
    }
    if (blank) continue;
    cur = { angle: el.angle, base: el.ly, left: el.lx, right: el.lx + el.w, fs: el.fs, text: el.str, fontNames: [el.fontName] };
    lines.push(cur);
  }
  for (const l of lines) l.text = l.text.replace(/\s+$/, '');
  // paragrafi
  lines.sort((p, q) => p.angle - q.angle || q.base - p.base || p.left - q.left);
  const blocks = [];
  const open = [];
  for (const ln of lines) {
    let target = null;
    for (let k = open.length - 1; k >= 0 && k >= open.length - 12; k--) {
      const bl = open[k];
      const last = bl.lines[bl.lines.length - 1];
      if (bl.angle !== ln.angle) continue;
      if (Math.abs(last.fs - ln.fs) > 0.18 * Math.max(last.fs, ln.fs)) continue;
      const dy = last.base - ln.base;
      if (dy < 0.6 * ln.fs || dy > 1.9 * ln.fs) continue;
      if (bl.lines.length >= 2) { const prevDy = bl.lines[bl.lines.length - 2].base - last.base; if (Math.abs(prevDy - dy) > 0.3 * ln.fs) continue; }
      const overlap = Math.min(bl.right, ln.right) - Math.max(bl.left, ln.left);
      if (overlap < Math.min(0.3 * (ln.right - ln.left), 3 * ln.fs)) continue;
      if (Math.abs(ln.left - bl.left) > 6 * ln.fs) continue;
      target = bl; break;
    }
    if (target) {
      target.lines.push(ln);
      target.left = Math.min(target.left, ln.left); target.right = Math.max(target.right, ln.right);
    } else {
      const bl = { angle: ln.angle, lines: [ln], left: ln.left, right: ln.right };
      open.push(bl); blocks.push(bl);
    }
  }
  return blocks.map((bl, i) => finishBlock(bl, i, styles));
}

function finishBlock(bl, i, styles) {
  const lines = bl.lines;
  const fs = median(lines.map((l) => l.fs));
  const lineHeight = lines.length > 1 ? (lines[0].base - lines[lines.length - 1].base) / (lines.length - 1) : fs * 1.2;
  const box = [bl.left, lines[lines.length - 1].base - 0.25 * fs, bl.right, lines[0].base + 0.82 * fs];
  const { quad, rect } = boxToPage(bl.angle, box);
  const fontName = mostCommon(lines.flatMap((l) => l.fontNames));
  const st = styles[fontName] || {};
  return {
    id: 'b' + i, angle: bl.angle, box, quad, rect,
    lines: lines.map((l) => ({ text: l.text, left: l.left, right: l.right, base: l.base, fs: l.fs })),
    text: joinLines(lines, bl.right - bl.left),
    fontSize: fs, lineHeight, fontName, fontFamily: st.fontFamily || 'sans-serif',
    align: guessAlign(lines, bl.left, bl.right, fs),
  };
}

function guessAlign(lines, left, right, fs) {
  if (lines.length < 2) return 'left';
  const tol = 0.6 * fs;
  const L = lines.every((l) => Math.abs(l.left - left) < tol);
  const R = lines.slice(0, -1).every((l) => Math.abs(l.right - right) < tol);
  if (L && R) return 'justify';
  if (L) return 'left';
  if (lines.every((l) => Math.abs(l.right - right) < tol)) return 'right';
  const mid = (left + right) / 2;
  if (lines.every((l) => Math.abs((l.left + l.right) / 2 - mid) < tol)) return 'center';
  return 'left';
}

/** Unisce le righe di un paragrafo: le righe "piene" si uniscono con uno spazio, quelle corte vanno a capo. */
export function joinLines(lines, width) {
  let s = '';
  lines.forEach((l, i) => {
    if (i === 0) { s = l.text; return; }
    const prev = lines[i - 1];
    const full = prev.right - prev.left > 0.75 * width;
    if (full && /[A-Za-zÀ-ÿ]-$/.test(s) && /^[a-zà-ÿ]/.test(l.text)) s = s.slice(0, -1) + l.text; // sillabazione
    else s += (full ? ' ' : '\n') + l.text;
  });
  return s;
}

function median(a) { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)] || 0; }
function mostCommon(a) { const m = new Map(); let best = null, n = 0; for (const x of a) { const c = (m.get(x) || 0) + 1; m.set(x, c); if (c > n) { n = c; best = x; } } return best; }

/**
 * Va a capo nella larghezza indicata. widthOf(str) → larghezza.
 * Rispetta gli a capo espliciti; spezza le parole troppo lunghe.
 */
export function wrapText(text, maxWidth, widthOf) {
  const out = [];
  for (const para of String(text).replace(/\r\n?/g, '\n').split('\n')) {
    if (!maxWidth || maxWidth <= 0) { out.push(para); continue; }
    const words = para.split(/( +)/).filter((w) => w.length);
    let line = '';
    for (const w of words) {
      const cand = line + w;
      if (line && widthOf(cand.trimEnd()) <= maxWidth + 1e-6) { line = cand; continue; }
      if (line && /^ +$/.test(w)) { out.push(line.trimEnd()); line = ''; continue; }
      if (line) out.push(line.trimEnd());
      line = w;
      // parola più lunga della riga: si spezza a caratteri
      while (widthOf(line) > maxWidth && line.length > 1) {
        let k = line.length - 1;
        while (k > 1 && widthOf(line.slice(0, k)) > maxWidth) k--;
        out.push(line.slice(0, k));
        line = line.slice(k);
      }
    }
    out.push(line.trimEnd());
  }
  return out;
}

/** Prefisso e suffisso comuni tra due stringhe → { start, oldEnd, newEnd } (intervalli semiaperti). */
export function diffRange(a, b) {
  let s = 0;
  while (s < a.length && s < b.length && a[s] === b[s]) s++;
  let ea = a.length, eb = b.length;
  while (ea > s && eb > s && a[ea - 1] === b[eb - 1]) { ea--; eb--; }
  return { start: s, oldEnd: ea, newEnd: eb };
}

/** URL ed email in un testo → [{ start, end, kind:'url'|'email', value }]. */
export function findLinksInText(text) {
  const out = [];
  const re = /\b((?:https?:\/\/|www\.)[^\s<>"'«»()]+(?:\([^\s<>"'()]*\)[^\s<>"'«»()]*)*)|\b([A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,})\b/g;
  let m;
  while ((m = re.exec(text))) {
    let v = m[0];
    let end = m.index + v.length;
    if (m[1]) {
      const orig = v.length;
      for (;;) {
        if (/[.,;:!?'"’”\]}]$/.test(v)) { v = v.slice(0, -1); continue; }
        if (v.endsWith(')') && (v.match(/\(/g) || []).length < (v.match(/\)/g) || []).length) { v = v.slice(0, -1); continue; }
        break;
      }
      end -= orig - v.length;
      if (v.length < 8) continue;
      out.push({ start: m.index, end, kind: 'url', value: /^www\./i.test(v) ? 'https://' + v : v });
    } else out.push({ start: m.index, end, kind: 'email', value: v });
  }
  return out;
}
