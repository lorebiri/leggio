// Area «commenti» — Evidenzia testo (con varianti Sottolinea, Barra, Ondulato, Inserisci testo, Evidenzia area)
// e barretta rapida che compare quando si seleziona del testo (evidenziare con un solo gesto).
import { mergeLineRects, linesToQuadPoints, HIGHLIGHT_PALETTE, PALETTE, normRect, unionRect } from './geom.js';
import { createAnnot } from './annots.js';
import { S, setS, author, edit, swatchRow, segmented, rangeOpt, rgb, overlayOf, eventPoint, cssRectToPdf, previewSvg, svgEl } from './ui-common.js';

export const MARKUP_KINDS = [
  { value: 'Highlight', label: 'Evidenzia' },
  { value: 'Underline', label: 'Sottolinea' },
  { value: 'StrikeOut', label: 'Barra' },
  { value: 'Squiggly', label: 'Ondulato' },
  { value: 'Caret', label: 'Inserisci testo' },
  { value: 'Area', label: 'Evidenzia area' },
];
const DEFAULT_COLOR = { Highlight: '#ffd400', Underline: '#1c7ed6', StrikeOut: '#e03131', Squiggly: '#2f9e44', Caret: '#1c7ed6', Area: '#ffd400' };
const colorOf = (app, kind) => S(app, 'markup.color.' + kind, DEFAULT_COLOR[kind]);

/** Rettangoli della selezione corrente raggruppati per pagina: Map(pageIndex → { lines, text }). */
export function selectionByPage(app) {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
  const byPage = new Map();
  for (let r = 0; r < sel.rangeCount; r++) {
    const range = sel.getRangeAt(r);
    let root = range.commonAncestorContainer;
    if (root.nodeType !== 1) root = root.parentNode;
    if (!root.closest?.('.pdfViewer')) continue;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode: (n) => (range.intersectsNode(n) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT) });
    let node;
    while ((node = walker.nextNode())) {
      const tl = node.parentElement?.closest('.textLayer');
      if (!tl || node.parentElement.classList.contains('endOfContent')) continue;
      const pageDiv = tl.closest('.page');
      const pageIndex = +pageDiv?.dataset.pageNumber - 1;
      if (!(pageIndex >= 0)) continue;
      const sub = document.createRange();
      sub.selectNodeContents(node);
      if (node === range.startContainer) sub.setStart(node, range.startOffset);
      if (node === range.endContainer) sub.setEnd(node, range.endOffset);
      const str = sub.toString();
      if (!str.trim()) continue;
      let entry = byPage.get(pageIndex);
      if (!entry) { entry = { rects: [], text: '' }; byPage.set(pageIndex, entry); }
      if (entry.text && !/\s$/.test(entry.text) && !/^\s/.test(str)) entry.text += ' ';
      entry.text += str;
      for (const cr of sub.getClientRects()) {
        if (cr.width < 0.5 || cr.height < 0.5) continue;
        const a = app.viewer.clientToPdf(pageIndex, cr.left, cr.top), b = app.viewer.clientToPdf(pageIndex, cr.right, cr.bottom);
        if (a && b) entry.rects.push(normRect([...a, ...b]));
      }
    }
  }
  for (const [p, e] of byPage) {
    // /Rotate della pagina: sulle pagine ruotate le righe sono verticali nello spazio PDF
    e.rotation = app.viewer.pdfViewer?.getPageView?.(p)?.pdfPage?.rotate || 0;
    e.lines = mergeLineRects(e.rects, e.rotation);
    if (!e.lines.length) byPage.delete(p);
  }
  return byPage.size ? byPage : null;
}

/** Crea l'annotazione di testo (o il segno di inserimento) sulla selezione corrente. */
export async function markupSelection(app, kind, { color, opacity } = {}) {
  const groups = selectionByPage(app);
  if (!groups) { app.ui.toast('Seleziona prima del testo nella pagina', { kind: 'warning' }); return false; }
  const who = await author(app);
  const c = rgb(color || colorOf(app, kind));
  const op = opacity ?? (kind === 'Highlight' ? S(app, 'markup.opacity', 1) : 1);
  let note = '';
  if (kind === 'Caret') {
    note = await app.ui.prompt('Testo da inserire (facoltativo):', '', { title: 'Inserisci testo', okLabel: 'Aggiungi' });
    if (note == null) return false;
  }
  const label = { Highlight: 'Testo evidenziato', Underline: 'Testo sottolineato', StrikeOut: 'Testo barrato', Squiggly: 'Testo sottolineato (ondulato)', Caret: 'Segno di inserimento aggiunto' }[kind];
  window.getSelection()?.removeAllRanges();
  return edit(app, label, async (pdfDoc) => {
    for (const [pageIndex, g] of groups) {
      if (kind === 'Caret') {
        const last = g.lines[g.lines.length - 1];
        const h = Math.max(6, last[3] - last[1]);
        await createAnnot(pdfDoc, pageIndex, { type: 'Caret', rect: [last[2] - h * 0.35, last[1] - h * 0.25, last[2] + h * 0.35, last[1] + h * 0.45], color: c, text: note || '' }, { author: who });
      } else {
        await createAnnot(pdfDoc, pageIndex, { type: kind, quadPoints: linesToQuadPoints(g.lines, g.rotation), color: c, opacity: op, text: g.text.replace(/\s+/g, ' ').trim().slice(0, 2000) }, { author: who });
      }
    }
  });
}

// ---------------------------------------------------------------- strumento «Evidenzia testo»
export function highlightTool(app) {
  let off = [];
  let kind = S(app, 'markup.kind', 'Highlight');
  return {
    id: 'highlight', name: 'Evidenzia testo', category: 'commenta', icon: 'highlight', quick: true, quickOrder: 20, shortcut: 'e',
    description: 'Evidenzia, sottolinea o barra il testo selezionato. Resta attivo finché non premi Fine.',
    keywords: 'evidenziatore evidenzia testo sottolinea barra barrato ondulato inserisci commento markup highlight underline strikeout',
    interactive: {
      activate(app2, opts) {
        const H = app.ui.h;
        const render = () => {
          opts.innerHTML = '';
          opts.append(segmented(app, { items: MARKUP_KINDS, value: kind, label: 'Tipo', onPick: (v) => { kind = v; setS(app, 'markup.kind', v); render(); applyMode(); } }));
          opts.append(swatchRow(app, { palette: kind === 'Highlight' || kind === 'Area' ? HIGHLIGHT_PALETTE : PALETTE, value: colorOf(app, kind), onPick: (c) => setS(app, 'markup.color.' + kind, c) }));
          if (kind === 'Highlight' || kind === 'Area') opts.append(rangeOpt(app, { label: 'Opacità', min: 0.2, max: 1, step: 0.05, value: S(app, 'markup.opacity', 1), onChange: (v) => setS(app, 'markup.opacity', v) }));
          opts.append(H('span', { class: 'lg-hint' }, kind === 'Area' ? 'Trascina un riquadro sulla pagina.' : 'Seleziona il testo col mouse: viene segnato subito.'));
        };
        const applyMode = () => app.viewer.setMode(kind === 'Area' ? 'tool' : 'select', kind === 'Area' ? 'crosshair' : 'text');
        render(); applyMode();
        const c = app.viewer.container;
        // testo: alla fine della selezione si crea subito il segno
        const onUp = (e) => {
          if (kind === 'Area' || e.button !== 0) return;
          setTimeout(() => { if (selectionByPage(app)) markupSelection(app, kind); }, 0);
        };
        // area: trascinamento di un riquadro
        let drag = null;
        const onDown = (e) => {
          if (kind !== 'Area' || e.button !== 0) return;
          const ov = overlayOf(e.target); if (!ov) return;
          e.preventDefault(); ov.setPointerCapture(e.pointerId);
          const p = eventPoint(app, ov, e);
          const svg = previewSvg(ov);
          const r = svgEl('rect', { class: 'lg-ghost', fill: colorOf(app, 'Area'), 'fill-opacity': 0.4 });
          svg.append(r);
          drag = { ov, p, r };
        };
        const onMove = (e) => {
          if (!drag) return;
          const q = eventPoint(app, drag.ov, e);
          const x = Math.min(q.x, drag.p.x), y = Math.min(q.y, drag.p.y);
          Object.entries({ x, y, width: Math.abs(q.x - drag.p.x), height: Math.abs(q.y - drag.p.y) }).forEach(([k, v]) => drag.r.setAttribute(k, v));
          drag.box = { left: x, top: y, width: Math.abs(q.x - drag.p.x), height: Math.abs(q.y - drag.p.y) };
        };
        const onEnd = async () => {
          if (!drag) return;
          const d = drag; drag = null; d.r.remove();
          if (!d.box || d.box.width < 4 || d.box.height < 4) return;
          const pi = +d.ov.dataset.pageIndex;
          const [x1, y1, x2, y2] = cssRectToPdf(app, pi, d.box);
          const who = await author(app);
          await edit(app, 'Area evidenziata', (pdfDoc) => createAnnot(pdfDoc, pi, { type: 'Highlight', quadPoints: [x1, y2, x2, y2, x1, y1, x2, y1], color: rgb(colorOf(app, 'Area')), opacity: S(app, 'markup.opacity', 1) }, { author: who }));
        };
        c.addEventListener('pointerup', onUp);
        c.addEventListener('pointerdown', onDown);
        c.addEventListener('pointermove', onMove);
        c.addEventListener('pointerup', onEnd);
        c.addEventListener('pointercancel', onEnd);
        off = [() => c.removeEventListener('pointerup', onUp), () => c.removeEventListener('pointerdown', onDown), () => c.removeEventListener('pointermove', onMove), () => c.removeEventListener('pointerup', onEnd), () => c.removeEventListener('pointercancel', onEnd)];
      },
      deactivate() { off.forEach((f) => f()); off = []; },
    },
  };
}

// ---------------------------------------------------------------- barretta rapida sulla selezione
export function installSelectionBar(app) {
  const H = app.ui.h;
  let bar = null;
  const hide = () => { bar?.remove(); bar = null; };
  const show = () => {
    hide();
    if (app.tools.active || app.viewer.mode !== 'select' || !S(app, 'selectionBar', true)) return;
    const groups = selectionByPage(app);
    if (!groups) return;
    const sel = window.getSelection();
    const rects = sel.getRangeAt(sel.rangeCount - 1).getClientRects();
    const last = rects[rects.length - 1];
    if (!last) return;
    const recent = S(app, 'recentHighlight', HIGHLIGHT_PALETTE.slice(0, 4));
    const act = (kind, color) => async () => { hide(); if (kind === 'Highlight' && color) setS(app, 'recentHighlight', [color, ...recent.filter((c) => c !== color)].slice(0, 4)); await markupSelection(app, kind, { color }); };
    bar = H('div', { class: 'lg-selbar', role: 'toolbar', 'aria-label': 'Azioni sul testo selezionato' },
      H('span', { class: 'lg-selbar-label' }, 'Evidenzia'),
      ...[...new Set([...recent, ...HIGHLIGHT_PALETTE])].slice(0, 5).map((c) => H('button', { class: 'lg-dot', title: 'Evidenzia con questo colore', 'aria-label': 'Evidenzia ' + c, style: { background: c }, onclick: act('Highlight', c) })),
      H('span', { class: 'lg-sep' }),
      H('button', { class: 'lg-tbtn', onclick: act('Underline') }, 'Sottolinea'),
      H('button', { class: 'lg-tbtn', onclick: act('StrikeOut') }, 'Barra'),
      H('button', { class: 'lg-tbtn', onclick: async () => { hide(); await noteOnSelection(app, groups); } }, 'Nota'),
      H('button', { class: 'lg-tbtn', onclick: () => { navigator.clipboard?.writeText(sel.toString()); hide(); app.ui.toast('Testo copiato'); } }, 'Copia'));
    bar.addEventListener('pointerdown', (e) => e.preventDefault()); // non perdere la selezione
    bar.addEventListener('mousedown', (e) => e.preventDefault());
    document.getElementById('overlay-root').append(bar);
    const bw = bar.offsetWidth, bh = bar.offsetHeight;
    let x = Math.min(innerWidth - bw - 8, Math.max(8, last.right - bw / 2));
    let y = last.bottom + 10; if (y + bh > innerHeight - 8) y = rects[0].top - bh - 10;
    Object.assign(bar.style, { left: x + 'px', top: y + 'px' });
  };
  const c = app.viewer.container;
  c.addEventListener('pointerup', (e) => { if (e.button === 0) setTimeout(show, 10); });
  c.addEventListener('pointerdown', (e) => { if (!bar?.contains(e.target)) hide(); });
  c.addEventListener('scroll', hide, { passive: true });
  document.addEventListener('selectionchange', () => { if (bar && window.getSelection()?.isCollapsed) hide(); });
  app.bus.on('tool:activated', hide);
  app.bus.on('document:activated', hide);
  // tasto destro sul testo selezionato: comandi come in Acrobat
  c.addEventListener('contextmenu', (e) => {
    if (app.tools.active && app.tools.active.id !== 'highlight') return;
    const groups = selectionByPage(app);
    if (!groups) return;
    e.preventDefault(); hide();
    const txt = window.getSelection().toString();
    app.ui.contextMenu(e.clientX, e.clientY, [
      { label: 'Copia', icon: 'file', run: () => navigator.clipboard?.writeText(txt) },
      '-',
      { label: 'Evidenzia testo', icon: 'highlight', run: () => markupSelection(app, 'Highlight') },
      { label: 'Sottolinea testo', icon: 'text', run: () => markupSelection(app, 'Underline') },
      { label: 'Barra testo', icon: 'text', run: () => markupSelection(app, 'StrikeOut') },
      { label: 'Aggiungi nota al testo', icon: 'note', run: () => noteOnSelection(app, groups) },
    ]);
  });
}

/** Evidenzia il testo e chiede subito il commento collegato. */
async function noteOnSelection(app, groups) {
  const txt = await app.ui.dialog({ title: 'Nota sul testo selezionato', fields: [{ name: 't', label: 'Commento', type: 'textarea', rows: 5, value: '' }], okLabel: 'Aggiungi' });
  if (!txt) return;
  const who = await author(app);
  window.getSelection()?.removeAllRanges();
  await edit(app, 'Nota aggiunta al testo', async (pdfDoc) => {
    for (const [pageIndex, g] of groups) {
      await createAnnot(pdfDoc, pageIndex, { type: 'Highlight', quadPoints: linesToQuadPoints(g.lines, g.rotation), color: rgb(colorOf(app, 'Highlight')), opacity: S(app, 'markup.opacity', 1), text: txt.t }, { author: who });
      break; // un solo commento anche se la selezione attraversa più pagine
    }
  });
}
export { unionRect };
