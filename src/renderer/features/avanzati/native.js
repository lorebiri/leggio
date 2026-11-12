// Accesso ai canali main dell'area e ripieghi per l'anteprima nel browser.
export const isDesktop = () => typeof window !== 'undefined' && !!window.leggio;

/** Chiama 'feat:avanzati:<name>' e trasforma {ok:false} in un errore leggibile. */
export async function call(app, name, args = {}) {
  const r = await app.platform.invokeFeature('avanzati:' + name, args);
  if (!r || !r.ok) { const e = new Error(r?.error || 'Operazione non riuscita.'); e.code = r?.code; throw e; }
  return r.value;
}

function pickInput({ accept, multiple = true, directory = false }) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file'; input.multiple = multiple;
    if (accept) input.accept = accept;
    if (directory) { input.webkitdirectory = true; input.setAttribute('webkitdirectory', ''); }
    input.onchange = () => resolve([...input.files]);
    input.oncancel = () => resolve([]);
    input.click();
  });
}

const extOf = (n) => (String(n).match(/\.([^.\\/]+)$/)?.[1] || '').toLowerCase();

/** Elemento sorgente: { name, rel, path, size, mtime, read() → Uint8Array } */
export function fileItem(f) {
  // nel browser webkitRelativePath comincia con il nome della cartella scelta: lo togliamo (come nell'app)
  return { name: f.name, rel: (f.webkitRelativePath || '').split('/').slice(1).join('/') || f.name, path: null, size: f.size, mtime: f.lastModified, file: f, read: async () => new Uint8Array(await f.arrayBuffer()) };
}
function nativeItem(app, f) {
  return { name: f.name, rel: f.rel || f.name, path: f.path, size: f.size, mtime: f.mtime, read: () => call(app, 'read', { path: f.path }) };
}

/**
 * Sceglie una cartella ed elenca i file con le estensioni indicate.
 * → { folder (percorso o null nel browser), label, items, truncated, errors } | null
 */
export async function chooseFolder(app, { exts = ['pdf'], recursive = true, title, skipDirs = [] } = {}) {
  if (isDesktop()) {
    const folder = await call(app, 'choose-folder', { title });
    if (!folder) return null;
    const r = await call(app, 'list', { folder, exts, recursive, max: 200000, skipDirs });
    return { folder, label: folder, items: r.files.map((f) => nativeItem(app, f)), truncated: r.truncated, errors: r.errors };
  }
  const files = await pickInput({ directory: true });
  if (!files.length) return null;
  const set = new Set(exts);
  const items = files.filter((f) => set.has(extOf(f.name)) && (recursive || !f.webkitRelativePath.split('/').slice(1, -1).length) && !skipDirs.some((d) => f.webkitRelativePath.split('/').includes(d))).map(fileItem);
  return { folder: null, label: files[0].webkitRelativePath.split('/')[0] || 'cartella', items, truncated: false, errors: [] };
}

/** Elenca di nuovo una cartella già autorizzata (solo app). */
export async function relist(app, folder, { exts = ['pdf'], recursive = false } = {}) {
  const r = await call(app, 'list', { folder, exts, recursive, max: 200000 });
  return r.files.map((f) => nativeItem(app, f));
}

/** Sceglie uno o più file. → items */
export async function chooseFiles(app, { exts = ['pdf'], multiple = true, title, filterName = 'Documenti' } = {}) {
  if (isDesktop()) {
    const r = await call(app, 'choose-files', { title, multiple, filters: [{ name: filterName, extensions: exts }] });
    return r.map((f) => nativeItem(app, f));
  }
  const files = await pickInput({ accept: exts.map((e) => '.' + e).join(','), multiple });
  return files.map(fileItem);
}

/** Scrive un file in una cartella autorizzata (nel browser: scarica). → percorso o nome */
export async function writeOut(app, folder, { sub, name, bytes, overwrite = false }) {
  if (isDesktop() && folder) return call(app, 'write', { folder, sub, name, bytes, overwrite });
  app.platform.download(bytes, name);
  return name;
}

export function dirname(p) { const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\')); return i > 0 ? p.slice(0, i) : p; }
export function basename(p) { return String(p).split(/[\\/]/).pop(); }
export { extOf };

/** Chiude un documento pdf.js (nella v6 destroy() è sul loadingTask). */
export function destroyPdf(pdf) {
  try { if (!pdf) return; if (typeof pdf.destroy === 'function') pdf.destroy(); else pdf.loadingTask?.destroy(); } catch {}
}
