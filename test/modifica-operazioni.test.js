// Prove di integrazione: PDF generati con pdf-lib, modificati, riaperti con pdf.js.
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import * as PDFLib from '@cantoo/pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { groupTextItems, findLinksInText, wrapText, diffRange } from '../src/renderer/features/modifica/blocks.js';
import { analyze, editBlock, addText, findInPage, replaceMatches, listImages, transformImage, deleteImage, replaceImage, addImage, addShape, glyphsInBlock, glyphText } from '../src/renderer/features/modifica/operations.js';
import { compareOutside, containsText } from '../src/renderer/features/modifica/verify.js';
import { pageContentBytes } from '../src/renderer/features/modifica/pdfpage.js';
import { parseContentStream, latin1 } from '../src/renderer/features/modifica/contentstream.js';
import { addLink, listLinks, deleteLink, updateLink } from '../src/renderer/features/modifica/links.js';
import { mul } from '../src/renderer/features/modifica/interpreter.js';

const require = createRequire(import.meta.url);
pdfjs.GlobalWorkerOptions.workerSrc = (await import('node:url')).pathToFileURL(require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs')).href;
const { PDFDocument, StandardFonts, rgb, PDFName, PDFArray } = PDFLib;
const LIB = (n) => readFileSync(require.resolve('pdfjs-dist/standard_fonts/' + n));
const env = { loadUnicodeFont: async ({ bold, italic }) => LIB(`LiberationSans-${bold && italic ? 'BoldItalic' : bold ? 'Bold' : italic ? 'Italic' : 'Regular'}.ttf`) };

async function textItems(bytes, pageIndex = 0) {
  const task = pdfjs.getDocument({ data: bytes.slice(), disableFontFace: true, useSystemFonts: false, isEvalSupported: false, verbosity: 0 });
  const pdf = await task.promise;
  const page = await pdf.getPage(pageIndex + 1);
  const tc = await page.getTextContent();
  await task.destroy();
  return tc;
}
const pageText = (tc) => tc.items.map((i) => i.str).join(' ').replace(/\s+/g, ' ');
async function open(bytes) { const d = await PDFDocument.load(bytes); d.registerFontkit(fontkit); return d; }
async function edit(bytes, fn) { const d = await open(bytes); const r = await fn(d); return { bytes: await d.save({ useObjectStreams: true }), r }; }

const LOREM = 'Il presente documento è stato redatto dall\'ufficio amministrazione per la pratica di missione del dipendente indicato';

let simple, type0, complex;
beforeAll(async () => {
  // 1) Helvetica standard (come i PDF generati da molti programmi)
  {
    const d = await PDFDocument.create();
    const f = await d.embedFont(StandardFonts.Helvetica);
    const b = await d.embedFont(StandardFonts.TimesRomanBold);
    const p = d.addPage([595, 842]);
    p.drawText('Oggetto: richiesta di rimborso', { x: 50, y: 780, size: 16, font: b });
    p.drawText('Firenze, 10/05/2026', { x: 400, y: 800, size: 11, font: f });
    const lines = ['Il presente documento è stato redatto', 'dall\'ufficio amministrazione per la', 'pratica di missione del dipendente.'];
    lines.forEach((t, i) => p.drawText(t, { x: 50, y: 700 - i * 14, size: 11, font: f, color: rgb(0.1, 0.2, 0.6) }));
    p.drawText('Contatti: www.iccom.cnr.it oppure segreteria@iccom.cnr.it', { x: 50, y: 600, size: 10, font: f });
    p.drawText('Testo che non deve cambiare.', { x: 50, y: 500, size: 12, font: f });
    simple = await d.save();
  }
  // 2) font TrueType incorporato (Type0 Identity-H con ToUnicode), come Word
  {
    const d = await PDFDocument.create(); d.registerFontkit(fontkit);
    const f = await d.embedFont(LIB('LiberationSans-Regular.ttf'), { subset: false });
    const p = d.addPage([595, 842]);
    p.drawText('Il RUP è il dott. Mario Rossi, nominato con determina 12/2026.', { x: 50, y: 700, size: 12, font: f });
    p.drawText('Altro paragrafo che resta uguale: àèìòù € ç.', { x: 50, y: 650, size: 12, font: f });
    type0 = await restrictToUnicode(await d.save());
  }
  // 3) content stream "difficile": array di stream, immagine in linea, Form XObject con testo, q/Q sbilanciati, Type3 assente
  {
    const d = await PDFDocument.create();
    const f = await d.embedFont(StandardFonts.Helvetica);
    const p = d.addPage([400, 400]);
    p.drawText('Prima riga fuori dal form', { x: 20, y: 360, size: 12, font: f });
    const fontName = p.node.Resources().lookup(PDFName.of('Font')).keys()[0].decodeText();
    const ctx = d.context;
    const formStream = ctx.stream(`BT /${fontName} 12 Tf 20 300 Td (Testo dentro un form XObject) Tj ET`, { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 400, 400], Resources: { Font: { [fontName]: p.node.Resources().lookup(PDFName.of('Font')).get(PDFName.of(fontName)) } } });
    const formRef = ctx.register(formStream);
    p.node.Resources().set(PDFName.of('XObject'), ctx.obj({ Fm1: formRef }));
    const inline = 'q 20 0 0 20 300 300 cm BI /W 2 /H 2 /BPC 8 /CS /G ID \x00\xffEI\x00 EI Q\n';
    const s2src = `q /Fm1 Do Q ${inline} BT /${fontName} 10 Tf 20 200 Td [(Kerning) -300 (TJ) 120 (array)] TJ ET q 1 0 0 1 5 5 cm`;
    const s2 = ctx.register(ctx.stream(Uint8Array.from([...s2src].map((c) => c.charCodeAt(0))), {}));
    const s3 = ctx.register(ctx.flateStream(`BT /${fontName} 10 Tf 20 150 Td (Stream compresso \\(con parentesi\\)) Tj ET`));
    const cur = p.node.get(PDFName.of('Contents'));
    const arr = ctx.obj([]); const look = ctx.lookup(cur);
    if (look instanceof PDFArray) for (let i = 0; i < look.size(); i++) arr.push(look.get(i)); else arr.push(cur);
    arr.push(s2); arr.push(s3);
    p.node.set(PDFName.of('Contents'), arr);
    complex = await d.save({ useObjectStreams: false });
  }
  // per il collaudo a mano: LEGGIO_FIXTURES_OUT=cartella npx vitest run test/modifica
  if (process.env.LEGGIO_FIXTURES_OUT) {
    const { writeFileSync } = await import('node:fs');
    for (const [n, b] of Object.entries({ 'modifica-semplice.pdf': simple, 'modifica-word.pdf': type0, 'modifica-complesso.pdf': complex })) writeFileSync(process.env.LEGGIO_FIXTURES_OUT + '/' + n, b);
  }
});

function blockWith(tc, needle) {
  const blocks = groupTextItems(tc.items, tc.styles);
  const b = blocks.find((x) => x.text.includes(needle));
  if (!b) throw new Error('blocco non trovato: ' + needle + ' in ' + blocks.map((x) => x.text).join(' | '));
  return b;
}

describe('blocchi di testo', () => {
  it('raggruppa righe in paragrafi', async () => {
    const tc = await textItems(simple);
    const b = blockWith(tc, 'presente documento');
    expect(b.lines.length).toBe(3);
    expect(b.text).toContain('redatto dall\'ufficio');
    expect(Math.round(b.fontSize)).toBe(11);
    const data = blockWith(tc, 'Firenze');
    expect(data.lines.length).toBe(1);
  });
  it('a capo e differenze', () => {
    const w = (s) => s.length;
    expect(wrapText('uno due tre quattro', 8, w)).toEqual(['uno due', 'tre', 'quattro']);
    expect(wrapText('supercalifragilistico', 5, w)).toEqual(['super', 'calif', 'ragil', 'istic', 'o']);
    expect(diffRange('10/05/2026', '12/05/2026')).toEqual({ start: 1, oldEnd: 2, newEnd: 2 });
  });
  it('trova URL ed email', () => {
    const r = findLinksInText('Vedi https://www.cnr.it/it/pagina, oppure www.iccom.cnr.it. Scrivi a mario.rossi@cnr.it!');
    expect(r.map((x) => x.value)).toEqual(['https://www.cnr.it/it/pagina', 'https://www.iccom.cnr.it', 'mario.rossi@cnr.it']);
  });
});

describe('modifica testo esistente', () => {
  it('correzione di un refuso in loco (stesso font, resto intatto)', async () => {
    const tc = await textItems(simple);
    const b = blockWith(tc, 'Firenze');
    const d0 = await open(simple);
    const gt = glyphText(glyphsInBlock(analyze(d0, 0), b));
    expect(gt.text).toBe('Firenze, 10/05/2026');
    const { bytes, r } = await edit(simple, (d) => editBlock(d, 0, b, 'Firenze, 12/05/2026', {}, env));
    expect(r.method).toBe('inplace');
    const tc2 = await textItems(bytes);
    expect(pageText(tc2)).toContain('Firenze, 12/05/2026');
    expect(pageText(tc2)).not.toContain('10/05');
    expect(compareOutside(tc.items, tc2.items, [b.rect]).ok).toBe(true);
  });
  it('riscrittura di un paragrafo: testo originale tolto davvero dal content stream', async () => {
    const tc = await textItems(simple);
    const b = blockWith(tc, 'presente documento');
    const nuovo = 'Questo paragrafo è stato riscritto con Leggio e va a capo da solo nella larghezza del blocco originale.';
    const { bytes, r } = await edit(simple, (d) => editBlock(d, 0, b, nuovo, {}, env));
    expect(r.method).toBe('rewrite');
    const tc2 = await textItems(bytes);
    const t = pageText(tc2);
    expect(t).not.toContain('redatto');
    expect(t.replace(/\s/g, '')).toContain(nuovo.replace(/\s/g, ''));
    expect(compareOutside(tc.items, tc2.items, [b.rect, [b.rect[0], b.rect[1] - 40, b.rect[2] + 10, b.rect[3]]]).ok).toBe(true);
    // il colore originale è conservato
    const d2 = await open(bytes);
    const content = latin1(pageContentBytes(d2.getPage(0)));
    expect(content).toMatch(/0\.1 0\.2 0\.6 rg/);
  });
  it('font Type0 incorporato: correzione in loco col font originale', async () => {
    const tc = await textItems(type0);
    const b = blockWith(tc, 'Mario Rossi');
    const { bytes, r } = await edit(type0, (d) => editBlock(d, 0, b, b.text.replace('Mario Rossi', 'Maria Rossi'), {}, env));
    expect(r.method).toBe('inplace');
    const tc2 = await textItems(bytes);
    expect(pageText(tc2)).toContain('Maria Rossi');
    expect(compareOutside(tc.items, tc2.items, [b.rect]).ok).toBe(true);
  });
  it('font Type0 sottoinsieme: carattere assente → font Unicode incorporato', async () => {
    const tc = await textItems(type0);
    const b = blockWith(tc, 'Mario Rossi');
    const { bytes, r } = await edit(type0, (d) => editBlock(d, 0, b, 'Il RUP è la dott.ssa Zoë Kwiatkowska (Łódź).', {}, env));
    expect(r.method).toBe('rewrite');
    expect(r.fontKind).toBe('unicode');
    const tc2 = await textItems(bytes);
    expect(pageText(tc2)).toContain('Łódź');
    expect(pageText(tc2)).not.toContain('Mario');
    expect(compareOutside(tc.items, tc2.items, [b.rect]).ok).toBe(true);
  });
  it('ripiego copertura: testo dentro un Form XObject', async () => {
    const tc = await textItems(complex);
    const b = blockWith(tc, 'dentro un form');
    const { bytes, r } = await edit(complex, (d) => editBlock(d, 0, b, 'Sostituito', {}, env));
    expect(r.method).toBe('cover');
    const tc2 = await textItems(bytes);
    expect(pageText(tc2)).toContain('Sostituito');
    expect(compareOutside(tc.items, tc2.items, [b.rect]).ok).toBe(true);
  });
  it('content stream difficile: array di stream, immagine in linea, q/Q aperti, TJ', async () => {
    const tc = await textItems(complex);
    const b = blockWith(tc, 'Kerning');
    const { bytes } = await edit(complex, (d) => editBlock(d, 0, b, 'Riga nuova', {}, env));
    const tc2 = await textItems(bytes);
    expect(pageText(tc2)).toContain('Riga nuova');
    expect(pageText(tc2)).toContain('Stream compresso (con parentesi)');
    expect(compareOutside(tc.items, tc2.items, [b.rect]).ok).toBe(true);
    // l'immagine in linea è ancora lì, intatta
    const d2 = await open(bytes);
    const c = latin1(pageContentBytes(d2.getPage(0)));
    expect(c).toContain('BI /W 2 /H 2 /BPC 8 /CS /G ID \x00\xffEI\x00 EI');
  });
  it('cancellare un blocco (testo vuoto)', async () => {
    const tc = await textItems(simple);
    const b = blockWith(tc, 'Oggetto');
    const { bytes } = await edit(simple, (d) => editBlock(d, 0, b, '', {}, env));
    const tc2 = await textItems(bytes);
    expect(pageText(tc2)).not.toContain('Oggetto');
    expect(compareOutside(tc.items, tc2.items, [b.rect]).ok).toBe(true);
  });
  it('stile scelto: Times grassetto rosso centrato', async () => {
    const tc = await textItems(simple);
    const b = blockWith(tc, 'Oggetto');
    const { bytes, r } = await edit(simple, (d) => editBlock(d, 0, b, 'Oggetto: nuovo', { font: 'Times', bold: true, color: [1, 0, 0], align: 'center' }, env));
    expect(r.fontKind).toBe('standard');
    const tc2 = await textItems(bytes);
    expect(pageText(tc2)).toContain('Oggetto: nuovo');
  });
});

describe('aggiungi testo, forme, immagini', () => {
  it('aggiunge testo come contenuto (non annotazione)', async () => {
    const { bytes } = await edit(simple, (d) => addText(d, 0, { x: 300, y: 300, width: 200 }, 'Prot. n. 1234 del 12/11/2026', { size: 12, bold: true }, env));
    const tc2 = await textItems(bytes);
    expect(pageText(tc2)).toContain('Prot. n. 1234 del 12/11/2026');
    const d2 = await open(bytes);
    const an = d2.getPage(0).node.lookup(PDFName.of('Annots')); expect(an ? an.size() : 0).toBe(0);
  });
  it('testo con caratteri non WinAnsi', async () => {
    const { bytes, r } = await edit(simple, (d) => addText(d, 0, { x: 50, y: 300 }, 'Zażółć gęślą jaźń — Ωmega', { size: 12 }, env));
    expect(r.fontKind).toBe('unicode');
    expect(pageText(await textItems(bytes))).toContain('Zażółć gęślą jaźń');
  });
  it('forme e immagini: aggiungi, sposta, ruota, ritaglia, sostituisci, elimina', async () => {
    const png = await makePng();
    let { bytes } = await edit(simple, async (d) => { addShape(d, 0, { kind: 'rect', x1: 10, y1: 10, x2: 100, y2: 50, stroke: [0, 0, 0], fill: [1, 1, 0], width: 2 }); addShape(d, 0, { kind: 'ellipse', x1: 10, y1: 60, x2: 100, y2: 100, stroke: [1, 0, 0] }); await addImage(d, 0, png, [200, 200, 100, 50]); });
    let d = await open(bytes);
    let imgs = listImages(analyze(d, 0));
    expect(imgs).toHaveLength(1);
    expect(imgs[0].rect.map(Math.round)).toEqual([200, 200, 300, 250]);
    ({ bytes } = await edit(bytes, (dd) => transformImage(dd, 0, imgs[0].opIndex, mul(imgs[0].ctm, [1, 0, 0, 1, 50, -20]))));
    d = await open(bytes); imgs = listImages(analyze(d, 0));
    expect(imgs[0].rect.map(Math.round)).toEqual([250, 180, 350, 230]);
    ({ bytes } = await edit(bytes, (dd) => transformImage(dd, 0, imgs[0].opIndex, imgs[0].ctm, { clipQuad: [[250, 180], [300, 180], [300, 230], [250, 230]] })));
    d = await open(bytes); imgs = listImages(analyze(d, 0));
    expect(imgs).toHaveLength(1);
    ({ bytes } = await edit(bytes, (dd) => replaceImage(dd, 0, imgs[0].opIndex, png)));
    d = await open(bytes); imgs = listImages(analyze(d, 0));
    expect(imgs).toHaveLength(1);
    ({ bytes } = await edit(bytes, (dd) => deleteImage(dd, 0, imgs[0].opIndex)));
    d = await open(bytes);
    expect(listImages(analyze(d, 0))).toHaveLength(0);
    // il testo della pagina è ancora tutto lì
    expect(pageText(await textItems(bytes))).toContain('Testo che non deve cambiare.');
  });
});

describe('trova e sostituisci', () => {
  it('sostituisce in loco tutte le occorrenze', async () => {
    const d0 = await open(simple);
    const A = analyze(d0, 0);
    const m = findInPage(A, 'iccom');
    expect(m.length).toBe(2);
    const { bytes, r } = await edit(simple, (d) => replaceMatches(d, 0, m, 'ismn', env));
    expect(r.results.every((x) => x.method === 'inplace')).toBe(true);
    const t = pageText(await textItems(bytes));
    expect(t).toContain('www.ismn.cnr.it oppure segreteria@ismn.cnr.it');
  });
  it('parola intera e maiuscole', async () => {
    const d0 = await open(simple);
    const A = analyze(d0, 0);
    expect(findInPage(A, 'PRATICA').length).toBe(1);
    expect(findInPage(A, 'PRATICA', { caseSensitive: true }).length).toBe(0);
    expect(findInPage(A, 'pra', { wholeWord: true }).length).toBe(0);
  });
  it('carattere mancante nel font sottoinsieme → ripiego sovrapposto', async () => {
    const d0 = await open(type0);
    const m = findInPage(analyze(d0, 0), 'Mario');
    const { bytes, r } = await edit(type0, (d) => replaceMatches(d, 0, m, 'Żaneta', env));
    expect(r.results[0].method).toBe('overlay');
    const t = pageText(await textItems(bytes));
    expect(t).toContain('Żaneta');
    expect(t).not.toContain('Mario');
  });
  it('testo dentro un form XObject → copertura', async () => {
    const d0 = await open(complex);
    const m = findInPage(analyze(d0, 0), 'form XObject');
    expect(m.length).toBe(1);
    const { bytes, r } = await edit(complex, (d) => replaceMatches(d, 0, m, 'modulo', env));
    expect(r.results[0].method).toBe('cover');
    expect(pageText(await textItems(bytes))).toContain('modulo');
  });
});

describe('link', () => {
  it('crea, legge, modifica ed elimina', async () => {
    let { bytes } = await edit(simple, async (d) => {
      addLink(d, 0, [50, 50, 150, 70], { type: 'url', url: 'https://www.cnr.it' });
      addLink(d, 0, [50, 80, 150, 100], { type: 'email', email: 'a@b.it' });
      addLink(d, 0, [50, 110, 150, 130], { type: 'page', page: 0 });
    });
    let d = await open(bytes);
    let links = listLinks(d, 0);
    expect(links.map((l) => l.target.type)).toEqual(['url', 'email', 'page']);
    expect(links[1].target.email).toBe('a@b.it');
    ({ bytes } = await edit(bytes, (dd) => { updateLink(dd, 0, links[0].index, { type: 'url', url: 'https://www.iccom.cnr.it' }, [60, 60, 160, 80]); }));
    d = await open(bytes); links = listLinks(d, 0);
    expect(links[0].target.url).toBe('https://www.iccom.cnr.it');
    ({ bytes } = await edit(bytes, (dd) => deleteLink(dd, 0, links[1].index)));
    d = await open(bytes); links = listLinks(d, 0);
    expect(links).toHaveLength(2);
    // pdf.js li vede
    const task = pdfjs.getDocument({ data: bytes.slice(), verbosity: 0 });
    const pdf = await task.promise;
    const ann = await (await pdf.getPage(1)).getAnnotations();
    expect(ann.filter((a) => a.subtype === 'Link').map((a) => a.url || a.dest)).toContainEqual('https://www.iccom.cnr.it/');
    await task.destroy();
  });
});

describe('robustezza', () => {
  it('pagina con migliaia di operatori: analisi e modifica rapide', async () => {
    const d = await PDFDocument.create();
    const f = await d.embedFont(StandardFonts.Helvetica);
    const p = d.addPage([595, 842]);
    const fname = p.node.newFontDictionary('F', f.ref).decodeText();
    let s = '';
    for (let i = 0; i < 4000; i++) s += `BT /${fname} 4 Tf ${20 + (i % 20) * 28} ${20 + Math.floor(i / 20) * 4} Td (w${i}) Tj ET\n`;
    p.node.set(PDFName.of('Contents'), d.context.register(d.context.flateStream(s)));
    const bytes = await d.save();
    const t0 = Date.now();
    const d2 = await open(bytes);
    const A = analyze(d2, 0);
    expect(A.r.shows.length).toBe(4000);
    const m = findInPage(A, 'w3999');
    expect(m.length).toBe(1);
    await replaceMatches(d2, 0, m, 'ok', env);
    expect(Date.now() - t0).toBeLessThan(5000);
  });
  it('content stream corrotto: nessuna eccezione, contenuto preservato', async () => {
    const d = await PDFDocument.create();
    const f = await d.embedFont(StandardFonts.Helvetica);
    const p = d.addPage([300, 300]);
    const fname = p.node.newFontDictionary('F', f.ref).decodeText();
    p.node.set(PDFName.of('Contents'), d.context.register(d.context.stream(`BT /${fname} 12 Tf 20 200 Td (Buono) Tj ET ] } ) >> BT /${fname} 12 Tf 20 100 Td (Ancora \\(buono) Tj ET [ (non chiuso`)));
    const bytes = await d.save();
    const tc = await textItems(bytes);
    const b = blockWith(tc, 'Buono');
    const { bytes: out } = await edit(bytes, (dd) => editBlock(dd, 0, b, 'Cambiato', {}, env));
    const t = pageText(await textItems(out));
    expect(t).toContain('Cambiato');
    // pdf.js può fermarsi davanti ai byte spazzatura: ciò che vedeva prima deve vederlo anche dopo
    expect(t.includes('Ancora (buono')).toBe(pageText(tc).includes('Ancora (buono'));
    // e i byte dopo l'operatore modificato sono identici
    const after = latin1(pageContentBytes((await open(out)).getPage(0)));
    expect(after).toContain('ET ] } ) >> BT');
    expect(after.endsWith('[ (non chiuso')).toBe(true);
  });
});

// pdf-lib non sa fare sottoinsiemi di questi TTF: simuliamo un font sottoinsieme (come Word) riducendo la
// ToUnicode ai soli glifi usati nella pagina.
async function restrictToUnicode(bytes) {
  const d = await open(bytes);
  const A = analyze(d, 0);
  const ctx = d.context;
  for (const s of A.r.shows) {
    const f = s.font;
    const tuRef = f.dict.get(PDFName.of('ToUnicode'));
    const used = new Map();
    for (const sh of A.r.shows) if (sh.font === f) for (const g of sh.glyphs) used.set(g.code, g.u);
    let body = '';
    for (const [c, u] of used) body += `<${c.toString(16).padStart(4, '0')}> <${[...u].map((ch) => ch.charCodeAt(0).toString(16).padStart(4, '0')).join('')}>\n`;
    const cmap = `/CIDInit /ProcSet findresource begin 12 dict begin begincmap 1 begincodespacerange <0000> <FFFF> endcodespacerange ${used.size} beginbfchar\n${body}endbfchar endcmap end end`;
    ctx.assign(tuRef, ctx.flateStream(cmap));
  }
  return d.save();
}

async function makePng() {
  // PNG 2x2 generato con pdf-lib? Più semplice: PNG minimo valido scritto a mano (rosso 1x1)
  return Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64'));
}
