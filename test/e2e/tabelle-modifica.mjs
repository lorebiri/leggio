// Collaudo nell'interfaccia vera della modifica del testo nelle TABELLE (bug: la riga intera era una frase sola).
// Fattura con griglia: «Modifica testo e immagini» deve mostrare un riquadro per cella; si cambia una cella
// («250,00» → «1.250,00») e le altre celle restano ferme (entro 0,5 pt).
// Avvio: npx vite build && npx vite preview --port 5211 &   node test/e2e/tabelle-modifica.mjs
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const URL = `http://localhost:${process.env.PORT || 5211}/`;
const results = [];
const check = (name, ok, info = '') => { results.push(ok); console.log(`${ok ? 'OK  ' : 'NO  '} ${name}${info ? ' — ' + info : ''}`); };

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1360, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(URL);
await page.waitForFunction(() => !!window.__leggio);
await page.waitForTimeout(800);
for (let i = 0; i < 3 && (await page.evaluate(() => !!document.querySelector('.dlg'))); i++) { await page.keyboard.press('Escape'); await page.waitForTimeout(200); }

const posizioni = () => page.evaluate(async () => {
  const pg = await __leggio.activeDoc.pdf.getPage(1);
  return (await pg.getTextContent()).items.filter((x) => x.str.trim()).map((x) => ({ s: x.str, x: x.transform[4], y: x.transform[5], w: x.width }));
});
try {
  await page.evaluate(async () => {
    const app = __leggio; const L = app.lib.PDFLib;
    const d = await L.PDFDocument.create(); const f = await d.embedFont(L.StandardFonts.Helvetica); const p = d.addPage([595, 842]);
    const cols = [60, 160, 195, 255, 290, 350];
    const righe = [['Descrizione', 'Q.tà', 'Prezzo', 'IVA', 'Importo'], ['Manutenzione', '1', '100,00', '22%', '122,00'], ['Licenza software', '2', '250,00', '22%', '610,00'], ['Formazione', '3', '80,00', '22%', '292,80']];
    righe.forEach((r, i) => r.forEach((t, k) => {
      const y = 760 - i * 24;
      const w = f.widthOfTextAtSize(t, 10);
      const x = k >= 2 ? cols[k + 1] - 4 - w : cols[k] + 4; // numeri allineati a destra
      p.drawText(t, { x, y, size: 10, font: f });
    }));
    for (let i = 0; i <= 4; i++) p.drawLine({ start: { x: 60, y: 776 - i * 24 }, end: { x: 350, y: 776 - i * 24 }, thickness: 0.6 });
    for (const x of cols) p.drawLine({ start: { x, y: 776 }, end: { x, y: 680 }, thickness: 0.6 });
    await app.openBytes(await d.save(), { name: 'fattura.pdf' });
    await new Promise((r) => setTimeout(r, 900));
    app.tools.run('edit-content');
  });
  await page.waitForTimeout(1200);
  const blocchi = await page.$$eval('.lgm-block', (els) => els.length);
  check('un riquadro modificabile per ogni cella (20 celle)', blocchi === 20, `${blocchi} riquadri`);
  const prima = await posizioni();
  // clic sulla cella «250,00»
  const target = await page.evaluate(() => {
    const app = __leggio; const vp = app.viewer.getViewport(0); const r = app.viewer.getOverlay(0).getBoundingClientRect();
    const [x, y] = vp.convertToViewportPoint(225, 715); return { x: r.left + x, y: r.top + y };
  });
  await page.mouse.click(target.x, target.y);
  await page.waitForSelector('.lgm-editor', { timeout: 10000 });
  const testoEditor = await page.textContent('.lgm-editor');
  check('si apre solo la cella cliccata', testoEditor.trim() === '250,00', JSON.stringify(testoEditor));
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('1.250,00');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(2500);
  const dopo = await posizioni();
  const nuova = dopo.find((x) => x.s.includes('1.250,00'));
  check('la cella contiene il nuovo valore', !!nuova);
  const altre = prima.filter((x) => x.s !== '250,00');
  const ferme = altre.every((a) => dopo.some((b) => b.s === a.s && Math.abs(b.x - a.x) < 0.5 && Math.abs(b.y - a.y) < 0.5));
  check('tutte le altre celle restano ferme (entro 0,5 pt)', ferme, altre.filter((a) => !dopo.some((b) => b.s === a.s && Math.abs(b.x - a.x) < 0.5 && Math.abs(b.y - a.y) < 0.5)).map((a) => a.s).join(', '));
  const vecchia = prima.find((x) => x.s === '250,00');
  check('il numero resta allineato a destra nella cella', nuova && Math.abs((nuova.x + nuova.w) - (vecchia.x + vecchia.w)) < 1, nuova ? `bordo destro ${(nuova.x + nuova.w).toFixed(1)} vs ${(vecchia.x + vecchia.w).toFixed(1)}` : '');
  check('nessun errore nella pagina', errors.length === 0, errors.join(' | '));
} catch (e) { check('collaudo completato', false, e.message); }
await browser.close();
console.log(`\n${results.filter(Boolean).length}/${results.length} superati`);
process.exit(results.every(Boolean) ? 0 : 1);
