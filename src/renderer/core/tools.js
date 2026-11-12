// Registro degli strumenti e pannello "Tutti gli strumenti" (anche come palette comandi ⌘K).
import { h, toast } from './ui.js';
import { icon } from './icons.js';
import { rankTools } from './toolsearch.js';

export const CATEGORIES = [
  ['crea', 'Crea e combina'],
  ['pagine', 'Organizza pagine'],
  ['commenta', 'Commenta e rivedi'],
  ['modifica', 'Modifica contenuto'],
  ['moduli', 'Moduli e firme'],
  ['proteggi', 'Proteggi e oscura'],
  ['converti', 'Converti ed esporta'],
  ['avanzati', 'Strumenti avanzati'],
  ['vista', 'Lettura e accessibilità'],
];

/**
 * Nomi usati da Adobe Acrobat (italiano) per gli id riservati: chi viene da Acrobat li cerca così.
 * Il primo è il nome mostrato tra parentesi (acrobatName), gli altri sono sinonimi per la ricerca.
 * Un'area può impostare acrobatName nel proprio strumento: ha la precedenza.
 */
export const ACROBAT_NAMES = {
  merge: ['Combina file', 'combina unire unisci accorpare'],
  organize: ['Organizza pagine', 'organizza riordina sposta pagine'],
  compress: ['Comprimi PDF', 'riduci dimensioni file ottimizza pesante'],
  redact: ['Redazione', 'oscura annerisci censura'],
  'fill-sign': ['Compila e firma', 'compila firma modulo'],
  protect: ['Proteggi', 'password cifra proteggi'],
  'convert-word': ['Esporta PDF', 'esporta word docx converti'],
  ocr: ['Scansione e OCR', 'riconosci testo ocr scansione'],
  compare: ['Confronta file', 'confronta differenze'],
  'create-pdf': ['Crea PDF', 'crea converti in pdf immagini'],
  sign: ['Usa un certificato', 'firma digitale certificato pades'],
  'delete-pages': ['Elimina pagine', 'elimina cancella pagine'],
  metadata: ['Proprietà documento', 'proprieta titolo autore metadati'],
};

export class ToolRegistry {
  constructor(app) { this.app = app; this.tools = new Map(); this.active = null; }

  /**
   * def: { id, name, category, description, icon, keywords, quick (barra rapida), shortcut,
   *        needsDoc (default true), run(app) — azione singola
   *        oppure interactive: { activate(app, optionsEl), deactivate(app) } — modalità persistente }
   */
  register(def) {
    if (!def.id || !def.name) throw new Error('Strumento senza id/nome');
    if (this.tools.has(def.id)) console.warn('[tools] id duplicato sostituito:', def.id);
    const acro = ACROBAT_NAMES[def.id];
    this.tools.set(def.id, { needsDoc: true, category: 'avanzati', keywords: '', acrobatName: acro?.[0], ...def, keywords: `${def.keywords || ''} ${acro ? acro.join(' ') : ''}`.trim() });
    this.app.bus.emit('tools:changed');
  }
  list() { return [...this.tools.values()]; }
  get(id) { return this.tools.get(id); }

  async run(id) {
    const t = this.tools.get(id);
    if (!t) return toast('Strumento non disponibile: ' + id, { kind: 'error' });
    if (t.needsDoc && !this.app.activeDoc) return toast('Apri prima un documento PDF', { kind: 'warning' });
    try {
      if (t.interactive) return this.activate(t);
      await t.run(this.app);
    } catch (err) { this.app.reportError(err, t.name); }
  }

  activate(t) {
    if (this.active?.id === t.id) return this.deactivate();
    this.deactivate();
    this.active = t;
    const bar = this.app.el.toolOptions;
    bar.innerHTML = '';
    bar.append(h('div', { class: 'tool-title' }, h('span', { html: icon(t.icon || 'tools', 16) }), t.name));
    const opts = h('div', { class: 'tool-opts' });
    bar.append(opts, h('button', { class: 'btn small', onclick: () => this.deactivate(), title: 'Esc' }, 'Fine'));
    bar.hidden = false;
    t.interactive.activate(this.app, opts);
    this.app.bus.emit('tool:activated', { id: t.id });
    document.querySelectorAll('[data-tool-id]').forEach((b) => b.classList.toggle('active', b.dataset.toolId === t.id));
  }
  deactivate() {
    const t = this.active; if (!t) return;
    this.active = null;
    try { t.interactive.deactivate?.(this.app); } catch (err) { console.error(err); }
    this.app.el.toolOptions.hidden = true;
    this.app.el.toolOptions.innerHTML = '';
    this.app.viewer.setMode('select');
    this.app.bus.emit('tool:deactivated', { id: t.id });
    document.querySelectorAll('[data-tool-id]').forEach((b) => b.classList.remove('active'));
  }

  /** Pannello a tutto schermo con ricerca. */
  openHub({ focusSearch = true } = {}) {
    document.querySelector('.tools-hub')?.remove();
    const search = h('input', { type: 'search', class: 'hub-search', placeholder: 'Cerca uno strumento… (es. unisci, firma, OCR, password)', 'aria-label': 'Cerca strumento' });
    const grid = h('div', { class: 'hub-grid' });
    const close = () => { hub.remove(); document.removeEventListener('keydown', onKey, true); };
    const hub = h('div', { class: 'tools-hub', role: 'dialog', 'aria-label': 'Tutti gli strumenti' },
      h('div', { class: 'hub-inner' },
        h('header', { class: 'hub-head' }, h('h2', {}, 'Tutti gli strumenti'), h('span', { class: 'hub-free' }, 'Tutto incluso, gratis per sempre'), search, h('button', { class: 'icon-btn', 'aria-label': 'Chiudi', onclick: close, html: icon('close') })),
        grid));
    const toolButton = (t) => h('button', { class: 'hub-tool', 'data-tool-id': t.id, onclick: () => { close(); this.run(t.id); } },
      h('span', { class: 'hub-ico', html: icon(t.icon || 'tools', 22) }),
      h('span', { class: 'hub-txt' }, h('strong', {}, t.name, t.acrobatName && t.acrobatName !== t.name ? h('span', { class: 'hub-acro' }, ` (in Acrobat: ${t.acrobatName})`) : null), h('small', {}, t.description || '')));
    let best = null;
    const render = () => {
      const q = search.value.trim();
      grid.innerHTML = '';
      const ranked = rankTools(this.list(), q);
      best = ranked[0] || null;
      if (q && ranked.length) {
        // in cima i migliori della classifica; sotto, le categorie (ordinate per classifica)
        const top = h('section', { class: 'hub-sec hub-best' }, h('h3', {}, 'Risultati migliori'));
        for (const t of ranked.slice(0, 5)) top.append(toolButton(t));
        grid.append(top);
      }
      for (const [cat, catName] of CATEGORIES) {
        const items = ranked.filter((t) => t.category === cat);
        if (!items.length) continue;
        const sec = h('section', { class: 'hub-sec' }, h('h3', {}, catName));
        for (const t of items) sec.append(toolButton(t));
        grid.append(sec);
      }
      if (!grid.children.length) grid.append(h('p', { class: 'muted' }, `Nessuno strumento trovato per «${q}». Prova con un'altra parola (per esempio «unisci», «comprimi», «firma»); alcune funzioni potrebbero non essere ancora disponibili.`));
      return grid.querySelector('.hub-tool');
    };
    search.addEventListener('input', render);
    // Invio apre il primo della classifica
    search.addEventListener('keydown', (e) => { if (e.key === 'Enter' && best) { e.preventDefault(); close(); this.run(best.id); } });
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
    document.addEventListener('keydown', onKey, true);
    render();
    document.getElementById('overlay-root').append(hub);
    if (focusSearch) search.focus();
  }
}
