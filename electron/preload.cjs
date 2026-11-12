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
    const h = (_e, ...a) => fn(...a);
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
