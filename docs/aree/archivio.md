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
| Impostazioni | validità del DURC in giorni, preavviso DURC, preavviso fatture, codici fiscali/P.IVA del proprio ente |

Gli strumenti stanno nella categoria `avanzati` perché il nucleo mostra solo le categorie note
(`core/tools.js` → `CATEGORIES`): una categoria «Archivio» richiede un cambiamento al nucleo (vedi in fondo).

## Cosa fa

### Cartelle e indicizzazione
- **Collega una cartella…** (dialogo del sistema). Più cartelle; una cartella dentro una già collegata non
  si aggiunge due volte, una che ne contiene altre le sostituisce.
- Tipi indicizzati: `.pdf`, `.p7m` (anche annidati, `.xml.p7m`, `.pdf.p7m`), `.xml` (FatturaPA), `.eml` (PEC).
  Si saltano file e cartelle nascosti, i temporanei di Office (`~$…`) e quelli di Leggio.
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
- Filtri: tipo, stato (anche le etichette), ordinamento; in «Altri filtri»: fornitore o P.IVA (con
  suggerimenti), intervallo di date (data del documento, o del file se manca), CIG/CUP, cartella,
  «Mostra» (scansioni da OCR, firmati, protetti, non letti, senza dati).
- Ordinamento: pertinenza (predefinito quando si cerca), data, arrivati di recente, nome, fornitore,
  importo, scadenza.
- Ogni risultato mostra tipo, dati, stati e segnalazioni e la **frase trovata con la pagina**.
  **Apri** (o doppio clic, o Invio) apre il documento **in sola lettura alla pagina giusta** con la ricerca
  evidenziata (`app.openPath(path, { page, search, readOnly })`): una modifica propone «Lavora su una copia».
- Lista **virtualizzata** (solo le righe visibili sono nel DOM): fluida con migliaia di righe.
  Tastiera: frecce su/giù, Spazio seleziona, Invio apre.

### Stati e note d'ufficio
«Da protocollare», «Protocollato n. …», «Da firmare», «Firmato», «Da pagare», «Pagato», «Pubblicato»,
«Archiviato», più **etichette libere** e una **nota**.
- Si salvano **nell'archivio di Leggio, mai nel PDF** (i file firmati restano intatti).
- Sono legati all'**impronta** del file: sopravvivono a rinomina e spostamento. Se un file cambia contenuto
  nello stesso percorso (es. timbrato da un altro programma), lo stato lo segue.
- **Su più documenti insieme** (selezione multipla → «Cambia stato…», «Etichette e nota…»). Per
  «Protocollato» su più file si indica il primo numero: ai successivi va il numero seguente.
- **Esporta / Importa** (Cartelle e privacy): JSON (backup) o CSV per Excel (`;`), con impronta, nome e
  percorso per riconoscere i file a occhio. All'importazione si sceglie «vince il più recente» o «vincono
  quelli importati»; gli stati di file non ancora presenti si applicano quando compariranno.

### Oggi (scadenzario)
- **DURC scaduti o in scadenza**: per ogni fornitore conta solo il DURC più recente. Se nel documento non c'è
  la data di scadenza, si calcola dalla data del documento + **durata impostabile** (predefinita 120 giorni,
  validità del DURC online secondo il D.M. 30/01/2015 — *da verificare sulla normativa vigente*, per questo
  è un'impostazione e non una regola fissa). Preavviso impostabile (predefinito 15 giorni).
- **Fatture da pagare** (stato «Da pagare») con la scadenza: scadute in rosso, vicine in arancio.
- **Da protocollare**, **Da firmare**.
- **Arrivati dall'ultima apertura**: documenti entrati nell'indice dopo l'ultima volta che si è guardato Oggi.
- Ogni voce si apre con un clic; «Vedi tutti» apre la ricerca già filtrata.

### Azioni sui documenti selezionati
- **Azioni guidate…**: le stesse operazioni e le **sequenze salvate** delle «Azioni guidate» dell'area avanzati
  (`lib/batch-ops.js`: timbro di protocollo, numeri di pagina, filigrana, metadati, rendi definitivi,
  ottimizza, proteggi, più le operazioni offerte dalle altre aree con `batch:operations`). L'archivio aggiunge
  all'elenco **Rendi ricercabile (OCR)** (`app.services.ocr`) e **Riduci dimensioni file**
  (`app.services.compress`) se le aree conversione e sicurezza non le hanno già registrate: compaiono quindi
  anche nelle Azioni guidate dell'area avanzati. Le copie vanno in **«Elaborati»** accanto a ogni originale
  (o in una cartella scelta); con il timbro di protocollo gli originali possono essere segnati
  «Protocollato n. …» e il contatore di protocollo dell'area avanzati avanza.
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
| Motore con **10.000** documenti e 85 MB di testo (Node, `scratch`) | caricamento 0,43 s, heap +165 MB; ricerca parola rara 100 ms, parola comune 44 ms, filtri 3 ms |
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
- Le firme non vengono **verificate** dall'indice (solo rilevate): la verifica è nell'area avanzati all'apertura.
- Nessuna sorveglianza continua delle cartelle (su rete e OneDrive `fs.watch` non è affidabile): aggiornamento
  all'avvio, ogni 15 minuti, dopo le azioni e con «Aggiorna ora».
- Gli allegati dentro le PEC e dentro le fatture XML non sono indicizzati come documenti separati (i loro nomi sì).
- Nell'anteprima web le cartelle valgono solo finché la pagina resta aperta (il browser non dà percorsi).
- Non provato su Windows reale né su cartelle di rete o OneDrive vere (simulata la cartella scollegata).
- Esportazione Excel/CSV e dialoghi di scelta cartella non cliccati nell'app (dialoghi nativi): il file .xlsx è
  verificato nei test (`unzip -t`, contenuto dei fogli), non aperto in Excel.

## Richieste al nucleo e ad altre aree
- **Categoria «Archivio»** in `core/tools.js` (`CATEGORIES`) per mostrare gli strumenti in un gruppo proprio.
- Azioni guidate (area avanzati): `openBatch(app, deps, { items })` per aprire la finestra con file già scelti;
  oggi l'archivio usa le stesse operazioni e sequenze (`lib/batch-ops.js`) con una finestra propria.
- Chiudendo l'ultima scheda la barra «Trova» resta aperta con la ricerca del documento chiuso (visto nell'app).
