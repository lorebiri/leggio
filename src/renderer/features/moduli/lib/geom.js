// Geometria e utilità pure per «Compila e firma»: posizionamento con rotazione, tratti della firma, immagini.

export function normRect([a, b, c, d]) { return [Math.min(a, c), Math.min(b, d), Math.max(a, c), Math.max(b, d)]; }

/**
 * Da un rettangolo PDF e dalla rotazione della pagina (0/90/180/270) ricava l'origine visiva in basso a sinistra,
 * la larghezza/altezza visive e la rotazione da passare a pdf-lib, così che testo e immagini appaiano diritti.
 */
export function placement(rect, rotation = 0) {
  const [x1, y1, x2, y2] = normRect(rect);
  const r = ((Math.round(rotation / 90) * 90) % 360 + 360) % 360;
  switch (r) {
    case 90: return { x: x2, y: y1, w: y2 - y1, h: x2 - x1, rotate: 90 };
    case 180: return { x: x2, y: y2, w: x2 - x1, h: y2 - y1, rotate: 180 };
    case 270: return { x: x1, y: y2, w: y2 - y1, h: x2 - x1, rotate: 270 };
    default: return { x: x1, y: y1, w: x2 - x1, h: y2 - y1, rotate: 0 };
  }
}

/** Punto locale (lx a destra, ly in alto, dall'angolo visivo in basso a sinistra) → punto PDF. */
export function localToPdf(pl, lx, ly) {
  const a = (pl.rotate * Math.PI) / 180;
  const c = Math.round(Math.cos(a)); const s = Math.round(Math.sin(a));
  return { x: pl.x + lx * c - ly * s, y: pl.y + lx * s + ly * c };
}

/** Data di oggi nel formato italiano gg/mm/aaaa. */
export function todayIt(d = new Date()) {
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}

/** Iniziali da un nome: "Maria Grazia Rossi" → "M.G.R." */
export function initialsOf(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  return parts.map((p) => p[0].toUpperCase() + '.').join('');
}

/**
 * Spessori del tratto in base alla velocità (più veloce = più sottile), come una penna vera.
 * points: [{x,y,t}] → array di spessori (stessa lunghezza), smussati.
 */
export function strokeWidths(points, { min = 1.2, max = 3.6 } = {}) {
  const out = [];
  let prev = (min + max) / 2;
  for (let i = 0; i < points.length; i++) {
    if (i === 0) { out.push(prev); continue; }
    const a = points[i - 1]; const b = points[i];
    const dt = Math.max(1, (b.t ?? 0) - (a.t ?? 0));
    const v = Math.hypot(b.x - a.x, b.y - a.y) / dt; // px/ms
    const target = Math.max(min, Math.min(max, max - (max - min) * Math.min(1, v / 2.5)));
    prev = prev * 0.7 + target * 0.3;
    out.push(prev);
  }
  return out;
}

/**
 * Segmenti curvi tra i punti medi (curve quadratiche): un tratto liscio anche con pochi campioni.
 * → [{ from:{x,y}, ctrl:{x,y}, to:{x,y}, width }]
 */
export function smoothSegments(points, widths) {
  const n = points.length;
  if (n === 0) return [];
  if (n === 1) return [{ from: points[0], ctrl: points[0], to: points[0], width: widths?.[0] ?? 2, dot: true }];
  const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const segs = [];
  let from = points[0];
  for (let i = 1; i < n - 1; i++) {
    const to = mid(points[i], points[i + 1]);
    segs.push({ from, ctrl: points[i], to, width: widths?.[i] ?? 2 });
    from = to;
  }
  segs.push({ from, ctrl: points[n - 1], to: points[n - 1], width: widths?.[n - 1] ?? 2 });
  return segs;
}

/** Riduce i punti troppo vicini (meno rumore della mano/mouse). */
export function thinPoints(points, minDist = 1.5) {
  if (points.length < 3) return points.slice();
  const out = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    const l = out[out.length - 1];
    if (Math.hypot(points[i].x - l.x, points[i].y - l.y) >= minDist) out.push(points[i]);
  }
  out.push(points[points.length - 1]);
  return out;
}

/**
 * Rende trasparente lo sfondo chiaro di una firma scansionata (dati RGBA modificati sul posto).
 * Soglia adattiva: stima il colore della carta dai bordi; i pixel vicini alla carta diventano trasparenti,
 * quelli di transizione semitrasparenti (bordi morbidi). L'inchiostro viene scurito leggermente.
 */
export function removeBackground(data, w, h, { tolerance = 0.18 } = {}) {
  if (!data || data.length < w * h * 4) return { paper: [255, 255, 255] };
  // carta = mediana della luminosità sul bordo
  const samples = [];
  const step = Math.max(1, Math.floor((w + h) / 400));
  const lum = (i) => 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  for (let x = 0; x < w; x += step) { samples.push(lum((x) * 4)); samples.push(lum(((h - 1) * w + x) * 4)); }
  for (let y = 0; y < h; y += step) { samples.push(lum((y * w) * 4)); samples.push(lum((y * w + w - 1) * 4)); }
  samples.sort((a, b) => a - b);
  const paper = samples[Math.floor(samples.length / 2)] ?? 255;
  const hi = paper * (1 - tolerance * 0.4); const lo = paper * (1 - tolerance * 2.2);
  for (let i = 0; i < w * h * 4; i += 4) {
    const L = lum(i);
    let a;
    if (L >= hi) a = 0;
    else if (L <= lo) a = 255;
    else a = Math.round(255 * (hi - L) / (hi - lo));
    data[i + 3] = Math.min(data[i + 3], a);
  }
  return { paper };
}

/** Riquadro dei pixel non trasparenti (alpha > soglia). → {x,y,w,h} o null se vuoto. */
export function opaqueBounds(data, w, h, threshold = 8) {
  let minX = w; let minY = h; let maxX = -1; let maxY = -1;
  for (let y = 0; y < h; y++) {
    const row = y * w * 4;
    for (let x = 0; x < w; x++) {
      if (data[row + x * 4 + 3] > threshold) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
    }
  }
  if (maxX < 0) return null;
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

/** Rettangolo di dimensioni (w,h) centrato in (cx,cy) e tenuto dentro la pagina. */
export function fitRectInPage(cx, cy, w, h, page) {
  const [px1, py1, px2, py2] = page;
  const ww = Math.min(w, px2 - px1); const hh = Math.min(h, py2 - py1);
  let x1 = cx - ww / 2; let y1 = cy - hh / 2;
  x1 = Math.max(px1, Math.min(px2 - ww, x1)); y1 = Math.max(py1, Math.min(py2 - hh, y1));
  return [x1, y1, x1 + ww, y1 + hh];
}

/** Sostituisce i caratteri non codificabili in un font standard (WinAnsi) con equivalenti o «?». */
export function winAnsiSafe(text, canEncode) {
  const map = { '‘': "'", '’': "'", '“': '"', '”': '"', '–': '-', '—': '-', '…': '...', ' ': ' ', '✓': 'v', '✗': 'x' };
  let out = '';
  for (const ch of String(text)) {
    if (ch === '\n') { out += ch; continue; }
    if (canEncode(ch)) out += ch;
    else if (map[ch] && canEncode(map[ch][0])) out += map[ch];
    else out += '?';
  }
  return out;
}
