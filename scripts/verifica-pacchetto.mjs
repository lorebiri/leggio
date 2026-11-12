#!/usr/bin/env node
// Dopo electron-builder: controlla che i moduli npm usati dal processo main (require in electron/**/*.cjs)
// si carichino davvero dall'app impacchettata (app.asar). Serve a scoprire PRIMA del rilascio
// dipendenze mancanti nel pacchetto (es. una peerDependency non dichiarata in package.json).
// Usa l'eseguibile di Leggio stesso in modalità Node (ELECTRON_RUN_AS_NODE).
//   node scripts/verifica-pacchetto.mjs           moduli richiesti dal main
//   node scripts/verifica-pacchetto.mjs --tutte   anche tutte le "dependencies" non escluse dal pacchetto
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve('.');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const rel = join(root, pkg.build?.directories?.output || 'release');

function trovaApp() {
  const cand = process.platform === 'darwin'
    ? [`mac-${process.arch}`, 'mac', 'mac-universal', 'mac-arm64'].map((d) => join(rel, d, `${pkg.build.productName}.app`))
    : process.platform === 'win32' ? [join(rel, 'win-unpacked')] : [join(rel, 'linux-unpacked')];
  for (const c of cand) {
    if (!existsSync(c)) continue;
    if (process.platform === 'darwin') return { exe: join(c, 'Contents/MacOS', pkg.build.productName), asar: join(c, 'Contents/Resources/app.asar') };
    return { exe: join(c, `${pkg.build.productName}${process.platform === 'win32' ? '.exe' : ''}`), asar: join(c, 'resources/app.asar') };
  }
  return null;
}

function cjsFiles(dir) {
  const out = [];
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) out.push(...cjsFiles(p));
    else if (/\.(c?js)$/.test(f)) out.push(p);
  }
  return out;
}

const moduli = new Set();
for (const f of cjsFiles(join(root, 'electron'))) {
  for (const m of readFileSync(f, 'utf8').matchAll(/require\(\s*['"]([^'".][^'"]*)['"]\s*\)/g)) {
    const id = m[1];
    if (id === 'electron' || id.startsWith('node:') || /^(fs|path|os|crypto|zlib|url|util|child_process|stream|events|buffer)$/.test(id)) continue;
    moduli.add(id.startsWith('@') ? id.split('/').slice(0, 2).join('/') : id.split('/')[0]);
  }
}
if (process.argv.includes('--tutte')) {
  const esclusi = (pkg.build.files || []).filter((p) => p.startsWith('!node_modules/')).join(' ');
  for (const d of Object.keys(pkg.dependencies || {})) if (!esclusi.includes(d)) moduli.add(d);
}

const app = trovaApp();
if (!app) { console.error(`Nessuna app impacchettata trovata in ${rel}: esegui prima electron-builder.`); process.exit(2); }
if (!moduli.size) { console.log('Il processo main non usa moduli npm: niente da verificare.'); process.exit(0); }

let errori = 0;
for (const m of [...moduli].sort()) {
  try {
    execFileSync(app.exe, ['-e', `require(${JSON.stringify(join(app.asar, 'node_modules', m))})`], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: ['ignore', 'ignore', 'pipe'], timeout: 60000,
    });
    console.log(`ok      ${m}`);
  } catch (e) {
    errori++;
    const msg = String(e.stderr || e.message).split('\n').find((l) => /Error/.test(l)) || 'errore';
    console.log(`MANCA   ${m}  →  ${msg.trim()}`);
  }
}
if (errori) { console.error(`\n${errori} moduli non si caricano dal pacchetto. Dichiarali in "dependencies" di package.json o togli l'esclusione in build.files.`); process.exit(1); }
console.log('\nTutti i moduli del processo main si caricano dal pacchetto.');
