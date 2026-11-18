// Collaudo della STAMPA nel browser vero (Chromium), con il CSS dell'app.
// Bug segnalato: fogli bianchi e, con più pagine, stampata solo la prima.
// Come funziona: si stampa con app.printFiles (preset senza dialogo); window.print viene sostituito da una
// funzione che copia il contenuto di #print-root (immagini in data URL) nel momento della stampa; poi quel
// contenuto si rimette nella pagina con body.printing e Chromium genera il PDF di stampa (page.pdf usa lo
// stesso motore di impaginazione di webContents.print di Electron). Si controlla: numero di fogli = numero di
// pagine, nessun foglio bianco.
// Avvio:
//   npx vite build && mkdir -p dist/fixtures && cp test/fixtures/*.pdf dist/fixtures/
//   npx vite preview --port 5211 &
//   node test/e2e/stampa.mjs          (PORT=5211 predefinita)
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const URL = `http://localhost:${process.env.PORT || 5211}/`;
const results = [];
const check = (name, ok, info = '') => { results.push({ name, ok }); console.log(`${ok ? 'OK  ' : 'NO  '} ${name}${info ? ' — ' + info : ''}`); };

const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(URL);
await page.waitForFunction(() => !!window.__leggio);
await page.waitForTimeout(800);
for (let i = 0; i < 3 && (await page.evaluate(() => !!document.querySelector('.dlg'))); i++) { await page.keyboard.press('Escape'); await page.waitForTimeout(200); }

/** PDF di prova costruito con pdf-lib nella pagina. kind: 'testo' | 'grande' | 'trasparenze' | 'misto' */
async function stampa(kind, pages, preset = {}) {
  const html = await page.evaluate(async ({ kind, pages, preset }) => {
    const app = __leggio; const L = app.lib.PDFLib;
    const d = await L.PDFDocument.create();
    const font = await d.embedFont(L.StandardFonts.Helvetica);
    for (let i = 0; i < pages; i++) {
      const size = kind === 'grande' ? [2384, 3370] /* A0 */ : kind === 'striscione' ? [14400, 1200] : kind === 'misto' && i % 2 ? [842, 595] : [595, 842];
      const p = d.addPage(size);
      p.drawRectangle({ x: 40, y: 40, width: size[0] - 80, height: size[1] - 80, borderColor: L.rgb(0, 0, 0), borderWidth: 4 });
      p.drawText(`Pagina ${i + 1}`, { x: 80, y: size[1] - 160, size: Math.min(size[0], size[1]) / 10, font });
      if (kind === 'trasparenze') p.drawRectangle({ x: 100, y: 100, width: 300, height: 300, color: L.rgb(1, 0, 0), opacity: 0.4 });
    }
    const bytes = await d.save();
    window.__snap = null;
    window.print = () => {
      const root = document.getElementById('print-root');
      const clone = root.cloneNode(true);
      const imgs = root.querySelectorAll('img'); const cimgs = clone.querySelectorAll('img');
      imgs.forEach((im, k) => { const c = document.createElement('canvas'); c.width = im.naturalWidth; c.height = im.naturalHeight; c.getContext('2d').drawImage(im, 0, 0); cimgs[k].src = c.toDataURL('image/jpeg', 0.6); });
      window.__snap = { html: clone.innerHTML, printing: document.body.classList.contains('printing'), sizes: [...imgs].map((im) => [im.naturalWidth, im.naturalHeight]) };
    };
    await app.printFiles([{ name: `${kind}.pdf`, bytes }], { preset: { quality: '96', ...preset } });
    return window.__snap;
  }, { kind, pages, preset });
  if (!html) return { sheets: 0, blank: 0, imgs: 0, sizes: [] };
  await page.evaluate((h) => { document.getElementById('print-root').innerHTML = h; document.body.classList.add('printing'); }, html.html);
  await page.evaluate(() => Promise.all([...document.querySelectorAll('#print-root img')].map((i) => i.decode().catch(() => {}))));
  const pdf = await page.pdf({ format: 'A4', printBackground: true, margin: { top: 0, right: 0, bottom: 0, left: 0 } });
  await page.evaluate(() => { document.getElementById('print-root').innerHTML = ''; document.body.classList.remove('printing'); });
  // analisi del PDF di stampa: fogli e fogli bianchi (rasterizzati con pdf.js dell'app)
  const r = await page.evaluate(async (b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const pdfjs = __leggio.lib.pdfjs;
    const doc = await pdfjs.getDocument({ data: bytes }).promise;
    let blank = 0;
    for (let i = 1; i <= doc.numPages; i++) {
      const pg = await doc.getPage(i); const vp = pg.getViewport({ scale: 1 });
      const c = document.createElement('canvas'); c.width = vp.width; c.height = vp.height;
      const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
      await pg.render({ canvasContext: ctx, viewport: vp }).promise;
      const d = ctx.getImageData(0, 0, c.width, c.height).data; let dark = 0;
      for (let k = 0; k < d.length; k += 4) if (d[k] < 200) dark++;
      if (dark < 20) blank++;
    }
    return { sheets: doc.numPages, blank };
  }, pdf.toString('base64'));
  return { ...r, imgs: html.sizes.length, sizes: html.sizes, printing: html.printing };
}

try {
  for (const [kind, n] of [['testo', 1], ['testo', 5], ['misto', 4], ['trasparenze', 3], ['grande', 2], ['striscione', 1]]) {
    const r = await stampa(kind, n);
    check(`${kind}, ${n} pagine: ${n} fogli, nessuno bianco`, r.sheets === n && r.blank === 0 && r.imgs === n, JSON.stringify(r));
  }
  const hq = await stampa('grande', 1, { quality: '300' });
  const px = hq.sizes[0] ? hq.sizes[0][0] * hq.sizes[0][1] : 0;
  check('A0 in alta qualità: immagine entro i limiti del canvas (niente foglio bianco)', hq.sheets === 1 && hq.blank === 0 && px > 0 && px <= 40e6 && Math.max(...hq.sizes[0]) <= 16384, JSON.stringify(hq));
  check('nessun errore nella pagina', errors.length === 0, errors.join(' | '));
} finally { await browser.close(); }
const ko = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - ko}/${results.length} superati`);
process.exit(ko ? 1 : 0);
