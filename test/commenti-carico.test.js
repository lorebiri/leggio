// Prove di carico: documento da 1000+ pagine e migliaia di annotazioni (anche malformate).
// Stampa i tempi misurati (vedi rapporto in docs/aree/commenti.md).
import { describe, it, expect } from 'vitest';
import { PDFDocument, PDFString, StandardFonts } from '@cantoo/pdf-lib';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { readAllAnnotations, createAnnot, deleteAllComments, flattenComments, updateAnnot } from '../src/renderer/features/commenti/annots.js';
import { toXfdf, fromXfdf } from '../src/renderer/features/commenti/xfdf.js';
import { fromPdfjs, buildThreads, filterThreads, summaryText } from '../src/renderer/features/commenti/model.js';
import { writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PAGES = 1000, PER_PAGE = 5;
const t = () => performance.now();
const times = {};

export async function makeBig() {
  const d = await PDFDocument.create();
  const font = await d.embedFont(StandardFonts.Helvetica);
  const ctx = d.context;
  for (let i = 0; i < PAGES; i++) {
    const p = d.addPage([595, 842]);
    p.drawText(`Pagina ${i + 1}`, { x: 50, y: 780, size: 18, font });
    for (let k = 0; k < PER_PAGE; k++) {
      const y = 700 - k * 60;
      const kinds = [
        { Type: 'Annot', Subtype: 'Highlight', Rect: [50, y, 300, y + 14], QuadPoints: [50, y + 14, 300, y + 14, 50, y, 300, y], C: [1, 1, 0], T: PDFString.of('Altro programma'), Contents: PDFString.of(`Commento ${i}-${k}`), M: PDFString.of('D:20250101120000Z') },
        { Type: 'Annot', Subtype: 'Square', Rect: [400, y + 30, 320, y] /* invertito */, C: [1, 0, 0] },
        { Type: 'Annot', Subtype: 'Ink', Rect: [0, 0, 0, 0], InkList: [[60, y, 80, y + 10, 100, y]] /* senza AP, rect vuoto */ },
        { Type: 'Annot', Subtype: 'Text', Rect: [500, y, 520, y + 20], Contents: PDFString.of('nota'), C: [1, 0.8, 0], T: PDFString.of('Mario') },
        { Type: 'Annot', Subtype: 'StrikeOut', Rect: [50, y, 300, y + 14] /* senza QuadPoints */, C: [1, 0, 0] },
      ];
      d.getPage(i).node.addAnnot(ctx.register(ctx.obj(kinds[k % kinds.length])));
    }
  }
  return d.save();
}

describe('carico: 1000 pagine, 5000 annotazioni (in parte malformate)', () => {
  let bytes;
  it('genera e legge con pdf-lib', async () => {
    let a = t(); bytes = await makeBig(); times.genera = t() - a;
    const dir = join(tmpdir(), 'leggio-commenti'); mkdirSync(dir, { recursive: true }); writeFileSync(join(dir, 'grande.pdf'), bytes); // per il collaudo nel browser
    a = t(); const doc = await PDFDocument.load(bytes); times.caricaPdfLib = t() - a;
    a = t(); const warnings = []; const list = readAllAnnotations(doc, { warnings }); times.leggiTutte = t() - a;
    expect(list.length).toBeGreaterThanOrEqual(PAGES * 4);
    a = t(); await createAnnot(doc, 999, { type: 'Square', rect: [10, 10, 50, 50], color: [0, 0, 1] }, { author: 'X' }); await doc.save({ useObjectStreams: true }); times.creaUnaESalva = t() - a;
    a = t(); await updateAnnot(doc, { key: list[list.length - 1].key, pageIndex: 999 }, { color: [0, 1, 0] }); times.modificaUltima = t() - a;
    a = t(); const xml = toXfdf(list); times.esportaXfdf = t() - a;
    a = t(); const back = fromXfdf(xml, { pageCount: PAGES }); times.leggiXfdf = t() - a;
    expect(back.length).toBeGreaterThan(PAGES * 3);
  }, 120000);
  it('pdf.js: modello del pannello su tutte le pagine', async () => {
    const task = pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false, verbosity: 0 });
    const pdf = await task.promise;
    let a = t(); const list = [];
    for (let i = 0; i < pdf.numPages; i++) { const p = await pdf.getPage(i + 1); for (const d of await p.getAnnotations()) { const c = fromPdfjs(d, i); if (c) list.push(c); } }
    times.pdfjsTuttePagine = t() - a;
    a = t(); const th = buildThreads(list); const f = filterThreads(th, { q: 'commento 99' }); summaryText(th); times.discussioniFiltroRiepilogo = t() - a;
    expect(th.length).toBeGreaterThan(PAGES * 3);
    expect(f.length).toBeGreaterThan(0);
    await task.destroy();
  }, 120000);
  it('appiattisci ed elimina tutto', async () => {
    let doc = await PDFDocument.load(bytes);
    let a = t(); const w = []; const r = await flattenComments(doc, { warnings: w }); times.appiattisci = t() - a;
    expect(r.flattened).toBeGreaterThan(PAGES * 3);
    a = t(); await doc.save({ useObjectStreams: true }); times.salvaAppiattito = t() - a;
    doc = await PDFDocument.load(bytes);
    a = t(); const n = deleteAllComments(doc); times.eliminaTutti = t() - a;
    expect(n).toBe(PAGES * PER_PAGE);
    console.log('TEMPI (ms):', JSON.stringify(Object.fromEntries(Object.entries(times).map(([k, v]) => [k, Math.round(v)]))));
  }, 120000);
});
