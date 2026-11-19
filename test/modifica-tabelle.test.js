// Tabelle nello strumento «Modifica testo e immagini»: ogni cella è un blocco a sé (filetti disegnati o colonne
// allineate), e modificare una cella non sposta le altre. PDF generati con pdf-lib simili a documenti reali:
// fattura con griglia, modulo PA etichetta/valore, tabella senza linee, tabella con soli filetti orizzontali.
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import * as PDFLib from '@cantoo/pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { groupTextItems } from '../src/renderer/features/modifica/blocks.js';
import { analyze, editBlock, editorText } from '../src/renderer/features/modifica/operations.js';
import { compareOutside } from '../src/renderer/features/modifica/verify.js';

const require = createRequire(import.meta.url);
pdfjs.GlobalWorkerOptions.workerSrc = (await import('node:url')).pathToFileURL(require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs')).href;
const { PDFDocument, StandardFonts, PDFName, PDFArray, rgb } = PDFLib;
const LIB = (n) => readFileSync(require.resolve('pdfjs-dist/standard_fonts/' + n));
const env = { loadUnicodeFont: async ({ bold, italic }) => LIB(`LiberationSans-${bold && italic ? 'BoldItalic' : bold ? 'Bold' : italic ? 'Italic' : 'Regular'}.ttf`) };

async function textItems(bytes, pageIndex = 0) {
  const task = pdfjs.getDocument({ data: bytes.slice(), disableFontFace: true, useSystemFonts: false, isEvalSupported: false, verbosity: 0 });
  const pdf = await task.promise;
  const tc = await (await pdf.getPage(pageIndex + 1)).getTextContent();
  await task.destroy();
  return tc;
}
async function open(bytes) { const d = await PDFDocument.load(bytes); d.registerFontkit(fontkit); return d; }
/** Blocchi come li vede lo strumento: testo di pdf.js + filetti dall'interprete. */
async function blocksOf(bytes, pageIndex = 0) {
  const tc = await textItems(bytes, pageIndex);
  const A = analyze(await open(bytes), pageIndex);
  return { tc, A, blocks: groupTextItems(tc.items, tc.styles, { rules: A.r.rules }) };
}
const find = (blocks, text) => {
  const b = blocks.find((x) => x.text === text);
  if (!b) throw new Error('blocco non trovato: «' + text + '» in ' + blocks.map((x) => JSON.stringify(x.text)).join(' | '));
  return b;
};
async function editCell(bytes, text, newText, pageIndex = 0) {
  const { blocks, A, tc } = await blocksOf(bytes, pageIndex);
  const b = find(blocks, text);
  const initial = editorText(A, b).text;
  const d = await open(bytes);
  const r = await editBlock(d, pageIndex, b, newText, {}, env, { oldText: initial });
  const out = await d.save({ useObjectStreams: true });
  return { b, r, out, before: tc, blocksBefore: blocks };
}
/** Tutti gli altri blocchi restano identici (testo e posizione entro 0,5 pt). */
async function othersUnchanged(blocksBefore, out, edited, newTexts) {
  const after = (await blocksOf(out)).blocks;
  for (const b of blocksBefore) {
    if (b === edited) continue;
    const m = after.find((x) => x.text === b.text && Math.abs(x.box[0] - b.box[0]) < 0.5 && Math.abs(x.lines[0].base - b.lines[0].base) < 0.5);
    expect(m, 'blocco spostato o cambiato: «' + b.text + '»').toBeTruthy();
    expect(Math.abs(m.box[2] - b.box[2])).toBeLessThan(0.5);
  }
  for (const t of newTexts) expect(after.some((x) => x.text.replace(/\s+/g, ' ').includes(t)), 'manca «' + t + '»').toBe(true);
  return after;
}

// ------------------------------------------------------------------ costruzione delle tabelle

/**
 * Disegna una tabella. cols: [{ w, align }]; rows: [[testo]] (\n = più righe nella cella);
 * grid: 'full' (linee m/l S), 'cells' (rettangoli re S per cella), 'fill' (filetti come rettangoli pieni sottili),
 *       'h' (solo filetti orizzontali), 'none'.
 */
function drawTable(p, font, { x, top, cols, rows, fs = 9, pad = 3, grid = 'full', bold = null, lineH = null }) {
  lineH = lineH || fs * 1.2;
  const xs = [x]; for (const c of cols) xs.push(xs[xs.length - 1] + c.w);
  const ys = [top];
  rows.forEach((r, ri) => {
    const nl = Math.max(...r.map((t) => String(t).split('\n').length));
    const h = 2 * pad + fs * 1.15 + (nl - 1) * lineH;
    const y = ys[ys.length - 1];
    r.forEach((t, ci) => String(t).split('\n').forEach((ln, k) => {
      if (!ln) return;
      const f = ri === 0 && bold ? bold : font;
      const w = f.widthOfTextAtSize(ln, fs), c = cols[ci];
      const xx = c.align === 'right' ? xs[ci + 1] - pad - w : c.align === 'center' ? (xs[ci] + xs[ci + 1]) / 2 - w / 2 : xs[ci] + pad;
      p.drawText(ln, { x: xx, y: y - pad - fs * 0.85 - k * lineH, size: fs, font: f });
    }));
    ys.push(y - h);
  });
  const bottom = ys[ys.length - 1], right = xs[xs.length - 1];
  const line = (a, b) => p.drawLine({ start: { x: a[0], y: a[1] }, end: { x: b[0], y: b[1] }, thickness: 0.5, color: rgb(0, 0, 0) });
  if (grid === 'full') { for (const y of ys) line([x, y], [right, y]); for (const xx of xs) line([xx, top], [xx, bottom]); }
  if (grid === 'h') for (const y of ys) line([x, y], [right, y]);
  if (grid === 'fill') { for (const y of ys) p.drawRectangle({ x, y: y - 0.25, width: right - x, height: 0.5, color: rgb(0, 0, 0) }); for (const xx of xs) p.drawRectangle({ x: xx - 0.25, y: bottom, width: 0.5, height: top - bottom, color: rgb(0, 0, 0) }); }
  if (grid === 'cells') for (let i = 0; i + 1 < ys.length; i++) for (let j = 0; j + 1 < xs.length; j++) p.drawRectangle({ x: xs[j], y: ys[i + 1], width: xs[j + 1] - xs[j], height: ys[i] - ys[i + 1], borderWidth: 0.6, borderColor: rgb(0.3, 0.3, 0.3) });
  return { xs, ys };
}

function lines(p, font, text, { x, y, size = 10, width, lh = 1.25 }) {
  const out = []; let cur = '';
  for (const w of text.split(' ')) { const c = cur ? cur + ' ' + w : w; if (font.widthOfTextAtSize(c, size) > width && cur) { out.push(cur); cur = w; } else cur = c; }
  if (cur) out.push(cur);
  out.forEach((t, i) => p.drawText(t, { x, y: y - i * size * lh, size, font }));
  return out;
}
/** Paragrafo giustificato disegnato parola per parola (spazi larghi anche 0,8 em, come certi programmi). */
function justified(p, font, text, { x, y, size = 10, width, lh = 1.25 }) {
  const rows = []; let cur = [];
  for (const w of text.split(' ')) { const c = [...cur, w]; if (font.widthOfTextAtSize(c.join(' '), size) > width && cur.length) { rows.push(cur); cur = [w]; } else cur = c; }
  rows.push(cur);
  rows.forEach((ws, i) => {
    const last = i === rows.length - 1;
    const tot = ws.reduce((t, w) => t + font.widthOfTextAtSize(w, size), 0);
    const gap = last ? font.widthOfTextAtSize(' ', size) : (width - tot) / Math.max(1, ws.length - 1);
    let xx = x;
    for (const w of ws) { p.drawText(w, { x: xx, y: y - i * size * lh, size, font }); xx += font.widthOfTextAtSize(w, size) + gap; }
  });
  return rows.length;
}

const PROSA = 'Il presente documento è stato redatto dall\'ufficio amministrazione per la liquidazione delle spese sostenute durante la missione, secondo quanto previsto dal regolamento interno e dalle disposizioni vigenti in materia di trattamento economico.';

let fattura, modulo, senzaLinee, orizzontali, testo, rigaTJ;
beforeAll(async () => {
  // 1) fattura: griglia con margini stretti (pdf.js unisce le celle di una riga in un solo item), cella su due righe
  {
    const d = await PDFDocument.create();
    const f = await d.embedFont(StandardFonts.Helvetica), b = await d.embedFont(StandardFonts.HelveticaBold);
    const p = d.addPage([595, 842]);
    p.drawText('FATTURA N. 125/2026 del 10/11/2026', { x: 50, y: 790, size: 14, font: b });
    p.drawText('Spett.le Comune di Firenze - Ufficio Economato', { x: 50, y: 770, size: 10, font: f });
    lines(p, f, PROSA, { x: 50, y: 740, size: 10, width: 495 });
    drawTable(p, f, {
      x: 50, top: 680, pad: 2, bold: b,
      cols: [{ w: 215, align: 'left' }, { w: 44, align: 'right' }, { w: 68, align: 'right' }, { w: 40, align: 'center' }, { w: 80, align: 'right' }],
      rows: [
        ['Descrizione', 'Quantità', 'Prezzo unitario', 'IVA', 'Importo'],
        ['Consulenza tecnica', '2', '150,00', '22%', '300,00'],
        ['Servizio di manutenzione ordinaria\ndegli impianti termici', '1', '1.250,00', '22%', '1.250,00'],
        ['Licenza software annuale', '3', '80,00', '22%', '240,00'],
        ['Trasferta', '1', '45,50', '10%', '45,50'],
      ],
    });
    // totali allineati a destra (senza bordi)
    [['Imponibile', '1.835,50'], ['IVA', '399,26'], ['Totale documento', '2.234,76']].forEach(([l, v], i) => {
      p.drawText(l, { x: 360, y: 560 - i * 14, size: 10, font: b });
      p.drawText(v, { x: 545 - f.widthOfTextAtSize(v, 10), y: 560 - i * 14, size: 10, font: f });
    });
    fattura = await d.save();
  }
  // 2) modulo PA: griglia etichetta/valore fatta di rettangoli (re S), etichette in grassetto
  {
    const d = await PDFDocument.create();
    const f = await d.embedFont(StandardFonts.Helvetica), b = await d.embedFont(StandardFonts.HelveticaBold);
    const p = d.addPage([595, 842]);
    p.drawText('DOMANDA DI RIMBORSO SPESE DI MISSIONE', { x: 50, y: 790, size: 13, font: b });
    const rows = [['Cognome', 'Rossi'], ['Nome', 'Mario'], ['Codice fiscale', 'RSSMRA80A01D612X'], ['Qualifica', 'Ricercatore III livello'], ['Indirizzo', 'Via dei Servi 12\n50122 Firenze (FI)'], ['Data', '10/11/2026']];
    // etichette in grassetto: si disegnano a mano per avere due font sulla stessa riga
    const { xs, ys } = drawTable(p, f, { x: 50, top: 760, pad: 4, fs: 10, grid: 'cells', cols: [{ w: 130, align: 'left' }, { w: 330, align: 'left' }], rows: rows.map(([, v]) => ['', v]) });
    rows.forEach(([l], i) => p.drawText(l, { x: xs[0] + 4, y: ys[i] - 4 - 10 * 0.85, size: 10, font: b }));
    modulo = await d.save();
  }
  // 3) tabella senza linee: colonne di numeri allineati a destra, spazi tra le colonne di circa 1,5 em
  {
    const d = await PDFDocument.create();
    const f = await d.embedFont(StandardFonts.Helvetica);
    const p = d.addPage([595, 842]);
    p.drawText('Tabella 2 - Spese per capitolo (euro)', { x: 50, y: 760, size: 10, font: f });
    drawTable(p, f, {
      x: 50, top: 750, pad: 2, fs: 10, grid: 'none',
      cols: [{ w: 150, align: 'left' }, { w: 70, align: 'right' }, { w: 70, align: 'right' }, { w: 70, align: 'right' }],
      rows: [['Capitolo', '2024', '2025', 'Variazione'], ['Personale', '12.500,00', '13.100,00', '+4,8%'], ['Missioni', '3.200,00', '2.950,00', '-7,8%'], ['Materiale di consumo', '810,00', '1.020,00', '+25,9%'], ['Totale', '16.510,00', '17.070,00', '+3,4%']],
    });
    senzaLinee = await d.save();
  }
  // 4) tabella con soli filetti orizzontali (stile «booktabs»), filetti come rettangoli pieni sottili
  {
    const d = await PDFDocument.create();
    const f = await d.embedFont(StandardFonts.TimesRoman);
    const p = d.addPage([595, 842]);
    drawTable(p, f, {
      x: 60, top: 700, pad: 3, fs: 10, grid: 'h',
      cols: [{ w: 140, align: 'left' }, { w: 90, align: 'left' }, { w: 60, align: 'right' }],
      rows: [['Ente', 'Referente', 'Importo'], ['Comune di Prato', 'dott.ssa Bianchi', '1.200'], ['Regione Toscana', 'ing. Verdi', '35.000'], ['Università di Pisa', 'prof. Neri', '980']],
    });
    orizzontali = await d.save();
  }
  // 5) testo normale che NON deve essere diviso in celle
  {
    const d = await PDFDocument.create();
    const f = await d.embedFont(StandardFonts.Helvetica);
    const p = d.addPage([595, 842]);
    p.drawText('Firenze, 10/05/2026', { x: 445, y: 800, size: 10, font: f });
    lines(p, f, PROSA, { x: 50, y: 770, size: 10, width: 495 });
    justified(p, f, PROSA + ' ' + PROSA, { x: 50, y: 700, size: 10, width: 300 });
    p.drawText('Totale complessivo ........................................ 1.250,00', { x: 50, y: 545, size: 10, font: f });
    // elenco numerato con rientro: il numero resta con il suo testo
    ['Presentare la domanda entro trenta giorni dalla fine della missione', 'Allegare i giustificativi di spesa in originale', 'Indicare le coordinate bancarie per il rimborso'].forEach((t, i) => {
      p.drawText(`${i + 1}.`, { x: 60, y: 590 - i * 12.5, size: 10, font: f }); p.drawText(t, { x: 78, y: 590 - i * 12.5, size: 10, font: f });
    });
    // una riga «etichetta<tab>valore» isolata nel testo
    p.drawText('Protocollo:', { x: 50, y: 524, size: 10, font: f }); p.drawText('n. 4521 del 03/05/2026', { x: 50 + f.widthOfTextAtSize('Protocollo:', 10) + 14, y: 524, size: 10, font: f });
    // due colonne di prosa giustificate con 12 pt di spazio (prima finivano unite riga per riga)
    justified(p, f, PROSA, { x: 50, y: 480, size: 10, width: 230 });
    justified(p, f, 'La seconda colonna riporta le note sulla rendicontazione delle spese e sulle modalità di pagamento, da conservare insieme ai giustificativi originali presso la segreteria.', { x: 292, y: 480, size: 10, width: 230 });
    testo = await d.save();
  }
  // 6) una riga di tabella in un solo TJ con spostamenti (come LaTeX): celle nello stesso operatore
  {
    const d = await PDFDocument.create();
    const f = await d.embedFont(StandardFonts.Helvetica);
    const p = d.addPage([400, 400]);
    p.drawText('Voce', { x: 40, y: 350, size: 10, font: f });
    const fontName = p.node.Resources().lookup(PDFName.of('Font')).keys()[0].decodeText();
    const row = (y, a, b2, c) => `BT /${fontName} 10 Tf 40 ${y} Td [(${a}) -${Math.round((150 - f.widthOfTextAtSize(a, 10)) * 100)} (${b2}) -${Math.round((80 - f.widthOfTextAtSize(b2, 10)) * 100)} (${c})] TJ ET\n`;
    const src = row(320, 'Cancelleria', '4', '18,00') + row(305, 'Toner stampante', '2', '96,00') + row(290, 'Carta A4', '10', '42,50');
    const ctx = d.context;
    const s2 = ctx.register(ctx.stream(Uint8Array.from([...src].map((c) => c.charCodeAt(0))), {}));
    const cur = p.node.get(PDFName.of('Contents'));
    const arr = ctx.obj([]); const look = ctx.lookup(cur);
    if (look instanceof PDFArray) for (let i = 0; i < look.size(); i++) arr.push(look.get(i)); else arr.push(cur);
    arr.push(s2);
    p.node.set(PDFName.of('Contents'), arr);
    rigaTJ = await d.save({ useObjectStreams: false });
  }
  if (process.env.LEGGIO_FIXTURES_OUT) {
    const { writeFileSync } = await import('node:fs');
    for (const [n, b] of Object.entries({ 'tabella-fattura.pdf': fattura, 'tabella-modulo.pdf': modulo, 'tabella-senza-linee.pdf': senzaLinee, 'tabella-orizzontali.pdf': orizzontali, 'tabella-testo.pdf': testo, 'tabella-tj.pdf': rigaTJ })) writeFileSync(process.env.LEGGIO_FIXTURES_OUT + '/' + n, b);
  }
});

// ------------------------------------------------------------------ riconoscimento

describe('tabelle: una cella = un blocco', () => {
  it('fattura con griglia: la riga non diventa una frase unica (anche se pdf.js la dà come un solo item)', async () => {
    const { blocks, tc } = await blocksOf(fattura);
    expect(tc.items.some((i) => /Quantità\s+Prezzo unitario/.test(i.str))).toBe(true); // premessa: due celle in un solo item
    expect(blocks.some((b) => /Quantità.*Prezzo|Consulenza tecnica.*150,00/.test(b.text))).toBe(false);
    for (const t of ['Descrizione', 'Quantità', 'Prezzo unitario', 'IVA', 'Importo', 'Consulenza tecnica', '150,00', '300,00', 'Licenza software annuale', '240,00']) find(blocks, t);
    const q = find(blocks, 'Quantità');
    expect(q.cell).toMatchObject({ col: 1, bordered: true });
    expect(find(blocks, 'Prezzo unitario').cell.col).toBe(2);
    // le celle di una colonna non si uniscono tra righe diverse
    expect(blocks.filter((b) => b.text === '22%')).toHaveLength(3);
    expect(blocks.filter((b) => b.text === '1')).toHaveLength(2);
    // allineamento ricavato dai margini dentro la cella
    expect(find(blocks, '300,00').align).toBe('right');
    expect(find(blocks, '10%').align).toBe('center');
    expect(find(blocks, 'Trasferta').align).toBe('left');
  });
  it('cella su due righe dentro la griglia = un blocco', async () => {
    const { blocks } = await blocksOf(fattura);
    const b = blocks.find((x) => x.text.startsWith('Servizio di manutenzione'));
    expect(b.lines.map((l) => l.text)).toEqual(['Servizio di manutenzione ordinaria', 'degli impianti termici']);
    expect(b.cell.col).toBe(0);
  });
  it('il resto della fattura resta com\'era (paragrafo su più righe, totali)', async () => {
    const { blocks } = await blocksOf(fattura);
    const par = blocks.find((x) => x.text.startsWith('Il presente documento'));
    expect(par.lines.length).toBe(3);
    expect(par.cell).toBeUndefined();
    find(blocks, 'Imponibile'); find(blocks, '2.234,76');
    expect(find(blocks, '2.234,76').align).toBe('right');
  });
  it('modulo PA: etichetta e valore sono celle distinte', async () => {
    const { blocks } = await blocksOf(modulo);
    for (const t of ['Cognome', 'Rossi', 'Codice fiscale', 'RSSMRA80A01D612X', 'Qualifica', 'Ricercatore III livello', 'Data', '10/11/2026']) find(blocks, t);
    expect(find(blocks, 'Rossi').cell).toMatchObject({ col: 1, bordered: true });
    expect(blocks.find((x) => x.text.startsWith('Via dei Servi')).lines).toHaveLength(2);
    expect(blocks.some((b) => b.text.includes('Cognome') && b.text.includes('Nome'))).toBe(false);
  });
  it('tabella senza linee: colonne riconosciute dall\'allineamento', async () => {
    const { blocks } = await blocksOf(senzaLinee);
    expect(blocks.some((b) => /Personale.*12\.500/.test(b.text))).toBe(false);
    for (const t of ['Personale', '12.500,00', '13.100,00', '+4,8%', 'Materiale di consumo', '1.020,00', 'Variazione']) find(blocks, t);
    expect(find(blocks, '13.100,00').align).toBe('right');
    expect(find(blocks, '13.100,00').cell.bordered).toBe(false);
    expect(blocks.filter((b) => b.cell).length).toBe(20);
  });
  it('tabella con soli filetti orizzontali', async () => {
    const { blocks } = await blocksOf(orizzontali);
    for (const t of ['Ente', 'Referente', 'Importo', 'Comune di Prato', 'dott.ssa Bianchi', '1.200', 'Regione Toscana', 'ing. Verdi', '35.000', 'prof. Neri', '980']) find(blocks, t);
  });
  it('testo normale: paragrafi, giustificato, data a destra, puntini, etichetta/valore isolata', async () => {
    const { blocks } = await blocksOf(testo);
    expect(find(blocks, 'Firenze, 10/05/2026').cell).toBeUndefined();
    const par = blocks.find((x) => x.text.startsWith('Il presente documento') && x.lines[0].left === 50 && x.lines.length === 3);
    expect(par).toBeTruthy();
    const giust = blocks.filter((x) => x.text.includes('liquidazione') && x.box[2] < 360 && x.lines[0].base < 705 && x.lines[0].base > 600);
    expect(giust).toHaveLength(1);
    expect(giust[0].lines.length).toBeGreaterThanOrEqual(8);
    expect(giust[0].cell).toBeUndefined();
    find(blocks, 'Totale complessivo ........................................ 1.250,00');
    find(blocks, 'Protocollo: n. 4521 del 03/05/2026');
    expect(blocks.find((b) => b.text.includes('Allegare')).text).toContain('2. Allegare');
    expect(blocks.filter((b) => b.cell)).toHaveLength(0);
  });
  it('due colonne di prosa: due paragrafi, non righe unite', async () => {
    const { blocks } = await blocksOf(testo);
    const sx = blocks.filter((b) => b.lines[0].base === 480);
    expect(sx).toHaveLength(2);
    expect(sx.map((b) => b.lines.length).every((n) => n >= 3)).toBe(true);
    expect(sx.some((b) => b.text.includes('liquidazione') && b.text.includes('seconda colonna'))).toBe(false);
  });
  it('righe in un solo TJ (come LaTeX): celle separate', async () => {
    const { blocks } = await blocksOf(rigaTJ);
    for (const t of ['Cancelleria', '4', '18,00', 'Toner stampante', '96,00', 'Carta A4', '10', '42,50']) find(blocks, t);
  });
});

// ------------------------------------------------------------------ modifica di una cella

describe('tabelle: modificare una cella non sposta le altre', () => {
  it('fattura: quantità 2 → 12 (celle nello stesso item di pdf.js)', async () => {
    const { b, r, out, blocksBefore, before } = await editCell(fattura, '2', '12');
    expect(b.cell.col).toBe(1);
    await othersUnchanged(blocksBefore, out, b, ['12']);
    const after = await textItems(out);
    expect(compareOutside(before.items, after.items, [b.rect, r.extent]).ok).toBe(true);
    // allineata a destra: il bordo destro del numero resta lì
    const nb = (await blocksOf(out)).blocks.find((x) => x.text === '12');
    expect(Math.abs(nb.box[2] - b.box[2])).toBeLessThan(0.5);
  });
  it('fattura: intestazione «Quantità» → «Q.tà» (stessa cella di pdf.js di «Prezzo unitario»)', async () => {
    const { b, r, out, blocksBefore, before } = await editCell(fattura, 'Quantità', 'Q.tà');
    await othersUnchanged(blocksBefore, out, b, ['Q.tà']);
    const after = await textItems(out);
    expect(compareOutside(before.items, after.items, [b.rect, r.extent]).ok).toBe(true);
    expect(after.items.map((i) => i.str).join(' ')).toContain('Prezzo unitario');
  });
  it('fattura: importo più lungo resta allineato a destra nella sua cella', async () => {
    const { b, out, blocksBefore } = await editCell(fattura, '240,00', '12.240,00');
    const after = await othersUnchanged(blocksBefore, out, b, ['12.240,00']);
    const nb = after.find((x) => x.text === '12.240,00');
    expect(Math.abs(nb.box[2] - b.box[2])).toBeLessThan(0.5);
    expect(nb.box[0]).toBeGreaterThan(b.cell.bounds[0] - 0.5);
  });
  it('fattura: descrizione più lunga va a capo dentro la cella, senza invadere la colonna Quantità', async () => {
    const nuovo = 'Consulenza tecnica specialistica per la progettazione esecutiva';
    const { b, r, out, blocksBefore } = await editCell(fattura, 'Consulenza tecnica', nuovo);
    expect(r.method).toBe('rewrite');
    const after = await othersUnchanged(blocksBefore, out, b, []);
    const A = analyze(await open(out), 0);
    // tutti i glifi del testo nuovo stanno tra i filetti della prima colonna (50 … 265)
    const gl = A.r.shows.filter((s) => s.glyphs.some((g) => g.u === 'C' || g.u === 'p')).flatMap((s) => s.glyphs).filter((g) => g.o[1] > 600 && g.o[1] < 660 && g.o[0] < 270);
    expect(Math.max(...gl.map((g) => g.e[0]))).toBeLessThan(265);
    const nb = after.filter((x) => x.lines[0].left < 60 && /Consulenza|progettazione|esecutiva/.test(x.text));
    expect(nb.map((x) => x.text).join(' ').replace(/\s+/g, ' ')).toContain('Consulenza tecnica specialistica');
    expect(after.some((x) => x.text.includes('esecutiva') && x.box[2] > 265)).toBe(false);
  });
  it('fattura: numero che non entra nella cella viene rimpicciolito, non sborda', async () => {
    const { b, r, out, blocksBefore } = await editCell(fattura, '22%', '22% (split payment)');
    await othersUnchanged(blocksBefore, out, b, []);
    expect(r.warnings.join(' ')).toMatch(/rimpicciolito|non entra/);
    const A = analyze(await open(out), 0);
    const [x0, , x1] = b.cell.bounds;
    const gl = A.r.shows.flatMap((s) => s.glyphs).filter((g) => g.u && Math.abs(g.o[1] - b.lines[0].base) < 3 && g.o[0] > x0 - 5 && g.o[0] < x1 + 5);
    expect(gl.length).toBeGreaterThan(5);
    for (const g of gl) { expect(g.o[0]).toBeGreaterThan(x0 - 1.6); expect(g.e[0]).toBeLessThan(x1 + 1.6); }
  });
  it('modulo PA: cambiare il valore non tocca l\'etichetta (in loco)', async () => {
    const { b, r, out, blocksBefore, before } = await editCell(modulo, 'Rossi', 'Rossini');
    expect(r.method).toBe('inplace');
    await othersUnchanged(blocksBefore, out, b, ['Rossini']);
    const after = await textItems(out);
    // confronto item per item (qui pdf.js dà item separati): tutto il resto entro 0,5 pt
    for (const it of before.items.filter((i) => i.str.trim() && i.str !== 'Rossi')) {
      expect(after.items.some((j) => j.str === it.str && Math.abs(j.transform[4] - it.transform[4]) < 0.5 && Math.abs(j.transform[5] - it.transform[5]) < 0.5), it.str).toBe(true);
    }
  });
  it('tabella senza linee: modifica di un numero, le colonne vicine restano ferme', async () => {
    const { b, out, blocksBefore } = await editCell(senzaLinee, '2.950,00', '12.950,00');
    const after = await othersUnchanged(blocksBefore, out, b, ['12.950,00']);
    const nb = after.find((x) => x.text === '12.950,00');
    expect(Math.abs(nb.box[2] - b.box[2])).toBeLessThan(0.5);
  });
  it('riga in un solo TJ: correzione in loco compensata, le celle a destra non scorrono', async () => {
    const { b, r, out, blocksBefore } = await editCell(rigaTJ, 'Toner stampante', 'Toner per stampante laser');
    expect(r.method).toBe('inplace');
    await othersUnchanged(blocksBefore, out, b, ['Toner per stampante laser']);
    const q = await editCell(rigaTJ, '10', '1');
    await othersUnchanged(q.blocksBefore, q.out, q.b, []);
  });
});

describe('pagine con migliaia di tratti disegnati', () => {
  it('20.000 tratti e testo a 21 angoli: il raggruppamento non blocca l\'interfaccia', () => {
    // mappa o disegno tecnico: tratteggi sparsi ed etichette ruotate (prima: oltre 20 secondi nel thread principale)
    const rules = [];
    for (let i = 0; i < 20000; i++) { const x = (i * 7.31) % 600, y = (i * 13.7) % 800; rules.push({ x0: x, y0: y, x1: x, y1: y + 3 }); }
    const items = [];
    for (let r = 0; r < 60; r++) for (let c = 0; c < 6; c++) items.push({ str: `Testo ${r} ${c}`, transform: [10, 0, 0, 10, 30 + c * 90, 780 - r * 12], width: 60, fontName: 'f' });
    for (let k = 0; k < 20; k++) { const g = k * 0.3; items.push({ str: 'etichetta', transform: [10 * Math.cos(g), 10 * Math.sin(g), -10 * Math.sin(g), 10 * Math.cos(g), 100, 100], width: 40, fontName: 'f' }); }
    const t0 = performance.now();
    const blocks = groupTextItems(items, {}, { rules });
    expect(performance.now() - t0).toBeLessThan(4000);
    expect(blocks.length).toBeGreaterThan(20);
  });
});
