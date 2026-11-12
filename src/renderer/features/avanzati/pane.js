// Spazio di lavoro a tutta area (sopra il visualizzatore) per strumenti con molte informazioni:
// fattura elettronica, azioni guidate, ricerca in più PDF, cartella delle scansioni.
let current = null;

/** → { el, body, actions, close() }. Un solo spazio aperto alla volta. */
export function openPane(app, { title, subtitle = '', onClose, id = '' }) {
  const { h } = app.ui;
  current?.close(true);
  const stage = app.el.main.querySelector('.stage') || app.el.main;
  const actions = h('div', { class: 'av-pane-actions' });
  const closeBtn = h('button', { class: 'btn', onclick: () => api.close() }, 'Chiudi');
  const head = h('header', { class: 'av-pane-head' },
    h('div', { class: 'av-pane-titles' }, h('h2', {}, title), subtitle ? h('div', { class: 'av-pane-sub' }, subtitle) : null),
    actions, closeBtn);
  const body = h('div', { class: 'av-pane-body' });
  const el = h('section', { class: 'av-pane', role: 'region', 'aria-label': title, 'data-pane': id }, head, body);
  stage.append(el);
  const onKey = (e) => { if (e.key === 'Escape' && !document.querySelector('.backdrop')) { e.stopPropagation(); api.close(); } };
  document.addEventListener('keydown', onKey, true);
  const api = {
    el, body, actions, id,
    setTitle(t, sub) { head.querySelector('h2').textContent = t; if (sub != null) { let s = head.querySelector('.av-pane-sub'); if (!s) { s = h('div', { class: 'av-pane-sub' }); head.querySelector('.av-pane-titles').append(s); } s.textContent = sub; } },
    close(silent) {
      if (!el.isConnected) return;
      el.remove(); document.removeEventListener('keydown', onKey, true);
      if (current === api) current = null;
      if (!silent || silent === true) onClose?.();
    },
  };
  current = api;
  setTimeout(() => closeBtn.focus());
  return api;
}
export function currentPane() { return current; }
