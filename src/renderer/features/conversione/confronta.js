// «Confronta file»: differenze di testo a parole (in un Web Worker), vista affiancata sincronizzata,
// elenco leggibile delle modifiche, confronto visivo per le pagine senza testo, rapporto esportabile.
import { openPdfJs } from '../../core/pdf.js';
import { paroleInOrdine } from './lib/testo.js';
import { confrontaParole, descriviModifica } from './lib/diff.js';
import { confrontaPixel } from './lib/pixel.js';
import { stimaTempo } from './lib/ocr-layout.js';
import { testoPagina, renderPagina, liberaCanvas, abortIf, nomeBase, messaggioErrore } from './comune.js';

const plur = (n, uno, molti) => `${n} ${n === 1 ? uno : molti}`;
const dettaglio = (st) => [plur(st.sostituzioni, 'modificata', 'modificate'), plur(st.inserimenti, 'aggiunta', 'aggiunte'), plur(st.eliminazioni, 'eliminata', 'eliminate')].join(', ');
const escHtml = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** Parole di tutto il documento con pagina e posizione. → { parole, pagine:[{width,height,chars}] } */
async function paroleDocumento(pdf, progress, from, to, label) {
  const parole = []; const pagine = [];
  const t0 = performance.now();
  for (let i = 0; i < pdf.numPages; i++) {
    abortIf(progress?.signal);
    let t;
    try { t = await testoPagina(pdf, i, { withFonts: false }); } catch { t = { frags: [], width: 595, height: 842, chars: 0 }; }
    pagine.push({ width: t.width, height: t.height, chars: t.chars });
    for (const w of paroleInOrdine(t.frags)) parole.push({ ...w, p: i });
    const eta = stimaTempo(performance.now() - t0, i + 1, pdf.numPages);
    progress?.set(from + (to - from) * (i + 1) / pdf.numPages, `${label}: pagina ${i + 1} di ${pdf.numPages}${eta ? ' · ' + eta : ''}`);
    if (i % 10 === 9) await new Promise((r) => setTimeout(r));
  }
  return { parole, pagine };
}

let workerRotto = false;
/** Diff in un Web Worker (l'interfaccia resta reattiva); se il worker non parte, diff diretto. */
function diffNelWorker(a, b, opts, signal) {
  const diretto = async () => { const r = confrontaParole(a.map((text) => ({ text })), b.map((text) => ({ text })), opts); return { modifiche: r.modifiche, stats: r.stats }; };
  if (workerRotto || typeof Worker === 'undefined') return diretto();
  return new Promise((resolve, reject) => {
    let w;
    try { w = new Worker(new URL('./diff.worker.js', import.meta.url), { type: 'module' }); }
    catch { workerRotto = true; resolve(diretto()); return; }
    const fine = () => { w.terminate(); signal?.removeEventListener('abort', onAbort); };
    const onAbort = () => { fine(); reject(new DOMException('Annullato', 'AbortError')); };
    signal?.addEventListener('abort', onAbort, { once: true });
    w.onmessage = (e) => { fine(); if (e.data.ok) resolve(e.data); else reject(new Error(e.data.error)); };
    w.onerror = (e) => { e.preventDefault?.(); fine(); workerRotto = true; resolve(diretto()); };
    w.postMessage({ id: 1, a, b, opts });
  });
}

/** Confronto visivo delle pagine che non hanno testo su entrambi i lati (stesso numero di pagina). */
async function confrontoVisivo(app, pdfA, pdfB, pagA, pagB, progress) {
  const out = [];
  const n = Math.min(pagA.length, pagB.length);
  const daFare = [];
  for (let i = 0; i < n; i++) if (pagA[i].chars < 20 && pagB[i].chars < 20) daFare.push(i);
  for (let k = 0; k < daFare.length; k++) {
    abortIf(progress?.signal);
    const i = daFare[k];
    const scale = 100 / 72;
    let ca = await renderPagina(pdfA, i, scale, { pdfjs: app.lib.pdfjs });
    let cb = await renderPagina(pdfB, i, scale, { pdfjs: app.lib.pdfjs });
    try {
      const w = Math.min(ca.width, cb.width); const h = Math.min(ca.height, cb.height);
      const da = ca.getContext('2d').getImageData(0, 0, w, h).data;
      const db = cb.getContext('2d').getImageData(0, 0, w, h).data;
      const r = confrontaPixel(da, db, w, h);
      if (r.quota > 0.0005 && r.riquadri.length) out.push({ page: i, quota: r.quota, riquadri: r.riquadri.map((q) => ({ x0: q.x0 / scale, y0: q.y0 / scale, x1: q.x1 / scale, y1: q.y1 / scale })) });
    } finally { liberaCanvas(ca); liberaCanvas(cb); ca = cb = null; }
    progress?.set(0.9 + 0.1 * (k + 1) / daFare.length, `Confronto visivo: pagina ${i + 1}`);
  }
  return { pagineVisive: daFare, differenzeVisive: out };
}

/**
 * Confronta due PDF. opts: { progress, ignoraMaiuscole, ignoraPunteggiatura }
 * → { A:{parole,pagine}, B:{…}, modifiche, stats, differenzeVisive, pagineVisive }
 */
export async function confrontaPdf(app, pdfA, pdfB, opts = {}) {
  const progress = opts.progress || { set() {}, signal: opts.signal };
  const A = await paroleDocumento(pdfA, progress, 0, 0.4, 'Leggo il primo documento');
  const B = await paroleDocumento(pdfB, progress, 0.4, 0.8, 'Leggo il secondo documento');
  progress.set(0.85, 'Cerco le differenze…');
  const r = await diffNelWorker(A.parole.map((w) => w.text), B.parole.map((w) => w.text), { ignoraMaiuscole: !!opts.ignoraMaiuscole, ignoraPunteggiatura: !!opts.ignoraPunteggiatura }, progress.signal);
  const vis = await confrontoVisivo(app, pdfA, pdfB, A.pagine, B.pagine, progress);
  return { A, B, modifiche: r.modifiche, stats: r.stats, ...vis };
}

// ---------------- interfaccia ----------------
function pagMod(m, A, B) {
  const pa = A.parole[m.a0]?.p ?? A.parole[Math.max(0, m.a0 - 1)]?.p ?? 0;
  const pb = B.parole[m.b0]?.p ?? B.parole[Math.max(0, m.b0 - 1)]?.p ?? 0;
  return { pa, pb };
}

function testoModifica(m, A, B) {
  return descriviModifica(m, A.parole.map((w) => w.text), B.parole.map((w) => w.text), 120);
}

/** Rapporto HTML autonomo delle modifiche. */
export function rapportoHtml(res, nomeA, nomeB) {
  const { A, B, modifiche, stats, differenzeVisive } = res;
  const words = (P, i0, i1) => escHtml(P.parole.slice(i0, i1).map((w) => w.text).join(' '));
  const ctx = (P, i0, i1) => escHtml(P.parole.slice(Math.max(0, i0 - 6), i0).map((w) => w.text).join(' ')) + ' <mark>' + words(P, i0, i1) + '</mark> ' + escHtml(P.parole.slice(i1, i1 + 6).map((w) => w.text).join(' '));
  const righe = modifiche.map((m, k) => {
    const { pa, pb } = pagMod(m, A, B);
    const tipo = { sostituzione: 'Modificato', inserimento: 'Aggiunto', eliminazione: 'Eliminato' }[m.tipo];
    return `<tr class="${m.tipo}"><td>${k + 1}</td><td>${tipo}</td><td>${pa + 1}</td><td>${pb + 1}</td><td>${m.a1 > m.a0 ? ctx(A, m.a0, m.a1) : '—'}</td><td>${m.b1 > m.b0 ? ctx(B, m.b0, m.b1) : '—'}</td></tr>`;
  }).join('\n');
  const vis = differenzeVisive.map((d) => `<li>Pagina ${d.page + 1}: differenze grafiche (${(d.quota * 100).toFixed(2).replace('.', ',')}% della pagina)</li>`).join('');
  const data = new Date().toLocaleString('it-IT');
  return `<!doctype html><html lang="it"><head><meta charset="utf-8"><title>Confronto: ${escHtml(nomeA)} / ${escHtml(nomeB)}</title>
<style>body{font:15px/1.5 system-ui,sans-serif;margin:2em;color:#1c1e22}table{border-collapse:collapse;width:100%}th,td{border:1px solid #ccc;padding:.35em .5em;vertical-align:top;text-align:left}th{background:#f3f3f0}tr.eliminazione mark{background:#fecaca}tr.inserimento mark{background:#bbf7d0}tr.sostituzione mark{background:#fde68a}.riep{font-size:1.1em}</style></head><body>
<h1>Rapporto di confronto</h1>
<p>Versione precedente: <strong>${escHtml(nomeA)}</strong> (${A.pagine.length} pagine)<br>Versione nuova: <strong>${escHtml(nomeB)}</strong> (${B.pagine.length} pagine)<br>Data del confronto: ${escHtml(data)} — generato con Leggio</p>
<p class="riep"><strong>${modifiche.length} ${modifiche.length === 1 ? 'modifica' : 'modifiche'} nel testo</strong>: ${dettaglio(stats)}.${differenzeVisive.length ? ` ${differenzeVisive.length} pagine con differenze grafiche.` : ''}</p>
${modifiche.length ? `<table><thead><tr><th>N.</th><th>Tipo</th><th>Pag. prima</th><th>Pag. dopo</th><th>Testo prima</th><th>Testo dopo</th></tr></thead><tbody>\n${righe}\n</tbody></table>` : '<p>Il testo dei due documenti è identico.</p>'}
${vis ? `<h2>Differenze grafiche</h2><ul>${vis}</ul>` : ''}
</body></html>`;
}

function rettangoliParole(parole, i0, i1) {
  // unisce le parole consecutive della stessa riga in un solo rettangolo, per pagina
  const out = [];
  for (let i = i0; i < i1; i++) {
    const w = parole[i]; if (!w) continue;
    const last = out[out.length - 1];
    if (last && last.p === w.p && Math.abs(last.top - w.top) < 1 && w.x0 >= last.x1 - 1 && w.x0 - last.x1 < 30) { last.x1 = w.x1; last.bottom = Math.max(last.bottom, w.bottom); }
    else out.push({ p: w.p, x0: w.x0, x1: w.x1, top: w.top, bottom: w.bottom });
  }
  return out;
}

function apriVista(app, res, nomeA, nomeB, pdfA, pdfB, chiudiExtra) {
  const { h } = app.ui;
  const { A, B, modifiche, stats, differenzeVisive } = res;
  const root = document.getElementById('overlay-root');
  const totale = modifiche.length + differenzeVisive.length;
  let corrente = -1;
  const lista = h('ol', { class: 'conv-cmp-list' });
  const paneA = h('div', { class: 'conv-cmp-pane', tabindex: 0, 'aria-label': 'Versione precedente' });
  const paneB = h('div', { class: 'conv-cmp-pane', tabindex: 0, 'aria-label': 'Versione nuova' });
  const riep = totale
    ? `${modifiche.length} ${modifiche.length === 1 ? 'modifica' : 'modifiche'} nel testo (${dettaglio(stats)})${differenzeVisive.length ? ` · ${differenzeVisive.length} pagine con differenze grafiche` : ''}`
    : 'Nessuna differenza: i due documenti hanno lo stesso testo.';
  const btnPrev = h('button', { class: 'btn small', onclick: () => vai(corrente - 1), disabled: !totale }, '◀ Precedente');
  const btnNext = h('button', { class: 'btn small', onclick: () => vai(corrente + 1), disabled: !totale }, 'Successiva ▶');
  const vista = h('div', { class: 'conv-cmp', role: 'dialog', 'aria-label': 'Confronto file' },
    h('header', { class: 'conv-cmp-head' },
      h('div', { class: 'conv-cmp-title' }, h('strong', {}, 'Confronto file'), h('span', { class: 'conv-cmp-sum', role: 'status' }, riep)),
      btnPrev, btnNext,
      h('button', { class: 'btn small', onclick: () => esportaRapporto() }, 'Salva rapporto…'),
      h('button', { class: 'btn small primary', onclick: () => chiudi() }, 'Chiudi')),
    h('div', { class: 'conv-cmp-body' },
      h('aside', { class: 'conv-cmp-side' }, h('h3', {}, 'Modifiche'), totale ? lista : h('p', { class: 'muted' }, 'Nessuna modifica trovata.'),
        h('div', { class: 'conv-cmp-legend' }, h('span', { class: 'lg del' }, 'eliminato'), h('span', { class: 'lg ins' }, 'aggiunto'), h('span', { class: 'lg mod' }, 'modificato'))),
      h('section', { class: 'conv-cmp-col' }, h('div', { class: 'conv-cmp-name' }, 'Prima: ', h('strong', {}, nomeA)), paneA),
      h('section', { class: 'conv-cmp-col' }, h('div', { class: 'conv-cmp-name' }, 'Dopo: ', h('strong', {}, nomeB)), paneB)));
  root.append(vista);

  // voci dell'elenco
  const voci = [];
  modifiche.forEach((m, k) => {
    const { pa, pb } = pagMod(m, A, B);
    const li = h('li', { class: 'conv-cmp-item ' + m.tipo }, h('button', { onclick: () => vai(k) }, h('small', {}, pa === pb ? `Pagina ${pa + 1}` : `Pagina ${pa + 1} → ${pb + 1}`), h('span', {}, testoModifica(m, A, B))));
    voci.push(li); lista.append(li);
  });
  differenzeVisive.forEach((d, k) => {
    const li = h('li', { class: 'conv-cmp-item visiva' }, h('button', { onclick: () => vai(modifiche.length + k) }, h('small', {}, `Pagina ${d.page + 1}`), h('span', {}, 'Differenze grafiche (pagina senza testo)')));
    voci.push(li); lista.append(li);
  });

  // pagine (rese solo quando visibili; il canvas viene liberato quando si allontanano)
  const colW = () => Math.max(240, (vista.querySelector('.conv-cmp-col')?.clientWidth || 500) - 28);
  function costruisci(pane, info, pdf, lato) {
    const pages = [];
    const W = colW();
    info.pagine.forEach((pg, i) => {
      const s = W / pg.width;
      const div = h('div', { class: 'conv-cmp-page', style: { width: W + 'px', height: Math.round(pg.height * s) + 'px' }, 'data-i': i }, h('span', { class: 'conv-cmp-pn' }, String(i + 1)));
      pages.push({ div, s, canvas: null, pdf, i, rendering: false });
      pane.append(div);
    });
    // evidenziazioni
    const tipoLato = (m) => (m.tipo === 'sostituzione' ? 'mod' : lato === 'A' ? 'del' : 'ins');
    modifiche.forEach((m, k) => {
      const [i0, i1] = lato === 'A' ? [m.a0, m.a1] : [m.b0, m.b1];
      const P = lato === 'A' ? A : B;
      let rects = rettangoliParole(P.parole, i0, i1);
      if (!rects.length) {
        // punto d'inserimento: un segno sottile dove manca (o c'è in più) il testo
        const w = P.parole[i0] || P.parole[i0 - 1];
        if (w) rects = [{ p: w.p, x0: (P.parole[i0] ? w.x0 : w.x1) - 1, x1: (P.parole[i0] ? w.x0 : w.x1) + 2, top: w.top, bottom: w.bottom, caret: true }];
      }
      for (const r of rects) {
        const pg = pages[r.p]; if (!pg) continue;
        pg.div.append(h('div', { class: `conv-hl ${r.caret ? 'caret' : tipoLato(m)}`, 'data-k': k, style: { left: r.x0 * pg.s - 1 + 'px', top: r.top * pg.s - 1 + 'px', width: Math.max(3, (r.x1 - r.x0) * pg.s + 2) + 'px', height: (r.bottom - r.top) * pg.s + 2 + 'px' } }));
      }
    });
    differenzeVisive.forEach((d, k) => {
      const pg = pages[d.page]; if (!pg) return;
      for (const q of d.riquadri) pg.div.append(h('div', { class: 'conv-hl vis', 'data-k': modifiche.length + k, style: { left: q.x0 * pg.s + 'px', top: q.y0 * pg.s + 'px', width: (q.x1 - q.x0) * pg.s + 'px', height: (q.y1 - q.y0) * pg.s + 'px' } }));
    });
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        const pg = pages[Number(e.target.dataset.i)];
        if (e.isIntersecting) rendi(pg);
        else if (pg.canvas) { liberaCanvas(pg.canvas); pg.canvas.remove(); pg.canvas = null; }
      }
    }, { root: pane, rootMargin: '800px 0px' });
    pages.forEach((p) => io.observe(p.div));
    return { pages, io };
  }
  async function rendi(pg) {
    if (pg.canvas || pg.rendering || chiusa) return;
    pg.rendering = true;
    try {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const c = await renderPagina(pg.pdf, pg.i, pg.s * dpr, { pdfjs: app.lib.pdfjs });
      if (chiusa) { liberaCanvas(c); return; }
      c.className = 'conv-cmp-canvas';
      pg.canvas = c; pg.div.prepend(c);
    } catch { /* pagina illeggibile: resta vuota */ } finally { pg.rendering = false; }
  }
  let chiusa = false;
  const LA = costruisci(paneA, A, pdfA, 'A');
  const LB = costruisci(paneB, B, pdfB, 'B');

  // scorrimento sincronizzato (stessa pagina e stessa posizione relativa)
  let sync = 0;
  const posizione = (L, pane) => {
    const y = pane.scrollTop;
    let i = 0;
    while (i < L.pages.length - 1 && L.pages[i + 1].div.offsetTop <= y + 1) i++;
    const pg = L.pages[i];
    return { i, f: pg ? (y - pg.div.offsetTop) / Math.max(1, pg.div.offsetHeight) : 0 };
  };
  const segui = (from, Lf, to, Lt) => () => {
    if (sync > 0) { sync--; return; }
    const { i, f } = posizione(Lf, from);
    const pg = Lt.pages[Math.min(i, Lt.pages.length - 1)];
    if (!pg) return;
    sync++;
    to.scrollTop = pg.div.offsetTop + f * pg.div.offsetHeight;
  };
  paneA.addEventListener('scroll', segui(paneA, LA, paneB, LB), { passive: true });
  paneB.addEventListener('scroll', segui(paneB, LB, paneA, LA), { passive: true });

  function scorriA(pane, L, sel) {
    const el = pane.querySelector(sel);
    if (!el) return;
    const pg = el.parentElement;
    sync++;
    pane.scrollTop = pg.offsetTop + el.offsetTop - pane.clientHeight / 3;
  }
  function vai(k) {
    if (!totale) return;
    corrente = (k + totale) % totale;
    vista.querySelectorAll('.conv-hl.on').forEach((e) => e.classList.remove('on'));
    vista.querySelectorAll(`.conv-hl[data-k="${corrente}"]`).forEach((e) => e.classList.add('on'));
    voci.forEach((v, i) => v.classList.toggle('on', i === corrente));
    voci[corrente]?.scrollIntoView({ block: 'nearest' });
    scorriA(paneA, LA, `.conv-hl[data-k="${corrente}"]`);
    scorriA(paneB, LB, `.conv-hl[data-k="${corrente}"]`);
    // se un lato non ha evidenziazione, allinea per pagina
    if (!paneA.querySelector(`.conv-hl[data-k="${corrente}"]`) || !paneB.querySelector(`.conv-hl[data-k="${corrente}"]`)) sync = 0;
  }
  async function esportaRapporto() {
    const bytes = new TextEncoder().encode(rapportoHtml(res, nomeA, nomeB));
    const r = await app.exportFile(bytes, `Confronto_${nomeBase(nomeA)}_${nomeBase(nomeB)}.html`, [{ name: 'Pagina web', extensions: ['html'] }]);
    if (r) app.ui.toast('Rapporto salvato: si apre con qualsiasi browser e si può stampare in PDF.', { kind: 'success' });
  }
  const onKey = (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); chiudi(); }
    else if ((e.key === 'ArrowDown' || e.key === 'n') && !e.target.closest('input,textarea')) { e.preventDefault(); vai(corrente + 1); }
    else if ((e.key === 'ArrowUp' || e.key === 'p') && !e.target.closest('input,textarea')) { e.preventDefault(); vai(corrente - 1); }
  };
  document.addEventListener('keydown', onKey, true);
  function chiudi() {
    chiusa = true;
    document.removeEventListener('keydown', onKey, true);
    LA.io.disconnect(); LB.io.disconnect();
    for (const p of [...LA.pages, ...LB.pages]) liberaCanvas(p.canvas);
    vista.remove();
    chiudiExtra?.();
  }
  if (totale) setTimeout(() => vai(0), 50);
  return { chiudi, vai };
}

async function scegliSecondo(app) {
  const doc = app.activeDoc;
  const altri = app.docs.filter((d) => d !== doc);
  const v = await app.ui.dialog({
    title: 'Confronta file',
    message: `Confronta «${doc.name}» con un altro documento: vedrai le differenze affiancate e l’elenco delle modifiche.`,
    fields: [
      { name: 'altro', label: 'Confronta con', type: 'select', value: altri[0] ? String(altri[0].id) : 'file', options: [...altri.map((d) => ({ value: String(d.id), label: d.name })), { value: 'file', label: 'Un file dal computer…' }] },
      { name: 'ruolo', label: `«${doc.name}» è`, type: 'radio', value: 'prima', options: [{ value: 'prima', label: 'la versione precedente' }, { value: 'dopo', label: 'la versione nuova' }] },
      { name: 'punt', label: 'Ignora le differenze di sola punteggiatura e maiuscole', type: 'checkbox', value: false },
    ],
    okLabel: 'Confronta',
  });
  if (!v) return null;
  let other;
  if (v.altro === 'file') {
    const files = await app.platform.openFiles({ multiple: false, title: 'Scegli il documento da confrontare' });
    if (!files?.length) return null;
    other = { name: files[0].name, bytes: files[0].bytes };
  } else {
    const d = altri.find((x) => String(x.id) === v.altro);
    other = { name: d.name, bytes: await app.currentBytes(d), password: d.password, pdf: d.pdf };
  }
  return { other, prima: v.ruolo === 'prima', punt: v.punt };
}

async function avviaConfronto(app) {
  const doc = app.activeDoc;
  const scelta = await scegliSecondo(app);
  if (!scelta) return;
  const { other } = scelta;
  let pdfOther = other.pdf; let ownOther = false;
  const tmp = [];
  try {
    if (!pdfOther) {
      try { pdfOther = (await openPdfJs(other.bytes, { onPassword: (r) => app.ui.prompt(r === 2 ? 'Password errata, riprova:' : `«${other.name}» è protetto. Password:`, '', { type: 'password', title: 'Documento protetto' }) })).pdf; ownOther = true; }
      catch (err) { return app.reportError(new Error(messaggioErrore(err)), `Impossibile aprire «${other.name}»`); }
    }
    let pdfA = scelta.prima ? doc.pdf : pdfOther; let pdfB = scelta.prima ? pdfOther : doc.pdf;
    const nomeA = scelta.prima ? doc.name : other.name; const nomeB = scelta.prima ? other.name : doc.name;
    // scansioni: proposta di OCR su copie temporanee
    const scansione = async (pdf) => { const r = await app.services.rilevaScansione(pdf, { max: 3 }); return r.pagineSenzaTesto === r.controllate && r.controllate > 0; };
    const sA = await scansione(pdfA); const sB = await scansione(pdfB);
    if (sA || sB) {
      const ok = await app.ui.confirm(`${sA && sB ? 'Entrambi i documenti sono scansioni' : `«${sA ? nomeA : nomeB}» è una scansione`}: per confrontare il testo devo prima riconoscerlo (OCR). I documenti aperti non vengono modificati. Procedo?`, { title: 'Confronto di scansioni', okLabel: 'Riconosci e confronta' });
      if (ok) {
        const conv = async (pdf, nome) => {
          const bytes = new Uint8Array(await pdf.getData());
          const out = await app.ui.withProgress(`Riconoscimento del testo: ${nome}`, (p) => app.services.ocr(bytes, { pdf, progress: p }));
          if (!out) throw new DOMException('Annullato', 'AbortError');
          const nuovo = (await openPdfJs(out)).pdf; tmp.push(nuovo); return nuovo;
        };
        if (sA) pdfA = await conv(pdfA, nomeA);
        if (sB) pdfB = await conv(pdfB, nomeB);
      }
    }
    const res = await app.ui.withProgress('Confronto dei documenti', (p) => confrontaPdf(app, pdfA, pdfB, { progress: p, ignoraMaiuscole: scelta.punt, ignoraPunteggiatura: scelta.punt }));
    if (!res) { cleanup(); return; }
    apriVista(app, res, nomeA, nomeB, pdfA, pdfB, cleanup);
  } catch (err) {
    cleanup();
    if (err?.name === 'AbortError') return app.ui.toast('Confronto annullato');
    app.reportError(new Error(messaggioErrore(err)), 'Confronto non riuscito');
  }
  function cleanup() {
    for (const p of tmp) p.loadingTask.destroy().catch(() => {});
    tmp.length = 0;
    if (ownOther && pdfOther) { pdfOther.loadingTask.destroy().catch(() => {}); ownOther = false; }
  }
}

export function registraConfronto(app) {
  /** app.services.confronta(bytesA, bytesB, opts) → { modifiche, stats, A, B, differenzeVisive } */
  app.services.confronta = async (bytesA, bytesB, opts = {}) => {
    const a = (await openPdfJs(bytesA)).pdf; const b = (await openPdfJs(bytesB)).pdf;
    try { return await confrontaPdf(app, a, b, opts); }
    finally { a.loadingTask.destroy().catch(() => {}); b.loadingTask.destroy().catch(() => {}); }
  };
  app.services.rapportoConfronto = rapportoHtml;
  app.registerTool({
    id: 'compare', name: 'Confronta file', category: 'converti', icon: 'compare', quick: true, quickOrder: 60,
    description: 'Trova le differenze tra due versioni',
    keywords: 'confronta file confronto differenze versioni modifiche contratto revisione bando paragona compare diff',
    run: () => avviaConfronto(app),
  });
}
