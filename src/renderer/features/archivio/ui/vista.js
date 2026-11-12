// Vista a tutto schermo dell'archivio: «Oggi» e «Documenti» (ricerca istantanea con filtri,
// lista virtualizzata, selezione multipla e azioni).
import { listaVirtuale } from './lista.js';
import { disegnaOggi } from './oggi.js';
import { apriDocumento, dialogoStato, dialogoEtichette, esportaRegistro, azioniGuidate, copieConNomeProposto } from './azioni.js';
import { apriCartelle } from './cartelle.js';
import { TIPI, TIPO_LABEL } from '../lib/estrai.js';
import { VOCI_STATO } from '../lib/stati.js';
import { ORDINAMENTI } from '../lib/motore.js';
import { euro, dataIt, dataDaTesto } from '../lib/testo.js';

let corrente = null;
export const vistaAperta = () => corrente;

const SEGNALI = [
  { value: '', label: 'Tutti i documenti' },
  { value: 'scansione', label: 'Scansioni senza testo (da passare all\'OCR)' },
  { value: 'firmato', label: 'Con firma digitale' },
  { value: 'protetto', label: 'Protetti da password' },
  { value: 'errore', label: 'Non letti (danneggiati o illeggibili)' },
  { value: 'senza-dati', label: 'Senza dati riconosciuti' },
];

/** Apre (o porta in primo piano) la vista. opts: { scheda: 'oggi'|'documenti', filtro, q } */
export function apriVista(app, A, opts = {}) {
  if (corrente?.el.isConnected) { corrente.mostra(opts); return corrente; }
  const { h } = app.ui;
  const stage = app.el.main.querySelector('.stage') || app.el.main;
  const st = { scheda: opts.scheda || (A.attivo ? 'oggi' : 'documenti'), righe: [], sel: new Set(), estratti: new Map(), q: '', seq: 0, filtro: {} };

  // ---------- intestazione ----------
  const sottotitolo = h('div', { class: 'ar-sub', role: 'status', 'aria-live': 'polite' });
  const tabOggi = h('button', { class: 'ar-tab', role: 'tab', onclick: () => mostraScheda('oggi') }, 'Oggi');
  const tabDoc = h('button', { class: 'ar-tab', role: 'tab', onclick: () => mostraScheda('documenti') }, 'Documenti');
  const progresso = h('div', { class: 'ar-progresso', hidden: true },
    h('div', { class: 'ar-barra' }, h('div')), h('span', { class: 'ar-prog-t' }),
    h('button', { class: 'btn', onclick: () => A.interrompi() }, 'Interrompi'));
  const head = h('header', { class: 'ar-head' },
    h('div', { class: 'ar-titoli' }, h('h2', {}, 'Archivio d\'ufficio'), sottotitolo),
    h('div', { class: 'ar-tabs', role: 'tablist' }, tabOggi, tabDoc),
    h('div', { class: 'ar-head-azioni' },
      h('button', { class: 'btn', onclick: () => A.aggiorna({ motivo: 'manuale' }) }, 'Aggiorna ora'),
      h('button', { class: 'btn', onclick: () => apriCartelle(app, A) }, 'Cartelle e privacy…'),
      h('button', { class: 'btn', onclick: () => api.chiudi() }, 'Chiudi')));

  // ---------- scheda Oggi ----------
  const oggiBox = h('div', { class: 'ar-oggi' });
  const vuoto = h('div', { class: 'ar-vuoto' },
    h('h3', {}, 'Collega le cartelle dell\'ufficio'),
    h('p', {}, 'Leggio legge i documenti che sono già nelle tue cartelle (anche di rete o OneDrive) e crea un indice per trovarli subito: fatture, DURC, ordini, determine, missioni, contratti, PEC, file .p7m.'),
    h('p', {}, 'I file non vengono mai spostati né modificati. L\'indice resta solo su questo computer.'),
    h('button', { class: 'btn primary big', onclick: () => aggiungi() }, 'Collega una cartella…'));
  const schedaOggi = h('div', { class: 'ar-scheda ar-scheda-oggi' }, vuoto, oggiBox);

  // ---------- scheda Documenti ----------
  const q = h('input', { type: 'search', class: 'ar-q', placeholder: 'Cerca nei documenti: parole, numero di fattura, CIG, nome del fornitore…', 'aria-label': 'Cerca nei documenti' });
  const sel = (label, opts, extra = {}) => { const s = h('select', { 'aria-label': label, ...extra }, opts.map((o) => h('option', { value: o.value }, o.label))); return s; };
  const fTipo = sel('Tipo di documento', [{ value: '', label: 'Tutti i tipi' }, ...TIPI.map((t) => ({ value: t.id, label: t.label }))]);
  const fForn = h('input', { type: 'text', placeholder: 'Fornitore o P.IVA', 'aria-label': 'Fornitore o partita IVA', list: 'ar-fornitori' });
  const dlForn = h('datalist', { id: 'ar-fornitori' });
  const fDal = h('input', { type: 'text', placeholder: 'dal gg/mm/aaaa', 'aria-label': 'Dalla data', inputmode: 'numeric', size: 11 });
  const fAl = h('input', { type: 'text', placeholder: 'al gg/mm/aaaa', 'aria-label': 'Alla data', inputmode: 'numeric', size: 11 });
  const fCig = h('input', { type: 'text', placeholder: 'CIG o CUP', 'aria-label': 'CIG o CUP', size: 14 });
  const fStato = sel('Stato', [{ value: '', label: 'Qualsiasi stato' }, ...VOCI_STATO.map((v) => ({ value: v.id, label: v.label })), { value: 'senza-stato', label: 'Senza stato' }]);
  const fCartella = sel('Cartella', [{ value: '', label: 'Tutte le cartelle' }]);
  const fSegnale = sel('Segnalazioni', SEGNALI);
  const fOrdine = sel('Ordina', ORDINAMENTI.map((o) => ({ value: o.id, label: o.label })));
  fOrdine.value = 'data-desc';
  const azzera = h('button', { class: 'btn', onclick: () => { for (const x of [q, fForn, fDal, fAl, fCig]) x.value = ''; for (const x of [fTipo, fStato, fCartella, fSegnale]) x.value = ''; st.filtro = {}; st.ordineScelto = false; fOrdine.value = 'data-desc'; cerca(); } }, 'Azzera filtri');
  const campo = (label, input) => h('label', { class: 'ar-campo' }, h('span', {}, label), input);
  const filtri = h('div', { class: 'ar-filtri' },
    campo('Tipo', fTipo), campo('Fornitore', fForn), campo('Data dal', fDal), campo('al', fAl), campo('CIG / CUP', fCig),
    campo('Stato', fStato), campo('Cartella', fCartella), campo('Mostra', fSegnale), campo('Ordina per', fOrdine), azzera, dlForn);
  const conteggio = h('div', { class: 'ar-conteggio', role: 'status', 'aria-live': 'polite' });
  const selInfo = h('span', { class: 'ar-selinfo' });
  const tuttiChk = h('input', { type: 'checkbox', 'aria-label': 'Seleziona tutti i risultati', onchange: () => { if (tuttiChk.checked) st.righe.forEach((r) => st.sel.add(r.id)); else st.sel.clear(); aggiornaSel(); lista.ridisegna(); } });
  const selezionate = () => st.righe.filter((r) => st.sel.has(r.id));
  const bottone = (testo, fn, cls = 'btn') => h('button', { class: cls, onclick: async () => { try { await fn(); } catch (e) { app.reportError(e, testo); } } }, testo);
  const barraSel = h('div', { class: 'ar-barra-sel' },
    h('label', { class: 'ar-tutti' }, tuttiChk, h('span', {}, 'Tutti')), selInfo,
    bottone('Cambia stato…', () => dialogoStato(app, A, selezionate())),
    bottone('Etichette e nota…', () => dialogoEtichette(app, A, selezionate())),
    bottone('Azioni guidate…', () => azioniGuidate(app, A, selezionate())),
    bottone('Copie con nome proposto…', () => copieConNomeProposto(app, A, selezionate())),
    bottone('Esporta in Excel', () => esportaRegistro(app, st.sel.size ? selezionate() : st.righe, 'xlsx')),
    bottone('Esporta CSV', () => esportaRegistro(app, st.sel.size ? selezionate() : st.righe, 'csv')));
  const lista = listaVirtuale({ h, render: renderRiga, onVisibili: chiediEstratti, etichetta: 'Documenti trovati' });
  const schedaDoc = h('div', { class: 'ar-scheda ar-scheda-doc' }, h('div', { class: 'ar-cerca' }, q), filtri, h('div', { class: 'ar-riga-info' }, conteggio, barraSel), lista.el);

  const body = h('div', { class: 'ar-body' }, progresso, schedaOggi, schedaDoc);
  const el = h('section', { class: 'ar-vista', role: 'region', 'aria-label': 'Archivio d\'ufficio' }, head, body);
  stage.append(el);

  // ---------- comportamento ----------
  let timer = 0;
  const ricercaDifferita = () => { clearTimeout(timer); timer = setTimeout(cerca, 140); };
  q.addEventListener('input', ricercaDifferita);
  q.addEventListener('keydown', (e) => { if (e.key === 'Enter') { clearTimeout(timer); cerca(); } if (e.key === 'ArrowDown') { e.preventDefault(); lista.el.querySelector('.ar-riga')?.focus(); } });
  for (const x of [fTipo, fStato, fCartella, fSegnale, fOrdine]) x.addEventListener('change', () => cerca());
  for (const x of [fForn, fCig]) x.addEventListener('input', ricercaDifferita);
  for (const x of [fDal, fAl]) x.addEventListener('change', () => cerca());

  async function cerca() {
    const seq = ++st.seq;
    const dal = dataDaTesto(fDal.value); const al = dataDaTesto(fAl.value);
    fDal.classList.toggle('errato', !!fDal.value.trim() && !dal); fAl.classList.toggle('errato', !!fAl.value.trim() && !al);
    st.q = q.value.trim();
    // con una ricerca l'ordine predefinito diventa «Più pertinenti» (finché l'utente non sceglie)
    if (!st.ordineScelto) fOrdine.value = st.q ? 'pertinenza' : 'data-desc';
    const f = { q: st.q, tipo: fTipo.value, fornitore: fForn.value.trim(), dal, al, cigcup: fCig.value.trim(), stato: fStato.value, cartella: fCartella.value, segnale: fSegnale.value, ordine: fOrdine.value, ...st.filtro };
    let r;
    try { r = await A.cerca(f); } catch (e) { conteggio.textContent = 'Ricerca non riuscita: ' + e.message; return; }
    if (seq !== st.seq) return;
    st.righe = r.righe; st.estratti.clear();
    const ids = new Set(r.righe.map((x) => x.id));
    for (const id of [...st.sel]) if (!ids.has(id)) st.sel.delete(id);
    st.ultimaMs = r.ms;
    conteggio.textContent = `${r.totale.toLocaleString('it-IT')} ${r.totale === 1 ? 'documento' : 'documenti'}${r.totale > r.righe.length ? ` (mostrati i primi ${r.righe.length.toLocaleString('it-IT')})` : ''} · ricerca in ${r.ms} ms`;
    lista.imposta(st.righe);
    aggiornaSel();
    if (!r.totale) lista.el.querySelector('.ar-vl-strato').replaceChildren(h('p', { class: 'ar-nessuno' }, A.size === 0 ? 'L\'archivio è ancora vuoto.' : st.q ? `Nessun documento contiene «${st.q}». Le scansioni senza testo non sono ricercabili finché non passano dall'OCR (filtro «Mostra»).` : 'Nessun documento con questi filtri.'));
  }
  fOrdine.addEventListener('change', () => { st.ordineScelto = true; });

  function aggiornaSel() {
    const n = st.sel.size;
    selInfo.textContent = n ? `${n} selezionat${n === 1 ? 'o' : 'i'}` : 'Nessuno selezionato';
    tuttiChk.checked = n > 0 && n === st.righe.length;
    tuttiChk.indeterminate = n > 0 && n < st.righe.length;
    barraSel.classList.toggle('con-sel', n > 0);
  }

  function chip(testo, cls) { return h('span', { class: 'ar-chip ' + (cls || '') }, testo); }
  function renderRiga(r, i, prova) {
    if (!r) r = { id: '', nome: 'Documento di prova.pdf', rel: 'cartella/Documento di prova.pdf', tipo: 'fattura', chips: [] };
    const scelto = st.sel.has(r.id);
    const chk = h('input', { type: 'checkbox', checked: scelto, 'aria-label': 'Seleziona ' + r.nome, onclick: (e) => { e.stopPropagation(); if (e.target.checked) st.sel.add(r.id); else st.sel.delete(r.id); aggiornaSel(); riga.classList.toggle('scelta', e.target.checked); } });
    const dati = [r.fornitore, r.numero && 'n. ' + r.numero, r.data && dataIt(r.data), r.importo != null && euro(r.importo), r.scadenza && 'scad. ' + dataIt(r.scadenza), r.pagine && `${r.pagine} pag.`].filter(Boolean).join(' · ');
    const chips = [
      ...(r.chips || []).map((c) => chip(c.testo, 'st-' + c.tipo)),
      r.scansione ? chip('Scansione: da OCR', 'warn') : null,
      r.firme ? chip(r.firme === 1 ? 'Firmato digitalmente' : `${r.firme} firme`, 'firma') : null,
      r.protetto ? chip('Protetto da password', 'warn') : null,
      r.errore ? chip(r.errore.length > 60 ? r.errore.slice(0, 58) + '…' : r.errore, 'err') : null,
      r.offline ? chip('Cartella non raggiungibile', 'err') : null,
    ].filter(Boolean);
    const es = st.estratti.get(r.id)?.[0];
    const snippet = st.q && !prova ? h('div', { class: 'ar-snip' }, es ? [es.pagina ? h('span', { class: 'ar-pg' }, `pag. ${es.pagina}`) : null, es.prima, h('mark', {}, es.trovato), es.dopo] : (r.pagina ? `trovato a pag. ${r.pagina}` : 'trovato nel nome o nei dati')) : null;
    const riga = h('div', { class: 'ar-riga' + (scelto ? ' scelta' : ''), role: 'listitem', tabindex: 0, 'data-i': i },
      chk,
      h('span', { class: 'ar-tipo t-' + r.tipo }, TIPO_LABEL[r.tipo] || 'Altro'),
      h('div', { class: 'ar-txt' },
        h('div', { class: 'ar-nome' }, h('strong', {}, r.nome), h('small', {}, r.rel && r.rel !== r.nome ? r.rel : '')),
        h('div', { class: 'ar-dati' }, dati || h('span', { class: 'muted' }, 'Nessun dato riconosciuto'), chips.length ? h('span', { class: 'ar-chips' }, chips) : null),
        snippet),
      h('button', { class: 'btn ar-apri', onclick: (e) => { e.stopPropagation(); apri(r); } }, 'Apri'));
    riga.addEventListener('dblclick', () => apri(r));
    riga.addEventListener('click', (e) => { if (e.target.closest('button,input')) return; chk.click(); });
    riga.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); apri(r); }
      else if (e.key === ' ') { e.preventDefault(); chk.click(); }
      else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const j = i + (e.key === 'ArrowDown' ? 1 : -1);
        if (j < 0 || j >= st.righe.length) return;
        lista.vaiA(j - 3);
        requestAnimationFrame(() => lista.el.querySelector(`[data-i="${j}"]`)?.focus());
      }
    });
    return riga;
  }

  let richiesta = 0;
  async function chiediEstratti(visibili) {
    if (!st.q) return;
    const ids = visibili.map((r) => r.id).filter((id) => !st.estratti.has(id));
    if (!ids.length) return;
    const n = ++richiesta; const qq = st.q;
    const r = await A.estratti(ids, qq).catch(() => ({}));
    if (n !== richiesta || qq !== st.q) return;
    for (const id of ids) st.estratti.set(id, r[id] || []);
    lista.ridisegna();
  }

  function apri(r) {
    const es = st.estratti.get(r.id)?.[0];
    apriDocumento(app, A, r, { q: st.q, pagina: es?.pagina || r.pagina || null });
  }
  async function apriId(id) {
    const [r] = await A.righe([id]);
    if (r) apriDocumento(app, A, r, {});
  }

  async function aggiungi() {
    try { await A.aggiungiCartella(); } catch (e) { app.reportError(e, 'Cartella non collegata'); }
  }

  async function aggiornaFiltri() {
    const c = await A.conteggi().catch(() => null);
    if (!c) return;
    A.size = c.totale;
    dlForn.replaceChildren(...c.fornitori.map((f) => h('option', { value: f.nome })));
    const v = fCartella.value;
    fCartella.replaceChildren(h('option', { value: '' }, 'Tutte le cartelle'), ...A.cartelle.map((x) => h('option', { value: x.id }, `${x.nome} (${(c.cartelle[x.id] || 0).toLocaleString('it-IT')})`)));
    fCartella.value = v;
    const vs = fStato.value;
    fStato.replaceChildren(h('option', { value: '' }, 'Qualsiasi stato'), ...VOCI_STATO.map((s) => h('option', { value: s.id }, s.label)), h('option', { value: 'senza-stato' }, 'Senza stato'),
      ...c.etichette.map((e) => h('option', { value: 'etichetta:' + e.nome }, `Etichetta: ${e.nome} (${e.n})`)));
    fStato.value = vs;
    for (const o of fTipo.options) if (o.value) o.textContent = `${TIPO_LABEL[o.value]} (${(c.tipi[o.value] || 0).toLocaleString('it-IT')})`;
    for (const o of fSegnale.options) if (o.value && c.segnali[o.value] != null) o.textContent = `${SEGNALI.find((s) => s.value === o.value).label} (${c.segnali[o.value].toLocaleString('it-IT')})`;
    sottotitolo.textContent = descrizione(c.totale);
  }
  function descrizione(n) {
    const off = A.cartelle.filter((c) => A.offline.has(c.id));
    return `${n.toLocaleString('it-IT')} documenti in ${A.cartelle.length} ${A.cartelle.length === 1 ? 'cartella' : 'cartelle'}` + (off.length ? ` · ${off.length} non raggiungibil${off.length === 1 ? 'e' : 'i'}` : '');
  }

  function disegnaProgresso(av) {
    const attivo = av && ['scansione', 'lettura', 'interruzione'].includes(av.fase) && A.lavoro;
    progresso.hidden = !attivo;
    if (!attivo) return;
    const pct = av.totale ? Math.round((av.fatti / av.totale) * 100) : 0;
    progresso.querySelector('.ar-barra > div').style.width = (av.fase === 'scansione' ? 5 : pct) + '%';
    progresso.querySelector('.ar-prog-t').textContent = av.fase === 'scansione' ? `Controllo delle cartelle… ${av.corrente || ''}` : av.fase === 'interruzione' ? 'Interruzione in corso…' : `Indicizzazione: ${av.fatti.toLocaleString('it-IT')} di ${av.totale.toLocaleString('it-IT')} documenti${av.errori ? ` · ${av.errori} non letti` : ''} — puoi continuare a lavorare`;
  }

  function mostraScheda(s) {
    st.scheda = s;
    tabOggi.setAttribute('aria-selected', String(s === 'oggi')); tabDoc.setAttribute('aria-selected', String(s === 'documenti'));
    tabOggi.classList.toggle('attiva', s === 'oggi'); tabDoc.classList.toggle('attiva', s === 'documenti');
    schedaOggi.hidden = s !== 'oggi'; schedaDoc.hidden = s !== 'documenti';
    if (s === 'oggi') disegnaOggiOra();
    else { cerca(); setTimeout(() => q.focus(), 30); }
  }
  async function disegnaOggiOra() {
    vuoto.hidden = A.attivo; oggiBox.hidden = !A.attivo;
    if (!A.attivo) return;
    await disegnaOggi(app, A, oggiBox, { apri: apriId, vedi: (filtro) => { applicaFiltro(filtro); mostraScheda('documenti'); } });
    A.segnaVisto();
  }
  function applicaFiltro(f = {}) {
    for (const x of [q, fForn, fDal, fAl, fCig]) x.value = '';
    for (const x of [fTipo, fStato, fCartella, fSegnale]) x.value = '';
    st.filtro = {};
    if (f.tipo) fTipo.value = f.tipo;
    if (f.stato) fStato.value = f.stato;
    if (f.segnale) fSegnale.value = f.segnale;
    if (f.ordine) { fOrdine.value = f.ordine; st.ordineScelto = true; }
    if (f.dalVisto) st.filtro.aggiuntoDopo = A.soglia;
    if (f.q != null) q.value = f.q;
  }

  // ---------- aggiornamenti dall'archivio ----------
  let ridisegno = 0;
  const off = A.on((tipo, dati) => {
    if (tipo === 'avanzamento') disegnaProgresso(dati);
    if (tipo === 'cambiato' || tipo === 'cartelle' || tipo === 'caricato') {
      clearTimeout(ridisegno);
      ridisegno = setTimeout(() => { aggiornaFiltri(); if (st.scheda === 'documenti') cerca(); else disegnaOggiOra(); }, tipo === 'cambiato' ? 400 : 0);
    }
  });
  const offDoc = [app.bus.on('document:loaded', () => api.chiudi()), app.bus.on('document:activated', ({ doc }) => { if (doc) api.chiudi(); })];
  const onKey = (e) => { if (e.key === 'Escape' && !document.querySelector('.backdrop') && el.isConnected) { e.stopPropagation(); api.chiudi(); } };
  document.addEventListener('keydown', onKey, true);

  const api = {
    el,
    mostra(o = {}) {
      if (o.filtro || o.q != null) { applicaFiltro({ ...(o.filtro || {}), q: o.q }); mostraScheda('documenti'); }
      else mostraScheda(o.scheda || st.scheda);
    },
    chiudi() {
      if (!el.isConnected) return;
      el.remove(); off(); offDoc.forEach((f) => f?.()); lista.distruggi(); document.removeEventListener('keydown', onKey, true);
      if (corrente === api) corrente = null;
    },
    get stato() { return st; },
  };
  corrente = api;
  aggiornaFiltri();
  disegnaProgresso(A.avanzamento);
  api.mostra(opts);
  return api;
}
