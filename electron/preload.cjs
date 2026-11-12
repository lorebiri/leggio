// Ponte sicuro tra renderer e processo principale.
const { contextBridge, ipcRenderer } = require('electron');

const ALLOWED = /^(file|app|feat):/;
contextBridge.exposeInMainWorld('leggio', {
  invoke: (channel, ...args) => {
    if (!ALLOWED.test(channel)) throw new Error('Canale non consentito: ' + channel);
    return ipcRenderer.invoke(channel, ...args);
  },
  on: (channel, fn) => {
    if (!ALLOWED.test(channel)) throw new Error('Canale non consentito: ' + channel);
    const h = (_e, ...a) => fn(...a);
    ipcRenderer.on(channel, h);
    return () => ipcRenderer.removeListener(channel, h);
  },
  platform: process.platform,
});
