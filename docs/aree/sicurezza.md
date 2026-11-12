# Area «sicurezza»

Codice: `src/renderer/features/sicurezza/` (logica pura in `logica/`, interfaccia in `ui-*.js`, canvas in `codec.js`).
Test: `test/sicurezza-*.test.js` (`npx vitest run test/sicurezza`).

## Strumenti

| id | Nome | Note |
|---|---|---|
| `protect` | Proteggi con password | AES-256 predefinito (AES-128 tra le opzioni di compatibilità), password di apertura e/o limitazioni, indicatore di robustezza, conferma. Al documento aperto (diventa effettiva al salvataggio) o come copia. |
| `unprotect` | Rimuovi protezione | Con limitazioni chiede la password del **proprietario** (verificata su /O e /U, `logica/proprietario.js`). |
| `redact` | Oscura (Redazione) | Strumento interattivo: riquadri, testo selezionato, pagine intere, «Cerca e oscura». Applicazione vera + verifica. |
| `redact-search` | Cerca e oscura | Apre il pannello di ricerca: parole, regex, modelli (CF con carattere di controllo, IBAN mod 97, P.IVA, email, telefono, targa, date, carte con Luhn). Risultati spuntabili uno per uno; P.IVA e date escluse in partenza. Pagine senza testo → proposta di OCR (`app.services.ocr` o strumento `ocr`). |
| `sanitize` | Sanifica documento | Analisi con conteggi + rimozione: metadati Info/XMP, JavaScript e azioni, allegati, commenti, campi nascosti, contenuto dei livelli spenti, PieceInfo/miniature, XFA, versioni precedenti e oggetti orfani. |
| `metadata` | Proprietà e vista iniziale | Titolo, autore, oggetto, parole chiave, applicazione, produttore, date; pannelli, disposizione, zoom e pagina iniziali, titolo nella barra. XMP riscritto coerente. |
| `compress` | Riduci dimensioni file | «Sotto N MB» (ricerca binaria su una scala dpi/qualità, MB decimali), livelli, personalizzato; scala di grigi; copia come scelta predefinita; avviso firme. |
| `attachments` | Allegati (anche pannello laterale) | Elenca, apre (PDF), salva, aggiunge, toglie. Avviso all'apertura «Questo PDF contiene N allegati». |
| `pec` | Prepara per PEC | Più file (documenti aperti + «Aggiungi file…», anche non PDF). Limite del messaggio nelle Impostazioni (`sic.pec.limitMB`, predefinito 30 MB, da verificare col gestore); allegati ×1,37 (base64) + 150 KB di margine. Comprime l'insieme con la qualità migliore che ottiene il minimo numero di invii, poi divide (first-fit decrescente); file troppo grandi da soli → «Dividi». Firmati non compressi. Salva in una cartella con «Invio N - » davanti al nome. |
| `repair` | Ripara PDF | 1) riscrittura con pdf-lib (ignora la xref); 2) ricostruzione dalle pagine leggibili da pdf.js (immagine + testo invisibile). |

## Come funziona l'oscuramento
Per ogni pagina con aree: rendering a 300 dpi (200 oltre 60 pagine) senza rotazione e senza annotazioni, riquadri
disegnati sul canvas; codifica in scala di grigi a 16 livelli senza perdita (Flate) se la pagina non ha colori né
mezzitoni (testo: circa 25 KB a pagina), altrimenti JPEG qualità 0,8; il contenuto della pagina viene **sostituito** da quell'immagine più un livello di testo invisibile con le sole
parole fuori dalle aree (resta ricercabile). Si tolgono annotazioni/campi nelle aree, miniature e dati privati della
pagina, struttura per l'accessibilità (può contenere il testo), termini nei segnalibri e nelle proprietà; poi gli
oggetti orfani (`removeUnreachable`: pdf-lib altrimenti riscrive i vecchi contenuti). Infine `verifyRedaction` riapre
il risultato con pdf.js: nessun testo dentro le aree e nessun termine oscurato in testo, commenti, campi, segnalibri,
metadati, nomi allegati. Se fallisce il file NON viene salvato.

## Cifratura e fork `@cantoo/pdf-lib` 2.11.1 (verificato nei sorgenti)
- `encrypt()` supporta AES-256 (V5/R6, predefinito), AES-128, RC4 (solo con `allowWeakCryptography`).
- **Difetto**: al salvataggio cifra solo i flussi, non le stringhe (Info, segnalibri, campi…): le stringhe restano in
  chiaro e Acrobat/Anteprima/poppler mostrano caratteri senza senso. Rimedio in `encryptAllStrings` (cifriamo noi le
  stringhe prima del salvataggio, senza flussi di oggetti). Verificato con poppler (`pdfinfo`, `pdftotext`) e pdf.js.
- Senza `ownerPassword` il fork usa quella di apertura: generiamo una password proprietario casuale.
- `PDFDocument.load(bytes, { password })` decifra tutto e toglie `/Encrypt`: ogni `editWithPdfLib` produce un file
  **non cifrato**. Il save hook dell'area ri-cifra con le stesse opzioni (protezione fatta in Leggio) o chiede una
  volta se riproteggere un file arrivato già cifrato. L'intenzione è legata ai byte (WeakMap), così Annulla/Ripeti la
  seguono.

## Servizi per altre aree (`app.services`)
```js
await app.services.protect(bytes, { userPassword, ownerPassword, permissions: { stampa: 'high'|'low'|'none', copia, modifica, commenti, moduli, assemblaggio }, algorithm: 'AES-256' }, { password })
await app.services.unprotect(bytes, password)
await app.services.compress(bytes, { level: 'archivio'|'media'|'alta' } | { dpi, quality } | { maxBytes }, …{ gray, removeMetadata, password, signal, onProgress })
  // → { bytes, size, stats, reached }
await app.services.sanitize(bytes, { metadati, javascript, allegati, commenti, campiNascosti, livelliNascosti, datiPrivati, xfa, versioni }) // → { bytes, report }
await app.services.analyzeHidden(bytes) // → conteggi
```
Permessi omessi = consentiti. `compress` richiede il browser (canvas). Dall'area conversione ci si aspetta
`app.services.ocr(bytes, { signal, onProgress }) → bytes` (PDF con testo invisibile).

## Comportamenti chiesti dalla segreteria (secondo giro)
- A fine oscuramento la copia si salva subito (5 clic: Oscura, Cerca e oscura, Cerca, Applica, Oscura definitivamente).
  Se la finestra di salvataggio viene chiusa il risultato non si perde: si sceglie tra salvarlo, aprirlo in una scheda
  o buttarlo via (con conferma). Applicato al documento aperto è una modifica annullabile.
- «Cerca e oscura» appartiene al documento: il titolo ne riporta il nome e il pannello si chiude cambiando scheda.
- «Sotto N MB»: casella «Non scendere sotto una qualità leggibile» (minimo 110 punti per pollice, attiva in
  partenza); sotto 150 punti per pollice il risultato avvisa che le scansioni potrebbero essere poco leggibili e mette
  in evidenza «Apri il risultato … per controllarlo».

## Azioni guidate (`batch:operations`)
| id | Operazione | Note |
|---|---|---|
| `riduci` | Riduci dimensioni file | Livelli o «sotto N MB per file», soglia di leggibilità; file firmati esclusi salvo scelta esplicita. Nota per file: prima → dopo, avvisi. |
| `proteggi` | Proteggi con password | **Sostituisce** l'omonima delle azioni guidate (che usa `doc.encrypt` del fork e lascia le stringhe in chiaro). Stessi parametri (`password`, `stampa`, `copia`). Chiave AES-256 riusata nel lotto: circa 1,8 s → pochi ms a file; si dimentica dopo 2 minuti. |
| `sanifica` | Sanifica | Una casella per voce. |
| `oscura-modelli` | Oscura dati personali | Modelli (CF, IBAN, email, telefono preselezionati) + parole; nessuna conferma uno per uno; **verifica obbligatoria: se fallisce il file non viene salvato** (errore = «Non riuscito»). Pagine scansionate: OCR prima (`app.services.ocr`), oppure file segnalato e non salvato, oppure ignorate (scelta esplicita). Le pagine bianche non contano come scansioni. |

Misura (browser, 1000 file da una pagina con CF, IBAN e 30 righe di testo; catena sanifica → riduci → oscura → proteggi):
1000 file in 219 s (0,22 s a file), 0 errori, heap JS stabile a ~32 MB (campioni ogni 100 file: 31–33 MB,
un picco a 86 MB dovuto alla raccolta della memoria). Le operazioni non tengono stato tra un file e l'altro (salvo la
chiave del lotto): la ripresa dopo un'interruzione la gestisce il motore delle azioni guidate.
