// Oscura (Redazione): segna aree, testo selezionato, risultati di ricerca, pagine intere; poi applica
// un oscuramento VERO (il contenuto sotto viene eliminato) e verifica il risultato.
import { PDFJS_ASSETS } from '../../core/pdf.js';
import { MODELLI, buildMatchers, findMatches } from './logica/modelli.js';
import { buildPageText, rangeRects, pageWords, wordsOutside, wordHit, normRect, padRect } from './logica/testo.js';
import { redactPage, embedTextFont, finalizeRedaction, redactOutlineTitles, removeStructure } from './logica/redazione.js';
import { verifyRedaction } from './logica/verifica.js';
import { sanitize } from './logica/sanifica.js';
import { renderRedactedPage, viewportRect, measureChars } from './codec.js';
import { setMeasure } from './logica/testo.js';
setMeasure(measureChars);
import { st, openForEdit, salvaCopia, copyName, signatureCount, avvisoFirma, boxAvviso } from './comune.js';
import { N, lookupDict } from './logica/pdfutil.js';
import { PDFString, PDFHexString } from '@cantoo/pdf-lib';

const DEFAULT_OFF = new Set(['Partita IVA', 'Date']);
let active = null; // { app, mode, cleanup[] }

function marks(app) { return st(app.activeDoc).marks; }
function addMark(app, m) {
  const s = st(app.activeDoc);
  const mark = { id: s.nextId++, on: true, ...m, rect: normRect(m.rect) };
  s.marks.push(mark);
  return mark;
}
function countActive(app) { return marks(app).filter((m) => m.on).length; }

// ---------- disegno sugli overlay ----------
function drawPage(app, i) {
  if (!active) return;
  const ov = app.viewer.getOverlay(i);
  if (!ov) return;
  ov.querySelectorAll('.lg-red').forEach((e) => e.remove());
  for (const m of marks(app)) {
    if (m.page !== i) continue;
    let css;
    const vp = app.viewer.getViewport(i); if (!vp) continue;
    const [l, t, w, hh] = viewportRect(vp, m.rect); css = { left: l, top: t, width: w, height: hh };
    const el = app.ui.h('div', { class: 'lg-red' + (m.on ? '' : ' off') + (m.source === 'pagina' ? ' page' : ''), title: (m.text ? `«${m.text}» — ` : '') + (m.on ? 'sarà oscurato' : 'escluso: non sarà oscurato'), style: { left: css.left + 'px', top: css.top + 'px', width: css.width + 'px', height: css.height + 'px' } },
      app.ui.h('button', { class: 'lg-x', title: 'Togli questa area', 'aria-label': 'Togli questa area', onpointerdown: (e) => e.stopPropagation(), onclick: (e) => { e.stopPropagation(); removeMark(app, m.id); } }, '×'));
    ov.append(el);
  }
}
function redrawAll(app) {
  if (!active) return;
  const pages = new Set(marks(app).map((m) => m.page));
  for (const i of active.drawn) pages.add(i);
  active.drawn = new Set(marks(app).map((m) => m.page));
  for (const i of pages) drawPage(app, i);
  updateCounter(app);
  active.onChange?.();
}
function removeMark(app, id) {
  const s = st(app.activeDoc);
  s.marks = s.marks.filter((m) => m.id !== id);
  redrawAll(app);
}
function updateCounter(app) {
  if (!active?.counter) return;
  const n = countActive(app); const pages = new Set(marks(app).filter((m) => m.on).map((m) => m.page)).size;
  active.counter.textContent = n ? `${n} ${n === 1 ? 'area segnata' : 'aree segnate'} su ${pages} ${pages === 1 ? 'pagina' : 'pagine'}` : 'Nessuna area segnata';
  if (active.applyBtn) active.applyBtn.disabled = !n;
}

// ---------- interazione ----------
function pageIndexAt(app, x, y) {
  const el = document.elementFromPoint(x, y)?.closest?.('.page[data-page-number]');
  return el ? Number(el.dataset.pageNumber) - 1 : -1;
}

function setMode(app, mode) {
  active.mode = mode;
  app.viewer.setMode(mode === 'area' ? 'tool' : 'select', 'crosshair');
  active.modeBtns?.forEach((b) => b.classList.toggle('primary', b.dataset.mode === mode));
}

function wirePointer(app) {
  const container = app.viewer.container;
  let drag = null;
  const down = (e) => {
    if (!active || active.mode !== 'area' || e.button !== 0) return;
    const ov = e.target.closest?.('.leggio-overlay');
    if (!ov || e.target.closest('.lg-red')) return;
    const i = Number(ov.dataset.pageIndex);
    const p = app.viewer.clientToPdf(i, e.clientX, e.clientY);
    if (!p) return;
    const draft = app.ui.h('div', { class: 'lg-red-draft' });
    ov.append(draft);
    drag = { i, p, ov, draft, x: e.clientX, y: e.clientY };
    ov.setPointerCapture?.(e.pointerId);
    e.preventDefault();
  };
  const move = (e) => {
    if (!drag) return;
    const r = drag.ov.getBoundingClientRect();
    const x1 = Math.min(drag.x, e.clientX) - r.left; const y1 = Math.min(drag.y, e.clientY) - r.top;
    Object.assign(drag.draft.style, { left: x1 + 'px', top: y1 + 'px', width: Math.abs(e.clientX - drag.x) + 'px', height: Math.abs(e.clientY - drag.y) + 'px' });
  };
  const up = (e) => {
    if (!drag) return;
    const d = drag; drag = null; d.draft.remove();
    const q = app.viewer.clientToPdf(d.i, e.clientX, e.clientY);
    if (!q) return;
    const rect = normRect([d.p[0], d.p[1], q[0], q[1]]);
    if (rect[2] - rect[0] < 3 || rect[3] - rect[1] < 3) return;
    addMark(app, { page: d.i, rect, source: 'area' });
    redrawAll(app);
  };
  const mouseup = () => {
    if (!active || active.mode !== 'testo') return;
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return;
    const text = sel.toString().trim();
    let added = 0;
    for (let k = 0; k < sel.rangeCount; k++) {
      for (const r of sel.getRangeAt(k).getClientRects()) {
        if (r.width < 1 || r.height < 1) continue;
        const i = pageIndexAt(app, r.left + r.width / 2, r.top + r.height / 2);
        if (i < 0) continue;
        const a = app.viewer.clientToPdf(i, r.left, r.bottom); const b = app.viewer.clientToPdf(i, r.right, r.top);
        if (!a || !b) continue;
        addMark(app, { page: i, rect: padRect(normRect([a[0], a[1], b[0], b[1]]), 0.6), source: 'testo', text });
        added++;
      }
    }
    if (added) { sel.removeAllRanges(); redrawAll(app); }
  };
  container.addEventListener('pointerdown', down, true);
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  container.addEventListener('mouseup', mouseup);
  return () => {
    container.removeEventListener('pointerdown', down, true);
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    container.removeEventListener('mouseup', mouseup);
  };
}

// ---------- strumento ----------
export function redactTool() {
  return {
    activate(app, opts) {
      const { h } = app.ui;
      active = { app, mode: 'area', drawn: new Set(), cleanup: [] };
      const mb = (mode, label, title) => { const b = h('button', { class: 'btn small', 'data-mode': mode, title, onclick: () => setMode(app, mode) }, label); return b; };
      active.modeBtns = [mb('area', 'Riquadro', 'Trascina sulla pagina per segnare un\'area (anche firme e timbri)'), mb('testo', 'Testo selezionato', 'Seleziona del testo: viene segnato quando lasci il mouse')];
      active.counter = h('span', { class: 'muted', 'aria-live': 'polite' });
      active.applyBtn = h('button', { class: 'btn small primary', onclick: () => applyRedactions(app).catch((e) => app.reportError(e, 'Oscuramento non riuscito')) }, 'Applica oscuramento…');
      opts.append(...active.modeBtns,
        h('button', { class: 'btn small', onclick: () => openSearchPanel(app) }, 'Cerca e oscura…'),
        h('button', { class: 'btn small', onclick: () => markPages(app).catch((e) => app.reportError(e, 'Pagine intere')) }, 'Pagine intere…'),
        h('button', { class: 'btn small', onclick: () => clearMarks(app) }, 'Togli tutti i segni'),
        active.counter, active.applyBtn);
      setMode(app, 'area');
      active.cleanup.push(wirePointer(app));
      active.cleanup.push(app.bus.on?.('page:rendered', ({ pageIndex }) => drawPage(app, pageIndex)) || null);
      redrawAll(app);
      if (!marks(app).length) app.ui.toast('Trascina per segnare un\'area, oppure usa «Cerca e oscura» per trovare codici fiscali, IBAN e altri dati.', { timeout: 6000 });
    },
    deactivate(app) {
      if (!active) return;
      for (const c of active.cleanup) { try { typeof c === 'function' && c(); } catch { /* */ } }
      const pages = new Set(marks(app).map((m) => m.page));
      const a = active; active = null;
      for (const i of [...pages, ...a.drawn]) app.viewer.getOverlay(i)?.querySelectorAll('.lg-red').forEach((e) => e.remove());
      const n = app.activeDoc ? marks(app).filter((m) => m.on).length : 0;
      if (n) app.ui.toast(`Hai ${n} aree segnate non ancora oscurate: riapri «Oscura» per applicarle.`, { kind: 'warning', timeout: 5000 });
    },
  };
}

async function clearMarks(app) {
  if (!marks(app).length) return;
  if (!(await app.ui.confirm('Vuoi togliere tutti i segni di oscuramento non ancora applicati?', { okLabel: 'Togli tutti' }))) return;
  st(app.activeDoc).marks = [];
  redrawAll(app);
  active?.renderResults?.();
}

async function markPages(app) {
  const doc = app.activeDoc;
  const v = await app.ui.dialog({ title: 'Oscura pagine intere', okLabel: 'Segna', fields: [{ type: 'pages', name: 'p', label: 'Pagine da oscurare completamente', value: String(app.viewer.page), required: true }], validate: (x) => { try { app.parsePages(x.p); return null; } catch (e) { return e.message; } } });
  if (!v) return;
  for (const i of app.parsePages(v.p)) {
    const page = await doc.pdf.getPage(i + 1);
    addMark(app, { page: i, rect: page.view.slice(), source: 'pagina' });
  }
  redrawAll(app);
}

// ---------- cerca e oscura ----------
export async function openSearchPanel(app) {
  const { h } = app.ui;
  if (app.tools.active?.id !== 'redact') app.tools.run('redact');
  const c = app.openRightPanel('Cerca e oscura', { onClose: () => { if (active) active.renderResults = null; } });
  const terms = h('textarea', { class: 'input', rows: 3, placeholder: 'Parole o frasi da oscurare, una per riga (es. Mario Rossi)', 'aria-label': 'Parole da cercare', style: { height: 'auto', padding: '8px 10px' } });
  const models = MODELLI.map((m) => { const i = h('input', { type: 'checkbox', value: m.id, checked: ['cf', 'iban'].includes(m.id) }); return { i, el: h('label', { title: 'Esempio: ' + m.esempio }, i, m.label) }; });
  const cs = h('input', { type: 'checkbox' }); const ww = h('input', { type: 'checkbox', checked: true });
  const regex = h('input', { class: 'input', placeholder: 'es. Prot\\. n\\. \\d+', 'aria-label': 'Espressione regolare' });
  const status = h('div', { class: 'muted', 'aria-live': 'polite', style: { margin: '8px 0' } });
  const list = h('div');
  const go = h('button', { class: 'btn primary', onclick: () => run().catch((e) => app.reportError(e, 'Ricerca non riuscita')) }, 'Cerca');
  c.append(
    h('div', { class: 'lg-section-title' }, 'Cosa cercare'), terms,
    h('div', { class: 'lg-section-title' }, 'Dati personali da trovare'), h('div', { class: 'lg-models' }, models.map((m) => m.el)),
    h('details', {}, h('summary', {}, 'Opzioni avanzate'),
      h('div', { class: 'lg-row' }, h('label', {}, cs, 'Distingui maiuscole e minuscole'), h('label', {}, ww, 'Solo parole intere')),
      h('div', { class: 'field' }, h('label', {}, 'Espressione regolare (per esperti)'), regex)),
    h('div', { class: 'lg-row' }, go), status, list);

  const results = []; // { id, page, text, matcher, before, after, markIds }
  const render = () => {
    list.innerHTML = '';
    const live = results.filter((r) => r.markIds.some((id) => marks(app).some((m) => m.id === id)));
    if (!live.length) return;
    const groups = new Map();
    for (const r of live) { if (!groups.has(r.matcher)) groups.set(r.matcher, []); groups.get(r.matcher).push(r); }
    for (const [label, items] of groups) {
      const onCount = items.filter((r) => isOn(r)).length;
      const all = h('button', { class: 'btn small', onclick: () => { const v = onCount < items.length; items.forEach((r) => setOn(r, v)); redrawAll(app); render(); } }, onCount < items.length ? 'Seleziona tutti' : 'Deseleziona tutti');
      list.append(h('div', { class: 'lg-group' }, `${label} (${onCount}/${items.length})`, all));
      const ul = h('ul', { class: 'lg-res' });
      for (const r of items) {
        const cb = h('input', { type: 'checkbox', checked: isOn(r), 'aria-label': `Oscura ${r.text} a pagina ${r.page + 1}`, onclick: (e) => { e.stopPropagation(); setOn(r, cb.checked); redrawAll(app); render(); } });
        ul.append(h('li', { onclick: () => { app.viewer.scrollToPdfPoint(r.page, r.rect[0] - 40, r.rect[3] + 60); } }, cb,
          h('span', { class: 'ctx' }, '…' + r.before, h('b', {}, r.text), r.after + '…'), h('span', { class: 'pg' }, `pag. ${r.page + 1}`)));
      }
      list.append(ul);
    }
  };
  const isOn = (r) => marks(app).some((m) => r.markIds.includes(m.id) && m.on);
  const setOn = (r, v) => { for (const m of marks(app)) if (r.markIds.includes(m.id)) m.on = v; };
  if (active) { active.renderResults = render; active.onChange = render; }

  async function run() {
    const doc = app.activeDoc;
    const matchers = buildMatchers({ terms: terms.value.split('\n'), regex: regex.value, caseSensitive: cs.checked, wholeWord: ww.checked, models: models.filter((m) => m.i.checked).map((m) => m.i.value) });
    if (!matchers.length) { status.textContent = 'Scrivi una parola oppure scegli almeno un tipo di dato.'; return; }
    let found = 0; let textless = 0; const existing = new Set(marks(app).map((m) => `${m.page}:${m.rect.map((x) => x.toFixed(1)).join(',')}`));
    await app.ui.withProgress('Ricerca nel documento…', async (p) => {
      for (let i = 0; i < doc.pageCount; i++) {
        if (p.signal.aborted) throw new DOMException('Annullata', 'AbortError');
        if (i % 5 === 0) p.set(i / doc.pageCount, `Pagina ${i + 1} di ${doc.pageCount}`);
        const page = await doc.pdf.getPage(i + 1);
        const tc = await page.getTextContent();
        page.cleanup();
        if (!tc.items.some((x) => x.str && x.str.trim())) { textless++; continue; }
        const pt = buildPageText(tc.items, tc.styles);
        for (const hit of findMatches(pt.text, matchers)) {
          const rects = rangeRects(pt, hit.start, hit.end);
          if (!rects.length) continue;
          const on = !DEFAULT_OFF.has(hit.matcher);
          const ids = [];
          for (const rect of rects) {
            const key = `${i}:${normRect(rect).map((x) => x.toFixed(1)).join(',')}`;
            if (existing.has(key)) continue;
            existing.add(key);
            ids.push(addMark(app, { page: i, rect, source: 'ricerca', text: hit.text, on }).id);
          }
          if (!ids.length) continue;
          const flat = pt.text.replace(/\s+/g, ' ');
          results.push({ id: results.length, page: i, text: hit.text, matcher: hit.matcher, rect: normRect(rects[0]), markIds: ids,
            before: pt.text.slice(Math.max(0, hit.start - 30), hit.start).replace(/\s+/g, ' '), after: pt.text.slice(hit.end, hit.end + 30).replace(/\s+/g, ' ') });
          void flat;
          found++;
        }
      }
    });
    redrawAll(app); render();
    status.innerHTML = '';
    status.append(found ? `Trovati ${found} risultati. Controlla l'elenco: togli la spunta da quelli da lasciare visibili (le partite IVA delle aziende e le date sono escluse in partenza).` : 'Nessun risultato.');
    if (textless) {
      const ocrBtn = h('button', { class: 'btn small', onclick: () => runOcr(app) }, 'Rendi ricercabile (OCR)');
      status.append(h('div', { style: { marginTop: '8px' } }, boxAvviso(app, `${textless} ${textless === 1 ? 'pagina non contiene' : 'pagine non contengono'} testo (probabilmente scansioni): lì i dati non si possono trovare finché non esegui il riconoscimento del testo (OCR). Puoi comunque oscurarli a mano con «Riquadro».`), ocrBtn));
    }
  }
  render();
  terms.focus();
}

async function runOcr(app) {
  const svc = app.services?.ocr;
  if (typeof svc === 'function') {
    // contratto atteso (area conversione): ocr(bytes, { signal, onProgress }) → byte PDF con testo invisibile
    await app.ui.withProgress('Riconoscimento del testo (OCR)…', async (p) => {
      await app.applyEdit('Riconoscimento del testo (OCR)', (bytes) => svc(bytes, { signal: p.signal, onProgress: (f, t) => p.set(f, t) }));
    });
    app.ui.toast('Testo riconosciuto: ora puoi ripetere la ricerca.', { kind: 'success' });
    return;
  }
  if (app.tools.get('ocr')) { app.ui.toast('Esegui l\'OCR, poi torna a «Cerca e oscura» e ripeti la ricerca.', { timeout: 6000 }); app.tools.run('ocr'); return; }
  app.ui.toast('Il riconoscimento del testo (OCR) non è disponibile in questa versione: oscura le parti a mano con «Riquadro».', { kind: 'warning', timeout: 7000 });
}

// ---------- applicazione ----------
async function applyRedactions(app) {
  const doc = app.activeDoc;
  const on = marks(app).filter((m) => m.on);
  if (!on.length) { app.ui.toast('Segna prima almeno un\'area da oscurare.', { kind: 'warning' }); return; }
  const bytes = await app.currentBytes(doc);
  const nSig = signatureCount(bytes);
  const byPage = new Map();
  for (const m of on) { if (!byPage.has(m.page)) byPage.set(m.page, []); byPage.get(m.page).push(m.rect); }
  const v = await app.ui.dialog({
    title: 'Applica oscuramento', okLabel: 'Oscura definitivamente', danger: true, width: 520,
    body: app.ui.h('div', {},
      boxAvviso(app, `Verranno eliminati per sempre il testo, le immagini, i commenti e i campi sotto ${on.length} ${on.length === 1 ? 'area' : 'aree'} su ${byPage.size} ${byPage.size === 1 ? 'pagina' : 'pagine'}. Le pagine interessate diventano immagini con il testo restante ancora ricercabile; le altre pagine restano intatte.`, 'info'),
      nSig ? boxAvviso(app, avvisoFirma(nSig, 'oscuri')) : null),
    fields: [
      { type: 'color', name: 'color', label: 'Colore dei riquadri', value: app.settings.get('sic.redColor', '#000000') },
      { type: 'text', name: 'label', label: 'Testo sui riquadri (facoltativo)', value: app.settings.get('sic.redLabel', ''), placeholder: 'es. OMISSIS' },
      { type: 'checkbox', name: 'sanitize', label: 'Rimuovi anche le informazioni nascoste (proprietà, metadati, commenti, allegati, livelli, JavaScript)', value: app.settings.get('sic.redSanitize', true) },
      { type: 'radio', name: 'out', value: nSig ? 'copy' : app.settings.get('sic.redOut', 'copy'), options: [
        { value: 'copy', label: `Salva una copia «${copyName(doc, 'oscurato')}» (consigliato: l'originale resta intatto)` },
        { value: 'doc', label: 'Applica al documento aperto (si può annullare finché non salvi)' }] },
    ],
  });
  if (!v) return;
  app.settings.set('sic.redColor', v.color); app.settings.set('sic.redLabel', v.label); app.settings.set('sic.redSanitize', v.sanitize); app.settings.set('sic.redOut', v.out);
  const { pdfjs } = app.lib;
  const t0 = performance.now();
  const result = await app.ui.withProgress('Oscuramento in corso…', async (p) => {
    const pdfDoc = await openForEdit(bytes, doc);
    const font = await embedTextFont(pdfDoc);
    const pages = [...byPage.keys()].sort((a, b) => a - b);
    const removedTexts = new Set(); let annots = 0; let fields = 0;
    // termini da cercare ovunque nella verifica: risultati della ricerca e testo selezionato,
    // esclusi quelli che l'utente ha deliberatamente lasciato visibili altrove
    const offTexts = new Set(marks(app).filter((m) => !m.on && m.text).map((m) => m.text.toLowerCase()));
    const globalTerms = [...new Set(on.filter((m) => m.text && !offTexts.has(m.text.toLowerCase())).map((m) => m.text))];
    for (let k = 0; k < pages.length; k++) {
      if (p.signal.aborted) throw new DOMException('Annullato', 'AbortError');
      const i = pages[k]; const rects = byPage.get(i);
      p.set(k / (pages.length + 2), `Pagina ${i + 1} (${k + 1} di ${pages.length})`);
      const page = await doc.pdf.getPage(i + 1);
      const tc = await page.getTextContent();
      page.cleanup();
      const words = pageWords(tc.items, tc.styles);
      const keep = wordsOutside(words, rects);
      for (const w of words) if (wordHit(w, rects)) removedTexts.add(w.text);
      const img = await renderRedactedPage(pdfjs, doc.pdf, i, rects, { color: v.color, label: v.label.trim(), dpi: pages.length > 60 ? 200 : 300, quality: pages.length > 60 ? 0.85 : 0.92 });
      const r = await redactPage(pdfDoc, i, { image: img, view: img.view, rects, keepWords: keep, font });
      annots += r.annots; fields += r.fields;
    }
    p.set(pages.length / (pages.length + 2), 'Pulizia del documento…');
    const replace = (s, rep = '████') => { let o = s; for (const t of globalTerms) o = o.split(t).join(rep); return o; };
    const outlineChanged = globalTerms.length ? redactOutlineTitles(pdfDoc, replace) : 0;
    // proprietà del documento: i termini oscurati non devono restare nel titolo o nell'oggetto
    const info = lookupDict(pdfDoc.context, pdfDoc.context.trailerInfo.Info);
    if (info && globalTerms.length) for (const [key, val] of info.entries()) {
      const o = pdfDoc.context.lookup(val);
      if (o instanceof PDFString || o instanceof PDFHexString) { const s = o.decodeText(); const r = replace(s); if (r !== s) info.set(key, PDFHexString.fromText(r)); }
    }
    const structure = removeStructure(pdfDoc);
    const san = v.sanitize ? sanitize(pdfDoc, {}) : null;
    if (!v.sanitize && pdfDoc.catalog.get(N('Metadata')) && globalTerms.length) pdfDoc.catalog.delete(N('Metadata'));
    await finalizeRedaction(pdfDoc);
    const out = await pdfDoc.save({ useObjectStreams: true });
    p.set((pages.length + 1) / (pages.length + 2), 'Verifica: controllo che i dati oscurati non siano più presenti…');
    const marksMap = new Map([...byPage.entries()].map(([i, rs]) => [i, rs]));
    const ver = await verifyRedaction(pdfjs, out, marksMap, globalTerms, { signal: p.signal, getDocumentOptions: PDFJS_ASSETS });
    return { out, ver, pages: pages.length, areas: on.length, removedTexts: removedTexts.size, annots, fields, outlineChanged, structure, san, ms: performance.now() - t0 };
  });
  if (!result) return;
  const { h } = app.ui;
  if (!result.ver.ok) {
    const lines = result.ver.problems.slice(0, 12).map((x) => h('li', {}, `${x.page ? 'pag. ' + x.page + ' — ' : ''}${x.where}: «${x.text}»`));
    const again = await app.ui.dialog({
      title: 'Verifica NON superata', okLabel: 'Apri il risultato per controllare', cancelLabel: 'Chiudi', width: 560,
      body: h('div', {}, boxAvviso(app, 'Attenzione: dopo l\'oscuramento alcuni dei testi oscurati risultano ancora presenti nel file. Il risultato NON è sicuro e non è stato salvato.', 'error'), h('ul', {}, lines), h('p', { class: 'muted' }, 'Puoi aprire il risultato in una nuova scheda per capire cosa è rimasto, segnare aree più ampie e riprovare.')),
    });
    if (again) await app.openBytes(result.out, { name: copyName(doc, 'oscurato_NON_VERIFICATO') });
    return;
  }
  const sanTot = result.san ? Object.values(result.san).reduce((a, b) => a + b, 0) : 0;
  const items = [
    `${result.areas} ${result.areas === 1 ? 'area oscurata' : 'aree oscurate'} su ${result.pages} ${result.pages === 1 ? 'pagina' : 'pagine'}`,
    `${result.removedTexts} parole eliminate dal livello di testo`,
    result.annots ? `${result.annots} commenti, link o campi eliminati perché si trovavano nelle aree` : null,
    result.outlineChanged ? `${result.outlineChanged} segnalibri ripuliti` : null,
    result.structure ? 'struttura per l\'accessibilità tolta (poteva contenere il testo oscurato)' : null,
    result.san ? `informazioni nascoste rimosse: ${sanTot} elementi (proprietà, metadati, allegati, commenti, livelli…)` : null,
    `verifica superata: nessuno dei testi oscurati è più presente nel file (${(result.ms / 1000).toFixed(1).replace('.', ',')} s)`,
  ].filter(Boolean);
  const body = h('div', {}, boxAvviso(app, 'Oscuramento completato e verificato.', 'ok'), h('ul', {}, items.map((x) => h('li', {}, x))));
  if (v.out === 'copy') {
    const ok = await app.ui.dialog({ title: 'Oscuramento completato', okLabel: 'Salva la copia…', cancelLabel: 'Annulla', body, width: 540 });
    if (ok && await salvaCopia(app, result.out, copyName(doc, 'oscurato'))) { st(doc).marks = st(doc).marks.filter((m) => !m.on); redrawAll(app); }
  } else {
    const done = await app.applyEdit('Oscuramento', async () => result.out);
    if (done) {
      st(doc).marks = [];
      redrawAll(app);
      await app.ui.dialog({ title: 'Oscuramento completato', okLabel: 'Chiudi', cancelLabel: null, body: h('div', {}, body, h('p', { class: 'muted' }, 'Ricorda di salvare il documento (meglio con «Salva con nome»).')), width: 540 });
    }
  }
}

/** Per i servizi: oscura termini/modelli in byte arbitrari (senza interfaccia). Richiede un PDFDocumentProxy. */
export { applyRedactions };
