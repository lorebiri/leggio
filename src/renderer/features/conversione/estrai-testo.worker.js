// Web Worker per l'estrazione del testo (vedi lib/estrai-testo.js e docs/aree/conversione.md).
// pdf.js gira dentro questo stesso worker (worker "finto" in-thread): niente worker annidati.
// Messaggi: { id, bytes: Uint8Array, opts } → { id, ok: true, risultato } | { id, ok: false, codice, message }
import * as pdfjs from 'pdfjs-dist';
import { estraiTesto } from './lib/estrai-testo.js';

let pronto = null;
function prepara(base) {
  return (pronto ||= (async () => {
    // il codice del worker di pdf.js caricato qui: pdf.js lo usa direttamente senza crearne un altro
    globalThis.pdfjsWorker = await import('pdfjs-dist/build/pdf.worker.min.mjs');
    return base ? { cMapUrl: base + 'pdfjs/cmaps/', cMapPacked: true, standardFontDataUrl: base + 'pdfjs/standard_fonts/' } : {};
  })());
}

self.onmessage = async (e) => {
  const { id, bytes, opts = {}, base } = e.data || {};
  try {
    const assets = await prepara(base);
    const risultato = await estraiTesto(pdfjs, bytes, { ...opts, assets });
    self.postMessage({ id, ok: true, risultato });
  } catch (err) {
    self.postMessage({ id, ok: false, codice: err?.codice || 'errore', message: String(err?.message || err) });
  }
};
