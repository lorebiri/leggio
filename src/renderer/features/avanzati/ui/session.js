// Avvio pulito e sessione.
// - Avvio normale: schermata iniziale con i recenti e «Riapri l'ultimo documento». Nessun documento si riapre da solo.
// - Leggio aperto con un file (doppio clic, «Apri con»): si apre solo quel file.
// - Impostazione «All'avvio riapri i documenti lasciati aperti» (disattivata di predefinito): riapre solo i
//   documenti ancora aperti alla chiusura regolare, mai quelli chiusi prima.
// - Dopo un crash: domanda «Ripristina i documenti della sessione interrotta?» (insieme alle bozze del
//   recupero automatico, vedi core/recovery.js), mai in automatico.
// - Pagina, zoom e scorrimento ricordati per ogni file: riaprendolo si torna dove si era.
// Lo stato della sessione sta nel main (userData/sessione.json, electron/core/sessione.cjs): resiste ai crash.
import { isDesktop } from '../native.js';
import { icon } from '../../../core/icons.js';
import { snapshot, startupPlan, migrateFrom02, rememberView, recallView, KEY_REOPEN, KEY_VIEWS } from '../lib/session.js';

export function setupSession(app) {
  if (!isDesktop()) return;
  app.bus.on('settings:fields', (arr) => arr.push({ key: KEY_REOPEN, field: {
    label: 'All\'avvio riapri i documenti lasciati aperti', type: 'checkbox', value: false,
    help: 'Di solito Leggio si apre sulla schermata iniziale, con i recenti. Con questa opzione riapre i documenti ancora aperti quando l\'hai chiuso, mai quelli che avevi già chiuso.',
  } }));

  const migrated = migrateFrom02(app.settings);
  let last = migrated?.last || null; // ultimo documento usato: { path, page }
  let restoring = true; let quitting = false; let quitSnap = null; let pageTimer = null;

  // ---------- posizione ricordata per ogni file ----------
  let views = app.settings.get(KEY_VIEWS, {});
  const remember = (doc) => {
    if (!doc?.path) return;
    if (doc === app.activeDoc && !doc.closed) app.viewer.saveViewState();
    if (!doc.viewState) return;
    views = rememberView(views, doc.path, doc.viewState);
    app.settings.set(KEY_VIEWS, views);
  };
  app.bus.on('document:loaded', ({ doc }) => {
    const v = recallView(views, doc.path);
    if (!v || doc.viewState) return;
    doc.viewState = v;
    // lo scorrimento salvato vale per la finestra di allora: se porta su un'altra pagina, conta la pagina
    const fix = ({ doc: d } = {}) => {
      if (d !== doc) return;
      app.bus.off('viewer:pagesinit', fix);
      setTimeout(() => { if (app.activeDoc === doc && app.viewer.page !== v.page) app.viewer.page = v.page; }, 60);
    };
    app.bus.on('viewer:pagesinit', fix);
  });
  app.bus.on('document:deactivated', ({ doc }) => remember(doc));

  // ---------- sessione nel main ----------
  const take = () => snapshot(app.docs, app.activeDoc, app.viewer.page);
  const push = (state) => app.platform.sessionUpdate(state).catch(() => {});
  const save = () => { if (!restoring && !quitting) push({ ...take(), last, running: true }); };
  const setLast = (doc, page) => { if (doc?.path) last = { path: doc.path, page: Number(page) || doc.viewState?.page || 1 }; };
  app.bus.on('document:loaded', save);
  app.bus.on('document:saved', save);
  app.bus.on('document:activated', ({ doc }) => { if (!quitting && doc) setLast(doc, app.viewer.page); save(); });
  app.bus.on('page:changed', () => {
    clearTimeout(pageTimer);
    pageTimer = setTimeout(() => { if (quitting) return; const d = app.activeDoc; if (d) { setLast(d, app.viewer.page); remember(d); } save(); }, 800);
  });
  // un documento chiuso dall'utente esce subito dalla sessione: non ricompare più al riavvio
  app.bus.on('document:closed', ({ doc }) => {
    if (quitting) return;
    remember(doc); // la vista era già stata salvata nel documento al cambio di scheda
    setLast(doc, doc.viewState?.page);
    save();
    app.refreshHome();
  });
  // chiusura dell'app: si fissano i documenti ancora aperti adesso, prima che il nucleo li chiuda uno a uno
  app.bus.on('app:quitting', () => {
    quitting = true; clearTimeout(pageTimer);
    for (const d of app.docs) remember(d);
    quitSnap = take();
    if (app.activeDoc?.path) setLast(app.activeDoc, app.viewer.page);
  });
  app.bus.on('app:quit-cancelled', () => { quitting = false; quitSnap = null; save(); });
  app.bus.on('app:quit-confirmed', () => { push({ ...(quitSnap || take()), last, running: false }); });

  // ---------- avvio ----------
  const started = app.platform.sessionStart().catch((err) => { console.error('[avanzati] sessione', err); return null; });
  // documenti della sessione interrotta: li propone il recupero, nella stessa domanda delle bozze non salvate
  let offered = false;
  app.bus.on('recovery:collect', (arr) => {
    if (offered) return;
    offered = true;
    arr.push(started.then((st) => {
      const plan = startupPlan(st);
      return plan.action === 'ask' ? plan.docs.map((d) => ({ ...d, active: d.path === plan.active })) : [];
    }));
  });
  app.bus.on('home:actions', ({ recent, actions }) => {
    // solo se il file è ancora fra i recenti (esiste ancora e l'elenco non è stato svuotato)
    if (!last || !recent.includes(last.path)) return;
    const name = last.path.split(/[\\/]/).pop();
    const target = last.path;
    actions.push({ el: app.ui.h('button', { class: 'btn big home-last', 'data-azione': 'riapri-ultimo', title: target, onclick: () => app.openPath(target) },
      app.ui.h('span', { html: icon('file') }), app.ui.h('span', {}, 'Riapri l\'ultimo documento'), app.ui.h('small', { class: 'home-last-name' }, name)) });
  });

  setTimeout(async () => {
    try {
      const st = await started;
      if (!st) return;
      last = last || st.previous?.last || null;
      app.refreshHome();
      const plan = startupPlan(st, { reopen: app.settings.get(KEY_REOPEN, false) === true, busy: app.docs.length > 0 });
      if (plan.action !== 'reopen') return;
      let ok = 0; const missing = [];
      for (const d of plan.docs) {
        if (app.docs.some((x) => x.path === d.path)) continue;
        let f = null;
        try { f = await app.platform.readFile(d.path); } catch { f = null; }
        if (!f) { missing.push(d.path); continue; }
        if (await app.openFile(f, recallView(views, d.path) || d.page <= 1 ? {} : { page: d.page })) ok++;
      }
      const active = plan.active && app.docs.find((x) => x.path === plan.active);
      if (active) app.activate(active);
      if (ok || missing.length) {
        app.ui.toast(`Riaperti ${ok} ${ok === 1 ? 'documento lasciato aperto' : 'documenti lasciati aperti'}${missing.length ? ` (${missing.length} non ${missing.length === 1 ? 'trovato' : 'trovati'})` : ''}.`,
          { kind: 'info', timeout: 6000, action: { label: 'Non farlo più', run: () => app.settings.set(KEY_REOPEN, false) } });
      }
    } catch (err) { console.error('[avanzati] riapertura dei documenti', err); }
    finally { restoring = false; save(); }
  }, 400);
}
