// Area «commenti» — funzioni d'interfaccia condivise: impostazioni, barra opzioni, modello per pagina,
// conversione coordinate, modifiche annullabili.
import { fromPdfjs, buildThreads } from './model.js';
import { hexToRgb, rgbToHex, normRect } from './geom.js';

export const S = (app, k, def) => app.settings.get('commenti.' + k, def);
export const setS = (app, k, v) => app.settings.set('commenti.' + k, v);

/** Autore dei commenti; la prima volta lo chiede (una volta sola). */
export async function author(app) {
  let a = app.settings.get('author', '');
  if (!a && !S(app, 'askedAuthor', false)) {
    setS(app, 'askedAuthor', true);
    const v = await app.ui.prompt('Con quale nome vuoi firmare i tuoi commenti? (Si può cambiare in Impostazioni)', '', { title: 'Nome autore', okLabel: 'Salva' });
    if (v && v.trim()) { a = v.trim(); app.settings.set('author', a); }
  }
  return a;
}

/** Modifica annullabile con messaggi chiari. fn(pdfDoc, PDFLib, doc) → risultato | false. */
export async function edit(app, label, fn) {
  if (!app.activeDoc) { app.ui.toast('Apri prima un documento PDF', { kind: 'warning' }); return false; }
  try { return await app.editWithPdfLib(label, fn); }
  catch (err) { app.reportError(err, label + ': operazione non riuscita'); return false; }
}

// ---------------------------------------------------------------- modello per pagina (pdf.js, nel worker)
const cache = new WeakMap(); // pdf proxy → Map(pageIndex → Promise<list>)
export function pageComments(app, pageIndex, doc = app.activeDoc) {
  const pdf = doc?.pdf;
  if (!pdf || pageIndex < 0 || pageIndex >= pdf.numPages) return Promise.resolve([]);
  let m = cache.get(pdf); if (!m) { m = new Map(); cache.set(pdf, m); }
  if (!m.has(pageIndex)) {
    m.set(pageIndex, pdf.getPage(pageIndex + 1).then((p) => p.getAnnotations({ intent: 'display' })).then((arr) => arr.map((d) => fromPdfjs(d, pageIndex)).filter(Boolean)).catch((err) => { console.warn('[commenti] pagina', pageIndex + 1, err); return []; }));
  }
  return m.get(pageIndex);
}
/** Tutte le pagine, in sequenza con pause, con avanzamento. signal per interrompere. */
export async function allComments(app, { onProgress, signal, doc = app.activeDoc } = {}) {
  const n = doc?.pdf?.numPages || 0;
  const out = [];
  const BATCH = 8;
  for (let i = 0; i < n; i += BATCH) {
    if (signal?.aborted) break;
    const parts = await Promise.all(Array.from({ length: Math.min(BATCH, n - i) }, (_, k) => pageComments(app, i + k, doc)));
    for (const p of parts) out.push(...p);
    onProgress?.(Math.min(n, i + BATCH), n, out);
    if (i % 64 === 0) await new Promise((r) => setTimeout(r, 0));
  }
  return out;
}
export async function threadsOf(app, opts) { return buildThreads(await allComments(app, opts)); }

// ---------------------------------------------------------------- coordinate
export function overlayOf(target) { return target?.closest?.('.leggio-overlay') || null; }
export function pageIndexOfOverlay(ov) { return ov ? +ov.dataset.pageIndex : -1; }
/** Punto evento → { x, y } CSS nell'overlay e punto PDF. */
export function eventPoint(app, ov, e) {
  const r = ov.getBoundingClientRect();
  const x = e.clientX - r.left, y = e.clientY - r.top;
  const vp = app.viewer.getViewport(+ov.dataset.pageIndex);
  const [px, py] = vp.convertToPdfPoint(x, y);
  return { x, y, px, py };
}
export function cssToPdf(app, pageIndex, x, y) { return app.viewer.getViewport(pageIndex).convertToPdfPoint(x, y); }
export function pdfToCss(app, pageIndex, x, y) { return app.viewer.getViewport(pageIndex).convertToViewportPoint(x, y); }
/** Rettangolo CSS {left,top,width,height} → rettangolo PDF normalizzato. */
export function cssRectToPdf(app, pageIndex, { left, top, width, height }) {
  const vp = app.viewer.getViewport(pageIndex);
  return normRect([...vp.convertToPdfPoint(left, top), ...vp.convertToPdfPoint(left + width, top + height)]);
}

// ---------------------------------------------------------------- barra opzioni
export function h(app, ...a) { return app.ui.h(...a); }

/** Riga di colori: palette + colori recenti + selettore. onPick(hex). */
export function swatchRow(app, { palette, value, onPick, recentKey = 'recentColors', label = 'Colore', allowNone = false }) {
  const H = app.ui.h;
  const recent = S(app, recentKey, []).filter((c) => !palette.includes(c)).slice(0, 4);
  const wrap = H('div', { class: 'swatches lg-swatches', role: 'radiogroup', 'aria-label': label });
  const all = [...(allowNone ? ['none'] : []), ...palette, ...recent];
  const render = (cur) => {
    wrap.innerHTML = '';
    for (const c of all) {
      wrap.append(H('button', { type: 'button', class: 'swatch' + (c === cur ? ' active' : '') + (c === 'none' ? ' lg-none' : ''), role: 'radio', 'aria-checked': String(c === cur), title: c === 'none' ? 'Nessun colore' : c, 'aria-label': c === 'none' ? 'Nessun colore' : 'Colore ' + c, style: c === 'none' ? null : { background: c }, onclick: () => { render(c); onPick(c); } }));
    }
    const input = H('input', { type: 'color', value: cur && cur !== 'none' ? cur : '#000000', title: 'Altro colore…', 'aria-label': 'Altro colore' });
    input.addEventListener('change', () => {
      const v = input.value; const rc = [v, ...S(app, recentKey, []).filter((x) => x !== v)].slice(0, 6); setS(app, recentKey, rc);
      if (!all.includes(v)) all.push(v);
      render(v); onPick(v);
    });
    wrap.append(input);
  };
  render(value);
  return H('label', { class: 'lg-opt' }, H('span', {}, label), wrap);
}
/** Gruppo di pulsanti con etichetta (uno attivo). items: [{ value, label, icon? }] */
export function segmented(app, { items, value, onPick, label }) {
  const H = app.ui.h;
  const seg = H('div', { class: 'seg lg-seg', role: 'radiogroup', 'aria-label': label || '' });
  const render = (cur) => {
    seg.innerHTML = '';
    for (const it of items) seg.append(H('button', { type: 'button', class: it.value === cur ? 'active' : '', role: 'radio', 'aria-checked': String(it.value === cur), title: it.title || it.label, onclick: () => { render(it.value); onPick(it.value); } }, it.label));
  };
  render(value);
  return seg;
}
export function rangeOpt(app, { label, min, max, step = 1, value, unit = '', onChange }) {
  const H = app.ui.h;
  const out = H('output', {}, fmtV(value) + unit);
  const input = H('input', { type: 'range', min, max, step, value, 'aria-label': label });
  input.addEventListener('input', () => { out.textContent = fmtV(+input.value) + unit; onChange(+input.value); });
  return H('label', { class: 'lg-opt' }, H('span', {}, label), input, out);
}
const fmtV = (v) => (Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100).replace('.', ','));
export function selectOpt(app, { label, options, value, onChange }) {
  const H = app.ui.h;
  const sel = H('select', { 'aria-label': label }, options.map((o) => H('option', { value: o.value, selected: String(o.value) === String(value) }, o.label)));
  sel.addEventListener('change', () => onChange(sel.value));
  return H('label', { class: 'lg-opt' }, H('span', {}, label), sel);
}
export const rgb = (hex) => (hex && hex !== 'none' ? hexToRgb(hex) : null);
export { rgbToHex };

/** SVG d'anteprima nell'overlay (ricreato se l'overlay è stato rigenerato). */
export function previewSvg(ov) {
  let svg = ov.querySelector(':scope > svg.lg-preview');
  if (!svg) {
    svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'lg-preview');
    ov.append(svg);
  }
  return svg;
}
export function svgEl(tag, attrs) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) el.setAttribute(k, v);
  return el;
}
