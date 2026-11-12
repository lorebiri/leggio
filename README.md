# Leggio

**Il lettore e editor PDF libero e gratuito per Windows e macOS.**
Leggi, commenta, modifica, organizza, firma, proteggi, converti e rendi ricercabili i tuoi PDF.
Tutte le funzioni — anche quelle che altrove sono a pagamento — senza abbonamento, senza account,
senza pubblicità. I tuoi file restano sul tuo computer: Leggio funziona completamente offline.

## Scarica

Vai su **[Releases](https://github.com/lorebiri/leggio/releases/latest)** e scegli:

- **Windows**: `Leggio-x.y.z-win-x64-installer.exe` (oppure `…-portatile.exe`, che non richiede installazione)
- **macOS**: `Leggio-x.y.z-mac-arm64.dmg` per i Mac con chip Apple (M1, M2, M3…), `Leggio-x.y.z-mac-x64.dmg` per i Mac Intel

Al primo avvio Windows e macOS possono chiedere conferma perché l'app non è ancora firmata con un certificato:
le istruzioni sono nella pagina della release.

**Aggiornamenti e privacy**: una volta al giorno Leggio chiede a GitHub se esiste una versione nuova (una sola richiesta anonima, nessun dato inviato, nessuna telemetria); si può disattivare nelle Impostazioni.

> Lo sviluppo è in corso: le prime versioni sono anteprime.

## Sviluppo

```bash
npm install
npm run dev        # compila l'interfaccia e avvia l'app
npm test           # test automatici
npm run dist:mac   # pacchetti macOS (dmg e zip, Apple Silicon e Intel)
npm run dist:win   # pacchetti Windows (installer e portatile)
npm run icone      # rigenera le icone da scripts/genera-icone.mjs
```

Come si pubblica una nuova versione: [docs/RILASCIO.md](docs/RILASCIO.md).

Architettura e regole per contribuire: [docs/ARCHITETTURA.md](docs/ARCHITETTURA.md).

## Licenza

GPL-3.0-or-later © Lorenzo Birindelli. Leggio usa pdf.js (Apache-2.0), pdf-lib (MIT), Tesseract.js (Apache-2.0) e altre
librerie libere elencate in `package.json`.
