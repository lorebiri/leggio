// Riparazione di PDF danneggiati (troncati, tabella xref o trailer mancanti) quando pdf.js
// non riesce ad aprirli: pdf-lib legge gli oggetti in sequenza e ricostruisce un file valido.
// Il risultato può essere incompleto (pagine o immagini mancanti): l'utente viene avvisato.
import { PDFDocument, PDFDict, PDFArray, PDFName, PDFNumber, PDFRef } from '@cantoo/pdf-lib';

/** → { bytes, pages } oppure null se non c'è nulla da recuperare. Non lancia mai. */
export async function repairPdf(bytes, { maxBytes = 512 * 1024 * 1024 } = {}) {
  if (!bytes?.length || bytes.length > maxBytes) return null;
  try {
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, throwOnInvalidObject: false, updateMetadata: false });
    if (doc.isEncrypted) return null;
    fixPageTree(doc);
    const pages = doc.getPageCount();
    if (!pages) return null;
    const out = await doc.save({ useObjectStreams: false });
    return { bytes: out, pages };
  } catch { return null; }
}

/**
 * In un file troncato l'albero delle pagine dichiara ancora il numero di pagine dell'originale (/Count)
 * e fra i /Kids restano riferimenti a oggetti persi: pdf.js crede che le pagine ci siano e fallisce
 * aprendole. Si tolgono i figli mancanti o non validi e si ricalcolano i /Count dal basso.
 */
function fixPageTree(doc) {
  const ctx = doc.context;
  const seen = new Set();
  const walk = (node) => {
    const kids = node.lookup(PDFName.of('Kids'));
    if (!(kids instanceof PDFArray)) return 0;
    let count = 0;
    const keep = [];
    for (let i = 0; i < kids.size(); i++) {
      const ref = kids.get(i);
      const kid = ref instanceof PDFRef ? ctx.lookup(ref) : ref;
      if (!(kid instanceof PDFDict) || (ref instanceof PDFRef && seen.has(ref.tag))) continue;
      if (ref instanceof PDFRef) seen.add(ref.tag);
      const type = kid.lookup(PDFName.of('Type'));
      if (type === PDFName.of('Pages') || (!type && kid.has(PDFName.of('Kids')))) {
        const n = walk(kid);
        if (!n) continue;
        count += n;
      } else count += 1;
      keep.push(ref);
    }
    node.set(PDFName.of('Kids'), ctx.obj(keep));
    node.set(PDFName.of('Count'), PDFNumber.of(count));
    return count;
  };
  const root = doc.catalog.lookup(PDFName.of('Pages'));
  if (root instanceof PDFDict) walk(root);
}
