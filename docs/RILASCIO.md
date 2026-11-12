# Rilascio di Leggio

Come si pubblica una nuova versione, cosa vedono gli utenti e cosa servirà per firmare l'app.
I pacchetti li costruisce GitHub Actions (`.github/workflows/release.yml`); in locale non serve
costruire nulla per rilasciare.

## In breve

```bash
# 1. versione nuova (senza creare commit e tag automatici)
npm version 0.2.0 --no-git-tag-version
# 2. aggiungi la voce in src/renderer/features/aggiornamenti/novita.js (vedi sotto)
# 3. controlla
npm test && npx vite build
# 4. commit su main, poi tag e push del tag
git commit -am "Leggio 0.2.0"
git push origin main
git tag v0.2.0
git push origin v0.2.0
```

Il push del tag avvia il workflow **Release**:

1. controlla che il tag (`v0.2.0`) coincida con `version` di `package.json`, altrimenti si ferma;
2. crea una **bozza** di release con le note generate da GitHub (elenco delle pull request);
3. su macOS e su Windows esegue i test, compila, crea i pacchetti, verifica che i moduli del processo main
   si carichino dal pacchetto (`scripts/verifica-pacchetto.mjs`) e li carica nella bozza.

Poi, a mano, su <https://github.com/lorebiri/leggio/releases>:

1. apri la bozza e controlla che ci siano **6 file**:
   `Leggio-X.Y.Z-mac-arm64.dmg`, `Leggio-X.Y.Z-mac-x64.dmg`, `Leggio-X.Y.Z-mac-arm64.zip`, `Leggio-X.Y.Z-mac-x64.zip`,
   `Leggio-X.Y.Z-win-x64-installer.exe`, `Leggio-X.Y.Z-win-x64-portatile.exe`;
2. scarica almeno un pacchetto e provalo;
3. **riscrivi l'inizio delle note in italiano semplice** (vedi «Avviso dentro l'app»), lasciando sotto l'elenco automatico;
   incolla anche il riquadro «Prima apertura» qui sotto;
4. premi **Publish release**. Solo da questo momento le app installate vedono la nuova versione.

Se qualcosa va storto: cancella la bozza e il tag (`git push origin :refs/tags/v0.2.0` e `git tag -d v0.2.0`),
correggi, e ripeti. Il workflow si può anche avviare a mano da Actions → Release → *Run workflow*: in quel caso
costruisce i pacchetti senza pubblicarli (si scaricano dagli «Artifacts» del run, conservati 14 giorni).

Una release segnata come **pre-release** non viene proposta agli utenti come aggiornamento.

## Avviso dentro l'app e «Novità di questa versione»

- `electron/updater.cjs` (processo main) qualche secondo dopo l'avvio, e poi ogni 24 ore se l'app resta aperta,
  legge `https://api.github.com/repos/lorebiri/leggio/releases/latest`. Ignora bozze e pre-release.
  È una sola richiesta GET anonima: nessun dato dell'utente, nessuna telemetria. Senza rete o con il limite
  dell'API raggiunto non mostra errori (riprova più tardi).
- Se la versione pubblicata è più nuova, l'area `src/renderer/features/aggiornamenti/` mostra in basso a destra
  la barra **«È disponibile Leggio X.Y.Z»** con le **prime tre righe** delle note della release (ripulite dal
  markdown), **Scarica** (scarica direttamente il file giusto per il computer: dmg Apple Silicon o Intel,
  installer o versione portatile per Windows) e **Più tardi** (nasconde quella versione per 3 giorni).
- Menu **Aiuto → Controlla aggiornamenti…**: controllo immediato, risponde sempre (anche «Hai già l'ultima versione»).
- **Impostazioni → «Controlla automaticamente gli aggiornamenti»** (attiva di predefinito) spegne il controllo automatico.

Regole che ne derivano:

1. **Le prime righe delle note di release sono quello che legge l'utente.** Scrivile per chi non è tecnico,
   un elenco puntato di 2–3 cose concrete, per esempio:
   ```markdown
   - Ora puoi firmare un documento con un solo clic.
   - La stampa dei moduli compilati è corretta.
   ```
2. **Non cambiare i nomi dei file** (`artifactName` in `package.json`): l'app li usa per scegliere cosa scaricare.
   Se proprio serve, aggiorna `pickAsset` in `electron/updater.cjs` e i test in `test/aggiornamenti.test.js`.
3. **A ogni rilascio aggiungi una voce in cima a `src/renderer/features/aggiornamenti/novita.js`**, con
   `versione` uguale a quella di `package.json`, un `titolo` e 2–4 `punti` in italiano semplice
   (cosa si può fare di nuovo, non come è fatto). Viene mostrata **una sola volta**, al primo avvio dopo
   l'aggiornamento; chi salta più versioni vede le voci di tutte quelle intermedie. Alla prima installazione
   non si mostra nulla. Un test (`npm test`) fallisce se manca la voce per la versione corrente, e il workflow
   di release esegue i test: senza voce non si rilascia.

Variabili d'ambiente utili:

| Variabile | Effetto |
|---|---|
| `LEGGIO_UPDATE_TEST=1` | collaudo: finge che esista una versione più nuova (anche avviando da sorgente) e non scrive nulla su disco |
| `LEGGIO_NO_UPDATE_CHECK=1` | spegne il controllo automatico (il menu resta) |

Collaudo rapido dell'avviso: `npx vite build && LEGGIO_UPDATE_TEST=1 npx electron .` → dopo circa 6 secondi compare la barra.
Per rivedere «Novità di questa versione»: nella console degli strumenti sviluppatore impostare
`__leggio.settings.set('aggiornamenti.ultimaVersioneVista', '0.0.1')` e ricaricare.

## Prima apertura: cosa vedono gli utenti (finché l'app non è firmata)

Leggio per ora **non è firmato** con certificati Apple o Microsoft (costano, vedi sotto). L'app è sicura, ma i
sistemi operativi avvisano al primo avvio. Testo da incollare nelle note di ogni release:

```markdown
### Prima apertura

**Mac** — Apri il file `.dmg` e trascina Leggio nella cartella Applicazioni. Al primo avvio macOS dice che non può
verificare lo sviluppatore: premi **Fine**, poi apri **Impostazioni di Sistema → Privacy e sicurezza**, scorri in basso
e premi **Apri comunque** accanto a «Leggio», quindi conferma con la password del Mac.
(Su macOS 14 o precedenti basta fare clic con il tasto destro sull'app → **Apri** → **Apri**.)
Serve solo la prima volta, e di nuovo dopo ogni aggiornamento.

**Windows** — Avvia il file `installer.exe`. Se compare «Windows ha protetto il PC», premi **Ulteriori informazioni**
e poi **Esegui comunque**. Leggio si installa solo per il tuo utente e non chiede la password di amministratore.
```

Dettagli tecnici:

- **macOS**: l'app è firmata **«ad hoc»** (`mac.identity: "-"` in `package.json`). È indispensabile: senza alcuna firma,
  su Mac con chip Apple il sistema dichiarerebbe l'app «danneggiata» e non offrirebbe nemmeno «Apri comunque».
  Con la firma ad hoc il messaggio è quello, gestibile, di sviluppatore non verificato. L'Hardened Runtime è attivo
  (`build/entitlements.mac.plist`), con l'entitlement `disable-library-validation` richiesto dalla firma ad hoc.
- **Windows**: installer NSIS per utente (`perMachine: false`), in italiano, con scelta della cartella, collegamenti
  sul desktop e nel menu Start, associazione ai file `.pdf` (come programma alternativo: non ruba il predefinito).
  Lo SmartScreen avvisa per gli eseguibili non firmati o con poca «reputazione».

## Firma e notarizzazione (quando ci saranno i certificati)

### macOS — Developer ID e notarizzazione

Cosa serve (solo Lorenzo può farlo):

1. iscrizione all'**Apple Developer Program** (99 USD/anno, come persona fisica va bene);
2. un certificato **Developer ID Application** (da Xcode o dal sito Apple Developer), esportato come `.p12` con password;
3. una **password specifica per app** dell'Apple ID (appleid.apple.com) e il **Team ID**.

Segreti da creare nel repository GitHub (Settings → Secrets and variables → Actions):

| Segreto | Contenuto |
|---|---|
| `CSC_LINK` | il file `.p12` codificato in base64 (`base64 -i certificato.p12 \| pbcopy`) |
| `CSC_KEY_PASSWORD` | la password del `.p12` |
| `APPLE_ID` | l'Apple ID dello sviluppatore |
| `APPLE_APP_SPECIFIC_PASSWORD` | la password specifica per app |
| `APPLE_TEAM_ID` | il Team ID (10 caratteri) |

Modifiche da fare allora:

- in `package.json` → `build.mac`: togliere `"identity": "-"` (electron-builder userà il certificato da `CSC_LINK`)
  (la notarizzazione parte da sola quando ci sono le variabili `APPLE_*`; non impostare `"notarize": false`); si può togliere `disable-library-validation` da `build/entitlements.mac.plist`;
- in `.github/workflows/release.yml`, nel job `pacchetti`: togliere `CSC_IDENTITY_AUTO_DISCOVERY: 'false'` e
  passare i cinque segreti come variabili d'ambiente (solo per il job macOS).

Risultato: nessun avviso al primo avvio su Mac. La notarizzazione aggiunge qualche minuto al workflow.

### Windows — firma del codice

Dal 2023 i certificati di firma devono stare su hardware sicuro (token o servizio cloud), quindi niente file `.pfx`
semplice. Opzioni, in ordine di convenienza per un progetto libero:

1. **SignPath Foundation** — firma gratuita per progetti open source (richiede domanda e approvazione del progetto;
   si integra con GitHub Actions);
2. **Azure Trusted Signing / Artifact Signing** di Microsoft — circa 10 USD/mese, richiede la verifica dell'identità
   (verificare la disponibilità per persone fisiche in Italia); electron-builder lo supporta con `win.azureSignOptions`;
3. certificato **OV** da una CA (circa 200–500 €/anno, su token o cloud).

Con la firma l'avviso SmartScreen sparisce subito con Azure/EV, o col tempo man mano che cresce la reputazione (OV).
*I prezzi sono indicativi (novembre 2026): verificarli prima di acquistare.*

## Pacchetti: cosa contengono

Configurazione: chiave `"build"` di `package.json` (electron-builder).

| Sistema | File | Note |
|---|---|---|
| macOS Apple Silicon | `Leggio-X.Y.Z-mac-arm64.dmg` / `.zip` | dmg compresso LZFSE, macOS 12 o successivo |
| macOS Intel | `Leggio-X.Y.Z-mac-x64.dmg` / `.zip` | |
| Windows | `Leggio-X.Y.Z-win-x64-installer.exe` | NSIS per utente; su Windows ARM funziona in emulazione |
| Windows | `Leggio-X.Y.Z-win-x64-portatile.exe` | non richiede installazione |

Dimensioni misurate con la 0.1.0: dmg arm64 circa **126 MB**, zip x64 circa 132 MB, contenuto dell'installer
Windows circa 136 MB compresso (gran parte è Electron/Chromium).

Il codice dell'interfaccia è già tutto nel bundle di Vite (`dist/`), quindi dal pacchetto sono **escluse** le librerie
che servono solo al renderer: `pdfjs-dist` (e `@napi-rs/canvas`), `docx`, `tesseract.js` e le sue dipendenze
(vedi `build.files`). **Se un modulo del processo main (`electron/**/*.cjs`) deve usarne una, va tolta
l'esclusione.** `scripts/verifica-pacchetto.mjs` (eseguito nel workflow dopo la build, o con
`npm run verifica:pacchetto`) avvia l'app impacchettata in modalità Node e controlla che ogni `require` dei moduli
npm usati dal main funzioni; con `--tutte` controlla anche tutte le `dependencies`.

> Attenzione: `@signpdf/placeholder-pdf-lib` richiede il pacchetto `pdf-lib` come *peerDependency*. npm lo installa,
> ma electron-builder non lo mette nel pacchetto finché non è dichiarato in `dependencies`. Chi usa la firma
> digitale nel processo main deve aggiungerlo (`npm install pdf-lib`), altrimenti l'app installata dà
> «Cannot find module 'pdf-lib'».

## Icona

Disegno originale in `scripts/genera-icone.mjs` (vettoriale, nessun file esterno): un leggio con il foglio
verde-azzurro `#0f766e` inclinato su un'asta scura.

- macOS: squircle chiaro con i margini della griglia Apple (corpo 824/1024) e ombra leggera;
  sotto i 64 px una versione semplificata più leggibile.
- Windows: solo il leggio senza fondo, con un bordo chiaro che lo rende visibile anche sulla barra
  delle applicazioni scura.

Rigenerare con `npm run icone` (servono `rsvg-convert` — `brew install librsvg` — e `iconutil` di macOS).
Produce `build/icon.svg`, `build/icon-win.svg`, `build/icon.png` (1024), `build/icon.icns`, `build/icon.ico`
(16–256 px, PNG dentro il contenitore ICO).

## Costruire in locale

```bash
npm run dist:prova     # solo dmg Apple Silicon, il più rapido
npm run dist:mac       # tutti i pacchetti macOS
npm run dist:win       # pacchetti Windows (vedi sotto)
npm run verifica:pacchetto
```

L'output va in `release/` (ignorata da git; i pacchetti pesano: cancellarla dopo).

Problemi noti:

- **Windows da Mac con chip Apple**: electron-builder prepara l'app (`release/win-unpacked`) ma il compilatore
  dell'installer (`makensis`) è un programma Intel e richiede **Rosetta** (`softwareupdate --install-rosetta`).
  Senza Rosetta fallisce con «spawn Unknown system error -86». La CI su Windows non ha questo problema.
- **node_modules collegato con un link simbolico** (come nei worktree di sviluppo): electron-builder non trova
  le dipendenze indirette (avviso «cannot find path for dependency») e il pacchetto risulta incompleto.
  Per una prova fedele costruire da una cartella con un `node_modules` vero (anche una copia `cp -Rc`, istantanea su APFS).
- **npm 11** su questo Mac non esegue gli script di installazione non autorizzati (`npm install-scripts ls`).
  Oggi riguarda `electron-winstaller` (serve solo al formato Squirrel, che non usiamo) e `tesseract.js`
  (solo un messaggio di raccolta fondi): nessun effetto sui pacchetti. Se un giorno mancasse il binario di
  Electron (`npx electron .` non parte), eseguire `node node_modules/electron/install.js`.
  I workflow usano Node 22 con npm 10, che esegue gli script normalmente; se si passa a npm 11 anche in CI,
  ricontrollare `npm install-scripts ls` dopo `npm ci`.
