// Creazione della firma (o della sigla): disegnata, scritta con un carattere manoscritto incluso nell'app
// (Dancing Script e Great Vibes, licenza OFL) o con uno installato, oppure da una foto o scansione della
// firma su carta (sfondo e colore della carta tolti, ritaglio, colore dell'inchiostro: fotoui.js).
import { strokeWidths, smoothSegments, thinPoints, opaqueBounds, initialsOf } from './lib/geom.js';
import { fotoPanel } from './fotoui.js';

/** Caratteri manoscritti inclusi (src/renderer/public-assets/fonts, licenza OFL). */
const INCLUSI = [
  { family: 'Leggio Dancing Script', file: 'DancingScript.ttf' },
  { family: 'Leggio Great Vibes', file: 'GreatVibes.ttf' },
];
let caricamento = null;
/** Carica una volta i caratteri inclusi. → nomi delle famiglie disponibili */
export function caricaCaratteriFirma() {
  if (caricamento) return caricamento;
  caricamento = (async () => {
    const ok = [];
    for (const f of INCLUSI) {
      try {
        if (typeof FontFace === 'undefined') break;
        const r = await fetch(new URL('./assets-extra/fonts/' + f.file, document.baseURI));
        if (!r.ok) continue;
        const face = new FontFace(f.family, await r.arrayBuffer());
        await face.load(); document.fonts.add(face); ok.push(f.family);
      } catch { /* resta il carattere installato */ }
    }
    return ok;
  })();
  return caricamento;
}

const CURSIVE = [
  'Segoe Script', 'Lucida Handwriting', 'Ink Free', 'Freestyle Script', 'Brush Script MT', 'Mistral', 'Kristen ITC', 'Gabriola',
  'Snell Roundhand', 'Apple Chancery', 'Zapfino', 'Bradley Hand', 'Savoye LET', 'Noteworthy', 'Chalkboard SE', 'Marker Felt',
  'URW Chancery L', 'Z003', 'Comic Neue',
];
export const COLORS = [{ v: '#111111', l: 'Nero' }, { v: '#1d3f9a', l: 'Blu' }];

let fontCache = null;
/** Caratteri corsivi davvero installati (confronto delle larghezze con un carattere di riserva). */
export function availableCursiveFonts() {
  if (fontCache) return fontCache;
  const c = document.createElement('canvas').getContext('2d');
  const sample = 'Mariagrazia Rossi 1234';
  const width = (f) => { c.font = `40px ${f}`; return c.measureText(sample).width; };
  const base = { m: width('monospace'), s: width('serif'), ss: width('sans-serif') };
  fontCache = CURSIVE.filter((f) => { const q = `"${f}"`; return width(`${q}, monospace`) !== base.m || width(`${q}, serif`) !== base.s || width(`${q}, sans-serif`) !== base.ss; });
  if (!fontCache.length) fontCache = ['cursive'];
  return fontCache;
}

/** Ritaglia una tela ai pixel visibili e la restituisce come PNG. → { dataUrl, w, h } | null */
export function trimCanvas(canvas, pad = 6) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const b = opaqueBounds(img.data, canvas.width, canvas.height);
  if (!b) return null;
  const out = document.createElement('canvas');
  out.width = b.w + pad * 2; out.height = b.h + pad * 2;
  out.getContext('2d').putImageData(ctx.getImageData(b.x, b.y, b.w, b.h), pad, pad);
  return { dataUrl: out.toDataURL('image/png'), w: out.width, h: out.height };
}

function drawStrokes(ctx, strokes, scale, color) {
  ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = color; ctx.fillStyle = color;
  for (const s of strokes) {
    const pts = s.map((p) => ({ x: p.x * scale, y: p.y * scale, t: p.t }));
    const widths = strokeWidths(pts, { min: 1.1 * scale, max: 3.4 * scale });
    for (const seg of smoothSegments(pts, widths)) {
      if (seg.dot) { ctx.beginPath(); ctx.arc(seg.from.x, seg.from.y, seg.width / 2, 0, Math.PI * 2); ctx.fill(); continue; }
      ctx.beginPath(); ctx.lineWidth = seg.width;
      ctx.moveTo(seg.from.x, seg.from.y); ctx.quadraticCurveTo(seg.ctrl.x, seg.ctrl.y, seg.to.x, seg.to.y); ctx.stroke();
    }
  }
}

export const NOTA_FIRMA_SEMPLICE = 'La firma disegnata, scritta o fotografata è una firma elettronica semplice (un\'immagine): va bene per moduli e comunicazioni interne, ma non sostituisce la firma digitale.';

/**
 * Dialogo «Crea firma». → { dataUrl, w, h, kind, save, nome, proprietario, origine } | null
 * opts: { kind: 'signature'|'initials', name (per proporre il testo e le iniziali), proprietario: 'io'|id,
 *         nomeProprietario, scegliProprietario: async () → { id, nome } | 'io' | null, salva: true }
 */
export async function createSignatureDialog(app, { kind = 'signature', name = '', proprietario = 'io', nomeProprietario = '', scegliProprietario = null, salva = true } = {}) {
  const { h, dialog } = app.ui;
  const inclusi = await caricaCaratteriFirma().catch(() => []);
  const state = { tab: 'draw', color: COLORS[0].v, strokes: [], kind, proprietario, nomeProprietario };
  const fonts = [...inclusi, ...availableCursiveFonts().filter((f) => f !== 'cursive' || !inclusi.length)];
  state.font = fonts[0];
  const testoIniziale = () => (state.kind === 'initials' ? initialsOf(name) : name);

  const W = 560; const H = 200;
  const pad = h('canvas', { class: 'sig-pad', width: W * 2, height: H * 2, style: { width: W + 'px', height: H + 'px' }, 'aria-label': 'Area per disegnare la firma con il mouse, la penna o il dito' });
  const pctx = pad.getContext('2d');
  const hint = h('div', { class: 'sig-hint' }, '');
  const redrawPad = () => { pctx.clearRect(0, 0, pad.width, pad.height); drawStrokes(pctx, state.strokes, 2, state.color); hint.hidden = state.strokes.length > 0; hint.textContent = state.kind === 'initials' ? 'Scrivi qui la sigla' : 'Firma qui con il mouse, la penna o il dito'; };
  let cur = null;
  pad.addEventListener('pointerdown', (e) => {
    e.preventDefault(); pad.setPointerCapture(e.pointerId);
    const r = pad.getBoundingClientRect();
    cur = [{ x: e.clientX - r.left, y: e.clientY - r.top, t: e.timeStamp }];
    state.strokes.push(cur); redrawPad();
  });
  pad.addEventListener('pointermove', (e) => {
    if (!cur) return;
    const r = pad.getBoundingClientRect();
    const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    for (const ce of evs) cur.push({ x: ce.clientX - r.left, y: ce.clientY - r.top, t: ce.timeStamp });
    redrawPad();
  });
  const end = () => { if (cur) { const i = state.strokes.indexOf(cur); state.strokes[i] = thinPoints(cur); cur = null; redrawPad(); } };
  pad.addEventListener('pointerup', end); pad.addEventListener('pointercancel', end);
  const line = h('div', { class: 'sig-line' });

  const colorGroup = () => {
    const g = h('div', { class: 'sig-colors', role: 'radiogroup', 'aria-label': 'Colore dell\'inchiostro' }, COLORS.map((c) => h('button', {
      type: 'button', role: 'radio', 'aria-checked': String(c.v === state.color), class: 'sig-color' + (c.v === state.color ? ' on' : ''), title: c.l, 'aria-label': c.l, style: { background: c.v },
      onclick: () => { state.color = c.v; document.querySelectorAll('.sig-dialog .sig-colors.ink .sig-color').forEach((x) => { const on = x.title === c.l; x.classList.toggle('on', on); x.setAttribute('aria-checked', String(on)); }); redrawPad(); renderTyped(); },
    })));
    g.classList.add('ink');
    return g;
  };

  // scritta
  const textInput = h('input', { type: 'text', class: 'sig-text', value: testoIniziale(), placeholder: 'Nome e cognome', maxlength: 80, 'aria-label': 'Testo della firma' });
  const fontList = h('div', { class: 'sig-fonts', role: 'radiogroup', 'aria-label': 'Stile della scrittura' });
  const renderTyped = () => {
    fontList.textContent = '';
    for (const f of fonts) {
      fontList.append(h('button', { type: 'button', role: 'radio', 'aria-checked': String(f === state.font), class: 'sig-font' + (f === state.font ? ' on' : ''), style: { fontFamily: `"${f}", cursive`, color: state.color }, onclick: () => { state.font = f; renderTyped(); } }, textInput.value || 'Firma'));
    }
  };
  textInput.addEventListener('input', renderTyped);

  const foto = fotoPanel(app, { colori: COLORS, colore: state.color });
  const panels = {
    draw: h('div', { class: 'sig-panel' }, h('div', { class: 'sig-pad-wrap' }, pad, line, hint), h('div', { class: 'sig-row' }, colorGroup(), h('button', { type: 'button', class: 'btn small', onclick: () => { state.strokes = []; redrawPad(); } }, 'Cancella'), h('button', { type: 'button', class: 'btn small', onclick: () => { state.strokes.pop(); redrawPad(); } }, 'Togli l\'ultimo tratto'))),
    type: h('div', { class: 'sig-panel', hidden: true }, textInput, fontList, h('div', { class: 'sig-row' }, colorGroup())),
    image: h('div', { class: 'sig-panel', hidden: true }, foto.el),
  };
  const tabs = h('div', { class: 'sig-tabs', role: 'tablist', 'aria-label': 'Come vuoi creare la firma' }, [['draw', 'Disegna'], ['type', 'Scrivi'], ['image', 'Foto o scansione']].map(([k, l]) => h('button', {
    type: 'button', role: 'tab', 'aria-selected': String(k === 'draw'), class: 'sig-tab' + (k === 'draw' ? ' on' : ''), 'data-tab': k,
    onclick: (e) => {
      state.tab = k;
      tabs.querySelectorAll('.sig-tab').forEach((t) => { t.classList.toggle('on', t === e.currentTarget); t.setAttribute('aria-selected', String(t === e.currentTarget)); });
      for (const [pk, p] of Object.entries(panels)) p.hidden = pk !== k;
      if (k === 'type') { renderTyped(); textInput.focus(); }
    },
  }, l)));

  // nome, tipo, proprietario
  const nomeDefault = () => {
    const chi = state.proprietario === 'io' ? '' : state.nomeProprietario;
    return state.kind === 'initials' ? (chi ? 'Sigla di ' + chi : 'La mia sigla') : (chi ? 'Firma di ' + chi : 'La mia firma');
  };
  let nomeToccato = false;
  const nomeInput = h('input', { type: 'text', value: nomeDefault(), maxlength: 80, oninput: () => { nomeToccato = true; } });
  const aggiornaNome = () => { if (!nomeToccato) nomeInput.value = nomeDefault(); };
  const tipo = h('div', { class: 'radio-group', role: 'radiogroup', 'aria-label': 'Tipo' }, [['signature', 'Firma'], ['initials', 'Sigla (iniziali)']].map(([v, l]) => h('label', { class: 'radio' }, h('input', { type: 'radio', name: 'sig-tipo', value: v, checked: v === kind, onchange: () => { state.kind = v; if (!textInput.dataset.toccato) textInput.value = testoIniziale(); aggiornaNome(); redrawPad(); renderTyped(); } }), h('span', {}, l))));
  textInput.addEventListener('input', () => { textInput.dataset.toccato = '1'; });
  const chiOut = h('span', { class: 'sig-owner-name' });
  const mostraChi = () => { chiOut.textContent = state.proprietario === 'io' ? 'Mia' : 'Di ' + (state.nomeProprietario || 'un\'altra persona'); };
  const chiBtn = scegliProprietario ? h('button', { type: 'button', class: 'btn small', onclick: async () => {
    const r = await scegliProprietario();
    if (!r) return;
    if (r === 'io') { state.proprietario = 'io'; state.nomeProprietario = ''; } else { state.proprietario = r.id; state.nomeProprietario = r.nome; }
    mostraChi(); aggiornaNome();
  } }, 'Cambia…') : null;
  mostraChi();
  const saveChk = h('input', { type: 'checkbox', checked: salva, id: 'sig-save' });
  const body = h('div', { class: 'sig-dialog' }, tabs, panels.draw, panels.type, panels.image,
    h('div', { class: 'sig-meta' },
      h('div', { class: 'field' }, h('label', {}, 'Nome'), nomeInput),
      h('div', { class: 'field' }, h('label', {}, 'Tipo'), tipo),
      h('div', { class: 'field' }, h('label', {}, 'Di chi è'), h('div', { class: 'sig-owner' }, chiOut, chiBtn))),
    h('label', { class: 'chk sig-save', for: 'sig-save' }, saveChk, 'Salva nell\'archivio personale (cifrato, resta solo su questo computer)'),
    h('p', { class: 'sig-note' }, NOTA_FIRMA_SEMPLICE + ' ', h('button', { type: 'button', class: 'link-btn', onclick: () => { app.tools.run('digital-sign'); } }, 'Firma digitale con certificato…')));
  redrawPad();

  const produce = () => {
    if (state.tab === 'draw') {
      if (!state.strokes.length) return { error: state.kind === 'initials' ? 'Disegna la sigla nel riquadro.' : 'Disegna la firma nel riquadro.' };
      const cv = document.createElement('canvas'); cv.width = W * 3; cv.height = H * 3;
      drawStrokes(cv.getContext('2d'), state.strokes, 3, state.color);
      const r = trimCanvas(cv, 8); return r && { ...r, origine: 'disegno' };
    }
    if (state.tab === 'type') {
      const t = textInput.value.trim(); if (!t) return { error: 'Scrivi il nome.' };
      const cv = document.createElement('canvas'); const ctx = cv.getContext('2d');
      const size = 120; ctx.font = `${size}px "${state.font}", cursive`;
      const m = ctx.measureText(t);
      cv.width = Math.ceil(m.width + size); cv.height = Math.ceil(size * 1.9);
      ctx.font = `${size}px "${state.font}", cursive`; ctx.fillStyle = state.color; ctx.textBaseline = 'middle';
      ctx.fillText(t, size / 2, cv.height / 2);
      const r = trimCanvas(cv, 8); return r && { ...r, origine: 'scritta' };
    }
    const r = foto.produce();
    return r?.error ? r : r && { ...r, origine: 'foto' };
  };

  let result = null;
  const v = await dialog({
    title: kind === 'initials' ? 'Crea una sigla' : 'Crea una firma', body, okLabel: 'Usa questa firma', width: 660,
    validate: () => { const r = produce(); if (!r) return 'Non c\'è niente da salvare.'; if (r.error) return r.error; result = r; return null; },
  });
  return v && result ? { ...result, kind: state.kind, save: saveChk.checked, nome: nomeInput.value.trim() || nomeDefault(), proprietario: state.proprietario } : null;
}
