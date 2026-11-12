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
      const b = h('button', { class: 'rail-btn' + (this.current === p.id ? ' active' : ''), title: p.title, 'aria-label': p.title, 'aria-pressed': String(this.current === p.id), onclick: () => this.toggle(p.id), html: icon(p.icon, 20) });
      // etichetta breve sotto l'icona (Impostazioni › «Mostra i nomi sotto le icone»); def.railLabel per sceglierla
      b.append(h('span', { class: 'rail-label', 'aria-hidden': 'true' }, p.railLabel || railLabel(p.title)));
      this.rail.append(b);
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

/**
 * Pannello Miniature: selezione multipla, trascina per riordinare, menu contestuale estendibile.
 * Pensato per documenti di migliaia di pagine: gli elementi sono leggeri (nessun canvas finché
 * non sono vicini alla vista), gli eventi sono delegati alla griglia, i canvas lontani vengono
 * rilasciati (al massimo MAX_LIVE vivi) e i rendering non più necessari annullati.
 */
const THUMB_W = 150;
const MAX_LIVE = 60;
export function thumbnailsPanel(app) {
  return {
    id: 'thumbs', title: 'Pagine', icon: 'pages', order: 10,
    render(c) {
      const doc = app.activeDoc;
      const pdf = doc.pdf;
      const n = doc.pageCount;
      const grid = h('div', { class: 'thumbs', role: 'listbox', 'aria-multiselectable': 'true', 'aria-label': 'Miniature delle pagine' });
      c.append(grid);
      const selected = new Set([app.viewer.pageIndex]);
      let anchor = app.viewer.pageIndex;
      let current = app.viewer.pageIndex;
      let disposed = false;
      const items = new Array(n);
      const live = new Map(); // indice → { canvas, task, page }
      // proporzione stimata dalla pagina corrente della vista (o 1:√2), corretta quando la pagina viene disegnata
      let ratio = 1.414;
      const pv0 = app.viewer.pdfViewer.getPageView?.(0);
      if (pv0?.viewport) ratio = pv0.viewport.height / pv0.viewport.width;

      const frag = document.createDocumentFragment();
      for (let i = 0; i < n; i++) {
        const box = h('div', { class: 'thumb-page', style: { aspectRatio: `1 / ${ratio}` } });
        const el = h('div', { class: 'thumb', 'data-i': i, role: 'option', tabindex: -1, draggable: 'true', title: `Pagina ${i + 1}`, 'aria-label': `Pagina ${i + 1}` },
          box, h('span', { class: 'thumb-num' }, String(i + 1)));
        items[i] = el; frag.append(el);
      }
      grid.append(frag);
      const idx = (e) => { const el = e.target.closest?.('.thumb'); return el && grid.contains(el) ? +el.dataset.i : -1; };
      const setSel = (i, on) => { const el = items[i]; if (!el) return; el.classList.toggle('selected', on); el.setAttribute('aria-selected', String(on)); };
      const sync = (prev) => { for (const i of prev || []) setSel(i, false); for (const i of selected) setSel(i, true); };
      const select = (fn) => { const prev = [...selected]; fn(); sync(prev); };
      const focusItem = (i) => { const el = items[i]; if (!el) return; for (const x of grid.querySelectorAll('.thumb[tabindex="0"]')) x.tabIndex = -1; el.tabIndex = 0; el.focus({ preventScroll: false }); };
      items[current] && (items[current].tabIndex = 0);

      // --- disegno pigro ---
      async function draw(i) {
        if (live.has(i) || disposed) return;
        const box = items[i].firstChild;
        const rec = { canvas: null, task: null, page: null, cancelled: false };
        live.set(i, rec);
        enforceCap(i);
        try {
          const page = await pdf.getPage(i + 1);
          if (rec.cancelled || disposed) return;
          rec.page = page;
          const vp0 = page.getViewport({ scale: 1 });
          const r = vp0.height / vp0.width;
          box.style.aspectRatio = `1 / ${r}`;
          // pagine estreme (es. 5 m di lunghezza): si limita l'altezza in pixel della miniatura
          const scale = Math.min((THUMB_W / vp0.width) * Math.min(devicePixelRatio || 1, 2), 1200 / vp0.height);
          const vp = page.getViewport({ scale });
          const cv = document.createElement('canvas');
          cv.width = Math.max(1, Math.round(vp.width)); cv.height = Math.max(1, Math.round(vp.height));
          rec.canvas = cv;
          rec.task = page.render({ canvasContext: cv.getContext('2d', { alpha: false }), canvas: cv, viewport: vp, background: '#fff' });
          await rec.task.promise;
          if (rec.cancelled || disposed) return;
          box.replaceChildren(cv);
        } catch (err) {
          if (err?.name !== 'RenderingCancelledException' && !rec.cancelled) box.classList.add('thumb-error');
        } finally { rec.task = null; }
      }
      function release(i) {
        const rec = live.get(i); if (!rec) return;
        live.delete(i);
        rec.cancelled = true;
        try { rec.task?.cancel(); } catch { /* */ }
        if (rec.canvas) { rec.canvas.width = 0; rec.canvas.height = 0; }
        items[i]?.firstChild?.replaceChildren();
        // libera le strutture interne della pagina se la vista principale non la sta usando
        try { rec.page?.cleanup(); } catch { /* rendering in corso: pdf.js rifiuta, va bene */ }
      }
      function enforceCap(keep) {
        if (live.size <= MAX_LIVE) return;
        // si rilasciano i più lontani dalla miniatura appena richiesta
        const far = [...live.keys()].filter((k) => k !== keep).sort((a, b) => Math.abs(b - keep) - Math.abs(a - keep));
        for (const k of far.slice(0, live.size - MAX_LIVE)) release(k);
      }
      const io = new IntersectionObserver((entries) => {
        for (const e of entries) { const i = +e.target.dataset.i; if (e.isIntersecting) draw(i); else release(i); }
      }, { root: c, rootMargin: '600px 0px' });
      for (const el of items) io.observe(el);

      // --- eventi delegati ---
      grid.addEventListener('click', (e) => {
        const i = idx(e); if (i < 0) return;
        select(() => {
          if (e.shiftKey) { selected.clear(); const [a, b] = [Math.min(anchor, i), Math.max(anchor, i)]; for (let k = a; k <= b; k++) selected.add(k); }
          else if (e.metaKey || e.ctrlKey) { selected.has(i) ? selected.delete(i) : selected.add(i); anchor = i; }
          else { selected.clear(); selected.add(i); anchor = i; app.viewer.page = i + 1; }
        });
        focusItem(i);
      });
      grid.addEventListener('keydown', (e) => {
        const i = idx(e); if (i < 0) return;
        const go = (j) => { if (j < 0 || j >= n) return; e.preventDefault(); select(() => { selected.clear(); selected.add(j); anchor = j; }); app.viewer.page = j + 1; focusItem(j); };
        if (e.key === 'ArrowDown' || e.key === 'ArrowRight') go(i + 1);
        else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') go(i - 1);
        else if (e.key === 'Home') go(0);
        else if (e.key === 'End') go(n - 1);
        else if (e.key === 'Delete' || e.key === 'Backspace') { const del = app.sidebar.pageActions.find((a) => a.id === 'delete-pages'); if (del) { e.preventDefault(); del.run(app, [...selected].sort((a, b) => a - b)); } }
      });
      grid.addEventListener('contextmenu', (e) => {
        const i = idx(e); if (i < 0) return;
        e.preventDefault();
        if (!selected.has(i)) select(() => { selected.clear(); selected.add(i); anchor = i; });
        const sel = [...selected].sort((a, b) => a - b);
        const acts = app.sidebar.pageActions.map((a) => ({ label: a.label, icon: a.icon, danger: a.danger, run: () => a.run(app, sel) }));
        contextMenu(e.clientX, e.clientY, [
          { label: 'Vai alla pagina', icon: 'chevronRight', run: () => (app.viewer.page = i + 1) },
          ...(acts.length ? ['-', ...acts] : []),
        ]);
      });
      // trascina per riordinare
      let overEl = null;
      const clearDrop = () => { overEl?.classList.remove('drop-before', 'drop-after'); overEl = null; };
      grid.addEventListener('dragstart', (e) => {
        const i = idx(e); if (i < 0) return;
        if (!selected.has(i)) select(() => { selected.clear(); selected.add(i); anchor = i; });
        e.dataTransfer.setData('text/x-leggio-pages', JSON.stringify([...selected]));
        e.dataTransfer.effectAllowed = 'move';
      });
      grid.addEventListener('dragover', (e) => {
        if (!e.dataTransfer.types.includes('text/x-leggio-pages')) return;
        const i = idx(e); if (i < 0) return;
        e.preventDefault();
        const el = items[i]; if (overEl !== el) clearDrop(); overEl = el;
        const r = el.getBoundingClientRect(); const before = e.clientY < r.top + r.height / 2;
        el.classList.toggle('drop-before', before); el.classList.toggle('drop-after', !before);
      });
      grid.addEventListener('dragleave', (e) => { if (!grid.contains(e.relatedTarget)) clearDrop(); });
      grid.addEventListener('drop', async (e) => {
        const i = idx(e); if (i < 0 || !e.dataTransfer.types.includes('text/x-leggio-pages')) return;
        e.preventDefault();
        const after = items[i].classList.contains('drop-after');
        clearDrop();
        let moving = [];
        try { moving = JSON.parse(e.dataTransfer.getData('text/x-leggio-pages') || '[]').filter((k) => Number.isInteger(k) && k >= 0 && k < n); } catch { moving = []; }
        if (moving.length) await app.movePages(moving, after ? i + 1 : i);
      });

      sync();
      const markCurrent = (pageIndex) => {
        items[current]?.classList.remove('current');
        current = pageIndex;
        items[current]?.classList.add('current');
      };
      const off = app.bus.on('page:changed', ({ pageIndex }) => { markCurrent(pageIndex); items[pageIndex]?.scrollIntoView({ block: 'nearest' }); });
      markCurrent(current);
      requestAnimationFrame(() => items[current]?.scrollIntoView({ block: 'center' }));
      return () => {
        disposed = true; off(); io.disconnect();
        for (const k of [...live.keys()]) release(k);
      };
    },
  };
}

/** Pannello Segnalibri: struttura (outline) del PDF. I livelli profondi partono chiusi e vengono
 * costruiti solo quando si aprono (outline enormi o molto annidati restano leggeri). */
export function outlinePanel(app) {
  return {
    id: 'outline', title: 'Segnalibri', icon: 'bookmark', order: 20,
    render(c) {
      const doc = app.activeDoc;
      let alive = true;
      doc.pdf.getOutline().then((outline) => {
        if (!alive) return;
        if (!outline?.length) { c.append(h('p', { class: 'muted pad' }, 'Questo documento non ha segnalibri.')); return; }
        const build = (items, depth) => h('ul', { class: 'outline' }, items.slice(0, 5000).map((it) => {
          const hasKids = it.items?.length;
          const open = hasKids && depth < 1;
          const li = h('li', { class: hasKids ? 'has-kids' + (open ? ' open' : '') : '' });
          let built = false;
          const ensureKids = () => { if (!built && hasKids) { built = true; li.append(build(it.items, depth + 1)); } };
          const row = h('div', { class: 'outline-row' },
            hasKids ? h('button', { class: 'twisty', 'aria-label': 'Espandi/comprimi', 'aria-expanded': String(!!open), onclick: (e) => { ensureKids(); const o = li.classList.toggle('open'); e.currentTarget.setAttribute('aria-expanded', String(o)); }, html: icon('chevronDown', 14) }) : h('span', { class: 'twisty-sp' }),
            h('button', { class: 'outline-link', style: { fontWeight: it.bold ? '600' : null, fontStyle: it.italic ? 'italic' : null }, onclick: () => (it.dest ? app.viewer.goToDestination(it.dest)?.catch?.(() => {}) : it.url && app.platform.openExternal(it.url)) }, String(it.title ?? '').slice(0, 500) || '(senza titolo)'));
          li.append(row);
          if (open) ensureKids();
          return li;
        }));
        c.append(build(outline, 0));
      }).catch((err) => { if (alive) c.append(h('p', { class: 'muted pad' }, 'Impossibile leggere i segnalibri di questo documento.')); console.warn('outline', err); });
      return () => { alive = false; };
    },
  };
}

/** Etichetta breve per la colonna dei pannelli: il titolo, accorciato alle prime due parole significative. */
export function railLabel(title) {
  const w = String(title || '').replace(/\s*\(.*\)\s*$/, '').split(/\s+/).filter(Boolean);
  if (w.join(' ').length <= 12) return w.join(' ');
  const keep = w.filter((x, i) => i === 0 || !/^(il|lo|la|i|gli|le|un|una|di|del|della|dei|delle|e|in|da|con|per|a|al|alla)$/i.test(x));
  return keep.slice(0, 2).join(' ');
}
