// Client dell'estrazione del testo in un Web Worker: un worker riusato per molte richieste, in coda.
import { estraiTesto } from './lib/estrai-testo.js';

/**
 * Crea un estrattore. → { estrai(bytes, opts) → Promise<risultato>, termina() }
 * In caso di problemi con il worker ripiega sull'estrazione nel thread principale (pdfjs passato).
 */
export function creaEstrattoreTesto({ pdfjs } = {}) {
  let worker = null; let rotto = false; let seq = 0;
  const attese = new Map();
  const base = new URL('./', document.baseURI).href;
  const avvia = () => {
    if (worker || rotto) return worker;
    try {
      worker = new Worker(new URL('./estrai-testo.worker.js', import.meta.url), { type: 'module' });
      worker.onmessage = (e) => {
        const a = attese.get(e.data.id); if (!a) return;
        attese.delete(e.data.id);
        if (e.data.ok) a.resolve(e.data.risultato);
        else { const err = new Error(e.data.message); err.codice = e.data.codice; a.reject(err); }
      };
      worker.onerror = (e) => {
        e.preventDefault?.(); rotto = true; worker?.terminate(); worker = null;
        for (const a of attese.values()) a.fallback();
        attese.clear();
      };
    } catch { rotto = true; worker = null; }
    return worker;
  };
  return {
    estrai(bytes, opts = {}) {
      const diretto = () => estraiTesto(pdfjs, bytes, opts);
      const w = avvia();
      if (!w) return diretto();
      return new Promise((resolve, reject) => {
        const id = ++seq;
        attese.set(id, { resolve, reject, fallback: () => diretto().then(resolve, reject) });
        const { signal, ...o } = opts;
        signal?.addEventListener('abort', () => { if (attese.delete(id)) reject(new DOMException('Annullato', 'AbortError')); }, { once: true });
        const copia = bytes.slice(); // il buffer viene trasferito
        w.postMessage({ id, bytes: copia, opts: o, base }, [copia.buffer]);
      });
    },
    termina() { worker?.terminate(); worker = null; for (const a of attese.values()) a.reject(new DOMException('Annullato', 'AbortError')); attese.clear(); },
  };
}
