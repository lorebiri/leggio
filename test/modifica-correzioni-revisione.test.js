// Correzioni dalla revisione dell'area modifica: font Unicode riusato, ricerca con «İ», caratteri di controllo.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PDFDocument } from '@cantoo/pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { addText, findInPage } from '../src/renderer/features/modifica/operations.js';
import { winAnsiCode } from '../src/renderer/features/modifica/fontmodel.js';

// pdf.js vuole la barra finale «/» anche su Windows
const FONTS = fileURLToPath(new URL('../node_modules/pdfjs-dist/standard_fonts/', import.meta.url)).replace(/\\/g, '/');
const TTF = new Uint8Array(readFileSync(new URL('../node_modules/pdfjs-dist/standard_fonts/LiberationSans-Regular.ttf', import.meta.url)));
const env = { loadUnicodeFont: async () => TTF };

describe('testo non latino aggiunto più volte', () => {
  it('il font Unicode viene incorporato una volta sola e il testo resta leggibile', async () => {
    let d = await PDFDocument.create(); d.registerFontkit(fontkit); d.addPage([595, 842]);
    let bytes = await d.save();
    const sizes = [];
    for (let k = 1; k <= 3; k++) {
      d = await PDFDocument.load(bytes); d.registerFontkit(fontkit);
      const r = await addText(d, 0, { x: 50, y: 800 - k * 30 }, 'Καλημέρα ' + k, { size: 12 }, env);
      expect(r.fontKind).toBe('unicode');
      bytes = await d.save();
      sizes.push(bytes.length);
    }
    expect(sizes[2] - sizes[0]).toBeLessThan(30000); // prima ogni modifica aggiungeva ~95 KB
    const t = pdfjs.getDocument({ data: bytes.slice(), standardFontDataUrl: FONTS }); const doc = await t.promise;
    const txt = (await (await doc.getPage(1)).getTextContent()).items.map((i) => i.str).join(' ');
    await t.destroy();
    for (const k of [1, 2, 3]) expect(txt).toContain('Καλημέρα ' + k);
  });
});

describe('trova nella modalità modifica', () => {
  it('la «İ» turca (minuscola di due unità) non sposta le occorrenze successive', () => {
    const text = 'İİ Roma Milano';
    const refs = [...text].map((ch, i) => ({ g: { o: [i * 10, 0], e: [i * 10 + 8, 0], top: [i * 10, 8] }, ch }));
    const r = findInPage(null, 'Milano', {}, { text, refs });
    expect(r).toHaveLength(1);
    expect(r[0].text).toBe('Milano');
    expect(r[0].start).toBe(text.indexOf('Milano'));
    expect(r[0].refs.map((x) => x.ch).join('')).toBe('Milano');
    // la «İ» stessa si trova anche cercando in minuscolo
    expect(findInPage(null, 'i̇i̇', {}, { text, refs })[0]).toMatchObject({ start: 0, end: 2, text: 'İİ' });
    expect(findInPage(null, 'roma', { wholeWord: true }, { text, refs })[0]).toMatchObject({ start: 3, end: 7 });
  });
});

describe('codifica WinAnsi', () => {
  it('i caratteri di controllo non sono codificabili', () => {
    expect(winAnsiCode('\0')).toBe(-1);
    expect(winAnsiCode('\t')).toBe(-1);
    expect(winAnsiCode('€')).toBe(0x80);
    expect(winAnsiCode('A')).toBe(0x41);
  });
});
