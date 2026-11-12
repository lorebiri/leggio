# Area «pagine»

Codice: `src/renderer/features/pagine/` (logica pura in `logica/`, interfaccia in `ui/`, stili in `pagine.css`),
`electron/features/pagine.cjs` (foto HEIC su macOS). Test: `test/pagine-*.test.js` (`npx vitest run test/pagine`).

## Cosa c'è

| Strumento (id) | Nome Acrobat | Note |
|---|---|---|
| Organizza pagine (`organize`) | Organizza pagine | Griglia a tutto schermo con miniature grandi (zoom con cursore o Ctrl+rotellina). Selezione con clic, Ctrl/⌘, Maiusc e Ctrl+A. Pulsanti con etichetta e pulsanti sulla miniatura (ruota/elimina). Trascina per riordinare (linea di inserimento, scorrimento automatico) oppure «Sposta alla posizione…» e Alt+frecce. Inserisci (pagina vuota, file PDF/foto, documento aperto), sostituisci, duplica, estrai, inverti. **Pagine bianche** trovate da sole e tolte dopo conferma. Si possono trascinare file dal Finder o da Esplora risorse dentro la griglia, e pagine **su un'altra scheda** (vengono copiate in fondo a quel documento). Annulla/Ripeti interni; «Applica» o «Salva» (⌘S) fanno un solo passo annullabile. |
| Unisci PDF (`merge`) | Combina file | Elenco di PDF **e foto** (JPG, PNG, HEIC, WebP…), riordinabile con le frecce o trascinando. File aggiunti con «Aggiungi file…», trascinandoli o con «Aggiungi i documenti aperti». Intervallo di pagine per ogni file. Un segnalibro per file, con i segnalibri originali annidati sotto. Foto raddrizzate (EXIF) e adattate ad A4. Avviso per i file firmati. Il risultato si apre in una nuova scheda `nome_unito.pdf` e l'originale non viene toccato. |
| Dividi PDF (`split`) | Dividi documento | Ogni N pagine, per intervalli, a ogni pagina bianca, per segnalibri principali o **per dimensione massima** (preimpostazioni PEC/email/portale). Scrive in una cartella. |
| Estrai / Elimina / Ruota / Inserisci / Sostituisci / Duplica / Inverti | Estrai, Elimina, Ruota… | Dialoghi con campo pagine tollerante («1-3; 5», «pari», «ultima»). Elimina può anche cercare le pagine bianche. |
| Ritaglia pagine (`crop`) | Ritaglia pagine | Strumento interattivo: si trascina un riquadro (con le maniglie) e lo si applica a questa pagina, a tutte, alle pari, alle dispari o a un intervallo. Margini in mm, **«Togli margini bianchi»** automatico (analizza il disegno della pagina), «Ripristina originale». |
| Ridimensiona, Più pagine per foglio, Opuscolo | — | Il ridimensionamento sposta anche commenti e campi. N-up e opuscolo creano un nuovo documento. |
| Intestazione e piè di pagina, Numera pagine | Intestazione e piè di pagina | Sei riquadri (clic su un riquadro, poi su un modello: «Pag. 1 di 10», «1/10»…), segnaposto {n} {N} {data} {file}, **anteprima dal vivo** sfogliabile, prima pagina esclusa, **impostazioni salvabili** con un nome. |
| Numerazione degli allegati (`bates`) | Numerazione Bates | Prefisso, cifre, suffisso. Il numero successivo viene ricordato per continuare sul file dopo. |
| Filigrana, Sfondo | Filigrana, Sfondo | Testo (COPIA, BOZZA, ANNULLATO…) o immagine, opacità, inclinazione, posizione su griglia 3×3, sopra o sotto il contenuto, anteprima dal vivo, impostazioni salvabili. |
| Rimuovi numeri e filigrane aggiunti | — | Gli elementi aggiunti da Leggio stanno in flussi marcati `/LeggioTimbro` e si tolgono senza toccare il resto. |
| Etichette di pagina | — | Intervalli con stile (1, i, I, a, A), prefisso, numero iniziale, anteprima. |
| Crea PDF (`create-pdf`) | Crea PDF | Da foto (usa l'elenco di Unisci), da .txt (UTF-8, UTF-16 o Windows-1252) con impaginazione, documento vuoto. Le foto e i .txt trascinati nella finestra (`files:dropped-nonpdf`) propongono di creare un PDF o di aggiungerli al documento aperto. |
| Pannello Segnalibri (`outline`) | — | Sostituisce quello di base. Aggiungi dalla pagina corrente (il testo selezionato diventa il titolo), sotto-segnalibro, rinomina (anche F2 o doppio clic), «Imposta pagina», elimina, trascina sopra/sotto/dentro. Ogni modifica è annullabile. |
| Azioni sulle miniature | — | Ruota a destra/sinistra, Duplica, Estrai, Inserisci pagina vuota dopo, Inserisci da file, Sostituisci, Apri in Organizza, Elimina (`delete-pages`, anche con il tasto Canc). |

## Come funziona
- Le pagine si spostano **in place**: l'albero /Pages viene ricostruito piatto con gli stessi oggetti pagina
  (`impostaOrdine`). Così annotazioni, link e campi modulo restano validi. I campi delle pagine eliminate
  escono dall'AcroForm. Le copie (`clonaPagina`) condividono i contenuti e ricevono campi propri con nome
  distinto (`nome_2`). Le pagine esterne passano da `copiaPagineEsterne`, che rende locali i campi, disattiva
  i link verso pagine non copiate e registra i campi nel modulo di destinazione.
- Tutte le modifiche passano da `app.applyEdit`, tramite `modificaDoc`, che apre e salva pdf-lib con blocchi
  grandi (`parseSpeed`/`objectsPerTick` 1500). Nel browser è circa 10 volte più veloce dei valori predefiniti
  e l'interfaccia resta reattiva.
- Le operazioni lunghe usano `withProgress` e si possono annullare. I cicli cedono il controllo con MessageChannel.
- Le miniature di Organizza vengono disegnate solo quando sono visibili (2 alla volta) e tenute come JPEG in
  memoria. Le miniature già pronte si riusano anche dopo «Applica».

## Tempi misurati (MacBook, 12/11/2026)
In node (`~/Developer/leggio-out/pagine/grandi.mjs`), dove ogni tempo comprende caricamento e salvataggio:
- 1200 pagine con 50 campi: inverti 0,24 s; elimina metà 0,20 s; disposizione Organizza 0,50 s;
  numerazione 0,47 s; ridimensiona 0,47 s; dividi per 20 MB 0,55 s; N-up 0,53 s.
- File da 330 MB (50 immagini): tutte le operazioni tra 0,3 e 0,8 s; dividi per dimensione 1,9 s.

Nel browser (anteprima vite):
- 1200 pagine: Organizza si apre con pause massime di 130 ms. Applicare inversione e rotazione di tutte
  le pagine richiede 1,4 s (pausa massima 340 ms); prima della correzione dei blocchi pdf-lib erano 5,2 s.
- 100 MB (15 pagine-immagine): rotazione 1,1 s, filigrana 2,2 s, numerazione 1,3 s, dividi per 20 MB 1,4 s
  (5 file); unione con il file da 1200 pagine 4,3 s.

## Limiti noti
- N-up e opuscolo non riportano commenti e campi modulo: rimangono solo il contenuto e l'aspetto stampato.
- Filigrane, numeri e testi usano i caratteri standard del PDF: i caratteri fuori da Latin-1 diventano «?».
- La conversione HEIC funziona solo nell'app su macOS (`sips`). Su Windows e nel browser compare un
  messaggio con le alternative.
- Dividi scrive i file nella cartella scelta. Nel browser i file vengono scaricati.
- L'orientamento EXIF 2, 4, 5 e 7 (foto specchiate) non è collaudato su foto reali. Il 3, il 6 e l'8 sì.
- Un documento cifrato, dopo la prima modifica, resta in memoria senza cifratura: la protezione va
  riapplicata al salvataggio (area sicurezza).
- Le anteprime di intestazioni e filigrana usano caratteri simili, non identici, a quelli del PDF.
