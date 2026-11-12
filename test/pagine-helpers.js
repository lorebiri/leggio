// Generatori di PDF di prova per i test dell'area «pagine».
import { PDFDocument, StandardFonts, PDFName, PDFString, PDFArray, PDFDict, rgb } from '@cantoo/pdf-lib';

/** Documento con n pagine numerate; opzioni: modulo (campi su pag. 1 e 2), annotazioni, segnalibri. */
export async function creaDoc(n = 6, { modulo = false, annot = false, segnalibri = false, dims = [595, 842] } = {}) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= n; i++) {
    const p = doc.addPage(dims);
    p.drawText(`Pagina ${i}`, { x: 50, y: dims[1] - 60, size: 24, font });
  }
  if (modulo && n >= 2) {
    const form = doc.getForm();
    const t = form.createTextField('nome'); t.setText('Mario'); t.addToPage(doc.getPage(0), { x: 50, y: 500, width: 200, height: 24 });
    const c = form.createCheckBox('ok'); c.addToPage(doc.getPage(1), { x: 50, y: 500, width: 18, height: 18 });
    const r = form.createRadioGroup('scelta');
    r.addOptionToPage('a', doc.getPage(1), { x: 100, y: 400, width: 18, height: 18 });
    r.addOptionToPage('b', doc.getPage(1), { x: 140, y: 400, width: 18, height: 18 });
  }
  if (annot) {
    const ctx = doc.context;
    for (let i = 0; i < n; i++) {
      const page = doc.getPage(i);
      const a = ctx.obj({ Type: 'Annot', Subtype: 'Text', Rect: [100, 100, 120, 120], Contents: PDFString.of(`Nota ${i + 1}`), P: page.ref });
      page.node.addAnnot(ctx.register(a));
    }
  }
  if (segnalibri) aggiungiOutline(doc, [['Capitolo 1', 0, [['Sezione 1.1', 1]]], ['Capitolo 2', Math.min(2, n - 1)]]);
  return doc;
}

/** spec: [[titolo, pagina, figli?]] */
export function aggiungiOutline(doc, spec) {
  const ctx = doc.context;
  const pages = doc.getPages();
  const rootRef = ctx.nextRef();
  const build = (items, parentRef) => {
    const refs = items.map(() => ctx.nextRef());
    items.forEach(([title, page, kids], k) => {
      const d = ctx.obj({ Title: PDFString.of(title), Parent: parentRef, Dest: [pages[page].ref, 'XYZ', null, null, null] });
      if (k > 0) d.set(PDFName.of('Prev'), refs[k - 1]);
      if (k < items.length - 1) d.set(PDFName.of('Next'), refs[k + 1]);
      if (kids?.length) { const kr = build(kids, refs[k]); d.set(PDFName.of('First'), kr[0]); d.set(PDFName.of('Last'), kr[kr.length - 1]); d.set(PDFName.of('Count'), ctx.obj(kids.length)); }
      ctx.assign(refs[k], d);
    });
    return refs;
  };
  const top = build(spec, rootRef);
  ctx.assign(rootRef, ctx.obj({ Type: 'Outlines', First: top[0], Last: top[top.length - 1], Count: top.length }));
  doc.catalog.set(PDFName.of('Outlines'), rootRef);
}

export async function ricarica(doc) { return PDFDocument.load(await doc.save()); }

/** Testo "Pagina N" di ogni pagina, letto dal content stream (per verificare l'ordine). */
export function etichette(doc) {
  return doc.getPages().map((p) => {
    const contents = p.node.Contents();
    const streams = contents instanceof PDFArray ? contents.asArray().map((r) => doc.context.lookup(r)) : [contents];
    for (const s of streams) {
      let txt;
      try { txt = new TextDecoder('latin1').decode(decode(s)); } catch { continue; }
      const m = txt.match(/<([0-9A-Fa-f]+)> Tj/);
      if (m) { const hex = m[1]; let out = ''; for (let i = 0; i < hex.length; i += 2) out += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16)); if (out.startsWith('Pagina')) return out; }
    }
    return '?';
  });
}
import { decodePDFRawStream, PDFRawStream } from '@cantoo/pdf-lib';
function decode(s) { if (s instanceof PDFRawStream) return decodePDFRawStream(s).decode(); return s.getContents ? s.getContents() : new Uint8Array(); }

export { PDFDocument, PDFName, PDFDict, rgb };
