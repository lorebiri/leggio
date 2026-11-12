// Accesso centralizzato alle librerie PDF: pdf.js (rendering, testo) e pdf-lib (modifica).
import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import * as PDFLib from '@cantoo/pdf-lib';
import fontkit from '@pdf-lib/fontkit';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
export { pdfjs, PDFLib, fontkit };

// risorse di pdf.js copiate da vite (vedi vite.config.js)
const base = new URL('./', document.baseURI).href;
export const PDFJS_ASSETS = {
  cMapUrl: base + 'pdfjs/cmaps/',
  cMapPacked: true,
  standardFontDataUrl: base + 'pdfjs/standard_fonts/',
  wasmUrl: base + 'pdfjs/wasm/',
  iccUrl: base + 'pdfjs/iccs/',
};

/** Opzioni di sicurezza comuni: niente eval, niente scripting, niente rete. */
export const PDFJS_SAFE = { isEvalSupported: false, enableXfa: true, stopAtErrors: false };

/**
 * Apre i byte con pdf.js. onPassword(reason) → Promise<string|null> (reason 1 = richiesta, 2 = errata).
 * opts.onProgress({loaded,total}), opts.signal (AbortSignal) per annullare.
 * pdf.js trasferisce il buffer al worker (lo "stacca"): gli si passa sempre una copia, così
 * i byte del documento restano utilizzabili.
 */
export async function openPdfJs(bytes, { password, onPassword, onProgress, signal } = {}) {
  if (signal?.aborted) throw abortError();
  const task = pdfjs.getDocument({ data: bytes.slice(), password, ...PDFJS_ASSETS, ...PDFJS_SAFE });
  let usedPassword = password;
  let cancelled = false;
  let rejectCancel;
  const cancelP = new Promise((_, rej) => { rejectCancel = rej; });
  cancelP.catch(() => {});
  const cancel = (err) => { if (cancelled) return; cancelled = true; rejectCancel(err); Promise.resolve(task.destroy()).catch(() => {}); };
  const onAbort = () => cancel(abortError());
  signal?.addEventListener('abort', onAbort, { once: true });
  if (onProgress) task.onProgress = (p) => { try { onProgress(p); } catch { /* solo interfaccia */ } };
  task.onPassword = async (update, reason) => {
    if (!onPassword) { const e = new Error(reason === 2 ? 'Password errata' : 'Il documento richiede una password'); e.name = 'PasswordException'; cancel(e); return; }
    let pw = null;
    try { pw = await onPassword(reason); } catch { pw = null; }
    if (pw == null) { const e = new Error('Password non inserita'); e.name = 'PasswordException'; cancel(e); return; }
    usedPassword = pw;
    update(pw);
  };
  try {
    const pdf = await Promise.race([task.promise, cancelP]);
    ensureDestroy(pdf);
    return { pdf, password: usedPassword };
  } catch (err) {
    if (!cancelled) Promise.resolve(task.destroy()).catch(() => {});
    throw err;
  } finally {
    signal?.removeEventListener('abort', onAbort);
  }
}

/**
 * pdf.js 6 non ha più PDFDocumentProxy.destroy(): si libera la memoria (worker compreso) con
 * loadingTask.destroy(). Il nucleo e le aree chiamano pdf.destroy(): lo si ripristina qui,
 * altrimenti ogni riapertura lascerebbe il documento precedente in memoria.
 */
export function ensureDestroy(pdf) {
  const proto = pdf && Object.getPrototypeOf(pdf);
  if (proto && typeof proto.destroy !== 'function') {
    Object.defineProperty(proto, 'destroy', { configurable: true, writable: true, value() { return this.loadingTask?.destroy(); } });
  }
  return pdf;
}

/** Libera un documento pdf.js (worker compreso). Sicura con null e su documenti già liberati. */
export function destroyPdf(pdf) {
  if (!pdf) return;
  try { Promise.resolve(pdf.loadingTask?.destroy()).catch(() => {}); } catch { /* già distrutto */ }
}

function abortError() { const e = new Error('Apertura annullata'); e.name = 'AbortError'; return e; }

/** Verifica che i byte siano un PDF leggibile (apertura + prima pagina). Lancia un errore se no. */
export async function verifyPdfBytes(bytes, password) {
  const { pdf } = await openPdfJs(bytes, { password });
  try {
    if (!pdf.numPages) throw new Error('Il file non contiene pagine');
    const page = await pdf.getPage(1);
    page.cleanup();
    return pdf.numPages;
  } finally { destroyPdf(pdf); }
}

export { openPdfLib } from './pdflib.js';

/** Salva un PDFDocument di pdf-lib con impostazioni compatte. */
export async function savePdfLib(doc, opts = {}) {
  return doc.save({ useObjectStreams: true, objectsPerTick: 1500, ...opts });
}

/** Byte di un nuovo PDF vuoto. */
export async function newPdfLib() { const d = await PDFLib.PDFDocument.create(); d.registerFontkit(fontkit); return d; }

/** Rende una pagina pdf.js su canvas alla scala indicata. → HTMLCanvasElement */
export async function renderPageToCanvas(pdf, pageIndex, scale = 1, { annotationMode = pdfjs.AnnotationMode.ENABLE, background } = {}) {
  const page = await pdf.getPage(pageIndex + 1);
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
  const ctx = canvas.getContext('2d');
  if (background) { ctx.fillStyle = background; ctx.fillRect(0, 0, canvas.width, canvas.height); }
  await page.render({ canvasContext: ctx, canvas, viewport, annotationMode, background }).promise;
  page.cleanup();
  return canvas;
}

export function canvasToBytes(canvas, type = 'image/png', quality = 0.92) {
  return new Promise((res) => canvas.toBlob(async (b) => res(new Uint8Array(await b.arrayBuffer())), type, quality));
}
