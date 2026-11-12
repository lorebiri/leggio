// Link (annotazioni /Link): creazione, lettura, modifica, eliminazione. Niente DOM.
import * as PDFLib from '@cantoo/pdf-lib';

const { PDFName, PDFDict, PDFArray, PDFString, PDFHexString, PDFRef, PDFNumber, PDFNull } = PDFLib;
const N = (s) => PDFName.of(s);

function annotsArray(page, create = false) {
  const ctx = page.doc.context;
  let a = ctx.lookup(page.node.get(N('Annots')));
  if (!(a instanceof PDFArray)) {
    if (!create) return null;
    a = ctx.obj([]);
    page.node.set(N('Annots'), a);
  }
  return a;
}
const textOf = (o) => (o instanceof PDFString || o instanceof PDFHexString ? o.decodeText() : null);

function targetToAction(pdfDoc, target) {
  const ctx = pdfDoc.context;
  if (target.type === 'url') {
    let url = String(target.url || '').trim();
    if (!/^[a-z][a-z0-9+.-]*:/i.test(url)) url = 'https://' + url;
    return { A: ctx.obj({ Type: 'Action', S: 'URI', URI: PDFString.of(url) }) };
  }
  if (target.type === 'email') {
    const email = String(target.email || '').trim().replace(/^mailto:/i, '');
    return { A: ctx.obj({ Type: 'Action', S: 'URI', URI: PDFString.of('mailto:' + email) }) };
  }
  if (target.type === 'page') {
    const pages = pdfDoc.getPages();
    const p = pages[Math.max(0, Math.min(pages.length - 1, target.page | 0))];
    const top = p.getHeight();
    return { Dest: ctx.obj([p.ref, N('XYZ'), PDFNull, PDFNumber.of(top), PDFNull]) };
  }
  throw new Error('Tipo di collegamento sconosciuto');
}

/** Aggiunge un link nel rettangolo [x1,y1,x2,y2] (spazio pagina). */
export function addLink(pdfDoc, pageIndex, rect, target) {
  const page = pdfDoc.getPage(pageIndex);
  const ctx = pdfDoc.context;
  const r = [Math.min(rect[0], rect[2]), Math.min(rect[1], rect[3]), Math.max(rect[0], rect[2]), Math.max(rect[1], rect[3])];
  const dict = ctx.obj({ Type: 'Annot', Subtype: 'Link', Rect: r, Border: [0, 0, 0], F: 4, ...targetToAction(pdfDoc, target) });
  const ref = ctx.register(dict);
  annotsArray(page, true).push(ref);
  return ref;
}

/** Link della pagina: [{ index (posizione in /Annots), rect, target:{type,url|email|page|name}, editable }] */
export function listLinks(pdfDoc, pageIndex) {
  const page = pdfDoc.getPage(pageIndex);
  const ctx = pdfDoc.context;
  const arr = annotsArray(page);
  if (!arr) return [];
  const pageRefs = pdfDoc.getPages().map((p) => p.ref);
  const out = [];
  for (let i = 0; i < arr.size(); i++) {
    const a = ctx.lookup(arr.get(i));
    if (!(a instanceof PDFDict)) continue;
    if (a.get(N('Subtype'))?.toString() !== '/Link') continue;
    const rectArr = ctx.lookup(a.get(N('Rect')));
    if (!(rectArr instanceof PDFArray) || rectArr.size() < 4) continue;
    const rect = [0, 1, 2, 3].map((k) => ctx.lookup(rectArr.get(k))?.asNumber?.() ?? 0);
    let target = { type: 'other' };
    const act = ctx.lookup(a.get(N('A')));
    let dest = ctx.lookup(a.get(N('Dest')));
    if (act instanceof PDFDict) {
      const S = act.get(N('S'))?.toString();
      if (S === '/URI') {
        const uri = textOf(ctx.lookup(act.get(N('URI')))) || '';
        target = /^mailto:/i.test(uri) ? { type: 'email', email: uri.replace(/^mailto:/i, '') } : { type: 'url', url: uri };
      } else if (S === '/GoTo') dest = ctx.lookup(act.get(N('D')));
      else target = { type: 'other', action: S };
    }
    if (dest instanceof PDFArray && dest.size()) {
      const pr = dest.get(0);
      const idx = pr instanceof PDFRef ? pageRefs.findIndex((r) => r === pr || r.toString() === pr.toString()) : (ctx.lookup(pr)?.asNumber?.() ?? -1);
      target = idx >= 0 ? { type: 'page', page: idx } : { type: 'other' };
    } else if (dest && (dest instanceof PDFName || dest instanceof PDFString || dest instanceof PDFHexString)) {
      target = { type: 'named', name: dest instanceof PDFName ? dest.decodeText() : dest.decodeText() };
    }
    out.push({ index: i, rect, target, editable: ['url', 'email', 'page'].includes(target.type) });
  }
  return out;
}

/** Modifica destinazione e/o rettangolo di un link esistente. */
export function updateLink(pdfDoc, pageIndex, index, target, rect) {
  const page = pdfDoc.getPage(pageIndex);
  const ctx = pdfDoc.context;
  const arr = annotsArray(page);
  const a = arr && ctx.lookup(arr.get(index));
  if (!(a instanceof PDFDict)) throw new Error('Collegamento non trovato: la pagina è cambiata, riprova.');
  if (target) {
    a.delete(N('A')); a.delete(N('Dest'));
    for (const [k, v] of Object.entries(targetToAction(pdfDoc, target))) a.set(N(k), v);
  }
  if (rect) a.set(N('Rect'), ctx.obj([Math.min(rect[0], rect[2]), Math.min(rect[1], rect[3]), Math.max(rect[0], rect[2]), Math.max(rect[1], rect[3])]));
}

export function deleteLink(pdfDoc, pageIndex, index) {
  const page = pdfDoc.getPage(pageIndex);
  const arr = annotsArray(page);
  if (!arr || index < 0 || index >= arr.size()) throw new Error('Collegamento non trovato: la pagina è cambiata, riprova.');
  arr.remove(index);
}

const overlaps = (a, b) => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];
/** Aggiunge link per rettangoli non già coperti da un link esistente. items: [{ rect, target }] → numero aggiunti. */
export function addLinksIfFree(pdfDoc, pageIndex, items) {
  const existing = listLinks(pdfDoc, pageIndex).map((l) => l.rect);
  let n = 0;
  for (const it of items) {
    if (existing.some((r) => overlaps(r, it.rect))) continue;
    addLink(pdfDoc, pageIndex, it.rect, it.target);
    existing.push(it.rect); n++;
  }
  return n;
}
