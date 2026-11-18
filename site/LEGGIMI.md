# Pagina di download di Leggio

Pagina statica in italiano da pubblicare su GitHub Pages: propone il file giusto per il computer di chi
la visita, elenca tutti gli altri, mostra le impronte SHA-256 e spiega gli avvisi di sicurezza di Windows e macOS.

## File

| File | Cosa fa |
|---|---|
| `index.html` | la pagina; funziona anche senza JavaScript (i link portano alla pagina delle versioni su GitHub) |
| `stile.css` | aspetto, tema chiaro e scuro, versione per telefono |
| `scarica.js` | logica pura: riconosce il sistema, abbina i file della release, legge `SHA256SUMS.txt`, scarta gli indirizzi non GitHub (test: `npx vitest run test/sito-download.test.js`) |
| `avvio.js` | collega la logica alla pagina |
| `icona.svg`, `img/` | icona e schermate (generate dalla versione web con Playwright, 1280×800) |

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

## Pubblicarla

Una volta sola: Settings → Pages → Source: **GitHub Actions**.
Poi, ogni volta che cambi questa cartella: Actions → **Pagina di download (GitHub Pages)** → *Run workflow*.
Il workflow (`.github/workflows/pages.yml`) parte solo a mano. Non serve ripubblicare a ogni rilascio:
la pagina legge da sola l'ultima versione.
