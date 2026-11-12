// «Trova e sostituisci»: cerca nel testo vero del PDF, mostra le occorrenze, sostituisce una per una o tutte.
import { findInPage, pageSearchText, replaceMatches } from '../operations.js';
import { pageAnalysis, readOnlyPdfLib, textContentOf, verifyPages, confirmSigned, ENV, forEachRenderedPage, toolLayer, clearLayers, place, rectToCss } from './common.js';

const LAYER = 'lgm-find';

export function findReplaceTool(app) {
  const { h } = app.ui;
  let S = null;

  function open() {
    if (S) { S.q.focus(); return; }
    const c = app.openRightPanel('Trova e sostituisci', { onClose: close });
    const q = h('input', { type: 'search', class: 'lgm-input', placeholder: 'Testo da cercare', 'aria-label': 'Testo da cercare' });
    const r = h('input', { type: 'text', class: 'lgm-input', placeholder: 'Nuovo testo (vuoto = elimina)', 'aria-label': 'Sostituisci con' });
    const cs = h('input', { type: 'checkbox', id: 'lgm-fr-cs' });
    const ww = h('input', { type: 'checkbox', id: 'lgm-fr-ww' });
    const list = h('div', { class: 'lgm-fr-list', role: 'list' });
    const status = h('p', { class: 'lgm-fr-status', 'aria-live': 'polite' });
    const btnSel = h('button', { class: 'btn', disabled: true, onclick: () => replace(false) }, 'Sostituisci selezionate');
    const btnAll = h('button', { class: 'btn primary', disabled: true, onclick: () => replace(true) }, 'Sostituisci tutte');
    const search = h('button', { class: 'btn', onclick: () => run() }, 'Cerca');
    q.addEventListener('keydown', (e) => { if (e.key === 'Enter') run(); });
    r.addEventListener('keydown', (e) => { if (e.key === 'Enter' && S.results.length) replace(true); });
    c.append(h('div', { class: 'lgm-fr' },
      h('label', { class: 'lgm-fr-lbl' }, 'Trova', q),
      h('label', { class: 'lgm-fr-lbl' }, 'Sostituisci con', r),
      h('div', { class: 'lgm-fr-opts' }, h('label', { for: 'lgm-fr-cs' }, cs, ' Maiuscole/minuscole'), h('label', { for: 'lgm-fr-ww' }, ww, ' Solo parole intere')),
      h('div', { class: 'lgm-fr-actions' }, search),
      status, list,
      h('div', { class: 'lgm-fr-actions' }, btnSel, btnAll),
      h('p', { class: 'lgm-fr-note' }, 'Cerca nel testo vero del PDF: non trova le parole dentro le immagini o nelle scansioni senza riconoscimento del testo (OCR). La parola nuova usa lo stesso carattere quando il documento lo contiene; altrimenti un carattere simile. Se la parola nuova è più lunga, il resto della riga può non spostarsi: controlla il risultato (puoi sempre annullare).')));
    S = { q, r, cs, ww, list, status, btnSel, btnAll, results: [], current: -1, unsub: [] };
    S.unsub.push(app.bus.on('page:rendered', ({ pageIndex, overlay }) => drawHighlights(pageIndex, overlay)));
    S.unsub.push(app.bus.on('document:activated', () => app.closeRightPanel() || close()));
    S.unsub.push(app.bus.on('document:changed', () => { if (S && !S.replacing) { S.results = []; renderList(); S.status.textContent = 'Il documento è cambiato: ripeti la ricerca.'; } }));
    const sel = getSelection()?.toString().trim();
    if (sel && sel.length < 80 && !sel.includes('\n')) q.value = sel;
    q.focus();
  }

  function close() {
    if (!S) return;
    S.unsub.forEach((u) => u());
    S = null;
    clearLayers(app, LAYER);
  }

  async function run() {
    const query = S.q.value;
    if (!query.trim()) { S.status.textContent = 'Scrivi il testo da cercare.'; return; }
    const doc = app.activeDoc; const n = doc.pageCount;
    try { if ((await readOnlyPdfLib(app, doc)).isEncrypted) { S.status.textContent = 'Il documento è protetto contro le modifiche: togli prima la protezione (strumenti «Proteggi»).'; return; } }
    catch (err) { app.reportError(err, 'Impossibile leggere il documento'); return; }
    const opts = { caseSensitive: S.cs.checked, wholeWord: S.ww.checked };
    const results = []; let unreadable = 0;
    const work = async (p) => {
      for (let i = 0; i < n; i++) {
        if (p?.cancelled) throw Object.assign(new Error('annullato'), { name: 'AbortError' });
        p?.set(i / n, `Pagina ${i + 1} di ${n}`);
        let A;
        try { A = await pageAnalysis(app, i, doc); } catch (err) { console.warn('[modifica] pagina illeggibile', i, err); unreadable++; continue; }
        const pst = pageSearchText(A);
        if (!pst.complete) unreadable++;
        for (const m of findInPage(A, query, opts, pst)) results.push({ ...m, pageIndex: i, selected: true, refs: undefined });
        if (i % 4 === 3) await new Promise((r) => setTimeout(r));
      }
    };
    S.status.textContent = 'Ricerca in corso…';
    try {
      if (n > 25) await app.ui.withProgress('Ricerca nel documento', work);
      else await work(null);
    } catch (err) { app.reportError(err, 'Ricerca non riuscita'); return; }
    if (!S) return;
    S.results = results; S.current = -1; S.query = query; S.opts = opts;
    const pages = new Set(results.map((x) => x.pageIndex)).size;
    S.status.textContent = results.length ? `${results.length} ${results.length === 1 ? 'occorrenza' : 'occorrenze'} in ${pages} ${pages === 1 ? 'pagina' : 'pagine'}.` : 'Nessuna occorrenza trovata.';
    if (unreadable) S.status.textContent += ` In ${unreadable} ${unreadable === 1 ? 'pagina' : 'pagine'} una parte del testo non è leggibile (caratteri senza codifica o immagini).`;
    renderList();
    forEachRenderedPage(app, (i, ov) => drawHighlights(i, ov));
    if (results.length) goTo(0);
  }

  function renderList() {
    if (!S) return;
    S.list.innerHTML = '';
    S.results.forEach((m, k) => {
      const cb = h('input', { type: 'checkbox', checked: m.selected, 'aria-label': 'Includi questa occorrenza' });
      cb.addEventListener('change', () => { m.selected = cb.checked; updateButtons(); });
      const row = h('div', { class: 'lgm-fr-item' + (k === S.current ? ' current' : ''), role: 'listitem' }, cb,
        h('button', { class: 'lgm-fr-ctx', onclick: () => goTo(k), title: 'Mostra nella pagina' },
          h('span', { class: 'lgm-fr-page' }, 'p. ' + (m.pageIndex + 1)), ' …', m.before, h('mark', {}, m.text), m.after, '…'));
      S.list.append(row);
    });
    updateButtons();
  }
  function updateButtons() {
    const sel = S.results.filter((m) => m.selected).length;
    S.btnSel.disabled = !sel; S.btnAll.disabled = !S.results.length;
    S.btnSel.textContent = sel && sel !== S.results.length ? `Sostituisci selezionate (${sel})` : 'Sostituisci selezionate';
  }

  function goTo(k) {
    const m = S.results[k]; if (!m) return;
    S.current = k;
    const vb = app.viewer.getViewport(m.pageIndex)?.viewBox || [0, 0];
    app.viewer.scrollToPdfPoint(m.pageIndex, vb[0], m.rect[3] + 80);
    [...S.list.children].forEach((el, i) => el.classList.toggle('current', i === k));
    S.list.children[k]?.scrollIntoView({ block: 'nearest' });
    forEachRenderedPage(app, (i, ov) => drawHighlights(i, ov));
  }

  function drawHighlights(pageIndex, overlay) {
    if (!S || !overlay) return;
    const layer = toolLayer(overlay, LAYER);
    layer.innerHTML = '';
    S.results.forEach((m, k) => {
      if (m.pageIndex !== pageIndex) return;
      const el = h('div', { class: 'lgm-hit' + (k === S.current ? ' current' : '') });
      place(el, rectToCss(app, pageIndex, m.rect), 1);
      layer.append(el);
    });
  }

  async function replace(all) {
    const chosen = S.results.filter((m) => all || m.selected);
    if (!chosen.length) return;
    if (!(await confirmSigned(app))) return;
    const replacement = S.r.value;
    if (all && chosen.length > 1 && !(await app.ui.confirm(`Sostituire ${chosen.length} occorrenze di «${S.query}» con «${replacement || '(niente)'}»?`, { title: 'Sostituisci tutte', okLabel: 'Sostituisci' }))) return;
    const byPage = new Map();
    for (const m of chosen) { if (!byPage.has(m.pageIndex)) byPage.set(m.pageIndex, []); byPage.get(m.pageIndex).push(m); }
    const pages = [...byPage.keys()];
    const doc = app.activeDoc;
    let summary = null;
    S.replacing = true;
    const label = chosen.length === 1 ? 'Testo sostituito' : `Sostituite ${chosen.length} occorrenze`;
    const ok = await app.applyEdit(label, async (bytes) => app.ui.withProgress('Sostituzione in corso', async (p) => {
      const before = await textContentOf(app, bytes, pages);
      const modes = new Map(pages.map((i) => [i, 'auto']));
      const order = ['auto', 'overlay', 'cover'];
      for (let attempt = 0; attempt < 3; attempt++) {
        const pdfDoc = await app.lib.openPdfLib(bytes, doc.password);
        const counts = { inplace: 0, overlay: 0, cover: 0, skipped: 0 };
        let k = 0;
        for (const i of pages) {
          if (p.cancelled) throw Object.assign(new Error('annullato'), { name: 'AbortError' });
          p.set(k++ / pages.length * 0.8, `Pagina ${i + 1}`);
          const mode = modes.get(i);
          const res = await replaceMatches(pdfDoc, i, byPage.get(i), replacement, ENV, { mode: mode === 'auto' ? undefined : mode });
          for (const x of res.results) counts[x.method] = (counts[x.method] || 0) + 1;
          if (k % 4 === 0) await new Promise((r) => setTimeout(r));
        }
        p.set(0.85, 'Controllo del risultato…');
        const out = await app.lib.savePdfLib(pdfDoc);
        const checks = pages.map((i) => ({ pageIndex: i, before: before.get(i), exclude: byPage.get(i).map((m) => [-1e6, m.rect[1] - 2, 1e6, m.rect[3] + 2]), expect: replacement.trim() ? [replacement] : [] }));
        const v = await verifyPages(app, out, checks);
        if (v.ok) { summary = counts; return out; }
        let progressed = false;
        for (const i of v.failed) { const nx = order[order.indexOf(modes.get(i)) + 1]; if (nx) { modes.set(i, nx); progressed = true; } }
        console.warn('[modifica] sostituzione: verifica non superata', v);
        if (!progressed) throw new Error('La sostituzione non è stata applicata perché il risultato non superava i controlli di sicurezza (' + v.reason + '). Il documento non è stato toccato.');
      }
      throw new Error('La sostituzione non è stata applicata: il risultato non superava i controlli di sicurezza. Il documento non è stato toccato.');
    })).catch((err) => { app.reportError(err, 'Sostituzione non riuscita'); return false; });
    if (!S) return;
    S.replacing = false;
    if (ok && summary) {
      const notes = [];
      if (summary.skipped) notes.push(`${summary.skipped} non sostituite perché il testo era cambiato`);
      if (summary.overlay) notes.push(`${summary.overlay} riscritte con un carattere simile (quello del documento non ha tutte le lettere): il resto della riga non si sposta`);
      if (summary.cover) notes.push(`${summary.cover} coperte con un riquadro del colore dello sfondo (il testo originale resta sotto)`);
      S.status.textContent = `Fatto: ${summary.inplace + summary.overlay + summary.cover} sostituzioni.` + (notes.length ? ' ' + notes.join('; ') + '.' : '');
      if (notes.length) app.ui.toast(S.status.textContent, { kind: 'warning', timeout: 9000 });
      S.results = []; renderList(); clearLayers(app, LAYER);
    }
  }

  return {
    id: 'find-replace', name: 'Trova e sostituisci', category: 'modifica', icon: 'search',
    description: 'Cambia una parola o una data in tutto il documento, con l\'elenco delle occorrenze e conferma una per una',
    keywords: 'trova sostituisci cerca e sostituisci cambia parola data scadenza in tutto il documento modifica pdf',
    run: () => open(),
  };
}
