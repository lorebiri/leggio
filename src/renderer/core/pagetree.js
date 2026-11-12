// Riordino delle pagine con pdf-lib ricostruendo un albero Pages piatto (logica pura, testata in Node).
// removePage/insertPage di pdf-lib su tutte le pagine produce «corrupt page tree»; qui si spostano gli
// stessi oggetti pagina (annotazioni, campi modulo e link restano validi) e si eliminano i nodi intermedi.
// Derivato da features/pagine/logica/struttura.js (impostaOrdine), limitato al riordino.
import { PDFName, PDFArray, PDFDict, PDFRef, PDFNumber, PDFPageLeaf } from '@cantoo/pdf-lib';

const N = (s) => PDFName.of(s);
const EREDITABILI = ['Resources', 'MediaBox', 'CropBox', 'Rotate'];

function materializzaEreditati(page) {
  const leaf = page.node;
  for (const k of EREDITABILI) {
    if (leaf.get(N(k)) !== undefined) continue;
    const v = leaf.getInheritableAttribute(N(k));
    if (v !== undefined) leaf.set(N(k), v);
  }
  if (!leaf.get(N('MediaBox'))) leaf.set(N('MediaBox'), leaf.context.obj([0, 0, 595.28, 841.89]));
}

/** order: permutazione degli indici 0-based delle pagine attuali. */
export function reorderPdfPages(doc, order) {
  const pages = doc.getPages();
  const n = pages.length;
  if (!Array.isArray(order) || order.length !== n || new Set(order).size !== n || order.some((i) => !Number.isInteger(i) || i < 0 || i >= n)) {
    throw new Error(`Ordine delle pagine non valido (servono tutte le ${n} pagine, ciascuna una volta).`);
  }
  const ctx = doc.context;
  for (const p of pages) materializzaEreditati(p);
  const rootRef = doc.catalog.get(N('Pages'));
  const root = doc.catalog.Pages();
  const intermedi = [];
  const visita = (node, depth = 0) => {
    const kids = node.lookup(N('Kids'));
    if (!(kids instanceof PDFArray) || depth > 512) return;
    for (let i = 0; i < kids.size(); i++) {
      const ref = kids.get(i); const kid = ctx.lookup(ref);
      if (kid instanceof PDFDict && !(kid instanceof PDFPageLeaf) && kid.get(N('Kids'))) { intermedi.push(ref); visita(kid, depth + 1); }
    }
  };
  visita(root);
  const sorted = order.map((i) => pages[i]);
  root.set(N('Kids'), ctx.obj(sorted.map((p) => p.ref)));
  root.set(N('Count'), PDFNumber.of(n));
  for (const k of EREDITABILI) root.delete(N(k));
  for (const p of sorted) p.node.setParent(rootRef);
  for (const ref of intermedi) if (ref instanceof PDFRef && ref !== rootRef) ctx.delete(ref);
  doc.pageCache.invalidate();
  doc.pageCount = n;
  return doc.getPages();
}
