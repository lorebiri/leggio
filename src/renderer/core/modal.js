// Pila delle finestre modali del nucleo (dialoghi, domande, avanzamento, «Tutti gli strumenti»):
// solo quella in cima reagisce a Esc e Tab, così un Esc chiude una finestra sola e il fuoco
// non esce dalla finestra aperta. Logica pura: il DOM lo gestisce ui.js.

export class ModalStack {
  #items = [];
  /** Aggiunge una finestra in cima. entry: { root, onEscape } */
  push(entry) { this.#items.push(entry); return entry; }
  /** Toglie la finestra (ovunque si trovi nella pila). */
  remove(entry) { const i = this.#items.indexOf(entry); if (i >= 0) this.#items.splice(i, 1); }
  get top() { return this.#items[this.#items.length - 1] || null; }
  isTop(entry) { return this.top === entry; }
  get size() { return this.#items.length; }
}

/**
 * Tab dentro una finestra modale: indice del prossimo elemento da mettere a fuoco fra `count`
 * elementi, partendo da `current` (-1 = il fuoco è fuori dalla finestra). Ai bordi si ricomincia
 * dall'altro capo. → -1 se non c'è nulla da mettere a fuoco.
 */
export function nextFocusIndex(count, current, back = false) {
  if (!count) return -1;
  if (current < 0 || current >= count) return back ? count - 1 : 0;
  return (current + (back ? -1 : 1) + count) % count;
}
