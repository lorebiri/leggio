import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { PDFDocument, StandardFonts, degrees } from '@cantoo/pdf-lib';
import { reorderPdfPages } from '../src/renderer/core/pagetree.js';

const require = createRequire(import.meta.url);
pdfjs.GlobalWorkerOptions.workerSrc = require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs');
async function texts(bytes) {
  const t = pdfjs.getDocument({ data: bytes.slice(), verbosity: 0 }); const pdf = await t.promise; const out = [];
  for (let i = 1; i <= pdf.numPages; i++) { const p = await pdf.getPage(i); out.push((await p.getTextContent()).items.map((x) => x.str).join('') + '@' + p.rotate); }
  await t.destroy(); return out;
}

describe('reorderPdfPages', () => {
  it('riordino completo (inversione) con rotazioni e campi modulo: file valido', async () => {
    const d = await PDFDocument.create(); const f = await d.embedFont(StandardFonts.Helvetica);
    for (let i = 1; i <= 8; i++) d.addPage([300, 300]).drawText('P' + i, { x: 20, y: 250, size: 18, font: f });
    d.getPage(2).setRotation(degrees(90));
    d.getForm().createTextField('campo').addToPage(d.getPage(0), { x: 10, y: 10, width: 100, height: 20 });
    const doc = await PDFDocument.load(await d.save());
    reorderPdfPages(doc, [7, 6, 5, 4, 3, 2, 1, 0]);
    const out = await doc.save({ useObjectStreams: true });
    expect(await texts(out)).toEqual(['P8@0', 'P7@0', 'P6@0', 'P5@0', 'P4@0', 'P3@90', 'P2@0', 'P1@0']);
    const again = await PDFDocument.load(out);
    expect(again.getForm().getFields().length).toBe(1);
  });
  it('rifiuta ordini incompleti o con ripetizioni', async () => {
    const d = await PDFDocument.create(); d.addPage(); d.addPage();
    const doc = await PDFDocument.load(await d.save());
    expect(() => reorderPdfPages(doc, [0])).toThrow();
    expect(() => reorderPdfPages(doc, [0, 0])).toThrow();
  });
});
