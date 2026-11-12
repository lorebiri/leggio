// Worker: analizza i .p7m senza bloccare l'interfaccia.
import { openP7m } from './cades.js';
import { compactResult } from './p7m-compact.js';

self.onmessage = async (e) => {
  try {
    const r = compactResult(await openP7m(e.data.bytes, { verify: true }));
    self.postMessage({ ok: true, result: r }, r.content ? [r.content.buffer] : []);
  } catch (err) {
    self.postMessage({ ok: false, error: err?.message || String(err) });
  }
};
