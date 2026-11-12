# Area «commenti»

Tutte le annotazioni sono **vere annotazioni PDF standard** scritte con pdf-lib, con aspetto `/AP` generato
(Highlight, Underline, StrikeOut, Squiggly, Text + Popup, FreeText, Square, Circle, Line con frecce, Polygon,
PolyLine, Ink, Stamp, Caret), autore `/T` (Impostazioni → Nome autore), `/M`, `/CreationDate`, `/NM`, `/Contents`.
Ogni creazione/modifica/eliminazione passa da `app.editWithPdfLib` → sempre annullabile.

## File
| File | Contenuto |
|---|---|
| `geom.js` | logica pura: colori, QuadPoints, unione righe della selezione, smussamento, gomma, nuvola, misure, date PDF, a capo, campi dei timbri |
| `appearance.js` | operatori PDF degli aspetti `/AP` per ogni tipo; timbri predefiniti (`STAMPS`) |
| `annots.js` | pdf-lib: lettura tollerante (`readAllAnnotations`), `createAnnot`, `updateAnnot` (sposta/ridimensiona/colore/testo, anche annotazioni di altri programmi), `deleteAnnots` (con popup e risposte), `addReply`, `setStatus`, `flattenComments`, `deleteAllComments`, `measureSpec` |
| `xfdf.js` | esporta/importa «solo i commenti» (XFDF, compatibile Acrobat), parser XML minimale |
| `model.js` | modello da `page.getAnnotations()` di pdf.js (nel worker), discussioni con risposte e stato, filtri, riepilogo testo/HTML |
| `summary-docs.js` | riepilogo in Word (.docx, libreria `docx`) e PDF (caricato a richiesta) |
| `ui-common.js` | impostazioni `commenti.*`, cache per pagina, conversioni coordinate, controlli della barra opzioni |
| `tools-markup.js` | «Evidenzia testo» (+ Sottolinea, Barra, Ondulato, Inserisci testo, Evidenzia area) e barretta rapida sulla selezione / tasto destro |
| `tools-draw.js` | Nota, Casella di testo (editor in pagina che si allarga), Disegno a mano libera con gomma, Forme |
| `tools-stamp.js` | Timbro (predefiniti italiani, personalizzati con `{data} {ora} {anno} {autore} {numero}`, da immagine), «Timbra più file», timbro sugli altri documenti aperti |
| `tool-select.js` | «Seleziona commenti»: selezione, sposta, maniglie, frecce, Canc, colore, testo, rispondi, stato |
| `panel.js` | pannello «Commenti» (rendering a blocchi da 150) |
| `actions.js` | riepilogo, XFDF, rendi definitivi, elimina tutti |
| `measure.js` | Misura (distanza, perimetro, area, scala) |

## Strumenti (id)
`comments-select`, `highlight` (E), `sticky-note` (N), `free-text` (T), `ink` (D), `shapes`, `stamp`, `stamp-batch`,
`measure` (avanzati), `comments-summary`, `comments-export`/`comments-import` (avanzati), `comments-flatten`,
`comments-delete-all`. Pannello `comments`. Impostazione `commenti.selectionBar`.

## Test
`npx vitest run test/commenti` — logica, pdf-lib + verifica con pdf.js, XFDF, malformati, carico (1000 pagine, 5000 annotazioni).
