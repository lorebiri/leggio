// Strumento «Modifica testo e immagini»: blocchi di testo modificabili in loco e immagini selezionabili.
import { editorText, editBlock, transformImage, deleteImage, replaceImage } from '../operations.js';
import { effectiveFontSize } from '../interpreter.js';
import { mul } from '../interpreter.js';
import { T } from '../rewrite.js';
import {
  pageBlocks, pageAnalysis, safePageEdit, sampleBackground, rgbToCss, FAMILY_CSS, ENV, forEachRenderedPage, toolLayer,
  clearLayers, place, styleBar, changedStyle, afterEditToast, confirmSigned, rectToCss,
} from './common.js';

const LAYER = 'lgm-edit';

export function editContentTool(app) {
  const { h } = app.ui;
  const S = { active: false, editing: null, image: null, bar: null, style: null, unsub: [] };

  function draw(pageIndex, overlay) {
    if (!S.active || !overlay) return;
    const doc = app.activeDoc;
    const layer = toolLayer(overlay, LAYER);
    layer.innerHTML = '';
    const version = doc.bytes;
    pageBlocks(doc, pageIndex).then(({ blocks }) => {
      if (!S.active || doc.bytes !== version || !layer.isConnected) return;
      for (const b of blocks) {
        if (!b.text.trim()) continue;
        const el = h('div', { class: 'lgm-block', title: 'Fai clic per modificare il testo', 'data-block': b.id });
        place(el, rectToCss(app, pageIndex, b.rect), 2);
        el.addEventListener('mousedown', (e) => { if (e.button === 0) e.stopPropagation(); });
        el.addEventListener('click', (e) => { e.stopPropagation(); openEditor(pageIndex, b, e, false); });
        el.addEventListener('dblclick', (e) => { e.stopPropagation(); if (S.editing?.block === b) selectWordAt(e); else openEditor(pageIndex, b, e, true); });
        layer.append(el);
      }
      if (S.editing && S.editing.pageIndex === pageIndex) mountEditor();
    }).catch((err) => console.warn('[modifica] blocchi', err));
    pageAnalysis(app, pageIndex, doc).then((A) => {
      if (!S.active || doc.bytes !== version || !layer.isConnected) return;
      for (const im of A.r.images) {
        const el = h('div', { class: 'lgm-image' + (im.inForm ? ' locked' : ''), title: im.inForm ? 'Immagine dentro un elemento grafico composto: non si può modificare' : 'Fai clic per selezionare l\'immagine' });
        place(el, rectToCss(app, pageIndex, im.rect));
        if (!im.inForm) el.addEventListener('mousedown', (e) => { if (e.button !== 0) return; e.stopPropagation(); selectImage(pageIndex, im); startImageDrag(e, 'move'); });
        layer.prepend(el);
      }
      if (S.reselect && S.reselect.pageIndex === pageIndex) {
        const want = S.reselect; S.reselect = null;
        const near = (a, b) => a.every((v, i) => Math.abs(v - b[i]) < 1.5);
        const hit = A.r.images.find((x) => !x.inForm && x.name === want.name && near(x.rect, want.rect));
        if (hit) { S.image = { pageIndex, im: hit, crop: false }; renderBar(); }
      }
      if (S.image && S.image.pageIndex === pageIndex) {
        const again = A.r.images.find((x) => x.opIndex === S.image.im.opIndex);
        if (again) { S.image.im = again; mountImageBox(); } else S.image = null;
      }
    }).catch((err) => console.warn('[modifica] immagini', err));
  }

  // ------------------------------------------------------------------ editor di testo

  async function openEditor(pageIndex, block, evt, selectWord) {
    const click = evt ? { x: evt.clientX, y: evt.clientY, word: selectWord } : null;
    // doppio clic: il primo clic sta già aprendo questo blocco → si aggiorna solo la richiesta di selezione
    if (S.pending && S.pending.block === block) { if (click && (selectWord || !S.pending.click?.word)) S.pending.click = click; return; }
    if (S.editing) { if (S.editing.block === block) return; await commit(); }
    const pending = (S.pending = { block, click });
    try { await prepareEditor(pageIndex, block, pending); } finally { if (S.pending === pending) S.pending = null; }
  }

  async function prepareEditor(pageIndex, block, pending) {
    deselectImage();
    if (!(await confirmSigned(app))) return;
    let A;
    try { A = await pageAnalysis(app, pageIndex); } catch (err) { app.reportError(err, 'Impossibile leggere il contenuto della pagina'); return; }
    const { text: initial, entries, inPlacePossible } = editorText(A, block);
    const dom = entries.find((e) => e.g.u && e.g.u.trim()) || entries[0];
    const model = dom?.s.font;
    S.style = {
      allowOriginal: true, font: 'original', size: block.fontSize, color: dom?.s.color || [0, 0, 0],
      bold: !!model?.bold, italic: !!model?.italic, align: block.align || 'left', touched: {},
      family: model?.family || (block.fontFamily === 'serif' ? 'Times' : block.fontFamily === 'monospace' ? 'Courier' : 'Helvetica'),
      efs: dom ? effectiveFontSize(dom.s) : block.fontSize,
    };
    if (S.pending !== pending) return;
    S.editing = { pageIndex, block, initial, text: initial, click: pending.click, notInPlace: !inPlacePossible };
    renderBar();
    mountEditor();
  }

  function editorFont() {
    const st = S.style;
    const fam = st.font === 'original' ? st.family : st.font;
    return FAMILY_CSS[fam] || FAMILY_CSS.Helvetica;
  }

  function mountEditor() {
    const E = S.editing; if (!E) return;
    const overlay = app.viewer.getOverlay(E.pageIndex); if (!overlay) return;
    const layer = toolLayer(overlay, LAYER);
    layer.querySelector('.lgm-editor')?.remove();
    const vp = app.viewer.getViewport(E.pageIndex);
    const k = vp.scale;
    const b = E.block;
    const css = rectToCss(app, E.pageIndex, b.rect);
    if (!E.bg) E.bg = sampleBackground(app, E.pageIndex, css);
    const st = S.style;
    const size = (st.size || b.fontSize) * k;
    const lh = (b.lineHeight || b.fontSize * 1.2) * ((st.size || b.fontSize) / b.fontSize) * k;
    const single = b.lines.length === 1;
    const ed = h('div', { class: 'lgm-editor', contenteditable: 'plaintext-only', spellcheck: 'true', lang: 'it', role: 'textbox', 'aria-multiline': 'true', 'aria-label': 'Modifica testo (Invio per confermare, Esc per annullare)' });
    ed.textContent = E.text;
    Object.assign(ed.style, {
      left: css.left - 3 + 'px', top: css.top - 3 + 'px', minWidth: css.width + 6 + 'px', minHeight: css.height + 6 + 'px',
      width: single ? 'auto' : css.width + 6 + 'px', whiteSpace: single ? 'pre' : 'pre-wrap',
      fontSize: size + 'px', lineHeight: lh + 'px', fontFamily: editorFont(), color: rgbToCss(st.color), background: rgbToCss(E.bg),
      fontWeight: st.bold ? '700' : '400', fontStyle: st.italic ? 'italic' : 'normal', textAlign: st.align === 'justify' ? 'justify' : st.align,
    });
    if (b.angle) ed.title = 'Testo ruotato: lo modifichi qui in orizzontale, nel documento resterà ruotato.';
    ed.addEventListener('mousedown', (e) => e.stopPropagation());
    ed.addEventListener('click', (e) => e.stopPropagation());
    ed.addEventListener('dblclick', (e) => e.stopPropagation());
    ed.addEventListener('input', () => { E.text = readText(ed); });
    ed.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'a') { e.preventDefault(); e.stopPropagation(); const r = document.createRange(); r.selectNodeContents(ed); getSelection().removeAllRanges(); getSelection().addRange(r); return; }
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commit(); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancel(); }
    });
    ed.addEventListener('focusout', (e) => {
      const to = e.relatedTarget;
      if (to && (app.el.toolOptions.contains(to) || ed.contains(to))) return;
      setTimeout(() => { if (S.editing === E && document.activeElement !== ed && !app.el.toolOptions.contains(document.activeElement)) commit(); }, 0);
    });
    layer.append(ed);
    E.el = ed;
    ed.focus({ preventScroll: true });
    if (E.click) { placeCaret(ed, E.click); E.click = null; }
  }

  const readText = (ed) => ed.innerText.replace(/ /g, ' ').replace(/\n$/, '');

  function placeCaret(ed, { x, y, word }) {
    const sel = getSelection();
    const r = document.caretRangeFromPoint?.(x, y);
    if (r && ed.contains(r.startContainer)) { sel.removeAllRanges(); sel.addRange(r); if (word) expandToWord(sel); }
    else { const rr = document.createRange(); rr.selectNodeContents(ed); rr.collapse(false); sel.removeAllRanges(); sel.addRange(rr); }
  }
  function expandToWord(sel) { try { sel.modify('move', 'backward', 'word'); sel.modify('extend', 'forward', 'word'); const s = sel.toString(); if (/\s$/.test(s)) sel.modify('extend', 'backward', 'character'); } catch { /* */ } }
  function selectWordAt(e) { const ed = S.editing?.el; if (ed) placeCaret(ed, { x: e.clientX, y: e.clientY, word: true }); }

  function applyLiveStyle() {
    const E = S.editing; if (!E?.el) return;
    E.text = readText(E.el);
    mountEditor();
  }

  async function commit() {
    const E = S.editing; if (!E || E.busy) return;
    E.busy = true;
    const text = E.el ? readText(E.el) : E.text;
    const style = changedStyle(S.style);
    if (text === E.initial && !Object.keys(style).length) { closeEditor(); return; }
    E.el?.setAttribute('contenteditable', 'false');
    E.el?.classList.add('busy');
    const { pageIndex, block, initial, bg } = E;
    const r = await safePageEdit(app, text.trim() ? 'Testo modificato' : 'Testo eliminato', pageIndex,
      (pdfDoc, mode) => editBlock(pdfDoc, pageIndex, block, text, style, ENV, { mode, bgColor: bg, oldText: initial }),
      { exclude: [block.rect] });
    if (S.editing === E) closeEditor();
    afterEditToast(app, r);
  }

  function cancel() { closeEditor(); }
  function closeEditor() {
    const E = S.editing; S.editing = null;
    E?.el?.remove();
    renderBar();
  }

  // ------------------------------------------------------------------ immagini

  function selectImage(pageIndex, im) {
    if (S.editing) commit();
    S.image = { pageIndex, im, crop: false };
    renderBar();
    mountImageBox();
  }
  function deselectImage() {
    if (!S.image) return;
    S.image = null;
    document.querySelectorAll('.lgm-imgbox').forEach((e) => e.remove());
    renderBar();
  }

  function mountImageBox() {
    document.querySelectorAll('.lgm-imgbox').forEach((e) => e.remove());
    const I = S.image; if (!I) return;
    const overlay = app.viewer.getOverlay(I.pageIndex); if (!overlay) return;
    const layer = toolLayer(overlay, LAYER);
    const css = rectToCss(app, I.pageIndex, I.cropRect || I.im.rect);
    const box = h('div', { class: 'lgm-imgbox' + (I.crop ? ' crop' : ''), tabindex: 0, 'aria-label': I.crop ? 'Area di ritaglio' : 'Immagine selezionata: trascina per spostare, usa gli angoli per ridimensionare, Canc per eliminare' });
    place(box, css);
    for (const c of ['nw', 'ne', 'sw', 'se']) {
      const hd = h('div', { class: 'lgm-handle ' + c });
      hd.addEventListener('mousedown', (e) => { if (e.button !== 0) return; e.stopPropagation(); e.preventDefault(); startImageDrag(e, c); });
      box.append(hd);
    }
    box.addEventListener('mousedown', (e) => { if (e.button !== 0) return; e.stopPropagation(); e.preventDefault(); startImageDrag(e, 'move'); });
    box.addEventListener('keydown', (e) => {
      if ((e.key === 'Delete' || e.key === 'Backspace') && !I.crop) { e.preventDefault(); imageAction('delete'); }
      if (e.key === 'Escape') { e.stopPropagation(); I.crop ? (I.crop = false, I.cropRect = null, mountImageBox(), renderBar()) : deselectImage(); }
      if (e.key === 'Enter' && I.crop) imageAction('apply-crop');
      const step = e.shiftKey ? 10 : 1;
      const arrows = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
      if (arrows[e.key] && !I.crop) { e.preventDefault(); moveImageBy(...arrows[e.key]); }
    });
    layer.append(box);
    box.focus({ preventScroll: true });
    I.box = box;
  }

  function startImageDrag(e, mode) {
    const I = S.image; if (!I) return;
    const vp = app.viewer.getViewport(I.pageIndex);
    const p0 = app.viewer.clientToPdf(I.pageIndex, e.clientX, e.clientY);
    const r0 = I.cropRect || I.im.rect; // [x1,y1,x2,y2]
    let last = null;
    const box = () => I.box;
    const onMove = (ev) => {
      const p = app.viewer.clientToPdf(I.pageIndex, ev.clientX, ev.clientY);
      const dx = p[0] - p0[0], dy = p[1] - p0[1];
      let r;
      if (mode === 'move') { if (I.crop) return; r = [r0[0] + dx, r0[1] + dy, r0[2] + dx, r0[3] + dy]; }
      else {
        // angoli: in spazio PDF y cresce verso l'alto; con rotazione della vista ci affidiamo al rettangolo
        const ptsCss = { nw: [0, 0], ne: [1, 0], sw: [0, 1], se: [1, 1] }[mode];
        const cssR = rectToCss(app, I.pageIndex, r0);
        const anchorCss = [cssR.left + (1 - ptsCss[0]) * cssR.width, cssR.top + (1 - ptsCss[1]) * cssR.height];
        const a = vp.convertToPdfPoint(...anchorCss);
        if (I.crop) { r = [Math.min(a[0], p[0]), Math.min(a[1], p[1]), Math.max(a[0], p[0]), Math.max(a[1], p[1])]; r = clampRect(r, I.im.rect); }
        else {
          const w0 = r0[2] - r0[0], h0 = r0[3] - r0[1];
          const s = Math.max(0.05, Math.max(Math.abs(p[0] - a[0]) / w0, Math.abs(p[1] - a[1]) / h0));
          const nw = w0 * s, nh = h0 * s;
          const sx = p[0] >= a[0] ? 1 : -1, sy = p[1] >= a[1] ? 1 : -1;
          r = [Math.min(a[0], a[0] + sx * nw), Math.min(a[1], a[1] + sy * nh), Math.max(a[0], a[0] + sx * nw), Math.max(a[1], a[1] + sy * nh)];
          r.anchor = a; r.s = s;
        }
      }
      last = r;
      if (box()) place(box(), rectToCss(app, I.pageIndex, r));
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp);
      if (!last) return;
      if (I.crop) { I.cropRect = last; return; }
      if (mode === 'move') moveImageBy(last[0] - r0[0], last[1] - r0[1]);
      else applyImageTransform(T.scaleAbout(last.s, last.s, last.anchor[0], last.anchor[1]), 'Immagine ridimensionata');
    };
    window.addEventListener('mousemove', onMove); window.addEventListener('mouseup', onUp);
  }
  const clampRect = (r, b) => [Math.max(r[0], b[0]), Math.max(r[1], b[1]), Math.min(r[2], b[2]), Math.min(r[3], b[3])];

  function moveImageBy(dx, dy) { if (Math.abs(dx) + Math.abs(dy) < 0.2) return; applyImageTransform(T.translate(dx, dy), 'Immagine spostata'); }

  async function applyImageTransform(t, label, opts = {}) {
    const I = S.image; if (!I) return;
    const { pageIndex, im } = I;
    const target = mul(im.ctm, t);
    const pts = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([x, y]) => [x * target[0] + y * target[2] + target[4], x * target[1] + y * target[3] + target[5]]);
    S.reselect = { pageIndex, name: im.name, rect: [Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1]))] };
    await safePageEdit(app, label, pageIndex, (pdfDoc, mode) => { if (mode === 'cover') return false; transformImage(pdfDoc, pageIndex, im.opIndex, target, opts); return {}; });
  }

  async function imageAction(kind) {
    const I = S.image; if (!I) return;
    const { pageIndex, im } = I;
    const [x1, y1, x2, y2] = im.rect;
    if (kind === 'rotate') return applyImageTransform(T.rotateAbout(-90, (x1 + x2) / 2, (y1 + y2) / 2), 'Immagine ruotata');
    if (kind === 'delete') {
      S.image = null; renderBar();
      return safePageEdit(app, 'Immagine eliminata', pageIndex, (pdfDoc, mode) => { if (mode === 'cover') return false; deleteImage(pdfDoc, pageIndex, im.opIndex); return {}; });
    }
    if (kind === 'replace') {
      const files = await app.platform.openFiles({ multiple: false, filters: [{ name: 'Immagini', extensions: ['png', 'jpg', 'jpeg'] }] });
      if (!files?.length) return;
      return safePageEdit(app, 'Immagine sostituita', pageIndex, async (pdfDoc, mode) => { if (mode === 'cover') return false; await replaceImage(pdfDoc, pageIndex, im.opIndex, files[0].bytes); return {}; });
    }
    if (kind === 'crop') { I.crop = true; I.cropRect = im.rect; mountImageBox(); renderBar(); return; }
    if (kind === 'apply-crop') {
      const r = I.cropRect; I.crop = false; I.cropRect = null;
      if (!r) return renderBar();
      return applyImageTransform([1, 0, 0, 1, 0, 0], 'Immagine ritagliata', { clipQuad: [[r[0], r[1]], [r[2], r[1]], [r[2], r[3]], [r[0], r[3]]] });
    }
    if (kind === 'cancel-crop') { I.crop = false; I.cropRect = null; mountImageBox(); renderBar(); }
  }

  // ------------------------------------------------------------------ barra opzioni

  function renderBar() {
    const bar = S.bar; if (!bar) return;
    bar.innerHTML = '';
    if (S.editing) {
      const sb = styleBar(h, S.style, () => applyLiveStyle());
      bar.append(sb,
        h('button', { class: 'btn small primary', onmousedown: (e) => e.preventDefault(), onclick: () => commit() }, 'Conferma (Invio)'),
        h('button', { class: 'btn small', onmousedown: (e) => e.preventDefault(), onclick: () => cancel() }, 'Annulla (Esc)'));
      return;
    }
    if (S.image) {
      if (S.image.crop) {
        bar.append(h('span', { class: 'lgm-hint' }, 'Trascina gli angoli per scegliere la parte da tenere.'),
          h('button', { class: 'btn small primary', onclick: () => imageAction('apply-crop') }, 'Applica ritaglio'),
          h('button', { class: 'btn small', onclick: () => imageAction('cancel-crop') }, 'Annulla'));
        return;
      }
      bar.append(h('span', { class: 'lgm-hint' }, 'Immagine: trascinala per spostarla, usa gli angoli per ridimensionarla.'),
        h('button', { class: 'btn small', onclick: () => imageAction('rotate') }, 'Ruota'),
        h('button', { class: 'btn small', onclick: () => imageAction('crop') }, 'Ritaglia'),
        h('button', { class: 'btn small', onclick: () => imageAction('replace') }, 'Sostituisci…'),
        h('button', { class: 'btn small danger', onclick: () => imageAction('delete') }, 'Elimina'));
      return;
    }
    bar.append(h('span', { class: 'lgm-hint', title: 'Doppio clic su una parola per selezionarla subito. Invio conferma, Esc annulla.' }, 'Fai clic su un testo o su un\'immagine per modificarli.'),
      h('button', { class: 'btn small', onclick: () => { app.tools.run('add-text'); } }, 'Aggiungi testo'),
      h('button', { class: 'btn small', onclick: () => { app.tools.run('add-image'); } }, 'Aggiungi immagine'));
  }

  function onOverlayDown(e) {
    if (!S.active || e.button !== 0) return;
    if (!e.target.closest('.leggio-overlay')) return;
    if (e.target.closest('.lgm-block, .lgm-image, .lgm-imgbox, .lgm-editor')) return;
    if (S.editing) commit();
    if (S.image && !S.image.crop) deselectImage();
  }

  return {
    id: 'edit-content', name: 'Modifica testo e immagini', category: 'modifica', icon: 'text', quick: true, quickOrder: 20, shortcut: 'm',
    description: 'Correggi un refuso o riscrivi un paragrafo con lo stesso carattere; sposta, sostituisci o elimina le immagini',
    keywords: 'modifica pdf modifica testo e immagini correggi refuso cambia testo edit testo esistente sostituisci logo immagine sposta ridimensiona ritaglia',
    interactive: {
      activate(appRef, optionsEl) {
        S.active = true; S.bar = optionsEl;
        app.viewer.setMode('tool', 'default');
        renderBar();
        S.unsub.push(app.bus.on('page:rendered', ({ pageIndex, overlay }) => draw(pageIndex, overlay)));
        S.unsub.push(app.bus.on('document:changed', () => { S.image = null; renderBar(); }));
        S.unsub.push(app.bus.on('document:activated', () => app.tools.deactivate()));
        document.addEventListener('mousedown', onOverlayDown, true);
        forEachRenderedPage(app, (i, ov) => draw(i, ov));
      },
      deactivate() {
        if (S.editing) commit();
        S.active = false; S.image = null; S.bar = null;
        S.unsub.forEach((u) => typeof u === 'function' && u()); S.unsub = [];
        document.removeEventListener('mousedown', onOverlayDown, true);
        clearLayers(app, LAYER);
      },
    },
  };
}
