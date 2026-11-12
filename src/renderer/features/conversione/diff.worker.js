// Web Worker: confronto a parole fuori dal thread dell'interfaccia.
import { confrontaParole } from './lib/diff.js';

self.onmessage = (e) => {
  const { id, a, b, opts } = e.data || {};
  try {
    const r = confrontaParole(a.map((text) => ({ text })), b.map((text) => ({ text })), opts || {});
    self.postMessage({ id, ok: true, modifiche: r.modifiche, stats: r.stats });
  } catch (err) {
    self.postMessage({ id, ok: false, error: String(err?.message || err) });
  }
};
