// Area «commenti» — Nota, Casella di testo, Disegno a mano libera (con gomma), Forme.
import { PALETTE, simplify, smooth, eraseFromStrokes, rectFromPoints, normRect, r2 } from './geom.js';
import { createAnnot, updateAnnot, deleteAnnots } from './annots.js';
import { S, setS, author, edit, swatchRow, segmented, rangeOpt, selectOpt, rgb, overlayOf, eventPoint, cssRectToPdf, pdfToCss, previewSvg, svgEl, pageComments } from './ui-common.js';

// ---------------------------------------------------------------- editor di testo in pagina
/**
 * Area di testo sopra la pagina che si allarga mentre si scrive. → Promise<{ text, box } | null>
 * box in CSS della pagina. Invio+Ctrl/⌘ o clic fuori = conferma; Esc = annulla.
 */
let openEditor = null; // finish() dell'editor aperto
/** Conferma l'editor di testo aperto (se c'è). → true se ce n'era uno. */
export function commitOpenEditor() { if (!openEditor) return false; openEditor(true); return true; }
export function inlineEditor(app, ov, { left, top, width = 0, value = '', fontPx = 16, color = '#000', bg = 'transparent', border = '#e03131', minW = 120, placeholder = 'Scrivi qui…' }) {
  return new Promise((resolve) => {
    const H = app.ui.h;
    const ta = H('textarea', { class: 'lg-inline', placeholder, 'aria-label': 'Testo del commento', spellcheck: 'true' });
    ta.value = value;
    Object.assign(ta.style, { left: left + 'px', top: top + 'px', fontSize: fontPx + 'px', color, background: bg === 'none' ? 'rgba(255,255,255,.85)' : bg, borderColor: border, minWidth: Math.max(minW, width) + 'px' });
    const pageW = ov.clientWidth;
    const meas = document.createElement('canvas').getContext('2d');
    meas.font = `${fontPx}px Helvetica, Arial, sans-serif`;
    const grow = () => {
      const longest = Math.max(0, ...ta.value.split('\n').map((l) => meas.measureText(l + 'M').width));
      const w = Math.max(40, Math.min(pageW - left - 4, Math.max(minW, width, longest + 10)));
      ta.style.width = w + 'px';
      ta.style.height = '0px';
      ta.style.height = ta.scrollHeight + 2 + 'px';
    };
    let done = false;
    const finish = (ok) => {
      if (done) return; done = true; openEditor = null;
      const box = { left, top, width: ta.offsetWidth, height: ta.offsetHeight };
      ta.remove(); offR();
      resolve(ok && ta.value.trim() ? { text: ta.value.replace(/\s+$/, ''), box } : null);
    };
    ta.addEventListener('input', grow);
    ta.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') finish(false);
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) finish(true);
    });
    ta.addEventListener('pointerdown', (e) => e.stopPropagation());
    ta.addEventListener('blur', () => setTimeout(() => finish(true), 0));
    // se la pagina viene ridisegnata (zoom) l'editor si conferma
    const offR = app.bus.on('page:rendered', ({ pageIndex }) => { if (pageIndex === +ov.dataset.pageIndex && !ov.isConnected) finish(true); });
    commitOpenEditor();
    openEditor = finish;
    ov.append(ta);
    grow(); ta.focus();
  });
}

// ---------------------------------------------------------------- Nota (sticky note)
export function stickyNoteTool(app) {
  let off = null;
  return {
    id: 'sticky-note', name: 'Nota', category: 'commenta', icon: 'note', quick: true, quickOrder: 21, shortcut: 'n',
    description: 'Clic sulla pagina per attaccare una nota con il tuo commento.',
    keywords: 'nota adesiva commento post-it sticky note aggiungi commento annotazione',
    interactive: {
      activate(_, opts) {
        opts.append(swatchRow(app, { palette: PALETTE.slice(0, 6), value: S(app, 'note.color', '#ffd400'), onPick: (c) => setS(app, 'note.color', c) }),
          app.ui.h('span', { class: 'lg-hint' }, 'Fai clic dove vuoi la nota, poi scrivi.'));
        app.viewer.setMode('tool', 'copy');
        const c = app.viewer.container;
        const onDown = async (e) => {
          const ov = overlayOf(e.target); if (!ov || e.button !== 0 || e.target.closest('.lg-inline')) return;
          e.preventDefault();
          if (commitOpenEditor()) return; // il primo clic fuori conferma il testo in corso
          const p = eventPoint(app, ov, e);
          const pi = +ov.dataset.pageIndex;
          const scale = app.viewer.scale;
          const res = await inlineEditor(app, ov, { left: p.x + 26 * scale, top: p.y, fontPx: Math.max(14, 11 * scale), border: S(app, 'note.color', '#ffd400'), bg: '#fffbe6', minW: 200 });
          if (!res) return;
          const who = await author(app);
          await edit(app, 'Nota aggiunta', (pdfDoc) => createAnnot(pdfDoc, pi, { type: 'Text', rect: [p.px, p.py - 20, p.px + 20, p.py], color: rgb(S(app, 'note.color', '#ffd400')), text: res.text }, { author: who }));
        };
        c.addEventListener('pointerdown', onDown);
        off = () => c.removeEventListener('pointerdown', onDown);
      },
      deactivate() { off?.(); commitOpenEditor(); },
    },
  };
}

// ---------------------------------------------------------------- Casella di testo
const FT_DEF = { size: 12, color: '#000000', border: '#e03131', bg: 'none', borderW: 1 };
export function freeTextOptions(app) { return { ...FT_DEF, ...S(app, 'freetext', {}) }; }
export async function editFreeTextInline(app, ov, c, initial) {
  const o = freeTextOptions(app);
  const scale = app.viewer.scale;
  const pi = +ov.dataset.pageIndex;
  const vp = app.viewer.getViewport(pi);
  const [l, t] = vp.convertToViewportPoint(c.rect[0], c.rect[3]);
  const [rr] = vp.convertToViewportPoint(c.rect[2], c.rect[1]);
  const res = await inlineEditor(app, ov, { left: Math.min(l, rr), top: t, width: Math.abs(rr - l), value: initial ?? c.text, fontPx: (c.fontSize || o.size) * scale, color: c.textColor || o.color, border: '#1c7ed6' });
  if (!res || res.text === c.text) return;
  await edit(app, 'Testo modificato', (pdfDoc) => updateAnnot(pdfDoc, { key: c.key, pageIndex: pi, rect: c.rect, type: c.type }, { text: res.text }));
}
export function freeTextTool(app) {
  let off = null;
  return {
    id: 'free-text', name: 'Casella di testo', category: 'commenta', icon: 'text', quick: true, quickOrder: 22, shortcut: 't',
    description: 'Scrivi un testo sulla pagina (es. «Visto, si liquida»). La casella si allarga mentre scrivi.',
    keywords: 'casella di testo aggiungi testo scrivi macchina da scrivere typewriter freetext commento testo libero compila modulo',
    interactive: {
      activate(_, opts) {
        const H = app.ui.h;
        const o = freeTextOptions(app);
        const save = (k, v) => setS(app, 'freetext', { ...freeTextOptions(app), [k]: v });
        opts.append(
          selectOpt(app, { label: 'Dimensione', value: o.size, options: [9, 10, 11, 12, 14, 16, 18, 24, 32].map((v) => ({ value: v, label: v + ' pt' })), onChange: (v) => save('size', +v) }),
          swatchRow(app, { label: 'Testo', palette: ['#000000', '#1c7ed6', '#e03131', '#2f9e44'], value: o.color, onPick: (c) => save('color', c), recentKey: 'recentText' }),
          swatchRow(app, { label: 'Bordo', palette: ['#e03131', '#1c7ed6', '#000000'], allowNone: true, value: o.border, onPick: (c) => save('border', c) }),
          swatchRow(app, { label: 'Sfondo', palette: ['#ffffff', '#fff3bf', '#d3f9d8'], allowNone: true, value: o.bg, onPick: (c) => save('bg', c), recentKey: 'recentBg' }),
          H('span', { class: 'lg-hint' }, 'Clic sulla pagina e scrivi. Ctrl+Invio o clic fuori per finire.'));
        app.viewer.setMode('tool', 'text');
        const c = app.viewer.container;
        const onDown = async (e) => {
          const ov = overlayOf(e.target); if (!ov || e.button !== 0 || e.target.closest('.lg-inline')) return;
          e.preventDefault();
          if (commitOpenEditor()) return;
          const p = eventPoint(app, ov, e);
          const pi = +ov.dataset.pageIndex;
          const f = freeTextOptions(app);
          const scale = app.viewer.scale;
          const res = await inlineEditor(app, ov, { left: p.x, top: p.y, fontPx: f.size * scale, color: f.color, bg: f.bg === 'none' ? 'transparent' : f.bg, border: f.border === 'none' ? '#1c7ed6' : f.border, minW: 60 });
          if (!res) return;
          const rect = cssRectToPdf(app, pi, { ...res.box, width: res.box.width + 6 * app.viewer.scale });
          const who = await author(app);
          await edit(app, 'Casella di testo aggiunta', (pdfDoc) => createAnnot(pdfDoc, pi, {
            type: 'FreeText', rect, text: res.text, fontSize: f.size, textColor: rgb(f.color), color: rgb(f.border), interior: rgb(f.bg), borderWidth: f.border === 'none' ? 0 : f.borderW,
          }, { author: who }));
        };
        c.addEventListener('pointerdown', onDown);
        off = () => c.removeEventListener('pointerdown', onDown);
      },
      deactivate() { off?.(); commitOpenEditor(); },
    },
  };
}

// ---------------------------------------------------------------- Disegno a mano libera
export function inkTool(app) {
  let cleanup = null;
  return {
    id: 'ink', name: 'Disegno a mano libera', category: 'commenta', icon: 'pen', quick: true, quickOrder: 23, shortcut: 'd',
    description: 'Penna con spessore, colore e opacità; tratto smussato; gomma.',
    keywords: 'disegna matita penna mano libera ink disegno scarabocchio gomma cancella firma veloce',
    interactive: {
      activate(_, opts) {
        const H = app.ui.h;
        let mode = 'pen';
        const st = () => ({ color: S(app, 'ink.color', '#1c7ed6'), width: S(app, 'ink.width', 2), opacity: S(app, 'ink.opacity', 1), smooth: S(app, 'ink.smooth', 0.5) });
        const render = () => {
          opts.innerHTML = '';
          opts.append(segmented(app, { items: [{ value: 'pen', label: 'Penna' }, { value: 'eraser', label: 'Gomma' }], value: mode, onPick: (v) => { mode = v; render(); app.viewer.setMode('tool', v === 'eraser' ? 'cell' : 'crosshair'); } }));
          if (mode === 'pen') opts.append(
            swatchRow(app, { palette: PALETTE, value: st().color, onPick: (c) => setS(app, 'ink.color', c) }),
            rangeOpt(app, { label: 'Spessore', min: 0.5, max: 12, step: 0.5, value: st().width, unit: ' pt', onChange: (v) => setS(app, 'ink.width', v) }),
            rangeOpt(app, { label: 'Opacità', min: 0.1, max: 1, step: 0.05, value: st().opacity, onChange: (v) => setS(app, 'ink.opacity', v) }),
            rangeOpt(app, { label: 'Smussatura', min: 0, max: 1, step: 0.1, value: st().smooth, onChange: (v) => setS(app, 'ink.smooth', v) }));
          else opts.append(H('span', { class: 'lg-hint' }, 'Passa sopra ai tratti da cancellare.'));
        };
        render();
        app.viewer.setMode('tool', 'crosshair');
        let pending = null; // { pageIndex, strokes:[[pdf pts]], svgPaths }
        let timer = null;
        let cur = null;
        const commit = async () => {
          clearTimeout(timer); timer = null;
          const p = pending; pending = null;
          if (!p || !p.strokes.length) return;
          const s = st();
          const strokes = p.strokes.map((pts) => simplify(smooth(pts, s.smooth), 0.25 / Math.max(0.5, app.viewer.scale)));
          const who = await author(app);
          await edit(app, 'Disegno aggiunto', (pdfDoc) => createAnnot(pdfDoc, p.pageIndex, { type: 'Ink', inkList: strokes, color: rgb(s.color), width: s.width, opacity: s.opacity, rect: rectFromPoints(strokes.flat(), s.width + 2) }, { author: who }));
        };
        const c = app.viewer.container;
        const onDown = (e) => {
          const ov = overlayOf(e.target); if (!ov || e.button !== 0) return;
          e.preventDefault(); ov.setPointerCapture(e.pointerId);
          const pi = +ov.dataset.pageIndex;
          if (pending && pending.pageIndex !== pi) commit();
          clearTimeout(timer);
          const p = eventPoint(app, ov, e);
          const s = st();
          const path = svgEl('polyline', { class: 'lg-ghost', fill: 'none', stroke: mode === 'eraser' ? '#868e96' : s.color, 'stroke-width': mode === 'eraser' ? 14 : s.width * app.viewer.scale, 'stroke-opacity': mode === 'eraser' ? 0.35 : s.opacity, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' });
          previewSvg(ov).append(path);
          cur = { ov, pi, css: [[p.x, p.y]], pdf: [[p.px, p.py]], path };
          path.setAttribute('points', `${p.x},${p.y}`);
        };
        const onMove = (e) => {
          if (!cur) return;
          const co = e.getCoalescedEvents?.();
          for (const ev of co && co.length ? co : [e]) {
            const p = eventPoint(app, cur.ov, ev);
            const last = cur.css[cur.css.length - 1];
            if (Math.hypot(p.x - last[0], p.y - last[1]) < 1.5) continue;
            cur.css.push([p.x, p.y]); cur.pdf.push([p.px, p.py]);
          }
          cur.path.setAttribute('points', cur.css.map((q) => q.join(',')).join(' '));
        };
        const onUp = async () => {
          if (!cur) return;
          const k = cur; cur = null;
          if (mode === 'eraser') { k.path.remove(); await erase(k); return; }
          if (!pending) pending = { pageIndex: k.pi, strokes: [] };
          pending.strokes.push(k.pdf.length > 1 ? k.pdf : [k.pdf[0], [k.pdf[0][0] + 0.1, k.pdf[0][1]]]);
          clearTimeout(timer);
          timer = setTimeout(commit, 900); // più tratti ravvicinati = un solo disegno
        };
        const erase = async (k) => {
          const radius = 7 / app.viewer.scale;
          const list = (await pageComments(app, k.pi)).filter((a) => a.type === 'Ink' && a.inkList?.length);
          const changes = [];
          for (const a of list) {
            const { strokes, changed } = eraseFromStrokes(a.inkList, k.pdf, radius + 1);
            if (changed) changes.push({ a, strokes });
          }
          if (!changes.length) return;
          await edit(app, 'Tratti cancellati', async (pdfDoc) => {
            for (const { a, strokes } of changes) {
              const t = { key: a.key, pageIndex: a.pageIndex, rect: a.rect, type: 'Ink' };
              if (!strokes.length) deleteAnnots(pdfDoc, [t]);
              else await updateAnnot(pdfDoc, t, { inkList: strokes });
            }
          });
        };
        c.addEventListener('pointerdown', onDown); c.addEventListener('pointermove', onMove); c.addEventListener('pointerup', onUp); c.addEventListener('pointercancel', onUp);
        cleanup = () => {
          c.removeEventListener('pointerdown', onDown); c.removeEventListener('pointermove', onMove); c.removeEventListener('pointerup', onUp); c.removeEventListener('pointercancel', onUp);
          if (pending) commit();
        };
      },
      deactivate() { cleanup?.(); cleanup = null; },
    },
  };
}

// ---------------------------------------------------------------- Forme
export const SHAPES = [
  { value: 'rect', label: 'Rettangolo' }, { value: 'ellipse', label: 'Ellisse' }, { value: 'line', label: 'Linea' },
  { value: 'arrow', label: 'Freccia' }, { value: 'polygon', label: 'Poligono' }, { value: 'polyline', label: 'Polilinea' }, { value: 'cloud', label: 'Nuvola' },
];
export function shapesTool(app) {
  let cleanup = null;
  return {
    id: 'shapes', name: 'Forme', category: 'commenta', icon: 'shape', quick: true, quickOrder: 24,
    description: 'Rettangolo, ellisse, linea, freccia, poligono, nuvola: per cerchiare un importo o indicare un punto.',
    keywords: 'forme disegna rettangolo cerchio ellisse linea freccia poligono nuvola cloud shape riquadro',
    interactive: {
      activate(_, opts) {
        const H = app.ui.h;
        const st = () => ({ shape: S(app, 'shape.kind', 'rect'), color: S(app, 'shape.color', '#e03131'), fill: S(app, 'shape.fill', 'none'), width: S(app, 'shape.width', 2), opacity: S(app, 'shape.opacity', 1) });
        const render = () => {
          opts.innerHTML = '';
          const s = st();
          opts.append(segmented(app, { items: SHAPES, value: s.shape, label: 'Forma', onPick: (v) => { setS(app, 'shape.kind', v); abortPoly(); render(); } }),
            swatchRow(app, { label: 'Bordo', palette: PALETTE, value: s.color, onPick: (c) => setS(app, 'shape.color', c) }),
            ...(['line', 'arrow', 'polyline'].includes(s.shape) ? [] : [swatchRow(app, { label: 'Riempimento', palette: ['#fff3bf', '#ffe3e3', '#d0ebff', '#d3f9d8'], allowNone: true, value: s.fill, onPick: (c) => setS(app, 'shape.fill', c), recentKey: 'recentFill' })]),
            rangeOpt(app, { label: 'Spessore', min: 0.5, max: 10, step: 0.5, value: s.width, unit: ' pt', onChange: (v) => setS(app, 'shape.width', v) }),
            rangeOpt(app, { label: 'Opacità', min: 0.1, max: 1, step: 0.05, value: s.opacity, onChange: (v) => setS(app, 'shape.opacity', v) }),
            H('span', { class: 'lg-hint' }, ['polygon', 'polyline'].includes(s.shape) ? 'Clic per ogni vertice, doppio clic o Invio per finire.' : 'Trascina sulla pagina. Maiusc = proporzioni fisse.'));
        };
        render();
        app.viewer.setMode('tool', 'crosshair');
        let drag = null, poly = null;
        const abortPoly = () => { poly?.el.remove(); poly = null; };
        const c = app.viewer.container;
        const create = async (pi, spec, label) => {
          const s = st();
          const who = await author(app);
          await edit(app, label, (pdfDoc) => createAnnot(pdfDoc, pi, { color: rgb(s.color), interior: rgb(s.fill), width: s.width, opacity: s.opacity, ...spec }, { author: who }));
        };
        const onDown = (e) => {
          const ov = overlayOf(e.target); if (!ov || e.button !== 0) return;
          e.preventDefault();
          const s = st();
          const p = eventPoint(app, ov, e);
          const pi = +ov.dataset.pageIndex;
          if (s.shape === 'polygon' || s.shape === 'polyline') {
            if (poly && poly.pi !== pi) abortPoly();
            if (!poly) { const el = svgEl('polyline', { class: 'lg-ghost', fill: 'none', stroke: s.color, 'stroke-width': s.width * app.viewer.scale }); previewSvg(ov).append(el); poly = { pi, ov, el, css: [], pdf: [] }; }
            if (e.detail >= 2) { finishPoly(); return; }
            poly.css.push([p.x, p.y]); poly.pdf.push([p.px, p.py]);
            poly.el.setAttribute('points', poly.css.map((q) => q.join(',')).join(' '));
            return;
          }
          ov.setPointerCapture(e.pointerId);
          const el = svgEl(s.shape === 'ellipse' ? 'ellipse' : s.shape === 'rect' || s.shape === 'cloud' ? 'rect' : 'line', { class: 'lg-ghost', fill: s.fill === 'none' ? 'none' : s.fill, stroke: s.color, 'stroke-width': s.width * app.viewer.scale, 'stroke-dasharray': s.shape === 'cloud' ? '4 3' : null });
          previewSvg(ov).append(el);
          drag = { ov, pi, p, q: p, el, shape: s.shape };
        };
        const onMove = (e) => {
          if (poly && !drag) {
            const ov = overlayOf(e.target); if (ov !== poly.ov) return;
            const p = eventPoint(app, ov, e);
            poly.el.setAttribute('points', [...poly.css, [p.x, p.y]].map((q) => q.join(',')).join(' '));
            return;
          }
          if (!drag) return;
          let q = eventPoint(app, drag.ov, e);
          if (e.shiftKey) q = constrain(drag.p, q, drag.shape);
          drag.q = q;
          const { p, el } = drag;
          if (el.tagName === 'line') Object.entries({ x1: p.x, y1: p.y, x2: q.x, y2: q.y }).forEach(([k, v]) => el.setAttribute(k, v));
          else if (el.tagName === 'ellipse') Object.entries({ cx: (p.x + q.x) / 2, cy: (p.y + q.y) / 2, rx: Math.abs(q.x - p.x) / 2, ry: Math.abs(q.y - p.y) / 2 }).forEach(([k, v]) => el.setAttribute(k, v));
          else Object.entries({ x: Math.min(p.x, q.x), y: Math.min(p.y, q.y), width: Math.abs(q.x - p.x), height: Math.abs(q.y - p.y) }).forEach(([k, v]) => el.setAttribute(k, v));
        };
        const onUp = async () => {
          if (!drag) return;
          const d = drag; drag = null; d.el.remove();
          const { p, q, pi, shape } = d;
          if (Math.hypot(q.x - p.x, q.y - p.y) < 4) return;
          const cssToPdf = (x, y) => app.viewer.getViewport(pi).convertToPdfPoint(x, y);
          const a = cssToPdf(p.x, p.y), b = cssToPdf(q.x, q.y);
          const s = st();
          if (shape === 'line' || shape === 'arrow') await create(pi, { type: 'Line', line: [...a, ...b], lineEnding: ['None', shape === 'arrow' ? 'OpenArrow' : 'None'], interior: null, rect: rectFromPoints([a, b], s.width * 4 + 6) }, shape === 'arrow' ? 'Freccia aggiunta' : 'Linea aggiunta');
          else {
            const rect = normRect([...a, ...b]);
            const pad = shape === 'cloud' ? 8 : 0;
            await create(pi, { type: shape === 'ellipse' ? 'Circle' : 'Square', rect: [rect[0] - pad, rect[1] - pad, rect[2] + pad, rect[3] + pad], cloud: shape === 'cloud' ? 1 : 0 }, { rect: 'Rettangolo aggiunto', ellipse: 'Ellisse aggiunta', cloud: 'Nuvola aggiunta' }[shape]);
          }
        };
        const finishPoly = async () => {
          if (!poly) return;
          const pl = poly; abortPoly();
          const pts = pl.pdf.filter((v, i, arr) => i === 0 || Math.hypot(v[0] - arr[i - 1][0], v[1] - arr[i - 1][1]) > 0.5);
          const s = st();
          if (pts.length < (s.shape === 'polygon' ? 3 : 2)) { app.ui.toast('Servono almeno ' + (s.shape === 'polygon' ? 3 : 2) + ' punti'); return; }
          await create(pl.pi, { type: s.shape === 'polygon' ? 'Polygon' : 'PolyLine', vertices: pts, interior: s.shape === 'polygon' ? rgb(s.fill) : null }, s.shape === 'polygon' ? 'Poligono aggiunto' : 'Polilinea aggiunta');
        };
        const onKey = (e) => { if (poly && e.key === 'Enter') { e.preventDefault(); finishPoly(); } };
        c.addEventListener('pointerdown', onDown); c.addEventListener('pointermove', onMove); c.addEventListener('pointerup', onUp); document.addEventListener('keydown', onKey);
        cleanup = () => { c.removeEventListener('pointerdown', onDown); c.removeEventListener('pointermove', onMove); c.removeEventListener('pointerup', onUp); document.removeEventListener('keydown', onKey); abortPoly(); };
      },
      deactivate() { cleanup?.(); cleanup = null; },
    },
  };
}
function constrain(p, q, shape) {
  const dx = q.x - p.x, dy = q.y - p.y;
  if (shape === 'line' || shape === 'arrow') {
    const ang = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4); const len = Math.hypot(dx, dy);
    return { ...q, x: p.x + Math.cos(ang) * len, y: p.y + Math.sin(ang) * len };
  }
  const m = Math.max(Math.abs(dx), Math.abs(dy));
  return { ...q, x: p.x + Math.sign(dx || 1) * m, y: p.y + Math.sign(dy || 1) * m };
}
export { r2, pdfToCss };
