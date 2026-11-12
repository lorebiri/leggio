// «Striscia di segnatura candidata»: Titulus stampa la segnatura di protocollo come IMMAGINE stretta e
// alta (o larga e bassa) lungo un bordo della prima pagina. Il testo del PDF non la contiene: qui la si
// trova dall'elenco delle operazioni di disegno di pdf.js, senza leggerla. Logica pura.

const mul = (m, n) => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];

/**
 * Riquadri (coordinate della pagina PDF) delle immagini disegnate. fnArray/argsArray da page.getOperatorList(),
 * OPS = pdfjs.OPS. → [{ bbox:[x0,y0,x1,y1], w, h }] (w, h: pixel dell'immagine se noti)
 */
export function immaginiDisegnate(fnArray, argsArray, OPS) {
  const out = [];
  let ctm = [1, 0, 0, 1, 0, 0]; const pila = [];
  const immagine = new Set([OPS.paintImageXObject, OPS.paintInlineImageXObject, OPS.paintImageMaskXObject, OPS.paintImageXObjectRepeat, OPS.paintSolidColorImageMask].filter((x) => x != null));
  for (let i = 0; i < fnArray.length; i++) {
    const f = fnArray[i]; const a = argsArray[i];
    if (f === OPS.save) pila.push(ctm);
    else if (f === OPS.restore) ctm = pila.pop() || ctm;
    else if (f === OPS.transform && a) ctm = mul(ctm, a);
    else if (f === OPS.paintFormXObjectBegin) { pila.push(ctm); if (Array.isArray(a?.[0]) || ArrayBuffer.isView(a?.[0])) ctm = mul(ctm, [...a[0]]); }
    else if (f === OPS.paintFormXObjectEnd) ctm = pila.pop() || ctm;
    else if (immagine.has(f)) {
      const p = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([x, y]) => [ctm[0] * x + ctm[2] * y + ctm[4], ctm[1] * x + ctm[3] * y + ctm[5]]);
      const xs = p.map((q) => q[0]); const ys = p.map((q) => q[1]);
      out.push({ bbox: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)], w: typeof a?.[1] === 'number' ? a[1] : a?.[0]?.width || null, h: typeof a?.[2] === 'number' ? a[2] : a?.[0]?.height || null });
      if (out.length > 200) break;
    }
  }
  return out;
}

/**
 * Sceglie la striscia candidata: immagine molto allungata (lato lungo ≥ 6 volte il corto), lunga almeno
 * il 35 % del lato della pagina, sottile, vicina a un bordo. view: page.view [x0,y0,x1,y1].
 * → { bbox, verticale, lato: 'sinistra'|'destra'|'alto'|'basso', px: [w,h] } oppure null
 */
export function strisciaCandidata(immagini, view) {
  const [vx0, vy0, vx1, vy1] = view; const W = vx1 - vx0; const H = vy1 - vy0;
  let best = null;
  for (const im of immagini) {
    const [x0, y0, x1, y1] = im.bbox;
    const w = x1 - x0; const h = y1 - y0;
    if (w <= 0 || h <= 0) continue;
    const verticale = h > w;
    const lungo = verticale ? h : w; const corto = verticale ? w : h;
    if (lungo / corto < 6) continue;
    if (lungo < 0.35 * (verticale ? H : W) || corto > 0.12 * (verticale ? W : H)) continue;
    const d = verticale ? { sinistra: x0 - vx0, destra: vx1 - x1 } : { basso: y0 - vy0, alto: vy1 - y1 };
    const [lato, dist] = Object.entries(d).sort((a, b) => a[1] - b[1])[0];
    if (dist > 0.15 * (verticale ? W : H)) continue;
    const punti = lungo - dist;
    if (!best || punti > best.punti) best = { bbox: im.bbox.map((v) => Math.round(v * 10) / 10), verticale, lato, px: [im.w, im.h], punti };
  }
  if (!best) return null;
  delete best.punti;
  return best;
}
