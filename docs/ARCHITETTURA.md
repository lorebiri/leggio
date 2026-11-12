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
| Modifica annullabile | `await app.applyEdit('Etichetta', async (bytes, doc) => nuoviBytes, doc?, { signatureWarning? })` — le modifiche allo stesso documento passano da una **coda** (una alla volta); il risultato viene verificato con pdf.js prima di essere accettato (se non si apre, il documento resta com'era e viene lanciato un errore leggibile). **Non** chiamare applyEdit/undo/save dello stesso documento dentro `fn` (attenderebbe sé stessa). Prima della prima modifica di un PDF **firmato** il nucleo chiede una volta «Lavora su una copia / Modifica questo file / Annulla» (le aree non devono più farlo; `signatureWarning: false` per chi aggiunge una firma); se i permessi vietano la modifica avvisa una volta («L'autore ha limitato le modifiche»). |
| Operazione lunga esclusiva | `await app.runExclusive(doc, 'Etichetta', async () => …)` — per chi legge, elabora e poi chiama più funzioni del nucleo senza che altre modifiche si intreccino (non chiamare applyEdit dentro) |
| Documento firmato? | `app.isSigned(doc)` → true se c'è una firma digitale (dizionario con /ByteRange) |
| Aprire file non PDF | `app.registerOpener({ id, name, extensions: ['p7m','tsd'], open(file:{path,name,bytes}, app) })` — vale per Apri, trascinamento, doppio clic nel Finder/Esplora risorse, «Apri con»; `app.openFile({path,name,bytes})` sceglie il gestore. I file trascinati senza gestore continuano ad arrivare su `files:dropped-nonpdf` |
| Modifica con pdf-lib | `await app.editWithPdfLib('Etichetta', async (pdfDoc, PDFLib, doc) => { … })` (ritornare `false` = annulla) |
| Byte correnti (con moduli compilati) | `await app.currentBytes()` |
| Apri nuova scheda | `await app.openBytes(bytes, { name })` |
| Esporta file | `await app.exportFile(bytes, 'nome.docx', [{ name: 'Word', extensions: ['docx'] }])` |
| Salvataggio | `app.registerSaveHook(async (bytes, doc) => bytes, { order })` (trasformazioni al salvataggio, in ordine crescente di `order`, predefinito 50; la cifratura dell'area sicurezza usa 100). Un hook può aggiornare `doc.password`: la verifica dei byte salvati usa il valore aggiornato. Il salvataggio è atomico e verificato (vedi docs/ROBUSTEZZA.md). |
| Strumento | `app.registerTool({ id, name, acrobatName, quickLabel, category, description, icon, keywords, quick, quickOrder, shortcut, needsDoc, hidden, run(app) })` — `acrobatName`: nome usato da Adobe Acrobat (es. «Combina file» per «Unisci PDF»), mostrato tra parentesi e cercabile; per gli id riservati il nucleo ne mette uno predefinito. Gli strumenti compaiono anche nel menu nativo **Strumenti** (per categoria). Gli strumenti `quick` hanno un'etichetta sotto l'icona (`quickLabel`, altrimenti due parole del nome); quelli che non stanno nella barra finiscono in «Altri strumenti» (prima la barra si compatta: via zoom −/+, frecce pagina e Ruota, che restano nel menu Vista; con caratteri grandi gli strumenti rapidi vanno su una seconda riga). La ricerca in «Tutti gli strumenti» ha una classifica (`core/toolsearch.js`): nome esatto o iniziale > parola intera nel nome > nome Acrobat > parole chiave > descrizione > stessa radice; in cima «Risultati migliori», Invio apre il primo. |
| Strumento interattivo (modalità) | `app.registerTool({ …, interactive: { activate(app, optionsEl), deactivate(app) } })` — in activate chiamare `app.viewer.setMode('tool', 'crosshair')` |
| Pannello laterale | `app.registerPanel({ id, title, icon, order, render(container, app) → cleanup? })` |
| Azione su miniature | `app.registerPageAction({ id, label, icon, danger, run(app, pageIndices) })` |
| Pannello destro | `const c = app.openRightPanel('Titolo', { onClose, doc })`, `app.closeRightPanel()` — il pannello **appartiene al documento** (predefinito: quello attivo; `doc: null` = pannello generale) e al cambio di scheda viene chiuso chiamando `onClose` |
| Stato per documento | Al cambio di scheda il nucleo chiude ricerca, strumento attivo e pannello destro del documento precedente ed emette `document:deactivated` `{doc, next}`: le aree chiudano lì barre informative, risultati e pannelli propri (o li ricreino su `document:activated` per il nuovo documento). Le barre inserite in `.center` vengono ingrandite con lo zoom dell'interfaccia |
| Trascinamenti | Con una finestra modale aperta (qualunque elemento in `#overlay-root`), i file lasciati **fuori** dalla finestra vengono ignorati dal nucleo e non arrivano alle aree; dentro la finestra decide la finestra. Ogni modifica che parte da un trascinamento deve passare da `applyEdit` (annullabile) |
| Interfaccia | `app.ui.dialog({ title, fields:[…], validate })`, `confirm`, `prompt`, `choice({ title, message, buttons:[{value,label,primary,danger,left}] })` (pulsanti a parole, es. Salva / Non salvare / Annulla). **Parole**: «Annulla» solo per annullare una modifica; per uscire da un dialogo «Lascia perdere» (predefinito di `dialog`/`confirm`) o «Chiudi»; per fermare un'operazione in corso «Interrompi» (predefinito di `withProgress`), `toast(msg,{kind, action})` (con `action` resta ≥ 10 s e si ferma sotto il mouse), `withProgress(title, async p => { p.set(0.5,'…'); p.signal })`, `contextMenu`, `h(tag, attrs, …children)`, `parsePageRanges` |
| Pagine da stringa | `app.parsePages('1-3, 5')` → indici 0-based (lancia errore leggibile) |
| Liberare un documento pdf.js | **pdf.js 6 non ha più `pdf.destroy()`**: usare `pdf.loadingTask.destroy()` (il nucleo ripristina comunque `pdf.destroy()` sui documenti che apre) |
| Librerie | `app.lib.PDFLib`, `app.lib.pdfjs`, `app.lib.openPdfLib(bytes, pw)`, `app.lib.savePdfLib(doc)`, `app.lib.renderPageToCanvas(pdf, i, scale, opts)` |
| Piattaforma | `app.platform.openFiles({ multiple, filters })`, `saveAs`, `chooseFolder`, `writeInFolder`, `invokeFeature('canale', …)` (→ `feat:canale` nel main) |
| Impostazioni | `app.settings.get(k, def)`, `app.settings.set(k, v)`; campi extra nel dialogo: `app.bus.on('settings:fields', arr => arr.push({ key, field }))` |
| Errori | `app.reportError(err, 'Contesto')`; registro locale: `app.log('info'|'warn'|'error', 'messaggio', dati)` (file ruotato nell'app, Aiuto › Apri cartella dei log) |
| Leggibilità | `app.setUiPrefs({ large, zoom, labels })`, `app.uiZoom`. Lo zoom dell'interfaccia scala barre, pannelli, finestre, menu e avvisi (non la pagina). Nel CSS delle aree: niente testo sotto 13 px, usare le variabili del tema; in modalità grande `html.ui-large` |

### Documento (`app.activeDoc`)
`doc.dirty` è calcolato (versione corrente ≠ versione salvata: annullando fino allo stato salvato torna `false`);
`doc.busy` (operazione in corso), `doc.undoStack`/`redoStack` (sola lettura: `{label, size, where}`),
`doc.undo()`/`doc.redo()` sono **asincroni** (meglio usare `app.undo(doc)`/`app.redo(doc)`).

### Visualizzatore (`app.viewer`)
- `page`, `pageIndex`, `scale`, `zoomIn()`, `rotateView()`, `goToDestination()`, `refresh()`, `setMode('select'|'hand'|'tool', cursor)`.
- `getOverlay(i)` → div sopra la pagina i (sopra testo e moduli). In modalità `tool` cattura il puntatore.
- `getViewport(i)` (PageViewport pdf.js: `convertToPdfPoint`, `convertToViewportPoint`; **pdf.js 6 non ha più
  `convertToViewportRectangle`**: usare `pdfRectToCss` oppure `rectToCss(viewport, rect)` da `core/geometry.js`),
  `clientToPdf(i, clientX, clientY)`, `pdfRectToCss(i, [x1,y1,x2,y2])`, `getPageDiv(i)`.
- `app.viewer.pdfViewer` è il `PDFViewer` di pdf.js; `app.viewer.eventBus` il suo bus. `isRendered(i)` → la pagina i è già disegnata.

**Gli overlay vengono distrutti a ogni nuovo rendering della pagina** (zoom, rotazione): ridisegnarli su
`app.bus.on('page:rendered', ({ pageIndex, overlay, viewport }) => …)`. Lo stato va tenuto nel modello, non nel DOM.

### Eventi (`app.bus`)
`document:loaded|activated|changed|saved|closed` `{doc}` · `page:rendered` `{pageIndex, pageDiv, overlay, viewport}` ·
`page:textlayer` · `page:annotationlayer` · `page:changed` `{pageIndex}` · `viewer:scale` · `viewer:mode` ·
`tool:activated|deactivated` `{id}` · `tools:changed` · `files:dropped-nonpdf` `{files}` · `settings:changed` ·
`document:forms-changed` `{doc}` · `document:open-failed` `{name, message}` · `document:signature-warning` `{doc, choice}` ·
`app:quitting` `{docs}` (prima di chiudere le schede all'uscita) · `app:quit-cancelled` · `document:deactivated` `{doc, next}`.

### Processo main
Canali del nucleo validati (tipi, dimensioni ≤ 2 GB, percorsi assoluti) e accettati solo dalla pagina dell'app.
Il renderer può **sovrascrivere solo file aperti o scelti dall'utente** e scrivere solo in cartelle scelte con il
dialogo. Nei gestori `platform.on(canale, fn)` il valore restituito da `fn` viene ignorato (una promessa che
restituisce oggetti grandi bloccava il renderer); **non inviare grandi Uint8Array come argomenti di eventi**
`webContents.send`: inviare il percorso e far leggere i byte con un `invoke`. Per il collaudo:
`LEGGIO_USER_DATA=/cartella` usa una cartella dati separata.

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
6. Niente rete: tutto deve funzionare offline. Niente telemetria. Unica eccezione: il controllo degli aggiornamenti
   (`electron/updater.cjs`), che fa solo una richiesta GET all'API pubblica delle release di GitHub, senza inviare dati
   dell'utente; se la rete manca l'app funziona comunque.
7. Logica pura (che non tocca il DOM) in file separati, coperta da test vitest (`npm test`).
8. Collaudo: `npx vite build && mkdir -p dist/fixtures && cp test/fixtures/*.pdf dist/fixtures/` poi anteprima
   su http://localhost:5199 (`npx vite preview --port 5199`); in console `window.__leggio` è l'app.
   Esempio: `await __leggio.openBytes(new Uint8Array(await (await fetch('/fixtures/prova.pdf')).arrayBuffer()), {name:'prova.pdf'})`.
