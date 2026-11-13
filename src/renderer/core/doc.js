// Modello di documento aperto: byte correnti, proxy pdf.js, cronologia annulla/ripeti,
// coda seriale delle operazioni.
import { openPdfJs, destroyPdf } from './pdf.js';
import { History } from './history.js';
import { TaskQueue } from './queue.js';
import { integrateForms } from './forms.js';

let nextId = 1;

/** Opzioni globali della cronologia (impostate dall'App in base a memoria e piattaforma). */
export const historyConfig = {
  makeHistory: (doc) => new History(),
};

export class Doc {
  constructor({ name, path, bytes, password }) {
    this.id = nextId++;
    this.name = name || 'Senza titolo.pdf';
    this.path = path || null;
    this.bytes = bytes;          // Uint8Array: lo stato salvabile del documento
    this.password = password;    // password di apertura (se cifrato)
    this.pdf = null;             // PDFDocumentProxy di pdf.js
    this.viewState = null;       // {scale, page, scrollTop} per cambio scheda
    this.formsDirty = false;     // moduli compilati non ancora integrati nei byte
    this.formsRev = 0;           // cresce a ogni modifica dei campi a schermo
    this.data = {};              // spazio per le feature (es. data.annotations)
    this.version = 0;            // identifica lo stato dei byte; cambia a ogni modifica/annulla
    this.savedVersion = 0;       // versione presente su disco (dirty = version !== savedVersion)
    this.closed = false;
    this.readOnly = false;       // aperto in sola lettura (es. dall'archivio): modifiche solo su una copia
    this.history = historyConfig.makeHistory(this);
    this.queue = new TaskQueue();
    this.#versions = 0;
  }
  #versions;

  get dirty() { return this.version !== this.savedVersion; }
  set dirty(v) {
    // compatibilità: doc.dirty = false segna come salvato, true come modificato
    if (v) { if (!this.dirty) this.savedVersion = -1; } else this.savedVersion = this.version;
  }
  get busy() { return this.queue.busy; }

  /** Voci della cronologia (sola lettura: {label, size, where}). */
  get undoStack() { return this.history.undoStack; }
  get redoStack() { return this.history.redoStack; }

  /** Apre (o riapre) i byte correnti con pdf.js e sostituisce il proxy. */
  async load(onPassword, opts = {}) {
    const { pdf, password } = await openPdfJs(this.bytes, { password: this.password, onPassword, ...opts });
    const old = this.setPdf(pdf);
    this.password = password;
    destroyPdf(old);
    return pdf;
  }

  /** Apre byte candidati senza toccare lo stato: serve a verificare una modifica prima di accettarla. */
  async openCandidate(bytes) {
    const { pdf } = await openPdfJs(bytes, { password: this.password });
    if (!pdf.numPages) { destroyPdf(pdf); throw new Error('Il risultato non contiene pagine'); }
    return pdf;
  }

  /** Imposta il proxy pdf.js e restituisce il precedente (da distruggere dopo aver aggiornato la vista). */
  setPdf(pdf) { const old = this.pdf; this.pdf = pdf; return old; }

  get pageCount() { return this.pdf?.numPages || 0; }

  #newVersion() { return ++this.#versions; }

  /** Registra nuovi byte come modifica annullabile. I byte nuovi valgono subito; la promessa si risolve quando la copia per Annulla è al sicuro. */
  commit(label, newBytes) {
    const prev = this.bytes, prevVersion = this.version;
    this.bytes = newBytes;
    this.version = this.#newVersion();
    return this.history.push(label, prevVersion, prev);
  }
  /**
   * → Promise<label|null>. I valori dei moduli digitati dopo l'ultima modifica vengono prima integrati
   * nello stato corrente: Annulla li toglie insieme a quella modifica e Ripeti li riporta.
   */
  async undo() {
    await integrateForms(this);
    const r = await this.history.undo(this.version, this.bytes);
    if (!r) return null;
    this.bytes = r.bytes; this.version = r.version; return r.label;
  }
  async redo() {
    await integrateForms(this);
    const r = await this.history.redo(this.version, this.bytes);
    if (!r) return null;
    this.bytes = r.bytes; this.version = r.version; return r.label;
  }
  /** Segna lo stato corrente come salvato. */
  markSaved() { this.savedVersion = this.version; }
  /** Per i salvataggi che sostituiscono i byte (save hook) senza voce di cronologia. */
  replaceBytes(bytes) { this.bytes = bytes; }

  destroy() {
    this.closed = true;
    this.queue.close();
    destroyPdf(this.pdf);
    this.pdf = null;
    this.history.clear().catch(() => {});
    this.bytes = new Uint8Array(0);
    this.data = {};
  }
}
