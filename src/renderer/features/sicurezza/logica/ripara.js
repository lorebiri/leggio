// Ripara PDF: prova strategie in ordine di fedeltà.
//  1) pdf-lib: il suo lettore ignora la tabella xref e legge gli oggetti in sequenza (ricostruisce anche
//     il catalogo mancante): riscrivendo si ottiene un file pulito con struttura nuova. Fedeltà piena.
//  2) ricostruzione dalle pagine lette da pdf.js (tollerante): ogni pagina diventa un'immagine con il
//     testo invisibile (resta ricercabile). Fedeltà visiva, perde link e moduli. Richiede un rasterizzatore.
import { PDFDocument } from '@cantoo/pdf-lib';
import { removeUnreachable } from './pdfutil.js';
import { pageWords } from './testo.js';
import { invisibleTextOps, embedTextFont } from './redazione.js';

/** Conta le pagine leggibili con pdf.js. → { pages, ok, error } */
export async function probeWithPdfjs(pdfjs, bytes, opts = {}) {
  const task = pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false, stopAtErrors: false, ...opts });
  try {
    const d = await task.promise;
    let ok = 0;
    for (let i = 1; i <= d.numPages; i++) { try { const p = await d.getPage(i); await p.getOperatorList(); p.cleanup(); ok++; } catch { /* pagina danneggiata */ } }
    return { pages: d.numPages, ok, error: null };
  } catch (e) { return { pages: 0, ok: 0, error: e?.message || String(e) }; }
  finally { await task.destroy().catch(() => {}); }
}

/** Strategia 1: riscrittura con pdf-lib. → Uint8Array | null */
export async function rewriteWithPdfLib(bytes, password) {
  try {
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: !password && password !== '', password: password || undefined, updateMetadata: false, throwOnInvalidObject: false });
    if (doc.getPageCount() === 0) return null;
    removeUnreachable(doc);
    return await doc.save({ useObjectStreams: true });
  } catch { return null; }
}

/**
 * Strategia 2: ricostruzione da pdf.js. rasterize(pdf, pageIndex) → { bytes, kind, view } (browser).
 * → { bytes, pages, failed: [numeri pagina] }
 */
export async function rebuildFromPdfjs(pdfjs, bytes, rasterize, { signal, onProgress, getDocumentOptions = {} } = {}) {
  const task = pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false, stopAtErrors: false, ...getDocumentOptions });
  const src = await task.promise;
  try {
    const out = await PDFDocument.create();
    const font = await embedTextFont(out);
    const failed = [];
    for (let i = 0; i < src.numPages; i++) {
      if (signal?.aborted) throw new DOMException('Annullato', 'AbortError');
      onProgress?.((i + 1) / src.numPages, `Pagina ${i + 1} di ${src.numPages}`);
      try {
        const r = await rasterize(src, i);
        const p = await src.getPage(i + 1);
        const tc = await p.getTextContent().catch(() => ({ items: [] }));
        const [x1, y1, x2, y2] = r.view;
        const page = out.addPage([x2 - x1, y2 - y1]);
        page.setMediaBox(x1, y1, x2 - x1, y2 - y1);
        if (p.rotate) page.setRotation({ type: 'degrees', angle: p.rotate });
        const img = r.kind === 'png' ? await out.embedPng(r.bytes) : await out.embedJpg(r.bytes);
        const ctx = out.context;
        const ops = [`q ${x2 - x1} 0 0 ${y2 - y1} ${x1} ${y1} cm /Im0 Do Q`, invisibleTextOps(font, 'F0', pageWords(tc.items))];
        page.node.set(ctx.obj('Resources'), ctx.obj({ XObject: { Im0: img.ref }, Font: { F0: font.ref } }));
        page.node.set(ctx.obj('Contents'), ctx.register(ctx.flateStream(ops.join('\n'))));
        p.cleanup();
      } catch { failed.push(i + 1); out.addPage([595, 842]); }
    }
    return { bytes: await out.save({ useObjectStreams: true }), pages: src.numPages, failed };
  } finally { await task.destroy().catch(() => {}); }
}
