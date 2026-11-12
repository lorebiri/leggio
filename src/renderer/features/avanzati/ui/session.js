// Ripristino della sessione: riapre le schede (con la pagina) aperte all'ultima chiusura.
import { isDesktop } from '../native.js';
import { snapshot, docsToRestore } from '../lib/session.js';

const KEY = 'avanzati.session';
const KEY_ON = 'avanzati.restoreSession';

export function setupSession(app) {
  app.bus.on('settings:fields', (arr) => arr.push({ key: KEY_ON, field: { label: 'Alla riapertura, riapri i documenti dell\'ultima volta', type: 'checkbox', value: true } }));
  if (!isDesktop()) return;
  let stable = app.settings.get(KEY, null);
  let restoring = true;
  let closeTimer = null; let quitting = false;
  const take = () => snapshot(app.docs, app.activeDoc, app.viewer.page);
  const save = () => { if (restoring || quitting) return; stable = take(); app.settings.set(KEY, stable); };
  let pageTimer = null;
  app.bus.on('document:loaded', save);
  app.bus.on('document:activated', save);
  app.bus.on('document:saved', save);
  app.bus.on('page:changed', () => { clearTimeout(pageTimer); pageTimer = setTimeout(save, 800); });
  app.bus.on('document:closed', () => {
    // alla chiusura dell'app il nucleo chiude le schede una a una: aspettiamo prima di dimenticarle
    clearTimeout(closeTimer);
    closeTimer = setTimeout(save, 1500);
  });
  app.platform.on('app:before-close', () => {
    quitting = true; clearTimeout(closeTimer); clearTimeout(pageTimer);
    if (stable) app.settings.set(KEY, stable);
    setTimeout(() => { quitting = false; }, 4000); // se l'utente annulla la chiusura
  });
  // ripristino all'avvio
  setTimeout(async () => {
    try {
      if (app.settings.get(KEY_ON, true) === false) return;
      const list = docsToRestore(stable);
      if (!list.length) return;
      let ok = 0; const missing = [];
      for (const d of list) {
        if (app.docs.some((x) => x.path === d.path)) continue;
        let f = null;
        try { f = await app.platform.readFile(d.path); } catch { f = null; }
        if (!f) { missing.push(d.path); continue; }
        const doc = await app.openBytes(f.bytes, f);
        if (!doc) continue;
        ok++;
        if (d.page > 1) doc.viewState = { scale: app.settings.get('defaultZoom', 'auto'), page: d.page, scrollTop: null };
        if (app.activeDoc === doc && d.page > 1) setTimeout(() => { if (app.activeDoc === doc) app.viewer.page = d.page; }, 300);
      }
      const active = stable?.active && app.docs.find((x) => x.path === stable.active);
      if (active) app.activate(active);
      if (ok) app.ui.toast(`Riaperti ${ok} ${ok === 1 ? 'documento' : 'documenti'} dell'ultima volta${missing.length ? ` (${missing.length} non trovati)` : ''}.`, { kind: 'info', timeout: 6000, action: { label: 'Non farlo più', run: () => app.settings.set(KEY_ON, false) } });
    } catch (err) { console.error('[avanzati] ripristino sessione', err); }
    finally { restoring = false; save(); }
  }, 400);
}
