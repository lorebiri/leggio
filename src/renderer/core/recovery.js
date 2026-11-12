// Salvataggio di recupero automatico: i documenti modificati e non salvati vengono copiati
// in una cartella di recupero (nell'app: userData/recupero, nel browser: IndexedDB) dopo ogni
// modifica (con attesa) e periodicamente. Dopo un arresto anomalo, al riavvio Leggio propone
// di ripristinarli. Chiudendo normalmente (salvando o scartando) le copie vengono eliminate.
import { platform } from './platform.js';
import { h, dialog, toast, formatBytes } from './ui.js';
import { log } from './guard.js';
import { MB } from './history.js';

const PERIOD_MS = 2 * 60 * 1000;

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
    const d = delay ?? (doc.bytes.length > 200 * MB ? 30000 : 4000);
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
      const meta = { id: doc.id, name: doc.name, path: doc.path || null, size: bytes.length, time: Date.now(), pages: doc.pageCount };
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

  /** Propone di ripristinare i documenti rimasti da una sessione interrotta. */
  async offer(force) {
    const list = (await this.backend.list()) || [];
    if (!list.length) { if (force) toast('Nessun documento da recuperare'); return; }
    const fmt = (t) => new Date(t).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' });
    const body = h('div', {},
      h('p', {}, list.length === 1 ? 'Leggio non è stato chiuso correttamente. Questo documento aveva modifiche non salvate:' : `Leggio non è stato chiuso correttamente. Questi ${list.length} documenti avevano modifiche non salvate:`),
      h('ul', { class: 'recovery-list' }, list.map((e) => h('li', {}, h('strong', {}, e.name), h('small', {}, ` — ${fmt(e.time)}, ${formatBytes(e.size)}${e.path ? ' · ' + e.path : ''}`)))));
    const v = await dialog({
      title: 'Recupero documenti', body, width: 560, okLabel: 'Continua', cancelLabel: null,
      fields: [{ name: 'a', type: 'radio', value: 'restore', options: [
        { value: 'restore', label: 'Ripristina (si aprono come documenti modificati, da salvare)' },
        { value: 'later', label: 'Non ora (le copie restano, potrai ripristinarle dal menu Aiuto)' },
        { value: 'discard', label: 'Elimina le copie di recupero' }] }],
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
        const doc = await this.app.openBytes(bytes, { name: e.name, path: e.path, dirty: true });
        if (doc) { ok++; await this.snapshot(doc); }
      } catch (err) { log('error', 'recupero: ripristino non riuscito', { name: e.name, error: String(err?.message || err) }); }
    }
    // le vecchie copie si eliminano solo se tutto è stato ripristinato (e ricopiato in questa sessione)
    if (ok === list.length) for (const s of sessions) await this.backend.discard(s);
    toast(ok === list.length ? `Ripristinati ${ok} documenti. Ricordati di salvarli.` : `Ripristinati ${ok} documenti su ${list.length}; gli altri restano nella cartella di recupero.`, { kind: ok === list.length ? 'success' : 'warning', timeout: 8000 });
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
