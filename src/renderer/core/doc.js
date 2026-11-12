// Modello di documento aperto: byte correnti, proxy pdf.js, cronologia annulla/ripeti.
import { openPdfJs } from './pdf.js';

let nextId = 1;
const MAX_HISTORY = 40;
const MAX_HISTORY_BYTES = 600 * 1024 * 1024;

export class Doc {
  constructor({ name, path, bytes, password }) {
    this.id = nextId++;
    this.name = name || 'Senza titolo.pdf';
    this.path = path || null;
    this.bytes = bytes;          // Uint8Array: lo stato salvabile del documento
    this.password = password;    // password di apertura (se cifrato)
    this.pdf = null;             // PDFDocumentProxy di pdf.js
    this.undoStack = [];         // [{label, bytes}]
    this.redoStack = [];
    this.dirty = false;
    this.viewState = null;       // {scale, page, scrollTop} per cambio scheda
    this.formsDirty = false;     // moduli compilati non ancora integrati nei byte
    this.data = {};              // spazio per le feature (es. data.annotations)
  }

  async load(onPassword) {
    const { pdf, password } = await openPdfJs(this.bytes, { password: this.password, onPassword });
    if (this.pdf) this.pdf.destroy();
    this.pdf = pdf;
    this.password = password;
    return pdf;
  }

  get pageCount() { return this.pdf?.numPages || 0; }

  #trim() {
    while (this.undoStack.length > MAX_HISTORY) this.undoStack.shift();
    let total = this.undoStack.reduce((s, e) => s + e.bytes.length, 0);
    while (total > MAX_HISTORY_BYTES && this.undoStack.length > 1) total -= this.undoStack.shift().bytes.length;
  }

  /** Registra nuovi byte come modifica annullabile. */
  commit(label, newBytes) {
    this.undoStack.push({ label, bytes: this.bytes });
    this.#trim();
    this.redoStack = [];
    this.bytes = newBytes;
    this.dirty = true;
  }
  undo() {
    const e = this.undoStack.pop(); if (!e) return null;
    this.redoStack.push({ label: e.label, bytes: this.bytes });
    this.bytes = e.bytes; this.dirty = true; return e.label;
  }
  redo() {
    const e = this.redoStack.pop(); if (!e) return null;
    this.undoStack.push({ label: e.label, bytes: this.bytes });
    this.bytes = e.bytes; this.dirty = true; return e.label;
  }
  destroy() { this.pdf?.destroy(); this.pdf = null; }
}
