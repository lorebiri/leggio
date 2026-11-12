// «Compila e firma» e «Firma»: clic ovunque per scrivere, segni ✓ ✗ ●, data, iniziali, firma grafica, dati del profilo.
// Gli elementi restano modificabili finché lo strumento è aperto; alla chiusura (o con «Applica») vengono scritti nella pagina.
import { Board, rectToCss } from './board.js';
import { placement, localToPdf, todayIt, initialsOf, fitRectInPage, winAnsiSafe } from './lib/geom.js';
import { textItemsFromPdfjs } from './lib/detect.js';
import { PROFILE_FIELDS } from './lib/store.js';
import { createSignatureDialog } from './sigpad.js';
import { editProfileDialog } from './profile.js';

const MARKS = {
  check: 'M16 54 L40 78 L86 24',
  cross: 'M22 22 L78 78 M78 22 L22 78',
};
const LINE_H = 1.2; const BASELINE = 0.946; // metriche di Helvetica/Arial con interlinea 1,2

function dataUrlToBytes(u) { const b = atob(u.split(',')[1] || ''); const a = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) a[i] = b.charCodeAt(i); return a; }
function hexToRgb(PDFLib, hex) { const n = parseInt(String(hex).replace('#', ''), 16) || 0; return PDFLib.rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255); }

export class FillSignSession {
  constructor(app, store, { mode = 'fill' } = {}) {
    this.app = app; this.store = store; this.mode = mode;
    this.tool = mode === 'sign' ? 'select' : 'text';
    this.color = /^#[0-9a-f]{6}$/i.test(store.getPref('color', '')) ? store.getPref('color') : '#111111';
    this.size = Math.max(6, Math.min(72, Number(store.getPref('size', 12)) || 12));
    this.pendingText = null;
    this.textCache = new Map();
    this.doc = app.activeDoc;
    this.board = new Board(app, {
      className: 'mod-fill',
      renderItem: (el, item, ctx) => this.#render(el, item, ctx),
      onEmptyPointer: (pi, pt, e) => this.#place(pi, pt, e),
      onSelect: () => this.#syncBar(),
      onChange: () => {},
      keepAspect: (item) => item.kind === 'image' || item.kind === 'check' || item.kind === 'cross' || item.kind === 'dot',
      pageBox: (pi) => this.#pageBox(pi),
      onClickItem: (item) => { if (item.kind === 'text') this.#focusText(item); },
    });
  }

  // ------------------------------------------------------------------ ciclo di vita
  activate(optionsEl) {
    this.optionsEl = optionsEl;
    this.app.viewer.setMode('tool', this.tool === 'text' ? 'text' : 'crosshair');
    this.board.attach();
    this.#buildBar();
    this.offDoc = this.app.bus.on('document:activated', () => this.app.tools.deactivate());
  }
  async deactivate() {
    this.offDoc?.();
    const pending = this.board.items.filter((i) => !(i.kind === 'text' && !i.text.trim()));
    const doc = this.doc;
    this.board.detach();
    if (pending.length && doc && this.app.docs.includes(doc)) {
      try { await this.apply(pending, doc); }
      catch (err) { this.app.reportError(err, 'Non è stato possibile scrivere gli elementi nella pagina'); }
    }
  }

  // ------------------------------------------------------------------ barra opzioni
  #buildBar() {
    const { h } = this.app.ui;
    const el = this.optionsEl; el.textContent = '';
    const tb = (tool, label, title, extra = {}) => h('button', { type: 'button', class: 'btn small mod-tbtn' + (this.tool === tool ? ' on' : ''), 'data-tool': tool, title, 'aria-pressed': String(this.tool === tool), onclick: () => this.setTool(tool), ...extra }, label);
    // firma in due clic: il pulsante mette subito l'ultima firma salvata (o la fa creare); la freccia apre l'elenco
    const split = (kind, label, title) => h('span', { class: 'mod-split' + (kind === 'signature' ? ' primary' : '') },
      h('button', { type: 'button', class: 'btn small' + (kind === 'signature' ? ' primary' : ''), title, onclick: () => this.quickSign(kind) }, label),
      h('button', { type: 'button', class: 'btn small mod-split-arrow' + (kind === 'signature' ? ' primary' : ''), title: 'Scegli tra le firme salvate o creane una nuova', 'aria-label': 'Altre firme', onclick: (e) => this.signatureMenu(e.currentTarget, kind) }, '▾'));
    const sigBtn = split('signature', '✍ Firma', 'Aggiungi la tua firma: compare sulla pagina, trascinala dove serve');
    const iniBtn = split('initials', 'Iniziali', 'Aggiungi le iniziali (sigla)');
    const profBtn = h('button', { type: 'button', class: 'btn small', title: 'Inserisci un dato del tuo profilo (nome, codice fiscale, ufficio…)', onclick: (e) => this.profileMenu(e.currentTarget) }, 'Dati personali ▾');
    const sizeOut = h('span', { class: 'mod-size', 'aria-live': 'polite' }, this.size + ' pt');
    const setSize = (d) => {
      const sel = this.board.selected;
      if (sel?.kind === 'text') { sel.size = Math.max(6, Math.min(72, sel.size + d)); this.size = sel.size; this.#fitText(sel); this.board.update(sel); }
      else this.size = Math.max(6, Math.min(72, this.size + d));
      this.store.setPref('size', this.size); sizeOut.textContent = (sel?.kind === 'text' ? sel.size : this.size) + ' pt';
    };
    const colors = h('span', { class: 'mod-colors' }, [['#111111', 'Nero'], ['#1d3f9a', 'Blu'], ['#b42318', 'Rosso']].map(([c, l]) => h('button', { type: 'button', class: 'mod-color' + (c === this.color ? ' on' : ''), title: l, 'aria-label': 'Colore ' + l, style: { background: c }, onclick: (e) => {
      this.color = c; this.store.setPref('color', c);
      el.querySelectorAll('.mod-color').forEach((b) => b.classList.toggle('on', b === e.currentTarget));
      const sel = this.board.selected; if (sel && sel.kind !== 'image') { sel.color = c; this.board.update(sel); }
    } })));
    el.append(
      tb('text', 'Ab Testo', 'Clic sulla pagina per scrivere (T)'),
      tb('check', '✓', 'Segno di spunta: clic dove serve'),
      tb('cross', '✗', 'Croce: clic dove serve'),
      tb('dot', '●', 'Pallino: clic dove serve'),
      tb('date', 'Data', 'Data di oggi: clic dove serve'),
      h('span', { class: 'tb-sep' }),
      sigBtn, iniBtn, profBtn,
      h('span', { class: 'tb-sep' }),
      h('button', { type: 'button', class: 'btn small', title: 'Testo più piccolo', 'aria-label': 'Testo più piccolo', onclick: () => setSize(-1) }, 'A−'), sizeOut,
      h('button', { type: 'button', class: 'btn small', title: 'Testo più grande', 'aria-label': 'Testo più grande', onclick: () => setSize(1) }, 'A+'),
      colors,
      h('span', { class: 'mod-hint' }, this.mode === 'sign' ? 'Trascina la firma dove serve. «Fine» la scrive nel documento.' : 'Clic sulla pagina per scrivere; trascina per spostare. «Fine» scrive tutto.'),
      h('button', { type: 'button', class: 'btn small primary', title: 'Scrivi ora gli elementi nella pagina (resta possibile annullare)', onclick: () => this.applyNow() }, 'Applica'),
    );
    this.sizeOut = sizeOut;
    if (this.mode === 'sign') setTimeout(() => this.quickSign(), 0);
  }
  #syncBar() {
    const sel = this.board.selected;
    if (this.sizeOut) this.sizeOut.textContent = (sel?.kind === 'text' ? sel.size : this.size) + ' pt';
  }
  setTool(tool) {
    this.tool = tool; this.pendingText = null;
    this.optionsEl?.querySelectorAll('.mod-tbtn').forEach((b) => { const on = b.dataset.tool === tool; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
    this.app.viewer.setMode('tool', tool === 'text' || tool === 'date' ? 'text' : 'crosshair');
  }

  // ------------------------------------------------------------------ firma rapida
  /** Firma in due clic: se c'è una firma salvata compare subito al centro della pagina visibile. */
  async quickSign(kind = 'signature') {
    const saved = this.store.list(kind);
    if (saved.length) return this.addImage(saved[0]);
    const created = await this.#create(kind);
    if (created) this.addImage(created);
  }
  async #create(kind) {
    const name = this.store.getProfile().nomeCompleto || [this.store.getProfile().nome, this.store.getProfile().cognome].filter(Boolean).join(' ') || this.app.settings.get('author', '');
    const r = await createSignatureDialog(this.app, { kind, name });
    if (!r) return null;
    if (r.save) { try { return this.store.add(r); } catch (e) { this.app.ui.toast(e.message, { kind: 'warning' }); } }
    return r;
  }
  signatureMenu(anchor, kind) {
    const saved = this.store.list(kind);
    const r = anchor.getBoundingClientRect();
    const items = saved.map((s, i) => ({ label: (kind === 'initials' ? 'Iniziali ' : 'Firma ') + (i + 1) + (s.label ? ' — ' + s.label : ''), run: () => { this.store.touch(s.id); this.addImage(s); } }));
    const menu = this.app.ui.contextMenu(r.left, r.bottom + 4, [
      ...items,
      ...(items.length ? ['-'] : []),
      { label: kind === 'initials' ? 'Crea nuove iniziali…' : 'Crea una nuova firma…', icon: 'plus', run: async () => { const c = await this.#create(kind); if (c) this.addImage(c); } },
      ...(saved.length ? [{ label: 'Elimina firme salvate…', icon: 'trash', danger: true, run: () => this.#manageSaved(kind) }] : []),
    ]);
    // anteprima delle firme salvate nel menu
    menu.querySelectorAll('button[role=menuitem]').forEach((b, i) => { if (saved[i]) { const img = new Image(); img.src = saved[i].dataUrl; img.className = 'mod-menu-sig'; img.alt = ''; b.prepend(img); } });
  }
  async #manageSaved(kind) {
    const { h } = this.app.ui;
    const saved = this.store.list(kind);
    const checks = saved.map((s) => ({ s, c: h('input', { type: 'checkbox' }) }));
    const body = h('div', { class: 'mod-saved' }, checks.map(({ s, c }) => h('label', { class: 'mod-saved-row' }, c, h('img', { src: s.dataUrl, alt: 'Firma salvata' }))));
    const ok = await this.app.ui.dialog({ title: 'Elimina firme salvate', body, okLabel: 'Elimina selezionate', danger: true });
    if (ok) checks.filter((x) => x.c.checked).forEach((x) => this.store.remove(x.s.id));
  }

  profileMenu(anchor) {
    const p = this.store.getProfile();
    const r = anchor.getBoundingClientRect();
    const full = p.nomeCompleto || [p.nome, p.cognome].filter(Boolean).join(' ');
    const entries = PROFILE_FIELDS.map((f) => ({ f, v: f.key === 'nomeCompleto' ? full : p[f.key] })).filter((x) => x.v);
    this.app.ui.contextMenu(r.left, r.bottom + 4, [
      ...entries.map(({ f, v }) => ({ label: `${f.label}: ${v.length > 40 ? v.slice(0, 40) + '…' : v}`, run: () => this.#armText(v) })),
      { label: 'Data di oggi: ' + todayIt(), run: () => this.#armText(todayIt()) },
      '-',
      { label: entries.length ? 'Modifica i dati personali…' : 'Inserisci i tuoi dati personali…', icon: 'settings', run: () => editProfileDialog(this.app, this.store) },
    ]);
  }
  #armText(text) {
    this.setTool('text'); this.pendingText = text;
    this.app.ui.toast('Ora fai clic sulla pagina dove inserirlo', { timeout: 2500 });
  }

  addImage(sig) {
    const pi = this.#visiblePage();
    const box = this.#pageBox(pi);
    const ratio = (sig.w || 3) / (sig.h || 1);
    const hgt = sig.kind === 'initials' ? 24 : 40; const w = Math.min(hgt * ratio, (box[2] - box[0]) * 0.6);
    const c = this.#visibleCenter(pi) || [(box[0] + box[2]) / 2, (box[1] + box[3]) / 2];
    const rect = fitRectInPage(c[0], c[1], w, w / ratio, box);
    this.board.add({ kind: 'image', pageIndex: pi, rect, dataUrl: sig.dataUrl, sigKind: sig.kind });
    this.setTool('select');
  }

  // ------------------------------------------------------------------ posizionamento
  #pageBox(pi) {
    const vp = this.app.viewer.getViewport(pi);
    if (!vp) return [0, 0, 595, 842];
    const vb = vp.viewBox; return [vb[0], vb[1], vb[2], vb[3]];
  }
  #visiblePage() { return Math.max(0, Math.min((this.app.activeDoc?.pageCount || 1) - 1, this.app.viewer.pageIndex)); }
  #visibleCenter(pi) {
    const c = this.app.viewer.container.getBoundingClientRect();
    const div = this.app.viewer.getPageDiv(pi); if (!div) return null;
    const r = div.getBoundingClientRect();
    const x = Math.max(r.left, Math.min(r.right, (c.left + c.right) / 2));
    const y = Math.max(r.top + 40, Math.min(r.bottom - 40, (Math.max(c.top, r.top) + Math.min(c.bottom, r.bottom)) / 2));
    return this.app.viewer.clientToPdf(pi, x, y);
  }

  async #textItems(pi) {
    if (this.textCache.has(pi)) return this.textCache.get(pi);
    const p = (async () => { try { const page = await this.app.activeDoc.pdf.getPage(pi + 1); return textItemsFromPdfjs(await page.getTextContent()); } catch { return []; } })();
    this.textCache.set(pi, p);
    return p;
  }

  #place(pi, pt, e) {
    if (this.tool === 'select') return false;
    const [x, y] = pt;
    const size = this.size;
    if (this.tool === 'text' || this.tool === 'date') {
      const text = this.tool === 'date' ? todayIt() : this.pendingText || '';
      this.pendingText = null;
      const lineH = size * LINE_H;
      // il clic indica il punto in alto a sinistra, un po' sopra il puntatore (come Acrobat)
      const item = { kind: 'text', pageIndex: pi, text, size, color: this.color, rect: [x, y - lineH * 0.6, x + Math.max(size * 4, size * 0.6 * (text.length + 1)), y + lineH * 0.4] };
      this.board.add(item);
      // aggancio alle righe «_____» vicine
      this.#textItems(pi).then((items) => {
        const line = items.find((it) => /_{3,}|\.{6,}/.test(it.str) && x >= it.x - 4 && x <= it.x + it.w + 4 && Math.abs(it.y - (y - lineH * 0.3)) < Math.max(8, size));
        if (line && this.board.items.includes(item)) {
          const baseY = line.y + size * 0.18;
          const top = baseY + size * BASELINE; // la linea di base del testo poco sopra la riga
          const hgt = item.rect[3] - item.rect[1];
          item.rect = [item.rect[0], top - hgt, item.rect[2], top];
          this.board.drawPage(pi); this.#focusText(item);
        }
      });
      if (this.tool === 'date') { this.#fitTextLater(item); this.setTool('text'); }
      else this.#focusText(item);
      return true;
    }
    // segni: quadrato centrato sul clic, adattato a una casella ☐ vicina
    const s = Math.max(8, size * 1.1);
    const item = { kind: this.tool, pageIndex: pi, color: this.color, rect: [x - s / 2, y - s / 2, x + s / 2, y + s / 2] };
    this.board.add(item);
    this.#textItems(pi).then((items) => {
      const box = items.find((it) => /[☐□❑❒◻▢☐]/.test(it.str) && x >= it.x - 3 && x <= it.x + it.w + 3 && y >= it.y - it.h * 0.4 && y <= it.y + it.h * 1.2);
      if (box && this.board.items.includes(item)) {
        const cw = box.w / Math.max(1, box.str.length); const idx = Math.max(0, Math.min(box.str.length - 1, Math.floor((x - box.x) / cw)));
        const cx = box.x + cw * (idx + 0.5); const cy = box.y + box.h * 0.35; const ss = Math.max(6, box.h * 0.75);
        item.rect = [cx - ss / 2, cy - ss / 2, cx + ss / 2, cy + ss / 2];
        this.board.drawPage(pi);
      }
    });
    return true;
  }

  // ------------------------------------------------------------------ disegno a schermo
  #render(el, item, { scale }) {
    if (item.kind === 'text') {
      el.classList.add('mod-text');
      const ed = document.createElement('div');
      ed.className = 'mod-text-edit';
      ed.contentEditable = 'plaintext-only';
      ed.spellcheck = true;
      ed.setAttribute('role', 'textbox'); ed.setAttribute('aria-label', 'Testo'); ed.setAttribute('aria-multiline', 'true');
      Object.assign(ed.style, { fontSize: item.size * scale + 'px', color: item.color, lineHeight: String(LINE_H) });
      ed.textContent = item.text;
      ed.addEventListener('input', () => { item.text = ed.innerText.replace(/\n$/, ''); this.#fitText(item, ed); });
      ed.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); ed.blur(); this.board.select(null); } });
      ed.addEventListener('blur', () => { if (!item.text.trim()) setTimeout(() => { if (this.board.items.includes(item) && !item.text.trim()) this.board.remove(item); }, 0); });
      el.append(ed);
    } else if (item.kind === 'image') {
      el.classList.add('mod-image');
      const img = document.createElement('img'); img.src = item.dataUrl; img.alt = item.sigKind === 'initials' ? 'Iniziali' : 'Firma'; img.draggable = false;
      el.append(img);
    } else {
      el.classList.add('mod-mark');
      el.innerHTML = item.kind === 'dot'
        ? `<svg viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="30" fill="${item.color}"/></svg>`
        : `<svg viewBox="0 0 100 100" aria-hidden="true"><path d="${MARKS[item.kind]}" fill="none" stroke="${item.color}" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    }
  }
  #focusText(item) {
    requestAnimationFrame(() => {
      const ed = this.board.elementOf(item)?.querySelector('.mod-text-edit');
      if (!ed) return;
      ed.focus();
      const sel = getSelection(); const r = document.createRange(); r.selectNodeContents(ed); r.collapse(false); sel.removeAllRanges(); sel.addRange(r);
    });
  }
  #fitTextLater(item) { requestAnimationFrame(() => this.#fitText(item)); }
  /** Adatta il riquadro al testo scritto (si allarga mentre si scrive). */
  #fitText(item, ed) {
    const el = this.board.elementOf(item); if (!el) return;
    ed ||= el.querySelector('.mod-text-edit'); if (!ed) return;
    const viewer = this.app.viewer;
    const pi = item.pageIndex;
    const r = el.getBoundingClientRect();
    const vp = viewer.getViewport(pi);
    const needW = Math.max(ed.scrollWidth + 4, item.size * vp.scale * 2);
    const needH = Math.max(ed.scrollHeight, item.size * LINE_H * vp.scale);
    const a = viewer.clientToPdf(pi, r.left, r.top); const b = viewer.clientToPdf(pi, r.left + needW, r.top + needH);
    if (!a || !b) return;
    item.rect = [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])];
    const css = rectToCss(viewer, pi, item.rect);
    Object.assign(el.style, { width: css.width + 'px', height: css.height + 'px', left: css.left + 'px', top: css.top + 'px' });
  }

  // ------------------------------------------------------------------ scrittura nel PDF
  async applyNow() {
    const items = this.board.items.filter((i) => !(i.kind === 'text' && !i.text.trim()));
    if (!items.length) { this.app.ui.toast('Non c\'è niente da applicare: fai clic sulla pagina per aggiungere testo o segni.'); return; }
    document.activeElement?.blur?.();
    try {
      await this.apply(items, this.doc);
      this.board.clear();
    } catch (err) { this.app.reportError(err, 'Non è stato possibile scrivere gli elementi nella pagina'); }
  }

  async apply(items, doc) {
    const nSig = items.filter((i) => i.kind === 'image').length;
    const label = nSig && items.length === nSig ? (nSig > 1 ? 'Firme aggiunte' : 'Firma aggiunta') : 'Compila e firma';
    await this.app.editWithPdfLib(label, async (pdfDoc, PDFLib) => {
      const font = await pdfDoc.embedFont(PDFLib.StandardFonts.Helvetica);
      const pages = pdfDoc.getPages();
      const imgCache = new Map();
      const canEncode = (ch) => { try { font.encodeText(ch); return true; } catch { return false; } };
      for (const it of items) {
        const page = pages[it.pageIndex]; if (!page) continue;
        const rot = page.getRotation().angle || 0;
        const pl = placement(it.rect, rot);
        const color = hexToRgb(PDFLib, it.color || '#111111');
        const deg = PDFLib.degrees(pl.rotate);
        if (it.kind === 'text') {
          const lines = winAnsiSafe(it.text, canEncode).split('\n');
          lines.forEach((ln, i) => {
            if (!ln) return;
            const p = localToPdf(pl, 0, pl.h - it.size * BASELINE - i * it.size * LINE_H);
            page.drawText(ln, { x: p.x, y: p.y, size: it.size, font, color, rotate: deg });
          });
        } else if (it.kind === 'image') {
          let img = imgCache.get(it.dataUrl);
          if (!img) { img = await pdfDoc.embedPng(dataUrlToBytes(it.dataUrl)); imgCache.set(it.dataUrl, img); }
          page.drawImage(img, { x: pl.x, y: pl.y, width: pl.w, height: pl.h, rotate: deg });
        } else if (it.kind === 'dot') {
          const c = localToPdf(pl, pl.w / 2, pl.h / 2);
          page.drawCircle({ x: c.x, y: c.y, size: Math.min(pl.w, pl.h) * 0.3, color });
        } else {
          const s = Math.min(pl.w, pl.h);
          const tl = localToPdf(pl, (pl.w - s) / 2, pl.h - (pl.h - s) / 2);
          page.drawSvgPath(MARKS[it.kind], { x: tl.x, y: tl.y, scale: s / 100, borderColor: color, borderWidth: 12, borderLineCap: PDFLib.LineCapStyle.Round, rotate: deg });
        }
      }
    }, doc);
  }
}
