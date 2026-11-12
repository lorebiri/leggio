// Astrazione della piattaforma: in Electron usa window.leggio (preload),
// in un browser normale (test, anteprima) usa input file e download.
const native = typeof window !== 'undefined' ? window.leggio : undefined;

export const isElectron = !!native;
export const platformName = native?.platform || (navigator.platform.toLowerCase().includes('mac') ? 'darwin' : 'other');
export const isMac = platformName === 'darwin';
export const modKey = isMac ? '⌘' : 'Ctrl';

function pickViaInput({ accept = '.pdf,application/pdf', multiple = false } = {}) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = accept; input.multiple = multiple;
    input.onchange = async () => {
      const out = [];
      for (const f of input.files) out.push({ path: null, name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) });
      resolve(out);
    };
    input.oncancel = () => resolve([]);
    input.click();
  });
}

function extToAccept(filters) {
  if (!filters) return '.pdf,application/pdf';
  return filters.flatMap((f) => f.extensions.map((e) => (e === '*' ? '*' : '.' + e))).join(',');
}

function download(bytes, name, mime = 'application/octet-stream') {
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export const platform = {
  /** Apre file. opts: { multiple, filters:[{name, extensions:[...]}], title, raw } → [{path,name,bytes}] */
  async openFiles(opts = {}) {
    if (native) return native.invoke('file:open-dialog', opts);
    return pickViaInput({ accept: extToAccept(opts.filters), multiple: opts.multiple });
  },
  /** Chiede dove salvare e scrive. → {path,name} | null */
  async saveAs(bytes, defaultName, filters, title) {
    if (native) return native.invoke('file:save-dialog', { bytes, defaultName, filters, title });
    download(bytes, defaultName); return { path: null, name: defaultName };
  },
  /** Sovrascrive un percorso noto (scrittura atomica). */
  async writeFile(path, bytes) {
    if (native && path) return native.invoke('file:write', { path, bytes });
    throw new Error('Percorso non disponibile');
  },
  /** Sceglie una cartella (solo app). Nel browser restituisce '__download__'. */
  async chooseFolder(title) { return native ? native.invoke('file:choose-folder', { title }) : '__download__'; },
  /** Scrive più file in una cartella scelta con chooseFolder. */
  async writeInFolder(folder, name, bytes) {
    if (native && folder !== '__download__') return native.invoke('file:write-in-folder', { folder, name, bytes });
    download(bytes, name); return name;
  },
  async readFile(path) { return native ? native.invoke('file:read', path) : null; },
  async recent() { return native ? native.invoke('file:recent') : []; },
  async showInFolder(p) { if (native && p) return native.invoke('file:show-in-folder', p); },
  async openExternal(url) { if (native) return native.invoke('app:open-external', url); window.open(url, '_blank', 'noopener'); },
  async info() { return native ? native.invoke('app:info') : { version: 'web', platform: platformName, packaged: false }; },
  async setTitle(t) { document.title = t; if (native) return native.invoke('app:set-title', t); },
  async setTheme(t) { if (native) return native.invoke('app:set-theme', t); },
  /** Canale verso moduli main (electron/features/*.cjs). Disponibile solo nell'app. */
  async invokeFeature(channel, ...args) {
    if (!native) throw new Error('Funzione disponibile solo nell\'app desktop');
    return native.invoke('feat:' + channel, ...args);
  },
  on(channel, fn) { return native ? native.on(channel, fn) : () => {}; },
  download,

  // ----- robustezza (vedi docs/ROBUSTEZZA.md) -----
  /** Archivio su disco per la cronologia Annulla (solo app). → {put, get, drop, clear} | null */
  historyBackend() {
    if (!native) return null;
    return {
      put: (bytes) => native.invoke('app:history-put', bytes),
      get: (key) => native.invoke('app:history-get', key),
      drop: (keys) => native.invoke('app:history-drop', keys),
      clear: () => native.invoke('app:history-clear'),
    };
  },
  /** {total, free, diskFree} in byte (solo app) o null. */
  async memoryInfo() { return native ? native.invoke('app:memory') : null; },
  /** Registro locale (file ruotato nel main). Nel browser: solo console. */
  async log(entry) { if (native) return native.invoke('app:log', entry); },
  async openLogs() { if (native) return native.invoke('app:open-logs'); },
  isElectron,
  /** Stampanti disponibili (solo app): [{ name, displayName, isDefault }]. */
  async printers() { return native ? native.invoke('app:printers') : []; },
  /** Stampa la pagina corrente (#print-root) con le opzioni (solo app). → { ok, err } */
  async print(opts) { if (native) return native.invoke('app:print', opts); window.print(); return { ok: true }; },
  /** Menu nativo «Strumenti»: [{label, items:[{id,label}]}] (solo app). */
  async setToolsMenu(groups) { if (native) return native.invoke('app:tools-menu', groups); },
  /** Recupero automatico su disco (solo app); nel browser recovery.js usa IndexedDB. */
  recoveryBackend() {
    if (!native) return null;
    return {
      list: () => native.invoke('app:recovery-list'),
      write: (meta, bytes) => native.invoke('app:recovery-write', { meta, bytes }),
      read: (session, id) => native.invoke('app:recovery-read', { session, id }),
      remove: (id) => native.invoke('app:recovery-remove', { id }),
      discard: (session) => native.invoke('app:recovery-discard', { session }),
    };
  },
};
