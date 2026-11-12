// Barra laterale con pannelli registrabili. Pannelli di base: Miniature e Segnalibri (struttura).
import { h, contextMenu } from './ui.js';
import { icon } from './icons.js';

export class Sidebar {
  constructor(app, railEl, bodyEl) {
    this.app = app; this.rail = railEl; this.body = bodyEl;
    this.panels = new Map(); this.current = null;
    this.pageActions = []; // azioni nel menu contestuale delle miniature
  }

  /** def: { id, title, icon, order, render(container, app) → opzionale cleanup(); onDocument?(doc) } */
  registerPanel(def) { this.panels.set(def.id, { order: 50, ...def }); this.#renderRail(); }

  /** Azione nel menu contestuale delle miniature. def: { label, icon, run(app, pageIndices), danger, group } */
  registerPageAction(def) { this.pageActions.push(def); }

  #renderRail() {
    this.rail.innerHTML = '';
    for (const p of [...this.panels.values()].sort((a, b) => a.order - b.order)) {
      this.rail.append(h('button', { class: 'rail-btn' + (this.current === p.id ? ' active' : ''), title: p.title, 'aria-label': p.title, 'aria-pressed': String(this.current === p.id), onclick: () => this.toggle(p.id), html: icon(p.icon, 20) }));
    }
  }

  toggle(id) { if (this.current === id && !this.app.el.root.classList.contains('sidebar-closed')) this.close(); else this.show(id); }
  show(id) {
    const p = this.panels.get(id); if (!p) return;
    this.cleanup?.(); this.cleanup = null;
    this.current = id;
    this.app.el.root.classList.remove('sidebar-closed');
    this.body.innerHTML = '';
    this.body.append(h('header', { class: 'side-head' }, h('h2', {}, p.title)));
    const c = h('div', { class: 'side-content' }); this.body.append(c);
    if (!this.app.activeDoc && p.needsDoc !== false) c.append(h('p', { class: 'muted pad' }, 'Nessun documento aperto.'));
    else this.cleanup = p.render(c, this.app) || null;
    this.#renderRail();
    this.app.settings.set('sidebarPanel', id);
  }
  close() { this.app.el.root.classList.add('sidebar-closed'); this.#renderRail(); this.app.settings.set('sidebarPanel', null); }
  refresh() { if (this.current && !this.app.el.root.classList.contains('sidebar-closed')) this.show(this.current); }
}

/** Pannello Miniature: selezione multipla, trascina per riordinare, menu contestuale estendibile. */
export function thumbnailsPanel(app) {
  return {
    id: 'thumbs', title: 'Pagine', icon: 'pages', order: 10,
    render(c) {
      const doc = app.activeDoc;
      const grid = h('div', { class: 'thumbs', role: 'listbox', 'aria-multiselectable': 'true', 'aria-label': 'Miniature delle pagine' });
      c.append(grid);
      const selected = new Set([app.viewer.pageIndex]);
      let anchor = app.viewer.pageIndex;
      const items = [];
      const io = new IntersectionObserver((entries) => {
        for (const e of entries) if (e.isIntersecting) { io.unobserve(e.target); drawThumb(e.target); }
      }, { root: c, rootMargin: '300px' });
      async function drawThumb(el) {
        const i = +el.dataset.i;
        try {
          const page = await doc.pdf.getPage(i + 1);
          const vp0 = page.getViewport({ scale: 1 });
          const scale = 150 / vp0.width;
          const vp = page.getViewport({ scale: scale * devicePixelRatio });
          const cv = el.querySelector('canvas');
          cv.width = vp.width; cv.height = vp.height;
          cv.style.aspectRatio = `${vp.width} / ${vp.height}`;
          await page.render({ canvasContext: cv.getContext('2d'), canvas: cv, viewport: vp }).promise;
        } catch {}
      }
      const sync = () => items.forEach((el, i) => { el.classList.toggle('selected', selected.has(i)); el.setAttribute('aria-selected', String(selected.has(i))); });
      for (let i = 0; i < doc.pageCount; i++) {
        const el = h('div', { class: 'thumb', 'data-i': i, role: 'option', tabindex: 0, draggable: 'true', title: `Pagina ${i + 1}` },
          h('canvas', { width: 150, height: 200 }), h('span', { class: 'thumb-num' }, String(i + 1)));
        el.addEventListener('click', (e) => {
          if (e.shiftKey) { selected.clear(); const [a, b] = [Math.min(anchor, i), Math.max(anchor, i)]; for (let k = a; k <= b; k++) selected.add(k); }
          else if (e.metaKey || e.ctrlKey) { selected.has(i) ? selected.delete(i) : selected.add(i); anchor = i; }
          else { selected.clear(); selected.add(i); anchor = i; app.viewer.page = i + 1; }
          sync();
        });
        el.addEventListener('keydown', (e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowRight') { e.preventDefault(); items[i + 1]?.focus(); items[i + 1]?.click(); }
          if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') { e.preventDefault(); items[i - 1]?.focus(); items[i - 1]?.click(); }
          if (e.key === 'Delete' || e.key === 'Backspace') { const del = app.sidebar.pageActions.find((a) => a.id === 'delete-pages'); if (del) del.run(app, [...selected]); }
        });
        el.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          if (!selected.has(i)) { selected.clear(); selected.add(i); anchor = i; sync(); }
          const sel = [...selected].sort((a, b) => a - b);
          const acts = app.sidebar.pageActions.map((a) => ({ label: a.label, icon: a.icon, danger: a.danger, run: () => a.run(app, sel) }));
          contextMenu(e.clientX, e.clientY, [
            { label: 'Vai alla pagina', icon: 'chevronRight', run: () => (app.viewer.page = i + 1) },
            ...(acts.length ? ['-', ...acts] : []),
          ]);
        });
        // trascina per riordinare
        el.addEventListener('dragstart', (e) => { if (!selected.has(i)) { selected.clear(); selected.add(i); sync(); } e.dataTransfer.setData('text/x-leggio-pages', JSON.stringify([...selected])); e.dataTransfer.effectAllowed = 'move'; });
        el.addEventListener('dragover', (e) => { if (e.dataTransfer.types.includes('text/x-leggio-pages')) { e.preventDefault(); const r = el.getBoundingClientRect(); el.classList.toggle('drop-before', e.clientY < r.top + r.height / 2); el.classList.toggle('drop-after', e.clientY >= r.top + r.height / 2); } });
        el.addEventListener('dragleave', () => el.classList.remove('drop-before', 'drop-after'));
        el.addEventListener('drop', async (e) => {
          e.preventDefault();
          const after = el.classList.contains('drop-after');
          el.classList.remove('drop-before', 'drop-after');
          const moving = JSON.parse(e.dataTransfer.getData('text/x-leggio-pages') || '[]');
          await app.movePages(moving, after ? i + 1 : i);
        });
        items.push(el); grid.append(el); io.observe(el);
      }
      sync();
      const off = app.bus.on('page:changed', ({ pageIndex }) => {
        items.forEach((el, k) => el.classList.toggle('current', k === pageIndex));
        items[pageIndex]?.scrollIntoView({ block: 'nearest' });
      });
      items[app.viewer.pageIndex]?.classList.add('current');
      requestAnimationFrame(() => items[app.viewer.pageIndex]?.scrollIntoView({ block: 'center' }));
      return () => { off(); io.disconnect(); };
    },
  };
}

/** Pannello Segnalibri: struttura (outline) del PDF. */
export function outlinePanel(app) {
  return {
    id: 'outline', title: 'Segnalibri', icon: 'bookmark', order: 20,
    render(c) {
      const doc = app.activeDoc;
      doc.pdf.getOutline().then((outline) => {
        if (!outline?.length) { c.append(h('p', { class: 'muted pad' }, 'Questo documento non ha segnalibri.')); return; }
        const build = (items) => h('ul', { class: 'outline' }, items.map((it) => {
          const hasKids = it.items?.length;
          const li = h('li', { class: hasKids ? 'has-kids open' : '' });
          const row = h('div', { class: 'outline-row' },
            hasKids ? h('button', { class: 'twisty', 'aria-label': 'Espandi/comprimi', onclick: () => li.classList.toggle('open'), html: icon('chevronDown', 14) }) : h('span', { class: 'twisty-sp' }),
            h('button', { class: 'outline-link', style: { fontWeight: it.bold ? '600' : null, fontStyle: it.italic ? 'italic' : null }, onclick: () => (it.dest ? app.viewer.goToDestination(it.dest) : it.url && app.platform.openExternal(it.url)) }, it.title));
          li.append(row);
          if (hasKids) li.append(build(it.items));
          return li;
        }));
        c.append(build(outline));
      });
    },
  };
}
