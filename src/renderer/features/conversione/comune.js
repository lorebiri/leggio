// Utilità condivise dell'area «conversione» (lato browser).
import { normalizzaItems, ricostruisciPagina, costruisciSegmenti, corpoTesto } from './lib/testo.js';

export const sleep = (ms = 0) => new Promise((r) => setTimeout(r, ms));
export const nomeBase = (name) => (name || 'documento').replace(/\.pdf$/i, '');
export const abortIf = (signal) => { if (signal?.aborted) throw new DOMException('Annullato', 'AbortError'); };

/** Font usati nella pagina (nome reale, grassetto, corsivo) dopo aver caricato la lista delle operazioni. */
async function fontsPagina(page, items, withFonts) {
  const fonts = {};
  if (!withFonts) return fonts;
  try {
    await page.getOperatorList();
    for (const it of items) {
      const k = it.fontName;
      if (!k || fonts[k]) continue;
      try {
        if (page.commonObjs.has(k)) {
          const f = page.commonObjs.get(k);
          fonts[k] = { name: f?.name || f?.loadedName || '', bold: !!f?.bold, italic: !!f?.italic };
        }
      } catch { /* font non ancora risolto */ }
    }
  } catch { /* pagina con contenuto danneggiato: si prosegue senza stili */ }
  return fonts;
}

/**
 * Testo di una pagina come frammenti normalizzati (vedi lib/testo.js).
 * → { frags, width, height, chars }
 */
export async function testoPagina(pdf, index, { withFonts = true } = {}) {
  const page = await pdf.getPage(index + 1);
  try {
    const vp = page.getViewport({ scale: 1 });
    const tc = await page.getTextContent();
    const fonts = await fontsPagina(page, tc.items, withFonts);
    const frags = normalizzaItems(tc.items, vp.transform, fonts);
    const chars = frags.reduce((n, f) => n + f.str.replace(/\s/g, '').length, 0);
    return { frags, width: vp.width, height: vp.height, chars };
  } finally { page.cleanup(); }
}

/** Corpo del testo dell'intero documento (campione fino a 30 pagine). */
export async function corpoDocumento(pdf, pages, signal) {
  const sample = pages.length > 30 ? pages.filter((_, i) => i % Math.ceil(pages.length / 30) === 0) : pages;
  const segs = [];
  for (const i of sample) {
    abortIf(signal);
    const { frags } = await testoPagina(pdf, i, { withFonts: false });
    segs.push(...costruisciSegmenti(frags));
  }
  return segs.length ? corpoTesto(segs) : 10;
}

/** Blocchi strutturati di una pagina. */
export async function blocchiPagina(pdf, index, bodySize, opts = {}) {
  const t = await testoPagina(pdf, index, opts);
  return { ...t, blocks: ricostruisciPagina(t.frags, { width: t.width, height: t.height, bodySize, detectTables: opts.detectTables }) };
}

export function canvasBlob(canvas, type = 'image/png', quality = 0.9) {
  return new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('Immagine non generata (pagina troppo grande?)'))), type, quality));
}
export async function canvasBytes(canvas, type, quality) {
  return new Uint8Array(await (await canvasBlob(canvas, type, quality)).arrayBuffer());
}

/** Rilascia la memoria di un canvas. */
export function liberaCanvas(c) { if (c) { c.width = 0; c.height = 0; } }

export function messaggioErrore(err) {
  const m = String(err?.message || err || '');
  if (/password|encrypt/i.test(m)) return 'Il documento è protetto: rimuovi prima la protezione (Proteggi → Rimuovi protezione).';
  if (/Invalid PDF|corrupt|bad XRef|FormatError|Unexpected/i.test(m)) return 'Il file PDF sembra danneggiato. Prova a ripararlo o a riaprirlo.';
  return m || 'Errore sconosciuto';
}

/**
 * Rende una pagina su canvas per elaborazioni (OCR, esportazioni).
 * Usa l'intento "print": niente requestAnimationFrame, quindi funziona anche a finestra ridotta a icona,
 * e include i valori dei moduli compilati. → HTMLCanvasElement (da liberare con liberaCanvas)
 */
export async function renderPagina(pdf, index, scale, { background = '#ffffff', pdfjs } = {}) {
  const page = await pdf.getPage(index + 1);
  try {
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.ceil(viewport.width)); canvas.height = Math.max(1, Math.ceil(viewport.height));
    const ctx = canvas.getContext('2d', { willReadFrequently: false });
    if (background) { ctx.fillStyle = background; ctx.fillRect(0, 0, canvas.width, canvas.height); }
    await page.render({ canvasContext: ctx, canvas, viewport, intent: 'print', annotationMode: pdfjs ? pdfjs.AnnotationMode.ENABLE_STORAGE : 3, background }).promise;
    return canvas;
  } finally { page.cleanup(); }
}
