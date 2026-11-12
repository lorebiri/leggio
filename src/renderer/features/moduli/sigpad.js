// Creazione della firma (o delle iniziali): disegnata, scritta con un carattere corsivo, o da immagine scansionata.
import { strokeWidths, smoothSegments, thinPoints, removeBackground, opaqueBounds, initialsOf } from './lib/geom.js';

const CURSIVE = [
  'Segoe Script', 'Lucida Handwriting', 'Ink Free', 'Freestyle Script', 'Brush Script MT', 'Mistral', 'Kristen ITC', 'Gabriola',
  'Snell Roundhand', 'Apple Chancery', 'Zapfino', 'Bradley Hand', 'Savoye LET', 'Noteworthy', 'Chalkboard SE', 'Marker Felt',
  'URW Chancery L', 'Z003', 'Comic Neue',
];
const COLORS = [{ v: '#111111', l: 'Nero' }, { v: '#1d3f9a', l: 'Blu' }];

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

/** Carica un file immagine in una tela, togliendo lo sfondo chiaro. */
async function imageFileToCanvas(bytes, mime) {
  const blob = new Blob([bytes], { type: mime || 'image/png' });
  const bmp = await createImageBitmap(blob).catch(() => { throw new Error('Immagine non leggibile. Usa un file PNG o JPG.'); });
  const maxSide = 1600; const s = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const cv = document.createElement('canvas'); cv.width = Math.max(1, Math.round(bmp.width * s)); cv.height = Math.max(1, Math.round(bmp.height * s));
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0, cv.width, cv.height);
  bmp.close?.();
  const data = ctx.getImageData(0, 0, cv.width, cv.height);
  removeBackground(data.data, cv.width, cv.height);
  ctx.putImageData(data, 0, 0);
  return cv;
}

/**
 * Dialogo «Crea firma». → { dataUrl, w, h, kind, save } | null
 * opts: { kind: 'signature'|'initials', name }
 */
export function createSignatureDialog(app, { kind = 'signature', name = '' } = {}) {
  const { h, dialog } = app.ui;
  const state = { tab: 'draw', color: COLORS[0].v, strokes: [], text: kind === 'initials' ? initialsOf(name) : name, font: null, image: null, kind };
  const fonts = availableCursiveFonts();
  state.font = fonts[0];

  const W = 560; const H = 200;
  const pad = h('canvas', { class: 'sig-pad', width: W * 2, height: H * 2, style: { width: W + 'px', height: H + 'px' }, 'aria-label': 'Area per disegnare la firma con il mouse, la penna o il dito' });
  const pctx = pad.getContext('2d');
  const redrawPad = () => { pctx.clearRect(0, 0, pad.width, pad.height); drawStrokes(pctx, state.strokes, 2, state.color); hint.hidden = state.strokes.length > 0; };
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
  const hint = h('div', { class: 'sig-hint' }, kind === 'initials' ? 'Scrivi qui le iniziali' : 'Firma qui con il mouse, la penna o il dito');
  const line = h('div', { class: 'sig-line' });

  const colorBtns = h('div', { class: 'sig-colors', role: 'radiogroup', 'aria-label': 'Colore' }, COLORS.map((c) => {
    const b = h('button', { type: 'button', class: 'sig-color' + (c.v === state.color ? ' on' : ''), title: c.l, 'aria-label': c.l, style: { background: c.v }, onclick: () => { state.color = c.v; colorBtns.querySelectorAll('.sig-color').forEach((x) => x.classList.toggle('on', x === b)); redrawPad(); renderTyped(); } });
    return b;
  }));

  // scritta
  const textInput = h('input', { type: 'text', class: 'sig-text', value: state.text, placeholder: kind === 'initials' ? 'Iniziali' : 'Nome e cognome', maxlength: 80 });
  const fontList = h('div', { class: 'sig-fonts', role: 'radiogroup', 'aria-label': 'Stile' });
  const renderTyped = () => {
    fontList.textContent = '';
    for (const f of fonts) {
      const b = h('button', { type: 'button', class: 'sig-font' + (f === state.font ? ' on' : ''), style: { fontFamily: `"${f}", cursive`, color: state.color }, onclick: () => { state.font = f; renderTyped(); } }, textInput.value || 'Firma');
      fontList.append(b);
    }
  };
  textInput.addEventListener('input', renderTyped);

  // immagine
  const imgPreview = h('div', { class: 'sig-imgprev' }, h('p', { class: 'muted' }, 'Scegli la foto o la scansione della firma su carta bianca: lo sfondo verrà tolto da solo.'));
  const pickBtn = h('button', { type: 'button', class: 'btn', onclick: async () => {
    try {
      const files = await app.platform.openFiles({ filters: [{ name: 'Immagini', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif'] }], raw: true, title: 'Scegli l\'immagine della firma' });
      const f = files?.[0]; if (!f) return;
      if (f.bytes.length > 25 * 1024 * 1024) throw new Error('L\'immagine è troppo grande (oltre 25 MB).');
      const ext = (f.name.split('.').pop() || 'png').toLowerCase();
      state.image = await imageFileToCanvas(f.bytes, ext === 'jpg' ? 'image/jpeg' : 'image/' + ext);
      imgPreview.textContent = '';
      state.image.className = 'sig-imgcanvas';
      imgPreview.append(state.image);
    } catch (err) { app.ui.toast(err.message || String(err), { kind: 'error' }); }
  } }, 'Scegli immagine…');

  const panels = {
    draw: h('div', { class: 'sig-panel' }, h('div', { class: 'sig-pad-wrap' }, pad, line, hint), h('div', { class: 'sig-row' }, colorBtns, h('button', { type: 'button', class: 'btn small', onclick: () => { state.strokes = []; redrawPad(); } }, 'Cancella'), h('button', { type: 'button', class: 'btn small', onclick: () => { state.strokes.pop(); redrawPad(); } }, 'Annulla tratto'))),
    type: h('div', { class: 'sig-panel', hidden: true }, textInput, fontList, h('div', { class: 'sig-row' }, colorBtns.cloneNode(false))),
    image: h('div', { class: 'sig-panel', hidden: true }, pickBtn, imgPreview),
  };
  // i pulsanti colore servono anche nella scheda «Scrivi»
  const colorBtns2 = panels.type.querySelector('.sig-colors');
  COLORS.forEach((c) => colorBtns2.append(h('button', { type: 'button', class: 'sig-color', title: c.l, 'aria-label': c.l, style: { background: c.v }, onclick: () => { state.color = c.v; renderTyped(); } })));
  const tabs = h('div', { class: 'sig-tabs', role: 'tablist' }, [['draw', 'Disegna'], ['type', 'Scrivi'], ['image', 'Immagine']].map(([k, l]) => h('button', { type: 'button', role: 'tab', class: 'sig-tab' + (k === 'draw' ? ' on' : ''), 'data-tab': k, onclick: (e) => {
    state.tab = k;
    tabs.querySelectorAll('.sig-tab').forEach((t) => t.classList.toggle('on', t === e.currentTarget));
    for (const [pk, p] of Object.entries(panels)) p.hidden = pk !== k;
    if (k === 'type') { renderTyped(); textInput.focus(); }
  } }, l)));
  const saveChk = h('input', { type: 'checkbox', checked: true, id: 'sig-save' });
  const body = h('div', { class: 'sig-dialog' }, tabs, panels.draw, panels.type, panels.image,
    h('label', { class: 'chk sig-save', for: 'sig-save' }, saveChk, 'Salva per usarla di nuovo (resta solo su questo computer)'),
    h('p', { class: 'sig-note' }, 'Questa è una firma grafica (un\'immagine): non è una firma digitale con valore legale. Per firmare con certificato usa «Usa un certificato».'));
  redrawPad();

  const produce = () => {
    if (state.tab === 'draw') {
      if (!state.strokes.length) return { error: 'Disegna la firma nel riquadro.' };
      const cv = document.createElement('canvas'); cv.width = W * 3; cv.height = H * 3;
      drawStrokes(cv.getContext('2d'), state.strokes, 3, state.color);
      return trimCanvas(cv, 8);
    }
    if (state.tab === 'type') {
      const t = textInput.value.trim(); if (!t) return { error: 'Scrivi il nome.' };
      const cv = document.createElement('canvas'); const ctx = cv.getContext('2d');
      const size = 120; ctx.font = `${size}px "${state.font}", cursive`;
      const m = ctx.measureText(t);
      cv.width = Math.ceil(m.width + size); cv.height = Math.ceil(size * 1.9);
      ctx.font = `${size}px "${state.font}", cursive`; ctx.fillStyle = state.color; ctx.textBaseline = 'middle';
      ctx.fillText(t, size / 2, cv.height / 2);
      return trimCanvas(cv, 8);
    }
    if (!state.image) return { error: 'Scegli un\'immagine.' };
    const r = trimCanvas(state.image, 4);
    return r || { error: 'Nell\'immagine non si vede nessuna firma: prova con una foto più contrastata.' };
  };

  let result = null;
  return dialog({
    title: kind === 'initials' ? 'Crea le iniziali' : 'Crea la firma', body, okLabel: 'Usa questa firma', width: 640,
    validate: () => { const r = produce(); if (!r) return 'Non c\'è niente da salvare.'; if (r.error) return r.error; result = r; return null; },
  }).then((v) => (v && result ? { ...result, kind, save: saveChk.checked } : null));
}
