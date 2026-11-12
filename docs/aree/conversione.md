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
| `ocr-folder` | Rendi ricercabile una cartella (OCR in blocco, con ripresa) — solo app desktop | converti |

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
| `estraiTesto(bytes, opts)` → `{ pagine:[{ n, testo, caratteri, senzaTesto, scansione }], numPagine, info, scansione }` | Estrazione leggera per l'indicizzazione, in un Web Worker condiviso (vedi sotto). |
| `creaEstrattoreTesto()` → `{ estrai(bytes, opts), termina() }` | Un estrattore proprio (un worker dedicato, richieste in coda). |
| `ocrCartella({ cartella, destinazione?, langs, dpi, copiaGiaTesto, progress, onFile })` | OCR di una cartella con registro per la ripresa (solo app desktop). |

### Estrazione del testo per l'archivio
- `opts`: `{ password, maxPagine, controllaImmagini=false, signal }`. `senzaTesto` = meno di 20 caratteri visibili;
  `scansione` = senza testo (e, con `controllaImmagini`, con almeno un'immagine: distingue le pagine bianche, costa di più).
- Errori: eccezione con `codice` `'password'` o `'danneggiato'` e messaggio in italiano.
- I byte vengono copiati e trasferiti al worker: chi chiama li conserva.
- Dentro un proprio Web Worker si può usare direttamente la funzione pura:
  `import { estraiTesto } from '../conversione/lib/estrai-testo.js'` con `import * as pdfjs from 'pdfjs-dist'` e
  `globalThis.pdfjsWorker = await import('pdfjs-dist/build/pdf.worker.min.mjs')` (pdf.js gira nello stesso worker,
  senza worker annidati: è ciò che fa `estrai-testo.worker.js`).
- Misure (browser integrato): ~2 ms per un PDF di 2 pagine (200 file in 0,43 s), 300 pagine/1 milione di caratteri in 0,4 s.

### Azioni guidate (area avanzati)
Registrate con `batch:operations`: `conv-ocr` (Rendi ricercabile; i file che hanno già il testo restano com'erano, con nota),
`conv-pdfa` (PDF/A-2b/3b, OCR facoltativo, esito della verifica nella nota), `conv-esporta-docx|txt|xlsx`
(scrivono il file convertito nella cartella scelta nei parametri e lasciano il PDF invariato). I worker OCR sono
condivisi tra un file e l'altro (`poolOcr`, chiusi dopo un minuto di inattività). Se le azioni guidate offriranno
`ctx.scriviFile(nome, byte)` e `ctx.signal`, le esportazioni e l'OCR li useranno già.

## OCR di cartelle intere
Registro `.leggio-ocr.json` nella cartella di destinazione (`Ricercabili/` accanto agli originali, struttura delle
sottocartelle conservata): un file è «finito» se il registro lo segna come fatto/già con testo e dimensione e data
non sono cambiate; alla ripresa viene saltato. Scritture atomiche (file temporaneo + rinomina). Tre file in
parallelo, ciascuno con un worker riusato (riciclato dopo 150 pagine). Un file danneggiato o protetto viene
segnato «errore» e ritentato alla ripresa successiva.

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
