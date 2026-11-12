# Area «conversione»

OCR, esportazioni, PDF/A, confronto, lettura ad alta voce, accessibilità. Codice in `src/renderer/features/conversione/`.

## Strumenti

| id | Nome | Categoria |
|---|---|---|
| `ocr` | Rendi ricercabile (OCR) — proposto da solo quando si apre una scansione | converti |
| `export-pdf` | Esporta PDF (scelta del formato) | converti |
| `convert-word`, `export-odt`, `export-excel`, `export-csv`, `export-pptx`, `export-images`, `export-text`, `export-html` | Esportazioni | converti |
| `copy-table` | Copia come tabella (riquadro → appunti/Excel), strumento interattivo | converti |
| `compare` | Confronta file | converti |
| `extract-images` | Estrai immagini | converti |
| `pdfa`, `pdfa-check` | Prepara per la conservazione (PDF/A) · Verifica PDF/A | avanzati |
| `read-aloud` | Leggi ad alta voce (interattivo) | vista |
| `accessibility-check` | Controllo accessibilità | vista |
| `word-count` | Statistiche del documento | vista |

## Servizi per le altre aree (`app.services`)

| Servizio | Cosa fa |
|---|---|
| `ocr(bytes, { langs, pages, skipText=true, deskew, dpi=300, password, progress, report })` → `Uint8Array` | Aggiunge il livello di testo invisibile. `progress` = oggetto di `withProgress` (annullabile). Restituisce gli stessi byte se non c'era nulla da riconoscere. |
| `creaWorkerOcr(langs)` | Worker Tesseract offline già configurato (chiamare `terminate()`). |
| `rilevaScansione(pdf, { max })` | `{ scansione, pagineSenzaTesto, controllate }` |
| `converti(bytes, formato, opts)` | `docx|odt|xlsx|csv|txt|html|pptx` → byte |
| `creaDocx(pagine)` | Word da blocchi strutturati |
| `tabellaDaRiquadro(pageIndex, [x1,y1,x2,y2])` | Righe×colonne del testo nel riquadro (punti PDF), documento attivo |
| `confronta(bytesA, bytesB, opts)` · `rapportoConfronto(res, nomeA, nomeB)` | Differenze a parole + confronto visivo; rapporto HTML |
| `pdfa(bytes, { part: 2|3, ocr, title, lang, password, progress })` → `{ bytes, azioni, avvisi, verifica }` | Conversione PDF/A con verifica |
| `verificaPdfA(bytes, password)` | Preflight PDF/A di base |
| `controllaAccessibilita(bytes, password)` | Elenco dei controlli |

## Scelte tecniche

- **OCR offline**: tesseract.js 7. Worker e core (`tesseract-core-simd-lstm.wasm.js`, wasm incluso) importati con `?url`
  (vite li copia in `assets/`); lingue `4.0.0_best_int` (solo LSTM, compatte e precise) committate in
  `src/renderer/public-assets/ocr/lang/` (ita, eng, fra, deu, spa; ~8,7 MB). `scripts/prepara-ocr.mjs` le riscarica o aggiunge lingue.
  Tutte le risorse sono lette dal renderer (fetch → XHR → IPC `feat:conversione:risorsa` come ripiego per `file://`)
  e passate a Tesseract come **URL blob**; le richieste delle lingue nel worker sono deviate sui blob da un piccolo preambolo.
- Immagine per Tesseract in **PGM** (grigi, non compresso): veloce. Il BMP no: tesseract.js lo ricodifica in JS (lentissimo).
- Rendering per elaborazioni con intento `print` (`comune.js › renderPagina`): non usa `requestAnimationFrame`, quindi va avanti anche a finestra nascosta.
- Livello di testo: Liberation Sans incorporata intera (il sottoinsieme di fontkit fallisce con quel file), testo in modo 3 (invisibile), una parola per volta con `Tm` e `Tz` adattati al riquadro.
- Struttura del testo (`lib/testo.js`): righe → segmenti → taglio XY (colonne) → tabelle (colonne allineate) → paragrafi, titoli (dimensione del corpo), elenchi, grassetto/corsivo dal nome del font.
- Confronto: diff a parole con ancore *patience* + Myers con tetto (`lib/diff.js`), eseguito in un Web Worker.
- xlsx/pptx/odt scritti a mano (`lib/formati.js`) con uno zip senza compressione (`lib/zip.js`); docx con la libreria `docx`.
- PDF/A: XMP, OutputIntent con profilo sRGB generato nel codice, rimozione di script/azioni, annotazioni stampabili,
  Helvetica/Arial non incorporati sostituiti da Liberation Sans incorporata (stesse misure). La verifica è di base, non sostituisce veraPDF.

## Collaudo

`npx vitest run test/conversione` (logica pura). Fixture: `node test/conversione-fixtures.mjs [--grande DIR]` (serve `pdftoppm`).
