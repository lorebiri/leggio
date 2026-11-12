// Area «commenti» — pannello laterale «Commenti»: elenco per pagina con autore, data, testo, risposte e stato;
// ricerca e filtri; rendering a blocchi (fluido anche con migliaia di commenti).
import { buildThreads, filterThreads, facets } from './model.js';
import { TYPE_LABELS, STATE_LABELS } from './annots.js';
import { allComments } from './ui-common.js';
import { actions, selectComment, contextItems, statusMenuItems } from './tool-select.js';
import { commentActionsMenu } from './actions.js';

const CHUNK = 150;
const DONE = new Set(['Completed', 'Accepted']);

export function commentsPanel(app) {
  return {
    id: 'comments', title: 'Commenti', icon: 'comment', order: 30,
    render(container) {
      const H = app.ui.h;
      const doc = app.activeDoc;
      const st = (doc.data.commentiPanel ||= { q: '', type: '', author: '', status: '', color: '', scroll: 0 });
      const ctrl = new AbortController();
      const head = H('div', { class: 'lg-panel-head' });
      const listEl = H('div', { class: 'lg-list', role: 'list', 'aria-label': 'Elenco dei commenti' });
      const info = H('div', { class: 'lg-panel-info', 'aria-live': 'polite' }, 'Lettura dei commenti…');
      container.classList.add('lg-panel');
      container.append(head, info, listEl);

      let threads = [];
      let shown = 0;
      let filtered = [];

      const search = H('input', { type: 'search', placeholder: 'Cerca nei commenti', 'aria-label': 'Cerca nei commenti', value: st.q });
      const selType = H('select', { 'aria-label': 'Filtra per tipo' });
      const selAuthor = H('select', { 'aria-label': 'Filtra per autore' });
      const selStatus = H('select', { 'aria-label': 'Filtra per stato' }, [['', 'Tutti gli stati'], ['open', 'Da fare'], ['done', 'Fatti'], ['Rejected', 'Rifiutati']].map(([v, l]) => H('option', { value: v, selected: st.status === v }, l)));
      const colors = H('div', { class: 'lg-colorfilter', role: 'group', 'aria-label': 'Filtra per colore' });
      head.append(
        H('div', { class: 'lg-panel-actions' },
          H('button', { class: 'btn small', onclick: (e) => { const b = e.currentTarget.getBoundingClientRect(); app.ui.contextMenu(b.left, b.bottom + 4, commentActionsMenu(app, () => filtered)); } }, 'Esporta e altro ▾')),
        search, H('div', { class: 'lg-filters' }, selType, selAuthor, selStatus), colors);

      const fill = (sel, items, cur, all) => { sel.innerHTML = ''; sel.append(H('option', { value: '' }, all)); for (const [v, n] of items) sel.append(H('option', { value: v, selected: v === cur }, `${v ? (TYPE_LABELS[v] || v) : '(senza autore)'} (${n})`)); };
      const apply = () => {
        st.q = search.value; st.type = selType.value; st.author = selAuthor.value; st.status = selStatus.value;
        filtered = filterThreads(threads, { q: st.q, types: st.type ? new Set([st.type]) : null, authors: st.author ? new Set([st.author]) : null, status: st.status, colors: st.color ? new Set([st.color]) : null });
        listEl.innerHTML = ''; shown = 0; more();
        const nDone = threads.filter((t) => DONE.has(t.status)).length;
        info.textContent = threads.length ? `${filtered.length === threads.length ? threads.length : filtered.length + ' di ' + threads.length} commenti · ${nDone} fatti` : 'Nessun commento in questo documento. Usa Evidenzia testo, Nota o Timbro per aggiungerne.';
      };
      const renderFacets = () => {
        const f = facets(threads);
        fill(selType, f.types, st.type, 'Tutti i tipi');
        selAuthor.innerHTML = ''; selAuthor.append(H('option', { value: '' }, 'Tutti gli autori'));
        for (const [v, n] of f.authors) selAuthor.append(H('option', { value: v, selected: v === st.author && !!v }, `${v || '(senza autore)'} (${n})`));
        colors.innerHTML = '';
        for (const [c] of f.colors.slice(0, 8)) colors.append(H('button', { class: 'swatch' + (st.color === c ? ' active' : ''), style: { background: c }, title: 'Solo questo colore', 'aria-pressed': String(st.color === c), onclick: () => { st.color = st.color === c ? '' : c; renderFacets(); apply(); } }));
      };
      // sentinella: aggiunge altri elementi quando si scorre in fondo
      const sentinel = H('div', { class: 'lg-sentinel' });
      const io = new IntersectionObserver((es) => { if (es.some((x) => x.isIntersecting)) more(); }, { root: container, rootMargin: '400px' });
      function more() {
        sentinel.remove();
        const end = Math.min(filtered.length, shown + CHUNK);
        let lastPage = shown > 0 ? filtered[shown - 1].pageIndex : -1;
        const frag = document.createDocumentFragment();
        for (let i = shown; i < end; i++) {
          const t = filtered[i];
          if (t.pageIndex !== lastPage) { lastPage = t.pageIndex; frag.append(H('div', { class: 'lg-page-h' }, `Pagina ${t.pageIndex + 1}`)); }
          frag.append(item(t));
        }
        listEl.append(frag);
        shown = end;
        if (shown < filtered.length) { listEl.append(sentinel); io.observe(sentinel); }
      }
      function item(t) {
        const done = DONE.has(t.status);
        const el = H('div', { class: 'lg-item' + (done ? ' lg-done' : ''), role: 'listitem', tabindex: 0, 'data-key': t.key });
        const chk = H('input', { type: 'checkbox', checked: done, title: 'Segna come fatto', 'aria-label': 'Fatto' });
        chk.addEventListener('click', (e) => e.stopPropagation());
        chk.addEventListener('change', () => actions.status(app, t, chk.checked ? 'Completed' : 'None'));
        el.append(H('div', { class: 'lg-item-h' },
          H('label', { class: 'lg-chk', title: 'Fatto' }, chk),
          H('span', { class: 'lg-dot-s', style: { background: t.color || 'var(--faint)' } }),
          H('strong', {}, t.label),
          t.status ? H('span', { class: 'lg-badge lg-st-' + t.status }, STATE_LABELS[t.status] || t.status) : null),
          H('div', { class: 'lg-meta' }, `${t.author || 'Senza autore'}${t.dateText ? ' · ' + t.dateText : ''}`));
        if (t.text) el.append(H('div', { class: 'lg-text' }, t.text));
        if (t.allReplies.length) el.append(H('div', { class: 'lg-replies' }, t.allReplies.map((r) => H('div', { class: 'lg-reply' }, H('div', { class: 'lg-meta' }, `${r.author || 'Risposta'}${r.dateText ? ' · ' + r.dateText : ''}`), H('div', { class: 'lg-text' }, r.text)))));
        const replyBox = H('div', { class: 'lg-replybox', hidden: true });
        const ta = H('textarea', { rows: 2, placeholder: 'Scrivi una risposta…', 'aria-label': 'Risposta' });
        ta.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send(); });
        const send = () => { if (ta.value.trim()) actions.reply(app, t, ta.value); };
        replyBox.append(ta, H('div', { class: 'lg-row' }, H('button', { class: 'btn small', onclick: () => { replyBox.hidden = true; } }, 'Lascia perdere'), H('button', { class: 'btn small primary', onclick: send }, 'Rispondi')));
        el.append(H('div', { class: 'lg-item-actions' },
          H('button', { class: 'lg-tbtn', onclick: (e) => { e.stopPropagation(); replyBox.hidden = false; ta.focus(); } }, 'Rispondi'),
          H('button', { class: 'lg-tbtn', onclick: (e) => { e.stopPropagation(); const b = e.currentTarget.getBoundingClientRect(); app.ui.contextMenu(b.left, b.bottom + 4, statusMenuItems(app, t)); } }, 'Stato ▾'),
          H('button', { class: 'lg-tbtn', onclick: (e) => { e.stopPropagation(); const b = e.currentTarget.getBoundingClientRect(); app.ui.contextMenu(b.left, b.bottom + 4, contextItems(app, t)); } }, 'Altro ▾')),
          replyBox);
        replyBox.addEventListener('click', (e) => e.stopPropagation());
        const go = () => { listEl.querySelectorAll('.lg-item.active').forEach((x) => x.classList.remove('active')); el.classList.add('active'); selectComment(app, t); };
        el.addEventListener('click', go);
        el.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target === el) go(); if ((e.key === 'Delete') && e.target === el) actions.del(app, t); });
        el.addEventListener('contextmenu', (e) => { e.preventDefault(); app.ui.contextMenu(e.clientX, e.clientY, contextItems(app, t)); });
        return el;
      }
      let debounce;
      search.addEventListener('input', () => { clearTimeout(debounce); debounce = setTimeout(apply, 150); });
      search.addEventListener('keydown', (e) => e.stopPropagation());
      [selType, selAuthor, selStatus].forEach((s) => s.addEventListener('change', apply));
      container.addEventListener('scroll', () => { st.scroll = container.scrollTop; }, { passive: true });

      const t0 = performance.now();
      allComments(app, {
        signal: ctrl.signal,
        onProgress: (done, total) => { if (total > 40) info.textContent = `Lettura dei commenti… pagina ${done} di ${total}`; },
      }).then((list) => {
        if (ctrl.signal.aborted) return;
        threads = buildThreads(list);
        renderFacets(); apply();
        if (st.scroll) requestAnimationFrame(() => { container.scrollTop = st.scroll; });
        doc.data.commentiPanelMs = Math.round(performance.now() - t0);
      }).catch((err) => { info.textContent = 'Impossibile leggere i commenti: ' + (err?.message || err); });
      return () => { ctrl.abort(); io.disconnect(); };
    },
  };
}
