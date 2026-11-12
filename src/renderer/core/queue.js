// Coda seriale per documento: le operazioni che modificano o salvano un documento
// vengono eseguite una alla volta, nell'ordine in cui sono state chieste.
// Così due modifiche lanciate insieme, o un Annulla premuto durante un salvataggio,
// non possono mai intrecciarsi e corrompere lo stato.

export class QueueClosedError extends Error {
  constructor(msg = 'Il documento è stato chiuso') { super(msg); this.name = 'QueueClosedError'; }
}

export class TaskQueue {
  #tail = Promise.resolve();
  #pending = 0;
  #closed = false;
  #labels = [];
  /** @param {(busy:boolean, label:string|null) => void} [onChange] */
  constructor(onChange) { this.onChange = onChange || null; }

  get busy() { return this.#pending > 0; }
  get closed() { return this.#closed; }
  /** Etichetta dell'operazione in corso (o null). */
  get current() { return this.#labels[0] ?? null; }
  get size() { return this.#pending; }

  /** Accoda fn; la promessa restituita si risolve/rifiuta con il risultato di fn. */
  run(label, fn) {
    if (this.#closed) return Promise.reject(new QueueClosedError());
    this.#pending++;
    this.#labels.push(label);
    this.#notify();
    const p = this.#tail.then(() => {
      if (this.#closed) throw new QueueClosedError();
      return fn();
    });
    const done = () => { this.#pending--; this.#labels.shift(); this.#notify(); };
    this.#tail = p.then(done, done);
    return p;
  }

  /** Si risolve quando tutte le operazioni accodate finora sono terminate. */
  idle() { return this.#tail; }

  /** Rifiuta le operazioni non ancora iniziate e quelle future. Quella in corso termina comunque. */
  close() { this.#closed = true; }

  #notify() { try { this.onChange?.(this.busy, this.current); } catch { /* l'interfaccia non deve rompere la coda */ } }
}
