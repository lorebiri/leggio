// Parti condivise dell'interfaccia di «modifica»: cache delle analisi, modifica sicura con verifica,
// avviso per i documenti firmati, campionamento dei colori, barra degli stili, font Unicode.
import { PDFJS_ASSETS } from '../../../core/pdf.js';
import { groupTextItems } from '../blocks.js';
import { analyze } from '../operations.js';
import { compareOutside } from '../verify.js';
import { hasDigitalSignatures } from '../pdfpage.js';

// ------------------------------------------------------------------ cache per versione del documento

const libCache = new WeakMap(); // bytes → Promise<PDFDocument>
const pageCache = new WeakMap(); // PDFDocument → Map(pageIndex → analisi)
const textCache = new WeakMap(); // PDFDocumentProxy → Map(pageIndex → {tc, blocks})

/** PDFDocument (pdf-lib) di sola lettura per la versione corrente: non va modificato. */
export function readOnlyPdfLib(app, doc = app.activeDoc) {
  const bytes = doc.bytes;
  let p = libCache.get(bytes);
  if (!p) { p = app.lib.openPdfLib(bytes, doc.password); libCache.set(bytes, p); p.catch(() => libCache.delete(bytes)); }
  return p;
}

/** Analisi del content stream (glifi, immagini) di una pagina, in cache. */
export async function pageAnalysis(app, pageIndex, doc = app.activeDoc) {
  const pdfDoc = await readOnlyPdfLib(app, doc);
  let m = pageCache.get(pdfDoc);
  if (!m) { m = new Map(); pageCache.set(pdfDoc, m); }
  if (!m.has(pageIndex)) m.set(pageIndex, analyze(pdfDoc, pageIndex));
  return m.get(pageIndex);
}

/** Testo pdf.js e blocchi della pagina, in cache. */
export async function pageBlocks(doc, pageIndex) {
  const pdf = doc.pdf;
  let m = textCache.get(pdf);
  if (!m) { m = new Map(); textCache.set(pdf, m); }
  if (!m.has(pageIndex)) {
    m.set(pageIndex, (async () => {
      const page = await pdf.getPage(pageIndex + 1);
      const tc = await page.getTextContent();
      return { tc, blocks: groupTextItems(tc.items, tc.styles) };
    })());
  }
  return m.get(pageIndex);
}

// ------------------------------------------------------------------ verifica

export async function textContentOf(app, bytes, pageIndices) {
  const task = app.lib.pdfjs.getDocument({ data: bytes.slice(), ...PDFJS_ASSETS, isEvalSupported: false, verbosity: 0 });
  try {
    const pdf = await task.promise;
    const out = new Map();
    for (const i of pageIndices) { const p = await pdf.getPage(i + 1); out.set(i, await p.getTextContent()); }
    return out;
  } finally { task.destroy(); }
}

const allText = (tc) => tc.items.map((i) => i.str || '').join('').replace(/\s+/g, '');

/**
 * Verifica che la nuova versione si apra con pdf.js, che il testo fuori dalle zone modificate sia invariato
 * e che il testo atteso compaia. pages: [{ pageIndex, before (textContent), exclude:[rect], expect:[string] }]
 * → { ok, failed:[pageIndex], reason }
 */
export async function verifyPages(app, bytes, pages) {
  let after;
  try { after = await textContentOf(app, bytes, pages.map((p) => p.pageIndex)); }
  catch (err) { return { ok: false, failed: pages.map((p) => p.pageIndex), reason: 'il file risultante non si apre (' + (err?.message || err) + ')' }; }
  const failed = [];
  let reason = '';
  for (const p of pages) {
    const tc = after.get(p.pageIndex);
    const cmp = compareOutside(p.before.items, tc.items, p.exclude || []);
    const txt = allText(tc);
    const missing = (p.expect || []).filter((e) => !txt.includes(String(e).replace(/\s+/g, '')));
    if (!cmp.ok || missing.length) {
      failed.push(p.pageIndex);
      reason = !cmp.ok ? `il testo intorno sarebbe cambiato (${cmp.missing ? 'manca «' + cmp.missing + '»' : ''}${cmp.added ? ' compare «' + cmp.added + '»' : ''})` : 'il testo nuovo non risulta leggibile';
    }
  }
  return { ok: !failed.length, failed, reason };
}

/**
 * Modifica sicura di una pagina: prova il metodo preciso, verifica, se serve ripiega su "copertura".
 * run(pdfDoc, mode:'auto'|'cover') → risultato con { extent?, expect?, warnings?, method? } oppure false per annullare.
 * Ritorna il risultato dell'ultimo tentativo (con .fallbackReason se si è dovuto ripiegare) o null.
 */
export async function safePageEdit(app, label, pageIndex, run, { exclude = [] } = {}) {
  const doc = app.activeDoc;
  if (!(await confirmSigned(app))) return null;
  let result = null;
  const ok = await app.applyEdit(label, async (bytes) => {
    const before = (await textContentOf(app, bytes, [pageIndex])).get(pageIndex);
    let fallbackReason = '';
    for (const mode of ['auto', 'cover']) {
      const pdfDoc = await app.lib.openPdfLib(bytes, doc.password);
      const r = await run(pdfDoc, mode);
      if (r === false) return null;
      const out = await app.lib.savePdfLib(pdfDoc);
      const v = await verifyPages(app, out, [{ pageIndex, before, exclude: [...exclude, ...(r?.extent ? [r.extent] : [])], expect: r?.expect || [] }]);
      if (v.ok) { result = { ...(r || {}), fallbackReason }; return out; }
      fallbackReason = v.reason;
      console.warn('[modifica] verifica non superata', mode, v.reason);
      if (mode === 'cover' || r?.method === 'cover') break;
    }
    throw new Error('La modifica non è stata applicata perché il risultato non superava i controlli di sicurezza (' + fallbackReason + '). Il documento non è stato toccato.');
  }, doc).catch((err) => { app.reportError(err, label + ': non riuscita'); return false; });
  return ok ? result : null;
}

// ------------------------------------------------------------------ documenti firmati

export async function confirmSigned(app, doc = app.activeDoc) {
  let pdfDoc = null;
  try { pdfDoc = await readOnlyPdfLib(app, doc); } catch (err) { app.reportError(err, 'Impossibile leggere il documento per modificarlo'); return false; }
  if (pdfDoc.isEncrypted) {
    // aperto senza decifrare (protezione "solo proprietario"): riscrivere il contenuto lo rovinerebbe
    await app.ui.dialog({ title: 'Documento protetto', message: 'Questo documento è protetto contro le modifiche. Per modificarne il contenuto togli prima la protezione (strumenti «Proteggi»), poi riprova.', cancelLabel: null, okLabel: 'Ho capito' });
    return false;
  }
  if (doc.data.modificaSignedOk) return true;
  let signed = false;
  try { signed = hasDigitalSignatures(pdfDoc); } catch { signed = false; }
  if (!signed) { doc.data.modificaSignedOk = true; return true; }
  const ok = await app.ui.confirm('Questo documento è firmato digitalmente. Se lo modifichi la firma non sarà più valida. Ti consigliamo di salvare le modifiche in una copia (File › Salva con nome) e di conservare l\'originale firmato.', { title: 'Documento firmato', okLabel: 'Modifica comunque' });
  if (ok) doc.data.modificaSignedOk = true;
  return ok;
}

// ------------------------------------------------------------------ colori

export function rgbToCss(c) { return c ? `rgb(${c.map((v) => Math.round(Math.max(0, Math.min(1, v)) * 255)).join(',')})` : 'transparent'; }
export function cssToRgb(hex) { const m = /^#?([0-9a-f]{6})$/i.exec(hex || ''); if (!m) return [0, 0, 0]; const n = parseInt(m[1], 16); return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]; }
export function rgbToHex(c) { return '#' + (c || [0, 0, 0]).map((v) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0')).join(''); }

/** Colore di sfondo intorno a un rettangolo CSS della pagina, campionato dal rendering. */
export function sampleBackground(app, pageIndex, css) {
  try {
    const pv = app.viewer.pdfViewer.getPageView(pageIndex);
    const canvas = pv?.canvas || pv?.div.querySelector('canvas');
    if (!canvas || !canvas.width) return [1, 1, 1];
    const k = canvas.width / (canvas.clientWidth || pv.viewport.width);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const pts = [];
    const m = 3;
    for (const [x, y] of [[css.left - m, css.top - m], [css.left + css.width + m, css.top - m], [css.left - m, css.top + css.height + m], [css.left + css.width + m, css.top + css.height + m], [css.left + css.width / 2, css.top - m], [css.left + css.width / 2, css.top + css.height + m]]) {
      const px = Math.round(x * k), py = Math.round(y * k);
      if (px < 0 || py < 0 || px >= canvas.width || py >= canvas.height) continue;
      const d = ctx.getImageData(px, py, 1, 1).data;
      pts.push([d[0], d[1], d[2]]);
    }
    if (!pts.length) return [1, 1, 1];
    // il colore più frequente (arrotondato), così una lettera vicina non sporca il risultato
    const key = (p) => p.map((v) => Math.round(v / 16)).join(',');
    const groups = new Map();
    for (const p of pts) { const kk = key(p); if (!groups.has(kk)) groups.set(kk, []); groups.get(kk).push(p); }
    const best = [...groups.values()].sort((a, b) => b.length - a.length)[0];
    const avg = [0, 1, 2].map((i) => best.reduce((s, p) => s + p[i], 0) / best.length / 255);
    return avg;
  } catch { return [1, 1, 1]; }
}

// ------------------------------------------------------------------ font

export const FAMILY_CSS = {
  Helvetica: 'Helvetica, Arial, "Liberation Sans", sans-serif',
  Times: '"Times New Roman", Times, "Liberation Serif", serif',
  Courier: '"Courier New", Courier, "Liberation Mono", monospace',
};

const fontBytes = new Map();
/** Font Unicode (Liberation Sans, licenza OFL, fornito con pdf.js) per i caratteri fuori da WinAnsi. */
export async function loadUnicodeFont({ bold, italic } = {}) {
  const name = `LiberationSans-${bold && italic ? 'BoldItalic' : bold ? 'Bold' : italic ? 'Italic' : 'Regular'}.ttf`;
  if (fontBytes.has(name)) return fontBytes.get(name);
  const url = PDFJS_ASSETS.standardFontDataUrl + name;
  let bytes;
  try { const r = await fetch(url); if (!r.ok) throw new Error(r.status); bytes = new Uint8Array(await r.arrayBuffer()); }
  catch {
    bytes = await new Promise((res, rej) => { const x = new XMLHttpRequest(); x.open('GET', url); x.responseType = 'arraybuffer'; x.onload = () => (x.response ? res(new Uint8Array(x.response)) : rej(new Error('font'))); x.onerror = () => rej(new Error('Font aggiuntivo non trovato')); x.send(); });
  }
  fontBytes.set(name, bytes);
  return bytes;
}
export const ENV = { loadUnicodeFont };

// ------------------------------------------------------------------ pagine e overlay

/** Esegue fn(pageIndex, overlay, viewport) per tutte le pagine già disegnate. */
export function forEachRenderedPage(app, fn) {
  const doc = app.activeDoc; if (!doc) return;
  for (let i = 0; i < doc.pageCount; i++) {
    const pv = app.viewer.pdfViewer.getPageView(i);
    if (pv && pv.renderingState === 3 && pv.div.querySelector('canvas')) fn(i, app.viewer.getOverlay(i), pv.viewport);
  }
}

/** Livello dello strumento dentro l'overlay della pagina (ricreato se serve). */
export function toolLayer(overlay, cls) {
  let l = overlay.querySelector(':scope > .' + cls);
  if (!l) { l = document.createElement('div'); l.className = 'lgm-layer ' + cls; overlay.append(l); }
  return l;
}
export function clearLayers(app, cls) { document.querySelectorAll('.leggio-overlay > .' + cls).forEach((l) => l.remove()); }

export const pageOfEvent = (e) => { const ov = e.target.closest?.('.leggio-overlay'); return ov ? +ov.dataset.pageIndex : -1; };

/** Rettangolo PDF → stile CSS assoluto. */
export function place(el, css, pad = 0) {
  el.style.left = css.left - pad + 'px'; el.style.top = css.top - pad + 'px';
  el.style.width = css.width + 2 * pad + 'px'; el.style.height = css.height + 2 * pad + 'px';
}

export function todayIt(withTime = false) {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}` + (withTime ? ` ${p(d.getHours())}:${p(d.getMinutes())}` : '');
}

/** Barra degli stili del testo (font, dimensione, colore, grassetto, corsivo, allineamento). */
export function styleBar(h, state, onChange) {
  const sel = h('select', { class: 'lgm-sel', 'aria-label': 'Carattere', title: 'Carattere' },
    [['original', 'Come l\'originale'], ['Helvetica', 'Sans (Helvetica/Arial)'], ['Times', 'Serif (Times)'], ['Courier', 'Monospazio (Courier)']]
      .filter(([v]) => state.allowOriginal || v !== 'original').map(([v, l]) => h('option', { value: v, selected: state.font === v }, l)));
  const size = h('input', { class: 'lgm-num', type: 'number', min: 4, max: 200, step: 0.5, value: state.size ? Math.round(state.size * 10) / 10 : '', placeholder: 'auto', 'aria-label': 'Dimensione in punti', title: 'Dimensione (punti)' });
  const color = h('input', { type: 'color', value: rgbToHex(state.color), 'aria-label': 'Colore', title: 'Colore del testo' });
  const tog = (key, label, txt) => { const b = h('button', { type: 'button', class: 'lgm-tog' + (state[key] ? ' on' : ''), 'aria-pressed': String(!!state[key]), title: label, 'aria-label': label }, txt); b.addEventListener('click', () => { state[key] = !state[key]; b.classList.toggle('on', state[key]); b.setAttribute('aria-pressed', String(state[key])); state.touched[key] = true; onChange(key); }); return b; };
  const align = h('select', { class: 'lgm-sel', 'aria-label': 'Allineamento', title: 'Allineamento' }, [['left', 'A sinistra'], ['center', 'Al centro'], ['right', 'A destra'], ['justify', 'Giustificato']].map(([v, l]) => h('option', { value: v, selected: state.align === v }, l)));
  state.touched = state.touched || {};
  sel.addEventListener('change', () => { state.font = sel.value; state.touched.font = true; onChange('font'); });
  size.addEventListener('change', () => { const v = parseFloat(size.value); state.size = v > 0 ? v : null; state.touched.size = true; onChange('size'); });
  color.addEventListener('input', () => { state.color = cssToRgb(color.value); state.touched.color = true; onChange('color'); });
  align.addEventListener('change', () => { state.align = align.value; state.touched.align = true; onChange('align'); });
  const bold = tog('bold', 'Grassetto', h('b', {}, 'G'));
  const italic = tog('italic', 'Corsivo', h('i', {}, 'C'));
  const el = h('div', { class: 'lgm-stylebar' }, sel, size, h('span', { class: 'lgm-unit' }, 'pt'), color, bold, italic, align);
  el.sync = () => { sel.value = state.font; size.value = state.size ? Math.round(state.size * 10) / 10 : ''; color.value = rgbToHex(state.color); bold.classList.toggle('on', !!state.bold); italic.classList.toggle('on', !!state.italic); align.value = state.align || 'left'; };
  return el;
}

/** Solo le proprietà di stile che l'utente ha cambiato (così il resto resta "come l'originale"). */
export function changedStyle(state) {
  const t = state.touched || {};
  const out = {};
  if (t.font && state.font !== 'original') out.font = state.font;
  if (t.size && state.size) out.size = state.size;
  if (t.color) out.color = state.color;
  if (t.bold) out.bold = !!state.bold;
  if (t.italic) out.italic = !!state.italic;
  if (t.align) out.align = state.align;
  return out;
}

export function afterEditToast(app, r, what = 'Testo modificato') {
  if (!r) return;
  const notes = [...(r.warnings || [])];
  if (r.fallbackReason || r.method === 'cover') notes.unshift('Il testo originale non si poteva togliere in modo sicuro: è stato coperto con un riquadro del colore dello sfondo (resta nel file, sotto il riquadro).');
  if (notes.length) app.ui.toast(notes.join(' '), { kind: 'warning', timeout: 9000 });
}

/**
 * Rettangolo PDF [x1,y1,x2,y2] → {left,top,width,height} CSS nella pagina.
 * (Non usa viewer.pdfRectToCss del nucleo: con pdf.js 6 PageViewport non ha più convertToViewportRectangle.)
 */
export function rectToCss(app, pageIndex, rect) {
  const vp = app.viewer.getViewport(pageIndex);
  const pts = [[rect[0], rect[1]], [rect[2], rect[3]], [rect[0], rect[3]], [rect[2], rect[1]]].map(([x, y]) => vp.convertToViewportPoint(x, y));
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  return { left: Math.min(...xs), top: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
}
