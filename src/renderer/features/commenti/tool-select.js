// Area «commenti» — «Seleziona commenti»: clic su un commento (anche creato da altri programmi) per
// selezionarlo, spostarlo, ridimensionarlo, cambiarne colore e testo, rispondere, impostare lo stato, eliminarlo.
import { PALETTE, distToPolyline, pointInRect, normRect } from './geom.js';
import { updateAnnot, deleteAnnots, addReply, setStatus, STATE_LABELS, TYPE_LABELS } from './annots.js';
import { S, author, edit, overlayOf, eventPoint, cssRectToPdf, pageComments, rgb } from './ui-common.js';
import { editFreeTextInline } from './tools-draw.js';

const state = { sel: null, app: null }; // sel: { key, pageIndex, comment }

/** Commento più in alto sotto il punto PDF (salta risposte e nascosti). */
export function hitTest(list, px, py, tol) {
  for (let i = list.length - 1; i >= 0; i--) {
    const c = list[i];
    if (c.irt || c.hidden) continue;
    if (!pointInRect(px, py, c.rect, tol)) continue;
    if (c.type === 'Ink' && c.inkList?.length) { if (c.inkList.some((s) => distToPolyline(px, py, s) <= tol * 2)) return c; continue; }
    if (c.type === 'Line' && c.line) { if (distToPolyline(px, py, [[c.line[0], c.line[1]], [c.line[2], c.line[3]]]) <= tol * 2) return c; continue; }
    if (c.type === 'PolyLine' && c.vertices) { if (distToPolyline(px, py, c.vertices) <= tol * 2) return c; continue; }
    if (c.quadPoints) {
      const q = c.quadPoints; let hit = false;
      for (let k = 0; k + 7 < q.length; k += 8) { const r = normRect([Math.min(q[k], q[k + 4]), Math.min(q[k + 5], q[k + 7]), Math.max(q[k + 2], q[k + 6]), Math.max(q[k + 1], q[k + 3])]); if (r && pointInRect(px, py, r, tol)) hit = true; }
      if (hit) return c; continue;
    }
    return c;
  }
  return null;
}

const target = (c) => ({ key: c.key, pageIndex: c.pageIndex, rect: c.rect, type: c.type });
const canResize = (c) => !['Text', 'Highlight', 'Underline', 'StrikeOut', 'Squiggly', 'Caret', 'FileAttachment', 'Sound'].includes(c.type);

/** Azioni comuni su un commento (usate da selezione, menu contestuale e pannello). */
export const actions = {
  async del(app, c) { const ok = await edit(app, `${TYPE_LABELS[c.type] || 'Commento'} eliminato`, (pdfDoc) => (deleteAnnots(pdfDoc, [target(c)]) ? undefined : false)); if (ok) clearSelection(); return ok; },
  async color(app, c, hex) { return edit(app, 'Colore cambiato', (pdfDoc) => updateAnnot(pdfDoc, target(c), { color: rgb(hex) })); },
  async text(app, c) {
    const v = await app.ui.dialog({ title: 'Testo del commento', fields: [{ name: 't', label: `${TYPE_LABELS[c.type] || 'Commento'}${c.author ? ' di ' + c.author : ''}`, type: 'textarea', rows: 6, value: c.text }], okLabel: 'Salva' });
    if (!v || v.t === c.text) return false;
    return edit(app, 'Testo del commento modificato', (pdfDoc) => updateAnnot(pdfDoc, target(c), { text: v.t }));
  },
  async reply(app, c, text) {
    let t = text;
    if (t == null) { const v = await app.ui.dialog({ title: 'Rispondi', message: c.text ? `«${c.text.slice(0, 200)}»` : '', fields: [{ name: 't', label: 'La tua risposta', type: 'textarea', rows: 4 }], okLabel: 'Rispondi' }); if (!v) return false; t = v.t; }
    if (!String(t).trim()) { app.ui.toast('Scrivi il testo della risposta', { kind: 'warning' }); return false; }
    const who = await author(app);
    return edit(app, 'Risposta aggiunta', (pdfDoc) => addReply(pdfDoc, target(c), { author: who, text: t }));
  },
  async status(app, c, st) {
    const who = await author(app);
    return edit(app, 'Stato: ' + STATE_LABELS[st], (pdfDoc) => setStatus(pdfDoc, target(c), { author: who, state: st }));
  },
  async move(app, c, dx, dy) { return edit(app, 'Commento spostato', (pdfDoc) => updateAnnot(pdfDoc, target(c), { translate: [dx, dy] })); },
  async resize(app, c, rect) { return edit(app, 'Commento ridimensionato', (pdfDoc) => updateAnnot(pdfDoc, target(c), { rect })); },
};

export function statusMenuItems(app, c) {
  return ['Completed', 'Accepted', 'Rejected', 'Cancelled', 'None'].map((s) => ({ label: s === 'None' ? 'Nessuno stato' : STATE_LABELS[s], run: () => actions.status(app, c, s) }));
}
export function contextItems(app, c) {
  return [
    { label: 'Modifica testo…', icon: 'text', run: () => (c.type === 'FreeText' ? startInlineEdit(app, c) : actions.text(app, c)) },
    { label: 'Rispondi…', icon: 'comment', run: () => actions.reply(app, c) },
    '-',
    ...statusMenuItems(app, c).map((x) => ({ ...x, label: 'Stato: ' + x.label })),
    '-',
    { label: 'Elimina', icon: 'trash', danger: true, hint: 'Canc', run: () => actions.del(app, c) },
  ];
}

export function clearSelection() { state.sel = null; document.querySelectorAll('.lg-sel, .lg-selmenu').forEach((e) => e.remove()); }

/** Seleziona un commento (dal pannello): attiva lo strumento e lo evidenzia. */
export async function selectComment(app, c) {
  if (app.tools.active?.id !== 'comments-select') app.tools.run('comments-select');
  state.sel = { key: c.key, pageIndex: c.pageIndex, comment: c };
  app.viewer.scrollToPdfPoint(c.pageIndex, c.rect[0] - 40, c.rect[3] + 60);
  drawSelection(app);
}

async function startInlineEdit(app, c) {
  const ov = app.viewer.getOverlay(c.pageIndex);
  if (!ov) return;
  document.querySelectorAll('.lg-sel, .lg-selmenu').forEach((e) => e.remove());
  await editFreeTextInline(app, ov, c);
}

function drawSelection(app) {
  document.querySelectorAll('.lg-sel, .lg-selmenu').forEach((e) => e.remove());
  const s = state.sel; if (!s) return;
  const ov = app.viewer.getOverlay(s.pageIndex); if (!ov) return;
  const H = app.ui.h;
  const c = s.comment;
  const r = app.viewer.pdfRectToCss(s.pageIndex, c.rect);
  const box = H('div', { class: 'lg-sel', 'data-key': c.key, style: { left: r.left + 'px', top: r.top + 'px', width: Math.max(8, r.width) + 'px', height: Math.max(8, r.height) + 'px' }, tabindex: -1, 'aria-label': `${TYPE_LABELS[c.type] || 'Commento'} selezionato` });
  if (canResize(c)) for (const hd of ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']) box.append(H('span', { class: 'lg-h lg-h-' + hd, 'data-h': hd }));
  ov.append(box);
  // barra comandi con etichette sopra la selezione
  const menu = H('div', { class: 'lg-selmenu', role: 'toolbar', 'aria-label': 'Comandi del commento' },
    H('span', { class: 'lg-selmenu-t' }, `${TYPE_LABELS[c.type] || c.type}${c.author ? ' · ' + c.author : ''}`),
    ...(c.type !== 'Stamp' ? PALETTE.slice(0, 6).map((hex) => H('button', { class: 'lg-dot', title: 'Colore ' + hex, 'aria-label': 'Colore ' + hex, style: { background: hex }, onclick: () => actions.color(app, c, hex) })) : []),
    H('button', { class: 'lg-tbtn', onclick: () => (c.type === 'FreeText' ? startInlineEdit(app, c) : actions.text(app, c)) }, c.type === 'FreeText' ? 'Modifica testo' : 'Commento…'),
    H('button', { class: 'lg-tbtn', onclick: () => actions.reply(app, c) }, 'Rispondi'),
    H('button', { class: 'lg-tbtn', onclick: (e) => { const b = e.currentTarget.getBoundingClientRect(); app.ui.contextMenu(b.left, b.bottom + 4, statusMenuItems(app, c)); } }, 'Stato ▾'),
    H('button', { class: 'lg-tbtn danger', onclick: () => actions.del(app, c), title: 'Elimina (Canc)' }, 'Elimina'));
  menu.addEventListener('pointerdown', (e) => e.stopPropagation());
  ov.append(menu);
  const mTop = r.top - menu.offsetHeight - 8;
  menu.style.top = (mTop < 0 ? r.top + r.height + 8 : mTop) + 'px';
  menu.style.left = Math.max(0, Math.min(ov.clientWidth - menu.offsetWidth, r.left)) + 'px';
}

export function selectTool(app) {
  let cleanup = null;
  state.app = app;
  return {
    id: 'comments-select', name: 'Seleziona commenti', category: 'commenta', icon: 'pointer', quick: true, quickOrder: 19,
    description: 'Clic su un commento per spostarlo, ridimensionarlo, cambiarne colore o testo, rispondere o eliminarlo.',
    keywords: 'seleziona commento modifica sposta ridimensiona elimina annotazione proprietà commento strumento selezione oggetti',
    interactive: {
      activate(_, opts) {
        const H = app.ui.h;
        opts.append(H('span', { class: 'lg-hint' }, 'Clic su un commento per selezionarlo. Trascina per spostarlo; maniglie per ridimensionare; frecce per spostare di poco; Canc per eliminare.'));
        app.viewer.setMode('tool', 'default');
        const c = app.viewer.container;
        let drag = null;
        let nudge = null; // spostamento con le frecce, applicato dopo una pausa
        const onDown = async (e) => {
          const ov = overlayOf(e.target); if (!ov || e.button > 2) return;
          if (e.target.closest('.lg-selmenu, .lg-inline')) return;
          const pi = +ov.dataset.pageIndex;
          const p = eventPoint(app, ov, e);
          const handle = e.target.closest('.lg-h')?.dataset.h;
          const onBox = e.target.closest('.lg-sel');
          if (state.sel && onBox && state.sel.pageIndex === pi) {
            if (e.button === 2) return;
            e.preventDefault(); ov.setPointerCapture(e.pointerId);
            const r = app.viewer.pdfRectToCss(pi, state.sel.comment.rect);
            drag = { ov, pi, start: p, handle, r, box: onBox, moved: false };
            return;
          }
          const list = await pageComments(app, pi);
          const hit = hitTest(list, p.px, p.py, 4 / app.viewer.scale);
          if (!hit) { clearSelection(); return; }
          state.sel = { key: hit.key, pageIndex: pi, comment: hit };
          drawSelection(app);
          if (e.button === 2) return;
          e.preventDefault();
          const box = ov.querySelector('.lg-sel');
          ov.setPointerCapture(e.pointerId);
          drag = { ov, pi, start: p, handle: null, r: app.viewer.pdfRectToCss(pi, hit.rect), box, moved: false };
        };
        const onMove = (e) => {
          if (!drag) return;
          const q = eventPoint(app, drag.ov, e);
          const dx = q.x - drag.start.x, dy = q.y - drag.start.y;
          if (!drag.moved && Math.hypot(dx, dy) < 3) return;
          drag.moved = true;
          let { left, top, width, height } = drag.r;
          const hd = drag.handle;
          if (!hd) { left += dx; top += dy; }
          else {
            if (hd.includes('w')) { left += dx; width -= dx; }
            if (hd.includes('e')) width += dx;
            if (hd.includes('n')) { top += dy; height -= dy; }
            if (hd.includes('s')) height += dy;
            if (e.shiftKey && hd.length === 2) { const k = drag.r.width / drag.r.height; if (width / height > k) width = height * k; else height = width / k; }
            if (width < 0) { left += width; width = -width; }
            if (height < 0) { top += height; height = -height; }
          }
          drag.css = { left, top, width: Math.max(4, width), height: Math.max(4, height) };
          Object.assign(drag.box.style, { left: left + 'px', top: top + 'px', width: drag.css.width + 'px', height: drag.css.height + 'px' });
          drag.ov.querySelector('.lg-selmenu')?.classList.add('lg-hidden');
        };
        const onUp = async (e) => {
          if (!drag) return;
          const d = drag; drag = null;
          if (!d.moved || !state.sel) { d.ov.querySelector('.lg-selmenu')?.classList.remove('lg-hidden'); return; }
          const sel = state.sel.comment;
          if (!d.handle) {
            const a = app.viewer.getViewport(d.pi).convertToPdfPoint(d.start.x, d.start.y);
            const q = eventPoint(app, d.ov, e);
            await actions.move(app, sel, q.px - a[0], q.py - a[1]);
          } else {
            await actions.resize(app, sel, cssRectToPdf(app, d.pi, d.css));
          }
        };
        const onDbl = (e) => {
          const ov = overlayOf(e.target); if (!ov || !state.sel) return;
          const cm = state.sel.comment;
          if (cm.type === 'FreeText') startInlineEdit(app, cm); else actions.text(app, cm);
        };
        const onCtx = (e) => {
          if (!overlayOf(e.target) || !state.sel) return;
          e.preventDefault();
          app.ui.contextMenu(e.clientX, e.clientY, contextItems(app, state.sel.comment));
        };
        const onKey = (e) => {
          if (!state.sel || e.target.closest?.('input, textarea, select, [contenteditable]')) return;
          if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); actions.del(app, state.sel.comment); }
          const arrows = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
          if (arrows) {
            e.preventDefault();
            const step = e.shiftKey ? 10 : 1; // pixel a schermo
            nudge ||= { dx: 0, dy: 0 };
            nudge.dx += arrows[0] * step; nudge.dy += arrows[1] * step;
            const box = document.querySelector('.lg-sel');
            if (box) { box.style.left = parseFloat(box.style.left) + arrows[0] * step + 'px'; box.style.top = parseFloat(box.style.top) + arrows[1] * step + 'px'; }
            clearTimeout(nudge.t);
            nudge.t = setTimeout(async () => {
              const n = nudge; nudge = null;
              const pi = state.sel.pageIndex; const vp = app.viewer.getViewport(pi);
              const a = vp.convertToPdfPoint(0, 0), b = vp.convertToPdfPoint(n.dx, n.dy);
              await actions.move(app, state.sel.comment, b[0] - a[0], b[1] - a[1]);
            }, 500);
          }
        };
        c.addEventListener('pointerdown', onDown); c.addEventListener('pointermove', onMove); c.addEventListener('pointerup', onUp); c.addEventListener('dblclick', onDbl); c.addEventListener('contextmenu', onCtx);
        document.addEventListener('keydown', onKey);
        // dopo ogni modifica il documento si ricarica: ritroviamo la selezione per chiave
        const offR = app.bus.on('page:rendered', async ({ pageIndex }) => {
          if (!state.sel || state.sel.pageIndex !== pageIndex) return;
          const list = await pageComments(app, pageIndex);
          const again = list.find((x) => x.key === state.sel?.key);
          if (again) { state.sel.comment = again; drawSelection(app); } else clearSelection();
        });
        drawSelection(app);
        cleanup = () => {
          c.removeEventListener('pointerdown', onDown); c.removeEventListener('pointermove', onMove); c.removeEventListener('pointerup', onUp); c.removeEventListener('dblclick', onDbl); c.removeEventListener('contextmenu', onCtx);
          document.removeEventListener('keydown', onKey); offR(); clearSelection();
        };
      },
      deactivate() { cleanup?.(); cleanup = null; },
    },
  };
}
export { S };
