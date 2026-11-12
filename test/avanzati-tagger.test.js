import { describe, it, expect } from 'vitest';
import * as PDFLib from '@cantoo/pdf-lib';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { tokenize, analyzeOps, creaTag, elencaFigure, statoAccessibilita, insertMarks, impostaBase } from '../src/renderer/features/avanzati/lib/tagger.js';
import { impostaVisibilitaPredefinita, elencaLivelli } from '../src/renderer/features/avanzati/lib/ocg.js';
import { findMatches, pageText } from '../src/renderer/features/avanzati/lib/textsearch.js';
import { snapshot, docsToRestore } from '../src/renderer/features/avanzati/lib/session.js';

// PNG 1x1
const PNG = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'));

async function campione() {
  const d = await PDFLib.PDFDocument.create();
  const f = await d.embedFont(PDFLib.StandardFonts.Helvetica);
  const fb = await d.embedFont(PDFLib.StandardFonts.HelveticaBold);
  const img = await d.embedPng(PNG);
  const p = d.addPage([595, 842]);
  p.drawText('Determina del direttore', { x: 50, y: 780, size: 22, font: fb });
  p.drawText('Prima riga del primo paragrafo, con testo normale.', { x: 50, y: 740, size: 11, font: f });
  p.drawText('Seconda riga dello stesso paragrafo.', { x: 50, y: 726, size: 11, font: f });
  p.drawText('Nuovo paragrafo dopo uno spazio ampio.', { x: 50, y: 680, size: 11, font: f });
  p.drawRectangle({ x: 50, y: 600, width: 200, height: 2, color: PDFLib.rgb(0, 0, 0) });
  p.drawImage(img, { x: 50, y: 400, width: 150, height: 150 });
  // come nell'app: il documento arriva da byte salvati (le immagini di pdf-lib si incorporano al salvataggio)
  return PDFLib.PDFDocument.load(await d.save());
}

describe('accessibilità: tag di base', () => {
  it('tokenizza stringhe annidate, esadecimali, array e immagini in linea', () => {
    const b = new TextEncoder().encode('BT /F1 12 Tf (a\\)b (c)) Tj [<4142> -20 (x)] TJ ET q BI /W 1 /H 1 ID \x00EI\x01 EI Q % commento\n');
    const ops = tokenize(b).map((o) => o.op);
    expect(ops).toEqual(['BT', 'Tf', 'Tj', 'TJ', 'ET', 'q', 'BI', 'INLINE_IMAGE', 'Q']);
  });

  it('riconosce righe, immagini e tracciati', async () => {
    const d = await campione();
    const bytes = await d.save({ useObjectStreams: false });
    const d2 = await PDFLib.PDFDocument.load(bytes);
    const figs = elencaFigure(d2, PDFLib);
    expect(figs).toHaveLength(1);
    expect(figs[0]).toMatchObject({ id: '0:1', page: 1, w: 150, h: 150 });
  });

  it('crea una struttura che pdf.js legge come titolo, paragrafi e figura', async () => {
    const d = await campione();
    const r = creaTag(d, PDFLib, { lang: 'it-IT', title: 'Determina n. 12', alt: { '0:1': 'Logo dell\'istituto' } });
    expect(r).toMatchObject({ pagine: 1, titoli: 1, paragrafi: 2, figure: 1 });
    const out = await d.save();
    const st = statoAccessibilita(await PDFLib.PDFDocument.load(out), PDFLib);
    expect(st).toMatchObject({ tagged: true, marked: true, lang: 'it-IT', title: 'Determina n. 12' });
    const pdf = await pdfjs.getDocument({ data: out, isEvalSupported: false }).promise;
    const page = await pdf.getPage(1);
    const tree = await page.getStructTree();
    const roles = [];
    const walk = (n) => { if (n.role) roles.push(n.role + (n.alt ? `[${n.alt}]` : '')); (n.children || []).forEach(walk); };
    walk(tree);
    expect(roles).toEqual(['Root', 'Document', 'H1', 'P', 'P', "Figure[Logo dell'istituto]"]);
    const tc = await page.getTextContent({ includeMarkedContent: true });
    expect(tc.items.filter((i) => i.type === 'beginMarkedContentProps').length).toBe(5);
    expect(tc.items.filter((i) => i.str).map((i) => i.str).join(' ')).toContain('Seconda riga');
    await pdf.loadingTask.destroy();
  });

  it('non sovrascrive una struttura esistente e imposta comunque titolo e lingua', async () => {
    const d = await campione();
    creaTag(d, PDFLib, {});
    expect(() => creaTag(d, PDFLib, {})).toThrow(/già una struttura/);
    impostaBase(d, PDFLib, { lang: 'en-GB', title: 'X' });
    expect(statoAccessibilita(d, PDFLib).lang).toBe('en-GB');
  });

  it('non spezza contenuti marcati esistenti', () => {
    const b = new TextEncoder().encode('/Artifact BMC BT (pie di pagina) Tj ET EMC BT /OC /L1 BDC 0 0 Td (livello) Tj EMC ET');
    const { segments } = analyzeOps(tokenize(b));
    expect(segments.map((s) => new TextDecoder().decode(b.subarray(s.start, s.end)))).toEqual(['0 0 Td (livello) Tj']);
    const out = new TextDecoder().decode(insertMarks(b, [{ start: segments[0].start, end: segments[0].end, open: 'X', close: 'Y' }]));
    expect(out).toContain('/OC /L1 BDC \nX\n0 0 Td (livello) Tj\nY\n EMC');
  });

  it('la fixture del progetto viene marcata senza errori e resta leggibile', async () => {
    const fs = await import('node:fs');
    const d = await PDFLib.PDFDocument.load(fs.readFileSync(new URL('./fixtures/prova.pdf', import.meta.url)));
    const r = creaTag(d, PDFLib, { lang: 'it-IT' });
    expect(r.pagine).toBe(d.getPageCount());
    const pdf = await pdfjs.getDocument({ data: await d.save(), isEvalSupported: false }).promise;
    expect((await (await pdf.getPage(1)).getTextContent()).items.length).toBeGreaterThan(0);
    await pdf.loadingTask.destroy();
  });
});

describe('livelli (OCG)', () => {
  it('scrive la visibilità predefinita', async () => {
    const d = await PDFLib.PDFDocument.create();
    d.addPage();
    const ctx = d.context;
    const a = ctx.register(ctx.obj({ Type: 'OCG', Name: PDFLib.PDFString.of('Quote') }));
    const b = ctx.register(ctx.obj({ Type: 'OCG', Name: PDFLib.PDFString.of('Arredi') }));
    d.catalog.set(PDFLib.PDFName.of('OCProperties'), ctx.obj({ OCGs: [a, b], D: { Order: [a, b] } }));
    const liv = elencaLivelli(d, PDFLib);
    expect(liv.map((l) => l.name)).toEqual(['Quote', 'Arredi']);
    const n = impostaVisibilitaPredefinita(d, PDFLib, { [liv[0].key]: true, [liv[1].key]: false });
    expect(n).toBe(2);
    const pdf = await pdfjs.getDocument({ data: await d.save(), isEvalSupported: false }).promise;
    const cfg = await pdf.getOptionalContentConfig();
    expect([...cfg].map(([, g]) => g.visible)).toEqual([true, false]);
    await pdf.loadingTask.destroy();
  });
});

describe('ricerca e sessione', () => {
  it('trova ignorando maiuscole e accenti, con contesto', () => {
    const t = pageText([{ str: 'La fattura n. 123 è stata ', hasEOL: false }, { str: 'PAGATA', hasEOL: true }, { str: 'Perché sì', hasEOL: false }]);
    expect(findMatches(t, 'pagata')[0].match).toBe('PAGATA');
    expect(findMatches(t, 'perche')[0].match).toBe('Perché');
    expect(findMatches(t, 'fattura n. 123')[0].before).toBe('La ');
    expect(findMatches('cartella carta', 'carta', { wholeWord: true })).toHaveLength(1);
    expect(findMatches('abc', '')).toEqual([]);
  });
  it('istantanea della sessione', () => {
    const a = { path: '/a.pdf', viewState: { page: 4 } }; const b = { path: null }; const c = { path: '/c.pdf' };
    expect(snapshot([a, b, c], c, 7)).toMatchObject({ docs: [{ path: '/a.pdf', page: 4 }, { path: '/c.pdf', page: 7 }], active: '/c.pdf' });
    expect(docsToRestore({ docs: [{ path: '/a.pdf', page: -1 }, { path: '/a.pdf' }, { path: 3 }] })).toEqual([{ path: '/a.pdf', page: 1 }]);
    expect(docsToRestore('spazzatura')).toEqual([]);
  });
});
