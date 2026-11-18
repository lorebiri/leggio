// Collaudo nel browser vero dell'oscuramento di un documento d'identità, dall'interfaccia:
// strumento «Oscura» → «Documento d'identità…» (CIE, retro) → riquadro attorno alla tessera → «Applica
// oscuramento…» con filigrana «Copia per uso esclusivo di …» → controllo del file prodotto: i dati non sono
// più estraibili, l'immagine originale è sparita, la filigrana c'è su tutta la pagina, metadati puliti.
// Avvio: npx vite build && npx vite preview --port 5211 &   node test/e2e/redazione-documenti.mjs
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

const CARD = [60, 560, 60 + 340, 560 + 214]; // tessera ingrandita (rapporto 85,6:54)
try {
  await page.evaluate(async (CARD) => {
    const app = __leggio; const L = app.lib.PDFLib;
    const d = await L.PDFDocument.create();
    const p = d.addPage([595, 842]);
    const f = await d.embedFont(L.StandardFonts.Courier);
    const [x0, y0, x1, y1] = CARD; const W = x1 - x0; const H = y1 - y0;
    // «foto» della tessera: un'immagine vera (canvas → JPEG) con un colore riconoscibile
    const c = document.createElement('canvas'); c.width = 340; c.height = 214; const g = c.getContext('2d');
    g.fillStyle = '#d9e6f2'; g.fillRect(0, 0, 340, 214); g.fillStyle = '#c0392b'; g.fillRect(10, 140, 320, 70);
    const jpg = new Uint8Array(await (await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9))).arrayBuffer());
    p.drawImage(await d.embedJpg(jpg), { x: x0, y: y0, width: W, height: H });
    p.drawText('RSSMRA85T10A562S', { x: x0 + 10, y: y1 - 0.14 * H, size: 10, font: f });
    p.drawText('VIA ROMA 12 PISA', { x: x0 + 10, y: y1 - 0.40 * H, size: 10, font: f });
    p.drawText('IDITACA00000AA4<<<<<<<<<<<<<<<', { x: x0 + 10, y: y1 - 0.72 * H, size: 10, font: f });
    p.drawText('ROSSI<<MARIO<<<<<<<<<<<<<<<<<<', { x: x0 + 10, y: y1 - 0.90 * H, size: 10, font: f });
    p.drawText('Allegato alla domanda di iscrizione', { x: 60, y: 300, size: 14, font: f });
    d.setTitle('CIE Mario Rossi'); d.setAuthor('Mario Rossi');
    await app.openBytes(await d.save(), { name: 'cie.pdf' });
    await new Promise((r) => setTimeout(r, 900));
    app.tools.run('redact');
  }, CARD);
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: 'Documento d\'identità…' }).click();
  await page.waitForSelector('.dlg');
  await page.getByLabel('Documento', { exact: true }).selectOption('cie');
  await page.getByLabel('Lato', { exact: true }).selectOption('retro');
  await page.click('.dlg button[type=submit]');
  await page.waitForTimeout(300);
  // riquadro attorno alla tessera
  const pts = await page.evaluate((CARD) => {
    const app = __leggio; const vp = app.viewer.getViewport(0); const r = app.viewer.getOverlay(0).getBoundingClientRect();
    const a = vp.convertToViewportPoint(CARD[0], CARD[3]); const b = vp.convertToViewportPoint(CARD[2], CARD[1]);
    return { x0: r.left + a[0], y0: r.top + a[1], x1: r.left + b[0], y1: r.top + b[1] };
  }, CARD);
  await page.mouse.move(pts.x0, pts.y0); await page.mouse.down();
  await page.mouse.move((pts.x0 + pts.x1) / 2, (pts.y0 + pts.y1) / 2, { steps: 5 });
  await page.mouse.move(pts.x1, pts.y1, { steps: 5 }); await page.mouse.up();
  await page.waitForTimeout(400);
  const nZone = await page.locator('.lg-red').count();
  check('il modello CIE (retro) segna le zone sulla tessera', nZone >= 3, `${nZone} zone`);

  await page.getByRole('button', { name: 'Applica oscuramento…' }).click();
  await page.waitForSelector('.dlg');
  await page.getByLabel('Filigrana: «Copia per uso esclusivo di…» (facoltativa)').fill('Comune di Pisa');
  await page.getByLabel('Finalità (facoltativa)').fill('pratica TARI');
  await page.getByText('Applica al documento aperto').click();
  await page.click('.dlg button[type=submit]');
  await page.waitForSelector('.dlg >> text=Oscuramento completato', { timeout: 60000 });
  const riepilogo = await page.textContent('.dlg');
  check('riepilogo: verifica superata e filigrana inserita', /verifica superata/.test(riepilogo) && /Copia per uso esclusivo di Comune di Pisa – per pratica TARI/.test(riepilogo));
  await page.keyboard.press('Escape');

  const r = await page.evaluate(async () => {
    const app = __leggio; const bytes = app.activeDoc.bytes;
    const doc = await app.lib.pdfjs.getDocument({ data: bytes.slice() }).promise;
    const pg = await doc.getPage(1);
    const text = (await pg.getTextContent()).items.map((x) => x.str).join(' ');
    const vp = pg.getViewport({ scale: 1 }); const c = document.createElement('canvas'); c.width = vp.width; c.height = vp.height;
    const x = c.getContext('2d'); await pg.render({ canvasContext: x, viewport: vp }).promise;
    // pixel grigi della filigrana in una zona prima bianca (in basso a destra) e del rosso della «foto» sotto la MRZ
    const area = (x0, y0, w, h) => x.getImageData(x0, y0, w, h).data;
    let grigi = 0; const a = area(330, 600, 200, 200); for (let i = 0; i < a.length; i += 4) if (a[i] < 225 && Math.abs(a[i] - a[i + 2]) < 12) grigi++;
    let rossi = 0; const b = area(70, 842 - 600, 320, 30); for (let i = 0; i < b.length; i += 4) if (b[i] > 150 && b[i + 1] < 90) rossi++;
    window.__anteprima = c.toDataURL('image/png');
    const pd = await app.lib.PDFLib.PDFDocument.load(bytes, { updateMetadata: false });
    const raw = new TextDecoder('latin1').decode(bytes);
    return { text, grigi, rossi, title: pd.getTitle() ?? null, author: pd.getAuthor() ?? null, haMario: /Mario Rossi/.test(raw), immagini: (raw.match(/\/Subtype\s*\/Image/g) || []).length };
  });
  if (process.env.ANTEPRIMA) require('node:fs').writeFileSync(process.env.ANTEPRIMA, Buffer.from((await page.evaluate(() => window.__anteprima)).split(',')[1], 'base64'));
  check('CF, indirizzo e MRZ non sono più estraibili né copiabili', !/RSSMRA|ROMA|IDITACA|ROSSI<</.test(r.text), r.text.slice(0, 120));
  check('il testo fuori dalle zone resta ricercabile', /Allegato alla domanda/.test(r.text));
  check('la parte della foto sotto la MRZ è stata coperta (pixel rossi spariti)', r.rossi < 50, `${r.rossi} pixel rossi`);
  check('filigrana presente anche fuori dalla tessera', r.grigi > 200, `${r.grigi} pixel`);
  check('metadati puliti (titolo e autore tolti, nessun «Mario Rossi» nel file)', r.title === null && r.author === null && !r.haMario, JSON.stringify({ t: r.title, a: r.author }));
  check('una sola immagine nella pagina (l\'originale è stata sostituita)', r.immagini === 1, `${r.immagini}`);
  check('nessun errore nella pagina', errors.length === 0, errors.join(' | '));
} catch (e) {
  check('collaudo completato senza eccezioni', false, e.message);
} finally { await browser.close(); }
const ko = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - ko}/${results.length} superati`);
process.exit(ko ? 1 : 0);
