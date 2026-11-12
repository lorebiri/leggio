import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import * as PDFLib from '@cantoo/pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { profiloSRGB, xmpPdfa, convertiPdfA, preflightPdfA, incorporaFontSans, elencoFont, winAnsiUnicode } from '../src/renderer/features/conversione/lib/pdfa.js';

const SF = 'node_modules/pdfjs-dist/standard_fonts/';
const fonts = { regular: readFileSync(SF + 'LiberationSans-Regular.ttf'), bold: readFileSync(SF + 'LiberationSans-Bold.ttf'), italic: readFileSync(SF + 'LiberationSans-Italic.ttf'), boldItalic: readFileSync(SF + 'LiberationSans-BoldItalic.ttf') };
const decode = (s) => PDFLib.decodePDFRawStream(s).decode();

describe('profilo sRGB', () => {
  it('intestazione ICC valida', () => {
    const p = profiloSRGB();
    const dv = new DataView(p.buffer);
    expect(dv.getUint32(0)).toBe(p.length);
    expect(new TextDecoder().decode(p.slice(36, 40))).toBe('acsp');
    expect(new TextDecoder().decode(p.slice(12, 24))).toBe('mntrRGB XYZ ');
    expect(dv.getUint32(128)).toBe(9);
  });
});

describe('XMP', () => {
  it('contiene identificazione e metadati con escape', () => {
    const x = xmpPdfa({ part: 2, title: 'A & B <prova>', author: 'Rossi', createDate: new Date('2026-11-12T10:00:00Z') });
    expect(x).toContain('<pdfaid:part>2</pdfaid:part>');
    expect(x).toContain('<pdfaid:conformance>B</pdfaid:conformance>');
    expect(x).toContain('A &amp; B &lt;prova&gt;');
    expect(x).toContain('<xmp:CreateDate>2026-11-12T10:00:00Z</xmp:CreateDate>');
  });
  it('codifica WinAnsi', () => { expect(winAnsiUnicode(0x80)).toBe(0x20ac); expect(winAnsiUnicode(0xe8)).toBe(0xe8); expect(winAnsiUnicode(0x81)).toBeNull(); });
});

describe('conversione PDF/A', () => {
  it('un PDF con Helvetica non incorporata diventa conforme ai controlli', async () => {
    const doc = await PDFLib.PDFDocument.load(readFileSync('test/fixtures/conv-contratto-v1.pdf'));
    const prima = preflightPdfA(doc, PDFLib, { decode });
    expect(prima.find((c) => c.id === 'identificazione').ok).toBe(false);
    expect(prima.find((c) => c.id === 'font').ok).toBe(false);
    expect(prima.find((c) => c.id === 'font').correggibile).toBe(true);
    const n = incorporaFontSans(doc, PDFLib, fonts, fontkit);
    expect(n).toBe(3); // normale, grassetto, corsivo
    const { azioni } = convertiPdfA(doc, PDFLib, { part: 2, lang: 'it-IT' });
    expect(azioni.length).toBeGreaterThan(1);
    const bytes = await doc.save({ useObjectStreams: true });
    const dopo = await PDFLib.PDFDocument.load(bytes, { updateMetadata: false });
    const res = preflightPdfA(dopo, PDFLib, { decode });
    expect(res.filter((c) => !c.ok)).toEqual([]);
    expect(elencoFont(dopo, PDFLib).every((f) => f.incorporato)).toBe(true);
    expect(dopo.getTitle()).toBe('Contratto di fornitura');
    expect(dopo.getProducer()).toBe('Leggio');
  });
  it('annotazioni nascoste diventano stampabili; script rimossi', async () => {
    const doc = await PDFLib.PDFDocument.create();
    const page = doc.addPage();
    const ctx = doc.context;
    const annot = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Text', Rect: [10, 10, 30, 30], F: 2, A: { S: 'JavaScript', JS: PDFLib.PDFString.of('app.alert(1)') } }));
    page.node.set(PDFLib.PDFName.of('Annots'), ctx.obj([annot]));
    doc.catalog.set(PDFLib.PDFName.of('Names'), ctx.obj({ JavaScript: ctx.obj({}) }));
    convertiPdfA(doc, PDFLib, {});
    const a = ctx.lookup(annot);
    expect(a.lookup(PDFLib.PDFName.of('F')).asNumber()).toBe(4);
    expect(a.get(PDFLib.PDFName.of('A'))).toBeUndefined();
    const res = preflightPdfA(doc, PDFLib, { decode });
    expect(res.find((c) => c.id === 'script').ok).toBe(true);
    expect(res.find((c) => c.id === 'annotazioni').ok).toBe(true);
  });
});
