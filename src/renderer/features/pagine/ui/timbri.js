// Intestazione e piè di pagina, numerazione progressiva (Bates), filigrana, sfondo: con anteprima dal vivo e impostazioni salvabili.
import * as T from '../logica/timbri.js';
import { intervalli, testoWinAnsi, mmToPt } from '../logica/util.js';
import { preparaImmagine, barraPreset, preset, campoPagine, mostraErrore, FILTRO_IMMAGINI } from './comune.js';
import { modifica } from './strumenti.js';

const FAMIGLIA = { helvetica: 'Helvetica, Arial, sans-serif', 'helvetica-b': 'Helvetica, Arial, sans-serif', times: '"Times New Roman", Times, serif', 'times-b': '"Times New Roman", Times, serif', courier: '"Courier New", Courier, monospace' };
const oggi = () => new Date().toLocaleDateString('it-IT');

/** Anteprima di una pagina del documento attivo con uno strato per i segnaposto. */
function anteprima(app, onCambio) {
  const { h } = app.ui;
  const doc = app.activeDoc;
  const pagina = h('div', { class: 'pg-anteprima-pagina' });
  const strato = h('div', { class: 'pg-anteprima-strato' });
  const etich = h('span', {});
  let i = Math.min(app.viewer.pageIndex, doc.pageCount - 1); let info = null; let token = 0;
  const vai = async (k) => {
    i = Math.max(0, Math.min(doc.pageCount - 1, k)); const t = ++token;
    etich.textContent = `Pagina ${i + 1} di ${doc.pageCount}`;
    let page;
    try {
      page = await doc.pdf.getPage(i + 1);
      const vp0 = page.getViewport({ scale: 1 });
      const scala = Math.min(290 / vp0.width, 400 / vp0.height);
      const vp = page.getViewport({ scale: scala * Math.min(2, devicePixelRatio || 1) });
      const cv = document.createElement('canvas'); cv.width = Math.ceil(vp.width); cv.height = Math.ceil(vp.height);
      const ctx = cv.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
      await page.render({ canvasContext: ctx, canvas: cv, viewport: vp }).promise;
      if (t !== token) return;
      pagina.style.width = vp0.width * scala + 'px'; pagina.style.height = vp0.height * scala + 'px';
      pagina.replaceChildren(cv, strato);
      info = { w: vp0.width, h: vp0.height, scala, pagina: i };
      onCambio(strato, info);
    } catch { /* documento chiuso */ } finally { page?.cleanup(); }
  };
  const el = h('div', { class: 'pg-anteprima' }, h('strong', { class: 'help' }, 'Anteprima'), pagina,
    h('div', { class: 'pg-anteprima-nav' }, h('button', { type: 'button', class: 'btn small', 'aria-label': 'Pagina precedente', onclick: () => vai(i - 1) }, '‹'), etich, h('button', { type: 'button', class: 'btn small', 'aria-label': 'Pagina successiva', onclick: () => vai(i + 1) }, '›')));
  vai(i);
  return { el, aggiorna: () => info && onCambio(strato, info), get pagina() { return i; } };
}

/** Disegna un testo nello strato di anteprima in coordinate visive (punti, origine in basso a sinistra). */
function spanTesto(app, strato, info, str, { vx, vy, size, font, colore, opacita = 1, ancora = 0, angolo = 0, centraVert = false }) {
  const s = info.scala;
  const span = app.ui.h('span', { style: { left: vx * s + 'px', top: (info.h - vy) * s + 'px', fontSize: size * s + 'px', fontFamily: FAMIGLIA[font] || FAMIGLIA.helvetica, fontWeight: /-b$/.test(font) ? '700' : '400', color: colore, opacity: String(opacita),
    transformOrigin: '0 0', transform: `rotate(${-angolo}deg) translate(${-ancora * 100}%, ${centraVert ? '-50%' : '-80%'})` } }, str);
  strato.append(span);
}

// ---------------- intestazione, piè di pagina, Bates ----------------
export async function apriIntestazioni(app, { bates = false } = {}) {
  const { h } = app.ui;
  const doc = app.activeDoc;
  const store = preset(app, bates ? 'bates' : 'intestazioni');
  const prossimo = app.settings.get('pagine.bates.prossimo', 1);
  const predef = bates ? {
    'Allegati ALL.1-001 in basso a destra': { testi: { basso: { dx: '{bates}' } }, bates: { prefisso: 'ALL.1-', cifre: 3, inizio: 1, suffisso: '' } },
    'Numero a 6 cifre in basso a destra': { testi: { basso: { dx: '{bates}' } }, bates: { prefisso: '', cifre: 6, inizio: 1, suffisso: '' } },
  } : {
    'Pag. 1 di 10 in basso al centro': { testi: { basso: { centro: 'Pag. {n} di {N}' } } },
    'Numero in basso a destra': { testi: { basso: { dx: '{n}' } } },
    '1/10 in basso al centro': { testi: { basso: { centro: '{n}/{N}' } } },
    'Nome file in alto, numero in basso': { testi: { alto: { sx: '{file}' }, basso: { dx: 'Pag. {n} di {N}' } } },
  };
  const base = store.ultimo() || (bates ? predef['Allegati ALL.1-001 in basso a destra'] : predef['Pag. 1 di 10 in basso al centro']);
  const st = {
    testi: { alto: { sx: '', centro: '', dx: '', ...(base.testi?.alto || {}) }, basso: { sx: '', centro: '', dx: '', ...(base.testi?.basso || {}) } },
    font: base.font || 'helvetica', dimensione: base.dimensione || 10, colore: base.colore || '#000000',
    margini: { alto: 12, basso: 10, lati: 15, ...(base.margini || {}) },
    escludiPrima: !!base.escludiPrima, inizio: base.inizio || 1,
    bates: bates ? { prefisso: 'ALL.1-', cifre: 3, suffisso: '', ...(base.bates || {}), inizio: prossimo } : null,
  };
  let slotAttivo = bates ? ['basso', 'dx'] : ['basso', 'centro'];
  const inputs = {};
  const anteprimaV = anteprima(app, (strato, info) => {
    strato.replaceChildren();
    let indici; try { indici = intervalli(campoP.get(), doc.pageCount); } catch { return; }
    if (st.escludiPrima) indici = indici.filter((x) => x !== 0);
    const k = indici.indexOf(info.pagina);
    if (k < 0) { strato.append(h('span', { style: { left: '8px', top: '8px', fontSize: '11px', color: '#888' } }, 'Questa pagina non viene numerata')); return; }
    const tot = st.totale === 'documento' ? doc.pageCount : indici.length + st.inizio - 1;
    const v = { n: st.inizio + k, N: tot, data: oggi(), file: doc.name, bates: st.bates ? T.numeroBates(st.bates, st.bates.inizio + k) : '' };
    const ml = mmToPt(st.margini.lati), ma = mmToPt(st.margini.alto), mb = mmToPt(st.margini.basso);
    for (const riga of ['alto', 'basso']) for (const [col, anc] of [['sx', 0], ['centro', 0.5], ['dx', 1]]) {
      const t = st.testi[riga][col]; if (!t?.trim()) continue;
      const str = testoWinAnsi(T.compila(t, v));
      spanTesto(app, strato, info, str, { vx: anc === 0 ? ml : anc === 1 ? info.w - ml : info.w / 2, vy: riga === 'alto' ? info.h - ma - st.dimensione * 0.75 : mb, size: st.dimensione, font: st.font, colore: st.colore, ancora: anc });
    }
  });
  const aggiorna = () => anteprimaV.aggiorna();
  const campoP = campoPagine(app, base.pagine || '', { conQuesta: false });
  campoP.input.addEventListener('input', aggiorna);
  campoP.el.addEventListener('click', () => setTimeout(aggiorna));

  // griglia dei 6 riquadri
  const griglia = h('div', { class: 'pg-slot-griglia' });
  const evidenzia = () => { for (const [k, inp] of Object.entries(inputs)) inp.classList.toggle('pg-slot-attivo', k === slotAttivo.join('.')); for (const [k, inp] of Object.entries(inputs)) inp.style.borderColor = k === slotAttivo.join('.') ? 'var(--accent)' : ''; };
  for (const riga of ['alto', 'basso']) {
    for (const [col, et] of [['sx', 'sinistra'], ['centro', 'centro'], ['dx', 'destra']]) {
      const inp = h('input', { type: 'text', class: 'pg-input', value: st.testi[riga][col], placeholder: `${riga === 'alto' ? 'In alto' : 'In basso'} a ${et}`.replace('a centro', 'al centro'), 'aria-label': `${riga === 'alto' ? 'Intestazione' : 'Piè di pagina'} ${et}` });
      inp.addEventListener('input', () => { st.testi[riga][col] = inp.value; aggiorna(); });
      inp.addEventListener('focus', () => { slotAttivo = [riga, col]; evidenzia(); });
      inputs[`${riga}.${col}`] = inp; griglia.append(inp);
    }
    if (riga === 'alto') griglia.append(...['sinistra', 'centro', 'destra'].map((x) => h('span', { class: 'pg-slot-et' }, `↑ intestazione · ${x}`)));
  }
  griglia.append(...['sinistra', 'centro', 'destra'].map((x) => h('span', { class: 'pg-slot-et' }, `↓ piè di pagina · ${x}`)));
  const inserisci = (tok) => { const inp = inputs[slotAttivo.join('.')]; const p = inp.selectionStart ?? inp.value.length; inp.value = inp.value.slice(0, p) + tok + inp.value.slice(inp.selectionEnd ?? p); st.testi[slotAttivo[0]][slotAttivo[1]] = inp.value; inp.focus(); aggiorna(); };
  const modelli = h('div', { class: 'pg-chips' }, ...(bates ? [['Numero allegato', '{bates}']] : T.MODELLI_NUMERO.map(([m, e]) => [e, m])).map(([et, m]) => h('button', { type: 'button', class: 'pg-chip', title: 'Scrive questo modello nel riquadro scelto', onclick: () => { const inp = inputs[slotAttivo.join('.')]; inp.value = m; st.testi[slotAttivo[0]][slotAttivo[1]] = m; evidenzia(); aggiorna(); } }, et)));
  const segnaposto = h('div', { class: 'pg-chips' }, h('span', { class: 'help' }, 'Aggiungi:'), ...[['N. pagina', '{n}'], ['Totale pagine', '{N}'], ['Data di oggi', '{data}'], ['Nome file', '{file}'], ...(bates ? [['Numero allegato', '{bates}']] : [])].map(([et, t]) => h('button', { type: 'button', class: 'pg-chip', onclick: () => inserisci(t) }, et)));

  const num = (label, val, set, attrs = {}) => { const i = h('input', { type: 'number', class: 'pg-input', value: val, ...attrs }); i.addEventListener('input', () => { set(i.value === '' ? null : Number(i.value)); aggiorna(); }); return h('div', { class: 'field' }, h('label', {}, label), i); };
  const fontSel = h('select', { class: 'pg-input' }, Object.entries(T.FONT).map(([k, [l]]) => h('option', { value: k, selected: k === st.font }, l)));
  fontSel.addEventListener('change', () => { st.font = fontSel.value; aggiorna(); });
  const colore = h('input', { type: 'color', value: st.colore }); colore.addEventListener('input', () => { st.colore = colore.value; aggiorna(); });
  const escl = h('input', { type: 'checkbox', checked: st.escludiPrima, id: 'pg-escl' }); escl.addEventListener('change', () => { st.escludiPrima = escl.checked; aggiorna(); });
  const batesCampi = bates ? h('div', { class: 'pg-riga' },
    (() => { const i = h('input', { type: 'text', class: 'pg-input', value: st.bates.prefisso }); i.addEventListener('input', () => { st.bates.prefisso = i.value; aggiorna(); }); return h('div', { class: 'field' }, h('label', {}, 'Prefisso'), i); })(),
    num('Cifre', st.bates.cifre, (v) => { st.bates.cifre = Math.max(1, Math.min(12, v || 1)); }, { min: 1, max: 12 }),
    num('Primo numero', st.bates.inizio, (v) => { st.bates.inizio = v; }, { min: 0, step: 1 }),
    (() => { const i = h('input', { type: 'text', class: 'pg-input', value: st.bates.suffisso }); i.addEventListener('input', () => { st.bates.suffisso = i.value; aggiorna(); }); return h('div', { class: 'field' }, h('label', {}, 'Suffisso'), i); })()) : null;

  const leggi = () => JSON.parse(JSON.stringify({ ...st, pagine: campoP.get() }));
  const applicaPreset = (p) => {
    if (!p) return;
    for (const riga of ['alto', 'basso']) for (const col of ['sx', 'centro', 'dx']) { st.testi[riga][col] = p.testi?.[riga]?.[col] || ''; inputs[`${riga}.${col}`].value = st.testi[riga][col]; }
    if (p.font) { st.font = p.font; fontSel.value = p.font; }
    if (p.dimensione) st.dimensione = p.dimensione;
    if (p.colore) { st.colore = p.colore; colore.value = p.colore; }
    if (p.margini) Object.assign(st.margini, p.margini);
    st.escludiPrima = !!p.escludiPrima; escl.checked = st.escludiPrima;
    if (p.pagine != null) campoP.input.value = p.pagine;
    if (bates && p.bates) { Object.assign(st.bates, { ...p.bates, inizio: st.bates.inizio }); batesCampi.querySelectorAll('input')[0].value = st.bates.prefisso; batesCampi.querySelectorAll('input')[1].value = st.bates.cifre; batesCampi.querySelectorAll('input')[3].value = st.bates.suffisso; }
    aggiorna();
  };

  const sinistra = h('div', {},
    barraPreset(app, store, { onScegli: applicaPreset, leggi, predefiniti: predef }),
    bates ? h('div', {}, h('div', { class: 'pg-sezione' }, 'Numerazione progressiva degli allegati (detta anche «Bates»)'), batesCampi, h('p', { class: 'help' }, `Il prossimo numero viene ricordato: così puoi continuare la numerazione sul file successivo.`)) : null,
    h('div', { class: 'pg-sezione' }, 'Testo e posizione — clicca un riquadro, poi scegli un modello'),
    modelli, griglia, segnaposto,
    h('div', { class: 'pg-riga' }, h('div', { class: 'field' }, h('label', {}, 'Carattere'), fontSel), num('Dimensione', st.dimensione, (v) => { st.dimensione = Math.max(4, Math.min(72, v || 10)); }, { min: 4, max: 72 }), h('div', { class: 'field' }, h('label', {}, 'Colore'), colore)),
    h('div', { class: 'pg-riga' }, num('Margine sopra (mm)', st.margini.alto, (v) => { st.margini.alto = v ?? 0; }, { min: 0, max: 100 }), num('Margine sotto (mm)', st.margini.basso, (v) => { st.margini.basso = v ?? 0; }, { min: 0, max: 100 }), num('Margine ai lati (mm)', st.margini.lati, (v) => { st.margini.lati = v ?? 0; }, { min: 0, max: 100 })),
    h('div', { class: 'pg-sezione' }, 'Pagine'), campoP.el,
    h('div', { class: 'field inline', style: { marginTop: '8px' } }, escl, h('label', { for: 'pg-escl' }, 'Non numerare la prima pagina (copertina)')),
    bates ? null : num('La numerazione parte da', st.inizio, (v) => { st.inizio = Number.isInteger(v) && v > 0 ? v : 1; }, { min: 1, step: 1 }));
  evidenzia();
  const corpo = h('div', { class: 'pg-dlg-cols' }, sinistra, anteprimaV.el);
  const v = await app.ui.dialog({ title: bates ? 'Numerazione progressiva degli allegati' : 'Intestazione e piè di pagina', body: corpo, width: 900, okLabel: 'Applica', validate: () => {
    try { intervalli(campoP.get(), doc.pageCount); } catch (e) { return e.message; }
    if (!Object.values(st.testi).some((r) => Object.values(r).some((t) => t.trim()))) return 'Scrivi almeno un testo in uno dei riquadri.';
    if (bates && !(Number.isInteger(st.bates.inizio) && st.bates.inizio >= 0)) return 'Il primo numero deve essere un intero (0 o più).';
    return null;
  } });
  if (!v) return;
  store.ricorda(leggi());
  const indici = intervalli(campoP.get(), doc.pageCount);
  let ris;
  const ok = await modifica(app, bates ? 'Numerazione degli allegati aggiunta' : 'Intestazione e piè di pagina aggiunti', async (d, L, dd, p) => {
    ris = await T.intestazioni(d, { ...st, indici, data: oggi(), file: doc.name, onProgress: (f) => p?.set(f), signal: p?.signal });
  });
  if (ok && bates && ris) { app.settings.set('pagine.bates.prossimo', ris.ultimoBates + 1); app.ui.toast(`Ultimo numero usato: ${T.numeroBates(st.bates, ris.ultimoBates)}. Il prossimo file partirà da ${ris.ultimoBates + 1}.`, { kind: 'success', timeout: 9000 }); }
}

// ---------------- filigrana ----------------
export async function apriFiligrana(app) {
  const { h } = app.ui;
  const doc = app.activeDoc;
  const store = preset(app, 'filigrana');
  const base = store.ultimo() || {};
  const st = { tipo: 'testo', testo: 'COPIA', font: 'helvetica-b', dimensione: 0, colore: '#c0392b', opacita: 0.25, rotazione: 45, posizione: 'centro', sotto: false, scala: 0.5, ...base, immagine: null };
  let imgUrl = null;
  const anteprimaV = anteprima(app, (strato, info) => {
    strato.replaceChildren();
    let indici; try { indici = intervalli(campoP.get(), doc.pageCount); } catch { return; }
    if (!indici.includes(info.pagina)) return;
    const s = info.scala;
    const POS = { 'alto-sx': [0, 1], alto: [0.5, 1], 'alto-dx': [1, 1], sx: [0, 0.5], centro: [0.5, 0.5], dx: [1, 0.5], 'basso-sx': [0, 0], basso: [0.5, 0], 'basso-dx': [1, 0] }[st.posizione];
    const a = (st.rotazione * Math.PI) / 180;
    const margine = Math.min(info.w, info.h) * 0.06;
    if (st.tipo === 'immagine') {
      if (!imgUrl || !st.immagine) return;
      const w = info.w * st.scala, hh = w * (st.immagine.h / st.immagine.w);
      const ew = Math.abs(w * Math.cos(a)) + Math.abs(hh * Math.sin(a)), eh = Math.abs(w * Math.sin(a)) + Math.abs(hh * Math.cos(a));
      const cx = margine + ew / 2 + (info.w - 2 * margine - ew) * POS[0], cy = margine + eh / 2 + (info.h - 2 * margine - eh) * POS[1];
      strato.append(h('img', { src: imgUrl, style: { position: 'absolute', left: cx * s + 'px', top: (info.h - cy) * s + 'px', width: w * s + 'px', height: hh * s + 'px', opacity: String(st.opacita), transform: `translate(-50%,-50%) rotate(${-st.rotazione}deg)` } }));
      return;
    }
    const str = testoWinAnsi(st.testo).trim(); if (!str) return;
    // misura il testo con un canvas per dimensionare come nel PDF
    const ctx = document.createElement('canvas').getContext('2d'); ctx.font = `${/-b$/.test(st.font) ? 700 : 400} 100px ${FAMIGLIA[st.font]}`;
    const w1 = ctx.measureText(str).width / 100;
    let size = st.dimensione;
    if (!(size > 0)) { const lung = st.rotazione % 180 ? Math.min(Math.hypot(info.w, info.h), Math.abs(info.h / Math.sin(a)) || Infinity, Math.abs(info.w / Math.cos(a)) || Infinity) : info.w; size = Math.max(8, Math.min(220, (lung * 0.7) / Math.max(0.01, w1))); }
    const tw = w1 * size, th = size * 0.72;
    const ew = Math.abs(tw * Math.cos(a)) + Math.abs(th * Math.sin(a)), eh = Math.abs(tw * Math.sin(a)) + Math.abs(th * Math.cos(a));
    const cx = margine + ew / 2 + Math.max(0, info.w - 2 * margine - ew) * POS[0], cy = margine + eh / 2 + Math.max(0, info.h - 2 * margine - eh) * POS[1];
    strato.append(h('span', { style: { left: cx * s + 'px', top: (info.h - cy) * s + 'px', fontSize: size * s + 'px', fontFamily: FAMIGLIA[st.font], fontWeight: /-b$/.test(st.font) ? '700' : '400', color: st.colore, opacity: String(st.opacita), transform: `translate(-50%,-50%) rotate(${-st.rotazione}deg)` } }, str));
  });
  const aggiorna = () => anteprimaV.aggiorna();
  const campoP = campoPagine(app, '', { conQuesta: true });
  campoP.input.addEventListener('input', aggiorna);

  const testo = h('input', { type: 'text', class: 'pg-input', value: st.testo, 'aria-label': 'Testo della filigrana' });
  testo.addEventListener('input', () => { st.testo = testo.value; aggiorna(); });
  const chips = h('div', { class: 'pg-chips' }, ...['COPIA', 'BOZZA', 'ANNULLATO', 'RISERVATO', 'DUPLICATO', 'COPIA CONFORME', 'NON VALIDO'].map((t) => h('button', { type: 'button', class: 'pg-chip', onclick: () => { st.testo = t; testo.value = t; aggiorna(); } }, t)));
  const fontSel = h('select', { class: 'pg-input' }, Object.entries(T.FONT).map(([k, [l]]) => h('option', { value: k, selected: k === st.font }, l)));
  fontSel.addEventListener('change', () => { st.font = fontSel.value; aggiorna(); });
  const dim = h('select', { class: 'pg-input' }, [['0', 'Automatica (adatta alla pagina)'], ['36', '36 pt'], ['60', '60 pt'], ['90', '90 pt'], ['130', '130 pt']].map(([v2, l]) => h('option', { value: v2, selected: String(st.dimensione) === v2 }, l)));
  dim.addEventListener('change', () => { st.dimensione = +dim.value; aggiorna(); });
  const colore = h('input', { type: 'color', value: st.colore }); colore.addEventListener('input', () => { st.colore = colore.value; aggiorna(); });
  const opac = h('input', { type: 'range', min: 5, max: 100, step: 5, value: Math.round(st.opacita * 100) }); const opacOut = h('output', {}, Math.round(st.opacita * 100) + '%');
  opac.addEventListener('input', () => { st.opacita = opac.value / 100; opacOut.textContent = opac.value + '%'; aggiorna(); });
  const rot = h('div', { class: 'seg' }, ...[[0, 'Orizzontale'], [45, 'Diagonale ↗'], [-45, 'Diagonale ↘'], [90, 'Verticale']].map(([g, l]) => { const b = h('button', { type: 'button', class: st.rotazione === g ? 'active' : '' }, l); b.addEventListener('click', () => { st.rotazione = g; rot.querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === b)); aggiorna(); }); return b; }));
  const pos = h('div', { class: 'pg-pos9', role: 'radiogroup', 'aria-label': 'Posizione' }, ...T.POSIZIONI.map((p) => { const b = h('button', { type: 'button', class: st.posizione === p ? 'active' : '', title: p, 'aria-label': p }); b.addEventListener('click', () => { st.posizione = p; pos.querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === b)); aggiorna(); }); return b; }));
  const sotto = h('select', { class: 'pg-input' }, h('option', { value: 'sopra', selected: !st.sotto }, 'Sopra il contenuto (sempre visibile)'), h('option', { value: 'sotto', selected: st.sotto }, 'Sotto il contenuto (dietro testo e immagini)'));
  sotto.addEventListener('change', () => { st.sotto = sotto.value === 'sotto'; });
  const scala = h('input', { type: 'range', min: 5, max: 100, step: 5, value: Math.round(st.scala * 100) }); scala.addEventListener('input', () => { st.scala = scala.value / 100; aggiorna(); });
  const nomeImg = h('span', { class: 'help' }, 'Nessuna immagine scelta');
  const sceltaImg = h('button', { type: 'button', class: 'btn small', onclick: async () => {
    const fs = await app.platform.openFiles({ filters: FILTRO_IMMAGINI, raw: true, title: 'Scegli l\'immagine (es. il timbro o il logo)' });
    if (!fs?.length) return;
    try {
      const img = await preparaImmagine(app, fs[0].bytes, fs[0].name);
      const bmp = await createImageBitmap(new Blob([img.bytes])); st.immagine = { ...img, w: bmp.width, h: bmp.height }; bmp.close?.();
      if (imgUrl) URL.revokeObjectURL(imgUrl); imgUrl = URL.createObjectURL(new Blob([img.bytes]));
      nomeImg.textContent = fs[0].name; aggiorna();
    } catch (err) { mostraErrore(app, err, 'Filigrana'); }
  } }, 'Scegli immagine…');
  const boxTesto = h('div', {}, h('div', { class: 'field' }, h('label', {}, 'Testo'), testo), chips, h('div', { class: 'pg-riga' }, h('div', { class: 'field' }, h('label', {}, 'Carattere'), fontSel), h('div', { class: 'field' }, h('label', {}, 'Grandezza'), dim), h('div', { class: 'field' }, h('label', {}, 'Colore'), colore)));
  const boxImg = h('div', { hidden: true }, h('div', { class: 'pg-riga' }, sceltaImg, nomeImg), h('div', { class: 'field' }, h('label', {}, 'Grandezza rispetto alla pagina'), scala));
  const tipo = h('div', { class: 'seg' }, ...[['testo', 'Testo'], ['immagine', 'Immagine']].map(([t, l]) => { const b = h('button', { type: 'button', class: st.tipo === t ? 'active' : '' }, l); b.addEventListener('click', () => { st.tipo = t; tipo.querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === b)); boxTesto.hidden = t !== 'testo'; boxImg.hidden = t !== 'immagine'; aggiorna(); }); return b; }));
  if (st.tipo === 'immagine') { st.tipo = 'testo'; }
  const leggi = () => { const { immagine, ...r } = st; void immagine; return { ...r, pagine: campoP.get() }; };
  const applicaPreset = (p) => { if (!p) return; Object.assign(st, p, { immagine: st.immagine }); testo.value = st.testo; fontSel.value = st.font; colore.value = st.colore; opac.value = Math.round(st.opacita * 100); opacOut.textContent = opac.value + '%'; dim.value = String(st.dimensione); sotto.value = st.sotto ? 'sotto' : 'sopra'; rot.querySelectorAll('button').forEach((x, k) => x.classList.toggle('active', [0, 45, -45, 90][k] === st.rotazione)); pos.querySelectorAll('button').forEach((x, k) => x.classList.toggle('active', T.POSIZIONI[k] === st.posizione)); if (p.pagine != null) campoP.input.value = p.pagine; aggiorna(); };
  const sinistra = h('div', {},
    barraPreset(app, store, { onScegli: applicaPreset, leggi, predefiniti: { 'COPIA diagonale rossa': { tipo: 'testo', testo: 'COPIA', font: 'helvetica-b', dimensione: 0, colore: '#c0392b', opacita: 0.25, rotazione: 45, posizione: 'centro', sotto: false }, 'BOZZA grigia': { tipo: 'testo', testo: 'BOZZA', font: 'helvetica-b', dimensione: 0, colore: '#555555', opacita: 0.18, rotazione: 45, posizione: 'centro', sotto: false }, 'ANNULLATO rosso': { tipo: 'testo', testo: 'ANNULLATO', font: 'helvetica-b', dimensione: 0, colore: '#d10000', opacita: 0.35, rotazione: 45, posizione: 'centro', sotto: false } } }),
    h('div', { class: 'field' }, h('label', {}, 'Tipo'), tipo), boxTesto, boxImg,
    h('div', { class: 'field' }, h('label', {}, 'Trasparenza (opacità)'), h('div', { class: 'range-row' }, opac, opacOut)),
    h('div', { class: 'field' }, h('label', {}, 'Inclinazione'), rot),
    h('div', { class: 'pg-riga' }, h('div', { class: 'field' }, h('label', {}, 'Posizione'), pos), h('div', { class: 'field' }, h('label', {}, 'Livello'), sotto)),
    h('div', { class: 'pg-sezione' }, 'Pagine'), campoP.el);
  const v = await app.ui.dialog({ title: 'Filigrana', body: h('div', { class: 'pg-dlg-cols' }, sinistra, anteprimaV.el), width: 880, okLabel: 'Applica', validate: () => {
    try { intervalli(campoP.get(), doc.pageCount); } catch (e) { return e.message; }
    if (st.tipo === 'testo' && !testoWinAnsi(st.testo).trim()) return 'Scrivi il testo della filigrana.';
    if (st.tipo === 'immagine' && !st.immagine) return 'Scegli un\'immagine.';
    return null;
  } });
  if (imgUrl) URL.revokeObjectURL(imgUrl);
  if (!v) return;
  store.ricorda(leggi());
  const indici = intervalli(campoP.get(), doc.pageCount);
  await modifica(app, 'Filigrana aggiunta', (d, L, dd, p) => T.filigrana(d, { ...st, testo: st.tipo === 'testo' ? st.testo : null, immagine: st.tipo === 'immagine' ? { bytes: st.immagine.bytes, tipo: st.immagine.tipo } : null, indici, onProgress: (f) => p?.set(f), signal: p?.signal }));
}

// ---------------- sfondo ----------------
export async function apriSfondo(app) {
  const { h } = app.ui;
  const doc = app.activeDoc;
  const st = { colore: '#fff8e1', opacita: 1, immagine: null, tipo: 'colore' };
  let imgUrl = null;
  const anteprimaV = anteprima(app, (strato, info) => {
    strato.replaceChildren();
    let indici; try { indici = intervalli(campoP.get(), doc.pageCount); } catch { return; }
    if (!indici.includes(info.pagina)) return;
    // lo sfondo sta sotto il contenuto: in anteprima usiamo la fusione "moltiplica"
    const el = st.tipo === 'immagine' && imgUrl ? h('img', { src: imgUrl, style: { position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', opacity: String(st.opacita), mixBlendMode: 'multiply' } }) : h('div', { style: { position: 'absolute', inset: 0, background: st.colore, opacity: String(st.opacita), mixBlendMode: 'multiply' } });
    strato.append(el);
  });
  const aggiorna = () => anteprimaV.aggiorna();
  const campoP = campoPagine(app, '', { conQuesta: true }); campoP.input.addEventListener('input', aggiorna);
  const colore = h('input', { type: 'color', value: st.colore }); colore.addEventListener('input', () => { st.colore = colore.value; st.tipo = 'colore'; aggiorna(); });
  const sw = h('div', { class: 'swatches' }, ...['#fff8e1', '#e8f5e9', '#e3f2fd', '#fce4ec', '#f5f5f5', '#fffde7'].map((c) => h('button', { type: 'button', class: 'swatch', style: { background: c }, 'aria-label': c, onclick: () => { st.colore = c; colore.value = c; st.tipo = 'colore'; aggiorna(); } })));
  const opac = h('input', { type: 'range', min: 10, max: 100, step: 5, value: 100 }); opac.addEventListener('input', () => { st.opacita = opac.value / 100; aggiorna(); });
  const nomeImg = h('span', { class: 'help' }, '');
  const img = h('button', { type: 'button', class: 'btn small', onclick: async () => {
    const fs = await app.platform.openFiles({ filters: FILTRO_IMMAGINI, raw: true, title: 'Scegli l\'immagine di sfondo' });
    if (!fs?.length) return;
    try { st.immagine = await preparaImmagine(app, fs[0].bytes, fs[0].name); st.tipo = 'immagine'; if (imgUrl) URL.revokeObjectURL(imgUrl); imgUrl = URL.createObjectURL(new Blob([st.immagine.bytes])); nomeImg.textContent = fs[0].name; aggiorna(); } catch (err) { mostraErrore(app, err, 'Sfondo'); }
  } }, 'Usa un\'immagine…');
  const sinistra = h('div', {}, h('div', { class: 'field' }, h('label', {}, 'Colore'), h('div', { class: 'pg-riga' }, colore, sw)), h('div', { class: 'pg-riga' }, img, nomeImg),
    h('div', { class: 'field' }, h('label', {}, 'Intensità'), opac), h('p', { class: 'help' }, 'Lo sfondo va sotto il contenuto: sulle scansioni (pagine che sono già un\'immagine) potrebbe non vedersi.'),
    h('div', { class: 'pg-sezione' }, 'Pagine'), campoP.el);
  const v = await app.ui.dialog({ title: 'Sfondo', body: h('div', { class: 'pg-dlg-cols' }, sinistra, anteprimaV.el), width: 820, okLabel: 'Applica', validate: () => { try { intervalli(campoP.get(), doc.pageCount); } catch (e) { return e.message; } } });
  if (imgUrl) URL.revokeObjectURL(imgUrl);
  if (!v) return;
  const indici = intervalli(campoP.get(), doc.pageCount);
  await modifica(app, 'Sfondo aggiunto', (d, L, dd, p) => T.sfondo(d, { colore: st.colore, opacita: st.opacita, immagine: st.tipo === 'immagine' ? st.immagine : null, indici, onProgress: (f) => p?.set(f), signal: p?.signal }));
}
