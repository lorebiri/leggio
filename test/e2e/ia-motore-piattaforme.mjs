// Prova su Windows, macOS e Linux veri (workflow «IA: motore sui tre sistemi»):
// il pacchetto del motore di QUESTO sistema si scarica dalla fonte fissa, l'impronta SHA-256 corrisponde,
// si estrae, il motore parte e risponde (con il modello piccolo della ricerca per significato, 121 MB).
// Uso: node test/e2e/ia-motore-piattaforme.mjs   (scarica circa 150 MB)
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const require = createRequire(import.meta.url);
const { _test: ia } = require('../../electron/features/ia.cjs');
const { motorePer } = require('../../electron/ia/catalogo.cjs');

const dir = mkdtempSync(join(tmpdir(), 'leggio-ia-motore-'));
let ko = 0;
const ok = (c, m, d) => { console.log(`${c ? 'OK ' : 'KO '} ${m}${c ? '' : ' → ' + JSON.stringify(d)}`); if (!c) ko++; };
try {
  ia.init(dir);
  const m = motorePer();
  ok(!!m, `pacchetto del motore per ${process.platform}-${process.arch}`, m);
  const t0 = Date.now();
  await ia.scaricaComponenti(['motore', 'embedding'], () => null);
  while (ia.S.download) await new Promise((r) => setTimeout(r, 500));
  ok(ia.installato('motore'), `motore scaricato, verificato ed estratto (${Math.round((Date.now() - t0) / 1000)} s)`, (await ia.stato()).motore);
  ok(ia.installato('embedding'), 'modello di embedding scaricato e verificato', (await ia.stato()).modelli.embedding);
  const t1 = Date.now();
  const v = await ia.vettori(['posti letto per persone senza dimora', 'accoglienza invernale dei senzatetto', 'tassa sui rifiuti']);
  const cos = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0) / Math.hypot(...a) / Math.hypot(...b);
  ok(v.length === 3 && v[0].length > 100, `il motore parte e calcola i vettori (${Math.round((Date.now() - t1) / 1000)} s, ${v[0]?.length} dimensioni)`, v.length);
  ok(cos(v[0], v[1]) > cos(v[0], v[2]), 'frasi simili più vicine di frasi diverse', [cos(v[0], v[1]), cos(v[0], v[2])]);
  console.log('   sistema:', JSON.stringify((await ia.stato({ controllaCpu: true })).cpu), JSON.stringify(ia.S.motore.stato().embed));
} catch (e) {
  ok(false, 'prova completata', e.message);
} finally {
  await ia.S.motore?.ferma();
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* su Windows può restare bloccato un istante */ }
}
process.exit(ko ? 1 : 0);
