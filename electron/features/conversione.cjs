// Area «conversione», lato main: lettura delle risorse statiche dell'app (motore e lingue OCR)
// quando il renderer non riesce a leggerle direttamente da file:// (fetch non supporta file://).
const path = require('node:path');
const fs = require('node:fs/promises');

function register({ ipcMain }) {
  const distDir = path.resolve(__dirname, '..', '..', 'dist');
  ipcMain.handle('feat:conversione:risorsa', async (_e, rel) => {
    if (typeof rel !== 'string' || !rel || rel.includes('\0')) throw new Error('Percorso non valido');
    const full = path.resolve(distDir, rel.replace(/^\.?\//, ''));
    // solo file dentro dist/ (niente uscite con ../)
    if (full !== distDir && !full.startsWith(distDir + path.sep)) throw new Error('Percorso non consentito');
    const buf = await fs.readFile(full);
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  });
}

module.exports = { register };
