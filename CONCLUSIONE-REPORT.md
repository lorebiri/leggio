# Leggio — rapporto di conclusione

Branch: `claude/leggio-conclusione` (parte da `claude/debug-completo`, con le sue 52 correzioni).
Nessun merge su main, nessuna pull request, nessuna release pubblicata, nulla acquistato o registrato.
Data: 18 novembre 2026.

## In breve

- **4 bug segnalati dagli utenti: tutti riprodotti, coperti da test e corretti** (download «non sicuro»: tutto
  il possibile senza spendere + pipeline di firma pronta; testo nelle tabelle; file .p7m; stampa di fogli bianchi).
- **Funzioni nuove**: **copia documento fronte/retro** su un solo foglio in dimensione reale (la «redazione»
  chiesta da Lorenzo); pagina di download e presentazione in `site/` con workflow per GitHub Pages (non
  pubblicato); come funzione secondaria, oscuramento dei documenti d'identità con filigrana.
- **Pacchetto Linux** (AppImage) aggiunto e provato.
- Test automatici: **prima 711 superati** (68 file) → **dopo 789 superati** (75 file; gli stessi 3 test saltati di prima, solo per macOS); collaudi nel browser e nell'app vera
  tutti superati (elenco in fondo).
- **Decisione principale per Lorenzo: la firma del codice** (raccomandata SignPath Foundation, gratuita).

---

## 1. Bug segnalati

### Bug 1 — Il download risulta «non sicuro» (SmartScreen, Chrome, Edge)

**Causa.** Gli eseguibili non sono firmati (Authenticode su Windows, Developer ID + notarizzazione su macOS)
e il progetto non ha ancora «reputazione». Nessuna modifica al codice elimina l'avviso: serve la firma.

**Cosa è stato fatto (gratis):**

| Intervento | Dove |
|---|---|
| Metadati dell'eseguibile completi: editore (autore come oggetto, così finisce in *CompanyName*), versione, descrizione, copyright, marchio, homepage, repository | `package.json` |
| Pubblicazione solo da GitHub Releases in HTTPS; il workflow calcola **`SHA256SUMS.txt`** e lo carica nella bozza insieme ai pacchetti | `.github/workflows/release.yml` (job «Impronte») |
| L'avviso di aggiornamento dell'app apre **solo** `https://github.com/lorebiri/leggio/releases/download/…`: qualunque altro indirizzo (anche da una risposta dell'API alterata) viene scartato | `electron/updater.cjs` → `safeDownloadUrl` |
| **Pipeline di firma pronta ma spenta**: Windows con SignPath (gratuito) o Azure Trusted Signing, macOS con Developer ID e notarizzazione, controllo finale della firma Authenticode. Si accende con segreti e variabili del repository, senza toccare il codice | `release.yml`, `scripts/config-firma.cjs`, `scripts/firma-lib.cjs` |
| Pagina di download con le istruzioni per superare gli avvisi finché manca la firma | `site/` |
| Confronto delle opzioni di firma, costi, passi | `docs/FIRMA-DEL-CODICE.md` |

**Test.** `test/firma-config.test.js` (6): senza segreti la configurazione è identica a `package.json`; con i
segreti si attivano Developer ID/notarizzazione o Azure; il workflow pubblica solo bozze, calcola le impronte e
non scarica nulla da altri domini; metadati presenti. `test/aggiornamenti.test.js` (+2): rifiuta HTTP, altri
domini, altri repository, credenziali nell'URL, `javascript:`; Linux sceglie l'AppImage.
Build reali eseguite qui: pacchetto **Linux AppImage** costruito e avviato, `verifica-pacchetto` superata;
**installer Windows**: lo script NSIS nuovo compila con `makensis` (il pacchetto completo richiede Wine, che qui
non c'è: lo costruisce GitHub Actions su Windows).

### Bug 2 — Testo nelle tabelle trattato come un'unica frase

**Causa.** Il raggruppamento del testo in blocchi modificabili (`groupTextItems`) univa nella stessa riga due
pezzi di testo distanti meno di 2,2 volte il corpo del carattere: lo spazio tra due colonne di una tabella è
quasi sempre più piccolo, quindi l'intera riga diventava una frase. Poi le celle di una colonna si univano anche
in verticale (es. «2↵1↵3»). In più pdf.js mette già in un solo pezzo celle con margini stretti, e l'interprete del
contenuto non leggeva le **linee** disegnate nella pagina, quindi i bordi delle celle non venivano usati.

**Correzione** (`src/renderer/features/modifica/`):
- `interpreter.js` raccoglie i filetti disegnati (linee, bordi di rettangoli, rettangoli sottili), anche dentro gli
  elementi grafici composti;
- `blocks.js` divide le righe in **celle** quando un filetto verticale cade tra due testi (anche dentro lo stesso
  pezzo di pdf.js) o quando uno spazio è allineato su tre o più righe (tabelle senza linee); le celle non si
  uniscono con la riga sotto se c'è un filetto o se cambia cella; restano unite le righe che vanno a capo nella
  stessa cella. Ogni cella sa riga, colonna, bordi e allineamento. Paragrafi normali, testo giustificato, elenchi,
  puntini di guida e impaginazioni a due colonne restano come prima;
- `operations.js`, `rewrite.js`: si riscrivono **solo i glifi della cella**; se altre celle stanno nello stesso
  comando di testo del PDF vengono tenute ferme; il testo più lungo va a capo nella larghezza della cella o si
  rimpicciolisce (fino al 60%, con avviso); i numeri allineati a destra restano allineati a destra;
- `ui/common.js`, `ui/editmode.js`: il riquadro cliccabile copre solo la cella e l'editor ne prende la larghezza.

**Test.** `test/modifica-tabelle.test.js` (17; sul codice di prima ne fallivano 14 su 16): fattura con griglia,
modulo PA fatto di rettangoli, tabella senza linee, tabella con soli filetti orizzontali, pagina di testo normale
(paragrafi, giustificato, puntini, elenco, due colonne), celle nello stesso comando di testo; dopo ogni modifica
la pagina viene riletta: tutte le altre celle restano ferme entro 0,5 pt. Collaudo nell'interfaccia vera
`test/e2e/tabelle-modifica.mjs`: **prima 2/6** (cliccando «250,00» si apriva «250,00 22%» e il 22% si
spostava), **dopo 6/6**. I test di modifica esistenti restano verdi.

**PDF reali** (blocchi modificabili prima → dopo; i file non sono nel repository):

| PDF | Prima → dopo | Nota |
|---|---|---|
| F24 semplificato compilato (esempio della Scuola Normale) | 110 → 182 (147 celle) | «giorno / mese / anno» separati, griglia degli importi cella per cella |
| F24 semplificato vuoto | 142 → 214 | |
| Tabella di esempio W3C | 30 → 34 | «34.5%, n=1 1199 sec, n=1» ora sono due celle |
| Modulo W-9 (IRS) | 269 → 297 | |
| `conv-contratto-v1.pdf` (fixture) | | la tabella Articolo/Quantità/Prezzo/Totale è cella per cella; i paragrafi a due colonne restano interi |

**Limiti.** Se pdf.js unisce due celle in un unico pezzo, il punto di divisione è stimato (il riquadro può essere
leggermente impreciso, la riscrittura no); celle senza bordi in cui *tutte* le colonne vanno a capo insieme non
vengono riconosciute; in tabelle senza linee con descrizioni lunghe e interlinea regolare le righe possono
sembrare un paragrafo; gli sfondi colorati delle celle non sono usati come bordi (apposta).

### Bug 3 — File .p7m: estensione cambiata, «Documento PDF» in Windows

**Cause (due).**
1. **Azioni guidate › «Sostituisci gli originali»**: per un `.p7m` il PDF estratto veniva scritto **sopra il file
   firmato**, con lo stesso nome (`contratto.pdf.p7m` diventava un PDF con estensione .p7m; la firma era persa).
   Lo stesso accadeva alle fatture `.xml`, sostituite dal PDF impaginato.
2. **Installer Windows**: le associazioni standard di electron-builder davano ai `.p7m` l'icona del programma —
   la stessa dei PDF — con una classe dal nome generico, e prendevano il posto del programma predefinito
   (Dike, ArubaSign…). In Esplora risorse i documenti firmati sembravano PDF.
   In più il PDF estratto proponeva il nome `contratto.pdf`, che con le estensioni nascoste di Windows appare
   quasi identico a `contratto.pdf.p7m`: sembrava che il file fosse stato rinominato.

**Correzione.**
- Il `.p7m` originale non si riscrive mai: **controllo nel processo main** (`safeWrite` rifiuta di sovrascrivere
  un `.p7m/.p7s/.m7m/.tsd` esistente) e nelle Azioni guidate il PDF va **accanto** come `contratto (da p7m).pdf`.
- Il PDF contenuto si apre **in memoria** (nessun percorso) con il nome distinto `contratto (da p7m).pdf`, il
  pannello «Firme» mostra la verifica; qualunque salvataggio chiede dove salvare («Salva come»).
- Installer Windows: nuovo `build/installer.nsh` con classi distinte **Leggio.PDF** e **Leggio.FirmatoP7M**
  («Documento firmato digitalmente (CAdES)», **icona propria** `build/p7m.ico`), Leggio in «Apri con» senza
  scavalcare un programma predefinito già presente, pulizia delle classi delle versioni precedenti e
  disinstallazione pulita. macOS: tipo e icona propri (`build/p7m.icns`). Le icone si rigenerano con
  `scripts/genera-icone-documenti.mjs`.

**Test.** `test/p7m-originale.test.js` (7, falliti prima della correzione) e collaudo nell'app Electron vera
`test/e2e/p7m-app.mjs` (**6/6**): il .p7m aperto «dal sistema» resta identico byte per byte e con la stessa data
di modifica, nessun file nuovo o rinominato nella cartella, il main rifiuta di scriverci sopra.

### Bug 4 — Stampa di fogli bianchi (e solo della prima pagina)

**Riproduzione.** Collaudo con il motore di stampa vero di Chromium (`page.pdf` nel browser e
`webContents.printToPDF` in **Electron 45**): con il codice di prima **qualunque documento usciva come un solo
foglio bianco** (0/4 in Electron, 1/8 nel browser).

**Cause.**
1. L'area di stampa `#print-root` stava **dentro** `#app`, e il CSS di stampa nasconde proprio `#app` →
   foglio bianco.
2. `overflow: clip` e altezza 100% su `html`/`body` (regola della «finestra adattiva») valevano anche in stampa
   → tutto ciò che stava dopo il primo foglio veniva tagliato.
3. Pagine grandi (A0, striscioni) ad alta qualità superavano i limiti del canvas di Chromium, che in quel caso
   resta **vuoto senza errori**.

**Correzione.** Area di stampa spostata sotto `<body>`; CSS di stampa senza ritagli, una pagina per foglio
(senza fogli bianchi intermedi da arrotondamenti); risoluzione limitata a quella utile sul foglio
(`fitScale`/`printPixelBudget`: massimo ~A3 alla qualità scelta, mai oltre 36 milioni di pixel); attesa del
disegno prima di inviare alla stampante (Windows); messaggio chiaro se manca memoria invece di un foglio
bianco. Trasparenze e font incorporati sono già «appiattiti» nell'immagine stampata (rasterizzazione ad alta
risoluzione, fino a 300 dpi): è il fallback richiesto, ed è la strada usata per tutte le stampe.

**Test.** `test/stampa-fogli-bianchi.test.js` (3); `test/e2e/stampa.mjs` (**8/8**: 1 e 5 pagine, formati misti,
trasparenze, A0, striscione 5×0,4 m, A0 a 300 dpi); `test/e2e/stampa-electron.cjs` (**prima 0/4, dopo 4/4**);
`test/e2e/pdf-vari.mjs` stampa anche i PDF reali (F24, W-9, tabelle) e quelli non latini: tutte le pagine,
nessun foglio bianco. Non verificabile qui: una stampante fisica Windows (serve una prova di Lorenzo).

### Altri bug trovati durante il lavoro

| Bug | Gravità | Correzione |
|---|---|---|
| Azioni guidate «Sostituisci gli originali» scriveva il PDF impaginato **sopra la fattura `.xml`** | alta | come per i .p7m: PDF accanto, l'XML resta |
| `scripts/verifica-pacchetto.mjs` non trovava l'eseguibile su Linux (nome in minuscolo) | bassa | corretto |
| L'avviso di aggiornamento avrebbe aperto qualunque URL fornito dall'API | media | solo release del progetto in HTTPS |
| Pagine a due colonne con poco spazio tra le colonne: unite riga per riga in modifica | media | corretto con la correzione delle tabelle |
| Moduli a griglia: l'etichetta si univa al valore, e il valore con le righe sotto | media | corretto |
| Correzione «in loco» di una cella: le altre celle nello stesso comando di testo si spostavano | media | corretto |

---

## 2. Funzioni nuove

### A. Copia documento fronte/retro su un foglio

Come la funzione «copia carta d'identità» delle fotocopiatrici. Chi riceve la scansione di un documento (carta
d'identità elettronica, patente, tessera sanitaria, tesserino del codice fiscale) con il fronte su una pagina A4
e il retro su un'altra, ottiene **un solo foglio con fronte e retro, ritagliati, dritti e in dimensione reale**.

**Come si usa.** Strumenti → **«Copia documento fronte/retro»** (anche senza documenti aperti):
1. si parte dal PDF aperto, oppure si aggiungono PDF o **foto** (JPG, PNG, HEIC dove il sistema lo consente),
   anche **trascinandoli**; con più documenti nello stesso PDF le **coppie** fronte/retro si scelgono pagina per
   pagina (proposte: 1-2, 3-4…);
2. Leggio **trova la tessera** in ogni pagina (anche ruotata, spostata, fotografata di sbieco, su fondi diversi,
   bianca su bianco, con l'ombra dello scanner) e mostra il ritaglio raddrizzato; se sbaglia si trascinano i
   **4 angoli** (anche da tastiera) o si usa «Ruota», «Capovolgi», «Rileva di nuovo», «Tutta la pagina»;
3. opzioni: documento (**tessera ID-1 85,60 × 53,98 mm** oppure **carta d'identità cartacea** aperta
   150 × 110 mm), foglio **A4 o Letter**, **dimensione reale (1:1)** o ingrandita, colori o **bianco e nero**,
   **miglioramento del contrasto**, **filigrana** facoltativa «Copia per uso esclusivo di … – per … – data»;
4. **«Crea il PDF»**: un PDF nuovo, un foglio per coppia, fronte sopra e retro sotto, centrati, con un sottile
   contorno per ritagliare, a **300 dpi**. Si salva con «Salva con nome»; i file di partenza non cambiano.

Tutto avviene sul computer: nessun dato viene inviato.

**Come funziona il rilevamento** (`src/renderer/features/pagine/logica/copia-documento.js`): colore del fondo
stimato dalla cornice della pagina, pixel diversi dal fondo più i contorni forti, chiusura e riempimento,
componente più grande che non tocca il bordo, inviluppo convesso, rettangolo di area minima, lati rifiniti con le
rette dei bordi (esclusi gli angoli arrotondati) per correggere la prospettiva, omografia per raddrizzare;
orientamento orizzontale automatico (90°).

**Test.** `test/copia-documento.test.js` (19) con scansioni sintetiche: tessera dritta, spostata, ruotata di 7° e
-23°, su fondo grigio scuro, su fondo «legno» rumoroso, bianca su bianco, in prospettiva, con l'ombra del
coperchio, in verticale, capovolta, pagina vuota; impaginazione A4/Letter, reale/ingrandita, carta cartacea;
**nel PDF l'immagine misura 85,6 × 53,98 mm**. Collaudo nell'interfaccia vera `test/e2e/copia-documento.mjs`
(**13/13**): da un PDF di due pagine e da due foto trascinate esce un foglio A4 con fronte e retro a
85,60 × 53,98 mm, centrati, 1011 × 638 pixel (300 dpi), ritaglio con il contenuto giusto, bianco e nero; la
scansione di partenza resta identica. Il collaudo ha trovato e fatto correggere un errore (immagini disegnate
alla dimensione in pixel invece che in millimetri).

**Limiti.** Quando la tessera è in verticale non si può sapere se è girata a destra o a sinistra: se esce
capovolta, basta «Capovolgi» (il 180° non si riconosce in automatico). La misura della carta cartacea viene dalla
scheda PRADO del Consiglio UE (150 × 110 mm aperta) e va confermata con un documento vero. Per la stampa 1:1 la
finestra di stampa di altri programmi non deve usare «Adatta alla pagina» (la stampa di Leggio è già al 100%).
Non provato con scansioni di documenti veri (non ce ne sono qui, per ovvi motivi di riservatezza).

### A2. Oscuramento dei documenti d'identità (funzione secondaria)

Realizzata prima della correzione di Jarvis sul significato di «redazione»: resta disponibile.

**Come si usa.** Apri la scansione → strumento **Oscura** → **«Documento d'identità…»**:
1. scegli il documento — **carta d'identità elettronica** (fronte/retro), **carta d'identità cartacea**
   (facciate interne/copertina), **patente italiana** (fronte/retro) — e come appare (dritto o ruotato);
2. spunta i dati da coprire: numero del documento, MRZ (le righe con «<<<»), firma, foto, codice fiscale (anche
   il codice a barre), indirizzo, data e luogo di nascita;
3. trascina un riquadro **attorno al bordo della tessera** (fronte e retro sulla stessa pagina: una volta per
   lato), oppure scegli «la pagina contiene solo questo lato»;
4. Leggio segna le zone; puoi toglierle o aggiungerne a mano («Riquadro», «Testo selezionato», «Cerca e
   oscura», dove ora ci sono anche i modelli «Righe MRZ» e «Numero di carta d'identità o patente»);
5. **«Applica oscuramento…»**: facoltativamente scrivi **«Copia per uso esclusivo di…»** (es. «Comune di Pisa»),
   la finalità e la data. Salva come copia `nome_oscurato.pdf` (l'originale resta intatto).

**Perché è un oscuramento vero.** Le pagine interessate vengono ricostruite come immagine già oscurata: il testo
sotto le aree è eliminato dal file (non solo coperto), le immagini originali (foto, scansione) **sono tolte dal
file**, commenti e campi nelle aree eliminati, e una **verifica automatica** finale controlla che nessuno dei dati
sia ancora estraibile o copiabile; se la verifica non passa il risultato non viene salvato. La filigrana è
disegnata **dentro l'immagine di tutte le pagine** (non si può togliere). Con un modello di documento o con la
filigrana i **metadati** (titolo, autore, programma, XMP) vengono sempre tolti.

**Test.** `test/sicurezza-documenti-identita.test.js` (6): zone dei tre modelli, rotazione, MRZ e numeri di
documento, testo della filigrana; su una CIE scansionata codice fiscale, indirizzo e MRZ spariscono dal file,
nessun flusso contiene più i dati né l'immagine originale, metadati vuoti. Collaudo nell'interfaccia vera
`test/e2e/redazione-documenti.mjs` (**9/9**).

**Limiti.** Le zone dei modelli sono posizioni tipiche dei documenti italiani: vanno sempre controllate a occhio
prima di applicare (il riepilogo lo ricorda); la tessera va inquadrata con un riquadro dritto (sono previste
rotazioni di 90°, non inclinazioni). Le pagine oscurate diventano immagini (file più grande; il testo fuori
dalle aree resta ricercabile).

### B. Pagina di download (`site/`)

- Riconosce il sistema e propone il pulsante giusto (Windows installer o portatile; Mac Apple Silicon o Intel;
  Linux AppImage), con tutti gli altri file sotto «Altri sistemi»; versione, data, dimensioni e **impronte
  SHA-256** (con pulsante Copia) lette dall'ultima release di GitHub; senza JavaScript o se GitHub non risponde,
  porta alla pagina delle release.
- Istruzioni per controllare l'impronta e per superare gli avvisi di Edge, Chrome, SmartScreen e macOS.
- Funzioni principali, schermate vere dell'app, privacy, segnalazione dei problemi (GitHub Issues).
- Italiano, versione per telefono, tema chiaro e scuro, accessibile (salto al contenuto, focus visibile,
  contrasti AA), CSP restrittiva, nessun tracciamento.
- Workflow `.github/workflows/pages.yml` **solo manuale**: nulla viene pubblicato da sé.
- Test: `test/sito-download.test.js` (18) e 87 controlli Playwright (390 e 1280 px, chiaro e scuro, Windows,
  Mac, Linux, Android, API che risponde 403, tastiera).

---

## 3. Debug globale: prima e dopo

Stesso metodo del `DEBUG-REPORT.md`: build, tutti i test, prove nel browser con Playwright e nell'app Electron
vera su display virtuale (xvfb), sicurezza di Electron, `npm audit`, PDF di ogni tipo, stampa.

| Controllo | Prima (inizio di questo lavoro) | Dopo |
|---|---|---|
| `npm ci` | ok | ok |
| `npx vitest run` | 711 superati, 3 saltati (68 file) | **789 superati**, 3 saltati (75 file), 0 falliti |
| `npx vite build` | ok | ok |
| Pacchetto Linux AppImage + `verifica-pacchetto` | non previsto | costruito, si avvia, moduli ok |
| Installer Windows: script NSIS | associazioni standard | `installer.nsh` compila con makensis |
| `npm audit` (programma installato, `--omit=dev`) | 0 vulnerabilità | 0 vulnerabilità |
| `npm audit` (strumenti di build) | 6 moderate (minimatch in electron-builder) | invariato (vedi decisioni) |
| Sicurezza Electron (contextIsolation, sandbox, CSP, navigazione, permessi) | corretta | corretta, invariata |
| App vera: sola lettura (`sola-lettura-app.mjs`) | 11/11 | 11/11 |
| App vera: permessi (`permessi-app.mjs`) | 2/2 | 2/2 |
| App vera: HTML → PDF senza file locali | OK | OK |
| App vera: .p7m intatto (`p7m-app.mjs`, nuovo) | — (bug presente) | 6/6 |
| Electron: stampa (`stampa-electron.cjs`, nuovo) | **0/4** | 4/4 |
| Browser: nucleo (`nucleo-correzioni.mjs`) | 12/12 | 12/12 |
| Browser: stampa (`stampa.mjs`, nuovo) | **1/8** | 8/8 |
| Browser: copia documento fronte/retro (`copia-documento.mjs`, nuovo) | — | 13/13 |
| Browser: oscuramento documenti d'identità (`redazione-documenti.mjs`, nuovo) | — | 9/9 |
| Browser: PDF di ogni tipo (`pdf-vari.mjs`, nuovo) | — | 22/22 |
| Browser: modifica di una cella (`tabelle-modifica.mjs`, nuovo) | **2/6** | 6/6 |

`pdf-vari.mjs` apre e stampa: un PDF di 1500 pagine, uno protetto con password AES-256 con «ù» e «€», uno
troncato (riparato: 4 pagine), uno vuoto e uno non-PDF (messaggi chiari), un modulo con campi di ogni tipo,
una fattura con tabella, testo greco/cirillico/ebraico/arabo, pagine ruotate e di formati misti, e PDF reali
scaricati dal web (modello **F24 semplificato** vuoto e compilato, modulo **W-9**, tabella di esempio **W3C**).
I .p7m firmati sono provati in `p7m-app.mjs` e nei test CAdES esistenti.

---

## 4. Decisioni che spettano a Lorenzo

1. **Firma del codice (la più importante).** Dettagli e passi in `docs/FIRMA-DEL-CODICE.md`.

   | Opzione | Costo annuo | Note |
   |---|---|---|
   | **SignPath Foundation** (Windows) — *consigliata* | **0 €** | per progetti open source; serve domanda e approvazione; l'editore mostrato è «SignPath Foundation» |
   | Certum Open Source (Windows) | ~69 € (cloud) – 359 € (con lettore) | certificato a nome di Lorenzo, 1 anno |
   | Azure Artifact Signing (Windows) | ~120 USD | per le persone fisiche oggi solo USA/Canada |
   | Apple Developer Program (macOS) | 99 USD | unico modo per togliere l'avviso sul Mac |
   | Nessuna firma | 0 € | avvisi finché i download non creano reputazione |

   Passi: fare domanda a SignPath; dopo l'approvazione impostare in GitHub il segreto `SIGNPATH_API_TOKEN` e le
   variabili `FIRMA_WINDOWS=signpath`, `SIGNPATH_ORGANIZATION_ID`, `SIGNPATH_PROJECT_SLUG`,
   `SIGNPATH_POLICY_SLUG`; avviare a mano il workflow Release e controllare la firma.
2. **Pubblicare la pagina di download**: Settings → Pages → Source «GitHub Actions», poi Actions → «Pagina di
   download (GitHub Pages)» → Run workflow.
3. **Merge su main** di `claude/leggio-conclusione` e poi **rilascio** (tag `vX.Y.Z`): ricordare la voce in
   `novita.js` (il test lo impone) e controllare nella bozza gli 8 file + `SHA256SUMS.txt`.
4. **Pacchetto Linux**: tenerlo nelle release (costruito e provato qui) o toglierlo.
5. **Associazione dei .p7m su Windows**: oggi Leggio diventa il programma predefinito per i .p7m solo se non ce n'è
   già uno. Va bene così o deve solo comparire in «Apri con»?
6. **Copia documento fronte/retro**: provarla con una scansione vera e confermare la misura della carta
   d'identità cartacea (150 × 110 mm aperta).
7. **`npm audit`**: 6 avvisi «moderate» solo negli strumenti di build (minimatch dentro electron-builder): si
   può aggiungere un `overrides` in `package.json` (cambio di dipendenze) o aspettare electron-builder.
8. **Prova su Windows reale**: stampa su una stampante fisica, installer (icone e tipo dei .p7m in Esplora
   risorse), SmartScreen. Qui non c'è Windows.

---

## 5. Funzionalità (per la presentazione)

Leggio è un programma **gratuito** per **Windows, macOS e Linux** che apre, modifica, firma e protegge i
documenti PDF. Non serve un account e non c'è abbonamento. Funziona **senza Internet**: i file non escono mai
dal computer. L'unico collegamento è un controllo facoltativo degli aggiornamenti, una volta al giorno e senza
dati personali.

**Leggere**
- Apre uno o più PDF in schede, come un browser, anche quelli protetti da password; ripara da solo i file danneggiati.
- Zoom, vista a due pagine, due documenti affiancati, modalità lettura, tema chiaro e scuro, caratteri grandi.
- Miniature, segnalibri, allegati; ricerca nel testo e in tutti i PDF di una cartella; lettura ad alta voce.

**Commentare**
- Evidenziare, sottolineare, barrare; note, caselle di testo, disegni, forme, misure in scala.
- Timbri pronti in italiano («RICEVUTO», «PAGATO»…) o personali; riepilogo dei commenti; scambio con Acrobat.

**Modificare**
- Correggere un refuso o riscrivere un paragrafo con lo stesso carattere del documento.
- **Novità: nelle tabelle (fatture, moduli) si modifica una cella alla volta**, senza spostare le altre.
- Aggiungere testo, immagini, loghi, firme grafiche; trova e sostituisci; link.

**Organizzare le pagine**
- Riordinare, ruotare, eliminare, estrarre, inserire pagine; unire e dividere PDF (anche per la PEC).
- Numeri di pagina, intestazioni, filigrane, timbro «COPIA», più pagine per foglio, ridimensionamento ad A4.

**Creare e convertire**
- PDF da foto, scansioni, Word, Excel, PowerPoint, pagine web; esportazione in Word, Excel, testo, immagini.
- OCR: rende ricercabili le scansioni, senza Internet; confronto tra due versioni; PDF/A per la conservazione.

**Copia dei documenti (novità)**
- **Copia documento fronte/retro**: dalla scansione del fronte e del retro di carta d'identità, patente o tessera
  sanitaria, Leggio trova la tessera, la ritaglia e la raddrizza da solo e mette fronte e retro su **un solo
  foglio, in dimensione reale**, pronto da stampare o da allegare. Funziona con PDF e foto, anche con più
  documenti insieme; bianco e nero, contrasto, filigrana «Copia per uso esclusivo di … – data».
  Tutto sul computer, nessun dato inviato.

**Moduli e firme**
- Compilare qualunque modulo, anche non compilabile; riempire con un clic i dati personali o dell'ente.
- Firma digitale con certificato o con il programma già installato (Dike, ArubaSign…), anche di molti file.
- **File .p7m**: si aprono e si verificano le firme (chi, quando, se il documento è integro).
  **Novità: il file firmato originale non viene mai toccato**; il PDF contenuto si salva a parte, con un nome
  diverso, e in Windows i .p7m hanno la loro icona e il loro tipo.

**Proteggere i dati**
- Password e limiti a stampa, copia e modifica.
- Oscuramento vero dei dati riservati (codici fiscali, IBAN, email, telefoni…), anche cercandoli da solo.
- Copie dei documenti d'identità con dati oscurati (carta d'identità elettronica o cartacea, patente), con modelli pronti:
  si scelgono i dati da coprire (numero, codice MRZ, firma, foto, codice fiscale, indirizzo), che vengono
  eliminati davvero dal file, con la filigrana **«Copia per uso esclusivo di … – data»** e senza metadati.
- Pulizia dei dati nascosti; preparazione per la pubblicazione; riduzione delle dimensioni per la PEC.

**Stampare**
- Fronte/retro, copie, pagine scelte, più documenti insieme, timbro «COPIA» solo sulla carta.
- **Novità: stampa affidabile** di tutte le pagine, anche di formati grandi, con trasparenze o caratteri
  incorporati (prima alcune stampe uscivano bianche).

**Ufficio e pubblica amministrazione**
- Archivio d'ufficio sulle cartelle già in uso; fatture elettroniche, DURC, PEC; scadenze e pagina «Oggi».
- Preparazione per Titulus, dichiarazione di conformità, rinomina dei file dal contenuto, azioni su molti file.

**Scaricare in sicurezza**
- **Novità: pagina di download** che propone il file giusto per il computer, con le impronte di controllo
  (SHA-256) e le istruzioni per gli avvisi di Windows e macOS. Si scarica solo da GitHub, in modo sicuro.
- Salvataggio sicuro, recupero dopo un arresto, Annulla e Ripeti, uso completo da tastiera,
  «Segnala un problema» senza dati personali.
