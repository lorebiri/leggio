// Confronto visivo tra due immagini RGBA della stessa dimensione (logica pura).

/**
 * → { diverse: numero di pixel diversi, quota (0..1), riquadri: [{x0,y0,x1,y1}] in celle di `cell` pixel }
 * soglia: differenza minima (0..255) sulla luminosità perché un pixel conti come diverso.
 */
export function confrontaPixel(a, b, width, height, { soglia = 48, cell = 16 } = {}) {
  const cw = Math.ceil(width / cell); const ch = Math.ceil(height / cell);
  const celle = new Uint32Array(cw * ch);
  let diverse = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const la = (a[i] * 77 + a[i + 1] * 150 + a[i + 2] * 29) >> 8;
      const lb = (b[i] * 77 + b[i + 1] * 150 + b[i + 2] * 29) >> 8;
      if (Math.abs(la - lb) > soglia) { diverse++; celle[((y / cell) | 0) * cw + ((x / cell) | 0)]++; }
    }
  }
  // celle con abbastanza pixel diversi, unite in riquadri per righe di celle adiacenti
  const minPix = Math.max(2, (cell * cell) * 0.02);
  const riquadri = [];
  const usata = new Uint8Array(cw * ch);
  for (let cy = 0; cy < ch; cy++) {
    for (let cx = 0; cx < cw; cx++) {
      const k = cy * cw + cx;
      if (usata[k] || celle[k] < minPix) continue;
      // espansione a macchia d'olio sulle celle vicine
      let x0 = cx; let x1 = cx; let y0 = cy; let y1 = cy;
      const stack = [k]; usata[k] = 1;
      while (stack.length) {
        const c = stack.pop(); const px = c % cw; const py = (c / cw) | 0;
        x0 = Math.min(x0, px); x1 = Math.max(x1, px); y0 = Math.min(y0, py); y1 = Math.max(y1, py);
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = px + dx; const ny = py + dy;
          if (nx < 0 || ny < 0 || nx >= cw || ny >= ch) continue;
          const nk = ny * cw + nx;
          if (!usata[nk] && celle[nk] >= minPix) { usata[nk] = 1; stack.push(nk); }
        }
      }
      riquadri.push({ x0: x0 * cell, y0: y0 * cell, x1: Math.min(width, (x1 + 1) * cell), y1: Math.min(height, (y1 + 1) * cell) });
    }
  }
  return { diverse, quota: diverse / Math.max(1, width * height), riquadri };
}
