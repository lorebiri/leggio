#!/usr/bin/env node
// Genera le icone di Leggio dai disegni vettoriali qui sotto.
//   build/icon.svg        sorgente macOS (squircle con i margini della griglia Apple, 1024×1024)
//   build/icon-win.svg    sorgente Windows (solo il leggio con un bordo chiaro, senza fondo)
//   build/icon.png        1024×1024 (electron-builder e icona della finestra)
//   build/icon.icns       macOS (iconutil)
//   build/icon.ico        Windows, PNG dentro un contenitore ICO: 16,24,32,48,64,128,256
// Richiede rsvg-convert (brew install librsvg) e, per l'icns, iconutil (incluso in macOS).
// Uso: npm run icone
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const out = resolve('build');
mkdirSync(out, { recursive: true });

const TEAL = '#0f766e';
const TEAL_LIGHT = '#14958a';
const INK = '#1f2b2e';

// squircle "continuo" (superellisse n=5) come le icone macOS moderne: corpo 824×824 centrato su 1024
function squircle(cx, cy, r, n = 5, steps = 360) {
  const pts = [];
  for (let i = 0; i < steps; i++) {
    const t = (i / steps) * Math.PI * 2;
    const c = Math.cos(t), s = Math.sin(t);
    pts.push([cx + r * Math.sign(c) * Math.abs(c) ** (2 / n), cy + r * Math.sign(s) * Math.abs(s) ** (2 / n)]);
  }
  return 'M' + pts.map(([x, y]) => `${x.toFixed(2)} ${y.toFixed(2)}`).join('L') + 'Z';
}

// il leggio, disegnato in un riquadro 1024 centrato in (512,512); k = scala, small = versione per 16–64 px
function glyph({ k = 1, small = false, dark = INK } = {}) {
  const g = [];
  const T = (x) => (512 + (x - 512) * k).toFixed(1);
  const S = (v) => (v * k).toFixed(1);
  // foglio inclinato
  const sw = small ? 600 : 560, sh = small ? 440 : 410;
  const sx = 512 - sw / 2, sy = small ? 205 : 222;
  g.push(`<g transform="rotate(-7 ${T(512)} ${T(sy + sh / 2)})">`);
  g.push(`<rect x="${T(sx)}" y="${T(sy)}" width="${S(sw)}" height="${S(sh)}" rx="${S(small ? 56 : 48)}" fill="url(#foglio)"/>`);
  if (small) {
    g.push(`<path d="M${T(sx + 120)} ${T(sy + 165)}H${T(sx + sw - 120)}M${T(sx + 120)} ${T(sy + 285)}H${T(sx + sw - 230)}" stroke="#fff" stroke-width="${S(66)}" stroke-linecap="round"/>`);
  } else {
    g.push(`<path d="M${T(sx + 100)} ${T(sy + 120)}H${T(sx + sw - 100)}M${T(sx + 100)} ${T(sy + 205)}H${T(sx + sw - 100)}M${T(sx + 100)} ${T(sy + 290)}H${T(sx + sw - 210)}" stroke="#fff" stroke-width="${S(40)}" stroke-linecap="round" opacity=".95"/>`);
  }
  // bordino su cui poggia il foglio
  g.push(`<rect x="${T(sx - 28)}" y="${T(sy + sh - 18)}" width="${S(sw + 56)}" height="${S(small ? 64 : 54)}" rx="${S(small ? 32 : 27)}" fill="${dark}"/>`);
  g.push('</g>');
  // asta e base
  const top = sy + sh + 30, bottom = small ? 812 : 800;
  g.push(`<path d="M${T(512)} ${T(top)}V${T(bottom)}M${T(small ? 372 : 392)} ${T(bottom)}H${T(small ? 652 : 632)}" stroke="${dark}" stroke-width="${S(small ? 78 : 60)}" stroke-linecap="round" fill="none"/>`);
  return g.join('');
}

const defs = `<defs>
  <linearGradient id="fondo" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fdfcf8"/><stop offset="1" stop-color="#e6e2d6"/></linearGradient>
  <linearGradient id="foglio" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${TEAL_LIGHT}"/><stop offset="1" stop-color="${TEAL}"/></linearGradient>
  <filter id="ombra" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur in="SourceAlpha" stdDeviation="14"/><feOffset dy="10"/><feComponentTransfer><feFuncA type="linear" slope=".28"/></feComponentTransfer><feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge></filter>
</defs>`;

function macSvg({ small = false } = {}) {
  const body = squircle(512, 512, 412);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">${defs}
<path d="${body}" fill="url(#fondo)" filter="url(#ombra)"/>
<path d="${body}" fill="none" stroke="#000" stroke-opacity=".06" stroke-width="2"/>
${glyph({ k: small ? 0.86 : 0.78, small })}
</svg>`;
}

// Windows: niente fondo (stile delle icone Windows 11) ma un bordo chiaro attorno al disegno,
// così l'asta scura resta visibile anche sulla barra delle applicazioni in tema scuro
function winSvg({ small = false } = {}) {
  const r = small ? 44 : 30;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">${defs}
<filter id="bordo" x="-10%" y="-10%" width="120%" height="120%"><feMorphology in="SourceAlpha" operator="dilate" radius="${r}"/><feGaussianBlur stdDeviation="${r / 3}"/><feComponentTransfer result="d"><feFuncA type="linear" slope="4" intercept="-1.4"/></feComponentTransfer><feFlood flood-color="#f4f3ef"/><feComposite in2="d" operator="in"/><feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge></filter>
<g filter="url(#bordo)">${glyph({ k: small ? 1.08 : 1.04, small })}</g>
</svg>`;
}

const tmp = mkdtempSync(join(tmpdir(), 'leggio-icone-'));
let n = 0;
function render(svg, size, file) {
  const src = join(tmp, `s${n++}.svg`);
  writeFileSync(src, svg);
  execFileSync('rsvg-convert', ['-w', String(size), '-h', String(size), '-o', file, src]);
  return readFileSync(file);
}

try {
  writeFileSync(join(out, 'icon.svg'), macSvg());
  writeFileSync(join(out, 'icon-win.svg'), winSvg());
  render(macSvg(), 1024, join(out, 'icon.png'));

  // icns (sotto i 64 px la versione semplificata, più leggibile)
  const iconset = join(tmp, 'icon.iconset');
  mkdirSync(iconset);
  for (const [base, scale] of [[16, 1], [16, 2], [32, 1], [32, 2], [128, 1], [128, 2], [256, 1], [256, 2], [512, 1], [512, 2]]) {
    const px = base * scale;
    render(macSvg({ small: px <= 64 }), px, join(iconset, `icon_${base}x${base}${scale === 2 ? '@2x' : ''}.png`));
  }
  try { execFileSync('iconutil', ['-c', 'icns', iconset, '-o', join(out, 'icon.icns')]); }
  catch (e) { console.warn('iconutil non disponibile: icon.icns non rigenerata.', e.message); }

  // ico: ICONDIR (6 byte) + una ICONDIRENTRY (16 byte) per formato + i PNG uno dopo l'altro
  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const pngs = sizes.map((s) => render(winSvg({ small: s <= 32 }), s, join(tmp, `w${s}.png`)));
  const header = Buffer.alloc(6 + 16 * sizes.length);
  header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(sizes.length, 4);
  let offset = header.length;
  sizes.forEach((s, i) => {
    const e = 6 + i * 16;
    header.writeUInt8(s >= 256 ? 0 : s, e);     // larghezza (0 = 256)
    header.writeUInt8(s >= 256 ? 0 : s, e + 1); // altezza
    header.writeUInt8(0, e + 2);                 // colori in tavolozza
    header.writeUInt8(0, e + 3);                 // riservato
    header.writeUInt16LE(1, e + 4);              // piani
    header.writeUInt16LE(32, e + 6);             // bit per pixel
    header.writeUInt32LE(pngs[i].length, e + 8);
    header.writeUInt32LE(offset, e + 12);
    offset += pngs[i].length;
  });
  writeFileSync(join(out, 'icon.ico'), Buffer.concat([header, ...pngs]));
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
console.log('Icone generate in', out);
