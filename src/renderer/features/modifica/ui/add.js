// Strumenti «Aggiungi testo», «Inserisci data», «Aggiungi immagine» e «Disegna forme» (tutti come contenuto di pagina).
import { addText, addImage, addShape } from '../operations.js';
import { safePageEdit, ENV, toolLayer, clearLayers, place, styleBar, afterEditToast, rgbToCss, cssToRgb, rgbToHex, FAMILY_CSS, todayIt, pageOfEvent, confirmSigned, rectToCss } from './common.js';

const pageRotation = async (app, i) => { try { return ((await app.activeDoc.pdf.getPage(i + 1)).rotate || 0) % 360; } catch { return 0; } };

// ------------------------------------------------------------------ aggiungi testo

export function addTextTool(app, { id = 'add-text', name = 'Aggiungi testo', preset = null, description, keywords, icon = 'text' } = {}) {
  const { h } = app.ui;
  const S = { draft: null, bar: null, style: null, unsub: [] };
  const LAYER = 'lgm-add';

  function renderBar() {
    const bar = S.bar; if (!bar) return;
    bar.innerHTML = '';
    const sb = styleBar(h, S.style, () => restyle());
    bar.append(sb,
      h('button', { class: 'btn small', onmousedown: (e) => e.preventDefault(), onclick: () => insertPreset(todayIt()) }, 'Data di oggi'),
      h('button', { class: 'btn small', onmousedown: (e) => e.preventDefault(), onclick: () => insertPreset(`Prot. n. ______ del ${todayIt()}`) }, 'Protocollo'));
    if (S.draft) bar.append(h('button', { class: 'btn small primary', onmousedown: (e) => e.preventDefault(), onclick: () => commit() }, 'Inserisci'), h('button', { class: 'btn small', onmousedown: (e) => e.preventDefault(), onclick: () => cancel() }, 'Annulla'));
    else bar.append(h('span', { class: 'lgm-hint' }, 'Fai clic sulla pagina dove vuoi scrivere (o trascina per scegliere la larghezza).'));
  }

  function insertPreset(text) {
    if (S.draft?.el) { S.draft.el.focus(); document.execCommand('insertText', false, text); S.draft.text = S.draft.el.innerText; }
    else app.ui.toast('Prima fai clic sulla pagina nel punto dove inserire il testo.');
  }

  function restyle() { if (S.draft?.el) { S.draft.text = S.draft.el.innerText; mount(); } }

  function mount() {
    const D = S.draft; if (!D) return;
    const overlay = app.viewer.getOverlay(D.pageIndex); if (!overlay) return;
    const layer = toolLayer(overlay, LAYER);
    layer.innerHTML = '';
    const vp = app.viewer.getViewport(D.pageIndex);
    const k = vp.scale;
    const [cx, cy] = vp.convertToViewportPoint(D.x, D.y);
    const st = S.style;
    const ed = h('div', { class: 'lgm-editor new', contenteditable: 'plaintext-only', spellcheck: 'true', lang: 'it', role: 'textbox', 'aria-multiline': 'true', 'aria-label': 'Nuovo testo (clic fuori o Ctrl+Invio per inserire, Esc per annullare)' });
    ed.textContent = D.text;
    Object.assign(ed.style, {
      left: cx + 'px', top: cy + 'px', minWidth: Math.max(40, (D.width || 0) * k) + 'px', width: D.width ? D.width * k + 'px' : 'auto',
      whiteSpace: D.width ? 'pre-wrap' : 'pre', fontSize: (st.size || 12) * k + 'px', lineHeight: (st.size || 12) * 1.2 * k + 'px',
      fontFamily: FAMILY_CSS[st.font] || FAMILY_CSS.Helvetica, color: rgbToCss(st.color), fontWeight: st.bold ? 700 : 400, fontStyle: st.italic ? 'italic' : 'normal',
      textAlign: st.align === 'justify' ? 'left' : st.align, background: 'transparent',
    });
    ed.addEventListener('mousedown', (e) => e.stopPropagation());
    ed.addEventListener('input', () => { D.text = ed.innerText; });
    ed.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'a') { e.preventDefault(); e.stopPropagation(); const r = document.createRange(); r.selectNodeContents(ed); getSelection().removeAllRanges(); getSelection().addRange(r); return; }
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); commit(); }
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancel(); }
    });
    layer.append(ed);
    D.el = ed;
    ed.focus({ preventScroll: true });
    const r = document.createRange(); r.selectNodeContents(ed); r.collapse(false); getSelection().removeAllRanges(); getSelection().addRange(r);
  }

  async function commit() {
    const D = S.draft; if (!D || D.busy) return;
    const text = (D.el ? D.el.innerText : D.text).replace(/ /g, ' ').replace(/\n+$/, '');
    if (!text.trim()) return cancel();
    D.busy = true;
    const st = S.style;
    const style = { font: st.font === 'original' ? 'Helvetica' : st.font, size: st.size || 12, color: st.color, bold: st.bold, italic: st.italic, align: st.align, angle: D.rotation };
    const r = await safePageEdit(app, 'Testo aggiunto', D.pageIndex, (pdfDoc, mode) => (mode === 'cover' ? false : addText(pdfDoc, D.pageIndex, { x: D.x, y: D.y, width: D.width || 0 }, text, style, ENV)));
    S.draft = null; clearLayers(app, LAYER); renderBar();
    afterEditToast(app, r);
    app.settings.set('modifica.addTextStyle', { font: st.font, size: st.size, color: st.color, bold: st.bold, italic: st.italic, align: st.align });
  }
  function cancel() { S.draft = null; clearLayers(app, LAYER); renderBar(); }

  async function onDown(e) {
    if (e.button !== 0) return;
    const pageIndex = pageOfEvent(e);
    if (pageIndex < 0 || e.target.closest('.lgm-editor')) return;
    if (S.draft) { e.preventDefault(); await commit(); return; }
    if (!(await confirmSigned(app))) return;
    e.preventDefault();
    const start = app.viewer.clientToPdf(pageIndex, e.clientX, e.clientY);
    const sx = e.clientX;
    const rotation = await pageRotation(app, pageIndex);
    const k = app.viewer.getViewport(pageIndex).scale;
    const up = (ev) => {
      window.removeEventListener('mouseup', up);
      const wCss = Math.abs(ev.clientX - sx);
      S.draft = { pageIndex, x: start[0], y: start[1], width: wCss > 12 && !rotation ? wCss / k : 0, text: preset ? preset() : '', rotation };
      renderBar(); mount();
    };
    window.addEventListener('mouseup', up);
  }

  return {
    id, name, category: 'modifica', icon, quick: id === 'add-text', quickOrder: 21,
    description: description || 'Scrivi nuovo testo sulla pagina (diventa parte del documento, non un commento)',
    keywords: keywords || 'aggiungi testo scrivi casella di testo modifica pdf intestazione protocollo timbro nota',
    interactive: {
      activate(appRef, optionsEl) {
        S.bar = optionsEl;
        const saved = app.settings.get('modifica.addTextStyle', null);
        S.style = { allowOriginal: false, font: 'Helvetica', size: 12, color: [0, 0, 0], bold: false, italic: false, align: 'left', ...(saved || {}), touched: {} };
        if (S.style.font === 'original') S.style.font = 'Helvetica';
        app.viewer.setMode('tool', 'text');
        renderBar();
        S.unsub.push(app.bus.on('page:rendered', ({ pageIndex }) => { if (S.draft && S.draft.pageIndex === pageIndex) mount(); }));
        S.unsub.push(app.bus.on('document:activated', () => app.tools.deactivate()));
        S.down = (e) => { if (e.target.closest?.('.leggio-overlay')) onDown(e); };
        app.viewer.container.addEventListener('mousedown', S.down);
      },
      deactivate() {
        if (S.draft) commit();
        S.unsub.forEach((u) => u()); S.unsub = [];
        app.viewer.container.removeEventListener('mousedown', S.down);
        clearLayers(app, LAYER); S.bar = null;
      },
    },
  };
}

// ------------------------------------------------------------------ aggiungi immagine

export function addImageTool(app) {
  const { h } = app.ui;
  const S = { img: null, bar: null, unsub: [] };
  const LAYER = 'lgm-addimg';

  async function pick() {
    const files = await app.platform.openFiles({ multiple: false, filters: [{ name: 'Immagini', extensions: ['png', 'jpg', 'jpeg'] }] });
    if (!files?.length) return false;
    const bytes = files[0].bytes;
    const isPng = bytes[0] === 0x89 && bytes[1] === 0x50, isJpg = bytes[0] === 0xff && bytes[1] === 0xd8;
    if (!isPng && !isJpg) { app.ui.toast('Formato non supportato: scegli un\'immagine PNG o JPEG.', { kind: 'error' }); return false; }
    let w = 100, hh = 100, url = null;
    try {
      const blob = new Blob([bytes], { type: isPng ? 'image/png' : 'image/jpeg' });
      const bmp = await createImageBitmap(blob); w = bmp.width; hh = bmp.height; bmp.close?.();
      url = URL.createObjectURL(blob);
    } catch { app.ui.toast('Immagine non leggibile.', { kind: 'error' }); return false; }
    const pageIndex = app.viewer.pageIndex;
    const vp = app.viewer.getViewport(pageIndex);
    const pageW = vp.viewBox[2] - vp.viewBox[0], pageH = vp.viewBox[3] - vp.viewBox[1];
    let pw = Math.min(w * 0.75, pageW * 0.4); let ph = pw * hh / w;
    if (ph > pageH * 0.5) { ph = pageH * 0.5; pw = ph * w / hh; }
    const rotation = await pageRotation(app, pageIndex);
    // posizione in coordinate CSS della pagina (centrata nella parte visibile)
    const div = app.viewer.getPageDiv(pageIndex);
    const k = vp.scale;
    const cont = app.viewer.container.getBoundingClientRect(), pr = div.getBoundingClientRect();
    const visTop = Math.max(0, cont.top - pr.top), visBottom = Math.min(pr.height, cont.bottom - pr.top);
    const cxCss = pr.width / 2, cyCss = (visTop + visBottom) / 2;
    if (S.img?.url) URL.revokeObjectURL(S.img.url);
    S.img = { bytes, url, pageIndex, rotation, css: { left: cxCss - pw * k / 2, top: cyCss - ph * k / 2, width: pw * k, height: ph * k }, ratio: pw / ph };
    return true;
  }

  function mount() {
    clearLayers(app, LAYER);
    const I = S.img; if (!I) return;
    const overlay = app.viewer.getOverlay(I.pageIndex); if (!overlay) return;
    const layer = toolLayer(overlay, LAYER);
    const box = h('div', { class: 'lgm-imgbox draft', tabindex: 0, 'aria-label': 'Nuova immagine: trascinala, ridimensionala dagli angoli, Invio per inserire' }, h('img', { src: I.url, alt: '', draggable: 'false' }));
    place(box, I.css);
    for (const c of ['nw', 'ne', 'sw', 'se']) {
      const hd = h('div', { class: 'lgm-handle ' + c });
      hd.addEventListener('mousedown', (e) => { e.stopPropagation(); e.preventDefault(); drag(e, c); });
      box.append(hd);
    }
    box.addEventListener('mousedown', (e) => { if (e.button === 0) { e.stopPropagation(); e.preventDefault(); drag(e, 'move'); } });
    box.addEventListener('keydown', (e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { e.stopPropagation(); app.tools.deactivate(); } });
    layer.append(box);
    box.focus({ preventScroll: true });
    I.box = box;
  }

  function drag(e, mode) {
    const I = S.img; const c0 = { ...I.css }; const x0 = e.clientX, y0 = e.clientY;
    const move = (ev) => {
      const dx = ev.clientX - x0, dy = ev.clientY - y0;
      if (mode === 'move') I.css = { ...c0, left: c0.left + dx, top: c0.top + dy };
      else {
        const sx = mode.includes('e') ? 1 : -1, sy = mode.includes('s') ? 1 : -1;
        const nw = Math.max(16, c0.width + sx * dx);
        const nh = nw / (c0.width / c0.height); // proporzioni mantenute
        I.css = { width: nw, height: nh, left: sx > 0 ? c0.left : c0.left + c0.width - nw, top: sy > 0 ? c0.top : c0.top + c0.height - nh };
      }
      place(I.box, I.css);
    };
    const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
  }

  async function commit() {
    const I = S.img; if (!I) return;
    const vp = app.viewer.getViewport(I.pageIndex);
    const k = vp.scale;
    const c = I.css;
    const [cx, cy] = vp.convertToPdfPoint(c.left + c.width / 2, c.top + c.height / 2);
    // dimensioni "a schermo" in punti PDF; la rotazione della pagina viene compensata
    const swap = I.rotation % 180 !== 0;
    const w = (swap ? c.height : c.width) / k, hh = (swap ? c.width : c.height) / k;
    const ww = swap ? hh : w, hh2 = swap ? w : hh;
    const rect = [cx - ww / 2, cy - hh2 / 2, ww, hh2];
    const bytes = I.bytes;
    const pageIndex = I.pageIndex;
    S.img = null;
    app.tools.deactivate();
    await safePageEdit(app, 'Immagine aggiunta', pageIndex, async (pdfDoc, mode) => { if (mode === 'cover') return false; await addImage(pdfDoc, pageIndex, bytes, rect, I.rotation); return {}; });
  }

  function renderBar() {
    const bar = S.bar; if (!bar) return;
    bar.innerHTML = '';
    bar.append(h('span', { class: 'lgm-hint' }, 'Trascina l\'immagine dove vuoi e ridimensionala dagli angoli (le proporzioni restano uguali).'),
      h('button', { class: 'btn small primary', onclick: () => commit() }, 'Inserisci'),
      h('button', { class: 'btn small', onclick: async () => { if (await pick()) mount(); } }, 'Scegli un\'altra immagine…'));
  }

  return {
    id: 'add-image', name: 'Aggiungi immagine', category: 'modifica', icon: 'image', quick: false,
    description: 'Inserisci un logo, una firma scansionata o una foto (PNG o JPEG) come parte della pagina',
    keywords: 'aggiungi immagine inserisci logo foto png jpg firma scansionata modifica pdf',
    interactive: {
      async activate(appRef, optionsEl) {
        S.bar = optionsEl;
        app.viewer.setMode('tool', 'default');
        if (!(await confirmSigned(app)) || !(await pick())) { setTimeout(() => app.tools.deactivate()); return; }
        renderBar(); mount();
        S.unsub.push(app.bus.on('page:rendered', ({ pageIndex }) => { if (S.img && S.img.pageIndex === pageIndex) { const vp = app.viewer.getViewport(pageIndex); if (S.img.k && S.img.k !== vp.scale) { const f = vp.scale / S.img.k; S.img.css = { left: S.img.css.left * f, top: S.img.css.top * f, width: S.img.css.width * f, height: S.img.css.height * f }; } S.img.k = vp.scale; mount(); } }));
        S.img.k = app.viewer.getViewport(S.img.pageIndex).scale;
        S.unsub.push(app.bus.on('document:activated', () => app.tools.deactivate()));
      },
      deactivate() {
        S.unsub.forEach((u) => u()); S.unsub = [];
        if (S.img?.url) URL.revokeObjectURL(S.img.url);
        S.img = null; clearLayers(app, LAYER); S.bar = null;
      },
    },
  };
}

// ------------------------------------------------------------------ forme

export function shapesTool(app) {
  const { h } = app.ui;
  const S = { kind: 'rect', stroke: [0.85, 0.1, 0.1], fill: null, width: 2, unsub: [] };
  const LAYER = 'lgm-shape';

  function renderBar(bar) {
    bar.innerHTML = '';
    const kind = h('select', { class: 'lgm-sel', 'aria-label': 'Forma' }, [['line', 'Linea'], ['rect', 'Rettangolo'], ['ellipse', 'Ellisse']].map(([v, l]) => h('option', { value: v, selected: S.kind === v }, l)));
    kind.addEventListener('change', () => (S.kind = kind.value));
    const stroke = h('input', { type: 'color', value: rgbToHex(S.stroke), 'aria-label': 'Colore del bordo', title: 'Colore del bordo' });
    stroke.addEventListener('input', () => (S.stroke = cssToRgb(stroke.value)));
    const hasFill = h('input', { type: 'checkbox', checked: !!S.fill, id: 'lgm-fill' });
    const fill = h('input', { type: 'color', value: rgbToHex(S.fill || [1, 1, 0.6]), 'aria-label': 'Colore di riempimento', title: 'Colore di riempimento' });
    const syncFill = () => (S.fill = hasFill.checked ? cssToRgb(fill.value) : null);
    hasFill.addEventListener('change', syncFill); fill.addEventListener('input', syncFill);
    const width = h('input', { class: 'lgm-num', type: 'number', min: 0.25, max: 20, step: 0.25, value: S.width, 'aria-label': 'Spessore', title: 'Spessore (punti)' });
    width.addEventListener('change', () => (S.width = Math.max(0.25, parseFloat(width.value) || 1)));
    bar.append(kind, h('label', { class: 'lgm-lbl' }, 'Bordo', stroke), width, h('label', { class: 'lgm-lbl', for: 'lgm-fill' }, hasFill, 'Riempimento', fill), h('span', { class: 'lgm-hint' }, 'Trascina sulla pagina per disegnare.'));
  }

  function onDown(e) {
    if (e.button !== 0) return;
    const pageIndex = pageOfEvent(e); if (pageIndex < 0) return;
    e.preventDefault();
    const p0 = app.viewer.clientToPdf(pageIndex, e.clientX, e.clientY);
    const overlay = app.viewer.getOverlay(pageIndex);
    const layer = toolLayer(overlay, LAYER);
    const ghost = h('div', { class: 'lgm-ghost ' + S.kind });
    layer.append(ghost);
    let p1 = p0;
    const move = (ev) => {
      p1 = app.viewer.clientToPdf(pageIndex, ev.clientX, ev.clientY);
      if (ev.shiftKey && S.kind !== 'line') { const d = Math.max(Math.abs(p1[0] - p0[0]), Math.abs(p1[1] - p0[1])); p1 = [p0[0] + Math.sign(p1[0] - p0[0]) * d, p0[1] + Math.sign(p1[1] - p0[1]) * d]; }
      place(ghost, rectToCss(app, pageIndex, [p0[0], p0[1], p1[0], p1[1]]));
    };
    const up = async () => {
      window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up);
      ghost.remove();
      if (Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) < 2) return;
      const sh = { kind: S.kind, x1: p0[0], y1: p0[1], x2: p1[0], y2: p1[1], stroke: S.stroke, fill: S.kind === 'line' ? null : S.fill, width: S.width };
      await safePageEdit(app, 'Forma disegnata', pageIndex, (pdfDoc, mode) => { if (mode === 'cover') return false; addShape(pdfDoc, pageIndex, sh); return {}; });
    };
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
  }

  return {
    id: 'draw-shapes', name: 'Disegna forme', category: 'modifica', icon: 'shape',
    description: 'Linee, rettangoli ed ellissi come parte della pagina (non commenti)',
    keywords: 'forme linea rettangolo cerchio ellisse disegna riquadro modifica pdf',
    interactive: {
      activate(appRef, optionsEl) {
        app.viewer.setMode('tool', 'crosshair');
        renderBar(optionsEl);
        S.down = (e) => { if (e.target.closest?.('.leggio-overlay')) onDown(e); };
        app.viewer.container.addEventListener('mousedown', S.down);
      },
      deactivate() { app.viewer.container.removeEventListener('mousedown', S.down); clearLayers(app, LAYER); },
    },
  };
}
