// Preparazione comune dei test. Su Windows pdf.js (versione legacy per Node) non trova il proprio
// worker se riceve un percorso «D:\...»: gli si passa un URL file:// valido.
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
try {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs')).href;
} catch { /* pdf.js non necessario a questo file di test */ }
