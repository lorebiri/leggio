// Area «commenti» — logica pura (niente DOM, niente pdf-lib): colori, rettangoli, QuadPoints,
// smussamento del tratto, nuvole, misure, date PDF. Coperta da test/commenti-geom.test.js.

export const PALETTE = ['#ffd400', '#ff6b6b', '#4dabf7', '#51cf66', '#cc5de8', '#ff922b', '#212529', '#ffffff'];
export const HIGHLIGHT_PALETTE = ['#ffd400', '#8ce99a', '#74c0fc', '#ffa8a8', '#e599f7', '#ffc078'];

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
/** Arrotonda per scrivere numeri compatti negli stream PDF. */
export const r2 = (v) => { const n = Math.round((Number(v) || 0) * 100) / 100; return Object.is(n, -0) ? 0 : n; };

/** '#rrggbb' | '#rgb' → [r,g,b] in 0..1. Valori non validi → fallback. */
export function hexToRgb(hex, fallback = [0, 0, 0]) {
  if (typeof hex !== 'string') return fallback;
  let s = hex.trim().replace(/^#/, '');
  if (/^[0-9a-f]{3}$/i.test(s)) s = s.split('').map((c) => c + c).join('');
  if (!/^[0-9a-f]{6}$/i.test(s)) return fallback;
  return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16) / 255);
}
/** Colore (array di 1, 3 o 4 componenti, 0..1 oppure 0..255) → '#rrggbb' o null. */
export function rgbToHex(c, scale255) {
  if (!c || typeof c.length !== 'number' || c.length === 0) return null;
  const a = Array.from(c, (v) => (isNum(+v) ? +v : 0));
  const scale = scale255 ?? a.some((v) => v > 1) ? 255 : 1;
  const n = a.map((v) => clamp(v / scale, 0, 1));
  let rgb;
  if (n.length === 1) rgb = [n[0], n[0], n[0]];
  else if (n.length === 4) rgb = [(1 - n[0]) * (1 - n[3]), (1 - n[1]) * (1 - n[3]), (1 - n[2]) * (1 - n[3])];
  else if (n.length >= 3) rgb = n.slice(0, 3);
  else return null;
  return '#' + rgb.map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('');
}

/** Rettangolo normalizzato [x1,y1,x2,y2] con x1<=x2, y1<=y2; null se non valido. */
export function normRect(r) {
  if (!r || r.length < 4) return null;
  const v = Array.from(r).slice(0, 4).map(Number);
  if (!v.every(isNum)) return null;
  return [Math.min(v[0], v[2]), Math.min(v[1], v[3]), Math.max(v[0], v[2]), Math.max(v[1], v[3])];
}
export function rectFromPoints(pts, pad = 0) {
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const p of pts) {
    if (!p || !isNum(p[0]) || !isNum(p[1])) continue;
    if (p[0] < x1) x1 = p[0]; if (p[0] > x2) x2 = p[0]; if (p[1] < y1) y1 = p[1]; if (p[1] > y2) y2 = p[1];
  }
  if (x1 === Infinity) return null;
  return [x1 - pad, y1 - pad, x2 + pad, y2 + pad];
}
export function unionRect(a, b) { if (!a) return b; if (!b) return a; return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])]; }
export function inflate(r, d) { return [r[0] - d, r[1] - d, r[2] + d, r[3] + d]; }
export function pointInRect(x, y, r, tol = 0) { return x >= r[0] - tol && x <= r[2] + tol && y >= r[1] - tol && y <= r[3] + tol; }
export function rectArea(r) { return Math.max(0, r[2] - r[0]) * Math.max(0, r[3] - r[1]); }

/** Coppie piatte [x,y,x,y…] → [[x,y]…] (scarta valori non numerici e coppie incomplete). */
export function pairs(flat) {
  const out = [];
  if (!flat || typeof flat.length !== 'number') return out;
  const a = Array.from(flat, Number);
  for (let i = 0; i + 1 < a.length; i += 2) if (isNum(a[i]) && isNum(a[i + 1])) out.push([a[i], a[i + 1]]);
  return out;
}
export const flattenPts = (pts) => pts.flatMap((p) => [r2(p[0]), r2(p[1])]);

/** Rotazione della pagina normalizzata a 0/90/180/270. */
export function normRotation(rot) { return ((Math.round((Number(rot) || 0) / 90) * 90) % 360 + 360) % 360; }
/**
 * Punto PDF → riferimento "a schermo" di una pagina con /Rotate rot (la pagina appare ruotata in senso orario):
 * nel nuovo riferimento il testo diritto sullo schermo va da sinistra a destra e verso l'alto ha y crescente.
 */
export function toUpright(p, rot) {
  const [x, y] = p;
  return rot === 90 ? [y, -x] : rot === 180 ? [-x, -y] : rot === 270 ? [-y, x] : [x, y];
}
export function fromUpright(p, rot) { return toUpright(p, (360 - rot) % 360); }
const rectVia = (r, f) => normRect([...f([r[0], r[1]]), ...f([r[2], r[3]])]);
export const rectToUpright = (r, rot) => rectVia(r, (p) => toUpright(p, rot));
export const rectFromUpright = (r, rot) => rectVia(r, (p) => fromUpright(p, rot));

/**
 * Unisce i rettangoli della selezione di testo (spazio PDF) in righe.
 * rects: [[x1,y1,x2,y2]…] → righe [[x1,y1,x2,y2]…] dall'alto in basso (come appaiono sullo schermo).
 * rotation: /Rotate della pagina (sulle pagine ruotate le righe sono verticali nello spazio PDF).
 */
export function mergeLineRects(rects, rotation = 0) {
  const rot = normRotation(rotation);
  const rs = (rects || []).map(normRect).filter((r) => r && r[2] - r[0] > 0.2 && r[3] - r[1] > 0.2).map((r) => rectVia(r, (p) => toUpright(p, rot)));
  if (!rs.length) return [];
  // spessore = lato corto: non dipende dal verso del testo
  const th = (r) => Math.min(r[2] - r[0], r[3] - r[1]);
  const hs = rs.map(th).sort((a, b) => a - b);
  const med = hs[Math.floor(hs.length / 2)];
  // si scartano solo i riquadri spuri (molto spessi E che contengono altri pezzi della selezione, es. un
  // contenitore grande quanto la pagina): un titolo più alto del testo normale resta evidenziato
  const inside = (r, o) => { const cx = (o[0] + o[2]) / 2, cy = (o[1] + o[3]) / 2; return cx > r[0] && cx < r[2] && cy > r[1] && cy < r[3]; };
  const ok = rs.filter((r) => th(r) <= med * 3 || !rs.some((o) => o !== r && th(o) <= med * 3 && inside(r, o)));
  ok.sort((a, b) => (b[1] + b[3]) / 2 - (a[1] + a[3]) / 2 || a[0] - b[0]);
  const lines = [];
  for (const r of ok) {
    const h = r[3] - r[1];
    const line = lines.find((l) => {
      const lh = l[3] - l[1];
      const ov = Math.min(l[3], r[3]) - Math.max(l[1], r[1]);
      const gap = Math.max(h, lh) * 1.5;
      return ov > 0.5 * Math.min(h, lh) && r[0] <= l[2] + gap && r[2] >= l[0] - gap;
    });
    if (line) { line[0] = Math.min(line[0], r[0]); line[1] = Math.min(line[1], r[1]); line[2] = Math.max(line[2], r[2]); line[3] = Math.max(line[3], r[3]); }
    else lines.push([...r]);
  }
  return lines.sort((a, b) => b[3] - a[3] || a[0] - b[0]).map((l) => rectVia(l, (p) => fromUpright(p, rot)));
}

/**
 * Righe → QuadPoints nell'ordine usato da Acrobat: alto-sx, alto-dx, basso-sx, basso-dx
 * (riferiti al testo come appare sullo schermo: su una pagina ruotata il "basso" non è la y minima).
 */
export function linesToQuadPoints(lines, rotation = 0) {
  const rot = normRotation(rotation);
  return lines.flatMap((l) => {
    const [x1, y1, x2, y2] = rectVia(l, (p) => toUpright(p, rot));
    return [[x1, y2], [x2, y2], [x1, y1], [x2, y1]].flatMap((p) => fromUpright(p, rot)).map(r2);
  });
}
/**
 * QuadPoints → quadrilateri [{tl,tr,bl,br}] (punti PDF). Accetta anche ordini non standard.
 * rotation: /Rotate della pagina; alto/basso/sinistra/destra sono quelli visti sullo schermo.
 */
export function quadsFromPoints(qp, rotation = 0) {
  const rot = normRotation(rotation);
  const p = pairs(qp); const out = [];
  for (let i = 0; i + 3 < p.length; i += 4) {
    const s = p.slice(i, i + 4).map((pt) => ({ pt, u: toUpright(pt, rot) })).sort((a, b) => b.u[1] - a.u[1]);
    const top = s.slice(0, 2).sort((a, b) => a.u[0] - b.u[0]);
    const bot = s.slice(2).sort((a, b) => a.u[0] - b.u[0]);
    out.push({ tl: top[0].pt, tr: top[1].pt, bl: bot[0].pt, br: bot[1].pt });
  }
  return out;
}
export function quadsBounds(qp) { return rectFromPoints(pairs(qp)); }

/** Riduzione dei punti (Ramer–Douglas–Peucker). */
export function simplify(points, tol = 0.5) {
  if (points.length < 3) return points.slice();
  const sq = tol * tol;
  const keep = new Uint8Array(points.length); keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let max = 0, idx = -1;
    const [ax, ay] = points[a], [bx, by] = points[b];
    const dx = bx - ax, dy = by - ay, len = dx * dx + dy * dy;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = points[i];
      const t = len ? clamp(((px - ax) * dx + (py - ay) * dy) / len, 0, 1) : 0;
      const ex = ax + t * dx - px, ey = ay + t * dy - py, d = ex * ex + ey * ey;
      if (d > max) { max = d; idx = i; }
    }
    if (max > sq && idx > 0) { keep[idx] = 1; stack.push([a, idx], [idx, b]); }
  }
  return points.filter((_, i) => keep[i]);
}
/** Smussamento: media dei punti vicini entro un raggio (strength 0..1 → fino a ~3 pt); estremi fissi. */
export function smooth(points, strength = 0.5, maxRadius = 3) {
  if (points.length < 3 || strength <= 0) return points.slice();
  const R = strength * maxRadius;
  return points.map((p, i) => {
    if (i === 0 || i === points.length - 1) return p;
    let sx = p[0], sy = p[1], n = 1;
    for (const dir of [-1, 1]) {
      for (let j = i + dir; j >= 0 && j < points.length; j += dir) {
        if (Math.hypot(points[j][0] - p[0], points[j][1] - p[1]) > R) break;
        sx += points[j][0]; sy += points[j][1]; n++;
      }
    }
    return [sx / n, sy / n];
  });
}
/** Percorso PDF liscio (Bézier sui punti medi) per una polilinea. */
export function smoothPathOps(points) {
  const p = points;
  if (!p.length) return '';
  const P = (q) => `${r2(q[0])} ${r2(q[1])}`;
  if (p.length === 1) return `${P(p[0])} m ${r2(p[0][0] + 0.01)} ${r2(p[0][1])} l`;
  if (p.length === 2) return `${P(p[0])} m ${P(p[1])} l`;
  let s = `${P(p[0])} m`;
  let prev = p[0];
  for (let i = 1; i < p.length - 1; i++) {
    const mid = [(p[i][0] + p[i + 1][0]) / 2, (p[i][1] + p[i + 1][1]) / 2];
    const c1 = [prev[0] + (2 / 3) * (p[i][0] - prev[0]), prev[1] + (2 / 3) * (p[i][1] - prev[1])];
    const c2 = [mid[0] + (2 / 3) * (p[i][0] - mid[0]), mid[1] + (2 / 3) * (p[i][1] - mid[1])];
    s += ` ${P(c1)} ${P(c2)} ${P(mid)} c`;
    prev = mid;
  }
  return s + ` ${P(p[p.length - 1])} l`;
}

/** Distanza minima punto–polilinea. */
export function distToPolyline(x, y, pts) {
  if (!pts.length) return Infinity;
  if (pts.length === 1) return Math.hypot(x - pts[0][0], y - pts[0][1]);
  let best = Infinity;
  for (let i = 0; i + 1 < pts.length; i++) {
    const [ax, ay] = pts[i], [bx, by] = pts[i + 1];
    const dx = bx - ax, dy = by - ay, len = dx * dx + dy * dy;
    const t = len ? clamp(((x - ax) * dx + (y - ay) * dy) / len, 0, 1) : 0;
    best = Math.min(best, Math.hypot(ax + t * dx - x, ay + t * dy - y));
  }
  return best;
}
/** Gomma: toglie dai tratti i punti entro radius dal percorso della gomma; spezza i tratti. */
export function eraseFromStrokes(strokes, eraser, radius) {
  const out = [];
  let changed = false;
  for (const s of strokes) {
    let cur = [];
    for (const p of s) {
      if (distToPolyline(p[0], p[1], eraser) <= radius) { changed = true; if (cur.length > 1) out.push(cur); cur = []; }
      else cur.push(p);
    }
    if (cur.length > 1 || (cur.length === 1 && s.length === 1)) out.push(cur);
    else if (cur.length === 1) changed = true;
  }
  return { strokes: out, changed };
}

/** Bordo a nuvola attorno a un poligono chiuso: operatori PDF. */
export function cloudPathOps(vertices, intensity = 1, lineWidth = 1) {
  const pts = vertices.slice();
  if (pts.length < 3) return '';
  let area = 0;
  for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; area += a[0] * b[1] - b[0] * a[1]; }
  if (area < 0) pts.reverse();
  const arc = Math.max(4, 6 * intensity + lineWidth * 2);
  let s = '';
  let first = true;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const n = Math.max(1, Math.round(len / (arc * 1.6)));
    for (let k = 0; k < n; k++) {
      const p0 = [a[0] + (b[0] - a[0]) * (k / n), a[1] + (b[1] - a[1]) * (k / n)];
      const p1 = [a[0] + (b[0] - a[0]) * ((k + 1) / n), a[1] + (b[1] - a[1]) * ((k + 1) / n)];
      const dx = p1[0] - p0[0], dy = p1[1] - p0[1];
      const seg = Math.hypot(dx, dy) || 1;
      const nx = dy / seg, ny = -dx / seg; // normale esterna per poligono antiorario
      const bulge = seg * 0.65;
      if (first) { s += `${r2(p0[0])} ${r2(p0[1])} m`; first = false; }
      s += ` ${r2(p0[0] + nx * bulge)} ${r2(p0[1] + ny * bulge)} ${r2(p1[0] + nx * bulge)} ${r2(p1[1] + ny * bulge)} ${r2(p1[0])} ${r2(p1[1])} c`;
    }
  }
  return s + ' h';
}
export function rectVertices([x1, y1, x2, y2]) { return [[x1, y1], [x2, y1], [x2, y2], [x1, y2]]; }

/** Ellisse inscritta nel rettangolo: operatori PDF. */
export function ellipseOps([x1, y1, x2, y2]) {
  const k = 0.5523;
  const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2, rx = (x2 - x1) / 2, ry = (y2 - y1) / 2;
  const f = r2;
  return `${f(cx + rx)} ${f(cy)} m ${f(cx + rx)} ${f(cy + ry * k)} ${f(cx + rx * k)} ${f(cy + ry)} ${f(cx)} ${f(cy + ry)} c ` +
    `${f(cx - rx * k)} ${f(cy + ry)} ${f(cx - rx)} ${f(cy + ry * k)} ${f(cx - rx)} ${f(cy)} c ` +
    `${f(cx - rx)} ${f(cy - ry * k)} ${f(cx - rx * k)} ${f(cy - ry)} ${f(cx)} ${f(cy - ry)} c ` +
    `${f(cx + rx * k)} ${f(cy - ry)} ${f(cx + rx)} ${f(cy - ry * k)} ${f(cx + rx)} ${f(cy)} c h`;
}

/** Terminazione di linea (freccia ecc.) all'estremo `tip` di una linea che arriva da `from`. */
export function lineEndingOps(kind, tip, from, w) {
  const ang = Math.atan2(tip[1] - from[1], tip[0] - from[0]);
  const size = Math.max(6, w * 4);
  const pt = (a, d) => [tip[0] - d * Math.cos(ang + a), tip[1] - d * Math.sin(ang + a)];
  const P = (p) => `${r2(p[0])} ${r2(p[1])}`;
  switch (kind) {
    case 'OpenArrow': return { stroke: `${P(pt(0.45, size))} m ${P(tip)} l ${P(pt(-0.45, size))} l` };
    case 'ClosedArrow': return { fill: `${P(pt(0.45, size))} m ${P(tip)} l ${P(pt(-0.45, size))} l h` };
    case 'Butt': {
      const a = [tip[0] + Math.sin(ang) * size / 2, tip[1] - Math.cos(ang) * size / 2], b = [tip[0] - Math.sin(ang) * size / 2, tip[1] + Math.cos(ang) * size / 2];
      return { stroke: `${P(a)} m ${P(b)} l` };
    }
    case 'Circle': { const r = size / 3; return { fill: ellipseOps([tip[0] - r, tip[1] - r, tip[0] + r, tip[1] + r]) }; }
    case 'Square': { const r = size / 3; return { fill: `${r2(tip[0] - r)} ${r2(tip[1] - r)} ${r2(2 * r)} ${r2(2 * r)} re` }; }
    default: return {};
  }
}

// ---------------------------------------------------------------- misure
export const DOC_UNITS = { pt: 1, in: 72, cm: 72 / 2.54, mm: 72 / 25.4 };
export const REAL_UNITS = ['mm', 'cm', 'm', 'km', 'in', 'ft', 'yd', 'mi', 'pt'];
const REAL_OK = new Set(REAL_UNITS);

/** Scala { docValue, docUnit (pt|in|cm|mm), realValue, realUnit }: valori non validi → 1 cm = 1 cm. */
export function normScale(s) {
  const d = { docValue: 1, docUnit: 'cm', realValue: 1, realUnit: 'cm' };
  if (!s || typeof s !== 'object') return d;
  const dv = Number(s.docValue), rv = Number(s.realValue);
  return {
    docValue: isNum(dv) && dv > 0 ? dv : d.docValue,
    docUnit: DOC_UNITS[s.docUnit] ? s.docUnit : d.docUnit,
    realValue: isNum(rv) && rv > 0 ? rv : d.realValue,
    realUnit: REAL_OK.has(s.realUnit) ? s.realUnit : d.realUnit,
  };
}
/** Fattore: punti PDF → unità reali. */
export function ptToReal(scale) { const s = normScale(scale); return s.realValue / (s.docValue * DOC_UNITS[s.docUnit]); }
export function scaleLabel(scale) { const s = normScale(scale); return `${fmtNum(s.docValue)} ${s.docUnit} = ${fmtNum(s.realValue)} ${s.realUnit}`; }
export function polylineLength(pts) { let l = 0; for (let i = 0; i + 1 < pts.length; i++) l += Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]); return l; }
export function polygonArea(pts) { let a = 0; for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; a += p[0] * q[1] - q[0] * p[1]; } return Math.abs(a) / 2; }
export function fmtNum(v, dec = 2) {
  if (!isNum(v)) return '—';
  return v.toLocaleString('it-IT', { maximumFractionDigits: dec, minimumFractionDigits: 0 });
}
/** kind: distance|perimeter|area; pts in punti PDF → { value, unit, label } */
export function measure(kind, pts, scale) {
  const f = ptToReal(scale); const u = normScale(scale).realUnit;
  if (kind === 'area') { const v = polygonArea(pts) * f * f; return { value: v, unit: u + '²', label: `${fmtNum(v)} ${u}²` }; }
  const len = kind === 'perimeter' && pts.length > 2 ? polylineLength([...pts, pts[0]]) : polylineLength(pts);
  const v = len * f;
  return { value: v, unit: u, label: `${fmtNum(v)} ${u}` };
}

// ---------------------------------------------------------------- date
/** Date → stringa data PDF "D:YYYYMMDDHHmmSS+hh'mm'". */
export function pdfDate(d = new Date()) {
  const p = (n, l = 2) => String(Math.abs(Math.trunc(n))).padStart(l, '0');
  const off = -d.getTimezoneOffset();
  const tz = off === 0 ? 'Z' : `${off > 0 ? '+' : '-'}${p(off / 60)}'${p(off % 60)}'`;
  return `D:${p(d.getFullYear(), 4)}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}${tz}`;
}
/** Stringa data PDF → Date (o null). Tollerante con formati incompleti o sporchi. */
export function parsePdfDate(s) {
  if (!s || typeof s !== 'string') return null;
  const m = s.trim().match(/^(?:D:)?(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?\s*([Zz+-])?\s*(\d{2})?'?(\d{2})?'?/);
  if (!m) return null;
  const [, Y, Mo = '01', D = '01', H = '00', Mi = '00', S = '00', sign, th = '00', tm = '00'] = m;
  if (+Mo < 1 || +Mo > 12 || +D < 1 || +D > 31 || +H > 23 || +Mi > 59 || +S > 59) return null;
  let t;
  if (sign === '+' || sign === '-') t = Date.UTC(+Y, +Mo - 1, +D, +H, +Mi, +S) - (sign === '+' ? 1 : -1) * ((+th) * 60 + (+tm)) * 60000;
  else if (sign) t = Date.UTC(+Y, +Mo - 1, +D, +H, +Mi, +S);
  else t = new Date(+Y, +Mo - 1, +D, +H, +Mi, +S).getTime();
  return isNum(t) ? new Date(t) : null;
}
export function fmtDate(d) { return d ? d.toLocaleString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''; }

/** Identificativo univoco per /NM. */
export function newName() { return 'leggio-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10); }

/** Testo spezzato in righe larghe al massimo maxWidth (widthOf(str) → larghezza). */
export function wrapText(text, maxWidth, widthOf) {
  const out = [];
  for (const para of String(text ?? '').replace(/\r\n?/g, '\n').split('\n')) {
    if (!para) { out.push(''); continue; }
    let line = '';
    for (const word of para.split(/(\s+)/)) {
      if (!word) continue;
      const cand = line + word;
      if (widthOf(cand) <= maxWidth) { line = cand; continue; }
      if (line.trim()) { out.push(line.trimEnd()); line = ''; }
      const w = word.trimStart();
      if (!w) continue;
      if (widthOf(w) <= maxWidth) { line = w; continue; }
      let chunk = '';
      for (const ch of w) { if (widthOf(chunk + ch) > maxWidth && chunk) { out.push(chunk); chunk = ''; } chunk += ch; }
      line = chunk;
    }
    out.push(line.trimEnd());
  }
  return out;
}

/** Testo segnaposto dei timbri personalizzati: {data} {ora} {autore} {numero} {anno}. */
export function fillStampFields(tpl, { author = '', number = 1, date = new Date() } = {}) {
  const pad = (n) => String(n).padStart(2, '0');
  return String(tpl ?? '')
    .replace(/\{data\}/gi, `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}`)
    .replace(/\{ora\}/gi, `${pad(date.getHours())}:${pad(date.getMinutes())}`)
    .replace(/\{anno\}/gi, String(date.getFullYear()))
    .replace(/\{autore\}/gi, author || '')
    .replace(/\{numero\}/gi, String(number));
}
