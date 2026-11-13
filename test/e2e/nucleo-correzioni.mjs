// Collaudo nel browser delle correzioni del nucleo che si vedono solo con il DOM vero
// (tastiera, finestre modali, recupero, moduli, vista). Avvio:
//   npx vite build && mkdir -p dist/fixtures && cp test/fixtures/*.pdf dist/fixtures/
//   npx vite preview --port 5211
//   NODE_PATH=<cartella con playwright> node test/e2e/nucleo-correzioni.mjs   (PORT=5211 predefinita)
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const URL = `http://localhost:${process.env.PORT || 5211}/`;

const results = [];
const check = (name, ok, info = '') => { results.push({ name, ok }); console.log(`${ok ? 'OK  ' : 'NO  '} ${name}${info ? ' — ' + info : ''}`); };

const browser = await chromium.launch();
async function fresh() {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // anche le promesse rifiutate non gestite contano come errori
  await page.addInitScript(() => { window.__errs = []; addEventListener('unhandledrejection', (e) => window.__errs.push(String(e.reason?.stack || e.reason))); });
  await page.goto(URL);
  await page.waitForFunction(() => !!window.__leggio);
  await page.waitForTimeout(900);
  // dialogo di recupero di sessioni precedenti: si chiude con Esc
  for (let i = 0; i < 3 && (await page.evaluate(() => !!document.querySelector('.dlg'))); i++) { await page.keyboard.press('Escape'); await page.waitForTimeout(200); }
  page.errors = errors;
  return page;
}
const openProva = `(async () => { const d = await __leggio.openBytes(new Uint8Array(await (await fetch('/fixtures/prova.pdf')).arrayBuffer()), { name: 'prova.pdf' }); await new Promise((r) => setTimeout(r, 800)); return d.pageCount; })()`;
const makeForm = `(async () => {
  const L = __leggio.lib.PDFLib; const d = await L.PDFDocument.create(); const p = d.addPage([300, 300]);
  d.getForm().createTextField('nome').addToPage(p, { x: 20, y: 200, width: 200, height: 30 });
  d.addPage([300, 300]);
  return await d.save();
})()`;

try {
  // 1. recupero di un file già aperto
  {
    const page = await fresh();
    await page.evaluate(async () => {
      const app = __leggio;
      const orig = new Uint8Array(await (await fetch('/fixtures/prova.pdf')).arrayBuffer());
      const pd = await app.lib.PDFLib.PDFDocument.load(orig); pd.addPage([200, 200]); const modified = await pd.save();
      window.__discarded = [];
      app.recovery.backend = {
        list: async () => [{ id: 7, name: 'prova.pdf', path: '/home/u/prova.pdf', size: modified.length, time: Date.now(), pages: 0, session: 'vecchia' }],
        read: async () => modified, discard: async (s) => { window.__discarded.push(s); }, remove: async () => {}, write: async () => {},
      };
      window.__origPages = (await app.lib.PDFLib.PDFDocument.load(orig)).getPageCount();
      await app.openBytes(orig, { name: 'prova.pdf', path: '/home/u/prova.pdf' });
      app.recovery.offer(true);
    });
    await page.waitForSelector('.dlg');
    await page.click('.dlg button[type=submit]');
    await page.waitForTimeout(1500);
    const r = await page.evaluate(() => ({ tabs: __leggio.docs.map((d) => [d.name, d.path, d.pageCount, d.dirty]), orig: window.__origPages }));
    const rec = r.tabs.find((t) => t[0] === 'prova (recuperato).pdf');
    check('1 recupero di un file già aperto: la copia recuperata si apre in una scheda a parte', r.tabs.length === 2 && rec && rec[1] === null && rec[2] === r.orig + 1 && rec[3] === true, JSON.stringify(r));
    await page.close();
  }

  // 2-3. moduli: integrazione (stampa/strumenti) e Annulla/Ripeti
  {
    const page = await fresh();
    const r = await page.evaluate(async (makeForm) => {
      const app = __leggio; const bytes = await eval(makeForm);
      const doc = await app.openBytes(new Uint8Array(bytes), { name: 'modulo.pdf' });
      await new Promise((r) => setTimeout(r, 800));
      const id = (await (await doc.pdf.getPage(1)).getAnnotations()).find((a) => a.fieldName === 'nome').id;
      doc.pdf.annotationStorage.setValue(id, { value: 'Mario Rossi' });
      await app.currentBytes(doc);
      const a = { dirty: doc.dirty, formsDirty: doc.formsDirty };
      const doc2 = await app.openBytes(new Uint8Array(bytes), { name: 'modulo2.pdf' });
      await new Promise((r) => setTimeout(r, 800));
      await app.reorderPages([1, 0], 'Riordina', doc2);
      const id2 = (await (await doc2.pdf.getPage(2)).getAnnotations()).find((x) => x.fieldName === 'nome').id;
      doc2.pdf.annotationStorage.setValue(id2, { value: 'Valore digitato' });
      await app.undo(doc2);
      const afterUndo = { formsDirty: doc2.formsDirty };
      await app.redo(doc2);
      const pd = await app.lib.PDFLib.PDFDocument.load(await app.currentBytes(doc2));
      return { a, afterUndo, value: pd.getForm().getTextField('nome').getText() ?? null };
    }, makeForm);
    check('2 moduli integrati nei byte (stampa, strumenti): il documento resta «modificato»', r.a.dirty === true, JSON.stringify(r.a));
    check('3 Annulla/Ripeti con un campo compilato dopo l\'ultima modifica: Ripeti riporta il valore', r.value === 'Valore digitato' && r.afterUndo.formsDirty === false, JSON.stringify(r));
    await page.close();
  }

  // 4. Ctrl+Z dentro un campo di testo
  {
    const page = await fresh();
    await page.evaluate(openProva);
    await page.evaluate(() => __leggio.reorderPages([...Array(__leggio.activeDoc.pageCount).keys()].reverse(), 'Inverti'));
    await page.waitForTimeout(500);
    await page.evaluate(() => __leggio.openFind());
    await page.keyboard.type('abc');
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(600);
    const r = await page.evaluate(() => ({ undo: __leggio.activeDoc.undoStack.length, input: document.querySelector('.findbar input').value }));
    // comando dal menu (Electron) con il fuoco nel campo
    await page.evaluate(() => __leggio.command('undo'));
    await page.waitForTimeout(400);
    const r2 = await page.evaluate(() => __leggio.activeDoc.undoStack.length);
    check('4 Ctrl+Z (tastiera e menu) nel campo Trova annulla il testo, non il documento', r.undo === 1 && r.input !== 'abc' && r2 === 1, JSON.stringify({ ...r, menu: r2 }));
    await page.close();
  }

  // 5. Esc con due finestre sovrapposte; «Tutti gli strumenti» aperto due volte
  {
    const page = await fresh();
    await page.evaluate(openProva);
    await page.evaluate(() => { window.__res = []; __leggio.ui.dialog({ title: 'Primo' }).then((v) => __res.push(['primo', v])); __leggio.ui.choice({ title: 'Secondo', message: 'm' }).then((v) => __res.push(['secondo', v])); });
    await page.waitForTimeout(200);
    await page.keyboard.press('Escape'); await page.waitForTimeout(300);
    const one = await page.evaluate(() => JSON.stringify(__res));
    await page.keyboard.press('Escape'); await page.waitForTimeout(300);
    const two = await page.evaluate(() => JSON.stringify(__res));
    check('5 un Esc chiude solo la finestra in cima', one === '[["secondo",null]]' && two === '[["secondo",null],["primo",null]]', `${one} poi ${two}`);
    await page.evaluate(() => { __leggio.tools.openHub(); __leggio.tools.openHub(); });
    await page.keyboard.press('Escape');
    await page.evaluate(() => { __leggio.command('reading-mode'); document.activeElement?.blur(); });
    await page.keyboard.press('Escape');
    const r = await page.evaluate(() => ({ hubs: document.querySelectorAll('.tools-hub').length, reading: __leggio.el.root.classList.contains('reading') }));
    check('5b «Tutti gli strumenti» aperto due volte: dopo Esc gli altri Esc funzionano ancora', r.hubs === 0 && !r.reading, JSON.stringify(r));
    await page.close();
  }

  // 6. password: l'avanzamento non copre la richiesta
  {
    const page = await fresh();
    const r = await page.evaluate(async () => {
      const L = __leggio.lib.PDFLib; const d = await L.PDFDocument.create(); d.addPage();
      if (typeof d.encrypt !== 'function') return null;
      d.encrypt({ userPassword: 'abc', ownerPassword: 'own' });
      __leggio.openBytes(await d.save(), { name: 'segreto.pdf' });
      await new Promise((r) => setTimeout(r, 2000));
      const inp = document.querySelector('.dlg input[type=password]'); const b = inp.getBoundingClientRect();
      return { top: document.elementFromPoint(b.x + 5, b.y + 5)?.closest('.dlg')?.querySelector('h2')?.textContent, n: document.querySelectorAll('#overlay-root > .backdrop').length };
    });
    check('6 la richiesta della password resta visibile (niente avanzamento sopra)', r === null || r.top === 'Documento protetto', JSON.stringify(r));
    await page.close();
  }

  // 7. due aperture contemporanee dello stesso percorso; 9. stampa «pari» su una pagina
  {
    const page = await fresh();
    const n = await page.evaluate(async () => {
      const b = new Uint8Array(await (await fetch('/fixtures/prova.pdf')).arrayBuffer());
      const [a, c] = await Promise.all([__leggio.openBytes(b, { name: 'prova.pdf', path: '/u/prova.pdf' }), __leggio.openBytes(b, { name: 'prova.pdf', path: '/u/prova.pdf' })]);
      return { tabs: __leggio.docs.filter((d) => d.path === '/u/prova.pdf').length, same: a === c };
    });
    check('7 due aperture contemporanee dello stesso file: una sola scheda', n.tabs === 1 && n.same, JSON.stringify(n));
    await page.evaluate(async () => {
      const L = __leggio.lib.PDFLib; const d = await L.PDFDocument.create(); d.addPage();
      await __leggio.openBytes(await d.save(), { name: 'una.pdf' });
      await new Promise((r) => setTimeout(r, 600));
      window.__prints = 0; window.print = () => { window.__prints++; };
      window.__p = __leggio.print();
    });
    await page.waitForSelector('.dlg input[placeholder*="1-3"]');
    await page.fill('.dlg input[placeholder*="1-3"]', 'pari');
    await page.click('.dlg button[type=submit]');
    await page.waitForTimeout(300);
    const r = await page.evaluate(() => ({ err: document.querySelector('.dlg-error')?.textContent, open: !!document.querySelector('.dlg'), toasts: [...document.querySelectorAll('.toast-msg')].map((t) => t.textContent), errs: window.__errs }));
    check('9 stampa «pari» di un documento di una pagina: errore nel dialogo, niente «Inviato alla stampa»', r.open && /Nessuna pagina/.test(r.err || '') && !r.toasts.includes('Inviato alla stampa'), JSON.stringify(r));
    await page.close();
  }

  // 8. tasti singoli e Tab con una finestra modale aperta
  {
    const page = await fresh();
    await page.evaluate(openProva);
    await page.evaluate(() => { __leggio.ui.choice({ title: 'Modifiche non salvate', message: 'Vuoi salvare?', buttons: [{ value: 'discard', label: 'Non salvare' }, { value: 'save', label: 'Salva', primary: true }] }); });
    await page.waitForTimeout(200);
    const tools = await page.evaluate(() => __leggio.tools.list().filter((t) => t.shortcut?.length === 1).map((t) => t.shortcut));
    for (const k of ['n', 'h', ...tools.slice(0, 5)]) await page.keyboard.press(k);
    await page.waitForTimeout(300);
    const r = await page.evaluate(() => ({ dlg: !!document.querySelector('.dlg'), tool: __leggio.tools.active?.id || null, mode: __leggio.viewer.mode }));
    let escaped = false;
    for (let i = 0; i < 8; i++) { await page.keyboard.press(i % 2 ? 'Shift+Tab' : 'Tab'); if (await page.evaluate(() => !document.activeElement.closest('#overlay-root'))) { escaped = true; break; } }
    for (let i = 0; i < 5; i++) { await page.keyboard.press('Tab'); if (await page.evaluate(() => !document.activeElement.closest('#overlay-root'))) { escaped = true; break; } }
    check('8 con una finestra aperta i tasti singoli non attivano strumenti e Tab resta nella finestra', r.dlg && !r.tool && r.mode === 'select' && !escaped, JSON.stringify({ ...r, escaped }));
    await page.close();
  }

  // 10. Spazio tenuto e cambio di finestra
  {
    const page = await fresh();
    await page.evaluate(openProva);
    await page.evaluate(() => { document.activeElement?.blur(); window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', key: ' ' })); window.dispatchEvent(new Event('blur')); });
    const box = await page.locator('.viewer-container').boundingBox();
    await page.mouse.move(box.x + 200, box.y + 200); await page.mouse.down();
    const panning = await page.evaluate(() => __leggio.el.viewerContainer.classList.contains('panning'));
    await page.mouse.up();
    check('10 Spazio premuto e poi Alt/⌘+Tab: un clic normale non trascina la pagina', !panning);
    await page.close();
  }

  // 11. pagina impostata mentre la vista non ha ancora le pagine (documento appena ricaricato)
  {
    const page = await fresh();
    const r = await page.evaluate(async () => {
      const app = __leggio; const out = [];
      const b = new Uint8Array(await (await fetch('/fixtures/prova.pdf')).arrayBuffer());
      const d = await app.openBytes(b, { name: 'a.pdf' });
      await new Promise((r) => setTimeout(r, 600));
      app.viewer.page = 3;
      await new Promise((r) => setTimeout(r, 300));
      const pdf = await d.openCandidate(d.bytes);
      const old = d.setPdf(pdf);
      app.viewer.saveViewState();
      app.viewer.pdfViewer.setDocument(pdf); // vista senza pagine finché pdf.js non le crea
      try { app.viewer.page = 1; app.viewer.page = 2; } catch (e) { out.push(e.message); }
      try { app.viewer.saveViewState(); } catch (e) { out.push(e.message); }
      await new Promise((r) => setTimeout(r, 800));
      old.loadingTask.destroy();
      return { errors: out, page: app.viewer.page };
    });
    check('11 pagina impostata su una vista appena ricaricata: nessun errore, la pagina si applica dopo', r.errors.length === 0 && r.page === 2 && page.errors.length === 0, JSON.stringify({ ...r, pageerrors: page.errors }));
    await page.close();
  }
} finally {
  await browser.close();
}
const bad = results.filter((r) => !r.ok);
console.log(`\n${results.length - bad.length}/${results.length} prove superate`);
process.exit(bad.length ? 1 : 0);
