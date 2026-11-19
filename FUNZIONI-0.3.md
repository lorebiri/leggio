# Leggio 0.3 — firme, timbri, rubrica e compilazione in serie

Branch `claude/firme-rubrica-0.3` (da main 0.2.2). La versione in package.json è 0.3.0; non c'è stato
nessun merge, tag o rilascio: decide Lorenzo. Dettagli tecnici in `docs/aree/personale.md` e `docs/aree/moduli.md`.

## Cosa c'è e come si usa

### 1. Archivio personale cifrato (la base)
- Firme, sigle, timbri, rubrica, modelli, profilo «io» e registro delle firme stanno in un archivio **cifrato** nella
  cartella dati di Leggio. Non ci sono più limiti di numero e non si usa più il localStorage.
- **Migrazione automatica e silenziosa**: al primo avvio della 0.3 le firme, le iniziali e il profilo della 0.2 passano
  nell'archivio. Dal localStorage vengono tolti solo dopo il salvataggio riuscito.
- Si usa da **Strumenti → «Archivio personale»**, dove ci sono:
  - la protezione (password facoltativa: impostala, cambiala, toglila, oppure «Blocca ora»);
  - il backup: esporta un file `.leggio-backup` cifrato con una password tua, e reimportalo scegliendo «Unisci» o
    «Sostituisci»;
  - «Cosa c'è archiviato»;
  - firme e sigle, timbri e registro delle firme.

### 2. Firme e sigle
- **Crea una firma** (Compila e firma → «✍ Firma ▾» → «Crea una nuova firma…»), in tre modi:
  - **Disegna**;
  - **Scrivi**, con due caratteri a mano inclusi (Dancing Script e Great Vibes, licenza OFL) o con quelli installati;
  - **Foto o scansione**: sfondo, ombre e colore della carta vengono tolti da soli; si regolano sensibilità e
    rotazione, il ritaglio è automatico oppure a mano (mouse o tastiera); l'inchiostro può essere nero, blu o originale.
- Ogni firma ha un **nome**, un **tipo** (firma o sigla) e un **proprietario** («io» o un contatto della rubrica).
- **Firme rapide e timbri ▾**:
  - «Sigla tutte le pagine»: la posizione si sceglie una volta (anche «dove l'ho messa io»), su tutte le pagine,
    tutte tranne l'ultima o un intervallo; funziona anche sulle pagine ruotate;
  - «Luogo, data e firma»: luogo ricordato, data di oggi, dicitura («Firma», «In fede»…).
- **Firme di altre persone**: prima dell'uso compare una conferma esplicita con una casella da spuntare. Dopo che la
  firma è stata scritta nel PDF, una voce va nel **registro** (quale firma, di chi, documento, pagine, quando).
  Il registro si consulta e si esporta in CSV da «Archivio personale» → «Registro delle firme».
- Nell'interfaccia c'è sempre il testo che spiega che la firma grafica è una **firma elettronica semplice** e non
  sostituisce quella digitale, con un collegamento a «Firma digitale con certificato…» («Che valore ha?»).
- Le firme salvate si gestiscono da «Firme e sigle salvate»: rinomina, firma o sigla, cambia proprietario, elimina.

### 3. Timbri (versione semplice)
- Modelli pronti: «Copia conforme all'originale», «Ricevuto il [data]», «Annullato», «Visto», «Pagato».
- **Timbro dell'ente**: composto con il testo (tondo con il testo lungo il bordo, rettangolare o senza bordo; righe al
  centro; doppio bordo; data), oppure ricavato da un'immagine con lo sfondo tolto.
- Al momento dell'inserimento si scelgono colore e rotazione; la data è automatica. Il timbro va su questa pagina
  oppure su più pagine.

### 4. Rubrica
- Si apre da **Strumenti → «Rubrica»**, a tutta area.
- **Ricerca e organizzazione**:
  - ricerca istantanea, provata con 5000 contatti;
  - filtro per gruppo;
  - selezione multipla;
  - si usa tutta da tastiera.
- **Campi e controlli**:
  - tutti i campi richiesti più data e luogo di nascita;
  - avvisi, mai bloccanti, su codice fiscale (con omocodie), partita IVA, IBAN, codice SDI, email, PEC e CAP.
- **Import ed export**:
  - import da CSV ed Excel `.xlsx`, con la finestra di corrispondenza delle colonne, e da vCard;
  - i doppioni si saltano, si aggiornano o si aggiungono;
  - export in CSV.
- **Doppioni già in rubrica**: vengono segnalati e si possono unire. Le firme e il registro passano al contatto che resta.
- **Fatture elettroniche**: aprendo una FatturaPA, il riquadro «Rubrica» propone di salvare fornitore e cliente, senza
  creare doppioni (riconosciuti per partita IVA o codice fiscale).
- **GDPR**, nella scheda del contatto:
  - «Esporta tutti i dati di questa persona»;
  - «Cancella questa persona e tutto ciò che la riguarda», firme comprese, anche dal backup automatico.

### 5. «Compila a nome di…»
- Si avvia dalla barra dei moduli compilabili o da Strumenti.
- Si sceglie «Io» o un contatto: Leggio propone i valori per i campi vuoti che riconosce. Il riconoscimento è quello
  di PROFILE_FIELDS, esteso a ragione sociale, P.IVA, PEC, IBAN, codice SDI e altri campi.
- Se il modulo è salvato come modello, usa gli abbinamenti del modello.
- **Anteprima** con i valori modificabili e l'avviso sul codice fiscale: niente viene scritto prima di «Compila».
- In «Compila e firma», il menu «Dati ▾» → «Usa i dati di un'altra persona…» fa lo stesso, un dato alla volta.

### 6. Compilazione in serie
- Si avvia da **Strumenti → «Compilazione in serie»** e procede in quattro passi.
- **Passo 1: il modulo.** Il documento aperto, un modello salvato o un PDF dal disco. Per i PDF non compilabili ci
  sono le «Zone da compilare».
- **Passo 2: i dati.** Un gruppo o una selezione della rubrica, oppure un file CSV o Excel.
- **Passo 3: l'abbinamento.** Campi e colonne vengono abbinati in automatico (si può correggere), con l'anteprima sul
  primo record e la possibilità di scorrere gli altri.
- **Passo 4: le opzioni.**
  - una firma o un timbro su tutti (per le firme di altre persone: conferma e registro per ogni documento);
  - lo schema dei nomi, per esempio `{cognome}_{nome}_domanda.pdf`;
  - un PDF per persona in una cartella (mai sovrascritto: diventa «nome (2).pdf») oppure un unico PDF.
- **Durante la generazione**: barra di avanzamento e «Interrompi». Gli errori (campi mancanti, codice fiscale non
  valido) non fermano gli altri record e finiscono in un riepilogo esportabile.
- **Velocità**: 100 PDF in circa 1,3 s e 500 in circa 4 s nell'app, compresa la scrittura su disco. La generazione
  avviene in un Worker e l'interfaccia resta reattiva.

### 7. Modelli
- «Salva come modello»: un modulo con gli abbinamenti dei campi.
- «Zone da compilare»: rettangoli disegnati a mano su un PDF non compilabile.
- «I miei modelli»: elenco, rinomina, elimina.
- Il modulo viene riconosciuto da solo, dall'impronta del PDF o dai suoi campi, sia in «Compila a nome di» sia nella
  serie.

## Scelte di sicurezza
- **Dove avviene la cifratura.** Solo nel processo principale (`electron/personale/cassaforte.cjs`): AES-256-GCM con
  una chiave dati casuale da 256 bit. Ogni file è legato al proprio nome, quindi due file scambiati vengono rifiutati.
- **Come è protetta la chiave dati.**
  - Normalmente da `safeStorage` di Electron: Portachiavi su macOS, DPAPI su Windows, libsecret su Linux.
  - **Ripiego documentato**: su Linux senza portachiavi Electron userebbe una chiave fissa (`basic_text`), che non
    consideriamo sicura. In quel caso la chiave resta in un file leggibile solo dal proprio utente (0600);
    l'interfaccia lo dice e consiglia la password. Appena il portachiavi c'è, la protezione passa al sistema da sola.
  - **Password facoltativa**: derivata con scrypt (N=32768); la chiave avvolta dalla password è a sua volta protetta
    dal sistema. Dopo 3 errori di fila le risposte rallentano. Una password dimenticata non si recupera, e
    l'interfaccia lo dice.
- **Scritture.** Atomiche e verificate, una alla volta. Il backup automatico dell'ultima versione viene usato se
  l'indice si danneggia. Se la chiave non è più leggibile, l'archivio viene messo da parte e mai cancellato.
- **Renderer e IPC.**
  - Il renderer non vede mai la chiave né, dopo l'invio, la password.
  - Canali `feat:personale:*` validati: identificativi senza percorsi, dimensioni massime, forma e profondità
    dell'indice. Accettano solo la pagina dell'app.
  - Il file da importare lo sceglie il main con il dialogo; il renderer riceve un gettone, mai un percorso.
- **Cancellazione.** Le immagini vengono sovrascritte prima di essere eliminate; la cancellazione GDPR riscrive anche
  il backup automatico.
- **Nessuna rete**: niente sincronizzazione, tutto resta sul PC.
- **Unica modifica al nucleo**: `file:write-in-folder` accetta `unico: true` (non sovrascrive), usato dalla serie. In
  più il main passa `log` ai moduli delle aree.

## Test
- **vitest**: 941 superati e 3 saltati su tutta la suite (prima della 0.3 erano 838). I test nuovi:
  - `test/personale-cassaforte.test.js`: archivio e cifratura;
  - `test/personale-archivio.test.js`: modello dati, migrazione, GDPR, unione dei backup;
  - `test/personale-validatori.test.js`, `test/personale-tabelle.test.js`, `test/personale-rubrica.test.js`: rubrica,
    import ed export, vCard, fatture;
  - `test/personale-serie.test.js`: serie e modelli, con 100 PDF veri riletti;
  - `test/moduli-firme-timbri.test.js`: foto, timbri, posizioni sulle pagine ruotate.
- **Collaudi nell'app Electron vera** (Playwright), tutti superati:
  - `node test/e2e/archivio-personale.mjs`: migrazione reale dalla 0.2, file cifrati su disco, firma altrui con
    conferma e registro, password al riavvio, backup esportato e reimportato, firma da foto;
  - `node test/e2e/serie-100.mjs`: serie da 100 record dalla rubrica, interfaccia reattiva, 100 PDF con i dati giusti,
    modello salvato. Con `RECORD=500` fa 500 record.
- `npx vite build` pulita. Prima di ogni push sono passati i test e la build, come fa la CI.
- **Non provati**: Windows e macOS veri (la CI li prova solo con i test unitari) e un portachiavi vero su Linux (il
  collaudo è girato sul ripiego).

## Limiti noti
- Nel PDF unico della serie i campi vengono sempre appiattiti, per evitare nomi di campo doppi.
- I timbri di solo testo non sono proposti nella serie.
- La rubrica esporta solo in CSV, non in vCard o Excel.
- `personale/lib/acroform.js` duplica alcune funzioni di `moduli/formtools.js`: serve perché il Worker non può
  importare l'interfaccia.
