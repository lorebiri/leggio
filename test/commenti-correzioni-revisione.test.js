// Correzioni dalla revisione dell'area commenti: selezioni con titoli, pagine ruotate, testo non latino.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PDFDocument, degrees } from '@cantoo/pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { mergeLineRects, linesToQuadPoints, quadsFromPoints } from '../src/renderer/features/commenti/geom.js';
import { buildAppearance } from '../src/renderer/features/commenti/appearance.js';
import { createAnnot, flattenComments, setUnicodeFontLoader } from '../src/renderer/features/commenti/annots.js';

// pdf.js vuole la barra finale «/» anche su Windows
const FONTS = fileURLToPath(new URL('../node_modules/pdfjs-dist/standard_fonts/', import.meta.url)).replace(/\\/g, '/');

async function items(bytes) {
  const t = pdfjs.getDocument({ data: bytes.slice(), standardFontDataUrl: FONTS });
  const d = await t.promise; const p = await d.getPage(1);
  const out = { rotate: p.rotate, items: (await p.getTextContent()).items };
  await t.destroy();
  return out;
}
/** Angolo del testo come appare sullo schermo (0 = diritto). */
const screenAngle = (it, rotate) => ((Math.round(Math.atan2(it.transform[1], it.transform[0]) * 180 / Math.PI) - rotate) % 360 + 360) % 360;

describe('selezione di testo: righe', () => {
  it('un titolo più alto del testo normale resta evidenziato', () => {
    const lines = mergeLineRects([[10, 100, 50, 112], [52, 100, 90, 112], [10, 54, 200, 96], [10, 40, 60, 52]]);
    expect(lines).toEqual([[10, 100, 90, 112], [10, 54, 200, 96], [10, 40, 60, 52]]);
    // un riquadro spurio grande come la pagina continua a essere scartato
    expect(mergeLineRects([[10, 100, 50, 112], [52, 100, 90, 112], [0, 0, 600, 800]])).toEqual([[10, 100, 90, 112]]);
  });
  it('pagina ruotata di 90°: i pezzi di una riga (verticale nello spazio PDF) diventano una riga sola', () => {
    const spans = [[100, 100, 112, 110], [100, 110, 112, 120], [100, 120, 112, 130], [100, 130, 112, 330]];
    expect(mergeLineRects(spans, 90)).toEqual([[100, 100, 112, 330]]);
  });
});

describe('sottolineato e barrato sulle pagine ruotate', () => {
  for (const [rot, edge] of [[90, 112], [270, 100]]) {
    it(`/Rotate ${rot}: la linea corre lungo la riga, vicino al bordo inferiore visto sullo schermo`, () => {
      const qp = linesToQuadPoints([[100, 100, 112, 330]], rot);
      const q = quadsFromPoints(qp, rot)[0];
      expect(q.bl[0]).toBe(edge); // il "basso" del testo è un lato verticale nello spazio PDF
      const ap = buildAppearance({ type: 'Underline', rect: [100, 100, 112, 330], quadPoints: qp, color: [0, 0, 1], rotation: rot }).content;
      const m = /([\d.]+) ([\d.]+) m ([\d.]+) ([\d.]+) l S/.exec(ap).slice(1).map(Number);
      expect(m[0]).toBeCloseTo(m[2]); // linea verticale nello spazio PDF
      expect(Math.abs(m[3] - m[1])).toBeCloseTo(230);
      expect(Math.abs(m[0] - edge)).toBeLessThan(2);
    });
  }
  it('pagina non ruotata: stesso disegno di prima', () => {
    const ap = buildAppearance({ type: 'Underline', rect: [50, 588, 200, 600], quadPoints: [50, 600, 200, 600, 50, 588, 200, 588], color: [0, 0, 1] }).content;
    expect(ap).toBe('/GS0 gs 0 0 1 RG 0.75 w 50 588.9 m 200 588.9 l S');
  });
});

describe('caselle di testo, timbri e misure sulle pagine ruotate', () => {
  it('testo della casella e del timbro diritti sullo schermo con /Rotate 90', async () => {
    const d = await PDFDocument.create(); const p = d.addPage([595, 842]); p.setRotation(degrees(90));
    await createAnnot(d, 0, { type: 'FreeText', rect: [100, 100, 160, 400], text: 'Ciao mondo', fontSize: 12 });
    await createAnnot(d, 0, { type: 'Stamp', rect: [100, 450, 144, 610], stamp: { label: 'APPROVATO', color: [0, 0.5, 0] } });
    await flattenComments(d);
    const { rotate, items: its } = await items(await d.save());
    expect(rotate).toBe(90);
    const texts = its.filter((i) => i.str.trim());
    expect(texts.map((i) => i.str).join(' ')).toContain('APPROVATO');
    for (const it of texts) expect(screenAngle(it, rotate)).toBe(0);
  });
  it('etichetta di misura su /Rotate 90: non capovolta sullo schermo', () => {
    const f = { widthOfTextAtSize: (s, fs) => s.length * fs * 0.5, encodeText: (s) => ({ toString: () => `(${s})` }) };
    const ap = buildAppearance({ type: 'Polygon', rect: [0, 0, 100, 100], vertices: [[0, 0], [100, 0], [100, 100]], color: [0, 0, 0], measureLabel: '3 m²', rotation: 90 }, { regular: f }).content;
    expect(ap).toMatch(/q 0 1 -1 0 [\d.]+ [\d.]+ cm/); // ruotata di 90° come la pagina
  });
});

describe('testo non latino nelle caselle di testo', () => {
  it('con il font Unicode il greco e il cirillico restano leggibili (non «?»)', async () => {
    setUnicodeFontLoader(async ({ bold }) => new Uint8Array(readFileSync(new URL(`../node_modules/pdfjs-dist/standard_fonts/LiberationSans-${bold ? 'Bold' : 'Regular'}.ttf`, import.meta.url))));
    try {
      const d = await PDFDocument.create(); d.registerFontkit(fontkit); d.addPage();
      await createAnnot(d, 0, { type: 'FreeText', rect: [50, 600, 300, 650], text: 'Καλημέρα Привет' });
      await createAnnot(d, 0, { type: 'FreeText', rect: [50, 500, 300, 550], text: 'Ancora Ωmega' });
      await flattenComments(d);
      const bytes = await d.save();
      const txt = (await items(bytes)).items.map((i) => i.str).join(' ');
      expect(txt).toContain('Καλημέρα Привет');
      expect(txt).toContain('Ωmega');
      expect(txt).not.toContain('?');
      expect(bytes.length).toBeLessThan(150000); // un solo font Unicode incorporato
    } finally { setUnicodeFontLoader(null); }
  });
});
