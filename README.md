# Leggio

**Il lettore e editor PDF libero e gratuito per Windows e macOS.**
Leggi, commenta, modifica, organizza, firma, proteggi, converti e rendi ricercabili i tuoi PDF.
Tutte le funzioni — anche quelle che altrove sono a pagamento — senza abbonamento, senza account,
senza pubblicità. I tuoi file restano sul tuo computer: Leggio funziona completamente offline.

## Scarica

Vai su **[Releases](https://github.com/lorebiri/leggio/releases/latest)** e scegli:

- **Windows**: `Leggio-Setup-x.y.z.exe`
- **macOS** (Apple Silicon e Intel): `Leggio-x.y.z-mac.dmg`

> Lo sviluppo è in corso: le prime versioni sono anteprime.

## Sviluppo

```bash
npm install
npm run dev        # compila l'interfaccia e avvia l'app
npm test           # test automatici
npm run dist:mac   # pacchetto macOS (dmg)
npm run dist:win   # pacchetto Windows (exe)
```

Architettura e regole per contribuire: [docs/ARCHITETTURA.md](docs/ARCHITETTURA.md).

## Licenza

GPL-3.0-or-later © Lorenzo Birindelli. Leggio usa pdf.js (Apache-2.0), pdf-lib (MIT), Tesseract.js (Apache-2.0) e altre
librerie libere elencate in `package.json`.
