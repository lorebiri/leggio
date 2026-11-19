# Area «personale» — archivio personale cifrato, rubrica, compilazione in serie, modelli

Novità della 0.3. Pensata per **una persona sul suo PC**: niente sincronizzazione, niente rete.

## Archivio personale cifrato
Tutti i dati personali dell'utente (profilo «io», firme e sigle, timbri, rubrica, modelli, registro delle firme di
altre persone) stanno in un archivio cifrato nella cartella dati dell'app (`<userData>/personale/`), gestito **solo dal
processo principale** (`electron/personale/cassaforte.cjs`, canali `feat:personale:*` in `electron/features/personale.cjs`).

| File | Contenuto |
|---|---|
| `chiave.json` | chiave dati (DEK, 256 bit casuali) protetta (vedi sotto) |
| `chiave.json.bak` | copia di riserva **identica** di `chiave.json` (0.3.1): se `chiave.json` si rovina la chiave si recupera da qui. Non contiene mai una protezione vecchia: prima di riscrivere `chiave.json` la copia viene tolta, e se poi non si riesce a riscriverla resta assente (si ricrea al prossimo sblocco riuscito) |
| `indice.dat` | indice JSON cifrato: contatti, metadati di firme/timbri/modelli, registro, profilo |
| `indice.dat.bak` | la versione precedente dell'indice (backup automatico dell'ultima versione) |
| `blob/<id>.dat` | immagini di firme e timbri, PDF dei modelli: un file cifrato ciascuno |

**Cifratura.** AES-256-GCM; ogni file: `LGV1` + IV casuale (12 byte) + tag (16 byte) + dati. I dati autenticati
aggiuntivi legano il contenuto al nome (`indice`, `blob:<id>`): un file scambiato con un altro viene rifiutato.

**Protezione della chiave dati.**
1. **Dal sistema** (predefinita): `safeStorage` di Electron → Portachiavi su macOS, DPAPI su Windows, libsecret/kwallet
   su Linux. La chiave è legata all'utente del computer.
2. **Ripiego documentato**: su Linux senza portachiavi Electron userebbe `basic_text` (una chiave fissa, nessuna vera
   protezione). In quel caso Leggio NON lo considera sicuro: la chiave dati resta in `chiave.json` protetta **solo dai
   permessi del file** (0600, leggibile solo dal proprio utente). Appena il portachiavi diventa disponibile la chiave
   passa da sola alla protezione del sistema. Lo stesso ripiego si usa se il portachiavi c'è ma non rilegge ciò che ha
   appena cifrato (una chiave che non si riapre non viene mai scritta).
   **Avviso (0.3.1)**: `stato().avvisoPortachiavi` è vero con il ripiego e senza password. L'interfaccia
   (`ui/avvisi.js`) mostra **una volta sola** (alla creazione dell'archivio, o al primo avvio con la 0.3.1 per gli
   archivi esistenti) una finestra non tecnica: «manca il portachiavi, l'archivio è protetto solo dai permessi del file,
   conviene impostare una password», con il pulsante «Imposta una password…». Poi resta solo il riquadro in cima a
   «Archivio personale» → «Protezione e backup», con lo stesso pulsante. La data dell'avviso sta nel localStorage
   (`leggio.personale.promemoria.v1`, solo date e scelte).
3. **Password facoltativa**: la chiave dati viene avvolta con una chiave derivata dalla password (**scrypt N=131072,
   r=8, p=1**, 128 MB di memoria, sale casuale), e il risultato è a sua volta protetto dal sistema. All'avvio l'archivio
   è **bloccato**: la password si chiede la prima volta che serve (non all'avvio dell'app). «Blocca ora» toglie la
   chiave dalla memoria. Dopo 3 password sbagliate di fila le risposte rallentano. Una password dimenticata non si
   recupera: lo dice l'interfaccia e suggerisce un backup esportato.
   - **scrypt asincrono**: `crypto.scrypt` gira nel pool di libuv, il processo principale (e quindi l'interfaccia)
     non si blocca. Tempi misurati: ~0,32–0,36 s per derivazione su una macchina Linux a 4 core (contro ~70 ms con
     N=32768); il test `personale-cassaforte-031` verifica che il ciclo degli eventi continui a girare.
   - **Rafforzamento delle chiavi della 0.3.0** (N=32768): al primo sblocco riuscito la chiave dati viene riavvolta
     con i nuovi parametri (stessa password). La nuova chiave è verificata in memoria (si svolge e si rilegge dal
     sistema) prima di essere scritta, la scrittura è atomica e poi si aggiorna la copia di riserva. Se la scrittura
     non riesce (disco pieno, permessi) lo sblocco riesce lo stesso, resta la chiave vecchia e si riprova al prossimo
     sblocco: non c'è mai un momento in cui la chiave non si apre.
   - **Compatibilità all'indietro**: la 0.3.0 calcola scrypt con un limite di 128 MB e **non apre** una chiave (o un
     backup) con N=131072. Tornare dalla 0.3.1 alla 0.3.0 con un archivio con password non è supportato.
   - Parametri letti da file (chiave o backup) controllati prima di calcolare: N potenza di 2 e minore di 2^(16·r),
     memoria al massimo **256 MB** (i nostri ne usano ~128): un file manomesso non può far allocare memoria a
     piacere, e un parametro rifiutato da OpenSSL dà un messaggio chiaro, mai un errore grezzo.
4. **Consiglio nell'interfaccia**: «Senza password l'archivio è protetto dall'utente del computer: va bene su un PC
   personale. Su un PC condiviso o d'ufficio conviene la password». I dialoghi di password e di backup mostrano un
   **indicatore di robustezza** (`lib/robustezza.js`, senza librerie: lunghezza «utile» per varietà dei caratteri, con
   ripetizioni, sequenze tipo `1234`/`qwerty` e parole comuni che contano come un solo carattere; Troppo corta, Debole,
   Discreta, Buona, Ottima). È solo un consiglio: il minimo resta 8 caratteri.

**Scritture.** Atomiche e verificate (`electron/core/safe-write.cjs`: temporaneo + fsync + rilettura + rename), in coda
(una alla volta). Prima di ogni nuovo indice la versione corrente diventa `indice.dat.bak`. Se l'indice è danneggiato si
legge il backup (e l'utente viene avvisato); il salvataggio successivo non sovrascrive il backup buono con quello rotto.
Se il sistema non riesce più ad aprire la chiave (utente cambiato, portachiavi azzerato) l'archivio può essere **messo da
parte** (mai cancellato: `personale-illeggibile-<data>`) per ricominciare, e poi ripristinato da un backup esportato.

**Casi di errore (0.3.1)** — ognuno con un messaggio chiaro, un codice e una via d'uscita; nessun dato perso in silenzio:

| Caso | Codice | Cosa succede |
|---|---|---|
| `chiave.json` danneggiato (illeggibile o con il contenuto rovinato) | — | si usa `chiave.json.bak` e si rimette a posto `chiave.json` (`stato().chiaveRecuperata`) |
| `chiave.json` e la copia entrambe danneggiate | `chiave-danneggiata` | messaggio + finestra di recupero |
| `chiave.json` cancellato ma ci sono dati cifrati | `chiave-mancante` | **non** si crea una chiave nuova sopra i dati; finestra di recupero |
| Portachiavi azzerato / bloccato / utente cambiato | `sistema` | dati intatti; il pulsante principale è **«Riprova»** (spesso il portachiavi è solo bloccato); «Metti da parte e ricomincia…» è una scelta secondaria con la sua conferma |
| Indice e backup automatico illeggibili | `danneggiato` | finestra di recupero |
| Disco pieno durante una scrittura | `disco-pieno` | l'originale resta intatto (scrittura atomica); il renderer tiene le modifiche in memoria, avvisa **una volta** e riprova ogni 30 s; a salvataggio riuscito «le modifiche ora sono salvate». **Alla chiusura di Leggio** l'archivio salva subito ciò che è in attesa (`app.quitGuards` in `core/app.js`, `guardiaUscita` in `ui/avvisi.js`); se non ci riesce la chiusura si ferma con «Resta in Leggio» / «Esci comunque» |
| Permessi / disco in sola lettura | `scrittura` | come sopra, con il messaggio sui permessi della cartella |
| Password sbagliata (anche dopo il rafforzamento) | `password-errata` | «Password errata.», si richiede; nessuna scrittura |

La **finestra di recupero** (`dialogoRecupero` in `ui/avvisi.js`) spiega il problema e offre «Metti da parte e ricomincia»
(la cartella viene solo rinominata) e subito dopo «Importa un backup…».

**Nessun limite pratico di spazio**: indice fino a 64 MB di testo (decine di migliaia di contatti), ogni immagine o PDF
fino a 64 MB, numero di file illimitato. Provato con 5000 contatti e 500 firme (`test/personale-cassaforte.test.js`).

**Backup esportato** (`.leggio-backup`): tutto l'archivio (indice + immagini di firme e timbri + PDF dei modelli: ogni
`blob` citato in qualunque punto dell'indice) compresso e cifrato con una password scelta all'esportazione (scrypt
N=131072 + AES-256-GCM), perché le chiavi del sistema non si spostano su un altro computer. **Verifica (0.3.1)**: prima di
salvarlo il file viene riaperto con la stessa password e confrontato con l'archivio (indice identico, stesse immagini e
PDF byte per byte); se un elemento citato dall'indice non è leggibile il backup si salva lo stesso ma l'interfaccia dice
quanti elementi mancano (`mancanti`). Il file viene scritto in modo atomico e riletto. All'importazione: «Unisci» (per id
vince la versione modificata più di recente; il profilo attuale ha la precedenza) o «Sostituisci» (con conferma). I
backup della 0.3.0 si importano nella 0.3.1; quelli della 0.3.1 richiedono la 0.3.1 o successive.

**Promemoria del backup (0.3.1)** (`lib/promemoria.js`, finestra in `ui/avvisi.js`): dopo il salvataggio della prima firma
(se non è mai stato esportato un backup) e poi quando ci sono dati nuovi dall'ultimo backup e sono passati almeno 30
giorni dall'ultimo backup o dall'ultimo «Non ora». Risposte: «Esporta un backup…», «Non ora», «Non ricordarmelo più».
Al massimo uno per sessione, mai sopra un'altra finestra, mai con l'archivio vuoto; usare una firma non conta come dato
nuovo. In «Protezione e backup» si vede la data dell'ultimo backup esportato.

**Segreti e renderer.** Il renderer non vede mai la chiave dati né la password dopo averla inviata: riceve solo i dati
che deve mostrare (l'indice e, a richiesta, le singole immagini). Canali validati: identificativi `^[a-z0-9][a-z0-9_-]{3,63}$`
(niente percorsi), dimensioni massime, forma e profondità dell'indice, password ≤ 1024 caratteri, file di backup da
importare scelto solo con il dialogo del main (il renderer riceve un gettone, mai un percorso da leggere), azzeramento solo
con una conferma esplicita. Le richieste arrivano solo dalla pagina dell'app (`featureIpc` del main).

**Cancellazione.** Un'immagine eliminata viene sovrascritta con dati casuali prima della rimozione (utile sui dischi
tradizionali; sugli SSD non è garantito, per questo i file sono comunque cifrati). La cancellazione di una persona (GDPR)
riscrive anche il backup automatico. I backup esportati in passato non vengono toccati (l'interfaccia lo dice).
Le immagini non più citate dall'indice e più vecchie di un giorno vengono eliminate a ogni sblocco.

**Migrazione dalla 0.2** (automatica e silenziosa, `personale/lib/archivio.js`): firme e iniziali (`leggio.moduli.firme.v1`)
e profilo (`leggio.moduli.profilo.v1`) passano dal localStorage all'archivio cifrato; le chiavi vecchie vengono tolte dal
localStorage **solo dopo** il salvataggio riuscito (se fallisce, si riprova al prossimo avvio). Le preferenze
(`leggio.moduli.pref.v1`: colore, dimensione del testo) restano dove sono.

## Modello dei dati (renderer)
`personale/lib/archivio.js` → `createArchivio({ backend, legacyStorage, chiediPassword, log })`, un'unica istanza
(`lib/condiviso.js` → `archivioPersonale()`; in console `window.__leggioPersonale.archivio`). Cache in memoria e
salvataggio raggruppato (250 ms; `salvaOra()` per forzarlo). Eventi `cambiato`, `salvato`, `errore`, `ripristinato`.
Nell'anteprima web e nei test il backend è in memoria / localStorage (`lib/backend.js`, **non cifrato**, solo sviluppo).

| Sezione | Campi |
|---|---|
| `profilo` | dati «io» (chiavi di `PROFILE_FIELDS` + `iban`) |
| `firme` | `{ id, nome, tipo: 'firma'|'sigla', proprietario: 'io'|idContatto, blob, w, h, origine, creata, usata }` |
| `timbri` | `{ id, nome, tipo: 'immagine'|'testo', blob?, w, h, spec?, creato, usato }` |
| `contatti` | `CAMPI_CONTATTO` di `lib/campi.js` + `gruppi[]`, `creato`, `modificato`, `origine` |
| `registro` | `{ id, quando, firmaId, firmaNome, tipo, proprietario, proprietarioNome, documento, pagine, azione }` |
| `modelli` | vedi «Modelli» |

## Firme, sigle e timbri (strumenti nell'area «moduli», dati qui)
- Archivio con nome, tipo (firma/sigla) e proprietario («io» o un contatto); nessun limite di numero.
- Creazione: disegnata, scritta con un carattere manoscritto incluso (`src/renderer/public-assets/fonts`: Dancing
  Script e Great Vibes, licenza SIL OFL 1.1, testi accanto ai file) o con uno installato, oppure da **foto o scansione**
  (`moduli/lib/foto.js`: luminosità della carta stimata a blocchi per compensare ombre e luce non uniforme, carta colorata
  riconosciuta anche dalla tinta, sensibilità regolabile, rotazione, ritaglio automatico o col mouse/tastiera, colore
  dell'inchiostro nero, blu o originale).
- **Firme di altre persone**: prima dell'uso una conferma esplicita (casella «Confermo di essere autorizzato/a da …»,
  una volta per firma e documento nella sessione); dopo la scrittura nel PDF una voce nel **registro** (quale firma, di
  chi, quale documento, quali pagine, quando). Registro consultabile in «Archivio personale» → «Registro delle firme»,
  filtrabile per persona ed esportabile in CSV.
- Testo nell'interfaccia: la firma disegnata/scritta/fotografata è una **firma elettronica semplice** e non sostituisce
  la firma digitale; collegamento diretto a «Usa un certificato» (`digital-sign`).
- Timbri: modelli pronti («Copia conforme all'originale», «Ricevuto il [data]», «Annullato», «Visto», «Pagato»), timbro
  dell'ente composto (tondo con testo lungo il bordo, rettangolare o senza bordo; righe al centro; doppio bordo; data) o da
  immagine con lo sfondo tolto; colore, rotazione, data automatica; su una pagina o su più pagine.

## Strumenti dell'area
| id | Nome | Cosa fa |
|---|---|---|
| `personal-archive` | Archivio personale | Protezione e password, backup (esporta/importa), cosa c'è archiviato, firme, timbri, registro. |
| `signatures-library` | Firme e sigle salvate | Rinomina, firma/sigla, cambia proprietario, elimina. |
| `stamps-library` | Timbri salvati | Crea, modifica, elimina. |
| `signatures-log` | Registro delle firme | Usi delle firme di altre persone; CSV. |
| `rubrica` | Rubrica | vedi sotto. |
| `mail-merge` | Compilazione in serie | vedi sotto. |
| `save-template`, `template-zones`, `templates` | Modelli | vedi sotto. |

## Rubrica (`rubrica`)
- Persone ed enti con nome, cognome, ragione sociale, codice fiscale, partita IVA, data e luogo di nascita, PEC, email,
  telefono, IBAN, codice destinatario SDI, indirizzo (via, CAP, città, provincia, nazione), ruolo, note, gruppi.
- Validazione (`lib/validatori.js`): codice fiscale con omocodie e controllo del giorno sul mese, partita IVA, IBAN
  (lunghezza per paese e mod 97), codice SDI (7 caratteri, 6 per la PA, `0000000`, `XXXXXXX` estero), email, PEC (dal
  dominio), CAP. Sempre **avvisi**, mai blocchi. Dal codice fiscale si propone la data di nascita.
- Import da CSV ed Excel `.xlsx` (`lib/tabelle.js`, lettore ZIP/XML senza dipendenze: stringhe condivise, rich text, date
  con stile data → gg/mm/aaaa, codici lunghi senza notazione esponenziale; CSV con separatore riconosciuto, BOM,
  Windows-1252) con la **finestra di corrispondenza delle colonne** (`ui/importa.js`), e da vCard 2.1/3.0/4.0
  (`lib/vcard.js`). Doppioni con i contatti già presenti: salta, aggiorna i campi vuoti o aggiungi. Export CSV (tutti,
  filtrati o selezionati), con protezione dalle formule di Excel.
- Ricerca istantanea senza accenti (1–4 ms per tasto con 5000 contatti), filtro per gruppo, doppioni segnalati (stesso CF,
  P.IVA, email/PEC o nome compatibile) e **unibili** (firme, registro e modelli passano al contatto che resta:
  `archivio.riassegnaProprietario`).
- **Fatture elettroniche**: aprendo una FatturaPA compare il riquadro «Rubrica» (`ui/fattura-rubrica.js`) per salvare
  fornitore (gruppo «fornitori») e cliente (gruppo «clienti»); se c'è già (stessa P.IVA o CF) dice «Già in rubrica» e
  offre di completare i dati mancanti. L'archivio si apre (e chiede la password) solo al clic.
- **GDPR** nella scheda del contatto: esporta tutti i dati della persona (JSON con firme e registro), cancella la persona
  e tutto ciò che la riguarda (firme comprese, anche dal backup automatico); «Archivio personale» → «Cosa c'è
  archiviato» elenca tutto.
- `ui/scegli.js` → `scegliContatto(app, archivio, { titolo, messaggio, consentiIo, testoIo })` → `'io' | contatto | null`,
  usato da «Compila a nome di», proprietario delle firme e serie.

## Modelli (`save-template`, `template-zones`, `templates`)
- Un modello è un modulo con le **corrispondenze** campo → dato (`lib/modelli.js`): `tipo: 'acroform'` (campi del PDF)
  o `'zone'` (PDF non compilabile con rettangoli disegnati a mano dallo strumento «Zone da compilare», ognuno con dato,
  dimensione e allineamento). Il PDF di base è salvato cifrato nell'archivio.
- Riconoscimento: `modelloPerDocumento` confronta l'impronta SHA-256 del PDF e, per i moduli compilabili, l'impronta dei
  campi (riconosce anche una copia già compilata). «Compila a nome di» e la serie usano le corrispondenze salvate.

## Compilazione in serie (`mail-merge`)
Procedura guidata (`ui/serie.js`): 1) modulo (documento aperto, modello salvato o PDF dal disco); 2) dati (gruppo o
selezione della rubrica, oppure CSV/Excel); 3) abbinamento campi ↔ colonne con proposta automatica e **anteprima sul primo
record** (scorribile); 4) opzioni: firma o timbro su tutti (firme di altre persone: conferma e una voce di registro per
ogni documento), schema dei nomi (`{cognome}_{nome}_domanda.pdf`, anche `{n}`, `{data}`, `{Nome colonna}`), un PDF per
persona in una cartella (mai sovrascritti: `nome (2).pdf`) oppure un PDF unico, campi appiattiti a scelta.
Generazione in un **Web Worker** (`serie.worker.js`, ripiego sul thread principale), a gruppi, con barra e «Interrompi»;
un record con errori (campi abbinati vuoti, codice fiscale non valido, errori di scrittura) non ferma gli altri e finisce
nel riepilogo, esportabile in CSV. Misure: 500 record ≈ 4 s nell'app con scrittura su disco, interfaccia sempre reattiva.

## Test
- `test/personale-cassaforte.test.js` — cifratura, nessun dato in chiaro, protezione del sistema e ripiego, password
  (blocco, errata, cambio, rimozione), backup automatico e recupero da indice danneggiato, purga GDPR, scritture
  concorrenti, 5000 contatti e 500 firme, validazione, blob non scambiabili, pulizia degli orfani, export/import, canali IPC.
- `test/personale-cassaforte-031.test.js` — 0.3.1: parametri scrypt e tempi (con il ciclo degli eventi libero),
  **compatibilità con archivi e backup creati dalla 0.3.0** (`test/fixtures/personale-0.3.0`, generati con il codice della
  0.3.0: `genera.cjs`), rafforzamento della chiave (anche con disco pieno e con interruzione fra chiave e copia), chiave
  danneggiata o mancante, portachiavi azzerato, disco pieno, password sbagliata dopo il rafforzamento, backup completo e
  ripristino **end-to-end** su un computer nuovo attraverso i canali IPC veri e il modello dei dati del renderer.
- `test/personale-avvisi.test.js` — robustezza della password, promemoria del backup, avviso del portachiavi una volta
  sola, nuovo tentativo di salvataggio dopo un errore di scrittura.
- `test/personale-archivio.test.js` — migrazione dalla 0.2 (anche con salvataggio fallito), password, firme senza limite,
  firme altrui e registro, timbri, GDPR (esporta/cancella), unione dei backup, campi per «Compila a nome di».
- `test/moduli-firme-timbri.test.js` — firma da foto (carta colorata, ombra, inchiostro blu, tratto a matita), timbri,
  posizioni sulle pagine ruotate e su formati diversi, profilo dall'archivio.
- `test/personale-rubrica.test.js`, `test/personale-validatori.test.js`, `test/personale-tabelle.test.js` — ricerca,
  doppioni e unione, mappatura colonne, import con doppioni, vCard, CSV, fatture; validatori; CSV ed Excel (anche deflate).
- `test/personale-serie.test.js` — nomi dei file, abbinamenti, controlli per record, 100 PDF veri riletti, PDF unico,
  zone su PDF non compilabile, firma, interruzione, modelli e riconoscimento.
- Collaudi nell'app vera: `npx vite build && node test/e2e/serie-100.mjs` (100 record dalla rubrica, `RECORD=500` per 500)
  e `npx vite build && node test/e2e/archivio-personale.mjs` (migrazione reale dal localStorage,
  file cifrati su disco, conferma e registro di una firma altrui, password al riavvio con dialogo vero, backup esportato e
  reimportato con i dialoghi di sistema).
- Collaudo 0.3.1 nell'app vera, su un Linux senza portachiavi: `npx vite build && xvfb-run -a node test/e2e/archivio-0.3.1.mjs`
  (avviso del portachiavi una volta sola, indicatore di robustezza, sblocco e rafforzamento di un archivio della 0.3.0,
  promemoria del backup, finestra di recupero con la chiave rovinata).
