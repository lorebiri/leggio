# Rapporto di debug di Leggio

Branch: `claude/debug-completo` (nessun merge su main, nessuna release). Data: 13 novembre 2026.

## In breve

- **52 bug trovati e corretti**, ognuno riprodotto prima della correzione e coperto da un test (vitest o
  collaudo nell'app vera). **8 sono gravi** (gravità alta): 3 falle di sicurezza nel processo principale,
  3 casi di perdita di dati (moduli compilati, Annulla, recupero automatico), l'oscuramento che poteva lasciare
  cercabile una parola coperta e il totale sbagliato delle fatture semplificate.
- Alcuni problemi **non sono stati corretti**, perché servono una decisione di Lorenzo o sono minori (elenco più sotto).
- Test: **prima 633 superati** (3 saltati, 56 file); **dopo 711 superati** (3 saltati, 68 file), più 4 collaudi
  nell'app vera. Build web e build dell'app vanno a buon fine prima e dopo.

## Come è stato provato

- `npm ci` (con `ELECTRON_SKIP_BINARY_DOWNLOAD=1`), `node scripts/prepara-ocr.mjs`, `npx vitest run`, `npx vite build`, `npm audit`.
- L'app **Electron vera** è stata avviata su un display virtuale (xvfb) e pilotata via DevTools:
  `test/e2e/sola-lettura-app.mjs` (11/11), il nuovo `test/e2e/permessi-app.mjs` (2/2) e il nuovo
  `test/e2e/html-pdf-file-locali.cjs`.
- La **versione web** è stata provata con Playwright a 1360 px, a 900 px (larghezza minima della finestra) e
  a 390 px (telefono), in tema chiaro e scuro, con PDF reali: normale, 1500 pagine, protetto da password (anche
  con password con accenti e «€»), con permessi limitati, troncato, vuoto, non-PDF, con xref rotta, ruotato,
  con moduli, con testo greco/cirillico/ebraico/arabo/emoji e con titoli, autori e segnalibri contenenti codice
  HTML malevolo (nessun XSS: tutto viene mostrato come testo). Nessuna perdita di memoria aprendo e chiudendo
  13 volte il PDF da 1500 pagine. Nuovo collaudo `test/e2e/nucleo-correzioni.mjs` (12/12).
- Configurazione di Electron: `contextIsolation`, `sandbox`, `nodeIntegration: false`, CSP restrittiva, navigazione
  e nuove finestre bloccate, permessi del browser negati: **corretta**. I problemi erano nei canali IPC delle aree.

## Bug trovati e corretti

### Processo principale (Electron) e sicurezza

| # | Gravità | Bug | Causa | Correzione |
|---|---|---|---|---|
| 1 | **alta** | Un renderer compromesso (es. da un PDF malevolo che sfruttasse un bug di pdf.js) poteva leggere qualunque file del computer, elencare qualunque cartella e sovrascrivere file (anche aperti in sola lettura) | I canali `feat:conversione:leggi/elenca/esiste/scrivi` accettavano qualsiasi percorso assoluto, senza i permessi del nucleo | Solo dentro le cartelle scelte dall'utente con il dialogo; mai su file in sola lettura; scrittura con `safeWrite` (temporaneo unico) |
| 2 | **alta** | Dalla falla 1 si poteva far avviare un programma qualunque (provato: `/bin/sh` eseguiva comandi) | L'elenco dei «programmi di firma» in userData accettava qualunque eseguibile e la firma con programma esterno lo lanciava sul file | L'elenco accetta solo applicazioni `.app`/`.exe`; più la correzione 1 |
| 3 | **alta** | «Crea PDF da HTML» incorporava nel PDF il contenuto di file locali (provato con un `<iframe src="file://…">`): una fattura o una mail costruita apposta poteva far finire file privati nel PDF | La pagina HTML generata era caricata da `file://` senza restrizioni | La pagina non può caricare altri file locali né la rete (filtro sulle richieste); per un file HTML scelto, solo i file della sua cartella |
| 4 | media | Leggere un PDF per percorso dava il permesso di sovrascriverlo (e lo metteva fra i recenti) | `file:read` chiamava `grantFile` per ogni `.pdf` | Il permesso resta solo per file già scelti dall'utente o fra i recenti |
| 5 | media | Il recupero automatico concedeva la sovrascrittura di un percorso qualsiasi scritto dal renderer nel suo `.json` (anche non PDF) | `app:recovery-read` si fidava del campo `path` | Il main registra lui se il file era scrivibile; al ripristino concede solo in quel caso |
| 6 | media | Firma di file e firma con programma esterno accettavano percorsi mai scelti dall'utente | `sign-files`/`external-sign` non controllavano i permessi | Solo file scelti, cartelle scelte o cartelle dell'archivio |
| 7 | media | «Sostituisci gli originali» delle azioni in blocco poteva sovrascrivere un file aperto in sola lettura | `feat:avanzati:write` non conosceva la sola lettura | Controllo della sola lettura + `safeWrite` |
| 8 | media | I canali delle aree non controllavano chi li chiamava | Solo i canali del nucleo verificavano il mittente | Tutti i canali delle aree accettano solo la pagina dell'app |
| 9 | media | Su Windows, Office → PDF falliva (o poteva eseguire codice) con nomi come «Relazione dell’ufficio.docx» | PowerShell tratta ‘ ’ ‚ ‛ come apici; si raddoppiava solo `'` | Raddoppiati tutti gli apici |
| 10 | media | «Segnala un problema» lasciava nella mail percorsi completi su Windows e nomi di cartelle con spazi (es. nomi di clienti) | Le barre `\` sono raddoppiate nel JSON del registro; le regole non le riconoscevano | Dei percorsi resta solo il nome del file |
| 11 | media | «Segnala un problema» non si apriva affatto (senza messaggi) se una riga del registro aveva un'emoji nel punto di taglio | Il taglio a 220 caratteri spezzava l'emoji e `encodeURIComponent` falliva | Taglio che non spezza i caratteri; ora le ore sono indicate come UTC |
| 12 | media | Un PDF troncato «riparato» mostrava pagine in più e dava errori aprendole | L'albero delle pagine conservava il numero di pagine dell'originale | I conteggi vengono ricalcolati e i riferimenti persi tolti |
| 13 | bassa | Salvare su un collegamento simbolico lo sostituiva con un file normale lasciando vecchio il file vero | `rename` sul link | Si scrive nel file a cui punta |
| 14 | bassa | File con nomi molto lunghi (oltre ~234 byte) non si salvavano, con un messaggio fuorviante | Il nome del temporaneo superava 255 byte | Nome del temporaneo accorciato |
| 15 | bassa | In caso di errore il salvataggio aspettava ~2 s in più per ogni serie di tentativi | Attesa anche dopo l'ultimo tentativo | Tolta |
| 16 | bassa | Il controllo aggiornamenti si fermava se l'orologio era stato messo avanti una volta | Data dell'ultimo controllo nel futuro | Considerata scaduta |
| 17 | bassa | Cartelle il cui nome inizia con «..» (es. «..bozze») risultavano «fuori» dalla cartella scelta | Controllo `startsWith('..')` | Confronto corretto |

### Nucleo dell'interfaccia (src/renderer/core)

| # | Gravità | Bug | Causa | Correzione |
|---|---|---|---|---|
| 18 | **alta** | Valori dei moduli compilati persi alla chiusura senza alcuna domanda, dopo una stampa o uno dei ~40 strumenti che leggono il documento | `currentBytes` segnava i campi come salvati senza segnare il documento come modificato | Il documento resta «modificato» finché non si salva |
| 19 | **alta** | Annulla/Ripeti cancellava i valori dei moduli digitati dopo l'ultima modifica | La cronologia usava i byte senza i campi | I campi si integrano prima di Annulla/Ripeti |
| 20 | **alta** | Ripristinando dal recupero un file già aperto, la copia recuperata veniva cancellata (avviso «Ripristinati 1 documenti») | Veniva riusata la scheda già aperta | La copia si apre a parte come «nome (recuperato).pdf» |
| 21 | media | Ctrl/⌘+Z in un campo di testo (Trova, modulo) annullava la modifica del documento | Scorciatoie gestite prima del controllo «sto scrivendo» | Nei campi di testo resta l'annulla del campo |
| 22 | media | Un solo Esc chiudeva tutte le finestre aperte una sopra l'altra | Ogni finestra ascoltava Esc per conto suo | Pila delle finestre: chiude solo quella in cima |
| 23 | media | Con una finestra aperta, premere N/V/H attivava strumenti dietro; Tab usciva dalla finestra | Mancava il controllo della finestra modale | Scorciatoie ignorate, Tab resta nella finestra |
| 24 | media | La finestra «Apertura in corso» copriva la richiesta della password | Timer dell'avanzamento attivo durante la domanda | Avanzamento nascosto mentre si chiede la password |
| 25 | media | Aprendo due volte insieme lo stesso file si avevano due schede | Controllo dei doppioni prima del caricamento | Le aperture in corso sono condivise |
| 26 | media | Errore «Cannot destructure property 'div'» (visto nel registro dell'app vera) cambiando pagina su una vista non pronta | pdf.js non aveva ancora creato le pagine | La pagina si applica quando la vista è pronta |
| 27 | bassa | Stampa di «pari» su un documento di 1 pagina: «Inviato alla stampa» ma non stampava nulla | Nessun errore se la selezione era vuota | Messaggio chiaro; accettato anche il trattino lungo «1–3» |
| 28 | bassa | Dopo Alt/⌘+Tab con Spazio premuto, ogni clic trascinava la pagina | Stato del tasto non azzerato | Azzerato quando la finestra perde il fuoco |

### Commenti, modifica, moduli, sicurezza

| # | Gravità | Bug | Causa | Correzione |
|---|---|---|---|---|
| 29 | **alta** | Dopo l'oscuramento una parola coperta dal riquadro poteva restare nel testo invisibile, cercabile e copiabile | Posizione delle parole stimata e non verificata | Si tolgono tutte le parole che potrebbero stare sotto il riquadro (meglio perderne qualcuna in più) |
| 30 | media | Evidenziando titolo + testo, il titolo non veniva evidenziato | Scartati i rettangoli più alti della media | Filtro solo su rettangoli anomali veri |
| 31 | media | Su pagine ruotate sottolineato, barrato e ondulato erano disegnati di traverso | Rotazione della pagina ignorata | Seguono la riga sullo schermo |
| 32 | media | Su pagine ruotate caselle di testo, timbri ed etichette di misura apparivano di traverso | Come sopra | Disegnati diritti e ruotati |
| 33 | media | Ogni correzione di testo con lettere non latine aggiungeva ~95 KB al file | Il font Unicode veniva incorporato ogni volta | Riuso del font già presente (~4 KB per modifica) |
| 34 | media | Caselle con valore «Sì» importate da FDF/XFDF venivano tolte; in esportazione sempre «Yes» | Decodifica byte per byte; valore attivo ignorato | Decodifica UTF-8 e valore attivo vero |
| 35 | bassa | Ricerca in modifica sfasata dopo una «İ» turca | Il minuscolo cambia la lunghezza del testo | Mappa degli indici |
| 36 | bassa | Password AES-128 con «€», cirillico o accenti scomposti: errore tecnico in inglese | Limite della libreria | Messaggio in italiano che consiglia AES-256 |
| 37 | bassa | Parole chiave «privacy, firma digitale» salvate senza virgole | La libreria le univa con spazi | Valore scritto così com'è |
| 38 | bassa | Greco e cirillico in caselle di testo e timbri diventavano «?» | Font senza quei caratteri | Font Unicode incorporato (cinese e arabo restano non supportati) |
| 39 | bassa | Il carattere nullo risultava codificabile | Errore in una tabella | Escluso |

### Pagine, archivio, fatture, posta

| # | Gravità | Bug | Causa | Correzione |
|---|---|---|---|---|
| 40 | **alta** | Fattura semplificata: IVA contata due volte nel totale (1,22 € → 1,44 €) su copia di cortesia, Excel e controlli | L'importo comprende già l'IVA | Totale = somma degli importi |
| 41 | media | Fattura semplificata: fornitore e cliente senza nome né P.IVA | Struttura diversa dalla fattura ordinaria | Lettura corretta dei campi |
| 42 | media | «Dividi per dimensione»: dopo una pagina pesante tutti i file successivi erano di una pagina (20 file invece di 2) | Passo di crescita bloccato a 1 | Passo minimo 2 |
| 43 | media | Organizza: duplicando una pagina presa da un altro file, le due copie condividevano commenti e campi | Cache di copia della libreria | Copia una volta e clona le ripetizioni |
| 44 | media | Archivio: importi in formato inglese letti a metà («1,234.56» → 1,23) | Espressione regolare | Formati italiano e inglese, senza numeri presi a metà |
| 45 | bassa | Allegati .eml/PEC con «;» nel nome venivano troncati; caratteri accentati spezzati fra segmenti | Divisione che ignorava le virgolette | Lettura corretta dei parametri |
| 46 | bassa | Fatture XML: il testo CDATA veniva alterato | Entità sciolte anche nel CDATA | CDATA letterale |
| 47 | bassa | Fatture XML in ISO-8859-15: «€» diventava «¤» | Codifica forzata | Decodifica corretta |
| 48 | bassa | CSV degli stati dell'archivio: note che iniziano con = + - @ diventavano formule in Excel | Mancava la protezione | Protette, reimportazione invariata |
| 49–52 | bassa | Data di ricezione (scadenza SdI), nome della pratica di missione, Titulus e raccoglitori: tra mezzanotte e le 2 risultava il giorno prima | Data in UTC invece che locale | Giorno locale |

## Problemi trovati ma NON corretti

| Problema | Gravità | Perché non è corretto |
|---|---|---|
| `npm audit`: 6 vulnerabilità «moderate» (minimatch dentro electron-builder) | bassa | Riguardano solo lo strumento che crea i pacchetti, non l'app installata. L'unica correzione proposta è un salto indietro di versione di electron-builder (incompatibile): **decide Lorenzo** (eventuale `overrides` in package.json = cambio di dipendenze) |
| A 390 px (telefono) il documento resta schiacciato dalla barra laterale | bassa | L'app desktop ha larghezza minima 900 px, dove tutto è a posto; la versione web serve solo al collaudo |
| Oscuramento: su righe lunghe un riquadro può togliere dal testo cercabile anche parole vicine non coperte | bassa | Scelta voluta per sicurezza (meglio perdere testo cercabile che lasciare un dato oscurato); l'immagine della pagina non cambia |
| Testo arabo/ebraico/cinese/emoji scritto con «Aggiungi testo» o nei commenti: glifi mancanti, niente scrittura da destra a sinistra | media | Serve un font più grande e un motore di impaginazione: decisione di prodotto |
| Annullando o scadendo una conversione con Microsoft Office su Windows, Word/Excel possono restare aperti in background | bassa | Non verificabile qui (serve Windows con Office) |
| Rotazione del registro su Windows se il file è bloccato da un altro programma: il registro può superare i 2 MB | bassa | Non riproducibile qui (Linux) |
| Aggiornamenti: un tag di release non nel formato `vX.Y.Z` non viene riconosciuto | bassa | Le release attuali usano quel formato; basta mantenerlo |
| L'elenco «File recenti» controlla ogni file sul disco a ogni modifica del menu: con dischi di rete scollegati può rallentare | bassa | Da misurare su una rete vera |
| Sospetti non confermati: catene di risposte circolari nei commenti, firma visibile su pagine ruotate, date non valide (31 febbraio) accettate nei commenti, anni a 2 cifre («95» → 2095) nella rinomina | bassa | Non riprodotti con certezza; indicati per un controllo futuro |

## Esito di build e test

| | Prima | Dopo |
|---|---|---|
| `npm ci` | ok | ok |
| `npx vitest run` | 633 superati, 3 saltati (56 file) | **711 superati**, 3 saltati (68 file), 0 falliti |
| `npx vite build` | ok | ok |
| App vera: sola lettura (`sola-lettura-app.mjs`) | 11/11 | 11/11 |
| App vera: permessi (`permessi-app.mjs`, nuovo) | 0/2 (falle presenti) | 2/2 |
| App vera: HTML → PDF senza file locali (nuovo) | KO (file incluso nel PDF) | OK |
| Browser: nucleo (`nucleo-correzioni.mjs`, nuovo) | — | 12/12 |
| Registro errori dell'app dopo i collaudi | 1 errore («Cannot destructure property 'div'») | 0 errori |

I 3 test saltati lo erano già prima (test solo per Windows/macOS) e non sono stati toccati.

## Funzionalità (per la presentazione)

Leggio è un programma gratuito per **Windows e macOS** che apre, modifica e firma i documenti PDF.
Non serve un account e non c'è abbonamento. Funziona **senza Internet**: i file non escono mai dal computer.
L'unico collegamento è un controllo facoltativo degli aggiornamenti, una volta al giorno e senza dati personali.

**Leggere**
- Apre uno o più PDF in schede, come un browser, e anche i documenti protetti da password.
- Ripara da solo i file danneggiati o scaricati a metà.
- Zoom, adatta alla pagina o alla larghezza, vista a due pagine come un libro, due documenti affiancati che scorrono insieme.
- Modalità lettura senza barre, tema chiaro e scuro, caratteri e pulsanti grandi.
- Miniature delle pagine, segnalibri, allegati e livelli.
- Ricerca nel testo e ricerca in tutti i PDF di una cartella.
- Lettura ad alta voce e statistiche (parole, caratteri, pagine).

**Commentare**
- Evidenziare, sottolineare e barrare il testo.
- Note, caselle di testo, disegno a mano libera e forme (rettangoli, frecce, nuvole).
- Timbri pronti in italiano («RICEVUTO», «PAGATO», «VISTO SI LIQUIDI»…) o personali, con data e numero automatici; lo stesso timbro su molti file in una volta.
- Misure di distanze e aree sui disegni, in scala.
- Riepilogo dei commenti in Word o PDF; scambio dei commenti con Acrobat (XFDF); commenti resi definitivi.

**Modificare**
- Correggere un refuso o riscrivere un paragrafo con lo stesso carattere del documento.
- Aggiungere testo, immagini, loghi, forme e la data di oggi.
- Trova e sostituisci in tutto il documento; link, anche creati in automatico da indirizzi web ed email.

**Organizzare le pagine**
- Griglia delle miniature per riordinare, ruotare, eliminare, duplicare, estrarre e inserire pagine, anche da altri file o da foto.
- Unire più PDF e foto; dividere per numero di pagine, intervalli, pagine bianche, segnalibri o dimensione massima (per la PEC).
- Numeri di pagina, intestazioni, piè di pagina, filigrane («COPIA», «BOZZA»), sfondi, numerazione degli allegati (Bates), opuscoli, più pagine per foglio, ritaglio e ridimensionamento ad A4.

**Creare PDF**
- Da foto e scansioni (raddrizzate e adattate ad A4), dalla cartella dello scanner, da file di testo.
- Da Word, Excel, PowerPoint e LibreOffice; da pagine web.
- Fascicoli con indice cliccabile, pratiche di missione, pacchetti per la rendicontazione.

**Moduli e firme**
- Compilare qualunque modulo, anche quelli non compilabili, e creare campi compilabili riconoscendoli da soli.
- Riempire i campi con un clic usando i dati personali o quelli dell'ente; importare ed esportare i dati per Excel.
- Firma grafica (disegnata o salvata).
- Firma digitale con certificato (.p12/.pfx) o con il programma di firma già installato (Dike, ArubaSign…); firma di molti file in una volta.
- Buste .p7m e verifica delle firme: chi ha firmato, quando, e se il documento è stato cambiato dopo.

**Proteggere**
- Password di apertura e limiti a stampa, copia e modifica; rimozione della protezione conoscendo la password.
- Oscuramento vero dei dati riservati (codici fiscali, IBAN, email, telefoni…), anche cercandoli in automatico.
- Pulizia del documento da dati nascosti; preparazione per la pubblicazione (Amministrazione Trasparente).
- Riduzione delle dimensioni per la PEC e per i portali.

**Convertire e riconoscere il testo**
- Esportazione in Word, Excel, PowerPoint, LibreOffice, testo, pagina web, CSV e immagini; estrazione delle immagini.
- Copia di una tabella da incollare in Excel.
- OCR: rende ricercabili le scansioni, anche di un'intera cartella, senza Internet (italiano, inglese, francese, tedesco, spagnolo).
- Confronto tra due versioni di un documento.
- PDF/A per la conservazione, con verifica di conformità.

**Ufficio e pubblica amministrazione**
- Archivio d'ufficio sopra le cartelle già in uso, anche di rete o OneDrive.
- Ricerca immediata di fatture, DURC, ordini e PEC; stati, scadenze e registro; pagina «Oggi» con le cose da fare.
- Fatture elettroniche (FatturaPA XML) impaginate, con CIG, CUP, IBAN e allegati; messaggi PEC (.eml) con ricevute e allegati.
- Preparazione per Titulus; dichiarazione di conformità all'originale; rinomina automatica dei file in base al contenuto.
- Azioni guidate su molti file in una volta.

**Accessibilità e sicurezza del lavoro**
- Controllo e preparazione dell'accessibilità per i lettori di schermo; uso completo da tastiera.
- Annulla e Ripeti per ogni modifica.
- Salvataggio sicuro: l'originale non resta mai a metà.
- Recupero automatico dei documenti non salvati dopo un arresto imprevisto.
- Apertura in sola lettura dei documenti d'archivio, senza mai sovrascrivere l'originale.
- Stampa con fronte/retro, copie, pagine scelte e timbro «COPIA» solo sulla carta; stampa di più documenti insieme.
- «Segnala un problema»: prepara una mail per lo sviluppatore, con l'immagine della finestra se la vuoi, senza percorsi personali.
