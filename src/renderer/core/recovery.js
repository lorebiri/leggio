// Salvataggio di recupero automatico: i documenti modificati e non salvati vengono copiati
// in una cartella di recupero (nell'app: userData/recupero, nel browser: IndexedDB) dopo ogni
// modifica (con attesa) e periodicamente. Dopo un arresto anomalo, al riavvio Leggio propone
// di ripristinarli (insieme agli altri documenti aperti nella sessione interrotta, se un'area li indica:
// vedi 'recovery:collect'). Chiudendo normalmente (salvando o scartando) le copie vengono eliminate.
import { platform } from './platform.js';
import { h, dialog, toast, formatBytes } from './ui.js';
import { log } from './guard.js';
import { MB } from './history.js';

const PERIOD_MS = 2 * 60 * 1000;

/**
 * Nome e percorso con cui riaprire una copia di recupero. Se il file è già aperto in una scheda
 * (es. riaperto con un doppio clic prima di rispondere), la copia recuperata si apre a parte,
 * senza percorso e con il nome «nome (recuperato).pdf»: altrimenti si attiverebbe la scheda già
 * aperta e le modifiche recuperate andrebbero perse.
 * isOpen(path) → true se il percorso è già aperto.
 */
export function restoreTarget(entry, isOpen) {
  if (entry.path && isOpen(entry.path)) return { name: String(entry.name || 'Senza titolo.pdf').replace(/(\.pdf)?$/i, ' (recuperato).pdf'), path: null };
  return { name: entry.name, path: entry.path || null };
}

export class Recovery {
  constructor(app) {
    this.app = app;
    this.backend = platform.recoveryBackend() || new IdbRecovery();
    this.state = new Map(); // doc.id → { key, timer, writing }
    this.enabled = true;
  }

  start() {
    const bus = this.app.bus;
    bus.on('document:changed', ({ doc }) => this.schedule(doc));
    bus.on('document:forms-changed', ({ doc }) => this.schedule(doc));
    bus.on('document:loaded', ({ doc }) => { if (doc.dirty) this.schedule(doc, 0); });
    bus.on('document:saved', ({ doc }) => { if (!doc.dirty && !doc.formsDirty) this.remove(doc); });
    bus.on('document:closed', ({ doc }) => this.remove(doc));
    this.interval = setInterval(() => { for (const d of this.app.docs) this.schedule(d, 0); }, PERIOD_MS);
    setTimeout(() => this.offer(false).catch((err) => log('warn', 'recupero: elenco non disponibile', { error: String(err?.message || err) })), 600);
  }

  /** Programma una copia di recupero (con attesa per raggruppare modifiche ravvicinate). */
  schedule(doc, delay) {
    if (!this.enabled || doc.closed) return;
    const st = this.#st(doc);
    clearTimeout(st.timer);
    const big = doc.bytes.length > 100 * MB;
    const d = delay ?? (big ? 60000 : 4000);
    st.timer = setTimeout(() => this.snapshot(doc).catch((err) => log('warn', 'recupero: copia non riuscita', { name: doc.name, error: String(err?.message || err) })), d);
  }

  #st(doc) { let s = this.state.get(doc.id); if (!s) { s = { key: null, timer: null, writing: null }; this.state.set(doc.id, s); } return s; }

  /** Scrive subito la copia di recupero del documento, se serve. */
  async snapshot(doc) {
    if (doc.closed) return;
    if (!doc.dirty && !doc.formsDirty) return this.remove(doc);
    const st = this.#st(doc);
    const key = `${doc.version}:${doc.formsRev}`;
    if (st.key === key) return;
    if (st.writing) { await st.writing.catch(() => {}); return this.snapshot(doc); }
    st.writing = (async () => {
      // i byte del documento non vengono mai modificati sul posto: basta il riferimento.
      // I moduli compilati a schermo si integrano in una copia, senza toccare il documento.
      let bytes = doc.bytes;
      if (doc.formsDirty && doc.pdf) {
        try { const b = await doc.pdf.saveDocument(); bytes = b instanceof Uint8Array ? b : new Uint8Array(b); }
        catch { /* proxy sostituito nel frattempo: si usa l'ultimo stato dei byte */ }
      }
      if (doc.closed) return;
      const meta = { id: doc.id, name: doc.name, path: doc.path || null, size: bytes.length, time: Date.now(), pages: doc.pageCount, readOnly: !!doc.readOnly };
      await this.backend.write(meta, bytes);
      st.key = key;
    })();
    try { await st.writing; } finally { st.writing = null; }
  }

  async remove(doc) {
    const st = this.state.get(doc.id);
    if (st) { clearTimeout(st.timer); if (st.writing) await st.writing.catch(() => {}); }
    this.state.delete(doc.id);
    try { await this.backend.remove(doc.id); } catch { /* niente da eliminare */ }
  }

  /** Uscita regolare: le copie di questa sessione non servono più. */
  async cleanExit() {
    for (const d of this.app.docs) await this.remove(d);
    clearInterval(this.interval);
  }

  /**
   * Propone di ripristinare i documenti di una sessione interrotta (crash, chiusura forzata): è sempre una
   * domanda, mai un'apertura automatica. Comprende le copie di recupero (modifiche non salvate) e, all'avvio,
   * i documenti che le aree indicano con l'evento 'recovery:collect' (array di [{path, page, active}] o di
   * promesse): per esempio quelli che erano aperti nella sessione interrotta, senza modifiche da recuperare.
   * force: chiamata dal menu Aiuto (solo le copie di recupero, con un avviso se non ce ne sono).
   */
  async offer(force) {
    const list = (await this.backend.list()) || [];
    const extra = [];
    if (!force) this.app.bus.emit('recovery:collect', extra);
    const collected = (await Promise.all(extra.map((x) => Promise.resolve(x).catch(() => [])))).flat();
    const drafts = new Set(list.map((e) => e.path).filter(Boolean));
    const seen = new Set();
    // documenti senza bozza: si riaprono dal disco così com'erano salvati
    const plain = collected.filter((d) => d && typeof d.path === 'string' && !drafts.has(d.path) && !seen.has(d.path) && seen.add(d.path));
    if (!list.length && !plain.length) { if (force) toast('Nessun documento da recuperare'); return; }
    const fmt = (t) => new Date(t).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' });
    const n = list.length + plain.length;
    const intro = plain.length
      ? `Leggio non è stato chiuso correttamente. Vuoi ripristinare ${n === 1 ? 'il documento' : `i ${n} documenti`} della sessione interrotta?`
      : (list.length === 1 ? 'Leggio non è stato chiuso correttamente. Questo documento aveva modifiche non salvate:' : `Leggio non è stato chiuso correttamente. Questi ${list.length} documenti avevano modifiche non salvate:`);
    const body = h('div', {},
      h('p', {}, intro),
      h('ul', { class: 'recovery-list' },
        list.map((e) => h('li', {}, h('strong', {}, e.name), h('small', {}, ` — modifiche non salvate, ${fmt(e.time)}, ${formatBytes(e.size)}${e.path ? ' · ' + e.path : ''}`))),
        plain.map((d) => h('li', {}, h('strong', {}, d.path.split(/[\\/]/).pop()), h('small', {}, ` — ${d.path}`)))));
    const options = [
      { value: 'restore', label: list.length ? 'Ripristina (quelli con modifiche non salvate si aprono come documenti modificati, da salvare)' : 'Ripristina i documenti' },
      { value: 'later', label: list.length ? 'Non ora (le copie con le modifiche restano: potrai ripristinarle dal menu Aiuto)' : 'Non ora' },
    ];
    if (list.length) options.push({ value: 'discard', label: 'Elimina le copie di recupero' });
    const v = await dialog({
      title: plain.length ? 'Sessione interrotta' : 'Recupero documenti', body, width: 560, okLabel: 'Continua', cancelLabel: null,
      fields: [{ name: 'a', type: 'radio', value: 'restore', options }],
    });
    const a = v?.a || 'later';
    if (a === 'later') return;
    const sessions = [...new Set(list.map((e) => e.session))];
    if (a === 'discard') {
      for (const s of sessions) await this.backend.discard(s);
      toast('Copie di recupero eliminate');
      return;
    }
    let ok = 0;
    for (const e of list) {
      try {
        const bytes = await this.backend.read(e.session, e.id);
        const open = new Set(this.app.docs);
        const target = restoreTarget(e, (p) => this.app.docs.some((d) => d.path === p));
        // un documento in sola lettura torna in sola lettura (il ripristino non deve poter sovrascrivere l'originale)
        const doc = await this.app.openBytes(bytes, { name: target.name, path: target.path, dirty: true, readOnly: !!e.readOnly });
        // conta solo una scheda nuova con i byte recuperati, non una scheda già aperta che è stata solo attivata
        if (doc && !open.has(doc)) { ok++; await this.snapshot(doc); }
        else if (doc) log('warn', 'recupero: il file era già aperto, copia non ripristinata', { name: e.name });
      } catch (err) { log('error', 'recupero: ripristino non riuscito', { name: e.name, error: String(err?.message || err) }); }
    }
    // le vecchie copie si eliminano solo se tutto è stato ripristinato (e ricopiato in questa sessione)
    if (list.length && ok === list.length) for (const s of sessions) await this.backend.discard(s);
    let reopened = 0; const missing = [];
    for (const d of plain) {
      let f = null;
      try { f = await platform.readFile(d.path); } catch { f = null; }
      if (!f) { missing.push(d.path); continue; }
      if (await this.app.openFile(f, d.page > 1 ? { page: d.page } : {})) reopened++;
    }
    const active = collected.find((d) => d?.active)?.path;
    const activeDoc = active && this.app.docs.find((d) => d.path === active);
    if (activeDoc) this.app.activate(activeDoc);
    const parts = [];
    if (list.length) parts.push(ok === list.length ? `${ok} con modifiche da salvare` : `${ok} su ${list.length} con modifiche (gli altri restano nella cartella di recupero)`);
    if (plain.length) parts.push(`${reopened} dal disco${missing.length ? ` (${missing.length} non ${missing.length === 1 ? 'trovato' : 'trovati'})` : ''}`);
    const allOk = ok === list.length && !missing.length;
    toast(`Documenti ripristinati: ${parts.join(', ')}.${list.length ? ' Ricordati di salvarli.' : ''}`, { kind: allOk ? 'success' : 'warning', timeout: 8000 });
  }
}

/** Ripiego per il browser: IndexedDB, con "battito" per riconoscere le sessioni ancora aperte. */
export class IdbRecovery {
  constructor() {
    this.session = Math.random().toString(36).slice(2) + Date.now().toString(36);
    this.ok = typeof indexedDB !== 'undefined';
    this.#beat();
    this.beatTimer = setInterval(() => this.#beat(), 30000);
  }
  #beat() { try { localStorage.setItem('leggio.rec.alive.' + this.session, String(Date.now())); } catch { /* storage pieno */ } }
  #alive(s) { const t = +localStorage.getItem('leggio.rec.alive.' + s) || 0; return Date.now() - t < 90000; }
  #db() {
    if (!this.ok) return Promise.reject(new Error('IndexedDB non disponibile'));
    return this.dbp ||= new Promise((res, rej) => {
      const r = indexedDB.open('leggio-recupero', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('docs', { keyPath: 'key' });
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
  }
  async #tx(mode, fn) {
    const db = await this.#db();
    return new Promise((res, rej) => {
      const tx = db.transaction('docs', mode); const st = tx.objectStore('docs');
      let out; const r = fn(st); if (r) r.onsuccess = () => { out = r.result; };
      tx.oncomplete = () => res(out); tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error);
    });
  }
  async write(meta, bytes) { await this.#tx('readwrite', (st) => st.put({ key: `${this.session}:${meta.id}`, session: this.session, meta, bytes })); }
  async remove(id) { await this.#tx('readwrite', (st) => st.delete(`${this.session}:${id}`)); }
  async list() {
    if (!this.ok) return [];
    const all = (await this.#tx('readonly', (st) => st.getAll())) || [];
    return all.filter((r) => r.session !== this.session && !this.#alive(r.session)).map((r) => ({ ...r.meta, session: r.session }));
  }
  async read(session, id) { const r = await this.#tx('readonly', (st) => st.get(`${session}:${id}`)); if (!r) throw new Error('Copia non trovata'); return r.bytes; }
  async discard(session) {
    const all = (await this.#tx('readonly', (st) => st.getAll())) || [];
    await this.#tx('readwrite', (st) => { for (const r of all) if (r.session === session) st.delete(r.key); });
    try { localStorage.removeItem('leggio.rec.alive.' + session); } catch { /* */ }
  }
}
