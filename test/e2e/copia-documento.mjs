// Collaudo nel browser vero di «Copia documento fronte/retro».
// 1) PDF di due pagine A4 (scansione a 150 dpi: fronte ruotato e spostato, retro su fondo grigio) →
//    lo strumento trova le tessere → «Crea il PDF» → un foglio A4 con fronte sopra e retro sotto, ciascuno
//    largo 85,6 mm e alto 53,98 mm, a 300 dpi, contenuto giusto (foto del fronte a sinistra).
// 2) Due foto PNG trascinate nello spazio di lavoro → stessa cosa.
// Il documento di partenza non viene modificato.
// Avvio: npx vite build && npx vite preview --port 5211 &   node test/e2e/copia-documento.mjs
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

// disegna una scansione A4 (canvas) con una tessera: lato 'fronte' (foto rossa a sinistra) o 'retro' (banda MRZ)
const SCANSIONE = `(lato, { cx, cy, angolo, fondo }) => {
  const dpi = 150, px = dpi / 25.4, W = Math.round(210 * px), H = Math.round(297 * px);
  const c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d');
  g.fillStyle = fondo; g.fillRect(0, 0, W, H);
  const cw = 85.6 * px, ch = 53.98 * px;
  g.translate(cx * px, cy * px); g.rotate(angolo * Math.PI / 180);
  g.beginPath(); g.roundRect(-cw / 2, -ch / 2, cw, ch, 3.18 * px); g.fillStyle = '#a8c4e2'; g.fill();
  if (lato === 'fronte') { g.fillStyle = '#c0392b'; g.fillRect(-cw / 2 + 0.05 * cw, -ch / 2 + 0.2 * ch, 0.27 * cw, 0.65 * ch); }
  else { g.fillStyle = '#1f2b2e'; g.fillRect(-cw / 2 + 0.04 * cw, ch / 2 - 0.32 * ch, 0.92 * cw, 0.26 * ch); }
  g.fillStyle = '#34495e'; for (let i = 0; i < 4; i++) g.fillRect(-cw / 2 + 0.4 * cw, -ch / 2 + (0.25 + i * 0.12) * ch, 0.5 * cw, 0.05 * ch);
  return c;
}`;

async function verificaUscita(nome) {
  return page.evaluate(async () => {
    const app = __leggio; const d = app.activeDoc;
    const L = app.lib.PDFLib; const pd = await L.PDFDocument.load(d.bytes, { updateMetadata: false });
    const pg = pd.getPage(0); const [pw, ph] = [pg.getWidth(), pg.getHeight()];
    // immagini disegnate: dimensioni dalle matrici «cm» del contenuto
    const raw = new TextDecoder('latin1').decode(await (async () => { const cs = pg.node.Contents(); const s = pd.context.lookup(cs.asArray ? cs.asArray()[0] : cs); return L.decodePDFRawStream ? L.decodePDFRawStream(s).decode() : s.contents; })());
    const mm = (v) => (v * 25.4) / 72;
    // per ogni blocco q…Q con un'immagine (Do): prodotto delle matrici «cm» (pdf-lib scrive traslazione e scala a parte)
    const cm = raw.split(/\bq\b/).filter((b) => /\/\S+ Do/.test(b)).map((b) => {
      let M = [1, 0, 0, 1, 0, 0];
      for (const m of b.matchAll(/(-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) cm/g)) {
        const [a, bb, c, dd, e, f] = m.slice(1).map(Number);
        M = [a * M[0] + bb * M[2], a * M[1] + bb * M[3], c * M[0] + dd * M[2], c * M[1] + dd * M[3], e * M[0] + f * M[2] + M[4], e * M[1] + f * M[3] + M[5]];
      }
      return { w: mm(M[0]), h: mm(M[3]), x: mm(M[4]), y: mm(M[5]) };
    });
    const imgs = []; for (const [, o] of pd.context.enumerateIndirectObjects()) if (o?.dict?.get(L.PDFName.of('Subtype')) === L.PDFName.of('Image')) imgs.push([o.dict.get(L.PDFName.of('Width')).asNumber(), o.dict.get(L.PDFName.of('Height')).asNumber()]);
    // contenuto: rendering e colore al centro della «foto» del fronte (a sinistra) e della MRZ del retro (in basso)
    const pdf = await app.lib.pdfjs.getDocument({ data: d.bytes.slice() }).promise; const p1 = await pdf.getPage(1);
    const vp = p1.getViewport({ scale: 2 }); const c = document.createElement('canvas'); c.width = vp.width; c.height = vp.height;
    const x = c.getContext('2d'); await p1.render({ canvasContext: x, viewport: vp }).promise;
    const at = (xmm, ymmFromTop) => [...x.getImageData(Math.round(xmm / 25.4 * 144), Math.round(ymmFromTop / 25.4 * 144), 1, 1).data].slice(0, 3);
    const f = cm.sort((a, b) => b.y - a.y);
    const fr = f[0]; const re = f[1];
    const foto = fr ? at(fr.x + 0.18 * fr.w, 297 - fr.y - fr.h + 0.5 * fr.h) : null;
    const mrz = re ? at(re.x + 0.5 * re.w, 297 - re.y - 0.19 * re.h) : null;
    return { pagine: pd.getPageCount(), formato: [mm(pw), mm(ph)], cm: f, imgs, foto, mrz, nome: d.name, path: d.path };
  });
}

try {
  // ---------- 1) PDF di due pagine ----------
  await page.evaluate(async (SC) => {
    const scan = eval(SC);
    const app = __leggio; const L = app.lib.PDFLib; const d = await L.PDFDocument.create();
    for (const [lato, o] of [['fronte', { cx: 70, cy: 80, angolo: 12, fondo: '#fbfbf8' }], ['retro', { cx: 130, cy: 210, angolo: -6, fondo: '#d8d8d4' }]]) {
      const c = scan(lato, o); const jpg = new Uint8Array(await (await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9))).arrayBuffer());
      d.addPage([595.28, 841.89]).drawImage(await d.embedJpg(jpg), { x: 0, y: 0, width: 595.28, height: 841.89 });
    }
    window.__orig = await d.save();
    await app.openBytes(window.__orig.slice(), { name: 'scansione.pdf' });
    await new Promise((r) => setTimeout(r, 800));
    app.tools.run('copia-documento');
  }, SCANSIONE);
  await page.waitForSelector('.cd-coppia', { timeout: 30000 });
  await page.waitForTimeout(500);
  const stati = await page.$$eval('.cd-stato', (els) => els.map((e) => e.textContent));
  check('fronte e retro trovati da soli nelle due pagine', stati.length === 2 && stati.every((s) => /^Documento trovato\./.test(s)), stati.join(' | '));
  if (process.env.SCHERMATA) await page.screenshot({ path: process.env.SCHERMATA });
  await page.getByRole('button', { name: 'Crea il PDF' }).click();
  await page.waitForFunction(() => __leggio.activeDoc?.name === 'Copia documento fronte-retro.pdf', null, { timeout: 60000 });
  await page.waitForTimeout(500);
  const r = await verificaUscita();
  check('un solo foglio A4', r.pagine === 1 && Math.abs(r.formato[0] - 210) < 0.1 && Math.abs(r.formato[1] - 297) < 0.1, JSON.stringify(r.formato));
  check('fronte e retro stampati a 85,6 × 53,98 mm (scala reale)', r.cm.length === 2 && r.cm.every((q) => Math.abs(q.w - 85.6) < 0.05 && Math.abs(q.h - 53.98) < 0.05), JSON.stringify(r.cm.map((q) => [q.w.toFixed(2), q.h.toFixed(2)])));
  check('centrati, fronte sopra e retro sotto', r.cm[0] && Math.abs(r.cm[0].x + 42.8 - 105) < 0.1 && r.cm[0].y > r.cm[1].y + 53.98);
  check('risoluzione di stampa 300 dpi (1011 × 638 pixel)', r.imgs.length === 2 && r.imgs.every(([w, h]) => w === 1011 && h === 638), JSON.stringify(r.imgs));
  check('ritaglio raddrizzato: la foto rossa del fronte è a sinistra', r.foto && r.foto[0] > 150 && r.foto[1] < 100, JSON.stringify(r.foto));
  check('ritaglio del retro: banda scura della MRZ in basso', r.mrz && r.mrz[0] < 80, JSON.stringify(r.mrz));
  check('il risultato è un documento nuovo, non salvato sopra l\'originale', r.path === null);
  const intatto = await page.evaluate(() => { const o = __leggio.docs.find((d) => d.name === 'scansione.pdf'); return o && !o.dirty && o.bytes.length === window.__orig.length && o.bytes.every((b, i) => b === window.__orig[i]); });
  check('la scansione di partenza non è stata modificata', intatto);

  // ---------- 2) due foto trascinate, bianco e nero ----------
  await page.evaluate(async () => { const app = __leggio; for (const d of [...app.docs]) { d.dirty = false; await app.closeDoc(d); } app.tools.run('copia-documento'); });
  await page.waitForSelector('.cd-vuoto');
  await page.getByLabel('Colori').selectOption('bn');
  await page.evaluate(async (SC) => {
    const scan = eval(SC);
    const dt = new DataTransfer();
    for (const [lato, o, n] of [['fronte', { cx: 150, cy: 240, angolo: 90, fondo: '#ffffff' }, 'fronte.png'], ['retro', { cx: 60, cy: 60, angolo: 3, fondo: '#f0efe9' }, 'retro.png']]) {
      const c = scan(lato, o); const b = await new Promise((r) => c.toBlob(r, 'image/png'));
      dt.items.add(new File([b], n, { type: 'image/png' }));
    }
    document.querySelector('.av-pane').dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
  }, SCANSIONE);
  await page.waitForFunction(() => document.querySelectorAll('.cd-stato').length === 2, null, { timeout: 30000 });
  const st2 = await page.$$eval('.cd-stato', (els) => els.map((e) => e.textContent));
  check('due foto trascinate: fronte (in verticale) e retro trovati', st2.every((s) => /^Documento trovato/.test(s)), st2.join(' | '));
  await page.getByRole('button', { name: 'Crea il PDF' }).click();
  await page.waitForFunction(() => __leggio.activeDoc?.name === 'Copia documento fronte-retro.pdf', null, { timeout: 60000 });
  await page.waitForTimeout(500);
  const r2 = await verificaUscita();
  check('dalle foto: un foglio con due lati in scala reale', r2.pagine === 1 && r2.cm.length === 2 && r2.cm.every((q) => Math.abs(q.w - 85.6) < 0.05), JSON.stringify({ p: r2.pagine, cm: r2.cm, imgs: r2.imgs }));
  check('bianco e nero', r2.foto && Math.abs(r2.foto[0] - r2.foto[1]) < 6 && Math.abs(r2.foto[1] - r2.foto[2]) < 6, JSON.stringify(r2.foto));

  // ---------- 3) file non validi trascinati insieme a foto buone: non fermano le altre ----------
  await page.evaluate(async () => { const app = __leggio; for (const d of [...app.docs]) { d.dirty = false; await app.closeDoc(d); } app.tools.run('copia-documento'); });
  await page.waitForSelector('.cd-vuoto');
  await page.evaluate(async (SC) => {
    const scan = eval(SC);
    const dt = new DataTransfer();
    dt.items.add(new File(['appunti'], 'nota.txt', { type: 'text/plain' }));
    dt.items.add(new File([new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3])], 'rovinata.jpg', { type: 'image/jpeg' }));
    for (const [lato, n] of [['fronte', 'fronte.png'], ['retro', 'retro.png']]) {
      const c = scan(lato, { cx: 100, cy: 120, angolo: 4, fondo: '#ffffff' }); const b = await new Promise((r) => c.toBlob(r, 'image/png'));
      dt.items.add(new File([b], n, { type: 'image/png' }));
    }
    document.querySelector('.av-pane').dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
  }, SCANSIONE);
  await page.waitForFunction(() => document.querySelectorAll('.cd-stato').length === 2 && [...document.querySelectorAll('.dlg')].length, null, { timeout: 30000 }).catch(() => {});
  const st3 = await page.$$eval('.cd-stato', (els) => els.map((e) => e.textContent));
  const msg3 = await page.evaluate(() => [...document.querySelectorAll('.dlg')].map((d) => d.textContent).join(' | '));
  check('un file non valido nel gruppo non ferma gli altri: le due foto buone sono aggiunte', st3.length === 2 && st3.every((s) => /^Documento trovato/.test(s)), st3.join(' | '));
  check('i file scartati sono elencati tutti in un solo messaggio', /nota\.txt/.test(msg3) && /rovinata\.jpg/.test(msg3), msg3);
  await page.keyboard.press('Escape');
  check('nessun errore nella pagina', errors.length === 0, errors.join(' | '));
} catch (e) { check('collaudo completato', false, e.message); }
await browser.close();
console.log(`\n${results.filter(Boolean).length}/${results.length} superati`);
process.exit(results.every(Boolean) ? 0 : 1);
