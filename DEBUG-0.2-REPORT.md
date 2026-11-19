# Leggio 0.2 — rapporto di debug

Branch: `claude/debug-0.2` (parte da main = 0.2.0). Nessun merge su main, nessuna release pubblicata.
Data: 19 novembre 2026.

## In breve

- **9 bug confermati e corretti**, ognuno riprodotto prima con un test che falliva, poi corretto e verificato.
  **2 sono gravi** (dati personali che restavano nei documenti oscurati) e riguardano funzioni della 0.2 o la loro base.
- Test automatici: **prima 814 superati** (3 saltati) → **dopo 821 superati** (stessi 3 saltati, solo macOS/Windows).
  Collaudi nel browser e nell'app vera: tutti superati, con 1 collaudo nuovo e 5 prove nuove (elenco in fondo).
- Nessuna regressione nelle funzioni della 0.1. Il pacchetto Linux (AppImage) è stato costruito e avviato davvero.
- **Raccomandazione: pubblicare una 0.2.1** (motivi alla fine).

## Metodo

1. **Revisione indipendente** (un agente) del codice cambiato dalla 0.1 alla 0.2 (`c2488b4..main`): IPC di Electron,
   percorsi, file firmati, aggiornamenti, copia fronte/retro, celle delle tabelle, oscuramento, stampa, sito, installer.
   Ha segnalato 10 sospetti: li ho riprodotti uno per uno, 8 erano veri, 2 no (vedi sotto).
2. **Prove come un utente** con Playwright nella build web (1360 px) e nell'**app Electron vera** su xvfb, con PDF reali
   e variegati: 36 PDF della raccolta di prova di pdf.js (moduli AcroForm e XFA, annotazioni, allegati, testo arabo
   e da destra a sinistra, trasparenze, pagine ruotate, file strani) più moduli fiscali veri (W-9, 1040) e la tabella W3C;
   scansioni sintetiche per la copia fronte/retro (ruotate, storte, su fondo scuro, solo fronte, più documenti in un PDF,
   pagine enormi, file protetti, foto PNG/JPG, HEIC, file rovinati); stampa di più pagine; uso prolungato.
3. **Regressioni**: tutti i collaudi della 0.1 e della 0.2 ripetuti alla fine.
4. **Packaging**: AppImage costruita con electron-builder e avviata (apre un PDF dalla riga di comando);
   controllo della configurazione Windows/macOS; aggiornamento 0.1 → 0.2 simulato con il codice vero della 0.1.
5. **Sito**: link, rilevamento del sistema, accessibilità, telefono e tablet, nomi di terzi.

## Bug corretti

| # | Gravità | Bug | Causa | Correzione | Test |
|---|---|---|---|---|---|
| 1 | **alta** | **Oscuramento di testo ebraico/arabo**: coprendo un nome, il nome (e il numero del documento) **restavano nel testo invisibile**, cercabili e copiabili. «Cerca e oscura» disegnava il riquadro nero **dalla parte sbagliata della riga**, lasciando visibile la parola | pdf.js dà il testo da destra a sinistra in ordine logico (il primo carattere è il più a destra): verificato con pdf.js 6 su glifi ebraici disegnati a posizioni note. Leggio collocava le parole da sinistra | Posizioni specchiate per gli elementi `dir: 'rtl'` (`sicurezza/logica/testo.js`, `charSpan`) | `test/oscuramento-rtl.test.js` (4; prima 3 falliti) |
| 2 | **alta** | **Documenti d'identità su pagine ruotate** (`/Rotate 90`, frequente nelle scansioni): il modello copriva le zone sbagliate; con «Dritto» il **codice fiscale restava nel file** | Le zone erano calcolate nello spazio della pagina non ruotata, mentre «come appare nella scansione» si riferisce allo schermo | Orientamento nella pagina = orientamento a schermo − rotazione della vista (`orientamentoNellaPagina`) | collaudo nuovo `test/e2e/redazione-ruotata.mjs` (prima 3/4, dopo 4/4) + test in `sicurezza-documenti-identita.test.js` |
| 3 | media | **Installer Windows** «solo per me»: Leggio diventava il programma predefinito per .pdf/.p7m anche se **Dike, ArubaSign o Acrobat** erano installati per tutti gli utenti (contro quanto dichiarato) | Il controllo leggeva solo HKCU; i programmi installati per tutti sono in HKLM | Controllo su HKCR (vista unita utente + computer) in `build/installer.nsh` | `p7m-originale.test.js` (controllo dello script); prova vera solo su Windows |
| 4 | media | **«Segnala un problema»** lasciava nella mail **nomi di cartelle con spazi** (es. «Studio Legale Bianchi\Causa Rossi contro Verdi») nei messaggi di errore di Node e nel testo libero (`D:\Clienti Bianchi\…`, `/Volumes/Dati Studio/…`) | Le regole riconoscevano i percorsi solo fra virgolette doppie o senza spazi | Percorsi fra apici singoli; nel testo libero si toglie tutto fino all'ultimo separatore dopo unità, rete, cartella personale, `/Users`, `/home`, `/Volumes`… | `segnalazione.test.js` (+1, prima fallito) |
| 5 | media | **Modifica del testo**: interfaccia bloccata per **oltre 20 secondi** su pagine con migliaia di tratti (mappe, disegni tecnici, tratteggi) ed etichette ruotate | Unione dei filetti di costo quadratico, ripetuta per ogni angolo del testo | Si guardano solo gli ultimi tratti allineati; filetti usati solo per testo dritto o a 90° (22,6 s → 0,07 s) | `modifica-tabelle.test.js` (+1) |
| 6 | media | **Copia fronte/retro**: trascinando gli angoli fuori dall'anteprima (tutti sulla stessa linea) un'eccezione **faceva sparire la coppia e quelle successive**, con i loro pulsanti | `raddrizza` lancia un errore su angoli impossibili, non intercettato | Avviso nel riquadro («Angoli non validi…»), elenco intatto, «Crea il PDF» chiede di sistemarli | `test/e2e/copia-documento.mjs` (prima: errore nella pagina) |
| 7 | bassa | **Copia fronte/retro**: un file non valido fra quelli trascinati o scelti **bloccava anche tutti i file dopo** | Ciclo interrotto dal primo errore | Si aggiungono tutti i file buoni; gli scartati sono elencati in un solo messaggio | `copia-documento.mjs` (prima 13/15) |
| 8 | bassa | **Copia fronte/retro**: le coppie tolte con «Togli» **ricomparivano** aggiungendo un altro file; cambiando il tipo di documento si **perdevano gli angoli sistemati a mano** | Le pagine tolte risultavano «libere»; il nuovo rilevamento toccava tutte le pagine | Pagine tolte ricordate; gli angoli spostati a mano restano | `copia-documento.mjs` |
| 9 | bassa | **Copia fronte/retro**: pagine PDF enormi (foto salvate in PDF a 1 pixel = 1 punto, 6000 × 4000 pt) disegnate a 300 dpi: centinaia di MB per pagina, con il rischio di un ritaglio bianco | Risoluzione senza limite (la stampa invece li ha) | Stessi limiti della stampa (`fitScale`): massimo 8000 px / 40 Mpx in uscita, 3000 px in anteprima | prova manuale (il risultato resta corretto) |
| 10 | bassa | **Sito**: su Linux, se GitHub non risponde, la pagina diceva «Linux: presto disponibile» | Pensato prima dell'AppImage della 0.2 | Si propone l'AppImage (il link porta alla pagina delle versioni) | `sito-download.test.js` (+1) |

(10 righe: la 9 è una correzione preventiva, quindi i bug riprodotti e corretti sono 9.)

## Sospetti verificati e NON confermati

- **Permesso di sovrascrittura dal trascinamento** (`internal:grant-dropped`): un codice malevolo nella pagina non può
  usarlo: il ponte del preload accetta solo i canali `file:`/`app:`/`feat:`, e il percorso arriva solo da un vero file
  del sistema (`webUtils.getPathForFile` su un `File` costruito in JavaScript dà una stringa vuota).
- **Aggiornamenti**: solo `https://github.com/lorebiri/leggio/releases/download/…`; versioni confrontate bene
  (0.2.0 < 0.10.0, pre-release); file .p7m/.p7s/.m7m/.tsd mai sovrascritti, anche in maiuscolo o tramite link simbolico.

## Problemi aperti (non corretti)

| Problema | Gravità | Perché |
|---|---|---|
| Celle delle tabelle con testo **ebraico/arabo**: non vengono divise ai filetti (la riga resta un blocco) | bassa | La scrittura da destra a sinistra non è supportata nella modifica (già noto); da fare insieme a quella |
| Copia fronte/retro: dopo «Crea il PDF» lo strumento si chiude; per rifarla con un'altra opzione si ricomincia da capo | bassa | Comportamento comune a tutti gli spazi di lavoro; da decidere se tenerlo aperto |
| Copia fronte/retro con fronte e retro **sulla stessa pagina**: non si possono ritagliare due tessere dalla stessa pagina | bassa | Gli angoli sono per pagina; serve una piccola funzione nuova |
| Linux: electron-builder avvisa che manca `desktopName` (l'icona nella barra può non raggrupparsi con la voce del menu) | bassa | Solo estetico; cambio di configurazione da provare su un desktop Linux vero |
| Sito: cita **Titulus e U-GOV** (come programmi con cui Leggio è compatibile) | — | Non è un confronto; **decide Lorenzo** se toglierli |
| Installer Windows e stampa fisica | — | Da provare su un Windows vero (qui non c'è) |
| `npm audit`: 6 avvisi «moderate» solo negli strumenti di build | bassa | Invariato (vedi rapporti precedenti) |

## Verifiche senza bug

- **Celle delle tabelle su PDF reali**: 36 PDF (moduli fiscali, XFA, annotazioni, testo arabo, trasparenze…), riscrittura
  identica e modifica di 4 blocchi per pagina: nessun errore, 1 sola differenza minima già nota (pdf.js issue13447).
- **Copia fronte/retro**: PDF protetto da password con «àè€», 3 pagine (una con `/Rotate 90`, coppia senza retro),
  fondo nero, tessera a 88°, HEIC nella versione web (messaggio chiaro), pagina 6000 × 4200 pt.
- **Uso prolungato**: 15 aperture/chiusure dello strumento e 15 stampe: memoria stabile (11 → 12 MB), nessun canvas residuo.
- **Aggiornamento 0.1 → 0.2**: il codice degli aggiornamenti della 0.1, sulla risposta vera della release 0.2, propone il
  file giusto per Windows (installer e portatile) e Mac (Apple e Intel); i file nuovi hanno gli stessi nomi.
- **Pacchetto Linux**: AppImage costruita, `verifica-pacchetto` superata, avviata su xvfb con un PDF dalla riga di comando
  (aperto, 6 pagine); voce del menu con `application/pdf` e `application/pkcs7-mime`.
- **Windows/macOS (configurazione)**: icone .ico/.icns dell'app e dei .p7m presenti e valide, associazioni .pdf e
  .p7m/.m7m/.tsd con tipo e icona propri, metadati, entitlements; i .p7m/.p7s/.m7m/.tsd aperti dal sistema arrivano al
  gestore dei file firmati.
- **Sito**: nessun link rotto né ancore mancanti, solo link a GitHub, nessuna immagine senza testo alternativo, titoli in
  ordine, nessun ID doppio, nessuno scorrimento orizzontale a 1280 px, su iPhone, Pixel e iPad (riconosciuti come
  dispositivi mobili, con l'invito a usare il computer); nessun confronto con prodotti di terzi.

## Test prima e dopo

| Controllo | Prima | Dopo |
|---|---|---|
| `npx vitest run` | 814 superati, 3 saltati (75 file) | **821 superati**, 3 saltati (76 file) |
| `npx vite build` | ok | ok |
| CI GitHub (Linux, Windows, macOS) | verde | verde |
| Browser: copia fronte/retro | 13/13 | **18/18** (5 prove nuove; sul codice di prima 15/18) |
| Browser: oscuramento su pagina ruotata (nuovo) | 3/4 | **4/4** |
| Browser: oscuramento documenti d'identità | 9/9 | 9/9 |
| Browser: stampa | 8/8 | 8/8 |
| Browser: PDF di ogni tipo | 14/14 | 14/14 |
| Browser: nucleo | 12/12 | 12/12 |
| Browser: modifica di una cella | 6/6 | 6/6 |
| App vera: .p7m intatto | 6/6 | 6/6 |
| App vera: sola lettura | 11/11 | 11/11 |
| App vera: permessi | 2/2 | 2/2 |
| App vera: stampa | 4/4 | 4/4 |
| App vera: HTML → PDF senza file locali | OK | OK |
| AppImage costruita e avviata | — | OK |

Nota per chi ripete i collaudi nel browser: `nucleo-correzioni.mjs` legge `/fixtures/prova.pdf`, che la build non copia:
prima di avviarlo `mkdir -p dist/fixtures && cp test/fixtures/*.pdf dist/fixtures/`.

## Raccomandazione: pubblicare una 0.2.1

Sì, consiglio una **0.2.1** a breve. I bug 1 e 2 riguardano proprio la promessa dell'oscuramento «vero»: un dato che
l'utente crede tolto resta nel file (documenti con nomi in ebraico o arabo; scansioni con la pagina ruotata, frequenti).
Il 3 tocca chi ha già Dike o Acrobat, cioè il pubblico principale di Leggio. Le altre correzioni sono piccole e a basso
rischio, tutte coperte da test. Prima del rilascio servono, come sempre, la voce in `novita.js`, il merge su main e la
prova dell'installer su un Windows vero (decisioni di Lorenzo).
