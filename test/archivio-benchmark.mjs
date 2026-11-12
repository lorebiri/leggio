// Misura del motore di ricerca dell'archivio con 10.000 documenti (le soglie dei test sono larghe apposta).
//   node --expose-gc test/archivio-benchmark.mjs [numero di documenti]
import { Motore } from '../src/renderer/features/archivio/lib/motore.js';

const N = +(process.argv[2] || 10000);
const m = new Motore();
const parole = 'fattura reagente colonna manutenzione durc contratto missione roma pisa firenze strumento servizio fornitura consegna laboratorio importo totale imponibile scadenza pagamento bonifico'.split(' ');
global.gc?.(); const h0 = process.memoryUsage().heapUsed;
const t0 = performance.now();
for (let i = 0; i < N; i++) {
  let t = '';
  for (let k = 0; k < 900; k++) t += parole[(i * 7 + k * 13 + (k >> 3)) % parole.length] + (k % 12 ? ' ' : '\n');
  if (i % 3 === 0) t += '\f' + t.slice(0, 2000);
  m.metti({ id: '/a/' + i, path: '/a/' + i, rel: 'x/' + i, cartella: 'c', nome: `doc${i}.pdf`, ext: 'pdf', tipo: ['fattura', 'durc', 'ordine'][i % 3], fornitore: 'Ditta ' + (i % 300), piva: String(10000000000 + (i % 300)), data: `2026-0${1 + (i % 9)}-1${i % 10}`, testo: t + ` numero${i}`, impronta: i.toString(16).padStart(64, '0') });
}
const caricamento = performance.now() - t0;
global.gc?.(); const h1 = process.memoryUsage().heapUsed;
let car = 0; for (const r of m.rec.values()) car += r.testo.length;
const mis = (f) => { const a = performance.now(); const r = m.cerca(f); return { totale: r.totale, ms: Math.round(performance.now() - a) }; };
console.log(JSON.stringify({
  documenti: N, testoMB: +(car / 1e6).toFixed(1), caricamentoMs: Math.round(caricamento), heapMB: Math.round((h1 - h0) / 1048576),
  parolaRara: mis({ q: 'numero9876' }), parolaComune: mis({ q: 'manutenzione' }), frase: mis({ q: '"importo totale"' }),
  filtri: mis({ tipo: 'durc', dal: '2026-03-01' }), fornitore: mis({ fornitore: 'ditta 12' }), tutti: mis({}),
}, null, 1));
