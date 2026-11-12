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

/** Apre i byte con pdf.js. onPassword(reason) → Promise<string|null> (reason 1 = richiesta, 2 = errata). */
export async function openPdfJs(bytes, { password, onPassword } = {}) {
  const task = pdfjs.getDocument({ data: bytes.slice(), password, ...PDFJS_ASSETS, enableXfa: true, isEvalSupported: false });
  let usedPassword = password;
  if (onPassword) {
    task.onPassword = async (update, reason) => {
      const pw = await onPassword(reason);
      if (pw == null) { task.destroy(); return; }
      usedPassword = pw;
      update(pw);
    };
  }
  const pdf = await task.promise;
  return { pdf, password: usedPassword };
}

/** Apre i byte con pdf-lib (versione @cantoo con supporto cifratura). */
export async function openPdfLib(bytes, password) {
  const doc = await PDFLib.PDFDocument.load(bytes, { password: password || undefined, ignoreEncryption: !password, updateMetadata: false });
  doc.registerFontkit(fontkit);
  return doc;
}

/** Salva un PDFDocument di pdf-lib con impostazioni compatte. */
export async function savePdfLib(doc, opts = {}) {
  return doc.save({ useObjectStreams: true, ...opts });
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
