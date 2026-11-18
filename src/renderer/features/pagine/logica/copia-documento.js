// «Copia documento fronte/retro»: come la funzione «copia carta d'identità» delle fotocopiatrici.
// Dalla scansione del fronte e del retro di una tessera (ogni lato su una pagina A4, la tessera piccola da
// qualche parte) trova la tessera, la ritaglia e la raddrizza (rotazione e prospettiva), poi impagina fronte e
// retro su un solo foglio in DIMENSIONE REALE (ID-1: 85,60 × 53,98 mm).
// Logica pura (nessun DOM): immagini come { width, height, data: RGBA }. Tutto in locale.

/** Formati dei documenti, in millimetri (larghezza × altezza, documento dritto). */
export const FORMATI_DOCUMENTO = {
  id1: { id: 'id1', nome: 'Tessera (carta d\'identità elettronica, patente, tessera sanitaria, codice fiscale)', w: 85.6, h: 53.98 },
  // vecchia carta d'identità cartacea, aperta: due facciate affiancate (scheda PRADO ITA-BO-03001: 150 × 110 mm)
  cartacea: { id: 'cartacea', nome: 'Carta d\'identità cartacea (libretto aperto)', w: 150, h: 110 },
};
export const CARTA = { A4: { w: 210, h: 297 }, Letter: { w: 215.9, h: 279.4 } };
export const MM = 72 / 25.4; // punti PDF per millimetro

// ---------------------------------------------------------------- immagine di lavoro

/** Riduce e converte in RGB «piatto» per l'analisi. → { w, h, r, g, b (Uint8Array), scala } */
export function riduci(img, maxLato = 640) {
  const scala = Math.min(1, maxLato / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * scala)); const h = Math.max(1, Math.round(img.height * scala));
  const r = new Uint8Array(w * h); const g = new Uint8Array(w * h); const b = new Uint8Array(w * h);
  const sx = img.width / w; const sy = img.height / h;
  for (let y = 0; y < h; y++) {
    const y0 = Math.floor(y * sy); const y1 = Math.max(y0 + 1, Math.floor((y + 1) * sy));
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor(x * sx); const x1 = Math.max(x0 + 1, Math.floor((x + 1) * sx));
      // media di un campione (al massimo 3×3) del riquadro: smussa il rumore della scansione
      let R = 0; let G = 0; let B = 0; let n = 0;
      const stepY = Math.max(1, Math.floor((y1 - y0) / 3)); const stepX = Math.max(1, Math.floor((x1 - x0) / 3));
      for (let yy = y0; yy < y1; yy += stepY) for (let xx = x0; xx < x1; xx += stepX) {
        const i = (yy * img.width + xx) * 4; R += img.data[i]; G += img.data[i + 1]; B += img.data[i + 2]; n++;
      }
      const k = y * w + x; r[k] = R / n; g[k] = G / n; b[k] = B / n;
    }
  }
  return { w, h, r, g, b, scala };
}

function mediana(a) { const s = Array.from(a).sort((p, q) => p - q); return s[Math.floor(s.length / 2)] || 0; }

// ---------------------------------------------------------------- rilevamento

/**
 * Trova la tessera nella scansione.
 * → { corners: [[x,y]×4] in pixel dell'immagine originale, in ordine alto-sinistra, alto-destra, basso-destra,
 *     basso-sinistra della tessera DRITTA (lato lungo in orizzontale), confidenza 0…1, aspetto } oppure null.
 */
export function trovaTessera(img, { rapporto = FORMATI_DOCUMENTO.id1.w / FORMATI_DOCUMENTO.id1.h } = {}) {
  const R = riduci(img);
  const { w, h } = R;
  // 1. colore del fondo: mediana della cornice esterna (3% dei bordi)
  const bordo = [];
  const m = Math.max(2, Math.round(Math.min(w, h) * 0.03));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (x >= m && x < w - m && y >= m && y < h - m) continue;
    bordo.push(y * w + x);
  }
  const bg = [mediana(bordo.map((k) => R.r[k])), mediana(bordo.map((k) => R.g[k])), mediana(bordo.map((k) => R.b[k]))];
  const dist = new Float32Array(w * h);
  for (let k = 0; k < w * h; k++) dist[k] = Math.max(Math.abs(R.r[k] - bg[0]), Math.abs(R.g[k] - bg[1]), Math.abs(R.b[k] - bg[2]));
  // soglia adattiva: rumore del fondo (deviazione assoluta mediana della cornice)
  const rumore = mediana(bordo.map((k) => dist[k]));
  const soglia = Math.max(18, rumore * 3 + 10);
  // 2. pixel «diversi dal fondo» + bordi forti (una tessera bianca su fondo bianco si vede dal contorno)
  const fg = new Uint8Array(w * h);
  const lum = (k) => 0.299 * R.r[k] + 0.587 * R.g[k] + 0.114 * R.b[k];
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const k = y * w + x;
    if (dist[k] > soglia) { fg[k] = 1; continue; }
    const gx = lum(k + 1) - lum(k - 1); const gy = lum(k + w) - lum(k - w);
    if (Math.hypot(gx, gy) > Math.max(24, soglia * 1.2)) fg[k] = 1;
  }
  // 3. chiusura (dilata e restringe) per unire contorni interrotti, poi riempimento: è «dentro» ciò che non si
  //    raggiunge dal bordo senza attraversare il primo piano
  const chiuso = erodi(dilata(fg, w, h, 2), w, h, 2);
  const fuori = new Uint8Array(w * h);
  const coda = [];
  for (let x = 0; x < w; x++) { coda.push(x, (h - 1) * w + x); }
  for (let y = 0; y < h; y++) { coda.push(y * w, y * w + w - 1); }
  for (const k of coda) if (!chiuso[k]) fuori[k] = 1;
  for (let q = 0; q < coda.length; q++) {
    const k = coda[q]; if (!fuori[k]) continue;
    const x = k % w; const y = (k - x) / w;
    const vicini = [x > 0 ? k - 1 : -1, x < w - 1 ? k + 1 : -1, y > 0 ? k - w : -1, y < h - 1 ? k + w : -1];
    for (const n of vicini) if (n >= 0 && !fuori[n] && !chiuso[n]) { fuori[n] = 1; coda.push(n); }
  }
  // 4. componente più grande del «dentro»
  const dentro = new Uint8Array(w * h);
  for (let k = 0; k < w * h; k++) dentro[k] = fuori[k] ? 0 : 1;
  const comp = componentePiuGrande(dentro, w, h);
  if (!comp || comp.area < w * h * 0.004) return null;
  // 5. inviluppo convesso, rettangolo di area minima, lati rifiniti (angoli arrotondati esclusi) → quadrilatero
  const hull = inviluppo(comp.punti);
  if (hull.length < 4) return null;
  const rect = rettangoloMinimo(hull);
  const quad = rifinisciLati(hull, rect) || rect.corners;
  const areaQuad = areaPoligono(quad);
  const rettangolarita = Math.min(1, comp.area / Math.max(1, areaQuad));
  const [l1, l2] = [dist2(quad[0], quad[1]), dist2(quad[1], quad[2])].map(Math.sqrt);
  const aspetto = Math.max(l1, l2) / Math.max(1e-6, Math.min(l1, l2));
  const okAspetto = Math.max(0, 1 - Math.abs(aspetto - rapporto) / rapporto);
  const confidenza = Math.round(Math.min(1, rettangolarita) * okAspetto * 100) / 100;
  const ordinati = ordinaAngoli(quad).map(([x, y]) => [x / R.scala, y / R.scala]);
  return { corners: ordinati, confidenza, aspetto: Math.round(aspetto * 1000) / 1000 };
}

function dilata(a, w, h, r) {
  let cur = a;
  for (let it = 0; it < r; it++) {
    const o = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const k = y * w + x;
      if (cur[k] || (x > 0 && cur[k - 1]) || (x < w - 1 && cur[k + 1]) || (y > 0 && cur[k - w]) || (y < h - 1 && cur[k + w])) o[k] = 1;
    }
    cur = o;
  }
  return cur;
}
function erodi(a, w, h, r) {
  let cur = a;
  for (let it = 0; it < r; it++) {
    const o = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const k = y * w + x;
      if (cur[k] && (x === 0 || cur[k - 1]) && (x === w - 1 || cur[k + 1]) && (y === 0 || cur[k - w]) && (y === h - 1 || cur[k + w])) o[k] = 1;
    }
    cur = o;
  }
  return cur;
}

/**
 * Componente connessa più grande (4-connessa) che NON tocca il bordo dell'immagine (ombre del coperchio dello
 * scanner, bordi neri della scansione); se tutte lo toccano, la più grande. → { area, punti: [[x,y]] }
 */
function componentePiuGrande(mask, w, h) {
  const lab = new Int32Array(w * h);
  let best = null; let bestBordo = null; let id = 0;
  for (let s = 0; s < w * h; s++) {
    if (!mask[s] || lab[s]) continue;
    id++;
    const stack = [s]; lab[s] = id; let area = 0;
    const righe = new Map();
    let tocca = false;
    while (stack.length) {
      const k = stack.pop(); area++;
      const x = k % w; const y = (k - x) / w;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) tocca = true;
      const rr = righe.get(y); if (!rr) righe.set(y, [x, x]); else { if (x < rr[0]) rr[0] = x; if (x > rr[1]) rr[1] = x; }
      if (x > 0 && mask[k - 1] && !lab[k - 1]) { lab[k - 1] = id; stack.push(k - 1); }
      if (x < w - 1 && mask[k + 1] && !lab[k + 1]) { lab[k + 1] = id; stack.push(k + 1); }
      if (y > 0 && mask[k - w] && !lab[k - w]) { lab[k - w] = id; stack.push(k - w); }
      if (y < h - 1 && mask[k + w] && !lab[k + w]) { lab[k + w] = id; stack.push(k + w); }
    }
    const cand = tocca ? bestBordo : best;
    if (!cand || area > cand.area) {
      const punti = [];
      for (const [y, [a, b]] of righe) { punti.push([a, y], [b + 1, y], [a, y + 1], [b + 1, y + 1]); }
      if (tocca) bestBordo = { area, punti }; else best = { area, punti };
    }
  }
  return best && best.area >= w * h * 0.004 ? best : bestBordo;
}

/** Inviluppo convesso (catena monotona). */
export function inviluppo(pts) {
  const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = []; for (const q of p) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop(); lower.push(q); }
  const upper = []; for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop(); upper.push(q); }
  upper.pop(); lower.pop();
  return lower.concat(upper);
}

/** Rettangolo di area minima che contiene l'inviluppo (un lato coincide con un lato dell'inviluppo). */
export function rettangoloMinimo(hull) {
  let best = null;
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i]; const b = hull[(i + 1) % hull.length];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]); if (len < 1e-9) continue;
    const ux = (b[0] - a[0]) / len; const uy = (b[1] - a[1]) / len;
    let minU = Infinity; let maxU = -Infinity; let minV = Infinity; let maxV = -Infinity;
    for (const p of hull) {
      const u = p[0] * ux + p[1] * uy; const v = -p[0] * uy + p[1] * ux;
      if (u < minU) minU = u; if (u > maxU) maxU = u; if (v < minV) minV = v; if (v > maxV) maxV = v;
    }
    const area = (maxU - minU) * (maxV - minV);
    if (!best || area < best.area) best = { area, ux, uy, minU, maxU, minV, maxV };
  }
  const { ux, uy, minU, maxU, minV, maxV } = best;
  const P = (u, v) => [u * ux - v * uy, u * uy + v * ux];
  return { ...best, corners: [P(minU, minV), P(maxU, minV), P(maxU, maxV), P(minU, maxV)] };
}

/**
 * Lati del quadrilatero rifiniti per la prospettiva: i punti dell'inviluppo vicini a ciascun lato del
 * rettangolo minimo (esclusi quelli negli angoli, arrotondati) definiscono una retta; gli angoli sono le
 * intersezioni delle rette adiacenti. → 4 angoli o null.
 */
function rifinisciLati(hull, rect) {
  const C = rect.corners;
  const rette = [];
  for (let s = 0; s < 4; s++) {
    const a = C[s]; const b = C[(s + 1) % 4];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const ux = (b[0] - a[0]) / len; const uy = (b[1] - a[1]) / len;
    const vicini = [];
    // punti densi lungo l'inviluppo (i lati lunghi dell'inviluppo sono campionati)
    for (let i = 0; i < hull.length; i++) {
      const p = hull[i]; const q = hull[(i + 1) % hull.length];
      const n = Math.max(1, Math.ceil(Math.hypot(q[0] - p[0], q[1] - p[1]) / 2));
      for (let t = 0; t < n; t++) {
        const x = p[0] + ((q[0] - p[0]) * t) / n; const y = p[1] + ((q[1] - p[1]) * t) / n;
        const u = (x - a[0]) * ux + (y - a[1]) * uy; const d = Math.abs(-(x - a[0]) * uy + (y - a[1]) * ux);
        if (u > len * 0.12 && u < len * 0.88 && d < Math.max(3, len * 0.06)) vicini.push([x, y]);
      }
    }
    if (vicini.length < 4) return null;
    rette.push(rettaMinimiQuadrati(vicini));
  }
  const out = [];
  for (let s = 0; s < 4; s++) {
    const p = intersezione(rette[(s + 3) % 4], rette[s]);
    if (!p || !Number.isFinite(p[0])) return null;
    out.push(p);
  }
  // il quadrilatero rifinito non deve allontanarsi troppo dal rettangolo (errore del rilevamento)
  const diag = Math.hypot(C[2][0] - C[0][0], C[2][1] - C[0][1]);
  for (let s = 0; s < 4; s++) if (Math.hypot(out[s][0] - C[s][0], out[s][1] - C[s][1]) > diag * 0.12) return null;
  return out;
}

/** Retta in forma normale (n·p = c) che approssima i punti (analisi delle componenti principali). */
function rettaMinimiQuadrati(pts) {
  let mx = 0; let my = 0; for (const [x, y] of pts) { mx += x; my += y; } mx /= pts.length; my /= pts.length;
  let sxx = 0; let sxy = 0; let syy = 0; for (const [x, y] of pts) { sxx += (x - mx) ** 2; sxy += (x - mx) * (y - my); syy += (y - my) ** 2; }
  const ang = 0.5 * Math.atan2(2 * sxy, sxx - syy); // direzione principale
  const nx = -Math.sin(ang); const ny = Math.cos(ang);
  return { nx, ny, c: nx * mx + ny * my };
}
function intersezione(r1, r2) {
  const det = r1.nx * r2.ny - r1.ny * r2.nx;
  if (Math.abs(det) < 1e-9) return null;
  return [(r1.c * r2.ny - r1.ny * r2.c) / det, (r1.nx * r2.c - r1.c * r2.nx) / det];
}
function areaPoligono(p) { let a = 0; for (let i = 0; i < p.length; i++) { const [x1, y1] = p[i]; const [x2, y2] = p[(i + 1) % p.length]; a += x1 * y2 - x2 * y1; } return Math.abs(a) / 2; }
function dist2(a, b) { return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2; }

/**
 * Ordina 4 angoli: alto-sinistra, alto-destra, basso-destra, basso-sinistra della tessera dritta, con il lato
 * lungo in orizzontale. Se nella scansione la tessera è in verticale (ruotata di circa 90°), si sceglie il
 * verso che la raddrizza ruotando in senso antiorario (il 180° si corregge con «Capovolgi»).
 */
export function ordinaAngoli(q) {
  // ordine orario attorno al baricentro, partendo dall'angolo più in alto a sinistra (y verso il basso)
  const cx = q.reduce((s, p) => s + p[0], 0) / 4; const cy = q.reduce((s, p) => s + p[1], 0) / 4;
  const pts = q.slice().sort((a, b) => Math.atan2(a[1] - cy, a[0] - cx) - Math.atan2(b[1] - cy, b[0] - cx));
  let start = 0; let bestS = Infinity;
  pts.forEach((p, i) => { const s = p[0] + p[1]; if (s < bestS) { bestS = s; start = i; } });
  let o = [0, 1, 2, 3].map((i) => pts[(start + i) % 4]);
  // lato alto più corto del lato destro → la tessera è in verticale: si parte dall'angolo successivo
  if (Math.hypot(o[1][0] - o[0][0], o[1][1] - o[0][1]) < Math.hypot(o[2][0] - o[1][0], o[2][1] - o[1][1])) o = [o[3], o[0], o[1], o[2]];
  return o;
}

/** Ruota l'ordine degli angoli di 90° (giri in senso orario) per correggere a mano l'orientamento. */
export function ruotaAngoli(corners, giri = 1) {
  const n = ((giri % 4) + 4) % 4;
  return [0, 1, 2, 3].map((i) => corners[(i + n) % 4]);
}

// ---------------------------------------------------------------- raddrizzamento

/** Omografia che porta i 4 punti src nei 4 punti dst. → matrice 3×3 (array di 9). */
export function omografia(src, dst) {
  const A = []; const b = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i]; const [u, v] = dst[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
  }
  const h = risolvi(A, b);
  return [...h, 1];
}
function risolvi(A, b) {
  const n = b.length; const M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    if (Math.abs(M[c][c]) < 1e-12) throw new Error('Angoli del documento non validi.');
    for (let r = 0; r < n; r++) { if (r === c) continue; const f = M[r][c] / M[c][c]; for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; }
  }
  return M.map((r, i) => r[n] / r[i]);
}
export function applicaOmografia(H, x, y) { const d = H[6] * x + H[7] * y + H[8]; return [(H[0] * x + H[1] * y + H[2]) / d, (H[3] * x + H[4] * y + H[5]) / d]; }

/**
 * Ritaglia e raddrizza la tessera: → { width, height, data } (RGBA) di outW × outH pixel.
 * corners: alto-sinistra, alto-destra, basso-destra, basso-sinistra nell'immagine sorgente.
 */
export function raddrizza(img, corners, outW, outH) {
  const H = omografia([[0, 0], [outW, 0], [outW, outH], [0, outH]], corners);
  const out = new Uint8ClampedArray(outW * outH * 4);
  const W = img.width; const Hh = img.height; const d = img.data;
  for (let y = 0; y < outH; y++) for (let x = 0; x < outW; x++) {
    const [sx, sy] = applicaOmografia(H, x + 0.5, y + 0.5);
    const fx = sx - 0.5; const fy = sy - 0.5;
    const x0 = Math.floor(fx); const y0 = Math.floor(fy); const ax = fx - x0; const ay = fy - y0;
    const o = (y * outW + x) * 4;
    for (let c = 0; c < 3; c++) {
      const px = (xx, yy) => { const cx = Math.min(W - 1, Math.max(0, xx)); const cy = Math.min(Hh - 1, Math.max(0, yy)); return d[(cy * W + cx) * 4 + c]; };
      out[o + c] = (px(x0, y0) * (1 - ax) + px(x0 + 1, y0) * ax) * (1 - ay) + (px(x0, y0 + 1) * (1 - ax) + px(x0 + 1, y0 + 1) * ax) * ay;
    }
    out[o + 3] = 255;
  }
  return { width: outW, height: outH, data: out };
}

/** Bianco e nero e/o miglioramento del contrasto (livelli automatici sui percentili 1–99). Modifica in loco. */
export function migliora(img, { biancoNero = false, contrasto = false } = {}) {
  const d = img.data;
  if (contrasto) {
    const hist = new Uint32Array(256);
    for (let i = 0; i < d.length; i += 4) hist[Math.round(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2])]++;
    const tot = d.length / 4; let acc = 0; let lo = 0; let hi = 255;
    for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= tot * 0.01) { lo = v; break; } }
    acc = 0; for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc >= tot * 0.01) { hi = v; break; } }
    if (hi - lo > 20) { const k = 255 / (hi - lo); for (let i = 0; i < d.length; i += 4) for (let c = 0; c < 3; c++) d[i + c] = (d[i + c] - lo) * k; }
  }
  if (biancoNero) for (let i = 0; i < d.length; i += 4) { const v = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]; d[i] = d[i + 1] = d[i + 2] = v; }
  return img;
}

// ---------------------------------------------------------------- impaginazione

/** Pixel di uscita per un documento a una certa risoluzione (300 dpi per la stampa). */
export function pixelUscita(formato, dpi = 300) {
  const f = FORMATI_DOCUMENTO[formato] || FORMATI_DOCUMENTO.id1;
  return { w: Math.round((f.w / 25.4) * dpi), h: Math.round((f.h / 25.4) * dpi) };
}

/**
 * Posizione di fronte e retro sul foglio, in punti PDF (origine in basso a sinistra).
 * opz: { formato: 'id1'|'cartacea', carta: 'A4'|'Letter', scala: 'reale'|'ingrandita', margineMm, spazioMm }
 * «reale» = 1:1; «ingrandita» = il più grande possibile (fino a 2×) mantenendo i margini.
 * → { pagina: [w, h], fronte: { x, y, w, h }, retro: { … }, fattore }
 */
export function impagina({ formato = 'id1', carta = 'A4', scala = 'reale', margineMm = 15, spazioMm = 20 } = {}) {
  const f = FORMATI_DOCUMENTO[formato] || FORMATI_DOCUMENTO.id1;
  const P = CARTA[carta] || CARTA.A4;
  let k = 1;
  if (scala === 'ingrandita') k = Math.min(2, (P.w - 2 * margineMm) / f.w, (P.h - 2 * margineMm - spazioMm) / (2 * f.h));
  const w = f.w * k; const h = f.h * k;
  const totale = 2 * h + spazioMm;
  const x = (P.w - w) / 2;
  const top = (P.h - totale) / 2; // dall'alto
  const fronte = { x: x * MM, y: (P.h - top - h) * MM, w: w * MM, h: h * MM };
  const retro = { x: x * MM, y: (P.h - top - 2 * h - spazioMm) * MM, w: w * MM, h: h * MM };
  return { pagina: [P.w * MM, P.h * MM], fronte, retro, fattore: k };
}

/** Coppie fronte/retro predefinite per n pagine: (1,2), (3,4)… → [[0,1],[2,3]] (l'ultima pagina dispari resta da sola). */
export function coppiePredefinite(n) {
  const out = [];
  for (let i = 0; i + 1 < n; i += 2) out.push([i, i + 1]);
  if (n % 2) out.push([n - 1, null]);
  return out;
}
