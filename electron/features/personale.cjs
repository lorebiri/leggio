// Area «personale» — lato processo principale: archivio cifrato di firme, timbri, rubrica, modelli e
// registro degli utilizzi (logica in electron/personale/cassaforte.cjs).
// Canali feat:personale:* — accettati solo dalla pagina dell'app (featureIpc del main) e validati qui.
// Ogni risposta è { ok: true, result } oppure { ok: false, error, code }.
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { createCassaforte, ErroreArchivio } = require('../personale/cassaforte.cjs');

let C = null;
const importazioni = new Map(); // token → percorso del file di backup scelto con il dialogo

function risposta(fn) {
  return async (_e, a) => {
    try { return { ok: true, result: await fn(a && typeof a === 'object' ? a : {}) }; }
    catch (err) {
      const msg = err instanceof ErroreArchivio || err?.userMessage ? (err.userMessage || err.message) : 'Operazione sull\'archivio personale non riuscita: ' + (err?.message || err);
      return { ok: false, error: msg, code: err?.code || null };
    }
  };
}
const testo = (v, max = 1024) => (typeof v === 'string' && v.length <= max ? v : '');

function register({ ipcMain, app, dialog, getWindow, log }) {
  let safeStorage = null;
  try { ({ safeStorage } = require('electron')); } catch { /* test */ }
  const L = (lvl, msg, data) => { try { log?.(lvl, msg, data); } catch { /* */ } };
  C = createCassaforte({ dir: path.join(app.getPath('userData'), 'personale'), safeStorage, log: L });
  const h = (name, fn) => { ipcMain.removeHandler?.('feat:personale:' + name); ipcMain.handle('feat:personale:' + name, risposta(fn)); };

  h('stato', async () => { try { await C.inizializza(); } catch (e) { return { ...C.stato(), errore: e.userMessage || e.message, codice: e.code }; } return C.stato(); });
  h('sblocca', async (a) => C.sblocca(testo(a.password)));
  h('blocca', async () => C.blocca());
  h('imposta-password', async (a) => C.impostaPassword(testo(a.attuale), testo(a.nuova)));
  h('leggi', async () => ({ indice: await C.leggiIndice(), stato: C.stato() }));
  h('salva', async (a) => C.salvaIndice(a.indice, { purga: a.purga === true }));
  h('blob-leggi', async (a) => new Uint8Array(await C.leggiBlob(a.id)));
  h('blob-scrivi', async (a) => C.scriviBlob(a.id, a.dati));
  h('blob-cancella', async (a) => C.cancellaBlob(a.id));
  h('azzera', async (a) => { if (a.conferma !== 'METTI-DA-PARTE') throw new ErroreArchivio('Conferma mancante.', 'argomenti'); return C.azzera(); });

  h('esporta', async (a) => {
    const { dati, elementi, mancanti } = await C.esportaBackup(testo(a.password));
    const oggi = new Date().toISOString().slice(0, 10);
    const r = await dialog.showSaveDialog(getWindow?.(), {
      title: 'Salva il backup dell\'archivio personale', defaultPath: `Leggio-archivio-personale-${oggi}.leggio-backup`,
      filters: [{ name: 'Backup di Leggio', extensions: ['leggio-backup'] }],
    });
    if (r.canceled || !r.filePath) return null;
    const { safeWrite } = require('../core/safe-write.cjs');
    await safeWrite(r.filePath, dati); // scrittura atomica e riletta byte per byte
    L('info', 'archivio personale esportato', { byte: dati.length, elementi, mancanti: mancanti.length });
    return { percorso: r.filePath, nome: path.basename(r.filePath), byte: dati.length, elementi, mancanti: mancanti.length };
  });
  h('importa-scegli', async () => {
    const r = await dialog.showOpenDialog(getWindow?.(), {
      title: 'Scegli il backup dell\'archivio personale', properties: ['openFile'],
      filters: [{ name: 'Backup di Leggio', extensions: ['leggio-backup'] }, { name: 'Tutti i file', extensions: ['*'] }],
    });
    if (r.canceled || !r.filePaths[0]) return null;
    const token = crypto.randomBytes(12).toString('hex');
    importazioni.clear();
    importazioni.set(token, r.filePaths[0]);
    return { token, nome: path.basename(r.filePaths[0]) };
  });
  h('importa-apri', async (a) => {
    const p = importazioni.get(testo(a.token, 64));
    if (!p) throw new ErroreArchivio('Scegli di nuovo il file di backup.', 'argomenti');
    let buf;
    try { buf = await fs.promises.readFile(p); } catch { throw new ErroreArchivio(`Impossibile leggere «${path.basename(p)}».`, 'lettura'); }
    const r = await C.importaBackup(buf, testo(a.password));
    importazioni.delete(a.token);
    L('info', 'backup dell\'archivio personale importato', { elementi: r.elementi });
    return r;
  });
}

module.exports = { register, _cassaforte: () => C };
