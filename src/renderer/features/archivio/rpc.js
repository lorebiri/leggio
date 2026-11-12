// Richieste con risposta verso un Web Worker, e gruppo di worker di estrazione con tempo massimo.

export class Rpc {
  constructor(factory) { this.factory = factory; this.seq = 0; this.wait = new Map(); this.#start(); }
  #start() {
    this.w = this.factory();
    this.w.onmessage = (ev) => {
      const { req, ok, r, errore, dettaglio } = ev.data || {};
      const p = this.wait.get(req); if (!p) return;
      this.wait.delete(req);
      if (ok) p.resolve(r); else p.reject(Object.assign(new Error(errore || 'Errore nel lavoro in sottofondo'), { dettaglio }));
    };
    this.w.onerror = (e) => { e.preventDefault?.(); this.#failAll(new Error('Il lavoro in sottofondo si è interrotto: ' + (e.message || 'errore'))); };
  }
  #failAll(err) { for (const p of this.wait.values()) p.reject(err); this.wait.clear(); }
  call(t, args = {}, transfer = []) {
    const req = ++this.seq;
    return new Promise((resolve, reject) => { this.wait.set(req, { resolve, reject }); this.w.postMessage({ req, t, ...args }, transfer); });
  }
  post(msg) { this.w.postMessage(msg); }
  /** Ricrea il worker (memoria liberata), rifiutando le richieste in sospeso. */
  restart(reason = 'Lavoro interrotto') { try { this.w.terminate(); } catch { /* */ } this.#failAll(new Error(reason)); this.#start(); }
  terminate() { try { this.w.terminate(); } catch { /* */ } this.#failAll(new Error('Chiuso')); }
}

/**
 * Gruppo di worker di estrazione: un documento per worker alla volta, tempo massimo per file,
 * worker ricreato ogni `ricicla` documenti (memoria costante) o se un file lo blocca.
 */
export class Pool {
  constructor(factory, { n = 2, ricicla = 150, init } = {}) {
    this.factory = factory; this.init = init; this.ricicla = ricicla;
    this.slots = Array.from({ length: n }, () => this.#nuovo());
    this.coda = [];
  }
  #nuovo() { const rpc = new Rpc(this.factory); this.init?.(rpc); return { rpc, fatti: 0, occupato: false }; }
  get size() { return this.slots.length; }
  /** → risultato del worker; lancia un errore se il file impiega più di `tempo` ms. */
  async esegui(t, args, transfer, tempo = 60000) {
    const slot = await this.#prendi();
    let timer;
    try {
      return await Promise.race([
        slot.rpc.call(t, args, transfer),
        new Promise((_, rej) => { timer = setTimeout(() => { const e = new Error('Il file richiede troppo tempo: saltato'); e.timeout = true; rej(e); }, tempo); }),
      ]);
    } catch (e) {
      if (e.timeout) { slot.rpc.restart('Tempo scaduto'); slot.fatti = 0; }
      throw e;
    } finally {
      clearTimeout(timer);
      if (++slot.fatti >= this.ricicla) { slot.rpc.terminate(); Object.assign(slot, this.#nuovo()); }
      slot.occupato = false;
      const next = this.coda.shift(); if (next) next();
    }
  }
  #prendi() {
    const libero = this.slots.find((s) => !s.occupato);
    if (libero) { libero.occupato = true; return Promise.resolve(libero); }
    return new Promise((resolve) => this.coda.push(() => { const s = this.slots.find((x) => !x.occupato); s.occupato = true; resolve(s); }));
  }
  terminate() { for (const s of this.slots) s.rpc.terminate(); this.slots = []; }
}
