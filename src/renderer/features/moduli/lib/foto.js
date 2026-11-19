// Firma (o timbro) da una foto o da una scansione: toglie lo sfondo e il colore della carta, anche con la
// luce non uniforme tipica delle foto col telefono, e ricolora l'inchiostro. Logica pura su dati RGBA
// (ImageData.data), coperta dai test.

const lum = (d, i) => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];

/** Colore della carta: mediana per canale dei pixel del bordo. → [r,g,b] */
export function stimaCarta(data, w, h) {
  const rs = []; const gs = []; const bs = [];
  const step = Math.max(1, Math.floor((w + h) / 400));
  const add = (x, y) => { const i = (y * w + x) * 4; rs.push(data[i]); gs.push(data[i + 1]); bs.push(data[i + 2]); };
  for (let x = 0; x < w; x += step) { add(x, 0); add(x, h - 1); }
  for (let y = 0; y < h; y += step) { add(0, y); add(w - 1, y); }
  const med = (a) => { a.sort((p, q) => p - q); return a[Math.floor(a.length / 2)] ?? 255; };
  return [med(rs), med(gs), med(bs)];
}

/**
 * Mappa della luminosità della carta a blocchi (85° percentile di ogni blocco, poi interpolata):
 * compensa ombre e luce che cala verso un lato. → Float32Array(w*h)
 */
export function mappaCarta(data, w, h) {
  const B = Math.max(8, Math.round(Math.min(w, h) / 20));
  const bw = Math.ceil(w / B); const bh = Math.ceil(h / B);
  const blocchi = new Float32Array(bw * bh);
  const hist = new Uint32Array(64);
  for (let by = 0; by < bh; by++) {
    for (let bx = 0; bx < bw; bx++) {
      hist.fill(0); let n = 0;
      const x0 = bx * B; const y0 = by * B; const x1 = Math.min(w, x0 + B); const y1 = Math.min(h, y0 + B);
      for (let y = y0; y < y1; y += 2) for (let x = x0; x < x1; x += 2) { hist[Math.min(63, lum(data, (y * w + x) * 4) >> 2)]++; n++; }
      let acc = 0; let v = 63; const soglia = n * 0.15;
      for (let k = 63; k >= 0; k--) { acc += hist[k]; if (acc >= soglia) { v = k; break; } }
      blocchi[by * bw + bx] = v * 4 + 2;
    }
  }
  // un blocco tutto inchiostro (firma grossa) prende il massimo dei vicini
  const g = blocchi.slice();
  for (let by = 0; by < bh; by++) for (let bx = 0; bx < bw; bx++) {
    let m = blocchi[by * bw + bx];
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const yy = by + dy; const xx = bx + dx; if (yy >= 0 && yy < bh && xx >= 0 && xx < bw) m = Math.max(m, blocchi[yy * bw + xx] * 0.97); }
    g[by * bw + bx] = m;
  }
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const fy = Math.min(bh - 1, Math.max(0, (y + 0.5) / B - 0.5)); const y0 = Math.floor(fy); const y1 = Math.min(bh - 1, y0 + 1); const ty = fy - y0;
    for (let x = 0; x < w; x++) {
      const fx = Math.min(bw - 1, Math.max(0, (x + 0.5) / B - 0.5)); const x0 = Math.floor(fx); const x1 = Math.min(bw - 1, x0 + 1); const tx = fx - x0;
      const a = g[y0 * bw + x0] * (1 - tx) + g[y0 * bw + x1] * tx;
      const b = g[y1 * bw + x0] * (1 - tx) + g[y1 * bw + x1] * tx;
      out[y * w + x] = a * (1 - ty) + b * ty;
    }
  }
  return out;
}

/**
 * Toglie la carta e lascia l'inchiostro (dati modificati sul posto).
 * opts: sensibilita 0..1 (più alta = tiene anche i tratti chiari), inchiostro [r,g,b] per ricolorare
 * (null = colore originale, un po' scurito). → { carta: [r,g,b], pixelInchiostro }
 */
export function pulisciFoto(data, w, h, { sensibilita = 0.5, inchiostro = null } = {}) {
  if (!data || data.length < w * h * 4 || w < 2 || h < 2) return { carta: [255, 255, 255], pixelInchiostro: 0 };
  const carta = stimaCarta(data, w, h);
  const mappa = mappaCarta(data, w, h);
  const s = Math.max(0, Math.min(1, sensibilita));
  const lo = 0.16 - 0.1 * s; // sotto: carta
  const hi = lo + 0.16;       // sopra: inchiostro pieno
  const cn = Math.hypot(...carta) || 1;
  let n = 0;
  for (let p = 0, i = 0; p < w * h; p++, i += 4) {
    const L = lum(data, i);
    const Lc = Math.max(40, mappa[p]);
    const scuro = 1 - L / Lc; // quanto è più scuro della carta lì intorno
    // cromaticità diversa dalla carta (inchiostro blu su carta gialla): angolo tra i colori
    const pn = Math.hypot(data[i], data[i + 1], data[i + 2]) || 1;
    const cos = (data[i] * carta[0] + data[i + 1] * carta[1] + data[i + 2] * carta[2]) / (pn * cn);
    const tinta = Math.max(0, 1 - cos) * 6;
    const v = Math.max(scuro, Math.min(scuro + 0.08, tinta) * 0.9);
    let a;
    if (v <= lo) a = 0;
    else if (v >= hi) a = 255;
    else a = Math.round(255 * (v - lo) / (hi - lo));
    a = Math.min(a, data[i + 3]);
    data[i + 3] = a;
    if (a > 0) {
      n++;
      if (inchiostro) { data[i] = inchiostro[0]; data[i + 1] = inchiostro[1]; data[i + 2] = inchiostro[2]; }
      else { data[i] = Math.round(data[i] * 0.8); data[i + 1] = Math.round(data[i + 1] * 0.8); data[i + 2] = Math.round(data[i + 2] * 0.8); }
    }
  }
  return { carta, pixelInchiostro: n };
}

/** «#1d3f9a» → [29,63,154] */
export function hexRgb(hex) { const n = parseInt(String(hex).replace('#', ''), 16) || 0; return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }

/** Ricolora i pixel visibili (alpha > 0) con un colore pieno, conservando la trasparenza. */
export function ricolora(data, rgb) {
  for (let i = 0; i < data.length; i += 4) if (data[i + 3]) { data[i] = rgb[0]; data[i + 1] = rgb[1]; data[i + 2] = rgb[2]; }
}
