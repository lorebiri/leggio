// Redazione (oscuramento) vera: sostituisce il contenuto delle pagine interessate con un'immagine
// già oscurata (prodotta dal chiamante: canvas nel browser) e un livello di testo invisibile con le
// sole parole fuori dalle aree oscurate. Toglie annotazioni e campi nelle aree, miniature e dati
// privati delle pagine. Logica pura su pdf-lib: nessun DOM.
import { PDFDict, PDFArray, PDFName, PDFString, PDFHexString, PDFRef, StandardFonts, rgb } from '@cantoo/pdf-lib';
import { N, lookupDict, lookupArray, num, removeUnreachable } from './pdfutil.js';
import { intersects, intersectsAny, normRect } from './testo.js';

/** Rettangolo di un'annotazione (normalizzato) o null. */
export function annotRect(ctx, annot) {
  const r = lookupArray(ctx, annot.get(N('Rect')));
  if (!r || r.size() < 4) return null;
  return normRect([0, 1, 2, 3].map((i) => num(ctx, r.get(i))));
}

/**
 * Toglie dalla pagina le annotazioni (commenti, link, campi) che toccano le aree.
 * Toglie anche i campi del modulo rimasti senza widget. → { annots, fields }
 */
export function removeAnnotsInRects(pdfDoc, pageNode, rects) {
  const ctx = pdfDoc.context;
  const annots = lookupArray(ctx, pageNode.get(N('Annots')));
  const removedWidgets = new Set(); const popups = new Set();
  let count = 0;
  if (annots) {
    const keep = [];
    for (const ref of annots.asArray()) {
      const a = lookupDict(ctx, ref);
      const r = a && annotRect(ctx, a);
      if (a && r && intersectsAny(r, rects)) {
        count++;
        if (ref instanceof PDFRef && a.get(N('Subtype')) === N('Widget')) removedWidgets.add(ref.tag);
        const popup = a.get(N('Popup'));
        if (popup instanceof PDFRef) popups.add(popup.tag);
        continue;
      }
      keep.push(ref);
    }
    pageNode.set(N('Annots'), ctx.obj(keep.filter((ref) => !(ref instanceof PDFRef && popups.has(ref.tag)))));
  }
  const fields = removedWidgets.size ? pruneFields(pdfDoc, removedWidgets) : 0;
  return { annots: count, fields };
}

/** Toglie dall'albero AcroForm i widget eliminati e i campi rimasti vuoti. → campi eliminati */
function pruneFields(pdfDoc, removed) {
  const ctx = pdfDoc.context;
  const acro = lookupDict(ctx, pdfDoc.catalog.get(N('AcroForm')));
  if (!acro) return 0;
  let gone = 0;
  const isRemoved = (ref) => ref instanceof PDFRef && removed.has(ref.tag);
  const prune = (arr, depth) => {
    if (!arr || depth > 32) return [];
    const out = [];
    for (const ref of arr.asArray()) {
      const f = lookupDict(ctx, ref);
      if (isRemoved(ref)) { if (f && f.get(N('T'))) gone++; continue; }
      if (!f) continue;
      const kids = lookupArray(ctx, f.get(N('Kids')));
      if (kids) {
        const k = prune(kids, depth + 1);
        if (!k.length) { gone++; continue; }
        f.set(N('Kids'), ctx.obj(k));
      }
      out.push(ref);
    }
    return out;
  };
  const fields = lookupArray(ctx, acro.get(N('Fields')));
  if (fields) acro.set(N('Fields'), ctx.obj(prune(fields, 0)));
  return gone;
}

/** Testo codificabile nel carattere standard (WinAnsi): i caratteri non disponibili diventano spazi. */
function encodable(font, text) {
  const set = font.__leggioSet || (font.__leggioSet = new Set(font.getCharacterSet()));
  let s = '';
  for (const ch of text) s += set.has(ch.codePointAt(0)) ? ch : ' ';
  return s.trim() ? s : '';
}
const f2 = (x) => (Math.round(x * 1000) / 1000).toString();

/** Operatori di un livello di testo invisibile (modo 3) con le parole indicate. */
export function invisibleTextOps(font, fontName, words) {
  const out = ['BT', '3 Tr'];
  for (const w of words) {
    const text = encodable(font, w.text);
    if (!text || !(w.size > 0)) continue;
    const natural = font.widthOfTextAtSize(text, w.size) || 1;
    const tz = Math.max(1, Math.min(1000, (w.width / natural) * 100));
    const [dx, dy] = w.dir;
    out.push(`/${fontName} ${f2(w.size)} Tf ${f2(tz)} Tz ${f2(dx)} ${f2(dy)} ${f2(-dy)} ${f2(dx)} ${f2(w.origin[0])} ${f2(w.origin[1])} Tm ${font.encodeText(text).toString()} Tj`);
  }
  out.push('ET');
  return out.join('\n');
}

/**
 * Sostituisce il contenuto della pagina.
 * opts: { image: { bytes, kind: 'jpeg'|'png' } , view: [x1,y1,x2,y2] (area visibile in punti PDF),
 *         rects (aree oscurate, coordinate PDF), keepWords (parole da lasciare ricercabili), font (PDFFont, Helvetica) }
 * → { annots, fields }
 */
export async function redactPage(pdfDoc, pageIndex, { image, view, rects, keepWords = [], font }) {
  const ctx = pdfDoc.context;
  const page = pdfDoc.getPage(pageIndex);
  const node = page.node;
  const img = image.kind === 'png' ? await pdfDoc.embedPng(image.bytes) : await pdfDoc.embedJpg(image.bytes);
  const [x1, y1, x2, y2] = view;
  const ops = [`q ${f2(x2 - x1)} 0 0 ${f2(y2 - y1)} ${f2(x1)} ${f2(y1)} cm /LgRedImg Do Q`];
  const res = { XObject: { LgRedImg: img.ref } };
  if (keepWords.length && font) {
    ops.push(invisibleTextOps(font, 'LgRedF', keepWords));
    res.Font = { LgRedF: font.ref };
  }
  const stream = ctx.flateStream(ops.join('\n'));
  node.set(N('Contents'), ctx.register(stream));
  node.set(N('Resources'), ctx.obj(res));
  for (const k of ['Thumb', 'PieceInfo', 'Metadata', 'StructParents', 'Group', 'AA', 'B', 'SeparationInfo']) node.delete(N(k));
  return removeAnnotsInRects(pdfDoc, node, rects);
}

/** Sostituisce un termine nei titoli dei segnalibri. → numero di titoli modificati */
export function redactOutlineTitles(pdfDoc, matcher, replacement = '████') {
  const ctx = pdfDoc.context;
  const outlines = lookupDict(ctx, pdfDoc.catalog.get(N('Outlines')));
  if (!outlines) return 0;
  let changed = 0; const seen = new Set();
  const walk = (ref, depth) => {
    let cur = ref; let guard = 0;
    while (cur && guard++ < 100000 && depth < 64) {
      const item = lookupDict(ctx, cur);
      if (!item || seen.has(item)) break;
      seen.add(item);
      const t = ctx.lookup(item.get(N('Title')));
      if (t instanceof PDFString || t instanceof PDFHexString) {
        const s = t.decodeText(); const r = matcher(s, replacement);
        if (r !== s) { item.set(N('Title'), PDFHexString.fromText(r)); changed++; }
      }
      if (item.get(N('First'))) walk(item.get(N('First')), depth + 1);
      cur = item.get(N('Next'));
    }
  };
  walk(outlines.get(N('First')), 0);
  return changed;
}

/** Toglie la struttura per l'accessibilità (può contenere testo alternativo con i dati oscurati). */
export function removeStructure(pdfDoc) {
  const had = !!pdfDoc.catalog.get(N('StructTreeRoot'));
  pdfDoc.catalog.delete(N('StructTreeRoot'));
  const mi = lookupDict(pdfDoc.context, pdfDoc.catalog.get(N('MarkInfo')));
  if (mi) mi.set(N('Marked'), pdfDoc.context.obj(false));
  return had;
}

/** Carattere per i livelli di testo invisibile. */
export async function embedTextFont(pdfDoc) { return pdfDoc.embedFont(StandardFonts.Helvetica); }

/** Elimina gli oggetti orfani (i vecchi contenuti) prima del salvataggio. */
export async function finalizeRedaction(pdfDoc) {
  await pdfDoc.flush();
  return removeUnreachable(pdfDoc);
}

export { rgb, intersects };
