// Collaudo della STAMPA con il Chromium di Electron e webContents.printToPDF (stessa impaginazione di
// webContents.print). Carica l'interfaccia compilata (dist/), stampa con app.printFiles, copia #print-root nel
// momento della stampa, lo rimette con body.printing e genera il PDF di stampa: fogli = pagine, nessuno bianco.
// Avvio: npx vite build && xvfb-run -a npx electron test/e2e/stampa-electron.cjs --no-sandbox
const { app, BrowserWindow } = require('electron');
const path = require('node:path');
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 1200, height: 800, webPreferences: { contextIsolation: true, sandbox: true } });
  await win.loadFile(path.join(__dirname, '../../dist/index.html'));
  const js = (s) => win.webContents.executeJavaScript(`(async () => { ${s} })()`);
  await js('for (let i = 0; i < 100 && !window.__leggio; i++) await new Promise((r) => setTimeout(r, 100)); await new Promise((r) => setTimeout(r, 800)); return 1');
  let ok = 0; let tot = 0;
  for (const [kind, n] of [['testo', 5], ['misto', 4], ['trasparenze', 3], ['grande', 2]]) {
    tot++;
    const snap = await js(`
      const a = __leggio; const L = a.lib.PDFLib; const d = await L.PDFDocument.create(); const font = await d.embedFont(L.StandardFonts.Helvetica);
      for (let i = 0; i < ${n}; i++) { const size = '${kind}' === 'grande' ? [2384, 3370] : '${kind}' === 'misto' && i % 2 ? [842, 595] : [595, 842];
        const p = d.addPage(size); p.drawRectangle({ x: 40, y: 40, width: size[0] - 80, height: size[1] - 80, borderColor: L.rgb(0,0,0), borderWidth: 4 });
        if ('${kind}' === 'trasparenze') p.drawRectangle({ x: 100, y: 100, width: 300, height: 300, color: L.rgb(1, 0, 0), opacity: 0.4 });
        p.drawText('Pagina ' + (i + 1), { x: 80, y: size[1] - 160, size: Math.min(...size) / 10, font }); }
      const bytes = await d.save(); let snap = null;
      window.print = () => { const root = document.getElementById('print-root'); const clone = root.cloneNode(true);
        const x = root.querySelectorAll('img'), y = clone.querySelectorAll('img');
        x.forEach((im, k) => { const c = document.createElement('canvas'); c.width = im.naturalWidth; c.height = im.naturalHeight; c.getContext('2d').drawImage(im, 0, 0); y[k].src = c.toDataURL('image/jpeg', .6); });
        snap = { html: clone.innerHTML, parentIsBody: root.parentElement === document.body, n: x.length }; };
      await a.printFiles([{ name: '${kind}.pdf', bytes }], { preset: { quality: '96' } });
      document.getElementById('print-root').innerHTML = snap.html; document.body.classList.add('printing');
      await Promise.all([...document.querySelectorAll('#print-root img')].map((i) => i.decode().catch(() => {})));
      return { parentIsBody: snap.parentIsBody, n: snap.n };`);
    const pdf = await win.webContents.printToPDF({ printBackground: true, pageSize: 'A4', margins: { marginType: 'none' } });
    const r = await js(`document.getElementById('print-root').innerHTML = ''; document.body.classList.remove('printing');
      const bytes = Uint8Array.from(atob('${pdf.toString('base64')}'), (c) => c.charCodeAt(0));
      const doc = await __leggio.lib.pdfjs.getDocument({ data: bytes }).promise; let blank = 0;
      for (let i = 1; i <= doc.numPages; i++) { const pg = await doc.getPage(i); const vp = pg.getViewport({ scale: 1 }); const c = document.createElement('canvas'); c.width = vp.width; c.height = vp.height;
        const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); await pg.render({ canvasContext: x, viewport: vp }).promise;
        const dd = x.getImageData(0, 0, c.width, c.height).data; let dark = 0; for (let k = 0; k < dd.length; k += 4) if (dd[k] < 200) dark++; if (dark < 20) blank++; }
      return { sheets: doc.numPages, blank };`);
    const good = r.sheets === n && r.blank === 0 && snap.n === n && snap.parentIsBody;
    if (good) ok++;
    console.log(`${good ? 'OK  ' : 'NO  '} Electron ${process.versions.electron}, ${kind} ${n} pagine → ${JSON.stringify({ ...r, ...snap })}`);
  }
  console.log(`\n${ok}/${tot} superati`);
  app.exit(ok === tot ? 0 : 1);
});
