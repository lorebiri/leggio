// Misure dell'area «conversione» (non è un test: stampa i tempi). Uso: node test/conversione-benchmark.mjs
import { readFileSync } from 'node:fs';
import { diffSequenze, modifiche } from '../src/renderer/features/conversione/lib/diff.js';
import { ricostruisciPagina } from '../src/renderer/features/conversione/lib/testo.js';
import { estraiTesto } from '../src/renderer/features/conversione/lib/estrai-testo.js';

const misura = async (nome, fn, ripeti = 3) => {
  const t = [];
  for (let i = 0; i < ripeti; i++) { const t0 = performance.now(); await fn(); t.push(performance.now() - t0); }
  t.sort((a, b) => a - b);
  console.log(`${nome.padEnd(48)} mediana ${t[t.length >> 1].toFixed(1)} ms (min ${t[0].toFixed(1)}, max ${t[t.length - 1].toFixed(1)})`);
};

const a = Array.from({ length: 200000 }, (_, i) => 'parola' + (i % 5000));
const b = [...a]; b.splice(1000, 3, 'nuovo', 'testo'); b.splice(150000, 0, 'aggiunta'); b.splice(199000, 10);
await misura('diff 200 000 parole, 3 modifiche', () => modifiche(diffSequenze(a, b), a, b));
const c = a.map((w, i) => (i % 97 === 0 ? w + 'x' : w));
await misura('diff 200 000 parole, ~2 000 modifiche sparse', () => diffSequenze(a, c));

const L = (str, x, y) => ({ str, x, y, w: str.length * 5, size: 10, bold: false, italic: false });
const pagina = [];
for (let i = 0; i < 50; i++) { pagina.push(L(`Riga sinistra ${i} di un testo abbastanza lungo`, 40, 100 + i * 12)); pagina.push(L(`Riga destra ${i} di un testo abbastanza lungo`, 320, 100 + i * 12)); }
await misura('ricostruzione di una pagina a due colonne (100 righe)', () => ricostruisciPagina(pagina, { width: 600 }), 20);

const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
globalThis.pdfjsWorker = await import('pdfjs-dist/legacy/build/pdf.worker.mjs');
const contratto = readFileSync('test/fixtures/conv-contratto-v1.pdf');
await misura('estrazione del testo, PDF di 2 pagine (Node)', () => estraiTesto(pdfjs, contratto), 10);
