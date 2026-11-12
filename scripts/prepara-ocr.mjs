#!/usr/bin/env node
// Prepara le risorse OCR offline di Leggio: scarica i dati delle lingue di Tesseract (versione 4.0.0_best_int,
// solo LSTM, compressi .gz) in src/renderer/public-assets/ocr/lang/ (vite le copia in dist/assets-extra/ocr/lang/).
// I file sono già nel repository: lo script serve solo a rigenerarli o ad aggiungere lingue.
//   node scripts/prepara-ocr.mjs            → scarica le lingue mancanti
//   node scripts/prepara-ocr.mjs --force    → riscarica tutto
//   node scripts/prepara-ocr.mjs por nld    → aggiunge altre lingue (codici Tesseract)
// Il motore (worker e core wasm di tesseract.js) NON va copiato: lo importa vite con ?url da node_modules.
import { mkdirSync, existsSync, writeFileSync, statSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dest = resolve(root, 'src/renderer/public-assets/ocr/lang');
const args = process.argv.slice(2);
const force = args.includes('--force');
const extra = args.filter((a) => !a.startsWith('--'));
const LANGS = [...new Set(['ita', 'eng', 'fra', 'deu', 'spa', ...extra])];
const VERSION = '4.0.0_best_int';

mkdirSync(dest, { recursive: true });
let errors = 0;
for (const l of LANGS) {
  const file = resolve(dest, `${l}.traineddata.gz`);
  if (!force && existsSync(file) && statSync(file).size > 100000) { console.log(`✓ ${l} già presente`); continue; }
  const url = `https://cdn.jsdelivr.net/npm/@tesseract.js-data/${l}/${VERSION}/${l}.traineddata.gz`;
  try {
    const r = await fetch(url);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const buf = new Uint8Array(await r.arrayBuffer());
    if (buf[0] !== 0x1f || buf[1] !== 0x8b) throw new Error('il file scaricato non è gzip');
    writeFileSync(file, buf);
    console.log(`↓ ${l} (${(buf.length / 1048576).toFixed(1)} MB)`);
  } catch (e) { errors++; console.error(`✗ ${l}: ${e.message} (${url})`); }
}
process.exit(errors ? 1 : 0);
