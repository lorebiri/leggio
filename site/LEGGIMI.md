# Sito di Leggio (presentazione e download)

Pagina statica in italiano da pubblicare su GitHub Pages. Dall'alto: la promessa («Il PDF per l'ufficio
italiano. Gratis, per sempre, senza Internet»), cinque vantaggi con icone e il pulsante di download per il computer
di chi la visita · confronto **per categorie** (Leggio, lettori PDF gratuiti, editor PDF a pagamento) con i punti di
forza di Leggio evidenziati · «Quanto risparmi» (0 € per ogni postazione e conto fatto con i numeri di chi visita) ·
«Pensato per i documenti italiani» con schermate vere (.p7m, fatture XML, Titulus e U-GOV, copia fronte/retro,
oscuramento con filigrana) · fascia di fiducia · tutte le altre funzioni · tutti i file con le impronte SHA-256 ·
domande frequenti · contatti.

**Niente nomi di terzi.** Per scelta di Lorenzo la pagina non nomina prodotti o aziende di altri (programmi PDF,
browser, servizi di archiviazione, programmi per ufficio) e non riporta prezzi altrui: il confronto è solo per
categorie, con valori prudenti («di solito no», «spesso solo a pagamento», «in genere sì»). Restano solo i nomi che
servono a scaricare: i sistemi operativi, i chip dei Mac e GitHub, dove sono i file. I test
(`test/sito-download.test.js`) falliscono se un nome vietato ricompare nella pagina o nei testi di `avvio.js`.
Le schermate usate non devono mostrarli (per questo `img/strumenti.webp` non è più nella pagina).

## File

| File | Cosa fa |
|---|---|
| `index.html` | la pagina; funziona anche senza JavaScript (i link portano alla pagina delle versioni su GitHub) |
| `stile.css` | aspetto, tema chiaro e scuro, versione per telefono |
| `scarica.js` | logica pura: riconosce il sistema, abbina i file della release, legge `SHA256SUMS.txt`, scarta gli indirizzi non GitHub (test: `npx vitest run test/sito-download.test.js`) |
| `avvio.js` | collega la logica alla pagina |
| `icona.svg`, `img/` | icona e schermate (WebP/PNG 1280×800, sotto i 200 kB) |
| `strumenti/schermate.mjs` | rifà le schermate con Playwright dalla versione web (non viene pubblicato) |

La pagina chiede soltanto a `api.github.com` l'ultima versione di `lorebiri/leggio` (e, se c'è, il file
`SHA256SUMS.txt`). Nessun carattere esterno, nessun cookie, nessuna statistica. La CSP è nel `<meta>` di `index.html`.

## Nomi dei file

Riconosce i nomi di `package.json` → `build`: `Leggio-X.Y.Z-win-x64-installer.exe`, `…-win-x64-portatile.exe`,
`…-mac-arm64.dmg`, `…-mac-x64.dmg`, i `.zip` per Mac e, quando ci sarà, `…-linux-x86_64.AppImage`
(senza AppImage la pagina scrive «Linux: presto disponibile»). Se cambiano i nomi, aggiorna `CATALOGO` in `scarica.js` e i test.

## Provarla in locale

```bash
python3 -m http.server 5300 -d site   # poi apri http://localhost:5300/ (va bene qualunque server statico)
```

## Rifare le schermate

```bash
npx vite build && mkdir -p dist/fixtures && cp test/fixtures/*.pdf dist/fixtures/
npx vite preview --port 5233 --strictPort &
node site/strumenti/schermate.mjs            # tutte; oppure: node site/strumenti/schermate.mjs stampa p7m
```

I documenti mostrati sono inventati e costruiti dallo script (nessun documento d'identità vero).

## Pubblicarla

Una volta sola: Settings → Pages → Source: **GitHub Actions**.
Poi, ogni volta che cambi questa cartella: Actions → **Pagina di download (GitHub Pages)** → *Run workflow*.
Il workflow (`.github/workflows/pages.yml`) parte solo a mano. Non serve ripubblicare a ogni rilascio:
la pagina legge da sola l'ultima versione.
