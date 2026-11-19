# Sito di Leggio (presentazione e download)

Pagina statica in italiano da pubblicare su GitHub Pages. Dall'alto: la promessa («Il PDF per l'ufficio
italiano. Gratis, per sempre, senza Internet»), cinque vantaggi con icone e il pulsante di download per il computer
di chi la visita · confronto **per categorie** (Leggio, lettori PDF gratuiti, editor PDF a pagamento) con i punti di
forza di Leggio evidenziati · «Quanto risparmi» (0 € per ogni postazione e conto fatto con i numeri di chi visita) ·
«Novità» della 0.3 (`#novita`: firme e sigle salvate, timbri, rubrica con «Compila a nome di», compilazione in serie) ·
«Pensato per i documenti italiani» con schermate vere (.p7m, fatture XML, Titulus e U-GOV, copia fronte/retro,
oscuramento con filigrana) · fascia di fiducia · tutte le altre funzioni · tutti i file con le impronte SHA-256 ·
«Novità» (le ultime 3 versioni) · domande frequenti · contatti. Vicino al pulsante di download c'è il riquadro «Al primo avvio Windows o macOS
potrebbero avvisarti: ecco cosa fare» (`#avvisi-sicurezza`), che porta a `sicurezza.html`.

**Pagina `sicurezza.html`.** Spiega perché compaiono gli avvisi (nessuna firma a pagamento, programma nuovo senza
reputazione) e come procedere: Windows (avviso del browser, finestra «Windows ha protetto il PC», Controllo
intelligente delle app, antivirus e quarantena), macOS (file giusto per il chip, «Apri comunque» in Privacy e sicurezza,
`xattr` per esperti), Linux (permesso di esecuzione, `libfuse2`) e la verifica SHA-256. La guida del sistema
riconosciuto si apre da sola (`sicurezza.js`). Le figure sono finestre semplificate fatte in HTML e CSS, senza
schermate né loghi. I testi dei pulsanti sono stati controllati sulle pagine di supporto Microsoft e Apple
(novembre 2026); se cambiano, aggiorna pagina e test.

**Niente nomi di terzi.** Per scelta di Lorenzo la pagina non nomina prodotti o aziende di altri (programmi PDF,
browser, servizi di archiviazione, programmi per ufficio) e non riporta prezzi altrui: il confronto è solo per
categorie, con valori prudenti («di solito no», «spesso solo a pagamento», «in genere sì»). Restano solo i nomi che
servono a scaricare: i sistemi operativi, i chip dei Mac e GitHub, dove sono i file. Solo in `sicurezza.html`, per
seguire i passi, si nominano anche Microsoft, Apple, i due browser con avvisi specifici (Edge e Chrome) e le funzioni
dei sistemi (SmartScreen, Controllo intelligente delle app); nessun antivirus per nome. I test
(`test/sito-download.test.js`) falliscono se un nome vietato ricompare nella pagina o nei testi di `avvio.js`.
Le schermate usate non devono mostrarli (per questo `img/strumenti.webp` non è più nella pagina).

## File

| File | Cosa fa |
|---|---|
| `index.html` | la pagina; funziona anche senza JavaScript (versione, link diretti e impronte sono scritti nella pagina). I blocchi `<!-- sync:… -->` li scrive `scripts/sito-aggiorna.mjs`: non modificarli a mano |
| `stile.css` | aspetto, tema chiaro e scuro, versione per telefono |
| `scarica.js` | logica pura: riconosce il sistema, abbina i file della release, legge `SHA256SUMS.txt` e i dati scritti nella pagina, scarta gli indirizzi non GitHub (test: `npx vitest run test/sito-download.test.js test/sito-sync.test.js`) |
| `avvio.js` | collega la logica alla pagina: mostra subito la versione scritta nella pagina, poi chiede a GitHub se ce n'è una più nuova |
| `sitemap.xml`, `robots.txt` | per i motori di ricerca (la sitemap la rigenera `scripts/sito-aggiorna.mjs`) |
| `sicurezza.html`, `sicurezza.js` | guida agli avvisi di sicurezza; lo script apre la guida del sistema e aggiunge i pulsanti «Copia» |
| `icona.svg`, `img/` | icona e schermate (WebP 1280×800, sotto i 200 kB); `img/anteprima.png` (1200×630) è l'immagine per la condivisione (Open Graph) |
| `strumenti/schermate.mjs` | rifà le schermate con Playwright dalla versione web (non viene pubblicato) |
| `strumenti/anteprima.mjs` | rifà `img/anteprima.png` (non viene pubblicato) |

La pagina chiede soltanto a `api.github.com` l'ultima versione di `lorebiri/leggio` (una richiesta, tenuta in memoria
per 10 minuti). Le impronte SHA-256 sono già scritte nella pagina: il file `SHA256SUMS.txt` non si può leggere dal browser
(GitHub non lo permette ad altri siti). Nessun carattere esterno, nessun cookie, nessuna statistica. La CSP è nel `<meta>`
di `index.html`.

## Sempre allineata all'ultima versione

Tre livelli, nessun intervento a mano:

1. **Nella pagina, a ogni pubblicazione.** `scripts/sito-aggiorna.mjs` scrive in `index.html` (blocchi `sync:head`,
   `sync:principale`, `sync:versione`, `sync:elenco`, `sync:novita`) numero, data, link diretti, dimensioni e impronte
   dei file, il JSON-LD per i motori di ricerca e la sezione «Novità» con le ultime 3 voci di
   `src/renderer/features/aggiornamenti/novita.js`; rigenera anche `sitemap.xml`. Li vedono anche chi ha JavaScript
   spento e i motori di ricerca.
   - `npm run sito` (in locale, prima del commit di un rilascio): usa la versione di `package.json`; se è già su GitHub
     Releases prende anche data, dimensioni e impronte, altrimenti i link portano alla pagina delle versioni.
   - `node scripts/sito-aggiorna.mjs --pubblicata --dir _pagina` (nel workflow): usa l'ultima versione **pubblicata**
     e mostra le Novità solo fino a quella. Se GitHub non risponde restano i dati già scritti nella pagina.
2. **Nel browser.** `avvio.js` mostra subito i dati scritti nella pagina, poi chiede all'API di GitHub l'ultima
   versione (attesa massima 8 secondi, cache di 10 minuti nella scheda): se è più nuova aggiorna pulsanti ed elenco.
   Se GitHub è lento, ha raggiunto il limite di richieste o non risponde, restano i dati della pagina.
3. **I test** (`test/sito-sync.test.js`) falliscono se la versione nella pagina non è quella di `package.json`, se manca
   la voce delle Novità o se qualcuno ha modificato a mano un blocco `sync`. Rimedio: `npm run sito` e commit di `site/`.

## Nomi dei file

Riconosce i nomi di `package.json` → `build`: `Leggio-X.Y.Z-win-x64-installer.exe`, `…-win-x64-portatile.exe`,
`…-mac-arm64.dmg`, `…-mac-x64.dmg`, i `.zip` per Mac e, quando ci sarà, `…-linux-x86_64.AppImage`
(senza AppImage la pagina scrive «Linux: presto disponibile»). Se cambiano i nomi, aggiorna `CATALOGO` in `scarica.js` e i test.

## Provarla in locale

```bash
python3 -m http.server 5300 -d site   # poi apri http://localhost:5300/ (va bene qualunque server statico)
npm run collaudo:sito                 # prova con Playwright: sistemi, temi, telefono, GitHub giù/lento/limite, senza JavaScript
npm run collaudo:sito -- /tmp/schermate-sito   # come sopra, e salva le schermate in quella cartella
```

## Rifare le schermate

Le schermate della 0.3 (`img/firma-*.webp`, `timbro-ricevuto`, `luogo-data-firma`, `rubrica*`, `compila-a-nome-di`,
`serie-*`) vengono da `marketing/0.3/`, prese dall'app vera con `scripts/schermate-0.3.mjs` (dati inventati) e
convertite in WebP 1280 px. Le altre:

```bash
npx vite build && mkdir -p dist/fixtures && cp test/fixtures/*.pdf dist/fixtures/
npx vite preview --port 5233 --strictPort &
node site/strumenti/schermate.mjs            # tutte; oppure: node site/strumenti/schermate.mjs stampa p7m
```

I documenti mostrati sono inventati e costruiti dallo script (nessun documento d'identità vero).

## Pubblicarla

Una volta sola: Settings → Pages → Source: **GitHub Actions**.
Poi il workflow (`.github/workflows/pages.yml`) parte da solo:

- quando si pubblica una release su GitHub Releases (il job «rilancia» fa ripartire il workflow su `main`, perché
  l'ambiente `github-pages` accetta solo il ramo principale);
- a ogni push su `main` che cambia `site/`, `novita.js` o `scripts/sito-aggiorna.mjs`;
- a mano: Actions → **Pagina di download (GitHub Pages)** → *Run workflow*.

Nota per i motori di ricerca: su un sito di progetto (`lorebiri.github.io/leggio/`) il `robots.txt` non sta nella
radice del dominio, quindi conta soprattutto la sitemap: si può segnalare a mano nei servizi per i webmaster.
