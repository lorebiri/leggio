import { describe, it, expect } from 'vitest';
import { PDFDocument } from '@cantoo/pdf-lib';
import * as G from '../src/renderer/features/commenti/geom.js';
import { buildAppearance, STAMPS } from '../src/renderer/features/commenti/appearance.js';
import { toXfdf, fromXfdf, parseXml } from '../src/renderer/features/commenti/xfdf.js';
import { fromPdfjs, buildThreads, filterThreads, facets, summaryText, summaryHtml, cleanStr } from '../src/renderer/features/commenti/model.js';
import { summaryDocx, summaryPdf } from '../src/renderer/features/commenti/summary-docs.js';
import { createAnnot, readAllAnnotations } from '../src/renderer/features/commenti/annots.js';

const fakeFont = { encodeText: (s) => ({ toString: () => '<' + Buffer.from(s, 'latin1').toString('hex') + '>' }), widthOfTextAtSize: (s, fs) => s.length * fs * 0.5 };

describe('geom', () => {
  it('colori', () => {
    expect(G.hexToRgb('#ff0000')).toEqual([1, 0, 0]);
    expect(G.hexToRgb('abc')).toEqual([0xaa / 255, 0xbb / 255, 0xcc / 255]);
    expect(G.hexToRgb('nonvalido', null)).toBe(null);
    expect(G.rgbToHex([1, 0.5, 0])).toBe('#ff8000');
    expect(G.rgbToHex(new Uint8ClampedArray([255, 0, 0]), true)).toBe('#ff0000');
    expect(G.rgbToHex([0, 0, 0, 1])).toBe('#000000');
    expect(G.rgbToHex([])).toBe(null);
    expect(G.rgbToHex(null)).toBe(null);
  });
  it('rettangoli e quadpoints', () => {
    expect(G.normRect([10, 20, 0, 5])).toEqual([0, 5, 10, 20]);
    expect(G.normRect([1, 2, 'x', 4])).toBe(null);
    expect(G.normRect(null)).toBe(null);
    const lines = G.mergeLineRects([[10, 100, 50, 112], [52, 100, 90, 112], [10, 80, 60, 92], [0, 0, 600, 800]]);
    expect(lines).toEqual([[10, 100, 90, 112], [10, 80, 60, 92]]);
    expect(G.mergeLineRects([])).toEqual([]);
    const qp = G.linesToQuadPoints(lines);
    expect(qp.slice(0, 8)).toEqual([10, 112, 90, 112, 10, 100, 90, 100]);
    const q = G.quadsFromPoints([10, 100, 90, 100, 10, 112, 90, 112]); // ordine "sbagliato"
    expect(q[0].tl).toEqual([10, 112]);
    expect(G.quadsFromPoints([1, 2, 3])).toEqual([]);
  });
  it('tratto, gomma, nuvola', () => {
    const pts = Array.from({ length: 50 }, (_, i) => [i, Math.sin(i / 5) * 10]);
    expect(G.simplify(pts, 0.5).length).toBeLessThan(50);
    expect(G.smooth(pts, 0.5)).toHaveLength(50);
    expect(G.smoothPathOps([[0, 0], [10, 10], [20, 0]])).toMatch(/ c /);
    const { strokes, changed } = G.eraseFromStrokes([[[0, 0], [10, 0], [20, 0], [30, 0], [40, 0]]], [[20, 0]], 3);
    expect(changed).toBe(true);
    expect(strokes).toEqual([[[0, 0], [10, 0]], [[30, 0], [40, 0]]]);
    expect(G.cloudPathOps(G.rectVertices([0, 0, 100, 50]))).toMatch(/ h$/);
    expect(G.cloudPathOps([[0, 0]])).toBe('');
  });
  it('misure con scala', () => {
    const s = { docValue: 1, docUnit: 'cm', realValue: 1, realUnit: 'm' };
    const cm = 72 / 2.54;
    expect(G.measure('distance', [[0, 0], [cm * 3, 0]], s).value).toBeCloseTo(3);
    expect(G.measure('area', [[0, 0], [cm * 2, 0], [cm * 2, cm * 2], [0, cm * 2]], s).value).toBeCloseTo(4);
    expect(G.measure('perimeter', [[0, 0], [cm, 0], [cm, cm], [0, cm]], s).value).toBeCloseTo(4);
    expect(G.measure('area', [[0, 0], [cm * 2, 0], [cm * 2, cm * 2], [0, cm * 2]], s).label).toBe('4 m²');
    expect(G.normScale({ docValue: -1, docUnit: 'x', realValue: 'a' })).toEqual({ docValue: 1, docUnit: 'cm', realValue: 1, realUnit: 'cm' });
    expect(G.scaleLabel(s)).toBe('1 cm = 1 m');
  });
  it('date PDF', () => {
    const d = new Date(2026, 10, 12, 9, 5, 7);
    const s = G.pdfDate(d);
    expect(s).toMatch(/^D:20261112090507/);
    expect(G.parsePdfDate(s).getTime()).toBe(d.getTime());
    expect(G.parsePdfDate("D:20260101120000Z").toISOString()).toBe('2026-01-01T12:00:00.000Z');
    expect(G.parsePdfDate("D:20260101120000+02'00'").toISOString()).toBe('2026-01-01T10:00:00.000Z');
    expect(G.parsePdfDate('D:2026')).toBeTruthy();
    expect(G.parsePdfDate('spazzatura')).toBe(null);
    expect(G.parsePdfDate('D:20261399')).toBe(null);
    expect(G.parsePdfDate(undefined)).toBe(null);
  });
  it('a capo e campi dei timbri', () => {
    const w = (s) => s.length;
    expect(G.wrapText('uno due tre quattro', 7, w)).toEqual(['uno due', 'tre', 'quattro']);
    expect(G.wrapText('abcdefghij', 4, w)).toEqual(['abcd', 'efgh', 'ij']);
    expect(G.wrapText('a\n\nb', 10, w)).toEqual(['a', '', 'b']);
    const d = new Date(2026, 10, 12, 9, 5);
    expect(G.fillStampFields('PAGATO il {data} mandato n. {numero} — {autore}', { author: 'Anna', number: 42, date: d })).toBe('PAGATO il 12/11/2026 mandato n. 42 — Anna');
    expect(G.fillStampFields(null)).toBe('');
  });
});

describe('aspetti', () => {
  it('genera operatori per ogni tipo', () => {
    const f = { regular: fakeFont, bold: fakeFont };
    const base = { color: [1, 0, 0], width: 1, rect: [0, 0, 100, 100] };
    for (const t of ['Highlight', 'Underline', 'StrikeOut', 'Squiggly']) expect(buildAppearance({ ...base, type: t, quadPoints: [0, 10, 50, 10, 0, 0, 50, 0] }, f).content).toMatch(/[fS]/);
    expect(buildAppearance({ ...base, type: 'Highlight', quadPoints: [0, 10, 50, 10, 0, 0, 50, 0] }, f).gs.BM).toBe('Multiply');
    expect(buildAppearance({ ...base, type: 'FreeText', text: 'ciao mondo', fontSize: 12 }, f).content).toMatch(/Tj/);
    expect(buildAppearance({ ...base, type: 'Stamp', stamp: STAMPS[0] }, f).fonts.F2).toBe('bold');
    expect(buildAppearance({ ...base, type: 'Line', line: [0, 0, 100, 100], lineEnding: ['None', 'ClosedArrow'], measureLabel: '3 m' }, f).content).toMatch(/Tj/);
    expect(buildAppearance({ ...base, type: 'Text', reply: true }, f).content).toBe('');
    expect(buildAppearance({ ...base, type: 'Link' }, f)).toBe(null);
    // dati mancanti: nessuna eccezione
    expect(() => buildAppearance({ type: 'Ink' }, f)).not.toThrow();
    expect(() => buildAppearance({ type: 'Polygon', rect: [0, 0, 1, 1] }, f)).not.toThrow();
  });
});

describe('XFDF', () => {
  it('esporta e reimporta con risposte', async () => {
    const d = await PDFDocument.create(); d.addPage(); d.addPage();
    const k = await createAnnot(d, 0, { type: 'Highlight', quadPoints: [10, 110, 90, 110, 10, 100, 90, 100], color: [1, 1, 0], opacity: 0.5, text: 'A & B <c>' }, { author: 'Anna' });
    await createAnnot(d, 1, { type: 'Ink', inkList: [[[1, 1], [5, 5], [9, 2]]], color: [0, 0, 1], width: 2 }, { author: 'Anna' });
    await createAnnot(d, 0, { type: 'Text', reply: true, irt: k, rect: [0, 0, 20, 20], text: 'ok' }, { author: 'Bruno' });
    const list = readAllAnnotations(d);
    const xml = toXfdf(list, { fileName: 'prova.pdf' });
    expect(xml).toContain('A &amp; B &lt;c&gt;');
    const back = fromXfdf(xml, { pageCount: 2 });
    expect(back).toHaveLength(3);
    expect(back[0].spec.text).toBe('A & B <c>');
    expect(back[0].spec.opacity).toBe(0.5);
    expect(back[1].spec.inkList[0]).toHaveLength(3);
    expect(back[2].irtName).toBe(back[0].name);
  });
  it('XFDF di Acrobat, rotto o con elementi strani', () => {
    const acro = `<?xml version="1.0" encoding="UTF-8" ?><xfdf xmlns="http://ns.adobe.com/xfdf/" xml:space="preserve"><annots>
<square color="#FF0000" creationdate="D:20230101" flags="print" date="D:20230101" name="abc" page="0" rect="10,10,50,50" subject="Rettangolo" title="X" width="2"/>
<freetext page="0" rect="0,0,100,20" justification="centered"><contents-richtext><body>x</body></contents-richtext><defaultappearance>0 0 1 rg /Helv 14 Tf</defaultappearance><contents>Ciao&#xD;riga</contents></freetext>
<sound page="0" rect="0,0,1,1"/><line page="9" rect="0,0,1,1" start="0,0" end="1,1"/><polygon page="0" rect="0,0,1,1"/>
<![CDATA[ignorato]]><!-- commento --></annots><f href="a.pdf"/></xfdf>`;
    const w = [];
    const r = fromXfdf(acro, { pageCount: 1, warnings: w });
    expect(r.map((x) => x.spec.type)).toEqual(['Square', 'FreeText']);
    expect(r[1].spec.fontSize).toBe(14);
    expect(r[1].spec.align).toBe(1);
    expect(r[1].spec.text).toBe('Ciao\rriga');
    expect(w).toHaveLength(3);
    expect(() => fromXfdf('<xfdf><annots><square>')).toThrow(/non è valido/);
    expect(() => fromXfdf('<html></html>')).toThrow(/XFDF/);
    expect(parseXml('<a x=\'1\' y="2>3"/>').children[0].attrs).toEqual({ x: '1', y: '2>3' });
  });
});

describe('modello e riepilogo', () => {
  const pj = (o) => ({ subtype: 'Text', rect: [0, 0, 20, 20], color: new Uint8ClampedArray([255, 212, 0]), contentsObj: { str: '' }, titleObj: { str: '' }, ...o });
  it('normalizza i dati pdf.js e costruisce le discussioni', () => {
    const raw = [
      pj({ id: '1R', contentsObj: { str: 'Manca il CIG' }, titleObj: { str: 'Anna' }, modificationDate: 'D:20261112100000' }),
      pj({ id: '2R', inReplyTo: '1R', contentsObj: { str: 'Aggiunto' }, titleObj: { str: 'Bruno' }, modificationDate: 'D:20261112110000' }),
      pj({ id: '3R', inReplyTo: '1R', state: 'Completed', stateModel: 'Review', titleObj: { str: 'Bruno' }, modificationDate: 'D:20261112120000' }),
      pj({ id: '4R', inReplyTo: '2R', contentsObj: { str: 'grazie' }, modificationDate: 'D:20261112130000' }),
      pj({ id: '5R', subtype: 'Highlight', rect: [10, 600, 100, 612], quadPoints: new Float32Array([10, 612, 100, 612, 10, 600, 100, 600]), titleObj: { str: 'Carla' } }),
      { subtype: 'Link', rect: [0, 0, 1, 1], id: '6R' },
      pj({ id: '7R', rect: null }),
      null,
    ];
    const list = raw.map((d) => fromPdfjs(d, 0)).filter(Boolean);
    expect(list).toHaveLength(5);
    const th = buildThreads(list);
    expect(th).toHaveLength(2);
    expect(th[0].type).toBe('Highlight'); // più in alto nella pagina
    const note = th[1];
    expect(note.status).toBe('Completed');
    expect(note.allReplies.map((r) => r.text)).toEqual(['Aggiunto', 'grazie']);
    expect(filterThreads(th, { q: 'grazie' })).toHaveLength(1);
    expect(filterThreads(th, { status: 'open' })).toHaveLength(1);
    expect(filterThreads(th, { authors: new Set(['Carla']) })).toHaveLength(1);
    expect(facets(th).authors.length).toBe(2);
    expect(summaryText(th, { docName: 'x.pdf' })).toContain('↳ Bruno');
    expect(summaryHtml(th, { docName: '<x>' })).toContain('&lt;x&gt;');
    expect(cleanStr('þÿ\u0000R\u0000e')).toBe('Re');
  });
  it('riepilogo Word e PDF', async () => {
    const th = buildThreads([fromPdfjs(pj({ id: '1R', contentsObj: { str: 'Nota con € e “virgolette” e 漢字' }, titleObj: { str: 'Anna' } }), 2)]);
    const docx = await summaryDocx(th, { docName: 'a.pdf' });
    expect(docx[0]).toBe(0x50); // zip
    const pdf = await summaryPdf(th, { docName: 'a.pdf' });
    const back = await PDFDocument.load(pdf);
    expect(back.getPageCount()).toBe(1);
  });
});
