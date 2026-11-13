// Collaudo nell'app vera: la conversione HTML → PDF non deve incorporare file locali (iframe file://).
// Avvio: npx electron --no-sandbox test/e2e/html-pdf-file-locali.cjs  (su Linux senza schermo: xvfb-run -a …)
// Esito: esce con codice 0 se il PDF prodotto NON contiene il testo del file locale.
const { app, BrowserWindow, dialog } = require('electron');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
const { pathToFileURL } = require('node:url');
const SEGRETO = path.join(os.tmpdir(), 'leggio-segreto.txt');
app.whenReady().then(async () => {
  const av = require('../../electron/features/avanzati.cjs');
  fs.writeFileSync(SEGRETO, 'SEGRETO-DELL-UTENTE-12345');
  const hs = {}; av.register({ ipcMain: { handle: (c, f) => { hs[c] = f; }, removeHandler() {} }, BrowserWindow, dialog, getWindow: () => null, app });
  const r = await hs['feat:avanzati:html-to-pdf']({}, { html: `<h1>Prova</h1><iframe style="width:800px;height:200px" src="${pathToFileURL(SEGRETO).href}"></iframe>` });
  fs.rmSync(SEGRETO, { force: true });
  if (!r.ok) { console.log('conversione non riuscita:', r.error); app.exit(2); return; }
  const pdf = await (await import('pdfjs-dist/legacy/build/pdf.mjs')).getDocument({ data: new Uint8Array(r.value ?? r.result) }).promise;
  const testo = (await (await pdf.getPage(1)).getTextContent()).items.map((i) => i.str).join(' ');
  const ko = testo.includes('SEGRETO-DELL-UTENTE');
  console.log(ko ? 'KO: il PDF contiene il file locale' : 'OK: nessun file locale nel PDF', '—', JSON.stringify(testo));
  app.exit(ko ? 1 : 0);
});
