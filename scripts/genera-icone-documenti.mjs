#!/usr/bin/env node
// Icone dei TIPI DI FILE associati a Leggio (diverse dall'icona del programma):
//   build/p7m.svg / p7m.ico / p7m.icns  — documento firmato digitalmente (.p7m, .m7m, .tsd): foglio con sigillo
// Servono perché in Esplora risorse e nel Finder un .p7m NON sembri un PDF (prima usava l'icona dell'app,
// la stessa dei PDF). Il disegno è qui sotto; il rendering usa Chromium di Playwright (solo per chi
// rigenera le icone: le icone generate sono già nel repository).
// Uso: node scripts/genera-icone-documenti.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const out = resolve('build');
mkdirSync(out, { recursive: true });

const TEAL = '#0f766e';
const SEAL = '#b42318';

/** Foglio con angolo piegato, righe di testo, sigillo rosso con nastro ed etichetta «P7M». */
function p7mSvg({ small = false } = {}) {
  const lines = small ? '' : [300, 360, 420, 480].map((y, i) => `<rect x="250" y="${y}" width="${i === 3 ? 300 : 470}" height="26" rx="13" fill="#c9d3d6"/>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">
  <path d="M190 60 H650 L834 244 V964 H190 Z" fill="#ffffff" stroke="#5f6b70" stroke-width="${small ? 40 : 24}" stroke-linejoin="round"/>
  <path d="M650 60 V244 H834" fill="#e6ecee" stroke="#5f6b70" stroke-width="${small ? 40 : 24}" stroke-linejoin="round"/>
  ${lines}
  <rect x="190" y="${small ? 600 : 610}" width="644" height="${small ? 220 : 170}" fill="${TEAL}"/>
  <text x="512" y="${small ? 760 : 730}" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-weight="700" font-size="${small ? 200 : 140}" fill="#ffffff" letter-spacing="6">P7M</text>
  <path d="M690 820 L650 990 L715 950 L760 1010 L790 840 Z" fill="${SEAL}" opacity=".9"/>
  <circle cx="740" cy="800" r="${small ? 150 : 130}" fill="${SEAL}" stroke="#ffffff" stroke-width="18"/>
  <path d="M${small ? 680 : 685} 800 l40 42 l78 -86" fill="none" stroke="#ffffff" stroke-width="${small ? 44 : 36}" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;
}

function ico(pngs) {
  // contenitore ICO con immagini PNG (Windows Vista e successivi)
  const head = Buffer.alloc(6 + 16 * pngs.length);
  head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(pngs.length, 4);
  let off = head.length;
  pngs.forEach(({ size, data }, i) => {
    const e = 6 + 16 * i;
    head.writeUInt8(size >= 256 ? 0 : size, e); head.writeUInt8(size >= 256 ? 0 : size, e + 1);
    head.writeUInt8(0, e + 2); head.writeUInt8(0, e + 3);
    head.writeUInt16LE(1, e + 4); head.writeUInt16LE(32, e + 6);
    head.writeUInt32LE(data.length, e + 8); head.writeUInt32LE(off, e + 12);
    off += data.length;
  });
  return Buffer.concat([head, ...pngs.map((p) => p.data)]);
}

function icns(pngs) {
  // tipi PNG di icns: ic07 128, ic08 256, ic09 512, ic10 1024, ic11 32 (16@2x), ic12 64 (32@2x), ic13 256 (128@2x), ic14 512 (256@2x)
  const types = { 32: ['ic11'], 64: ['ic12'], 128: ['ic07'], 256: ['ic08', 'ic13'], 512: ['ic09', 'ic14'], 1024: ['ic10'] };
  const chunks = [];
  for (const { size, data } of pngs) for (const t of types[size] || []) {
    const h = Buffer.alloc(8); h.write(t, 0, 'ascii'); h.writeUInt32BE(data.length + 8, 4);
    chunks.push(h, data);
  }
  const body = Buffer.concat(chunks);
  const h = Buffer.alloc(8); h.write('icns', 0, 'ascii'); h.writeUInt32BE(body.length + 8, 4);
  return Buffer.concat([h, body]);
}

async function render(svg, sizes) {
  const { chromium } = require('playwright');
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const outs = [];
    for (const size of sizes) {
      await page.setViewportSize({ width: size, height: size });
      await page.setContent(`<html><body style="margin:0;background:transparent">${svg(size).replace('width="1024" height="1024"', `width="${size}" height="${size}"`)}</body></html>`);
      outs.push({ size, data: await page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } }) });
    }
    return outs;
  } finally { await browser.close(); }
}

const svgFor = (size) => p7mSvg({ small: size <= 48 });
writeFileSync(resolve(out, 'p7m.svg'), p7mSvg());
const pngs = await render(svgFor, [16, 24, 32, 48, 64, 128, 256, 512, 1024]);
writeFileSync(resolve(out, 'p7m.ico'), ico(pngs.filter((p) => p.size <= 256)));
writeFileSync(resolve(out, 'p7m.icns'), icns(pngs.filter((p) => p.size >= 32)));
console.log('Icone del .p7m scritte in build/: p7m.svg, p7m.ico, p7m.icns');
