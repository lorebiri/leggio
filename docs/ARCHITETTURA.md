# Architettura di Leggio

Leggio è un'app **Electron** (Windows e macOS). Tutto il lavoro sui PDF avviene in locale.

```
electron/main.cjs        processo principale: finestra, menu, dialoghi file, file recenti
electron/preload.cjs     ponte sicuro: window.leggio.invoke('file:*' | 'app:*' | 'feat:*')
electron/features/*.cjs  moduli lato main delle aree (caricati in automatico): register({ ipcMain, app, dialog, getWindow })
src/renderer/core/       nucleo (NON modificare senza accordo col coordinatore)
src/renderer/features/<area>/index.js   ogni area registra qui i propri strumenti
src/renderer/public-assets/             risorse statiche extra → dist/assets-extra/ (es. lingue OCR)
test/                    vitest (node) — test/fixtures contiene PDF di prova (rigenerabili con node test/make-fixtures.mjs)
```

Librerie: **pdf.js** (`pdfjs-dist`, rendering/testo/moduli), **@cantoo/pdf-lib** (fork di pdf-lib con cifratura e
apertura di file protetti), **@pdf-lib/fontkit**, **tesseract.js** (OCR), **docx** (esportazione Word),
**@signpdf/** + **node-forge** (firma digitale PKCS#7, da usare nel processo main).

## API del nucleo per le aree (`app`)

| Cosa | Come |
|---|---|
| Documento attivo | `app.activeDoc` → `{ id, name, path, bytes, password, pdf (PDFDocumentProxy), pageCount, data:{} }` |
| Modifica annullabile | `await app.applyEdit('Etichetta', async (bytes, doc) => nuoviBytes)` |
| Modifica con pdf-lib | `await app.editWithPdfLib('Etichetta', async (pdfDoc, PDFLib, doc) => { … })` (ritornare `false` = annulla) |
| Byte correnti (con moduli compilati) | `await app.currentBytes()` |
| Apri nuova scheda | `await app.openBytes(bytes, { name })` |
| Esporta file | `await app.exportFile(bytes, 'nome.docx', [{ name: 'Word', extensions: ['docx'] }])` |
| Salvataggio | `app.registerSaveHook(async (bytes, doc) => bytes)` (trasformazioni al salvataggio) |
| Strumento | `app.registerTool({ id, name, category, description, icon, keywords, quick, quickOrder, shortcut, needsDoc, run(app) })` |
| Strumento interattivo (modalità) | `app.registerTool({ …, interactive: { activate(app, optionsEl), deactivate(app) } })` — in activate chiamare `app.viewer.setMode('tool', 'crosshair')` |
| Pannello laterale | `app.registerPanel({ id, title, icon, order, render(container, app) → cleanup? })` |
| Azione su miniature | `app.registerPageAction({ id, label, icon, danger, run(app, pageIndices) })` |
| Pannello destro | `const c = app.openRightPanel('Titolo', { onClose })`, `app.closeRightPanel()` |
| Interfaccia | `app.ui.dialog({ title, fields:[…], validate })`, `confirm`, `prompt`, `toast(msg,{kind})`, `withProgress(title, async p => { p.set(0.5,'…'); p.signal })`, `contextMenu`, `h(tag, attrs, …children)`, `parsePageRanges` |
| Pagine da stringa | `app.parsePages('1-3, 5')` → indici 0-based (lancia errore leggibile) |
| Librerie | `app.lib.PDFLib`, `app.lib.pdfjs`, `app.lib.openPdfLib(bytes, pw)`, `app.lib.savePdfLib(doc)`, `app.lib.renderPageToCanvas(pdf, i, scale, opts)` |
| Piattaforma | `app.platform.openFiles({ multiple, filters })`, `saveAs`, `chooseFolder`, `writeInFolder`, `invokeFeature('canale', …)` (→ `feat:canale` nel main) |
| Impostazioni | `app.settings.get(k, def)`, `app.settings.set(k, v)`; campi extra nel dialogo: `app.bus.on('settings:fields', arr => arr.push({ key, field }))` |
| Errori | `app.reportError(err, 'Contesto')` |

### Visualizzatore (`app.viewer`)
- `page`, `pageIndex`, `scale`, `zoomIn()`, `rotateView()`, `goToDestination()`, `refresh()`, `setMode('select'|'hand'|'tool', cursor)`.
- `getOverlay(i)` → div sopra la pagina i (sopra testo e moduli). In modalità `tool` cattura il puntatore.
- `getViewport(i)` (PageViewport pdf.js: `convertToPdfPoint`, `convertToViewportPoint`, `convertToViewportRectangle`),
  `clientToPdf(i, clientX, clientY)`, `pdfRectToCss(i, [x1,y1,x2,y2])`, `getPageDiv(i)`.
- `app.viewer.pdfViewer` è il `PDFViewer` di pdf.js; `app.viewer.eventBus` il suo bus.

**Gli overlay vengono distrutti a ogni nuovo rendering della pagina** (zoom, rotazione): ridisegnarli su
`app.bus.on('page:rendered', ({ pageIndex, overlay, viewport }) => …)`. Lo stato va tenuto nel modello, non nel DOM.

### Eventi (`app.bus`)
`document:loaded|activated|changed|saved|closed` `{doc}` · `page:rendered` `{pageIndex, pageDiv, overlay, viewport}` ·
`page:textlayer` · `page:annotationlayer` · `page:changed` `{pageIndex}` · `viewer:scale` · `viewer:mode` ·
`tool:activated|deactivated` `{id}` · `tools:changed` · `files:dropped-nonpdf` `{files}` · `settings:changed`.

## Categorie strumenti
`crea` · `pagine` · `commenta` · `modifica` · `moduli` · `proteggi` · `converti` · `avanzati` · `vista`.

Id riservati usati dalla schermata iniziale (se l'area li implementa, usare **esattamente** questi):
`create-pdf`, `merge`, `compress`, `ocr`, `sign`, `protect`, `redact`, `convert-word`, `compare`, `fill-sign`, `organize`, `metadata`, `delete-pages` (anche come page action).

## Regole per chi lavora su un'area
1. Si scrive **solo** dentro `src/renderer/features/<area>/`, `electron/features/<area>.cjs`, `test/<area>*.test.js`,
   `docs/aree/<area>.md`. File del nucleo, `package.json` e altre aree: **non toccarli**; se serve un cambiamento
   al nucleo, scriverlo nel proprio rapporto finale.
2. Nessuna dipendenza nuova senza autorizzazione del coordinatore (quelle installate bastano quasi sempre).
3. Testi dell'interfaccia in **italiano**, chiari, senza gergo. Messaggi d'errore che dicono cosa fare.
4. Ogni modifica al documento passa da `applyEdit`/`editWithPdfLib` (così c'è sempre Annulla).
5. Operazioni lunghe con `withProgress` e annullabili tramite `p.signal` / `p.cancelled`.
6. Niente rete: tutto deve funzionare offline. Niente telemetria.
7. Logica pura (che non tocca il DOM) in file separati, coperta da test vitest (`npm test`).
8. Collaudo: `npx vite build && mkdir -p dist/fixtures && cp test/fixtures/*.pdf dist/fixtures/` poi anteprima
   su http://localhost:5199 (`npx vite preview --port 5199`); in console `window.__leggio` è l'app.
   Esempio: `await __leggio.openBytes(new Uint8Array(await (await fetch('/fixtures/prova.pdf')).arrayBuffer()), {name:'prova.pdf'})`.
