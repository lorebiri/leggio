// «Cerca in più PDF»: ricerca testuale in tutti i PDF di una cartella (anche sottocartelle).
import { openPdfJs } from '../../../core/pdf.js';
import { destroyPdf } from '../native.js';
import { pageText, findMatches } from '../lib/textsearch.js';
import { chooseFolder, chooseFiles } from '../native.js';

const MAX_FILE = 300 * 1024 * 1024;
const MAX_TOTAL_HITS = 5000;
const FILE_TIMEOUT = 60000;

export function openSearchFolder(app, deps) {
  const { h } = app.ui;
  const pane = deps.openPane(app, { title: 'Cerca in più PDF', subtitle: 'Cerca una parola o una frase in tutti i PDF di una cartella, anche nelle sottocartelle.', id: 'search-folder' });
  const state = { items: [], label: '', running: null };
  const input = h('input', { type: 'search', placeholder: 'Parola o frase da cercare (es. numero di fattura, CIG, cognome)', 'aria-label': 'Testo da cercare', value: app.settings.get('avanzati.search.last', '') });
  const cs = h('input', { type: 'checkbox', id: 'av-s-cs' });
  const ww = h('input', { type: 'checkbox', id: 'av-s-ww' });
  const rec = h('input', { type: 'checkbox', id: 'av-s-rec', checked: true });
  const where = h('span', { class: 'av-note' }, 'Nessuna cartella scelta.');
  const bar = h('div', { class: 'av-progress', hidden: true }, h('div'));
  const status = h('div', { class: 'av-status', role: 'status', 'aria-live': 'polite' });
  const results = h('div', { class: 'av-results' });
  const goBtn = h('button', { class: 'btn primary', onclick: () => cerca() }, 'Cerca');
  const stopBtn = h('button', { class: 'btn', hidden: true, onclick: () => state.running?.abort() }, 'Interrompi');
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') cerca(); });
  const scegli = async () => {
    try {
      const r = await chooseFolder(app, { recursive: rec.checked, title: 'Scegli la cartella in cui cercare' });
      if (!r) return;
      state.items = r.items; state.label = r.label;
      where.textContent = `${r.items.length} PDF in «${r.label}»${r.truncated ? ' (solo i primi 20.000)' : ''}`;
      if (input.value.trim()) cerca();
      else input.focus();
    } catch (e) { app.reportError(e, 'Cartella non leggibile'); }
  };
  pane.body.append(
    h('div', { class: 'av-search-bar' }, h('button', { class: 'btn', onclick: scegli }, 'Scegli cartella…'),
      h('button', { class: 'btn', onclick: async () => { try { const it = await chooseFiles(app, { title: 'Scegli i PDF in cui cercare' }); if (it.length) { state.items = it; state.label = `${it.length} file scelti`; where.textContent = state.label; } } catch (e) { app.reportError(e, 'File non aggiunti'); } } }, 'Scegli file…'), where),
    h('div', { class: 'av-search-bar' }, input, goBtn, stopBtn),
    h('div', { class: 'av-search-bar' }, h('label', { class: 'chk', for: 'av-s-cs' }, cs, 'Maiuscole/minuscole'), h('label', { class: 'chk', for: 'av-s-ww' }, ww, 'Parole intere'), h('label', { class: 'chk', for: 'av-s-rec' }, rec, 'Comprendi le sottocartelle')),
    bar, status, results);
  setTimeout(() => input.focus(), 50);

  async function cerca() {
    const q = input.value.trim();
    if (!q) return input.focus();
    if (q.length < 2) return app.ui.toast('Scrivi almeno 2 caratteri.', { kind: 'warning' });
    if (!state.items.length) return scegli();
    state.running?.abort();
    const ctrl = new AbortController(); state.running = ctrl;
    app.settings.set('avanzati.search.last', q);
    results.innerHTML = ''; bar.hidden = false; stopBtn.hidden = false; goBtn.disabled = true;
    const skipped = []; let totalHits = 0; let filesWithHits = 0; let done = 0;
    const t0 = Date.now();
    const opts = { caseSensitive: cs.checked, wholeWord: ww.checked };
    for (const it of state.items) {
      if (ctrl.signal.aborted) break;
      done++;
      bar.firstChild.style.width = Math.round((done / state.items.length) * 100) + '%';
      status.textContent = `Ricerca in corso: file ${done} di ${state.items.length} — ${it.name}`;
      if (it.size > MAX_FILE) { skipped.push({ it, motivo: 'file troppo grande' }); continue; }
      try {
        const hits = await withTimeout(searchFile(it, q, opts, ctrl.signal), FILE_TIMEOUT, 'il file richiede troppo tempo');
        if (hits.length) { filesWithHits++; totalHits += hits.length; results.append(renderFile(it, hits, q)); }
      } catch (e) {
        if (e?.name === 'AbortError') break;
        skipped.push({ it, motivo: e?.name === 'PasswordException' ? 'protetto da password' : /Invalid PDF|InvalidPDF|structure|xref/i.test(e?.message || '') ? 'file danneggiato o non PDF' : (e?.message || 'non leggibile') });
      }
      if (totalHits >= MAX_TOTAL_HITS) { app.ui.toast('Troppi risultati: la ricerca si è fermata. Prova una frase più precisa.', { kind: 'warning', timeout: 6000 }); break; }
    }
    const aborted = ctrl.signal.aborted;
    state.running = null; bar.hidden = true; stopBtn.hidden = true; goBtn.disabled = false;
    const sec = ((Date.now() - t0) / 1000).toFixed(1).replace('.', ',');
    status.textContent = `${aborted ? 'Ricerca interrotta. ' : ''}«${q}»: ${totalHits} risultati in ${filesWithHits} file su ${done} esaminati (${sec} s).${skipped.length ? ` ${skipped.length} file saltati.` : ''}`;
    if (!totalHits && !aborted) results.append(h('p', { class: 'av-note' }, 'Nessun risultato. Le scansioni senza testo riconosciuto non sono ricercabili: rendile ricercabili con il riconoscimento del testo (OCR).'));
    if (skipped.length) {
      results.append(h('details', { class: 'av-box' }, h('summary', {}, `File saltati (${skipped.length})`),
        h('ul', {}, skipped.map((s) => h('li', {}, `${s.it.rel || s.it.name} — ${s.motivo}`)))));
    }
  }

  function renderFile(it, hits, q) {
    const sec = h('section', { class: 'av-res-file' },
      h('header', {}, h('strong', {}, it.rel || it.name), h('small', {}, `${hits.length} ${hits.length === 1 ? 'risultato' : 'risultati'}`)));
    for (const m of hits.slice(0, 30)) {
      sec.append(h('button', { class: 'av-hit', onclick: () => apri(it, m.page, q) },
        h('span', { class: 'av-pg' }, `pag. ${m.page}`), m.before, h('mark', {}, m.match), m.after));
    }
    if (hits.length > 30) sec.append(h('div', { class: 'av-hit av-note' }, `… e altri ${hits.length - 30} risultati in questo file`));
    return sec;
  }

  async function apri(it, page, q) {
    try {
      const bytes = await it.read();
      const doc = await app.openBytes(bytes, { name: it.name, path: it.path || undefined });
      if (!doc) return;
      pane.close();
      await waitPagesInit(app, doc);
      app.viewer.page = page;
      app.openFind();
      const fi = app.el.findbar.querySelector('input');
      if (fi) { fi.value = q; fi.dispatchEvent(new Event('input')); }
    } catch (e) { app.reportError(e, 'Impossibile aprire il file'); }
  }
}

function waitPagesInit(app, doc) {
  return new Promise((resolve) => {
    if (app.viewer.pdfViewer.pagesCount && app.viewer.doc === doc) return setTimeout(resolve, 50);
    const off = app.bus.on('viewer:pagesinit', () => { off?.(); setTimeout(resolve, 50); });
    setTimeout(resolve, 3000);
  });
}

function withTimeout(p, ms, msg) {
  let t;
  return Promise.race([p, new Promise((_, rej) => { t = setTimeout(() => rej(new Error(msg)), ms); })]).finally(() => clearTimeout(t));
}

/** Cerca in un singolo file. → [{ page, before, match, after }] */
async function searchFile(it, q, opts, signal) {
  const bytes = await it.read();
  const { pdf } = await openPdfJs(bytes);
  const hits = [];
  try {
    for (let i = 1; i <= pdf.numPages; i++) {
      if (signal.aborted) throw new DOMException('Annullato', 'AbortError');
      const page = await pdf.getPage(i);
      const tc = await page.getTextContent();
      const found = findMatches(pageText(tc.items), q, { ...opts, max: 20 });
      for (const m of found) hits.push({ page: i, ...m });
      page.cleanup();
      if (hits.length >= 200) break;
    }
  } finally { destroyPdf(pdf); }
  return hits;
}
