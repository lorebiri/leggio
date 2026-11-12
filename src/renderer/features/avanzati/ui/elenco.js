// Elenco di file riordinabile SENZA trascinare (frecce, «Sposta in cima/in fondo»), con titolo modificabile,
// rotazione facoltativa e area dove lasciare i file. Usato da fascicolo, pratica di missione.
import { fileItem } from '../native.js';

/**
 * opts: { accetta: (name) => bool, rotazione (bool), titoli (bool), onChange() }
 * → { el, items, add(items), clear() }  — item: { name, rel, path, size, read(), titolo, rot }
 */
export function elencoFile(app, { accetta = () => true, rotazione = false, titoli = true, onChange } = {}) {
  const { h } = app.ui;
  const items = [];
  const list = h('ol', { class: 'av-steps', 'aria-label': 'Elenco dei file' });
  const drop = h('div', { class: 'av-drop' }, 'Trascina qui i file, oppure usa «Aggiungi file…»');
  const render = () => {
    list.innerHTML = '';
    if (!items.length) list.append(h('li', {}, h('span', { class: 'av-note av-grow' }, 'Nessun file.')));
    items.forEach((it, i) => {
      const titolo = titoli ? h('input', { type: 'text', value: it.titolo, 'aria-label': `Titolo di ${it.name}`, class: 'av-grow av-input', oninput: (e) => { it.titolo = e.target.value; } }) : h('span', { class: 'av-grow' }, it.name);
      const mv = (to) => { const [x] = items.splice(i, 1); items.splice(Math.max(0, Math.min(items.length, to)), 0, x); render(); onChange?.(); };
      list.append(h('li', {}, h('strong', {}, `${i + 1}.`), titolo,
        titoli ? h('small', { class: 'av-note', title: it.rel }, it.name) : null,
        rotazione ? h('button', { class: 'btn small', title: 'Ruota di 90°', 'aria-label': `Ruota ${it.name}`, onclick: () => { it.rot = ((it.rot || 0) + 90) % 360; render(); } }, `↻ ${it.rot || 0}°`) : null,
        h('button', { class: 'btn small', 'aria-label': 'Sposta su', title: 'Sposta su', disabled: i === 0, onclick: () => mv(i - 1) }, '↑'),
        h('button', { class: 'btn small', 'aria-label': 'Sposta giù', title: 'Sposta giù', disabled: i === items.length - 1, onclick: () => mv(i + 1) }, '↓'),
        h('button', { class: 'btn small', 'aria-label': `Togli ${it.name}`, onclick: () => { items.splice(i, 1); render(); onChange?.(); } }, 'Togli')));
    });
  };
  const add = (nuovi) => {
    let scartati = 0;
    for (const it of nuovi) {
      if (!accetta(it.name)) { scartati++; continue; }
      items.push({ ...it, titolo: it.titolo || it.name.replace(/\.[^.]+$/, ''), rot: 0 });
    }
    if (scartati) app.ui.toast(`${scartati} file non supportati non sono stati aggiunti.`, { kind: 'warning' });
    render(); onChange?.();
  };
  // il file lasciato qui non arriva mai al documento aperto sotto
  for (const ev of ['dragenter', 'dragover']) drop.addEventListener(ev, (e) => { e.preventDefault(); e.stopPropagation(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => { e.preventDefault(); e.stopPropagation(); drop.classList.remove('over'); add([...e.dataTransfer.files].map(fileItem)); });
  render();
  return { el: h('div', {}, list, drop), items, add, clear() { items.splice(0); render(); onChange?.(); }, render };
}

/** Impedisce che un file lasciato cadere sullo spazio di lavoro arrivi al documento sotto. */
export function bloccaDrop(el) {
  for (const ev of ['dragover', 'drop']) el.addEventListener(ev, (e) => { e.preventDefault(); e.stopPropagation(); });
}
