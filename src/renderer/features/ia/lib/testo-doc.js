// Assistente IA: testo del documento aperto, pagina per pagina (stessa estrazione dell'archivio e della conversione).
import { testoDaContenuto } from '../../conversione/lib/estrai-testo.js';

const cache = new WeakMap(); // PDFDocumentProxy → Promise<[{n, testo}]>

/** Pagine con il testo del documento (pdf: PDFDocumentProxy). signal per interrompere. */
export function pagineDelDocumento(pdf, { signal } = {}) {
  if (!pdf) return Promise.resolve([]);
  if (cache.has(pdf)) return cache.get(pdf);
  const p = (async () => {
    const out = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      if (signal?.aborted) throw new DOMException('Interrotto', 'AbortError');
      let testo = '';
      try { const page = await pdf.getPage(i); testo = testoDaContenuto(await page.getTextContent()); } catch { testo = ''; }
      out.push({ n: i, testo });
      if (i % 10 === 0) await new Promise((r) => setTimeout(r, 0)); // lascia respirare l'interfaccia
    }
    return out;
  })();
  cache.set(pdf, p);
  p.catch(() => cache.delete(pdf));
  return p;
}

/** Il documento ha testo? (le scansioni senza OCR no) */
export const haTesto = (pagine) => pagine.reduce((s, p) => s + p.testo.replace(/\s/g, '').length, 0) >= 40;
