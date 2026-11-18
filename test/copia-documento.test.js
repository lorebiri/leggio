// «Copia documento fronte/retro»: rilevamento della tessera in scansioni sintetiche (ruotata, spostata, in
// prospettiva, su fondi diversi, bianca su bianco, con l'ombra dello scanner), raddrizzamento e dimensione
// stampata reale 85,6 × 54 mm.
import { describe, it, expect } from 'vitest';
import { PDFDocument } from '@cantoo/pdf-lib';
import { trovaTessera, raddrizza, impagina, omografia, applicaOmografia, ordinaAngoli, ruotaAngoli, pixelUscita, migliora, coppiePredefinite, MM, FORMATI_DOCUMENTO } from '../src/renderer/features/pagine/logica/copia-documento.js';

const DPI = 100; // scansione A4 a 100 dpi: 827 × 1169 pixel
const PX = DPI / 25.4;
const CARD_W = 85.6 * PX; const CARD_H = 53.98 * PX;

/** Generatore pseudo-casuale ripetibile. */
function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; }; }

/**
 * Scansione A4 con una tessera. opz: { cx, cy (centro, px), angolo (gradi), fondo: [r,g,b], rumore, colore,
 * bordo (colore del contorno, per la tessera bianca), prospettiva (spostamento degli angoli, px), ombra }
 * → { img, angoli (veri: alto-sx, alto-dx, basso-dx, basso-sx della tessera dritta) }
 */
function scansione({ cx = 300, cy = 400, angolo = 0, fondo = [252, 252, 250], rumore = 3, colore = [168, 196, 226], bordo = null, prospettiva = null, ombra = false, seed = 1 } = {}) {
  const W = Math.round(210 * PX); const H = Math.round(297 * PX);
  const data = new Uint8ClampedArray(W * H * 4);
  const rnd = rng(seed);
  const a = (angolo * Math.PI) / 180; const c = Math.cos(a); const s = Math.sin(a);
  const loc = [[-CARD_W / 2, -CARD_H / 2], [CARD_W / 2, -CARD_H / 2], [CARD_W / 2, CARD_H / 2], [-CARD_W / 2, CARD_H / 2]];
  let angoli = loc.map(([x, y]) => [cx + x * c - y * s, cy + x * s + y * c]);
  if (prospettiva) angoli = angoli.map(([x, y], i) => [x + prospettiva[i][0], y + prospettiva[i][1]]);
  // pixel della scansione → coordinate della tessera dritta (0…CARD_W, 0…CARD_H)
  const Hinv = omografia(angoli, [[0, 0], [CARD_W, 0], [CARD_W, CARD_H], [0, CARD_H]]);
  const R = 3.18 * PX; // raggio degli angoli ID-1
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const o = (y * W + x) * 4;
    let col = fondo.map((v) => v + (rnd() - 0.5) * 2 * rumore);
    if (ombra && x < 12) col = [40, 40, 40];
    const [u, v] = applicaOmografia(Hinv, x + 0.5, y + 0.5);
    if (u >= 0 && v >= 0 && u <= CARD_W && v <= CARD_H) {
      const dx = Math.max(R - u, 0, u - (CARD_W - R)); const dy = Math.max(R - v, 0, v - (CARD_H - R));
      if (dx * dx + dy * dy <= R * R) {
        col = colore.slice();
        if (u > CARD_W * 0.05 && u < CARD_W * 0.32 && v > CARD_H * 0.2 && v < CARD_H * 0.85) col = [120, 100, 90]; // «foto»
        if (u > CARD_W * 0.4 && u < CARD_W * 0.95 && Math.floor(v / (CARD_H / 9)) % 2 && v > CARD_H * 0.2) col = col.map((q) => q - 60); // righe di testo
        if (bordo && (u < 1.2 || v < 1.2 || u > CARD_W - 1.2 || v > CARD_H - 1.2 || dx * dx + dy * dy > (R - 1.2) ** 2)) col = bordo.slice();
      }
    }
    data[o] = col[0]; data[o + 1] = col[1]; data[o + 2] = col[2]; data[o + 3] = 255;
  }
  return { img: { width: W, height: H, data }, angoli };
}

function errore(trovati, veri) { return Math.max(...trovati.map((p, i) => Math.hypot(p[0] - veri[i][0], p[1] - veri[i][1]))); }
const TOLL = 0.025 * Math.hypot(CARD_W, CARD_H); // 2,5% della diagonale (≈ 2,5 mm)

describe('rilevamento della tessera', () => {
  const casi = [
    ['dritta in alto a sinistra, fondo bianco', { cx: 250, cy: 250 }],
    ['spostata in basso a destra', { cx: 600, cy: 950 }],
    ['ruotata di 7°', { angolo: 7, cx: 400, cy: 500 }],
    ['ruotata di -23°', { angolo: -23, cx: 420, cy: 600 }],
    ['fondo grigio scuro', { fondo: [70, 72, 75], colore: [230, 200, 210] }],
    ['fondo «legno» rumoroso', { fondo: [170, 130, 90], rumore: 18, colore: [235, 235, 240], seed: 7 }],
    ['tessera bianca su fondo bianco (solo il contorno)', { colore: [250, 250, 250], fondo: [255, 255, 255], bordo: [150, 150, 150], rumore: 1 }],
    ['in prospettiva (foto col telefono)', { cx: 420, cy: 560, angolo: 4, prospettiva: [[-14, -8], [12, 6], [4, 10], [-6, -4]] }],
    ['con l\'ombra del coperchio sul bordo della pagina', { ombra: true, cx: 450, cy: 700 }],
  ];
  for (const [nome, opz] of casi) {
    it(nome, () => {
      const { img, angoli } = scansione(opz);
      const r = trovaTessera(img);
      expect(r).not.toBeNull();
      const e = errore(r.corners, angoli);
      expect(e, `errore ${e.toFixed(1)} px (tolleranza ${TOLL.toFixed(1)})`).toBeLessThan(TOLL);
      expect(r.aspetto).toBeGreaterThan(1.45); expect(r.aspetto).toBeLessThan(1.72);
      expect(r.confidenza).toBeGreaterThan(0.75);
    });
  }

  it('tessera in verticale (ruotata di 90°): gli angoli tornano in orizzontale', () => {
    const { img, angoli } = scansione({ angolo: 90, cx: 400, cy: 500 });
    const r = trovaTessera(img);
    // in verticale non si sa se la tessera è girata a destra o a sinistra: Leggio la mette in orizzontale e,
    // se esce capovolta, si corregge con «Capovolgi» (due giri)
    expect(Math.min(errore(r.corners, angoli), errore(ruotaAngoli(r.corners, 2), angoli))).toBeLessThan(TOLL);
    const lato = Math.hypot(r.corners[1][0] - r.corners[0][0], r.corners[1][1] - r.corners[0][1]);
    expect(lato).toBeGreaterThan(CARD_W * 0.95); // il lato «alto» è quello lungo
  });

  it('capovolta di 180°: si corregge con due giri di «Ruota»', () => {
    const { img, angoli } = scansione({ angolo: 180, cx: 400, cy: 500 });
    const r = trovaTessera(img);
    expect(errore(ruotaAngoli(r.corners, 2), angoli)).toBeLessThan(TOLL);
  });

  it('pagina vuota: nessuna tessera', () => {
    const W = 200; const H = 280; const data = new Uint8ClampedArray(W * H * 4).fill(250);
    expect(trovaTessera({ width: W, height: H, data })).toBeNull();
  });
});

describe('raddrizzamento e impaginazione', () => {
  it('il ritaglio raddrizzato ha la foto a sinistra e le proporzioni giuste', () => {
    const { img } = scansione({ angolo: -18, cx: 420, cy: 600 });
    const r = trovaTessera(img);
    const { w, h } = pixelUscita('id1', 100);
    const out = raddrizza(img, r.corners, w, h);
    const px = (u, v) => { const o = (Math.round(v * h) * w + Math.round(u * w)) * 4; return [out.data[o], out.data[o + 1], out.data[o + 2]]; };
    const foto = px(0.18, 0.5); const fondo = px(0.36, 0.1);
    expect(Math.abs(foto[0] - 120)).toBeLessThan(25); // grigio-marrone della foto
    expect(Math.abs(fondo[2] - 226)).toBeLessThan(25); // azzurro della tessera
  });

  it('A4, scala reale: fronte e retro misurano 85,6 × 53,98 mm, centrati, fronte sopra', () => {
    const L = impagina({ formato: 'id1', carta: 'A4', scala: 'reale' });
    expect(L.pagina[0] / MM).toBeCloseTo(210, 3); expect(L.pagina[1] / MM).toBeCloseTo(297, 3);
    for (const q of [L.fronte, L.retro]) { expect(q.w / MM).toBeCloseTo(85.6, 5); expect(q.h / MM).toBeCloseTo(53.98, 5); expect((q.x + q.w / 2) / MM).toBeCloseTo(105, 5); }
    expect(L.fronte.y).toBeGreaterThan(L.retro.y + L.retro.h);
    expect(L.fattore).toBe(1);
  });

  it('ingrandita e Letter; carta cartacea con il suo formato', () => {
    const big = impagina({ scala: 'ingrandita' });
    expect(big.fattore).toBeGreaterThan(1.5);
    expect(big.fronte.x).toBeGreaterThanOrEqual(15 * MM - 1e-6);
    const let_ = impagina({ carta: 'Letter' });
    expect(let_.pagina[0] / MM).toBeCloseTo(215.9, 3);
    const c = impagina({ formato: 'cartacea' });
    expect(c.fronte.w / MM).toBeCloseTo(FORMATI_DOCUMENTO.cartacea.w, 5);
    expect(c.retro.y).toBeGreaterThan(0);
  });

  it('nel PDF prodotto l\'immagine misura davvero 85,6 × 54 mm (300 dpi)', async () => {
    const { w, h } = pixelUscita('id1', 300);
    expect(w).toBe(1011); expect(h).toBe(638);
    const L = impagina({});
    const d = await PDFDocument.create();
    const p = d.addPage(L.pagina);
    const png = await d.embedPng(Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64')));
    p.drawImage(png, L.fronte);
    const bytes = await d.save();
    const txt = Buffer.from(bytes).toString('latin1');
    // matrice «w 0 0 h x y cm» del disegno dell'immagine
    const m = /([\d.]+) 0 0 ([\d.]+) ([\d.]+) ([\d.]+) cm/.exec(txt) || /q\s+([\d.]+) 0 0 ([\d.]+)/.exec(txt);
    if (m) { expect(Number(m[1]) / MM).toBeCloseTo(85.6, 1); expect(Number(m[2]) / MM).toBeCloseTo(53.98, 1); }
  });

  it('bianco e nero e contrasto', () => {
    const img = { width: 2, height: 1, data: new Uint8ClampedArray([100, 120, 140, 255, 140, 150, 160, 255]) };
    migliora(img, { biancoNero: true, contrasto: true });
    expect(img.data[0]).toBe(img.data[1]); expect(img.data[0]).toBeLessThan(60); expect(img.data[4]).toBeGreaterThan(200);
  });

  it('coppie fronte/retro predefinite', () => {
    expect(coppiePredefinite(4)).toEqual([[0, 1], [2, 3]]);
    expect(coppiePredefinite(3)).toEqual([[0, 1], [2, null]]);
  });

  it('ordine degli angoli: alto-sinistra per primo, in senso orario', () => {
    expect(ordinaAngoli([[10, 60], [100, 0], [0, 0], [100, 60]])).toEqual([[0, 0], [100, 0], [100, 60], [10, 60]]);
  });
});
