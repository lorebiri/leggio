// Collaudo nel browser vero: modello «Documento d'identità» su una scansione con pagina RUOTATA (/Rotate 90).
// La tessera appare dritta sullo schermo; l'utente sceglie «Dritto» e traccia il riquadro attorno alla tessera.
// Le zone del modello devono cadere sui dati come si vedono a schermo (prima della correzione il modello era
// applicato nello spazio della pagina non ruotata e il codice fiscale restava scoperto).
// Avvio: npx vite build && npx vite preview --port 5211 &   node test/e2e/redazione-ruotata.mjs
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const URL = `http://localhost:${process.env.PORT || 5211}/`;
const results = [];
const check = (name, ok, info = '') => { results.push({ name, ok }); console.log(`${ok ? 'OK  ' : 'NO  '} ${name}${info ? ' — ' + info : ''}`); };

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1360, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(URL);
await page.waitForFunction(() => !!window.__leggio);
await page.waitForTimeout(800);
for (let i = 0; i < 3 && (await page.evaluate(() => !!document.querySelector('.dlg'))); i++) { await page.keyboard.press('Escape'); await page.waitForTimeout(200); }

const CARD = [60, 560, 400, 774]; // tessera nella pagina «dritta» (595 × 842)
try {
  // pagina 842 × 595 con /Rotate 90 e contenuto girato di 90° in senso antiorario: a schermo appare dritta
  const cardPdf = await page.evaluate(async (CARD) => {
    const app = __leggio; const L = app.lib.PDFLib;
    const src = await L.PDFDocument.create(); const p = src.addPage([595, 842]);
    const f = await src.embedFont(L.StandardFonts.Courier);
    const [x0, y0, x1, y1] = CARD; const H = y1 - y0;
    p.drawRectangle({ x: x0, y: y0, width: x1 - x0, height: H, color: L.rgb(0.85, 0.9, 0.95) });
    p.drawText('RSSMRA85T10A562S', { x: x0 + 10, y: y1 - 0.14 * H, size: 10, font: f });
    p.drawText('VIA ROMA 12 PISA', { x: x0 + 10, y: y1 - 0.40 * H, size: 10, font: f });
    p.drawText('IDITACA00000AA4<<<<<<<<<<<<<<<', { x: x0 + 10, y: y1 - 0.72 * H, size: 10, font: f });
    p.drawText('Allegato alla domanda di iscrizione', { x: 60, y: 300, size: 14, font: f });
    const d = await L.PDFDocument.create();
    const [emb] = await d.embedPdf(await src.save());
    const q = d.addPage([842, 595]);
    q.drawPage(emb, { x: 842, y: 0, rotate: L.degrees(90) });
    q.setRotation(L.degrees(90));
    await app.openBytes(await d.save(), { name: 'cie-ruotata.pdf' });
    await new Promise((r) => setTimeout(r, 900));
    app.tools.run('redact');
    // riquadro della tessera nello spazio della pagina ruotata: (u, v) → (842 − v, u)
    return [842 - CARD[3], CARD[0], 842 - CARD[1], CARD[2]];
  }, CARD);
  const vista = await page.evaluate(async () => {
    const pg = await __leggio.activeDoc.pdf.getPage(1); const vp = pg.getViewport({ scale: 1 });
    const t = (await pg.getTextContent()).items.find((x) => x.str.startsWith('RSSMRA'));
    const [sx, sy] = vp.convertToViewportPoint(t.transform[4], t.transform[5]);
    return { w: vp.width, h: vp.height, sx, sy };
  });
  check('la pagina appare in verticale e il codice fiscale in alto a sinistra', vista.w < vista.h && vista.sx < 150 && vista.sy < 150, JSON.stringify(vista));

  await page.waitForTimeout(500);
  await page.getByRole('button', { name: 'Documento d\'identità…' }).click();
  await page.waitForSelector('.dlg');
  await page.getByLabel('Documento', { exact: true }).selectOption('cie');
  await page.getByLabel('Lato', { exact: true }).selectOption('retro');
  // solo il codice fiscale: le altre zone non devono «salvare» per caso il risultato
  for (const l of ['Numero del documento', 'Codice a lettura ottica', 'Firma del titolare', 'Indirizzo di residenza']) await page.getByLabel(l).uncheck();
  await page.getByLabel('Codice fiscale').check();
  await page.click('.dlg button[type=submit]');
  await page.waitForTimeout(300);
  const pts = await page.evaluate((R) => {
    const app = __leggio; const vp = app.viewer.getViewport(0); const r = app.viewer.getOverlay(0).getBoundingClientRect();
    const a = vp.convertToViewportPoint(R[0], R[1]); const b = vp.convertToViewportPoint(R[2], R[3]);
    return { x0: r.left + Math.min(a[0], b[0]), y0: r.top + Math.min(a[1], b[1]), x1: r.left + Math.max(a[0], b[0]), y1: r.top + Math.max(a[1], b[1]) };
  }, cardPdf);
  await page.mouse.move(pts.x0, pts.y0); await page.mouse.down();
  await page.mouse.move((pts.x0 + pts.x1) / 2, (pts.y0 + pts.y1) / 2, { steps: 5 });
  await page.mouse.move(pts.x1, pts.y1, { steps: 5 }); await page.mouse.up();
  await page.waitForTimeout(400);

  await page.getByRole('button', { name: 'Applica oscuramento…' }).click();
  await page.waitForSelector('.dlg');
  await page.getByText('Applica al documento aperto').click();
  await page.click('.dlg button[type=submit]');
  await page.waitForSelector('.dlg >> text=Oscuramento completato', { timeout: 60000 });
  await page.keyboard.press('Escape');
  const text = await page.evaluate(async () => {
    const doc = await __leggio.lib.pdfjs.getDocument({ data: __leggio.activeDoc.bytes.slice() }).promise;
    return (await (await doc.getPage(1)).getTextContent()).items.map((x) => x.str).join(' ');
  });
  check('il codice fiscale (in alto sulla tessera, come a schermo) è tolto dal file', !/RSSMRA/.test(text), text.slice(0, 150));
  check('MRZ (in basso, non scelta) e testo fuori dalla tessera restano', /IDITACA/.test(text) && /Allegato alla domanda/.test(text), text.slice(0, 150));
  check('nessun errore nella pagina', errors.length === 0, errors.join(' | '));
} catch (e) {
  check('collaudo completato senza eccezioni', false, e.message);
} finally { await browser.close(); }
const ko = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - ko}/${results.length} superati`);
process.exit(ko ? 1 : 0);
