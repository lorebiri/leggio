// Collaudo nel browser vero con PDF di ogni tipo: apertura, testo, stampa (fogli = pagine, nessuno bianco).
// Tipi: grande (1500 pagine), protetto da password (AES-256), danneggiato (troncato), vuoto, non PDF, moduli,
// tabelle, testo non latino (greco, cirillico, ebraico, arabo), pagine ruotate e miste, più i PDF reali che si
// trovano nella cartella REALI (facoltativa, non nel repository: es. moduli F24, W-9, tabelle W3C).
// Avvio: npx vite build && npx vite preview --port 5211 &
//        REALI=/percorso/pdf-reali node test/e2e/pdf-vari.mjs
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync, readdirSync, copyFileSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const { PDFDocument, StandardFonts, degrees, rgb } = require('@cantoo/pdf-lib');
const fontkit = require('@pdf-lib/fontkit');
const URL = `http://localhost:${process.env.PORT || 5211}/`;
const OUT = resolve('dist/fixtures/vari');
mkdirSync(OUT, { recursive: true });
const results = [];
const check = (name, ok, info = '') => { results.push(ok); console.log(`${ok ? 'OK  ' : 'NO  '} ${name}${info ? ' — ' + info : ''}`); };

// ---------- generazione ----------
const casi = [];
async function salva(nome, doc, atteso, extra = {}) { writeFileSync(join(OUT, nome), await doc.save(extra.saveOpts)); casi.push({ nome, atteso, ...extra }); }
{
  const d = await PDFDocument.create(); const f = await d.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < 1500; i++) d.addPage([595, 842]).drawText(`Pagina ${i + 1} di 1500`, { x: 50, y: 780, size: 14, font: f });
  await salva('grande-1500.pdf', d, 1500, { noPrint: true });
}
{
  const d = await PDFDocument.create(); const f = await d.embedFont(StandardFonts.Helvetica);
  d.addPage([595, 842]).drawText('Documento riservato', { x: 50, y: 780, size: 18, font: f });
  d.encrypt({ userPassword: 'Perù€2026', ownerPassword: 'proprietario', permissions: { printing: 'highResolution' } });
  await salva('protetto.pdf', d, 1, { password: 'Perù€2026' });
}
{
  const d = await PDFDocument.create(); const f = await d.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < 4; i++) d.addPage([595, 842]).drawText(`Pagina ${i + 1}`, { x: 50, y: 780, size: 18, font: f });
  const b = await d.save({ useObjectStreams: false });
  writeFileSync(join(OUT, 'troncato.pdf'), b.slice(0, Math.floor(b.length * 0.8)));
  casi.push({ nome: 'troncato.pdf', atteso: 'riparato' });
}
writeFileSync(join(OUT, 'vuoto.pdf'), new Uint8Array(0)); casi.push({ nome: 'vuoto.pdf', atteso: 'errore' });
writeFileSync(join(OUT, 'non-pdf.pdf'), Buffer.from('PK\u0003\u0004 questo è uno zip')); casi.push({ nome: 'non-pdf.pdf', atteso: 'errore' });
{
  const d = await PDFDocument.create(); const p = d.addPage([595, 842]); const form = d.getForm();
  const t = form.createTextField('nome'); t.setText('Mario Rossi'); t.addToPage(p, { x: 60, y: 700, width: 200, height: 24 });
  const c = form.createCheckBox('privacy'); c.check(); c.addToPage(p, { x: 60, y: 650, width: 16, height: 16 });
  const r = form.createRadioGroup('scelta'); r.addOptionToPage('si', p, { x: 60, y: 600, width: 14, height: 14 }); r.addOptionToPage('no', p, { x: 100, y: 600, width: 14, height: 14 }); r.select('si');
  const dd = form.createDropdown('provincia'); dd.addOptions(['PI', 'LU', 'FI']); dd.select('PI'); dd.addToPage(p, { x: 60, y: 540, width: 120, height: 22 });
  await salva('modulo.pdf', d, 1);
}
{
  const d = await PDFDocument.create(); const f = await d.embedFont(StandardFonts.Helvetica); const p = d.addPage([595, 842]);
  const cols = [60, 260, 340, 430, 500, 560]; const rows = ['Descrizione', 'Servizio di manutenzione', 'Licenza software', 'Formazione'];
  rows.forEach((r, i) => { const y = 760 - i * 24; p.drawText(r, { x: 64, y, size: 10, font: f }); ['Q.tà', '1', '2', '3'][i] && p.drawText(['Q.tà', '1', '2', '3'][i], { x: 264, y, size: 10, font: f }); p.drawText(['Prezzo', '100,00', '250,00', '80,00'][i], { x: 344, y, size: 10, font: f }); p.drawText(['IVA', '22%', '22%', '22%'][i], { x: 434, y, size: 10, font: f }); p.drawText(['Importo', '122,00', '610,00', '292,80'][i], { x: 504, y, size: 10, font: f }); });
  for (let i = 0; i <= 4; i++) p.drawLine({ start: { x: 60, y: 776 - i * 24 }, end: { x: 560, y: 776 - i * 24 }, thickness: 0.6, color: rgb(0, 0, 0) });
  for (const x of cols) p.drawLine({ start: { x, y: 776 }, end: { x, y: 680 }, thickness: 0.6, color: rgb(0, 0, 0) });
  await salva('tabella-fattura.pdf', d, 1);
}
if (existsSync('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf')) {
  const d = await PDFDocument.create(); d.registerFontkit(fontkit);
  const f = await d.embedFont(readFileSync('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'), { subset: false });
  const p = d.addPage([595, 842]);
  ['Ελληνικά: Καλημέρα κόσμε', 'Кириллица: Здравствуй, мир', 'עברית: שלום עולם', 'العربية: مرحبا بالعالم', 'Italiano: perché, città, già'].forEach((t, i) => p.drawText(t, { x: 50, y: 760 - i * 30, size: 16, font: f }));
  await salva('non-latino.pdf', d, 1, { testo: ['Καλημέρα', 'Здравствуй', 'città'] });
}
{
  const d = await PDFDocument.create(); const f = await d.embedFont(StandardFonts.Helvetica);
  const a = d.addPage([595, 842]); a.drawText('Verticale', { x: 50, y: 780, size: 18, font: f });
  const b = d.addPage([842, 595]); b.drawText('Orizzontale', { x: 50, y: 540, size: 18, font: f });
  const c = d.addPage([595, 842]); c.setRotation(degrees(90)); c.drawText('Ruotata 90', { x: 50, y: 780, size: 18, font: f });
  const e = d.addPage([420, 595]); e.drawText('A5', { x: 50, y: 540, size: 18, font: f });
  await salva('ruotate-miste.pdf', d, 4);
}
if (process.env.REALI && existsSync(process.env.REALI)) {
  mkdirSync(join(OUT, 'reali'), { recursive: true });
  for (const n of readdirSync(process.env.REALI).filter((x) => /\.pdf$/i.test(x))) {
    const b = readFileSync(join(process.env.REALI, n));
    if (!b.subarray(0, 1024).toString('latin1').includes('%PDF-')) continue;
    copyFileSync(join(process.env.REALI, n), join(OUT, 'reali', n)); casi.push({ nome: 'reali/' + n, atteso: 'reale' });
  }
}

// ---------- prove nel browser ----------
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1360, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(URL);
await page.waitForFunction(() => !!window.__leggio);
await page.waitForTimeout(800);
for (let i = 0; i < 3 && (await page.evaluate(() => !!document.querySelector('.dlg'))); i++) { await page.keyboard.press('Escape'); await page.waitForTimeout(200); }

for (const c of casi) {
  const e0 = errors.length;
  const apertura = page.evaluate(async (nome) => {
    const app = __leggio; const n0 = app.docs.length;
    const bytes = new Uint8Array(await (await fetch('/fixtures/vari/' + nome)).arrayBuffer());
    const d = await app.openBytes(bytes, { name: nome.split('/').pop() });
    await new Promise((r) => setTimeout(r, 400));
    const dlg = document.querySelector('.dlg')?.textContent || '';
    const doc = d || (app.docs.length > n0 ? app.activeDoc : null);
    let text = '';
    if (doc) { const pg = await doc.pdf.getPage(1); text = (await pg.getTextContent()).items.map((x) => x.str).join(' '); }
    return { pages: doc?.pageCount ?? 0, name: doc?.name ?? null, dlg: dlg.slice(0, 160), text: text.slice(0, 300) };
  }, c.nome);
  if (c.password) {
    await page.waitForSelector('.dlg input[type=password]', { timeout: 15000 });
    await page.fill('.dlg input[type=password]', c.password);
    await page.keyboard.press('Enter');
  }
  const r = await apertura;
  let ok; let info = `${r.pages} pagine${r.name ? ', «' + r.name + '»' : ''}`;
  if (c.atteso === 'errore') ok = r.pages === 0 && /aprire|PDF|vuoto|danneggiato/i.test(r.dlg), info = r.dlg.slice(0, 90);
  else if (c.atteso === 'riparato') ok = r.pages >= 1 && /riparato/.test(r.name || '');
  else if (c.atteso === 'reale') ok = r.pages >= 1;
  else ok = r.pages === c.atteso && (!c.testo || c.testo.every((t) => r.text.includes(t)));
  if (c.testo) info += ` — testo: ${r.text.slice(0, 60)}`;
  // chiude le finestre aperte (errori, riparazione)
  for (let i = 0; i < 3 && (await page.evaluate(() => !!document.querySelector('.dlg'))); i++) { await page.keyboard.press('Escape'); await page.waitForTimeout(150); }
  const nuoviErrori = errors.slice(e0);
  check(`${c.nome}`, ok && !nuoviErrori.length, info + (nuoviErrori.length ? ' — ERRORI: ' + nuoviErrori.join(' | ').slice(0, 200) : ''));
  await page.evaluate(async () => { const app = __leggio; for (const d of [...app.docs]) { d.dirty = false; d.formsDirty = false; await app.closeDoc(d); } });
}
// stampa con preset (senza dialogo) dei documenti con più pagine e ruotati
for (const nome of ['ruotate-miste.pdf', 'modulo.pdf', 'non-latino.pdf', 'tabella-fattura.pdf', ...casi.filter((c) => c.atteso === 'reale').map((c) => c.nome)]) {
  const st = await page.evaluate(async (nome) => {
    const app = __leggio; const bytes = new Uint8Array(await (await fetch('/fixtures/vari/' + nome)).arrayBuffer());
    let snap = null;
    window.print = () => { const root = document.getElementById('print-root'); snap = { n: root.querySelectorAll('img').length, blank: 0, body: root.parentElement === document.body };
      for (const im of root.querySelectorAll('img')) { const cv = document.createElement('canvas'); cv.width = 120; cv.height = 160; const x = cv.getContext('2d'); x.drawImage(im, 0, 0, 120, 160); const dd = x.getImageData(0, 0, 120, 160).data; let dark = 0; for (let k = 0; k < dd.length; k += 4) if (dd[k] < 200 || dd[k + 1] < 200) dark++; if (dark < 3) snap.blank++; } };
    const pdf = await app.lib.pdfjs.getDocument({ data: bytes.slice() }).promise; const n = pdf.numPages; await pdf.destroy();
    await app.printFiles([{ name: nome, bytes }], { preset: { quality: '96' } });
    return { ...snap, pagine: n };
  }, nome).catch((e) => ({ err: e.message }));
  check(`stampa ${nome}: tutte le pagine, nessun foglio bianco`, st && st.n === st.pagine && st.blank === 0 && st.body, JSON.stringify(st));
}
check('nessun errore JavaScript nella pagina', errors.length === 0, errors.join(' | ').slice(0, 300));
await browser.close();
console.log(`\n${results.filter(Boolean).length}/${results.length} superati`);
process.exit(results.every(Boolean) ? 0 : 1);
