// Tastiera: quando una scorciatoia dell'app deve agire e quando deve lasciar fare al campo
// in cui si sta scrivendo o alla finestra modale aperta. Logica pura (nessun accesso al DOM globale).

/** L'elemento accetta testo o scelte da tastiera (campo, area di testo, menu a tendina, contenuto modificabile)? */
export function isEditable(el) {
  return !!el && (!!el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName || ''));
}

const TEXT_INPUTS = new Set(['', 'text', 'search', 'password', 'email', 'url', 'tel', 'number']);

/** L'elemento ha un proprio Annulla/Ripeti del testo (campo di testo, area di testo, contenuto modificabile)? */
export function isTextEditable(el) {
  if (!el) return false;
  if (el.isContentEditable || el.tagName === 'TEXTAREA') return true;
  return el.tagName === 'INPUT' && TEXT_INPUTS.has(String(el.type || '').toLowerCase()) && !el.readOnly && !el.disabled;
}

/**
 * Come trattare un tasto premuto nella finestra.
 * → 'native' (lo gestisce il campo: es. Ctrl+Z mentre si scrive annulla il testo, non il documento),
 *   'ignore' (nessuna scorciatoia dell'app), 'mod' (scorciatoia con Ctrl/⌘), 'key' (tasto singolo: V, H, strumenti, Esc).
 * key: e.key; mod: Ctrl (⌘ su Mac) premuto; alt; target: elemento che riceve il tasto; modal: c'è una finestra modale aperta.
 */
export function keyRoute({ key, mod = false, alt = false, target = null, modal = false }) {
  const k = String(key || '').toLowerCase();
  if (mod) {
    if ((k === 'z' || k === 'y') && isTextEditable(target)) return 'native';
    return modal ? 'ignore' : 'mod';
  }
  if (alt || isEditable(target) || modal) return 'ignore';
  return 'key';
}
