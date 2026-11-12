# Area «archivio» — l'archivio d'ufficio

Leggio di solito lavora un file alla volta. L'archivio è la parte che serve a un ufficio amministrativo
(caso concreto: la segreteria amministrativa dell'ICCOM-CNR) che gestisce **migliaia di documenti**:
fatture (PDF, XML FatturaPA, `.xml.p7m`), note di credito, DURC, ordini e determine, missioni, contratti,
PEC (`.eml`), file firmati `.p7m`.

L'archivio lavora **sopra le cartelle che l'ufficio già usa** (anche di rete o OneDrive): Leggio le legge,
crea un indice e **non sposta né modifica mai i file originali**. Tutto ciò che produce (copie timbrate,
copie rinominate, registri) è sempre una copia nuova; nessun file esistente viene sovrascritto.

## Dove si trova nell'interfaccia

| Cosa | Dove |
|---|---|
| **Archivio d'ufficio** (`archivio`) | Strumenti › Strumenti avanzati; vista a tutto schermo con le schede **Oggi** e **Documenti** |
| **Oggi: scadenze e cose da fare** (`archivio-oggi`) | apre direttamente la scheda Oggi |
| **Collega una cartella all'archivio…** (`archivio-cartelle`) | finestra «Cartelle e privacy» |
| Pannello laterale **Archivio** (`archive`, icona a scatola) | ricerca veloce, avanzamento dell'indicizzazione, riepilogo di Oggi |
| Schermata iniziale | con l'archivio attivo compare la sezione **«Oggi in archivio»** sotto i pulsanti principali |
| Impostazioni | preavviso DURC, preavviso fatture, giorni per i «non protocollati», codici fiscali/P.IVA del proprio ente (la durata del DURC viene dal file di regole dell'area avanzati) |

Gli strumenti stanno nella categoria `archivio` («Archivio d'ufficio») del nucleo.

## Cosa fa

### Cartelle e indicizzazione
- **Collega una cartella…** (dialogo del sistema). Più cartelle; una cartella dentro una già collegata non
  si aggiunge due volte, una che ne contiene altre le sostituisce.
- Tipi indicizzati: `.pdf`, `.p7m` (anche annidati, `.xml.p7m`, `.pdf.p7m`), `.xml` (FatturaPA), `.eml` (PEC).
  Si saltano file e cartelle nascosti, i temporanei di Office (`~$…`) e quelli di Leggio.
- **File nuovi rilevati da soli**: le cartelle locali (anche OneDrive) sono sorvegliate con `fs.watch` (macOS e
  Windows): un file copiato compare in pochi secondi (misurati 3,6 s per 18 fatture XML). Tutte le cartelle, comprese
  quelle di rete (`\\server\…` su Windows, `/Volumes/…` su macOS) dove `fs.watch` non è affidabile, hanno anche un
  controllo leggero ogni 90 secondi (solo dimensione e data). Quando arrivano documenti nuovi compare l'avviso
  «Sono arrivati N documenti nuovi» con «Vedi».
- **Incrementale**: si confrontano dimensione e data di ogni file con l'indice; si rilegge solo ciò che è
  nuovo o cambiato. Ogni file letto riceve l'**impronta SHA-256** (calcolata nel processo principale):
  un file spostato o rinominato dentro le cartelle collegate viene riconosciuto e **non viene riletto**.
- **In sottofondo e annullabile** («Interrompi»); **ripresa al riavvio**: quello che è già nell'indice resta,
  al riavvio si leggono solo i file mancanti. Aggiornamento automatico all'avvio e ogni 15 minuti, più
  «Aggiorna ora».
- Contenuto dell'indice per ogni documento: **testo completo** (pagine separate, fino a 400 pagine /
  400.000 caratteri, oltre è segnato «parziale»), **tipo** (fattura, nota di credito, DURC, ordine o
  determina, missione, contratto, PEC, file firmato .p7m, altro), **dati chiave** (fornitore, P.IVA, codice
  fiscale, numero, data, importo, CIG, CUP, scadenza), **firme presenti** (CAdES nelle buste `.p7m` con il
  nome del firmatario; PAdES nei PDF con il nome dichiarato), **pagine**, **scansione senza testo**
  (≥ 80 % delle pagine con meno di 25 caratteri → «da passare all'OCR»), **protetto da password**, errore.
- Riconoscimento: per le fatture XML i dati vengono dalla FatturaPA (lettore dell'area avanzati); per i PDF
  da regole sul testo (`lib/estrai.js`, P.IVA e codice fiscale con controllo del carattere di controllo,
  esclusi i codici del proprio ente, predefiniti quelli del CNR — **da verificare** nelle impostazioni).
  Senza testo (scansioni) il tipo si ricava dal nome del file.

### Ricerca (scheda «Documenti»)
- Ricerca istantanea mentre si scrive: tutte le parole devono esserci; `"frase esatta"`; maiuscole e accenti
  ignorati. Cerca nel testo, nel nome e nel percorso, nei dati (fornitore, P.IVA, numero, CIG, CUP,
  firmatari) e nelle note/etichette d'ufficio.
- Filtri: N. protocollo, tipo, stato (anche le etichette), ordinamento; in «Altri filtri»: data di protocollo,
  UOR, fornitore o P.IVA (suggerimenti con i fornitori **raggruppati per P.IVA**, etichetta = nome più frequente:
  «Delta Lab», «Delta Lab S.n.c.» e «Spett.le Delta Lab» sono un fornitore solo), intervallo di date (data del documento, o del file se manca), CIG/CUP, cartella,
  «Mostra» (scansioni da OCR, firmati, protetti, non letti, senza dati).
- Ordinamento: pertinenza (predefinito quando si cerca), data, arrivati di recente, nome, fornitore,
  importo, scadenza.
- Ogni risultato mostra tipo, dati, stati e segnalazioni e la **frase trovata con la pagina**.
  **Apri** (o doppio clic, o Invio) apre il documento **in sola lettura alla pagina giusta** con la ricerca
  evidenziata (`app.openPath(path, { page, search, readOnly })`): una modifica propone «Lavora su una copia».
- Lista **virtualizzata** (solo le righe visibili sono nel DOM): fluida con migliaia di righe.
  Tastiera: frecce su/giù, Spazio seleziona, Invio apre.

### Protocollo: lo fa Titulus, Leggio legge o annota
All'ICCOM-CNR il protocollo lo fa **Titulus**, il sistema di protocollo informatico del CNR. **Leggio non genera
mai numeri di protocollo**: nessun contatore, nessun numero «successivo».
- **Segnatura letta dal documento.** Se nel testo c'è la segnatura (numero, data, sigla AOO, UOR) il documento
  risulta «Protocollato (Titulus) n. … del …, UOR … — letto dal documento». Al CNR la segnatura è spesso una
  **striscia-immagine** verticale sul margine sinistro della pagina 1 (forma `Prot. CNR n. NNNNNNN del gg/mm/aaaa -
  UOR: XX000000`): durante l'indicizzazione si individua soltanto la striscia candidata (immagine stretta e alta
  vicino a un bordo, dall'elenco delle operazioni di disegno di pdf.js, `lib/striscia.js`); la lettura avviene in
  una **coda a parte a bassa priorità** dopo l'indicizzazione del testo: un documento alla volta, nei momenti
  liberi, in pausa se riparte l'indicizzazione, annullabile, ripresa al riavvio. Nel frattempo il documento è
  «Protocollo: da leggere». Lettura: prima `app.services.segnaturaTitulus` dell'area avanzati (modello
  configurabile; oggi `app.services.leggiSegnaturaTitulus(bytes)`, che legge da sola testo e striscia di PDF e
  .p7m), altrimenti il ripiego dell'archivio: si disegna solo il riquadro della striscia con pdf.js, lo si
  raddrizza (con le annotazioni: la striscia può essere un timbro) e lo si passa a Tesseract (`app.services.creaWorkerOcr`, modalità riga singola), poi il modello generico (`lib/segnatura.js`;
  nell'UOR le I lette come 1 vengono corrette). Leggere non modifica nulla: i file firmati restano identici.
- **Numero inserito dall'utente**: «Cambia stato… › Protocollato (Titulus)»: per un documento si scrive o incolla
  il numero (e la data); per più documenti si incolla un elenco «nome del file → numero [→ data]» (tabulazioni,
  «;», «→», o due colonne copiate da Excel). Un numero inserito a mano vale più di quello letto.
- La segnatura letta vale «protocollato» anche se il documento era segnato «Da protocollare (in Titulus)».
- Dall'archivio le Azioni guidate **non** offrono il timbro di protocollo (numererebbe i file da sé).
- Ricerca: filtro **N. protocollo** (senza badare agli zeri iniziali) e, in «Altri filtri», **data di protocollo**
  (dal/al) e **UOR**; ordinamento per N. protocollo; il numero si trova anche scrivendolo nella ricerca libera.
  Registro Excel/CSV con le colonne **N. protocollo, Data protocollo, UOR, Origine** (letto dal documento /
  inserito a mano).

### Stati e note d'ufficio
«Da protocollare (in Titulus)», «Protocollato (Titulus) n. …», «Da firmare», «Firmato», «Da pagare», «Pagato», «Pubblicato»,
«Archiviato», più **etichette libere** e una **nota**.
- Si salvano **nell'archivio di Leggio, mai nel PDF** (i file firmati restano intatti).
- Sono legati all'**impronta** del file: sopravvivono a rinomina e spostamento. Se un file cambia contenuto
  nello stesso percorso (es. timbrato da un altro programma), lo stato lo segue.
- **Su più documenti insieme** e **più stati in una volta** (selezione multipla → «Cambia stato…» con le caselle,
  «Etichette e nota…»).
- **Esporta / Importa** (Cartelle e privacy): JSON (backup) o CSV per Excel (`;`), con impronta, nome e
  percorso per riconoscere i file a occhio. All'importazione si sceglie «vince il più recente» o «vincono
  quelli importati»; gli stati di file non ancora presenti si applicano quando compariranno.

### Oggi (scadenzario)
- **DURC scaduti o in scadenza**: per ogni fornitore conta solo il DURC più recente. Se nel documento non c'è
  la data di scadenza, si calcola dalla data del documento + **durata impostabile** (predefinita 120 giorni,
  validità del DURC online secondo il D.M. 30/01/2015 — *da verificare sulla normativa vigente*, per questo
  è un'impostazione e non una regola fissa). Preavviso impostabile (predefinito 15 giorni).
- **Fatture in scadenza (dai dati della fattura)**: proposte anche se nessuno le ha segnate, dalla
  DataScadenzaPagamento delle FatturaPA o dalla scadenza riconosciuta nei PDF: entro N giorni (impostazione,
  predefinito 15) o scadute da non più di 30 giorni, non segnate «Da pagare», «Pagato» o «Archiviato».
- **Fatture da pagare** (stato «Da pagare») con la scadenza: scadute in rosso, vicine in arancio.
- **Da protocollare in Titulus** (promemoria: il protocollo si fa in Titulus; un documento che torna con la
  segnatura sparisce da qui da solo), **Da firmare**.
- **Arrivati dall'ultima apertura**: documenti entrati nell'indice dopo l'avvio precedente (alla prima
  indicizzazione la soglia è la sua fine: i file che arrivano dopo compaiono subito).
- Ogni voce si apre con un clic; «Vedi tutti» apre la ricerca già filtrata.

### Azioni sui documenti selezionati
Tutto ciò che si apre dall'archivio (risultati, «Oggi», doppio clic, Invio) si apre **in sola lettura**
(`readOnly: true`): ogni modifica propone «Lavora su una copia» e Salva diventa Salva con nome; l'originale non si
sovrascrive (provato nell'app). I .p7m e le fatture XML si aprono senza percorso (contenuto estratto): Salva chiede
sempre dove salvare.
- **Stampa…**: i selezionati vanno a «Stampa più documenti» (`app.printFiles`); le fatture XML vengono prima
  impaginate in PDF, dei .p7m si stampa il PDF contenuto.
- **Firma…**: spiega e apre «Firma più file» dell'area moduli. Quello strumento oggi sceglie i file con la finestra
  del sistema e **non riceve un elenco**: si possono aprire le cartelle dei documenti, poi selezionarli lì
  (richiesta all'area moduli in fondo). Se esistesse `app.services.firmaFile(files)` l'archivio lo userebbe.
- **Altre azioni › Fatture elettroniche in PDF**: una copia PDF impaginata per ogni fattura XML (anche .xml.p7m)
  in «Elaborati», con il nome proposto dalla fattura; stessa impaginazione dell'area avanzati (`fatturaDocument` +
  il suo canale `html-to-pdf`), o `app.services.fatturaPdf` se l'area lo offrirà.
- **Altre azioni › Azioni guidate…** (anche sulle fatture XML, impaginate prima in PDF): le stesse operazioni e le **sequenze salvate** delle «Azioni guidate» dell'area avanzati
  (`lib/batch-ops.js`: timbro di protocollo, numeri di pagina, filigrana, metadati, rendi definitivi,
  ottimizza, proteggi, più le operazioni offerte dalle altre aree con `batch:operations`). L'archivio aggiunge
  all'elenco **Rendi ricercabile (OCR)** (`app.services.ocr`) e **Riduci dimensioni file**
  (`app.services.compress`) se le aree conversione e sicurezza non le hanno già registrate: compaiono quindi
  anche nelle Azioni guidate dell'area avanzati. Le copie vanno in **«Elaborati»** accanto a ogni originale
  (o in una cartella scelta). Il timbro di protocollo non è offerto (vedi sopra).
- **Copie con nome proposto…**: copia ogni documento in «Rinominati» con il nome della «Rinomina dal
  contenuto» (`Fattura_FORNITORE_n123_2026-10-31.pdf`, `DURC_FORNITORE_scad2027-02-15.pdf`), anteprima prima.
- **Esporta registro…**: i risultati (o i selezionati) in **Excel (.xlsx)** o **CSV** (`;`, virgola decimale):
  tipo, data, numero, fornitore, P.IVA, codice fiscale, importo, CIG, CUP, scadenza, stato, etichette, nota,
  firme, pagine, nome, percorso, impronta. Il file .xlsx è scritto senza librerie (ZIP + SpreadsheetML), con
  date e importi come numeri veri, filtro automatico e prima riga bloccata. Le celle CSV che iniziano con
  `= + - @` sono protette (niente formule eseguite da Excel).

## Architettura

```
renderer (thread dell'interfaccia)      Web Worker                         processo main (electron/features/archivio.cjs)
 index.js, ui/*  ── richieste brevi ──▶ motore.worker.js                   cartelle collegate (config.json)
 archivio.js (orchestrazione)           indice in memoria, ricerca,       scansione delle cartelle (dimensione, data)
   │                                    filtri, Oggi, stati, blocchi       lettura file + impronta SHA-256
   ├──▶ estrai.worker.js ×2-3           (lib/motore, blocchi, stati,       indice a blocchi NDJSON + manifesto (atomico)
   │    pdf.js proprio, .p7m, XML, .eml  scadenze)                          stati.json (+ .bak), copie in «Elaborati»
   └──▶ store.js ── feat:archivio:* ───────────────────────────────────▶
```
- **Nessun lavoro pesante nel thread dell'interfaccia**: estrazione del testo nei worker di estrazione (ognuno
  con il **proprio** pdf.js, così l'indicizzazione non rallenta la vista dei documenti aperti); ricerca e filtri
  nel worker del motore; impronte e disco nel processo main. I worker di estrazione sono ricreati ogni 150
  documenti (memoria costante), terminati se un file impiega più di 60 s, e chiusi a fine indicizzazione.
- **Perché file NDJSON a blocchi in `userData` e non un database**: niente moduli nativi da compilare per
  Windows e macOS (SQLite), formato leggibile e recuperabile riga per riga, scritture atomiche con il
  `safeWrite` del nucleo. IndexedDB non è stato usato nell'app perché l'indice deve stare accanto agli altri
  dati di Leggio (`userData`, cancellabile e salvabile come cartella) e perché il processo main deve
  comunque leggere i file; nell'anteprima web (senza processo main) si usa IndexedDB.
- **Scrittura «copia e sostituisci»** (`lib/blocchi.js`): ogni blocco (≤ 250 documenti) cambiato si scrive con
  un nome nuovo (temporaneo + fsync + verifica + rename), poi il **manifesto**, poi si eliminano i blocchi
  vecchi. Una chiusura a metà lascia sempre un manifesto che punta a blocchi completi; i blocchi orfani si
  eliminano all'avvio e i documenti mancanti si rileggono. Righe rovinate vengono saltate (e rilette).
  Le scritture del main sono serializzate.
- **Stati**: `stati.json`, scritto in modo atomico dopo ogni cambiamento; prima si salva la versione precedente
  in `stati.json.bak`. Se il file principale è rovinato si usa la riserva (avviso all'utente).
- **Sicurezza**: il renderer può leggere solo file dentro le cartelle collegate (scelte con il dialogo e salvate
  in `userData/archivio/config.json`); i nomi dei blocchi sono validati; le copie si scrivono solo accanto a
  originali dell'archivio o in cartelle scelte con il dialogo, mai sopra file esistenti. I canali accettano solo
  la pagina dell'app (stesso controllo del nucleo). Solo per il collaudo automatico, con
  `LEGGIO_ARCHIVIO_TEST=1` **e** app non pacchettizzata, `aggiungi-cartella` accetta un percorso senza dialogo.

## Privacy
L'indice contiene il **testo dei documenti, compresi dati personali** (codici fiscali, IBAN, nomi).
- Resta **solo in locale**, in `userData/archivio/` (macOS: `~/Library/Application Support/Leggio/archivio`,
  Windows: `%APPDATA%\Leggio\archivio`); nell'anteprima web in IndexedDB del browser.
- **Non va mai in rete**: l'area non fa richieste di rete, non c'è telemetria.
- **Cancella indice** (Cartelle e privacy) elimina testo e dati estratti; **Cancella tutto** elimina anche
  stati, etichette, note ed elenco delle cartelle. I documenti originali non vengono mai toccati.
- La finestra «Cartelle e privacy» mostra dove si trova l'indice e quanto occupa.

## Robustezza
| Caso | Comportamento |
|---|---|
| File danneggiato | saltato, segnalato («Non letti»), cercabile per nome; l'indicizzazione continua |
| File protetto da password | segnalato «Protetto da password», cercabile per nome |
| File enorme (> 200 MB) | solo nome e impronta (calcolata a flusso, memoria costante), segnalato |
| File che blocca pdf.js | dopo 60 s il worker viene terminato e ricreato; file segnalato |
| Cartella non raggiungibile (rete, chiavetta) | avviso; **l'indice resta**; i documenti risultano «Cartella non raggiungibile»; nulla viene tolto. Una cartella di rete che non risponde viene abbandonata dopo 45 s |
| Sottocartella illeggibile, elenco troncato (> 100.000 file) | i documenti lì dentro non vengono tolti dall'indice |
| File bloccato da un altro programma | segnalato e riletto al prossimo aggiornamento |
| Chiusura improvvisa durante l'indicizzazione | indice integro, ripresa dal punto raggiunto (provato: `kill -9`) |
| Scrittura dell'indice non riuscita (disco pieno) | avviso (al massimo uno al minuto), si riprova alla scrittura successiva |

## Misure dopo Titulus e sorveglianza (stesso Mac, macchina molto carica: carico medio 24–42)
| Prova | Risultato |
|---|---|
| Prima indicizzazione di 3.614 file con individuazione delle strisce | 10,7 s (prima 7,3 s: l'elenco delle operazioni di disegno della pagina 1 costa ~3 s) |
| Segnature: 183 lette dal testo durante l'indicizzazione; 281 strisce-immagine nella coda | coda: **281 lette su 281 in 55,6 s** (~200 ms l'una); numeri e date corretti; UOR «SI» letto «S1» in 236 casi → corretto dalla normalizzazione aggiunta dopo la misura |
| File reale protocollato da Titulus (solo prova locale, non nel repository) | striscia trovata (pagina 1, margine sinistro); il ripiego OCR legge numero, data e UOR esatti in 0,9 s. Due correzioni nate da questo file: la striscia va disegnata **con le annotazioni** (nel file reale non compariva senza) e Tesseract va usato in modalità «riga singola» |
| 18 fatture XML copiate in una cartella collegata | rilevate da sole in **3,6 s** (fs.watch), avviso «18 documenti nuovi», presenti in «Oggi» |
| Fatture in PDF in blocco, 18 XML | 18 PDF in «Elaborati», 73 s sotto carico |
| Coda delle segnature con `leggiSegnaturaTitulus` (archivio di prova di 400 file) | 31 strisce su 31 lette, numeri, date e UOR esatti, ~1,1 s l'una sotto carico |
| Evento `archivio:stato` su una fattura XML; evento su un file fuori dall'archivio | confermato (`ricevuto = true`) e stato «Protocollato (Titulus) n. … — segnatura apposta su una copia»; fuori dall'archivio `ricevuto` resta `false` |
| Stampa di 17 XML selezionati | impaginati e passati a «Stampa più documenti» (dialogo aperto, stampa non lanciata) |

## Misure (12/11/2026, MacBook Apple Silicon 8 GB, Electron 45, app vera comandata via DevTools)
Archivio di prova generato con `test/archivio-genera.mjs --n=3600 --grande --pesanti=150`: **3.614 file**
(3.164 PDF, 216 XML, 54 `.p7m`, 180 `.eml`), 545 MB su disco: fatture, note di credito, DURC, ordini e
determine, missioni, contratti (90 con firma PAdES simulata), 216 scansioni vettoriali senza testo,
150 scansioni vere (immagini, ~1-2 MB), 54 file rovinati, 43 protetti, 1 file da 216 MB.

| Prova | Risultato |
|---|---|
| Prima indicizzazione, 3.614 file | **7,3 s** (scansione delle cartelle 43 ms); 3.577 letti, 36 non leggibili (rovinati), 43 protetti, 366 scansioni riconosciute |
| Ripetuta da zero due volte (Cancella indice + Aggiorna) | 7,0 s e 6,9 s |
| Aggiornamento senza cambiamenti | **40 ms** |
| Aggiornamento dopo spostamento di una cartella (54 file), 5 rinominati, 40 nuovi, 10 eliminati, 5 modificati | 394 ms (99 file letti); con la correzione successiva lo spostamento puro di 54 file: **136 ms, 54 riusati senza rilettura** |
| Stati dopo spostamento e rinomina | 20 su 20 conservati |
| Caricamento dell'indice all'avvio (3.644 documenti) | **66 ms** |
| `kill -9` durante l'indicizzazione (2.329 di 3.614) | al riavvio 2.341 documenti integri, 0 righe rovinate, 1 blocco orfano eliminato, ripresa: 1.303 file letti in 2,7 s |
| Ricerca nell'app (andata e ritorno con il worker) | 2–14 ms (parola, frase, filtri, tutti i 3.644) |
| Motore con **10.000** documenti e 85 MB di testo (`node --expose-gc test/archivio-benchmark.mjs`) | macchina scarica: caricamento 0,43 s, heap +165 MB, parola rara 100 ms, parola comune 44 ms, filtri 3 ms; macchina carica (carico medio > 20): caricamento 3,9 s, parola rara 533 ms, comune 323 ms, filtri 32 ms |
| Memoria del processo renderer (worker compresi, RSS) | a riposo 80–110 MB; **durante l'indicizzazione 450–530 MB stabili** (3 worker di estrazione con il loro pdf.js); dopo 160–165 MB con l'indice in memoria |
| Processo main | 90–220 MB durante l'indicizzazione |

Limite onesto delle misure: i PDF generati sono piccoli (testo vettoriale, 3 KB in media; le 150 scansioni
vere 1–2 MB). Documenti reali più pesanti e cartelle di rete aumenteranno i tempi della prima indicizzazione
(dominati da lettura e analisi), non quelli di ricerca.

## Collaudo
- `npx vitest run test/archivio*` — logica (testo, estrazione, stati e import/export, Oggi, motore con 10.000
  documenti, blocchi, registro CSV/XLSX), modulo main (cartelle, scansione, letture consentite, indice atomico e
  orfani, stati con riserva, copie senza sovrascrittura, cancellazione), estrazione su un archivio generato
  (≥ 95 % dei tipi riconosciuti, scansioni, protetti, rovinati, PAdES, `.p7m`, XML).
- Archivio di prova: `node test/archivio-genera.mjs <cartella FUORI dal repository> [--n=3600] [--grande] [--pesanti=150]`.
- App: `LEGGIO_USER_DATA=/tmp/ud LEGGIO_ARCHIVIO_TEST=1 npx electron . --remote-debugging-port=9333`, poi in
  console `await __leggio.archivio.aggiungiCartella('/percorso/prova')`.

## Limiti noti
- Le scansioni non vengono passate all'OCR in automatico (servirebbe molto tempo per migliaia di pagine):
  sono segnalate e si possono rendere ricercabili con «Azioni guidate › Rendi ricercabile (OCR)»; le copie
  OCR finiscono in «Elaborati» e vengono indicizzate.
- Il riconoscimento dei dati dai PDF è a regole: funziona sui documenti con testo e diciture usuali; i campi
  non trovati restano vuoti (mai inventati). Le fatture XML sono lette esattamente.
- Il timbro di protocollo dell'area avanzati non aggiorna da solo lo stato in archivio (l'archivio legge però la
  segnatura se il numero di Titulus è stampato con la dicitura «Prot. … n. … del …»).
- Le firme non vengono **verificate** dall'indice (solo rilevate): la verifica è nell'area avanzati all'apertura.
- Sulle cartelle di rete i file nuovi si vedono al controllo periodico (al massimo 90 s), non subito. Su Windows
  un'unità di rete mappata a una lettera non si distingue da un disco locale: si prova `fs.watch`, e resta comunque
  il controllo periodico.
- La lettura delle strisce di segnatura è provata su un solo documento reale e su strisce sintetiche: altri formati
  di Titulus (altre AOO, posizioni) vanno verificati; il modello configurabile è dell'area avanzati.
- Gli allegati dentro le PEC e dentro le fatture XML non sono indicizzati come documenti separati (i loro nomi sì).
- Nell'anteprima web le cartelle valgono solo finché la pagina resta aperta (il browser non dà percorsi).
- Non provato su Windows reale né su cartelle di rete o OneDrive vere (simulata la cartella scollegata).
- Esportazione Excel/CSV e dialoghi di scelta cartella non cliccati nell'app (dialoghi nativi): il file .xlsx è
  verificato nei test (`unzip -t`, contenuto dei fogli), non aperto in Excel.


## Quarto ciclo: pratica, pagamento, «Oggi» (regola del titolare: agevolare, non complicare)
Niente schermate nuove: una **Scheda** per documento (pannello a destra, pulsante accanto ad «Apri»), una colonna/
semaforo sulle fatture, voci in «Oggi». In «Oggi» compaiono **solo le sezioni con qualcosa da fare** (se non c'è
nulla: «Niente da fare in archivio oggi»); ogni voce si apre con un clic.

- **Scheda del documento**: dati (anche IBAN), protocollo (Titulus), **controlli della fattura elettronica** (logica
  dell'area avanzati, `lib/controlli.js › controlliFattura`: SdI, CIG/CUP, split, bollo, note di credito; solo gli
  avvisi), **Pagamento**, **Fornitore** e **Pratica collegata**.
- **Pratica collegata**: tutti i documenti con lo stesso **numero di protocollo, CIG o CUP**, in ordine di data, ognuno
  con il motivo («stesso CIG»…); «Crea il fascicolo con indice» (libreria `creaFascicolo` dell'area avanzati, voci con
  «prot. n. … del …», fatture XML impaginate, PDF dentro i .p7m). Le **liste di controllo** dell'area avanzati
  (`app.services.listeControllo`) compaiono qui solo se l'ufficio le ha attivate; spente non si vede nulla.
  Le copie `_firmato` della firma in blocco hanno gli stessi CIG/CUP/segnatura: entrano nella stessa pratica.
- **Pronta per il pagamento** (semaforo sulla riga, filtro in «Mostra», colonne nel registro Excel/CSV):
  DURC valido **alla data di pagamento prevista** (non solo a oggi); IBAN della fattura uguale a quello della
  **dichiarazione di tracciabilità** (nuovo tipo di documento, L. 136/2010) quando c'è; giorni ai **30 giorni**
  dell'indicatore di tempestività (PCC): se in fattura non c'è la scadenza, dalla ricezione. La ricezione è quella del
  file (o la data della fattura se il file è stato copiato molto dopo): stimata, e lo si dice. Il semaforo compare
  solo sulle fatture «da pagare» o con il pagamento previsto da meno di 30 giorni o futuro: le fatture vecchie senza
  stato (probabilmente pagate fuori da Leggio) non si colorano. Leggio segnala soltanto. `lib/pagamento.js`.
- **Fornitore** (raggruppato per P.IVA): ultimo DURC e validità, conto dedicato dichiarato, fatture non pagate e quante
  da controllare, «Vedi le fatture del fornitore».
- **Oggi**, nuove voci: **Anomalie di protocollo** (stesso numero su documenti con contenuto diverso, escluse le copie
  in «Elaborati»/«Rinominati»), **Fatture elettroniche: termine SdI** (gli ultimi 5 giorni dei 15 dalla ricezione, solo
  fatture senza stato), **Pagamenti in scadenza** (scadenza in fattura o 30 giorni PCC), **Da protocollare in
  Titulus** con i documenti **arrivati da più di N giorni senza segnatura né stato** (N = 3, impostazione; solo per i
  documenti arrivati dopo la prima indicizzazione; pulsante «Non serve» = stato «Non da protocollare»),
  **Da pubblicare (Trasparenza)**: documenti con stato «Da pubblicare», con «pubblicare entro» 3 mesi dal
  conferimento (data del documento) e «tenere pubblicato fino a» 3 anni dalla cessazione (data di fine letta nel
  contratto): art. 15 d.lgs. 33/2013, **da verificare**. L'oscuramento lo fa «Pronto per la pubblicazione».
- **Regole che cambiano**: una sola fonte, il file di regole dell'area avanzati (`avanzati/dati/regole-ufficio.json`,
  aggiornabile dall'ufficio): durata del DURC (`durc.giorniValidita`, con fonte e data) e giorni SdI
  (`sdi.giorniEsito`). L'impostazione `archivio.durataDurc` non esiste più.
- **Firma…**: `app.services.firmaFile(selezionati)` dell'area moduli (un certificato, un PIN, risultati solo se qualcosa
  non va). Per ogni file firmato arriva `archivio:stato` (`imposta: 'firmato'`) e l'originale diventa «Firmato»; le copie
  `_firmato` accanto agli originali vengono indicizzate all'aggiornamento successivo.
- Servizi nuovi per le altre aree: `app.services.apriArchivio({ q, filtro, scheda })`,
  `app.services.apriDocumentoArchivio(id | percorso, { pagina, q })` (sempre in sola lettura).
- Nuovi tipi riconosciuti: **Tracciabilità (conto dedicato)**, **Incarico o assegno**; i documenti MePA (documento di
  stipula, trattativa diretta, RdO) sono «Ordine o determina». Nuovi stati: «Non da protocollare», «Da pubblicare».

| Misura (3.629 file generati, macchina carica) | Risultato |
|---|---|
| Prima indicizzazione | 19,4 s (carico medio > 20; senza carico 10,7 s) |
| «Oggi» completo (anomalie, SdI, pagamenti, DURC, non protocollati) | 6 ms nel worker |
| Filtro «Fatture da controllare prima di pagare» | 34 ms; 176 fatture da controllare, 4 pronte (DURC dei dati di prova spesso scaduti) |
| Pratica collegata | 2 ms; 80 pratiche con 3 o più documenti nell'archivio di prova |
| Caricamento dell'indice all'avvio | 93 ms |

Generatore: `test/archivio-genera.mjs` crea ora pratiche d'acquisto con lo stesso CIG (determina, ordine o stipula
MePA, fatture), dichiarazioni di tracciabilità con IBAN validi (alcune fatture con IBAN diverso), incarichi con data di
fine, documenti MePA firmati e qualche **numero di protocollo ripetuto** (anomalia).

## Per le altre aree
- **Evento `archivio:stato`** (lo emette l'area avanzati quando appone la segnatura di Titulus su una copia o la
  legge aprendo un documento): `{ path (file ORIGINALE, anche .xml o .p7m), impronta?, modifica: { imposta,
  numeroProtocollo, dataProtocollo, uorProtocollo? }, origine: 'segnatura'|'lettura', ricevuto: false }`, oppure in
  forma semplice `{ path, stato, numero, data, uor }`. Se il documento è nell'archivio (per percorso o impronta) o
  sta in una cartella collegata, l'archivio imposta `ricevuto = true` **in modo sincrono** e applica lo stato
  (origine mostrata: «letto dalla segnatura di Titulus» o «letto dal documento»); un file non ancora indicizzato viene
  indicizzato subito e lo stato si applica appena c'è. Altrimenti `ricevuto` resta `false` e Leggio dice di farlo
  a mano. Mappatura: `lib/stati.js › modificaDaEvento`.
- **`app.services.statoArchivio(path)`** → `Promise<{ nome, path, impronta, tipo, stati, protocollato,
  daProtocollare, numero, data, uor, origine ('documento'|'segnatura'|'utente'), etichette, nota } | null>`:
  per esempio i pannelli Titulus possono mostrare il numero di protocollo già noto.
- Servizi usati: `app.services.leggiSegnaturaTitulus(bytes)` (coda delle segnature), `app.services.segnaturaTitulus(testo)`
  (testo, durante l'indicizzazione), `app.services.fatturaPdf(bytes)` (fatture XML in PDF, stampa, azioni guidate),
  `app.printFiles`, `app.services.creaWorkerOcr` (solo ripiego).

## Richieste al nucleo e ad altre aree
- Area moduli: «Firma più file» con un elenco di file in ingresso (es. `app.services.firmaFile([{ path, name }])`),
  così si firmano direttamente i selezionati dell'archivio.
- Azioni guidate (area avanzati): `openBatch(app, deps, { items })` per aprire la finestra con file già scelti;
  oggi l'archivio usa le stesse operazioni e sequenze (`lib/batch-ops.js`) con una finestra propria.
