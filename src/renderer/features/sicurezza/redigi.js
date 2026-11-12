// Pipeline di oscuramento riutilizzabile (interfaccia e azioni guidate): ricerca con i modelli,
// applicazione vera, pulizia e verifica. Usa il browser (canvas) per il rendering delle pagine.
import { PDFJS_ASSETS } from '../../core/pdf.js';
import { PDFString, PDFHexString } from '@cantoo/pdf-lib';
import { findMatches } from './logica/modelli.js';
import { buildPageText, rangeRects, pageWords, wordsOutside } from './logica/testo.js';
import { redactPage, embedTextFont, finalizeRedaction, redactOutlineTitles, removeStructure } from './logica/redazione.js';
import { verifyRedaction } from './logica/verifica.js';
import { sanitize } from './logica/sanifica.js';
import { openDecrypted } from './logica/cifratura.js';
import { N, lookupDict } from './logica/pdfutil.js';
import { renderRedactedPage } from './codec.js';

const abort = (signal) => { if (signal?.aborted) throw new DOMException('Annullato', 'AbortError'); };

/**
 * Cerca con i cercatori in tutte le pagine. → { byPage: Map(i → rects), hits: [{ page, text, matcher }], textless: [indici] }
 */
export async function findInPdf(pdf, matchers, { signal, onProgress, OPS } = {}) {
  const byPage = new Map(); const hits = []; const textless = [];
  for (let i = 0; i < pdf.numPages; i++) {
    abort(signal);
    if (i % 10 === 0) onProgress?.(i / pdf.numPages, `Ricerca: pagina ${i + 1} di ${pdf.numPages}`);
    const page = await pdf.getPage(i + 1);
    const tc = await page.getTextContent();
    if (!tc.items.some((x) => x.str && x.str.trim())) {
      // pagina senza testo: conta come scansione solo se contiene immagini (le pagine bianche non contano)
      if (!OPS || await hasImages(page, OPS)) textless.push(i);
      page.cleanup();
      continue;
    }
    page.cleanup();
    const pt = buildPageText(tc.items, tc.styles);
    for (const hit of findMatches(pt.text, matchers)) {
      const rects = rangeRects(pt, hit.start, hit.end);
      if (!rects.length) continue;
      if (!byPage.has(i)) byPage.set(i, []);
      byPage.get(i).push(...rects);
      hits.push({ page: i, text: hit.text, matcher: hit.matcher });
    }
  }
  return { byPage, hits, textless };
}

export async function hasImages(page, OPS) {
  const ids = new Set(['paintImageXObject', 'paintInlineImageXObject', 'paintImageMaskXObject', 'paintImageXObjectRepeat', 'paintInlineImageXObjectGroup', 'paintImageMaskXObjectGroup', 'paintImageMaskXObjectRepeat', 'paintJpegXObject'].map((n) => OPS[n]).filter((x) => x != null));
  try { const ol = await page.getOperatorList(); return ol.fnArray.some((f) => ids.has(f)); } catch { return true; }
}

/**
 * Applica l'oscuramento. pdf: PDFDocumentProxy degli stessi byte. byPage: Map(i → rects PDF).
 * globalTerms: testi da cercare ovunque nella verifica. → risultato con { out, ver, … }
 */
export async function applyRedaction({ pdfjs, pdf, bytes, password, byPage, globalTerms = [], color = '#000000', label = '', doSanitize = true, signal, onProgress }) {
  const t0 = performance.now();
  const { doc: pdfDoc } = await openDecrypted(bytes, password ?? '');
  const font = await embedTextFont(pdfDoc);
  const pages = [...byPage.keys()].sort((a, b) => a - b);
  let removedWords = 0; let annots = 0; let fields = 0;
  for (let k = 0; k < pages.length; k++) {
    abort(signal);
    const i = pages[k]; const rects = byPage.get(i);
    onProgress?.(k / (pages.length + 2), `Pagina ${i + 1} (${k + 1} di ${pages.length})`);
    const page = await pdf.getPage(i + 1);
    const tc = await page.getTextContent();
    page.cleanup();
    const words = pageWords(tc.items, tc.styles);
    const keep = wordsOutside(words, rects);
    removedWords += words.length - keep.length;
    const img = await renderRedactedPage(pdfjs, pdf, i, rects, { color, label, dpi: pages.length > 60 ? 200 : 300, quality: 0.8, signal });
    const r = await redactPage(pdfDoc, i, { image: img, view: img.view, rects, keepWords: keep, font });
    annots += r.annots; fields += r.fields;
  }
  onProgress?.(pages.length / (pages.length + 2), 'Pulizia del documento…');
  const replace = (s, rep = '████') => { let o = s; for (const t of globalTerms) o = o.split(t).join(rep); return o; };
  const outlineChanged = globalTerms.length ? redactOutlineTitles(pdfDoc, replace) : 0;
  const info = lookupDict(pdfDoc.context, pdfDoc.context.trailerInfo.Info);
  if (info && globalTerms.length) for (const [key, val] of info.entries()) {
    const o = pdfDoc.context.lookup(val);
    if (o instanceof PDFString || o instanceof PDFHexString) { const s = o.decodeText(); const r = replace(s); if (r !== s) info.set(key, PDFHexString.fromText(r)); }
  }
  const structure = removeStructure(pdfDoc);
  const san = doSanitize ? sanitize(pdfDoc, {}) : null;
  if (!doSanitize && pdfDoc.catalog.get(N('Metadata')) && globalTerms.length) pdfDoc.catalog.delete(N('Metadata'));
  await finalizeRedaction(pdfDoc);
  const out = await pdfDoc.save({ useObjectStreams: true });
  onProgress?.((pages.length + 1) / (pages.length + 2), 'Verifica: controllo che i dati oscurati non siano più presenti…');
  const ver = await verifyRedaction(pdfjs, out, byPage, globalTerms, { signal, getDocumentOptions: PDFJS_ASSETS });
  return { out, ver, pages: pages.length, areas: [...byPage.values()].reduce((a, r) => a + r.length, 0), removedTexts: removedWords, annots, fields, outlineChanged, structure, san, ms: performance.now() - t0 };
}
