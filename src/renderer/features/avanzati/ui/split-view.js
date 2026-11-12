// Vista divisa: un secondo visualizzatore pdf.js affiancato a quello principale, con scorrimento sincronizzabile.
// Realizzata interamente nell'area (vedi docs/aree/avanzati.md per cosa servirebbe nel nucleo).
import { EventBus, PDFViewer, PDFLinkService } from 'pdfjs-dist/web/pdf_viewer.mjs';
import { openPdfJs } from '../../../core/pdf.js';
import { destroyPdf } from '../native.js';

let split = null;

export function toggleSplitView(app) {
  if (split) return split.close();
  split = createSplit(app);
}

function createSplit(app) {
  const { h } = app.ui;
  const root = app.el.root;
  const stage = app.el.main.querySelector('.stage');
  const width = Math.max(25, Math.min(75, app.settings.get('avanzati.split.w', 50)));
  root.style.setProperty('--av-split-w', width + '%');
  const sel = h('select', { 'aria-label': 'Documento a destra' });
  const sync = h('input', { type: 'checkbox', id: 'av-sync', checked: app.settings.get('avanzati.split.sync', true) });
  const zoom = h('select', { 'aria-label': 'Zoom del documento a destra' }, [['page-width', 'Larghezza pagina'], ['page-fit', 'Pagina intera'], ['auto', 'Automatico'], ['0.75', '75%'], ['1', '100%'], ['1.5', '150%']].map(([v, l]) => h('option', { value: v }, l)));
  const container = h('div', { class: 'av-split-container', tabindex: 0 }, h('div', { class: 'pdfViewer' }));
  const handle = h('div', { class: 'av-split-handle', title: 'Trascina per allargare o restringere', style: { position: 'absolute', left: '-5px', top: 0, bottom: 0, width: '10px', cursor: 'col-resize', zIndex: 2 } });
  const host = h('div', { class: 'av-split-host', style: { width: width + '%' }, role: 'region', 'aria-label': 'Vista divisa' },
    handle,
    h('div', { class: 'av-split-bar' }, h('strong', {}, 'A destra:'), sel,
      h('button', { class: 'btn small', onclick: () => openOther() }, 'Apri un altro PDF…'), zoom,
      h('label', { class: 'chk', for: 'av-sync' }, sync, 'Scorri insieme'),
      h('span', { class: 'av-grow' }),
      h('button', { class: 'btn small', onclick: () => api.close() }, 'Chiudi vista divisa')),
    h('div', { class: 'av-split-view' }, container));
  stage.append(host);
  root.classList.add('av-split-on');

  const eventBus = new EventBus();
  const linkService = new PDFLinkService({ eventBus });
  const viewer = new PDFViewer({ container, eventBus, linkService, textLayerMode: 1, removePageBorders: false });
  linkService.setViewer(viewer);
  let pdf = null; let extra = null; // extra: {name, bytes} di un file aperto solo qui
  eventBus.on('pagesinit', () => { viewer.currentScaleValue = zoom.value; });
  zoom.addEventListener('change', () => { viewer.currentScaleValue = zoom.value; });

  const refit = () => { const pv = app.viewer.pdfViewer; if (pv.pdfDocument) { const v = pv.currentScaleValue; pv.currentScaleValue = v; pv.update(); } if (pdf) { viewer.currentScaleValue = viewer.currentScaleValue; viewer.update(); } };
  setTimeout(refit, 50);

  function fillSelect(keepValue) {
    const cur = keepValue ?? sel.value;
    sel.innerHTML = '';
    const others = app.docs.filter((d) => d !== app.activeDoc);
    for (const d of app.docs) sel.append(h('option', { value: 'doc:' + d.id }, d.name + (d === app.activeDoc ? ' (lo stesso)' : '')));
    if (extra) sel.append(h('option', { value: 'extra' }, extra.name));
    const want = [...sel.options].some((o) => o.value === cur) ? cur : (others[0] ? 'doc:' + others[0].id : extra ? 'extra' : app.activeDoc ? 'doc:' + app.activeDoc.id : '');
    sel.value = want;
    return want;
  }
  async function load(value) {
    let bytes; let password;
    if (value === 'extra' && extra) bytes = extra.bytes;
    else {
      const d = app.docs.find((x) => 'doc:' + x.id === value);
      if (!d) return;
      bytes = await app.currentBytes(d); password = d.password;
    }
    try {
      const r = await openPdfJs(bytes, { password });
      const old = pdf; pdf = r.pdf;
      viewer.setDocument(pdf); linkService.setDocument(pdf, null);
      destroyPdf(old);
    } catch (err) { app.reportError(err, 'Documento non visualizzabile'); }
  }
  async function openOther() {
    const files = await app.platform.openFiles({ multiple: false });
    const f = files?.[0]; if (!f) return;
    extra = { name: f.name, bytes: f.bytes };
    fillSelect('extra'); load('extra');
  }
  sel.addEventListener('change', () => load(sel.value));
  load(fillSelect());

  // --- scorrimento sincronizzato (per pagina + posizione nella pagina) ---
  let lock = false;
  // posizione calcolata dai riquadri delle pagine (il numero di pagina di pdf.js si aggiorna in ritardo)
  const pos = (pv, cont) => {
    const n = pv.pagesCount || 0; if (!n) return null;
    const top = cont.scrollTop;
    let lo = 0; let hi = n - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; const d = pv.getPageView(mid)?.div; if (d && d.offsetTop <= top) lo = mid; else hi = mid - 1; }
    const div = pv.getPageView(lo)?.div; if (!div) return null;
    return { n: lo + 1, frac: Math.max(0, (top - div.offsetTop) / Math.max(1, div.offsetHeight)) };
  };
  const apply = (pv, cont, p) => {
    const n = Math.min(p.n, pv.pagesCount || 1);
    const div = pv.getPageView(n - 1)?.div; if (!div) return;
    cont.scrollTop = div.offsetTop + p.frac * div.offsetHeight;
  };
  const mainCont = app.viewer.container;
  const onMain = () => { if (lock || !sync.checked || !pdf) return; const p = pos(app.viewer.pdfViewer, mainCont); if (!p) return; lock = true; apply(viewer, container, p); requestAnimationFrame(() => { lock = false; }); };
  const onSide = () => { if (lock || !sync.checked || !app.activeDoc) return; const p = pos(viewer, container); if (!p) return; lock = true; apply(app.viewer.pdfViewer, mainCont, p); requestAnimationFrame(() => { lock = false; }); };
  mainCont.addEventListener('scroll', onMain, { passive: true });
  container.addEventListener('scroll', onSide, { passive: true });
  sync.addEventListener('change', () => { app.settings.set('avanzati.split.sync', sync.checked); onMain(); });

  // --- ridimensionamento ---
  handle.addEventListener('mousedown', (e) => {
    e.preventDefault();
    const rect = stage.getBoundingClientRect();
    const move = (ev) => {
      const w = Math.max(25, Math.min(75, ((rect.right - ev.clientX) / rect.width) * 100));
      host.style.width = w + '%'; root.style.setProperty('--av-split-w', w + '%');
    };
    const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); app.settings.set('avanzati.split.w', parseFloat(host.style.width)); refit(); };
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
  });

  const offs = [
    app.bus.on('document:loaded', () => fillSelect()),
    app.bus.on('document:closed', ({ doc }) => { const v = fillSelect(); if (sel.value !== v || !app.docs.length) load(v); void doc; }),
    app.bus.on('document:activated', () => fillSelect()),
    app.bus.on('document:changed', ({ doc }) => { if (sel.value === 'doc:' + doc.id) load(sel.value); }),
  ];
  const api = {
    close() {
      mainCont.removeEventListener('scroll', onMain); container.removeEventListener('scroll', onSide);
      offs.forEach((o) => o()); host.remove(); root.classList.remove('av-split-on');
      try { viewer.setDocument(null); } catch {}
      destroyPdf(pdf); pdf = null; split = null;
      setTimeout(refit, 30);
    },
  };
  return api;
}
