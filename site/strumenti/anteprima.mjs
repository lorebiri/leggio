// Rifà img/anteprima.png (1200×630), l'immagine che compare quando si condivide il link della pagina
// (Open Graph). Uso: node site/strumenti/anteprima.mjs   (serve Playwright, come per schermate.mjs)
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SITO = join(dirname(fileURLToPath(import.meta.url)), '..');
const { chromium } = createRequire(join(SITO, '..', 'package.json'))('playwright');
const dataUrl = (file, tipo) => `data:${tipo};base64,${readFileSync(join(SITO, file)).toString('base64')}`;

const html = `<!doctype html><html lang="it"><meta charset="utf-8"><style>
  html, body { margin: 0; width: 1200px; height: 630px; overflow: hidden; }
  body { background: #f1efe9; color: #1c1e22; font-family: "Iowan Old Style", Palatino, Georgia, serif; display: grid; grid-template-columns: 520px 1fr; align-items: center; }
  .testo { padding: 0 0 0 64px; }
  .marchio { display: flex; align-items: center; gap: 14px; font-size: 40px; font-weight: 600; margin-bottom: 34px; }
  h1 { font-size: 54px; line-height: 1.08; margin: 0 0 22px; letter-spacing: -.02em; }
  h1 span { color: #0b5f58; display: block; }
  p { font: 22px/1.4 system-ui, sans-serif; color: #50545c; margin: 0; white-space: nowrap; }
  .img { position: relative; height: 630px; }
  .img img { position: absolute; left: 30px; top: 95px; width: 760px; border-radius: 14px; border: 1px solid #d9d4c8; box-shadow: 0 24px 60px rgba(15,118,110,.18), 0 10px 28px rgba(0,0,0,.10); }
</style><body>
  <div class="testo">
    <div class="marchio"><img src="${dataUrl('icona.svg', 'image/svg+xml')}" width="56" height="56" alt=""> Leggio</div>
    <h1>Il PDF per l'ufficio italiano. <span>Gratis, per sempre, senza Internet.</span></h1>
    <p>Windows, macOS, Linux · software libero</p>
  </div>
  <div class="img"><img src="${dataUrl('img/inizio.webp', 'image/webp')}" alt=""></div>
</body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
await page.setContent(html, { waitUntil: 'load' });
writeFileSync(join(SITO, 'img/anteprima.png'), await page.screenshot({ type: 'png' }));
// per alleggerirla (sotto i 150 kB): python3 -c "from PIL import Image; Image.open('site/img/anteprima.png').quantize(256, method=2).save('site/img/anteprima.png', optimize=True)"
await browser.close();
console.log('Scritto img/anteprima.png');
