// Misure del banco di prova in Node (senza interfaccia): apertura pdf.js, prima pagina,
// segnalibri, apertura+salvataggio pdf-lib, memoria. Le misure nel browser/app (rendering,
// scorrimento, miniature) sono descritte in docs/ROBUSTEZZA.md.
// Uso: node test/stress/misura.mjs [cartella]
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { PDFDocument } from '@cantoo/pdf-lib';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
pdfjs.GlobalWorkerOptions.workerSrc = require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs');

const dir = resolve(process.argv[2] || process.env.LEGGIO_STRESS_DIR || join(homedir(), 'Developer/leggio-out/robustezza/stress'));
const MB = 1024 * 1024;
const ms = (t) => Math.round(performance.now() - t);
const rss = () => Math.round(process.memoryUsage().rss / MB);
const rows = [];
for (const f of readdirSync(dir).filter((x) => x.endsWith('.pdf')).sort()) {
  const p = join(dir, f);
  const size = statSync(p).size;
  const bytes = new Uint8Array(readFileSync(p));
  const r = { file: f, mb: (size / MB).toFixed(1) };
  let t = performance.now();
  const task = pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false, verbosity: 0 });
  const pdf = await task.promise; r.open = ms(t); r.pages = pdf.numPages;
  t = performance.now(); const page = await pdf.getPage(1); await page.getOperatorList(); r.page1 = ms(t);
  t = performance.now(); const last = await pdf.getPage(pdf.numPages); await last.getOperatorList(); r.pageN = ms(t);
  t = performance.now(); const ol = await pdf.getOutline(); r.outline = ms(t); r.outlineTop = ol?.length || 0;
  t = performance.now(); const ann = await page.getAnnotations(); r.annots1 = ann.length; r.annotsMs = ms(t);
  await task.destroy();
  t = performance.now();
  let lib;
  try { lib = await PDFDocument.load(bytes, { updateMetadata: false }); r.libLoad = ms(t); t = performance.now(); const out = await lib.save({ useObjectStreams: true }); r.libSave = ms(t); r.savedMb = (out.length / MB).toFixed(1); }
  catch (e) { r.libLoad = 'errore: ' + e.message.slice(0, 40); }
  lib = null;
  r.rss = rss();
  rows.push(r);
  console.log(JSON.stringify(r));
}
console.log('\n| File | MB | Pagine | Apertura pdf.js | Pag. 1 | Ultima pag. | Segnalibri | pdf-lib apri | pdf-lib salva | RSS MB |');
console.log('|---|---|---|---|---|---|---|---|---|---|');
for (const r of rows) console.log(`| ${r.file} | ${r.mb} | ${r.pages} | ${r.open} ms | ${r.page1} ms | ${r.pageN} ms | ${r.outlineTop} (${r.outline} ms) | ${r.libLoad} ms | ${r.libSave ?? '—'} ms | ${r.rss} |`);
process.exit(0);
