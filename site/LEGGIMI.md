# Sito di Leggio (presentazione e download)

Pagina statica in italiano da pubblicare su GitHub Pages. Dall'alto: la promessa («Le funzioni di Acrobat Pro.
Gratis, per sempre, senza Internet»), cinque vantaggi con icone e il pulsante di download per il computer di chi
la visita · tabella di confronto con Leggio evidenziato (Acrobat Reader, lettore di Edge o Chrome, Foxit PDF Reader,
Acrobat Pro, PDF-XChange Editor) · «Quanto risparmi» (Acrobat Pro per 1, 10, 50 postazioni e calcolo libero) ·
«Solo in Leggio» con schermate vere (.p7m, fatture XML, Titulus e U-GOV, copia fronte/retro, oscuramento con
filigrana) · fascia di fiducia (open source, nessun account, nessuna telemetria, file mai inviati) · tutte le
altre funzioni · tutti i file con le impronte SHA-256 · domande frequenti · contatti.

**Da ricontrollare a ogni aggiornamento della pagina:** il confronto e il prezzo di Acrobat Pro
(`ACROBAT_PRO_EURO_MESE` in `scarica.js` e i testi della sezione `#risparmio`, che i test confrontano con il calcolo),
sui siti dei produttori; aggiorna anche la data nella nota sotto la tabella.

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
