// Bus di eventi minimale condiviso da nucleo e feature.
export class Bus {
  #h = new Map();
  on(evt, fn) { if (!this.#h.has(evt)) this.#h.set(evt, new Set()); this.#h.get(evt).add(fn); return () => this.off(evt, fn); }
  off(evt, fn) { this.#h.get(evt)?.delete(fn); }
  once(evt, fn) { const off = this.on(evt, (...a) => { off(); fn(...a); }); return off; }
  emit(evt, payload) {
    for (const fn of [...(this.#h.get(evt) || [])]) {
      try { fn(payload); } catch (err) { console.error(`[bus] errore in "${evt}"`, err); }
    }
  }
}
