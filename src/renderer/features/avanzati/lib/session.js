// Sessione e avvio: istantanea dei documenti aperti, decisione all'avvio, migrazione dalla 0.2,
// posizione ricordata per ogni file. Logica pura (testata in test/avvio-sessione.test.js).
export const MAX_SESSION_DOCS = 30;
export const MAX_VIEW_MEMORY = 100;

/** Impostazione «All'avvio riapri i documenti lasciati aperti» (predefinita: disattivata). */
export const KEY_REOPEN = 'avanzati.reopenAtStartup';
/** Posizione e zoom ricordati per ogni file: { [percorso]: { page, scale, scrollTop, t } }. */
export const KEY_VIEWS = 'avanzati.viewMemory';
/** Chiavi della 0.2 (sessione in localStorage, ripristino attivo di predefinito): si leggono una volta e si tolgono. */
export const OLD_KEY_SESSION = 'avanzati.session';
export const OLD_KEY_ON = 'avanzati.restoreSession';

const okPage = (p) => (Number.isFinite(p) && p > 0 ? Math.floor(p) : 1);

export function snapshot(docs, activeDoc, activePage) {
  const list = [];
  for (const d of docs || []) {
    if (!d.path) continue; // documenti mai salvati (es. estratti da .p7m) non si possono riaprire
    const page = d === activeDoc ? activePage : d.viewState?.page;
    list.push({ path: d.path, page: okPage(page) });
    if (list.length >= MAX_SESSION_DOCS) break;
  }
  return { docs: list, active: activeDoc?.path || null, at: Date.now() };
}

/** Valida un'istantanea (dal main o dalle vecchie impostazioni). */
export function docsToRestore(s) {
  if (!s || !Array.isArray(s.docs)) return [];
  const seen = new Set();
  return s.docs.filter((d) => d && typeof d.path === 'string' && d.path.length < 4096 && !seen.has(d.path) && seen.add(d.path))
    .slice(0, MAX_SESSION_DOCS).map((d) => ({ path: d.path, page: okPage(d.page) }));
}

/**
 * Cosa fare all'avvio della finestra.
 * - sessione precedente interrotta (crash, chiusura forzata) con documenti → 'ask': si propone il ripristino
 *   come domanda (insieme alle eventuali bozze del recupero automatico), mai in automatico;
 * - Leggio aperto con un file (doppio clic, «Apri con») → 'none': si apre solo quel file;
 * - impostazione attiva → 'reopen' dei soli documenti lasciati aperti alla chiusura regolare;
 * - altrimenti → 'none': schermata iniziale con i recenti e «Riapri l'ultimo documento».
 * start: { previous, interrupted, withFiles } dal main; reopen: valore dell'impostazione; busy: c'è già un documento aperto.
 */
export function startupPlan(start, { reopen = false, busy = false } = {}) {
  const docs = docsToRestore(start?.previous);
  if (start?.interrupted) return { action: docs.length ? 'ask' : 'none', docs, active: start.previous?.active || null };
  if (!reopen || start?.withFiles || busy || !docs.length) return { action: 'none', docs: [], active: null };
  return { action: 'reopen', docs, active: start.previous?.active || null };
}

/**
 * Migrazione dalla 0.2: la vecchia sessione (riaperta da sola di predefinito) non si riapre più;
 * se ne tiene solo l'ultimo documento per il pulsante «Riapri l'ultimo documento». Il vecchio interruttore
 * (attivo di predefinito, e salvato come attivo da chiunque abbia confermato le Impostazioni) non conta:
 * chi aggiorna riceve il nuovo comportamento predefinito. I recenti (nel main) non si toccano.
 * settings: { get, has, remove }. → { last } | null se non c'era niente da migrare.
 */
export function migrateFrom02(settings) {
  if (!settings.has(OLD_KEY_SESSION) && !settings.has(OLD_KEY_ON)) return null;
  const old = settings.get(OLD_KEY_SESSION, null);
  const docs = docsToRestore(old);
  const lastPath = (typeof old?.active === 'string' && docs.find((d) => d.path === old.active)?.path) || docs[0]?.path || null;
  const last = lastPath ? docs.find((d) => d.path === lastPath) : null;
  settings.remove(OLD_KEY_SESSION);
  settings.remove(OLD_KEY_ON);
  return { last: last || null };
}

/** Ricorda pagina, zoom e scorrimento di un file (i più recenti MAX_VIEW_MEMORY). → nuova mappa */
export function rememberView(map, path, vs, now = Date.now()) {
  if (!path || !vs) return map || {};
  const out = { ...(map && typeof map === 'object' ? map : {}) };
  const scale = typeof vs.scale === 'string' || Number.isFinite(vs.scale) ? vs.scale : null;
  out[path] = { page: okPage(vs.page), scale, scrollTop: Number.isFinite(vs.scrollTop) ? Math.round(vs.scrollTop) : null, t: now };
  const keys = Object.keys(out);
  if (keys.length > MAX_VIEW_MEMORY) {
    keys.sort((a, b) => (out[b].t || 0) - (out[a].t || 0));
    for (const k of keys.slice(MAX_VIEW_MEMORY)) delete out[k];
  }
  return out;
}

/** Stato della vista da applicare riaprendo un file, o null. */
export function recallView(map, path) {
  const v = map && typeof map === 'object' && path ? map[path] : null;
  if (!v || typeof v !== 'object') return null;
  const scale = typeof v.scale === 'string' || (Number.isFinite(v.scale) && v.scale > 0) ? v.scale : null;
  return { page: okPage(v.page), scale, scrollTop: scale != null && Number.isFinite(v.scrollTop) ? v.scrollTop : null };
}
