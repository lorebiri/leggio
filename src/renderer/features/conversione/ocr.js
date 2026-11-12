// OCR completamente offline con tesseract.js: motore, lingue e worker caricati dalle risorse locali
// e passati a Tesseract come URL blob (funziona anche da file:// nell'app Electron).
import { createWorker } from 'tesseract.js';
import { pdfjs, fontkit } from '../../core/pdf.js';
import workerScriptUrl from 'tesseract.js/dist/worker.min.js?url';
import coreScriptUrl from 'tesseract.js-core/tesseract-core-simd-lstm.wasm.js?url';
import { caricaRisorsa, blobRisorsa } from './lib/risorse.js';
import { righeDaRisultato, disponiParole, invertiMatrice, caratteriTesto, bmpGrigio, stimaTempo } from './lib/ocr-layout.js';

export const LINGUE_OCR = [
  { value: 'ita', label: 'Italiano' },
  { value: 'eng', label: 'Inglese' },
  { value: 'fra', label: 'Francese' },
  { value: 'deu', label: 'Tedesco' },
  { value: 'spa', label: 'Spagnolo' },
];

const FAKE_LANG_BASE = 'https://leggio.invalid/ocr-lang';
let workerBlobPromise = null;

/** Costruisce lo script del worker: mappa le richieste delle lingue su URL blob locali, poi il codice di tesseract. */
async function workerBlobUrl(langs) {
  const map = {};
  for (const l of langs) map[`${FAKE_LANG_BASE}/${l}.traineddata.gz`] = await blobRisorsa(`./assets-extra/ocr/lang/${l}.traineddata.gz`);
  const code = new TextDecoder().decode(await (workerBlobPromise ||= caricaRisorsa(workerScriptUrl)));
  const prelude = `self.__leggioMap=${JSON.stringify(map)};(function(){const f=self.fetch.bind(self);self.fetch=function(u,o){const k=typeof u==='string'?u:(u&&u.url)||String(u);return f(self.__leggioMap[k]||u,o);};})();\n`;
  return URL.createObjectURL(new Blob([prelude, code], { type: 'application/javascript' }));
}

/** Crea un worker Tesseract pronto per le lingue indicate (es. ['ita','eng']). */
export async function creaWorkerOcr(langs, { onLog } = {}) {
  const wurl = await workerBlobUrl(langs);
  const core = await blobRisorsa(coreScriptUrl, 'application/javascript');
  try {
    return await createWorker(langs, 1, {
      workerPath: wurl, workerBlobURL: false,
      corePath: core + '#tesseract-core.wasm.js', // il suffisso .js evita che tesseract cerchi una cartella
      langPath: FAKE_LANG_BASE, cacheMethod: 'none', gzip: true,
      logger: onLog || (() => {}),
      errorHandler: (e) => console.warn('[ocr]', e),
    });
  } finally { URL.revokeObjectURL(wurl); }
}

/** Pagine senza testo (scansioni): controlla le prime `max` pagine. → { scansione, pagineSenzaTesto, controllate } */
export async function rilevaScansione(pdf, { max = 5 } = {}) {
  const n = Math.min(pdf.numPages, max);
  let senza = 0; let conImmagini = 0;
  for (let i = 1; i <= n; i++) {
    const page = await pdf.getPage(i);
    try {
      const tc = await page.getTextContent();
      if (caratteriTesto(tc) < 20) {
        senza++;
        const ops = await page.getOperatorList();
        const OPS = pdfjs.OPS;
        if (ops.fnArray.some((f) => f === OPS.paintImageXObject || f === OPS.paintInlineImageXObject || f === OPS.paintImageXObjectRepeat)) conImmagini++;
      }
    } finally { page.cleanup(); }
  }
  return { scansione: n > 0 && senza === n && conImmagini > 0, pagineSenzaTesto: senza, controllate: n };
}

/**
 * Riconosce il testo delle pagine e restituisce i risultati da applicare (non tocca il documento).
 * opts: { pdf, pages (indici 0-based), langs, skipText=true, deskew=false, dpi=300, progress:{set,signal},
 *         renderPage(pdf, i, scale) → canvas, workers }
 * → { pagine: [{ index, parole, viewportTransform, size:[w,h], rotateRadians, immagine? }], saltate, ms }
 */
export async function riconosciPagine(opts) {
  const { pdf, langs = ['ita', 'eng'], skipText = true, deskew = false, dpi = 300, progress, renderPage, fontWidth } = opts;
  const signal = progress?.signal;
  const pages = opts.pages || [...Array(pdf.numPages).keys()];
  const results = [];
  const saltate = [];
  const t0 = performance.now();
  const check = () => { if (signal?.aborted) throw new DOMException('Annullato', 'AbortError'); };
  const nWorkers = Math.max(1, Math.min(opts.workers || Math.min(3, Math.max(1, Math.floor((navigator.hardwareConcurrency || 2) / 2))), pages.length));
  progress?.set(0, 'Preparo il motore di riconoscimento (offline)…');
  const workers = [];
  const onAbort = () => { for (const w of workers) w.terminate().catch(() => {}); };
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    for (let k = 0; k < nWorkers; k++) { check(); workers.push(await creaWorkerOcr(langs)); }
    check();
    let next = 0; let fatte = 0;
    const totale = pages.length;
    const lavora = async (worker) => {
      while (next < pages.length) {
        check();
        const index = pages[next++];
        const page = await pdf.getPage(index + 1);
        try {
          if (skipText) {
            const tc = await page.getTextContent();
            if (caratteriTesto(tc) >= 20) { saltate.push(index); continue; }
          }
          const base = page.getViewport({ scale: 1 });
          // risoluzione: dpi scelti, con tetto per non esaurire la memoria su pagine enormi
          let scale = dpi / 72;
          const maxSide = 5000; const maxPixels = 24e6;
          scale = Math.min(scale, maxSide / Math.max(base.width, base.height), Math.sqrt(maxPixels / (base.width * base.height)));
          const vp = page.getViewport({ scale });
          let canvas = await renderPage(pdf, index, scale);
          check();
          const ctx = canvas.getContext('2d', { willReadFrequently: true });
          const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const w = canvas.width; const h = canvas.height;
          canvas.width = 0; canvas.height = 0; canvas = null; // libera subito la memoria del canvas
          const bmp = new Blob([bmpGrigio(img.data, w, h)], { type: 'image/bmp' });
          const r = await worker.recognize(bmp, { rotateAuto: !!deskew }, { blocks: true, text: false, imageColor: !!deskew });
          check();
          const rot = r.data.rotateRadians || 0;
          const entry = { index, viewportTransform: vp.transform, pxSize: [w, h], ptSize: [base.width, base.height], rotateRadians: rot, scale };
          if (deskew && Math.abs(rot) > 0.003 && r.data.imageColor) {
            entry.immagine = r.data.imageColor; // PNG base64 dell'immagine raddrizzata (stesse coordinate delle parole)
          }
          const lines = righeDaRisultato(r.data);
          let imgToPdf;
          if (entry.immagine) imgToPdf = [base.width / w, 0, 0, -base.height / h, 0, base.height]; // pagina rifatta, senza rotazione
          else imgToPdf = invertiMatrice(vp.transform);
          entry.parole = disponiParole(lines, imgToPdf, fontWidth);
          entry.confidenza = lines.length ? lines.flatMap((l) => l.words).reduce((s, x) => s + (x.confidence || 0), 0) / Math.max(1, lines.flatMap((l) => l.words).length) : 0;
          results.push(entry);
        } finally {
          page.cleanup();
          fatte++;
          const eta = stimaTempo(performance.now() - t0, fatte, totale);
          progress?.set(fatte / totale, `Pagina ${fatte} di ${totale}${eta ? ' · ' + eta : ''}`);
        }
      }
    };
    await Promise.all(workers.map(lavora));
    check();
  } finally {
    signal?.removeEventListener('abort', onAbort);
    await Promise.all(workers.map((w) => w.terminate().catch(() => {})));
  }
  results.sort((a, b) => a.index - b.index);
  return { pagine: results, saltate: saltate.sort((a, b) => a - b), ms: performance.now() - t0 };
}

function base64ToBytes(b64) {
  const s = atob(b64.replace(/^data:[^,]+,/, ''));
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/**
 * Scrive nel PDF (pdf-lib) il livello di testo invisibile.
 * font: PDFFont incorporato. Le pagine raddrizzate vengono sostituite dall'immagine raddrizzata.
 */
export async function applicaTestoOcr(pdfDoc, PDFLib, font, risultati) {
  const { PDFName, pushGraphicsState, popGraphicsState, beginText, endText, setFontAndSize, setTextRenderingMode, TextRenderingMode, setCharacterSqueeze, setTextMatrix, showText } = PDFLib;
  const pages = pdfDoc.getPages();
  for (const r of risultati) {
    const page = pages[r.index];
    if (!page) continue;
    if (r.immagine) {
      // pagina storta: sostituita dall'immagine raddrizzata, in JPEG se possibile
      const bytes = base64ToBytes(r.immagine);
      const img = bytes[0] === 0x89 ? await pdfDoc.embedPng(bytes) : await pdfDoc.embedJpg(bytes);
      const [w, h] = r.ptSize;
      page.node.set(PDFName.of('Contents'), pdfDoc.context.obj([]));
      page.node.set(PDFName.of('Resources'), pdfDoc.context.obj({}));
      page.node.delete(PDFName.of('Rotate'));
      for (const k of ['CropBox', 'BleedBox', 'TrimBox', 'ArtBox']) page.node.delete(PDFName.of(k));
      page.node.set(PDFName.of('MediaBox'), pdfDoc.context.obj([0, 0, w, h]));
      page.drawImage(img, { x: 0, y: 0, width: w, height: h });
    }
    if (!r.parole?.length) continue;
    const fontKey = page.node.newFontDictionary(font.name, font.ref);
    const ops = [pushGraphicsState(), beginText(), setTextRenderingMode(TextRenderingMode.Invisible)];
    for (const w of r.parole) {
      ops.push(setFontAndSize(fontKey, w.size), setCharacterSqueeze(w.tz), setTextMatrix(...w.tm), showText(font.encodeText(w.text)));
    }
    ops.push(endText(), popGraphicsState());
    page.pushOperators(...ops);
  }
}

// ---- font per il livello di testo ----
let fontBytesPromise = null;
/** Byte di Liberation Sans (copiata da pdf.js in pdfjs/standard_fonts). */
export function fontOcrBytes() {
  return (fontBytesPromise ||= caricaRisorsa('./pdfjs/standard_fonts/LiberationSans-Regular.ttf').catch((e) => { fontBytesPromise = null; throw e; }));
}

let fkPromise = null;
/** Misuratore di larghezza del testo con Liberation Sans (per comprimere ogni parola nel suo riquadro). */
export async function misuratoreFont() {
  return (fkPromise ||= (async () => {
    try {
      const f = fontkit.create(await fontOcrBytes());
      const upm = f.unitsPerEm;
      const cache = new Map();
      return (text, size) => {
        let w = cache.get(text);
        if (w == null) { w = f.layout(text).advanceWidth / upm; cache.set(text, w); if (cache.size > 20000) cache.clear(); }
        return w * size;
      };
    } catch {
      return (text, size) => text.length * size * 0.5;
    }
  })());
}

export { caratteriTesto };
