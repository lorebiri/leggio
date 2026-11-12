// Ponte sicuro tra renderer e processo principale (gira in sandbox: solo moduli di Electron).
const { contextBridge, ipcRenderer, webUtils } = require('electron');

const ALLOWED = /^(file|app|feat):[\w:.-]+$/;
const check = (channel) => {
  if (typeof channel !== 'string' || !ALLOWED.test(channel)) throw new Error('Canale non consentito: ' + channel);
};
contextBridge.exposeInMainWorld('leggio', {
  invoke: (channel, ...args) => { check(channel); return ipcRenderer.invoke(channel, ...args); },
  on: (channel, fn) => {
    check(channel);
    if (typeof fn !== 'function') throw new Error('Gestore non valido');
    // il valore restituito da fn NON deve tornare indietro: contextBridge copierebbe in profondità
    // l'esito della promessa (es. un intero Doc con il proxy pdf.js) bloccando il renderer
    const h = (_e, ...a) => { try { fn(...a); } catch (err) { console.error(err); } };
    ipcRenderer.on(channel, h);
    return () => ipcRenderer.removeListener(channel, h);
  },
  /** Percorso di un File trascinato (Electron ≥ 32 non espone più File.path). Autorizza anche la sovrascrittura. */
  pathForFile: (file) => {
    let p = '';
    try { p = webUtils.getPathForFile(file); } catch { p = ''; }
    if (p) ipcRenderer.invoke('internal:grant-dropped', p).catch(() => {});
    return p || null;
  },
  platform: process.platform,
});
