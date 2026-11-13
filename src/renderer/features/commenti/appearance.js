// Area «commenti» — generazione degli aspetti (/AP /N) delle annotazioni come operatori PDF.
// Logica pura: riceve una "spec" normalizzata e oggetti font (encodeText, widthOfTextAtSize)
// e restituisce { content, bbox, gs, fonts, xobjects }. annots.js trasforma il risultato in oggetti PDF.
import { r2, quadsFromPoints, smoothPathOps, ellipseOps, cloudPathOps, rectVertices, lineEndingOps, wrapText, normRect, inflate, normRotation } from './geom.js';

const col = (c, op) => (c && c.length >= 3 ? `${r2(c[0])} ${r2(c[1])} ${r2(c[2])} ${op}` : '');
const P = (p) => `${r2(p[0])} ${r2(p[1])}`;

/** Timbri predefiniti: etichetta, colore, nome standard PDF (/Name). */
export const STAMPS = [
  { id: 'ricevuto', label: 'RICEVUTO', sub: 'il {data}', color: [0.15, 0.35, 0.7], name: 'Leggio.Ricevuto' },
  { id: 'visto-si-liquidi', label: 'VISTO SI LIQUIDI', sub: '{autore} · {data}', color: [0.13, 0.55, 0.2], name: 'Leggio.VistoSiLiquidi' },
  { id: 'pagato', label: 'PAGATO', sub: 'il {data} · mandato n. {numero}', color: [0.13, 0.55, 0.2], name: 'Leggio.Pagato' },
  { id: 'registrato', label: 'REGISTRATO', sub: 'il {data}', color: [0.15, 0.35, 0.7], name: 'Leggio.Registrato' },
  { id: 'approvato', label: 'APPROVATO', sub: '', color: [0.13, 0.55, 0.2], name: 'Approved' },
  { id: 'non-approvato', label: 'NON APPROVATO', sub: '', color: [0.75, 0.1, 0.1], name: 'NotApproved' },
  { id: 'bozza', label: 'BOZZA', sub: '', color: [0.15, 0.35, 0.7], name: 'Draft' },
  { id: 'riservato', label: 'RISERVATO', sub: '', color: [0.75, 0.1, 0.1], name: 'NotForPublicRelease' },
  { id: 'confidenziale', label: 'CONFIDENZIALE', sub: '', color: [0.75, 0.1, 0.1], name: 'Confidential' },
  { id: 'rivisto', label: 'RIVISTO', sub: '', color: [0.15, 0.35, 0.7], name: 'Leggio.Rivisto' },
  { id: 'urgente', label: 'URGENTE', sub: '', color: [0.85, 0.3, 0.05], name: 'Leggio.Urgente' },
  { id: 'copia-conforme', label: 'COPIA CONFORME', sub: '', color: [0.15, 0.35, 0.7], name: 'Leggio.CopiaConforme' },
  { id: 'annullato', label: 'ANNULLATO', sub: '', color: [0.75, 0.1, 0.1], name: 'Leggio.Annullato' },
  { id: 'definitivo', label: 'DEFINITIVO', sub: '', color: [0.13, 0.55, 0.2], name: 'Final' },
];
export function stampById(id) { return STAMPS.find((s) => s.id === id || s.name === id) || null; }

/** Dimensione naturale (in punti) di un timbro vettoriale. */
export function stampSize(label, sub, bold) {
  const fs = 20;
  const w = Math.max(bold.widthOfTextAtSize(label, fs), sub ? bold.widthOfTextAtSize(sub, 9) : 0) + 30;
  return { w: Math.max(80, w), h: sub ? 58 : 44, fs };
}

/** Ripulisce il testo dai caratteri che il font standard non sa codificare. */
export function safeText(font, s) {
  const str = String(s ?? '');
  if (!font?.getCharacterSet) return str;
  if (!font.__cs) { try { font.__cs = new Set(font.getCharacterSet()); } catch { font.__cs = null; } }
  if (!font.__cs) return str;
  let out = '';
  for (const ch of str) {
    const cp = ch.codePointAt(0);
    if (font.__cs.has(cp)) out += ch;
    else if (ch === '’' || ch === '‘') out += font.__cs.has(39) ? "'" : '?';
    else if (ch === '\t') out += ' ';
    else if (ch === '\n' || ch === '\r') out += ch;
    else out += font.__cs.has(63) ? '?' : '';
  }
  return out;
}
const enc = (font, s) => font.encodeText(safeText(font, s)).toString();

/**
 * spec: { type, rect, color, interior, opacity, width, dash, quadPoints, inkList, vertices, line, lineEnding,
 *         cloud, text, fontSize, textColor, align, stamp:{label, sub, color}, image:{w,h}, measureLabel }
 * fonts: { regular, bold } (PDFFont pdf-lib o finti nei test)
 */
export function buildAppearance(spec, fonts = {}) {
  const t = spec.type;
  const rot = normRotation(spec.rotation);
  if (rot && (t === 'FreeText' || t === 'Stamp')) {
    // pagina ruotata: si disegna diritto in un riquadro locale e /Matrix lo ruota come la pagina,
    // così testo e timbro appaiono diritti sullo schermo (apMatrix e i lettori lo portano nel /Rect)
    const r = normRect(spec.rect) || [0, 0, 1, 1];
    const swap = rot === 90 || rot === 270;
    const W = swap ? r[3] - r[1] : r[2] - r[0], H = swap ? r[2] - r[0] : r[3] - r[1];
    const inner = buildAppearance({ ...spec, rotation: 0, rect: [0, 0, W, H] }, fonts);
    if (!inner) return null;
    const a = (rot * Math.PI) / 180, c = Math.round(Math.cos(a)), s = Math.round(Math.sin(a));
    return { ...inner, matrix: [c, s, -s, c, 0, 0] };
  }
  const op = spec.opacity ?? 1;
  const w = Number.isFinite(spec.width) ? spec.width : 1;
  const gs = { CA: op, ca: op };
  let content = '';
  let bbox = normRect(spec.rect) || [0, 0, 1, 1];
  const fontsUsed = {};
  const xobjects = {};
  const dash = spec.dash ? `[${spec.dash.map(r2).join(' ')}] 0 d ` : '';
  switch (t) {
    case 'Highlight': {
      gs.BM = 'Multiply';
      content = `/GS0 gs ${col(spec.color || [1, 0.83, 0], 'rg')} `;
      for (const q of quadsFromPoints(spec.quadPoints, spec.rotation)) {
        // leggero arrotondamento ai lati come Acrobat (lungo il verso del testo, anche su pagine ruotate)
        const { h, dir, up } = quadAxes(q); const k = h * 0.12;
        const side = (p, s) => P([p[0] + dir[0] * k * s + up[0] * h / 2, p[1] + dir[1] * k * s + up[1] * h / 2]);
        content += `${P(q.bl)} m ${P(q.br)} l ${side(q.br, 1)} ${P(q.tr)} v ${P(q.tl)} l ${side(q.bl, -1)} ${P(q.bl)} v f `;
      }
      break;
    }
    case 'Underline': case 'StrikeOut': case 'Squiggly': {
      content = `/GS0 gs ${col(spec.color || [0, 0, 0], 'RG')} `;
      for (const q of quadsFromPoints(spec.quadPoints, spec.rotation)) {
        // dir = verso del testo, up = verso l'alto della riga: le linee seguono il testo anche su pagine ruotate
        const { h, len, dir, up } = quadAxes(q);
        const at = (p, d, u) => P([p[0] + dir[0] * d + up[0] * u, p[1] + dir[1] * d + up[1] * u]);
        const lw = Math.max(0.5, h / 16);
        if (t === 'StrikeOut') {
          content += `${r2(lw)} w ${at(q.bl, 0, h * 0.42)} m ${at(q.br, 0, h * 0.42)} l S `;
        } else if (t === 'Underline') {
          content += `${r2(lw)} w ${at(q.bl, 0, lw * 1.2)} m ${at(q.br, 0, lw * 1.2)} l S `;
        } else {
          const amp = Math.max(1, h / 12), step = amp * 2.2;
          content += `${r2(lw)} w 1 J 1 j ${at(q.bl, 0, amp)} m `;
          let up2 = true;
          for (let d = step; d < len + step; d += step) { content += `${at(q.bl, Math.min(d, len), amp + (up2 ? amp : -amp))} l `; up2 = !up2; }
          content += 'S ';
        }
      }
      bbox = inflate(bbox, 2);
      break;
    }
    case 'Caret': {
      const [x1, y1, x2, y2] = bbox;
      content = `/GS0 gs ${col(spec.color || [0, 0, 1], 'rg')} ${r2(x1)} ${r2(y1)} m ${r2((x1 + x2) / 2)} ${r2(y2)} l ${r2(x2)} ${r2(y1)} l ${r2((x1 + x2) / 2)} ${r2(y1 + (y2 - y1) * 0.3)} l h f`;
      break;
    }
    case 'Text': {
      // icona nota 20×20 disegnata in un riquadro proprio (BBox 0 0 20 20)
      bbox = [0, 0, 20, 20];
      if (spec.reply) { content = ''; break; } // risposte e stati: nessun disegno
      const c = spec.color || [1, 0.83, 0];
      content = `/GS0 gs ${col(c, 'rg')} 0.25 0.25 0.25 RG 0.8 w 1 j 1.5 3.5 m 1.5 18.5 l 18.5 18.5 l 18.5 3.5 l 9 3.5 l 5 0.8 l 5.5 3.5 l h B ` +
        `0.25 0.25 0.25 RG 1 w 4.5 14.5 m 15.5 14.5 l S 4.5 11.5 m 15.5 11.5 l S 4.5 8.5 m 12 8.5 l S`;
      break;
    }
    case 'FreeText': {
      const font = fonts.regular;
      const fs = spec.fontSize || 12;
      const [x1, y1, x2, y2] = bbox;
      const bw = spec.borderWidth ?? (spec.color ? 1 : 0);
      if (spec.interior) content += `${col(spec.interior, 'rg')} ${r2(x1)} ${r2(y1)} ${r2(x2 - x1)} ${r2(y2 - y1)} re f `;
      if (bw > 0 && spec.color) content += `${col(spec.color, 'RG')} ${r2(bw)} w ${r2(x1 + bw / 2)} ${r2(y1 + bw / 2)} ${r2(x2 - x1 - bw)} ${r2(y2 - y1 - bw)} re S `;
      if (font && spec.text) {
        const pad = 2 + bw;
        const lines = wrapText(safeText(font, spec.text), x2 - x1 - pad * 2, (s) => font.widthOfTextAtSize(s, fs));
        const lh = fs * 1.18;
        content += `q ${r2(x1)} ${r2(y1)} ${r2(x2 - x1)} ${r2(y2 - y1)} re W n BT /F1 ${r2(fs)} Tf ${col(spec.textColor || [0, 0, 0], 'rg')} `;
        let y = y2 - pad - fs * 0.92;
        for (const line of lines) {
          const lw = font.widthOfTextAtSize(line, fs);
          const x = spec.align === 2 ? x2 - pad - lw : spec.align === 1 ? (x1 + x2 - lw) / 2 : x1 + pad;
          content += `1 0 0 1 ${r2(x)} ${r2(y)} Tm ${enc(font, line)} Tj `;
          y -= lh;
        }
        content += 'ET Q';
        fontsUsed.F1 = 'regular';
      }
      content = '/GS0 gs ' + content;
      break;
    }
    case 'Square': case 'Circle': {
      const r = inflate(bbox, -w / 2);
      const inset = cloudInset(spec.cloud, w);
      const path = spec.cloud ? cloudPathOps(t === 'Square' ? rectVertices(inflate(r, -inset)) : ellipsePoints(inflate(r, -inset)), spec.cloud, w)
        : t === 'Square' ? `${r2(r[0])} ${r2(r[1])} ${r2(r[2] - r[0])} ${r2(r[3] - r[1])} re` : ellipseOps(r);
      content = `/GS0 gs ${r2(w)} w ${dash}${col(spec.color, 'RG')} ${col(spec.interior, 'rg')} ${path} ${paintOp(spec, w)}`;
      break;
    }
    case 'Polygon': case 'PolyLine': {
      const pts = spec.vertices || [];
      let path;
      if (t === 'Polygon' && spec.cloud) path = cloudPathOps(pts, spec.cloud, w);
      else path = pts.map((p, i) => `${P(p)} ${i ? 'l' : 'm'}`).join(' ') + (t === 'Polygon' ? ' h' : '');
      content = `/GS0 gs 1 j ${r2(w)} w ${dash}${col(spec.color, 'RG')} ${col(spec.interior, 'rg')} ${path} ${t === 'Polygon' ? paintOp(spec, w) : (w > 0 && spec.color ? 'S' : 'n')} `;
      if (t === 'PolyLine' && pts.length > 1 && spec.lineEnding) content += endings(spec, pts[0], pts[1], pts[pts.length - 1], pts[pts.length - 2], w);
      if (spec.measureLabel && fonts.regular) { const c = centroid(pts); content += labelOps(fonts.regular, spec.measureLabel, c, spec.color, (rot * Math.PI) / 180, rot); fontsUsed.F1 = 'regular'; }
      bbox = inflate(bbox, w * 2 + (spec.cloud ? cloudInset(spec.cloud, w) : 0));
      break;
    }
    case 'Line': {
      const [ax, ay, bx, by] = spec.line;
      content = `/GS0 gs 1 J 1 j ${r2(w)} w ${dash}${col(spec.color, 'RG')} ${col(spec.color, 'rg')} ${r2(ax)} ${r2(ay)} m ${r2(bx)} ${r2(by)} l S `;
      content += endings(spec, [ax, ay], [bx, by], [bx, by], [ax, ay], w);
      if (spec.measureLabel && fonts.regular) {
        content += labelOps(fonts.regular, spec.measureLabel, [(ax + bx) / 2, (ay + by) / 2], spec.color, Math.atan2(by - ay, bx - ax), rot);
        fontsUsed.F1 = 'regular';
      }
      break;
    }
    case 'Ink': {
      content = `/GS0 gs 1 J 1 j ${r2(w)} w ${col(spec.color, 'RG')} `;
      for (const stroke of spec.inkList || []) if (stroke.length) content += smoothPathOps(stroke) + ' S ';
      break;
    }
    case 'Stamp': {
      if (spec.image) {
        bbox = [0, 0, spec.image.w, spec.image.h];
        content = `/GS0 gs q ${r2(spec.image.w)} 0 0 ${r2(spec.image.h)} 0 0 cm /Im0 Do Q`;
        xobjects.Im0 = 'image';
        break;
      }
      const s = spec.stamp || { label: 'APPROVATO', color: [0.13, 0.55, 0.2] };
      const bold = fonts.bold;
      const { w: sw, h: sh, fs } = stampSize(safeText(bold, s.label), s.sub ? safeText(bold, s.sub) : '', bold);
      bbox = [0, 0, sw, sh];
      const c = s.color;
      content = `/GS0 gs ${col(c, 'RG')} ${col(c, 'rg')} 2.5 w ${rounded(1.5, 1.5, sw - 3, sh - 3, 7)} S 0.8 w ${rounded(5, 5, sw - 10, sh - 10, 5)} S `;
      const lw = bold.widthOfTextAtSize(safeText(bold, s.label), fs);
      const ty = s.sub ? sh - 13 - fs * 0.72 : (sh - fs * 0.72) / 2;
      content += `BT /F2 ${fs} Tf 1 0 0 1 ${r2((sw - lw) / 2)} ${r2(ty)} Tm ${enc(bold, s.label)} Tj ET `;
      if (s.sub) {
        const subw = bold.widthOfTextAtSize(safeText(bold, s.sub), 9);
        content += `BT /F2 9 Tf 1 0 0 1 ${r2((sw - subw) / 2)} 12 Tm ${enc(bold, s.sub)} Tj ET`;
      }
      fontsUsed.F2 = 'bold';
      break;
    }
    default:
      return null;
  }
  return { content: content.trim(), bbox: bbox.map(r2), gs, fonts: fontsUsed, xobjects };
}

/** Assi di un quadrilatero: altezza h, lunghezza len, verso del testo dir e verso l'alto up (unitari). */
function quadAxes(q) {
  const vx = q.br[0] - q.bl[0], vy = q.br[1] - q.bl[1];
  const len = Math.hypot(vx, vy);
  const dir = len ? [vx / len, vy / len] : [1, 0];
  const ux = q.tl[0] - q.bl[0], uy = q.tl[1] - q.bl[1];
  const h = Math.hypot(ux, uy);
  const up = h ? [ux / h, uy / h] : [-dir[1], dir[0]];
  return { h, len, dir, up };
}

/** Quanto sporgono gli archi della nuvola (stessa formula di cloudPathOps). */
export function cloudInset(intensity, w) { if (!intensity) return 0; const arc = Math.max(4, 6 * intensity + w * 2); return arc * 0.85 + w / 2; }
function paintOp(spec, w) {
  const stroke = spec.color && w > 0; const fill = !!spec.interior;
  return stroke && fill ? 'B' : fill ? 'f' : stroke ? 'S' : 'n';
}
function endings(spec, startTip, startFrom, endTip, endFrom, w) {
  const [le1, le2] = spec.lineEnding || [];
  let s = '';
  for (const [kind, tip, from] of [[le1, startTip, startFrom], [le2, endTip, endFrom]]) {
    if (!kind || kind === 'None') continue;
    const o = lineEndingOps(kind, tip, from, w);
    if (o.stroke) s += o.stroke + ' S ';
    if (o.fill) s += o.fill + ' f ';
  }
  return s;
}
function rounded(x, y, w, h, r) {
  const k = r * 0.5523;
  return `${r2(x + r)} ${r2(y)} m ${r2(x + w - r)} ${r2(y)} l ${r2(x + w - r + k)} ${r2(y)} ${r2(x + w)} ${r2(y + r - k)} ${r2(x + w)} ${r2(y + r)} c ` +
    `${r2(x + w)} ${r2(y + h - r)} l ${r2(x + w)} ${r2(y + h - r + k)} ${r2(x + w - r + k)} ${r2(y + h)} ${r2(x + w - r)} ${r2(y + h)} c ` +
    `${r2(x + r)} ${r2(y + h)} l ${r2(x + r - k)} ${r2(y + h)} ${r2(x)} ${r2(y + h - r + k)} ${r2(x)} ${r2(y + h - r)} c ` +
    `${r2(x)} ${r2(y + r)} l ${r2(x)} ${r2(y + r - k)} ${r2(x + r - k)} ${r2(y)} ${r2(x + r)} ${r2(y)} c h`;
}
function ellipsePoints([x1, y1, x2, y2], n = 16) {
  const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2, rx = (x2 - x1) / 2, ry = (y2 - y1) / 2;
  return Array.from({ length: n }, (_, i) => [cx + rx * Math.cos((i / n) * 2 * Math.PI), cy + ry * Math.sin((i / n) * 2 * Math.PI)]);
}
function centroid(pts) { const n = pts.length || 1; return [pts.reduce((s, p) => s + p[0], 0) / n, pts.reduce((s, p) => s + p[1], 0) / n]; }
/** Etichetta di misura su sfondo bianco, opzionalmente ruotata lungo la linea; rot = /Rotate della pagina. */
function labelOps(font, text, [cx, cy], color, angle = 0, rot = 0) {
  const fs = 9;
  const t = safeText(font, text);
  const tw = font.widthOfTextAtSize(t, fs);
  // l'angolo si raddrizza rispetto allo schermo (mai a testa in giù), poi si riporta nello spazio PDF
  const R = (rot * Math.PI) / 180;
  let a = angle - R; while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI;
  if (a > Math.PI / 2) a -= Math.PI; if (a < -Math.PI / 2) a += Math.PI;
  a += R;
  const c = Math.cos(a), s = Math.sin(a);
  return `q ${r2(c)} ${r2(s)} ${r2(-s)} ${r2(c)} ${r2(cx)} ${r2(cy)} cm 1 1 1 rg ${r2(-tw / 2 - 2)} 2 ${r2(tw + 4)} ${fs + 2} re f ` +
    `BT /F1 ${fs} Tf ${col(color || [0, 0, 0], 'rg')} 1 0 0 1 ${r2(-tw / 2)} 4.5 Tm ${enc(font, t)} Tj ET Q `;
}
