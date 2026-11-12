import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { PDFDocument, StandardFonts, PDFStream, PDFString } from '@cantoo/pdf-lib';
import { fileURLToPath } from 'node:url';
// pdf.js vuole la barra finale «/» anche su Windows
const FONTS = fileURLToPath(new URL('../node_modules/pdfjs-dist/standard_fonts/', import.meta.url)).replace(/\\/g, '/');
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { buildPageText, rangeRects, pageWords, wordsOutside } from '../src/renderer/features/sicurezza/logica/testo.js';
import { buildMatchers, findMatches } from '../src/renderer/features/sicurezza/logica/modelli.js';
import { redactPage, embedTextFont, finalizeRedaction, redactOutlineTitles } from '../src/renderer/features/sicurezza/logica/redazione.js';
import { verifyRedaction } from '../src/renderer/features/sicurezza/logica/verifica.js';
import { streamBytes } from '../src/renderer/features/sicurezza/logica/pdfutil.js';

// PNG 1×1 nero: nei test il "rendering" della pagina non serve, conta che il testo sparisca
const PNG = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64'));

async function pageText(bytes, i) {
  const task = pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false, standardFontDataUrl: FONTS });
  const d = await task.promise;
  const p = await d.getPage(i + 1);
  const tc = await p.getTextContent();
  const out = { items: tc.items, view: p.view, text: tc.items.map((x) => x.str).join(' ') };
  await task.destroy();
  return out;
}

/** Documento con dati personali, un commento sopra il CF, un campo e un segnalibro. */
async function makeDoc() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < 2; i++) {
    const p = doc.addPage([595, 842]);
    p.drawText('Contratto di incarico', { x: 50, y: 780, size: 18, font });
    p.drawText('Codice fiscale: RSSMRA85T10A562S residente a Pisa', { x: 50, y: 740, size: 12, font });
    p.drawText('IBAN: IT60X0542811101000000123456 intestato al professionista', { x: 50, y: 720, size: 12, font });
    p.drawText('Partita IVA del fornitore 12345678903 resta visibile', { x: 50, y: 700, size: 12, font });
  }
  const form = doc.getForm();
  const tf = form.createTextField('cf_campo'); tf.setText('RSSMRA85T10A562S'); tf.addToPage(doc.getPage(0), { x: 300, y: 600, width: 200, height: 20 });
  const tf2 = form.createTextField('altro'); tf2.setText('niente'); tf2.addToPage(doc.getPage(0), { x: 50, y: 400, width: 200, height: 20 });
  doc.setTitle('Incarico RSSMRA85T10A562S');
  return new Uint8Array(await doc.save());
}

describe('oscuramento (redazione)', () => {
  it('cerca CF e IBAN, oscura e il testo non è più estraibile, il resto sì', async () => {
    const src = await makeDoc();
    const matchers = buildMatchers({ models: ['cf', 'iban'] });
    const pdfDoc = await PDFDocument.load(src);
    const font = await embedTextFont(pdfDoc);
    const marks = new Map(); const terms = [];
    for (let i = 0; i < 2; i++) {
      const { items, view } = await pageText(src, i);
      const pt = buildPageText(items);
      const hits = findMatches(pt.text, matchers);
      expect(hits.map((h) => h.text)).toEqual(['RSSMRA85T10A562S', 'IT60X0542811101000000123456']);
      const rects = hits.flatMap((h) => rangeRects(pt, h.start, h.end));
      if (i === 0) rects.push([300, 600, 500, 620]); // area libera sul campo
      marks.set(i, rects);
      terms.push(...hits.map((h) => h.text));
      const keep = wordsOutside(pageWords(items), rects);
      const r = await redactPage(pdfDoc, i, { image: { bytes: PNG, kind: 'png' }, view, rects, keepWords: keep, font });
      if (i === 0) expect(r.fields).toBe(1);
    }
    pdfDoc.setTitle('Incarico');
    await finalizeRedaction(pdfDoc);
    const out = await pdfDoc.save();
    const t0 = await pageText(out, 0);
    expect(t0.text).not.toContain('RSSMRA85T10A562S');
    expect(t0.text).not.toContain('IT60X0542811101000000123456');
    expect(t0.text).toContain('Contratto');
    expect(t0.text).toContain('12345678903'); // la P.IVA non selezionata resta ricercabile
    expect(t0.text).toContain('residente');
    const v = await verifyRedaction(pdfjs, out, marks, terms, { getDocumentOptions: { standardFontDataUrl: FONTS } });
    expect(v.problems).toEqual([]);
    expect(v.ok).toBe(true);
    // nessun flusso del file contiene ancora il vecchio contenuto (gli oggetti orfani sono stati eliminati)
    const again = await PDFDocument.load(out);
    for (const [, obj] of again.context.enumerateIndirectObjects()) {
      if (!(obj instanceof PDFStream)) continue;
      const b = streamBytes(obj); if (!b) continue;
      const s = Buffer.from(b).toString('latin1');
      expect(s.includes('RSSMRA') || s.includes(Buffer.from('RSSMRA').toString('hex').toUpperCase())).toBe(false);
    }
    expect(again.getForm().getFields().map((f) => f.getName())).toEqual(['altro']);
  });

  it('la verifica segnala il testo rimasto (oscuramento solo "coperto")', async () => {
    const src = await makeDoc();
    const { items } = await pageText(src, 0);
    const pt = buildPageText(items);
    const hits = findMatches(pt.text, buildMatchers({ models: ['cf'] }));
    const rects = hits.flatMap((h) => rangeRects(pt, h.start, h.end));
    // simulazione di un oscuramento falso: riquadro nero disegnato sopra, testo ancora sotto
    const d = await PDFDocument.load(src);
    const [x1, y1, x2, y2] = rects[0];
    d.getPage(0).drawRectangle({ x: x1, y: y1, width: x2 - x1, height: y2 - y1 });
    const fake = await d.save();
    const v = await verifyRedaction(pdfjs, fake, new Map([[0, rects]]), ['RSSMRA85T10A562S'], { getDocumentOptions: { standardFontDataUrl: FONTS } });
    expect(v.ok).toBe(false);
    expect(v.problems.some((p) => p.where.includes('area oscurata'))).toBe(true);
    expect(v.problems.some((p) => p.where === 'proprietà del documento')).toBe(true);
  });

  it('i segnalibri con il termine vengono oscurati', async () => {
    const d = await PDFDocument.create(); d.addPage();
    const ctx = d.context;
    const item = ctx.obj({ Title: PDFString.of('Mario RSSMRA85T10A562S') });
    const itemRef = ctx.register(item);
    const outl = ctx.register(ctx.obj({ Type: 'Outlines', First: itemRef, Last: itemRef, Count: 1 }));
    item.set(ctx.obj('Parent'), outl);
    d.catalog.set(ctx.obj('Outlines'), outl);
    const m = buildMatchers({ models: ['cf'] });
    const n = redactOutlineTitles(d, (s, rep) => { let o = s; for (const h of findMatches(s, m).reverse()) o = o.slice(0, h.start) + rep + o.slice(h.end); return o; });
    expect(n).toBe(1);
    const out = await d.save();
    const doc = await pdfjs.getDocument({ data: out }).promise;
    expect((await doc.getOutline())[0].title).toBe('Mario ████');
  });
});
