// File allegati (EmbeddedFiles e annotazioni «allegato»): elenco, lettura, aggiunta, rimozione. Logica pura.
import { PDFStream, PDFRef } from '@cantoo/pdf-lib';
import { N, lookupDict, lookupArray, nameOf, textOf, num, nameTreeEntries, writeFlatNameTree, streamBytes } from './pdfutil.js';

function fileSpecInfo(ctx, specRef) {
  const spec = lookupDict(ctx, specRef);
  if (!spec) return null;
  const ef = lookupDict(ctx, spec.get(N('EF')));
  const streamRef = ef && (ef.get(N('UF')) || ef.get(N('F')));
  const stream = streamRef && ctx.lookup(streamRef);
  const params = stream instanceof PDFStream ? lookupDict(ctx, stream.dict.get(N('Params'))) : null;
  const fileName = textOf(ctx, spec.get(N('UF'))) || textOf(ctx, spec.get(N('F'))) || '';
  return {
    fileName, description: textOf(ctx, spec.get(N('Desc'))) || '',
    size: params ? num(ctx, params.get(N('Size')), 0) : 0,
    mime: stream instanceof PDFStream ? (nameOf(ctx, stream.dict.get(N('Subtype'))) || '').replace(/#2F/g, '/') : '',
    stream: stream instanceof PDFStream ? stream : null,
  };
}

/** Elenco degli allegati. → [{ key, name, fileName, description, size, mime, kind: 'documento'|'commento', page? }] */
export function listAttachments(pdfDoc) {
  const ctx = pdfDoc.context; const out = [];
  const names = lookupDict(ctx, pdfDoc.catalog.get(N('Names')));
  if (names) {
    for (const e of nameTreeEntries(ctx, names.get(N('EmbeddedFiles')))) {
      const info = fileSpecInfo(ctx, e.value);
      if (info) out.push({ key: 'doc:' + e.name, name: e.name, ...info, fileName: info.fileName || e.name, kind: 'documento' });
    }
  }
  pdfDoc.getPages().forEach((p, i) => {
    const annots = lookupArray(ctx, p.node.get(N('Annots')));
    for (const ref of annots?.asArray() || []) {
      const a = lookupDict(ctx, ref);
      if (!a || nameOf(ctx, a.get(N('Subtype'))) !== 'FileAttachment') continue;
      const info = fileSpecInfo(ctx, a.get(N('FS')));
      if (info) out.push({ key: `ann:${i}:${ref instanceof PDFRef ? ref.tag : out.length}`, name: info.fileName, ...info, kind: 'commento', page: i + 1 });
    }
  });
  for (const x of out) { if (!x.size && x.stream) { const b = streamBytes(x.stream); x.size = b ? b.length : 0; } }
  return out;
}

/** Byte di un allegato (decompressi). null se illeggibile. */
export function readAttachment(pdfDoc, key) {
  const a = listAttachments(pdfDoc).find((x) => x.key === key);
  return a?.stream ? streamBytes(a.stream) : null;
}

/** Aggiunge un allegato al documento. */
export async function addAttachment(pdfDoc, bytes, fileName, { description = '', mimeType } = {}) {
  // pdf-lib scrive gli allegati nuovi solo al salvataggio: teniamo conto anche di quelli appena aggiunti
  const pending = pdfDoc.__leggioAllegati || (pdfDoc.__leggioAllegati = new Set());
  const existing = new Set([...listAttachments(pdfDoc).filter((x) => x.kind === 'documento').map((x) => x.name), ...pending]);
  let name = fileName; let k = 2;
  while (existing.has(name)) { const m = fileName.match(/^(.*?)(\.[^.]*)?$/); name = `${m[1]} (${k++})${m[2] || ''}`; }
  pending.add(name);
  await pdfDoc.attach(bytes, name, { mimeType: mimeType || guessMime(name), description, creationDate: new Date(), modificationDate: new Date() });
  return name;
}

/** Toglie un allegato (dal documento o l'annotazione). → true se tolto */
export function removeAttachment(pdfDoc, key) {
  const ctx = pdfDoc.context;
  if (key.startsWith('doc:')) {
    const name = key.slice(4);
    const names = lookupDict(ctx, pdfDoc.catalog.get(N('Names')));
    if (!names) return false;
    const entries = nameTreeEntries(ctx, names.get(N('EmbeddedFiles')));
    const keep = entries.filter((e) => e.name !== name);
    if (keep.length === entries.length) return false;
    if (keep.length) names.set(N('EmbeddedFiles'), writeFlatNameTree(pdfDoc, keep)); else names.delete(N('EmbeddedFiles'));
    return true;
  }
  const [, pi, tag] = key.split(':');
  const page = pdfDoc.getPage(Number(pi));
  const annots = lookupArray(ctx, page.node.get(N('Annots')));
  if (!annots) return false;
  const keep = annots.asArray().filter((r) => !(r instanceof PDFRef && r.tag === tag));
  page.node.set(N('Annots'), ctx.obj(keep));
  return keep.length !== annots.size();
}

export function guessMime(name) {
  const ext = (name.split('.').pop() || '').toLowerCase();
  return ({ pdf: 'application/pdf', xml: 'application/xml', p7m: 'application/pkcs7-mime', txt: 'text/plain', csv: 'text/csv', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', odt: 'application/vnd.oasis.opendocument.text', zip: 'application/zip' })[ext] || 'application/octet-stream';
}
