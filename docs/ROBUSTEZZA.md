# Robustezza, prestazioni e affidabilità

Requisito del titolare: «il programma deve essere robusto, a prova di grandi carichi e bug».
Questo documento descrive come il nucleo protegge il lavoro dell'utente, cosa è stato misurato
(numeri reali, 12/11/2026, MacBook Apple Silicon con 8 GB di RAM, Electron 45.3.1 / Chrome 156,
pdf.js 6.5, @cantoo/pdf-lib 2.11) e quali limiti restano.

## 1. Non perdere mai il lavoro

| Rischio | Protezione | Dove |
|---|---|---|
| Due operazioni insieme, Annulla durante un salvataggio | Coda seriale per documento (`doc.queue`): modifiche, Annulla/Ripeti e salvataggi uno alla volta. Durante un'operazione Annulla/Ripeti/Salva della barra sono disattivati e la barra di stato dice cosa è in corso. | `core/queue.js`, `app.applyEdit` |
| Modifica che produce un file rotto | Il risultato viene aperto con pdf.js **prima** di essere accettato; se non si apre il documento resta com'era. | `app.applyEdit` |
| Chiusura della scheda durante un'operazione | Si attende la fine dell'operazione, poi si chiede «Salva / Non salvare / Annulla». | `app.closeDoc` |
| Cambio di scheda durante un'operazione | La modifica lavora sul documento su cui è partita (non su quello attivo); anche l'«Annulla» dell'avviso. | `app.applyEdit` |
| Crash del renderer, blocco, uscita forzata | **Recupero automatico**: dopo ogni modifica (attesa 4 s; 60 s oltre i 100 MB) e ogni 2 minuti i documenti non salvati vengono copiati in `userData/recupero/<sessione>/`. Al riavvio (o dopo «Ricarica») Leggio propone Ripristina / Non ora / Elimina. Anche da Aiuto › Recupera documenti non salvati. Nel browser: IndexedDB. | `core/recovery.js`, canali `app:recovery-*` |
| Renderer che si blocca o termina | `unresponsive` → «Attendi / Ricarica»; `render-process-gone` → «Ricarica / Esci». La finestra si può chiudere anche se il renderer non risponde. | `electron/main.cjs` |
| Errori imprevisti nel codice | `error`/`unhandledrejection` → avviso non invadente (max uno ogni 8 s) e riga nel registro. Registro ruotato `userData/logs/leggio.log` (2 MB × 4 file), menu Aiuto › Apri cartella dei log. | `core/guard.js`, `electron/core/log.cjs` |
| Salvataggio interrotto, disco pieno, chiavetta tolta, OneDrive | Vedi §2. | `electron/core/safe-write.cjs` |
| PDF firmato modificato per sbaglio | Avviso una volta per documento: «Lavora su una copia / Modifica questo file / Annulla». | `app.applyEdit` |

### Cronologia Annulla senza esaurire la memoria
Ogni passo conserva i byte interi dello stato precedente (pdf-lib riscrive il file intero, un diff non avrebbe senso).
- **App desktop**: le copie oltre 2 MB vanno in una cartella temporanea dell'app (`<temp>/leggio-cronologia/<pid>/`),
  ripulita all'uscita e, all'avvio, eliminando le cartelle di processi non più in vita. In memoria resta solo una chiave.
  La scrittura avviene in sottofondo: la modifica è subito visibile, un Annulla successivo attende che la copia sia al sicuro.
  Tetto su disco: ¼ dello spazio libero, max 4 GB; se il disco fallisce si ripiega sulla memoria.
- **Memoria** (browser, o copie piccole): tetto = 12 % della RAM, fra 96 e 600 MB (e ≤ 35 % del limite dello heap).
- Massimo 40 passi. Se un tetto obbliga a scartare i passi più vecchi compare l'avviso «Cronologia di «…» accorciata…».
  L'ultimo Annulla si scarta solo dopo i Ripeti; un singolo passo più grande del tetto si tiene comunque.
- `doc.dirty` è calcolato dalle versioni: annullando fino allo stato salvato il documento torna «salvato».

## 2. Salvataggio sicuro

1. I byte da salvare (dopo i save hook, in ordine di `order`) vengono **aperti con pdf.js** (documento + prima pagina): se non sono un PDF valido il file su disco non viene toccato.
2. Nel main: file temporaneo nella **stessa cartella** (`.nome.pdf.<casuale>.leggio-tmp`), scritto a blocchi da 16 MB, `fsync`.
3. **Rilettura e confronto byte per byte** del temporaneo (chiavette difettose, dischi di rete, cartelle sincronizzate che troncano).
4. `rename` atomico sull'originale (permessi dell'originale conservati). Su Windows, se il file è aperto da un altro programma
   (antivirus, OneDrive, anteprima di Esplora risorse) `rename` può fallire con EPERM/EBUSY: **6 tentativi** con attese
   60→960 ms; poi **ripiego**: copia di riserva `nome.pdf.leggio-bak` → copia del temporaneo sopra l'originale → verifica →
   eliminazione della riserva. Se anche questo fallisce l'originale viene ripristinato dalla riserva (o, se impossibile,
   il messaggio dice dove si trova la riserva).
5. Messaggi chiari per ENOSPC, EDQUOT, EACCES, EPERM, EBUSY, EROFS, ENOENT (cartella non più raggiungibile: chiavetta
   scollegata, disco di rete), EIO, ENAMETOOLONG, ETIMEDOUT. I temporanei rimasti da salvataggi interrotti vengono eliminati.
6. **File oltre 2 GB**: comportamento definito: non si aprono (messaggio all'apertura, anche trascinandoli) e non si salvano
   (messaggio prima di toccare il disco). Motivo: il documento intero vive nella memoria del renderer e passa via IPC.

Il renderer può sovrascrivere **solo** file aperti o scelti dall'utente (dialoghi, recenti, trascinamento, doppio clic)
e scrivere solo in cartelle scelte con il dialogo.

## 3. File malformati

`test/robustezza-file.test.js` (pdf.js legacy in Node, come nell'app): ogni caso deve rispondere — aprire o rifiutare con
un messaggio chiaro contenente il nome del file — entro il tempo limite, senza eccezioni non gestite.

| Caso | Esito pdf.js | Tempo |
|---|---|---|
| zero byte | rifiutato («è vuoto (0 byte)») | < 50 ms |
| PNG / JPEG / Word / HTML / testo rinominati .pdf | rifiutati («non è un PDF: sembra un'immagine PNG…») | ≤ 2 ms |
| troncato al 10 / 50 / 95 % | rifiutato da pdf.js → **riparato** con pdf-lib (vedi sotto) | ≤ 1 ms |
| xref cancellata, startxref sbagliato o negativo, offset xref a zero | aperto (ricostruzione di pdf.js) | 1–5 ms |
| oggetto Pages o catalogo mancante | rifiutato con messaggio | ≤ 1 ms |
| stream corrotti | rifiutato con messaggio | 1 ms |
| /Length sbagliata, spazzatura prima di %PDF | aperto | 1–9 ms |
| albero delle pagine ciclico, pagina figlia di sé stessa, /Count enorme | aperto senza bloccarsi | ≤ 1 ms |
| cifrato, password giusta / errata / assente | aperto / `PasswordException` con messaggio | 65–76 ms |
| **fuzzing**: 1 000 PDF con byte mutati (seme fisso 20261112; byte casuali, bit invertiti, buchi di zeri, blocchi spostati) | 631 aperti, 369 rifiutati con messaggio, **0 blocchi** | caso peggiore 7 ms |

Riparazione: se pdf.js non apre un file che inizia con `%PDF`, il nucleo prova `pdf-lib` (lettura sequenziale degli oggetti)
e apre il risultato come nuova scheda «nome (riparato).pdf», segnata come modificata, con un avviso che invita a controllare
il contenuto. I quattro troncati del test (50 %, 95 %, compressi al 60 % e 95 %) vengono tutti recuperati.

Nel browser i file aperti mostrano l'avanzamento (subito sopra i 20 MB, dopo 1,2 s altrimenti) con «Annulla».

## 4. Banco di prova di carico

```
npm run test:stress            # genera i PDF (se mancano) e misura in Node
node test/stress/genera.mjs [cartella] [--solo=a.pdf,b.pdf] [--rigenera] [--senza-300mb] [--400mb]
node test/stress/misura.mjs [cartella]
LEGGIO_FUZZ=1000 npx vitest run test/robustezza-file.test.js   # fuzzing più lungo
```
Cartella predefinita: `$LEGGIO_STRESS_DIR` o `~/Developer/leggio-out/robustezza/stress` (**fuori dal repository**: i file
arrivano a centinaia di MB; cancellarli dopo la prova).

File generati: 1 000 e 5 000 pagine di testo; 50 e 67 pagine con immagini RGB non compresse (300 e 400 MB); pagine A0,
lunga 5 m e larga 5 m; 50 pagine con 5 000 annotazioni e 2 000 campi; font Arial Unicode intero (6 426 caratteri distinti);
200 pagine con 3 001 segnalibri e una catena profonda 300 livelli.

### Misure in Node (`misura.mjs`)
| File | MB | Pagine | Apertura pdf.js | Pag. 1 | Ultima pag. | Segnalibri | pdf-lib apri | pdf-lib salva |
|---|---|---|---|---|---|---|---|---|
| annotazioni-campi | 1,9 | 50 | 48 ms | 141 ms | 10 ms | — | 314 ms | 1 183 ms |
| font-molti-glifi | 14,9 | 3 | 7 ms | 310 ms | 21 ms | — | 19 ms | 297 ms |
| immagini-300mb | 300,4 | 50 | 324 ms | 13 ms | 2 ms | — | 269 ms | 477 ms |
| immagini-400mb | 402,6 | 67 | 262 ms | 19 ms | 5 ms | — | 268 ms | 767 ms |
| pagine-1000 | 1,8 | 1 000 | 67 ms | 9 ms | 2 ms | — | 132 ms | 128 ms |
| pagine-5000 | 8,8 | 5 000 | 194 ms | 2 ms | 1 ms | — | 408 ms | 942 ms |
| pagine-giganti | 0,02 | 3 | 1 ms | 16 ms | 0 ms | — | 1 ms | 0 ms |
| segnalibri-profondi | 0,4 | 200 | 7 ms | 1 ms | 1 ms | 3 001 (22 ms) | 69 ms | 90 ms |

### Misure nell'app Electron (finestra reale, comandi via protocollo DevTools)
| Prova | Risultato |
|---|---|
| Avvio con 5 000 pagine da riga di comando | apertura 301 ms, prima pagina disegnata 1,5 s; miniature: 5 000 elementi, 6 canvas vivi |
| 300 MB: lettura dal disco / apertura | 1,0 s / 0,24 s |
| 300 MB: modifica (ruota una pagina) | 1,7–2,4 s ciascuna (4 di fila), copie per Annulla **su disco** |
| 300 MB: Annulla / Ripeti / Salva (scrittura sicura con verifica) | 2,0 s / 2,1 s / 0,74 s (di cui scrittura nel main 1,3 s nel primo salvataggio) |
| 300 MB: trasferimento IPC verso il disco temporaneo / ritorno | 3,1 s / 1,3 s (in sottofondo) |
| 400 MB: apertura / modifica / copia Annulla completata | 1,7 s / 1,66 s / 2,6 s |
| 400 MB: memoria del renderer (RSS, worker pdf.js compreso) | aperto ~1,0 GB di picco; **picco durante applyEdit 1 027 MB**; a riposo dopo 1 modifica 443 MB, dopo 4 modifiche 663 MB, dopo 2 Annulla 125 MB (macOS comprime): le versioni precedenti **non** restano in RAM |
| Crash simulato (processo ucciso con documento da 300 MB modificato) | al riavvio proposto il recupero; ripristino in 5,7 s con la modifica (rotazione) presente; vecchia sessione eliminata |
| Cronologia temporanea del processo ucciso | eliminata al riavvio |
| IPC da codice ostile nella pagina | scrittura fuori dai file concessi, lettura di /etc/passwd, cartella non scelta, chiavi e sessioni con «../», canale interno, `file://` esterno, `window.open('file:///…')`: tutti rifiutati; nessun `require`/`process` nella pagina |

### Misure nel browser (anteprima vite, Chrome del pannello)
| Prova | Risultato |
|---|---|
| 5 000 pagine: miniature | 5 000 elementi leggeri, canvas solo vicino alla vista (≤ 60, misurati 0–9); scorrimento fino in fondo senza crescita della memoria (heap 32 MB) |
| 5 000 pagine: salto alla pagina 4 000 | 1,3 s fino al disegno |
| Apri/chiudi 20 volte un PDF da 1 000 pagine (con miniature) | heap 21,7 → 24,7 MB (senza GC forzato), DOM sempre 155 elementi: nessuna perdita |
| 300 MB nel browser | apertura 2,9 s; modifica 3,5–7,6 s; cronologia in memoria: 1 passo (tetto 600 MB), avviso «cronologia accorciata» |
| 3 001 segnalibri | pannello in 0,5 s (livelli profondi costruiti solo quando si aprono) |
| 50 pagine × 100 annotazioni + 40 campi | pagina 1: 1 200 annotazioni e 200 campi disegnati |

## 5. Sicurezza dell'app Electron
- `contextIsolation`, **`sandbox: true`**, `nodeIntegration: false`, `webviewTag: false`, `navigateOnDragDrop: false`.
- Navigazione: solo `dist/index.html` (o l'URL di sviluppo); tutto il resto bloccato. `setWindowOpenHandler` nega sempre;
  i link http/https/mailto si aprono nel browser **dopo conferma** (eccetto il sito di Leggio); `file:`, `javascript:` e simili mai.
- Permessi del browser negati di default (solo scrittura negli appunti e schermo intero).
- IPC: mittente verificato (solo la pagina dell'app), argomenti validati (tipi, percorsi assoluti, nomi file ripuliti,
  chiavi esadecimali, ≤ 2 GB), errori puliti (niente stack al renderer). Il preload accetta solo canali `file:`/`app:`/`feat:`.
- PDF: pdf.js con `isEvalSupported: false`, senza scripting (nessun scripting manager), link solo tramite il gestore sopra.
- CSP nella pagina (`index.html`): `default-src 'self'`, niente script esterni.
- `backgroundThrottling: false`: un'operazione lunga avviata prima di passare a un'altra app non rallenta a un passo al secondo.

## 6. Problemi trovati e corretti (oltre a quanto richiesto)
- pdf.js 6 non ha più `PDFDocumentProxy.destroy()`: ogni riapertura lasciava in memoria il documento precedente (e
  `Doc.load` lanciava TypeError). Ora `destroyPdf()` → `loadingTask.destroy()`; `pdf.destroy()` ripristinato per compatibilità.
- `convertToViewportRectangle` non esiste più: `pdfRectToCss` usa `rectToCss` (`core/geometry.js`).
- Chiudendo l'ultima scheda la vista teneva il documento distrutto (`activate(null)` non faceva nulla).
- Electron: il renderer si bloccava per minuti aprendo un file dal Finder/riga di comando: il preload restituiva al main world
  la promessa del gestore, e contextBridge copiava in profondità l'intero `Doc`. Ora i gestori non restituiscono nulla.
- `app.reorderPages` produceva «corrupt page tree»: ora ricostruisce l'albero (`core/pagetree.js`).
- `openPdfLib` apriva i file cifrati con sole restrizioni senza decifrarli (file misti); dopo la decifratura restavano il vecchio
  /Encrypt e gli xref stream, e la modifica successiva falliva con «Password incorrect».
- Electron ≥ 32 non ha `File.path`: il trascinamento perdeva il percorso (si doveva sempre «Salva con nome»).

## 7. Limiti noti (onesti)
- I tempi di disegno nel pannello del browser sono poco affidabili quando il pannello è nascosto (requestAnimationFrame
  sospeso): la fluidità dello scorrimento (fotogrammi) **non è stata misurata** in modo affidabile.
- La strategia di ripiego per Windows (EPERM/EBUSY su rename) è coperta da test che simulano gli errori, **non provata su
  Windows reale** né su OneDrive/chiavette reali. Da collaudare su Windows.
- Recupero dopo crash del renderer: provato uccidendo l'intero processo; il dialogo «Ricarica» dopo `render-process-gone`
  non è stato cliccato a mano.
- Documenti oltre ~1 GB: funzionano nei limiti della RAM (picco ≈ 2,5× la dimensione durante una modifica); oltre 2 GB rifiutati.
- La riparazione dei file danneggiati può perdere pagine o immagini: l'utente è avvisato e l'originale non viene toccato.
- La cronologia su disco non è cifrata: contiene copie del documento nella cartella temporanea dell'utente finché l'app è aperta
  (per i documenti protetti da password potrebbe interessare all'area sicurezza).
