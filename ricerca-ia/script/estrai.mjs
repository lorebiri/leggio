// Estrae il testo dei PDF del banco con la stessa funzione usata da Leggio
// (src/renderer/features/conversione/lib/estrai-testo.js), pagina per pagina.
// Uso: node script/estrai.mjs banco/pdf/xxx.pdf [altri...]  → banco/testi/xxx.json
import fs from 'node:fs';
import path from 'node:path';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { estraiTesto } from '../../src/renderer/features/conversione/lib/estrai-testo.js';

const qui = path.dirname(new URL(import.meta.url).pathname);
const out = path.join(qui, '..', 'banco', 'testi');
for (const f of process.argv.slice(2)) {
  const id = path.basename(f, '.pdf');
  const r = await estraiTesto(pdfjs, fs.readFileSync(f));
  const pagine = r.pagine.map((p) => ({ n: p.n, testo: p.testo }));
  const car = pagine.reduce((s, p) => s + p.testo.length, 0);
  fs.writeFileSync(path.join(out, id + '.json'), JSON.stringify({ id, numPagine: r.numPagine, caratteri: car, scansione: r.scansione, pagine }, null, 1));
  console.log(`${id}: ${r.numPagine} pagine, ${car} caratteri${r.scansione ? ' (SCANSIONE: scartare)' : ''}`);
}
