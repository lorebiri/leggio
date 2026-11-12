// Area «conversione», lato main: lettura delle risorse statiche dell'app (motore e lingue OCR)
// quando il renderer non riesce a leggerle direttamente da file:// (fetch non supporta file://).
const path = require('node:path');
const fs = require('node:fs/promises');

function register({ ipcMain }) {
  // appunti: tabella come testo (tabulazioni) e HTML, così Excel la incolla in colonne
  ipcMain.handle('feat:conversione:appunti', (_e, { text, html } = {}) => {
    const { clipboard } = require('electron');
    clipboard.write({ text: String(text || ''), html: html ? String(html) : undefined });
    return true;
  });
  const distDir = path.resolve(__dirname, '..', '..', 'dist');
  ipcMain.handle('feat:conversione:risorsa', async (_e, rel) => {
    if (typeof rel !== 'string' || !rel || rel.includes('\0')) throw new Error('Percorso non valido');
    const full = path.resolve(distDir, rel.replace(/^\.?\//, ''));
    // solo file dentro dist/ (niente uscite con ../)
    if (full !== distDir && !full.startsWith(distDir + path.sep)) throw new Error('Percorso non consentito');
    const buf = await fs.readFile(full);
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  });

  // ---- elaborazione di cartelle (OCR in blocco): elenco, lettura, scrittura atomica ----
  const assoluto = (p) => {
    if (typeof p !== 'string' || !p || p.includes('\0') || !path.isAbsolute(p)) throw new Error('Percorso non valido');
    return path.resolve(p);
  };
  ipcMain.handle('feat:conversione:elenca', async (_e, { cartella, sottocartelle = true, escludi = [], max = 20000 } = {}) => {
    const root = assoluto(cartella);
    const esclusi = new Set(escludi.map((x) => path.resolve(x)));
    const out = [];
    async function giro(dir, depth) {
      if (out.length >= max || depth > 12 || esclusi.has(dir)) return;
      let voci;
      try { voci = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
      voci.sort((a, b) => a.name.localeCompare(b.name, 'it', { numeric: true }));
      for (const v of voci) {
        if (v.name.startsWith('.')) continue;
        const full = path.join(dir, v.name);
        if (v.isDirectory()) { if (sottocartelle) await giro(full, depth + 1); }
        else if (v.isFile() && /\.pdf$/i.test(v.name)) {
          try { const st = await fs.stat(full); out.push({ path: full, rel: path.relative(root, full), name: v.name, size: st.size, mtimeMs: Math.round(st.mtimeMs) }); } catch { /* file sparito */ }
          if (out.length >= max) return;
        }
      }
    }
    await giro(root, 0);
    return out;
  });
  ipcMain.handle('feat:conversione:leggi', async (_e, p) => {
    const buf = await fs.readFile(assoluto(p));
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  });
  ipcMain.handle('feat:conversione:esiste', async (_e, p) => {
    try { const st = await fs.stat(assoluto(p)); return { size: st.size, mtimeMs: Math.round(st.mtimeMs) }; } catch { return null; }
  });
  ipcMain.handle('feat:conversione:scrivi', async (_e, { percorso, bytes } = {}) => {
    const full = assoluto(percorso);
    if (!/\.(pdf|json|txt|docx|odt|xlsx|csv|html)$/i.test(full)) throw new Error('Tipo di file non consentito');
    await fs.mkdir(path.dirname(full), { recursive: true });
    const tmp = full + '.leggio-tmp';
    await fs.writeFile(tmp, Buffer.from(bytes.buffer ? new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength) : bytes));
    await fs.rename(tmp, full); // scrittura atomica: mai file a metà
    return full;
  });
  ipcMain.handle('feat:conversione:unisci', (_e, ...parti) => path.join(...parti.map(String)));
}

module.exports = { register };
