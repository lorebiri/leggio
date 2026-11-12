// Cronologia Annulla/Ripeti con tetto di memoria dinamico e, nell'app desktop, copie su disco.
//
// Ogni voce conserva lo stato *precedente* del documento (i byte interi: i PDF modificati da
// pdf-lib vengono riscritti per intero, quindi un diff non avrebbe senso). Per non esaurire la
// memoria con file grandi:
//   - nell'app Electron le copie oltre una soglia vanno in una cartella temporanea dell'app
//     (canali IPC app:history-*), in memoria resta solo un riferimento;
//   - in memoria (browser, o copie piccole) vale un tetto calcolato dalla RAM disponibile;
//   - quando il tetto obbliga a scartare le voci più vecchie viene chiamato onTrim, così
//     l'interfaccia può avvisare che la cronologia è stata accorciata.
// La logica non tocca il DOM ed è coperta da test (test/robustezza-cronologia.test.js).

export const MAX_ENTRIES = 40;
export const MB = 1024 * 1024;
export const GB = 1024 * MB;

/**
 * Tetto (byte) per le copie tenute in memoria.
 * @param {{ totalMemory?: number, deviceMemoryGB?: number, heapLimit?: number }} info
 */
export function memoryBudget({ totalMemory, deviceMemoryGB, heapLimit } = {}) {
  let total = totalMemory || (deviceMemoryGB ? deviceMemoryGB * GB : 0) || 4 * GB;
  // un 12% della RAM, fra 96 MB e 600 MB (il vecchio tetto fisso)
  let b = Math.round(total * 0.12);
  if (heapLimit) b = Math.min(b, Math.round(heapLimit * 0.35));
  return Math.max(96 * MB, Math.min(600 * MB, b));
}

/**
 * Tetto (byte) per le copie su disco: al massimo 4 GB o un quarto dello spazio libero.
 * @param {number} [diskFree]
 */
export function diskBudget(diskFree) {
  if (!diskFree || !Number.isFinite(diskFree)) return 2 * GB;
  return Math.max(256 * MB, Math.min(4 * GB, Math.round(diskFree / 4)));
}

/** Archivio in memoria. */
export class MemoryStore {
  kind = 'memory';
  #map = new Map();
  #n = 0;
  async put(bytes) { const k = 'm' + ++this.#n; this.#map.set(k, bytes); return k; }
  async get(k) { const b = this.#map.get(k); if (!b) throw new Error('Copia della cronologia non trovata'); return b; }
  async drop(keys) { for (const k of keys) this.#map.delete(k); }
  async clear() { this.#map.clear(); }
}

/**
 * Archivio su disco tramite un "backend" asincrono {put(bytes)→key, get(key)→bytes, drop(keys), clear()}
 * (nell'app è il processo main). Se il disco fallisce si ripiega sulla memoria.
 */
export class DiskStore {
  kind = 'disk';
  constructor(backend) { this.backend = backend; }
  put(bytes) { return this.backend.put(bytes); }
  get(k) { return this.backend.get(k); }
  drop(keys) { return keys.length ? this.backend.drop(keys) : Promise.resolve(); }
  clear() { return this.backend.clear?.(); }
}

/**
 * @typedef {{ label: string, version: number, size: number, where: 'memory'|'disk', key: string }} Entry
 */
export class History {
  /**
   * @param {object} o
   * @param {MemoryStore} [o.memory]
   * @param {DiskStore|null} [o.disk]
   * @param {() => number} [o.memoryBudget]   byte massimi in memoria
   * @param {() => number} [o.diskBudget]     byte massimi su disco
   * @param {number} [o.diskThreshold]        sotto questa dimensione la copia resta in memoria
   * @param {number} [o.maxEntries]
   * @param {(info:{dropped:number, reason:string}) => void} [o.onTrim]
   */
  constructor(o = {}) {
    this.memory = o.memory || new MemoryStore();
    this.disk = o.disk || null;
    this.memoryBudget = o.memoryBudget || (() => memoryBudget());
    this.diskBudget = o.diskBudget || (() => diskBudget());
    this.diskThreshold = o.diskThreshold ?? 2 * MB;
    this.maxEntries = o.maxEntries ?? MAX_ENTRIES;
    this.onTrim = o.onTrim || null;
    /** @type {Entry[]} */ this.undoStack = [];
    /** @type {Entry[]} */ this.redoStack = [];
    this.diskFailed = false;
    this.#chain = Promise.resolve();
  }
  #chain;
  /** Le operazioni sulla cronologia sono serializzate: push può proseguire in sottofondo (scrittura su disco)
   *  mentre la modifica è già visibile; un Annulla successivo aspetta che sia finita. */
  #serial(fn) { const p = this.#chain.then(fn); this.#chain = p.catch(() => {}); return p; }
  /** Si risolve quando le scritture in sottofondo sono finite. */
  idle() { return this.#chain; }

  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }
  get undoLabel() { return this.undoStack.at(-1)?.label ?? null; }
  get redoLabel() { return this.redoStack.at(-1)?.label ?? null; }
  /** Byte occupati, per archivio. */
  usage() {
    const u = { memory: 0, disk: 0 };
    for (const e of [...this.undoStack, ...this.redoStack]) u[e.where] += e.size;
    return u;
  }

  async #stash(label, version, bytes) {
    const size = bytes.length;
    if (this.disk && !this.diskFailed && size >= this.diskThreshold) {
      try {
        const key = await this.disk.put(bytes);
        return { label, version, size, where: 'disk', key };
      } catch (err) {
        // disco pieno o cartella temporanea non scrivibile: ripiego in memoria, con tetto
        this.diskFailed = true;
        this.lastDiskError = err;
      }
    }
    const key = await this.memory.put(bytes);
    return { label, version, size, where: 'memory', key };
  }

  async #load(e) { return e.where === 'disk' ? this.disk.get(e.key) : this.memory.get(e.key); }
  async #release(entries) {
    const mem = entries.filter((e) => e.where === 'memory').map((e) => e.key);
    const dsk = entries.filter((e) => e.where === 'disk').map((e) => e.key);
    await this.memory.drop(mem);
    if (dsk.length && this.disk) { try { await this.disk.drop(dsk); } catch { /* file temporanei: verranno ripuliti all'uscita */ } }
  }

  /** Scarta le voci più vecchie finché numero e tetti sono rispettati. Ritorna quante ne ha scartate. */
  async trim() {
    const dropped = [];
    let reason = 'count';
    const total = () => this.undoStack.length + this.redoStack.length;
    // prima il numero massimo di passi
    while (total() > this.maxEntries && this.undoStack.length) dropped.push(this.undoStack.shift());
    // poi i tetti di byte: si scartano i passi di Annulla più vecchi; i Ripeti si toccano per ultimi.
    // Se l'unico passo rimasto da solo supera il tetto lo si tiene comunque: perdere l'ultimo
    // Annulla sarebbe peggio di qualche centinaio di MB in più (finché la memoria regge).
    for (const where of ['memory', 'disk']) {
      const budget = where === 'memory' ? this.memoryBudget() : this.diskBudget();
      let used = this.usage()[where];
      const pick = (stack) => stack.findIndex((e) => e.where === where);
      while (used > budget && total() > 1) {
        // candidato: il passo di Annulla più vecchio; ma l'ultimo Annulla si sacrifica solo
        // dopo i Ripeti (in fondo alla pila Ripeti, indice 0, c'è il più lontano)
        let stack = this.undoStack;
        let i = pick(this.undoStack);
        if (i < 0 || i === this.undoStack.length - 1) {
          const j = pick(this.redoStack);
          if (j >= 0) { stack = this.redoStack; i = j; }
        }
        if (i < 0) break;
        const [e] = stack.splice(i, 1);
        dropped.push(e); used -= e.size; reason = where;
      }
    }
    if (dropped.length) {
      await this.#release(dropped);
      try { this.onTrim?.({ dropped: dropped.length, reason }); } catch { /* solo avviso */ }
    }
    return dropped.length;
  }

  /** Nuova modifica: prevBytes è lo stato prima della modifica. Svuota i Ripeti. */
  push(label, prevVersion, prevBytes) { return this.#serial(() => this.#push(label, prevVersion, prevBytes)); }
  async #push(label, prevVersion, prevBytes) {
    const entry = await this.#stash(label, prevVersion, prevBytes);
    const redo = this.redoStack; this.redoStack = [];
    await this.#release(redo);
    this.undoStack.push(entry);
    await this.trim();
  }

  /**
   * Annulla: restituisce {label, version, bytes} dello stato precedente e mette lo stato
   * corrente nei Ripeti. Se la copia non è leggibile la voce resta dov'era e l'errore risale.
   */
  undo(curVersion, curBytes) { return this.#serial(() => this.#swap(this.undoStack, this.redoStack, curVersion, curBytes)); }
  redo(curVersion, curBytes) { return this.#serial(() => this.#swap(this.redoStack, this.undoStack, curVersion, curBytes)); }

  async #swap(from, to, curVersion, curBytes) {
    const e = from.at(-1);
    if (!e) return null;
    const bytes = await this.#load(e); // se fallisce non abbiamo toccato nulla
    const back = await this.#stash(e.label, curVersion, curBytes);
    from.pop();
    to.push(back);
    await this.#release([e]);
    await this.trim();
    return { label: e.label, version: e.version, bytes };
  }

  clear() { return this.#serial(() => this.#clear()); }
  async #clear() {
    const all = [...this.undoStack, ...this.redoStack];
    this.undoStack = []; this.redoStack = [];
    await this.#release(all);
  }
}
