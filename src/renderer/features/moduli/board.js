// "Tavolo" di elementi posizionati sulle pagine (testi, segni, firme, campi): selezione, spostamento,
// ridimensionamento, eliminazione. Il modello è in coordinate PDF; il DOM viene ricreato a ogni rendering.

let boardSeq = 0;

/**
 * Rettangolo PDF → riquadro CSS nella pagina. Non usa viewer.pdfRectToCss perché in pdf.js 6
 * PageViewport non ha più convertToViewportRectangle (segnalato al nucleo).
 */
export function rectToCss(viewer, pageIndex, rect) {
  const vp = viewer.getViewport(pageIndex);
  if (!vp) throw new Error('pagina non pronta');
  const [ax, ay] = vp.convertToViewportPoint(rect[0], rect[1]);
  const [bx, by] = vp.convertToViewportPoint(rect[2], rect[3]);
  return { left: Math.min(ax, bx), top: Math.min(ay, by), width: Math.abs(bx - ax), height: Math.abs(by - ay) };
}

export class Board {
  /**
   * opts: {
   *   renderItem(el, item, { scale, selected }) — riempie l'elemento,
   *   onEmptyPointer(pageIndex, pdfPoint, event) — clic su zona vuota (ritorna true se ha gestito),
   *   onSelect(item|null), onChange(item), onDelete(item),
   *   keepAspect(item) → bool, minSize (punti), className
   * }
   */
  constructor(app, opts = {}) {
    this.app = app; this.opts = opts;
    this.id = 'b' + (++boardSeq);
    this.items = [];
    this.selected = null;
    this.off = [];
    this.attached = false;
  }

  attach() {
    if (this.attached) return;
    this.attached = true;
    this.off.push(this.app.bus.on('page:rendered', ({ pageIndex }) => this.drawPage(pageIndex)));
    this.onPointer = (e) => this.#pointerDown(e);
    this.onKey = (e) => this.#key(e);
    this.app.viewer.container.addEventListener('pointerdown', this.onPointer, true);
    document.addEventListener('keydown', this.onKey);
    this.redrawAll();
  }
  detach() {
    if (!this.attached) return;
    this.attached = false;
    this.off.forEach((f) => f?.()); this.off = [];
    this.app.viewer.container.removeEventListener('pointerdown', this.onPointer, true);
    document.removeEventListener('keydown', this.onKey);
    document.querySelectorAll(`.mod-layer[data-board="${this.id}"]`).forEach((l) => l.remove());
  }

  add(item, { select = true } = {}) {
    item.id ||= 'i' + Math.random().toString(36).slice(2, 9);
    this.items.push(item);
    if (select) this.selected = item;
    this.drawPage(item.pageIndex);
    if (select) this.opts.onSelect?.(item);
    return item;
  }
  remove(item) {
    const i = this.items.indexOf(item); if (i < 0) return;
    this.items.splice(i, 1);
    if (this.selected === item) { this.selected = null; this.opts.onSelect?.(null); }
    this.drawPage(item.pageIndex);
    this.opts.onDelete?.(item);
  }
  clear() { const pages = new Set(this.items.map((i) => i.pageIndex)); this.items = []; this.selected = null; pages.forEach((p) => this.drawPage(p)); }
  select(item) { const prev = this.selected; this.selected = item; if (prev) this.drawPage(prev.pageIndex); if (item && item !== prev) this.drawPage(item.pageIndex); this.opts.onSelect?.(item); }
  update(item) { this.drawPage(item.pageIndex); this.opts.onChange?.(item); }

  redrawAll() {
    const pv = this.app.viewer.pdfViewer;
    const n = pv.pagesCount || 0;
    for (let i = 0; i < n; i++) { const v = pv.getPageView(i); if (v && v.div && v.div.querySelector('canvas')) this.drawPage(i); }
  }

  /** Elemento DOM di un elemento (se la sua pagina è visualizzata). */
  elementOf(item) { return document.querySelector(`.mod-layer[data-board="${this.id}"] [data-item="${item.id}"]`); }

  drawPage(pageIndex) {
    if (!this.attached) return;
    const viewer = this.app.viewer;
    const ov = viewer.getOverlay(pageIndex);
    if (!ov) return;
    let layer = ov.querySelector(`:scope > .mod-layer[data-board="${this.id}"]`);
    if (!layer) { layer = document.createElement('div'); layer.className = 'mod-layer ' + (this.opts.className || ''); layer.dataset.board = this.id; ov.append(layer); }
    layer.textContent = '';
    const vp = viewer.getViewport(pageIndex); if (!vp) return;
    const items = this.items.filter((i) => i.pageIndex === pageIndex);
    // per moduli con molti campi si crea un frammento unico
    const frag = document.createDocumentFragment();
    for (const item of items) {
      let css;
      try { css = rectToCss(viewer, pageIndex, item.rect); } catch { continue; }
      const el = document.createElement('div');
      el.className = 'mod-item' + (item === this.selected ? ' selected' : '') + (item.cls ? ' ' + item.cls : '');
      el.dataset.item = item.id;
      Object.assign(el.style, { left: css.left + 'px', top: css.top + 'px', width: css.width + 'px', height: css.height + 'px' });
      try { this.opts.renderItem?.(el, item, { scale: vp.scale, selected: item === this.selected, css }); } catch (err) { console.error('[moduli] disegno elemento', err); }
      if (item === this.selected && !item.locked) {
        for (const c of ['nw', 'ne', 'sw', 'se']) { const hnd = document.createElement('span'); hnd.className = 'mod-handle ' + c; hnd.dataset.handle = c; el.append(hnd); }
        const del = document.createElement('button');
        del.className = 'mod-del'; del.type = 'button'; del.title = 'Elimina (Canc)'; del.setAttribute('aria-label', 'Elimina'); del.textContent = '×';
        del.dataset.del = '1';
        el.append(del);
      }
      frag.append(el);
    }
    layer.append(frag);
  }

  #pageIndexOf(target) {
    const ov = target.closest?.('.leggio-overlay');
    return ov ? +ov.dataset.pageIndex : -1;
  }

  #pointerDown(e) {
    if (e.button !== 0) return;
    const pageIndex = this.#pageIndexOf(e.target);
    if (pageIndex < 0) return;
    const itemEl = e.target.closest('.mod-item');
    const inMyLayer = itemEl && itemEl.closest(`.mod-layer[data-board="${this.id}"]`);
    if (inMyLayer) {
      const item = this.items.find((i) => i.id === itemEl.dataset.item);
      if (!item) return;
      if (e.target.dataset.del) { e.preventDefault(); e.stopPropagation(); this.remove(item); return; }
      if (e.target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return; // modifica del testo
      e.preventDefault(); e.stopPropagation();
      if (this.selected !== item) this.select(item);
      if (item.locked) return;
      this.#drag(e, item, e.target.dataset.handle || null, pageIndex);
      return;
    }
    if (this.app.viewer.mode !== 'tool') return;
    const pt = this.app.viewer.clientToPdf(pageIndex, e.clientX, e.clientY);
    if (!pt) return;
    if (this.selected && document.activeElement?.isContentEditable) { document.activeElement.blur(); }
    const handled = this.opts.onEmptyPointer?.(pageIndex, pt, e);
    if (handled) { e.preventDefault(); e.stopPropagation(); }
    else if (this.selected) this.select(null);
  }

  #drag(e, item, handle, pageIndex) {
    const viewer = this.app.viewer;
    const start = viewer.clientToPdf(pageIndex, e.clientX, e.clientY);
    const orig = item.rect.slice();
    const [x1, y1, x2, y2] = [Math.min(orig[0], orig[2]), Math.min(orig[1], orig[3]), Math.max(orig[0], orig[2]), Math.max(orig[1], orig[3])];
    // angolo fisso opposto alla maniglia, calcolato nello spazio dello schermo (gestisce la rotazione)
    let fixed = null;
    if (handle) {
      const el = this.elementOf(item); const r = el.getBoundingClientRect();
      const fx = handle.includes('w') ? r.right : r.left; const fy = handle.includes('n') ? r.bottom : r.top;
      fixed = viewer.clientToPdf(pageIndex, fx, fy);
    }
    const aspect = (x2 - x1) / Math.max(0.01, y2 - y1);
    const keep = this.opts.keepAspect?.(item) && !e.shiftKey;
    const min = this.opts.minSize ?? 6;
    const page = this.opts.pageBox?.(pageIndex);
    let moved = false;
    const move = (ev) => {
      const p = viewer.clientToPdf(pageIndex, ev.clientX, ev.clientY);
      if (!p) return;
      moved = true;
      if (!handle) {
        let dx = p[0] - start[0]; let dy = p[1] - start[1];
        if (page) { dx = Math.max(page[0] - x1, Math.min(page[2] - x2, dx)); dy = Math.max(page[1] - y1, Math.min(page[3] - y2, dy)); }
        item.rect = [x1 + dx, y1 + dy, x2 + dx, y2 + dy];
      } else {
        let nx = p[0]; let ny = p[1];
        let w = Math.max(min, Math.abs(nx - fixed[0])); let hgt = Math.max(min, Math.abs(ny - fixed[1]));
        if (keep) { if (w / hgt > aspect) hgt = w / aspect; else w = hgt * aspect; }
        const sx = nx >= fixed[0] ? 1 : -1; const sy = ny >= fixed[1] ? 1 : -1;
        nx = fixed[0] + sx * w; ny = fixed[1] + sy * hgt;
        item.rect = [Math.min(fixed[0], nx), Math.min(fixed[1], ny), Math.max(fixed[0], nx), Math.max(fixed[1], ny)];
      }
      // aggiorna solo lo stile per fluidità
      const el = this.elementOf(item);
      if (el) { const css = rectToCss(viewer, pageIndex, item.rect); Object.assign(el.style, { left: css.left + 'px', top: css.top + 'px', width: css.width + 'px', height: css.height + 'px' }); }
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      if (moved) { this.drawPage(pageIndex); this.opts.onChange?.(item); }
      else this.opts.onClickItem?.(item);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }

  #key(e) {
    if (!this.selected) return;
    const t = e.target;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    if ((e.key === 'Delete' || e.key === 'Backspace') && !this.selected.locked) { e.preventDefault(); this.remove(this.selected); return; }
    const step = e.shiftKey ? 10 : 1;
    const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] }[e.key];
    if (d && !this.selected.locked) {
      e.preventDefault();
      const r = this.selected.rect; this.selected.rect = [r[0] + d[0], r[1] + d[1], r[2] + d[0], r[3] + d[1]];
      this.update(this.selected);
    }
  }
}
