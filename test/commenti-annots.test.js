import { describe, it, expect } from 'vitest';
import { PDFDocument, PDFName, PDFArray, PDFDict, PDFString, PDFHexString } from '@cantoo/pdf-lib';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createAnnot, readAllAnnotations, updateAnnot, deleteAnnots, addReply, setStatus, deleteAllComments, flattenComments, findAnnot } from '../src/renderer/features/commenti/annots.js';

async function blank(n = 2) { const d = await PDFDocument.create(); for (let i = 0; i < n; i++) d.addPage([595, 842]); return d; }
async function reload(d) { return PDFDocument.load(await d.save()); }
async function pdfjsAnnots(bytes, page = 1) {
  const task = pdfjs.getDocument({ data: bytes, isEvalSupported: false, verbosity: 0 });
  const pdf = await task.promise;
  const p = await pdf.getPage(page); const a = await p.getAnnotations(); await task.destroy(); return a;
}

describe('annotazioni pdf-lib', () => {
  it('crea tutti i tipi con /AP e li rilegge', async () => {
    const d = await blank();
    const opts = { author: 'Mario Rossi' };
    const specs = [
      { type: 'Highlight', quadPoints: [50, 700, 200, 700, 50, 688, 200, 688], color: [1, 0.8, 0], opacity: 0.5, text: 'importo' },
      { type: 'Underline', quadPoints: [50, 600, 200, 600, 50, 588, 200, 588], color: [0, 0, 1] },
      { type: 'StrikeOut', quadPoints: [50, 580, 200, 580, 50, 568, 200, 568], color: [1, 0, 0] },
      { type: 'Squiggly', quadPoints: [50, 560, 200, 560, 50, 548, 200, 548], color: [0, 0.6, 0] },
      { type: 'Text', rect: [300, 700, 320, 720], text: 'Manca il CIG', color: [1, 0.8, 0] },
      { type: 'FreeText', rect: [300, 600, 450, 640], text: 'Visto, si liquida — àèìòù €', fontSize: 12, textColor: [0, 0, 0], color: [1, 0, 0], interior: [1, 1, 0.8], borderWidth: 1 },
      { type: 'Square', rect: [50, 400, 150, 450], color: [1, 0, 0], width: 2 },
      { type: 'Circle', rect: [200, 400, 300, 450], color: [0, 0, 1], interior: [0.9, 0.9, 1], width: 1, cloud: 1 },
      { type: 'Line', line: [50, 300, 250, 350], color: [0, 0, 0], width: 2, lineEnding: ['None', 'OpenArrow'] },
      { type: 'Polygon', vertices: [[300, 300], [400, 300], [350, 380]], color: [0, 0.5, 0], width: 1 },
      { type: 'PolyLine', vertices: [[400, 200], [450, 250], [500, 200]], color: [0, 0.5, 0], width: 1 },
      { type: 'Ink', inkList: [[[50, 100], [60, 120], [80, 110], [100, 140]]], color: [0, 0, 1], width: 3 },
      { type: 'Stamp', rect: [300, 100, 450, 150], stamp: { label: 'RICEVUTO', sub: 'Mario Rossi, 12/11/2026', color: [0.15, 0.35, 0.7] }, icon: 'Leggio.Ricevuto' },
      { type: 'Caret', rect: [210, 690, 220, 700], color: [0, 0, 1], text: 'aggiungere CIG' },
    ];
    for (const s of specs) await createAnnot(d, 0, s, opts);
    const d2 = await reload(d);
    const list = readAllAnnotations(d2);
    expect(list.map((a) => a.type)).toEqual(specs.map((s) => s.type));
    expect(list.every((a) => a.author === 'Mario Rossi')).toBe(true);
    expect(list[5].text).toContain('€');
    // tutti con aspetto
    for (const { dict } of d2.getPage(0).node.Annots().asArray().map((r) => ({ dict: d2.context.lookup(r) }))) {
      if (dict.get(PDFName.of('Subtype')).decodeText() !== 'Popup') expect(dict.get(PDFName.of('AP'))).toBeTruthy();
    }
    // pdf.js le legge e vede gli aspetti
    const a = await pdfjsAnnots(await d2.save());
    const comments = a.filter((x) => x.subtype !== 'Popup');
    expect(comments.length).toBe(specs.length);
    expect(comments.every((x) => x.hasAppearance)).toBe(true);
    expect(comments[0].id).toMatch(/^\d+R$/);
  });

  it('sposta, ridimensiona, cambia colore, elimina', async () => {
    const d = await blank();
    const k = await createAnnot(d, 0, { type: 'Square', rect: [10, 10, 110, 60], color: [1, 0, 0], width: 1 }, { author: 'A' });
    await updateAnnot(d, { key: k, pageIndex: 0 }, { translate: [5, 5] });
    let a = readAllAnnotations(d)[0];
    expect(a.rect).toEqual([15, 15, 115, 65]);
    await updateAnnot(d, { key: k }, { rect: [0, 0, 200, 100], color: [0, 1, 0] });
    a = readAllAnnotations(d)[0];
    expect(a.rect).toEqual([0, 0, 200, 100]);
    expect(a.color).toEqual([0, 1, 0]);
    expect(deleteAnnots(d, [{ key: k }])).toBe(1);
    expect(readAllAnnotations(d)).toHaveLength(0);
  });

  it('risposte e stati; eliminare il padre elimina anche le risposte', async () => {
    const d = await blank();
    const k = await createAnnot(d, 0, { type: 'Text', rect: [10, 10, 30, 30], text: 'nota' }, { author: 'A' });
    await addReply(d, { key: k }, { author: 'B', text: 'fatto' });
    await setStatus(d, { key: k }, { author: 'B', state: 'Completed' });
    const d2 = await reload(d);
    const list = readAllAnnotations(d2);
    expect(list).toHaveLength(3);
    expect(list[1].irt).toBe(k);
    expect(list[2].state).toBe('Completed');
    const pj = await pdfjsAnnots(await d2.save());
    const st = pj.find((x) => x.state);
    expect(st.inReplyTo).toBe(k);
    expect(st.stateModel).toBe('Review');
    deleteAnnots(d2, [{ key: k }]);
    expect(readAllAnnotations(d2)).toHaveLength(0);
    // nemmeno popup orfani
    expect(d2.getPage(0).node.Annots().size()).toBe(0);
  });

  it('appiattisce e cancella tutto senza toccare i link', async () => {
    const d = await blank();
    await createAnnot(d, 0, { type: 'Square', rect: [10, 10, 110, 60], color: [1, 0, 0] });
    await createAnnot(d, 1, { type: 'Text', rect: [10, 10, 30, 30], text: 'x' });
    const link = d.context.register(d.context.obj({ Type: 'Annot', Subtype: 'Link', Rect: [0, 0, 10, 10] }));
    d.getPage(0).node.addAnnot(link);
    const r = await flattenComments(d, { pages: [0] });
    expect(r.flattened).toBe(1);
    expect(d.getPage(0).node.Annots().size()).toBe(1); // resta il link
    expect(deleteAllComments(d)).toBe(1);
    expect(d.getPage(1).node.Annots().size()).toBe(0);
    const d2 = await reload(d);
    expect(d2.getPageCount()).toBe(2);
  });

  it('annotazioni malformate: si saltano senza eccezioni', async () => {
    const d = await blank(1);
    const ctx = d.context;
    const bad = [
      { Type: 'Annot', Subtype: 'Highlight' }, // niente Rect né QuadPoints
      { Type: 'Annot', Subtype: 'Highlight', Rect: [200, 200, 100, 100], QuadPoints: [1, 2, 3] }, // rect invertito, quad corti
      { Type: 'Annot', Subtype: 'Ink', InkList: [[1, 2, 'x', 4], 5] },
      { Type: 'Annot', Subtype: 'Square', Rect: ['a', 'b'] },
      { Type: 'Annot' },
      { Type: 'Annot', Subtype: 'Text', Rect: [10, 10, 30, 30], Contents: PDFString.of('ok'), C: [2, -1] },
    ];
    for (const b of bad) d.getPage(0).node.addAnnot(ctx.register(ctx.obj(b)));
    d.getPage(0).node.Annots().push(ctx.obj(5)); // voce non dizionario
    const warnings = [];
    const list = readAllAnnotations(d, { warnings });
    expect(list.map((a) => a.type)).toEqual(['Highlight', 'Ink', 'Text']);
    expect(list[0].rect).toEqual([100, 100, 200, 200]);
    expect(warnings.length).toBe(2);
    await expect(flattenComments(d)).resolves.toBeTruthy();
    expect(() => deleteAllComments(d)).not.toThrow();
  });

  it('la casella di testo si allunga per contenere tutto il testo', async () => {
    const d = await blank(1);
    const k = await createAnnot(d, 0, { type: 'FreeText', rect: [100, 700, 160, 712], text: 'Visto, si liquida\nseconda riga con accenti àèìòù', fontSize: 12, borderWidth: 1, color: [1, 0, 0] });
    let a = readAllAnnotations(d)[0];
    expect(a.rect[3]).toBe(712); // bordo superiore fermo
    expect(a.rect[3] - a.rect[1]).toBeGreaterThan(40);
    await updateAnnot(d, { key: k }, { text: 'corto' });
    a = readAllAnnotations(d)[0];
    expect(a.text).toBe('corto');
  });

  it('target inesistente → errore chiaro', async () => {
    const d = await blank(1);
    await expect(updateAnnot(d, { key: '999R' }, { color: [0, 0, 0] })).rejects.toThrow(/non trovato/);
    expect(findAnnot(d, null)).toBe(null);
    await expect(createAnnot(d, 5, { type: 'Square', rect: [0, 0, 1, 1] })).rejects.toThrow(/inesistente/);
  });
});
