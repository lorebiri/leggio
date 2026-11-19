// Timbri: disegno su tela (rettangolare, tondo con testo lungo il bordo, senza bordo), finestra per
// comporre il timbro dell'ente (testo o immagine caricata con lo sfondo tolto), elenco dei timbri salvati.
import { normalizzaSpec, righeTimbro, COLORI_TIMBRO, haData, nomeTimbro } from './lib/timbri.js';
import { todayIt } from './lib/geom.js';
import { fotoPanel } from './fotoui.js';
import { hexRgb, ricolora } from './lib/foto.js';

const PX = 4; // pixel per punto tipografico (immagine nitida anche ingrandita)
const FONT = 'Helvetica, Arial, "Liberation Sans", sans-serif';

/** Disegna una spec. → { dataUrl, w, h } con w,h in punti (dimensione naturale sulla pagina). */
export function disegnaTimbro(specIn, { oggi = todayIt() } = {}) {
  const s = normalizzaSpec(specIn);
  const righe = righeTimbro(s, oggi);
  const c = document.createElement('canvas'); const ctx = c.getContext('2d');
  const corpo = 14; // pt
  ctx.font = `bold ${corpo * PX}px ${FONT}`;
  let W; let H;
  if (s.forma === 'tondo') {
    const larg = Math.max(...righe.map((r) => ctx.measureText(r).width)) / PX;
    const diam = Math.max(96, larg + 46, righe.length * corpo * 1.25 + 56);
    W = H = diam;
  } else {
    const larg = Math.max(...righe.map((r) => ctx.measureText(r).width)) / PX;
    W = larg + 28; H = righe.length * corpo * 1.25 + 18;
  }
  // tela grande abbastanza per la rotazione
  const rad = (s.rotazione * Math.PI) / 180;
  const RW = Math.abs(W * Math.cos(rad)) + Math.abs(H * Math.sin(rad)) + 4;
  const RH = Math.abs(W * Math.sin(rad)) + Math.abs(H * Math.cos(rad)) + 4;
  c.width = Math.ceil(RW * PX); c.height = Math.ceil(RH * PX);
  ctx.scale(PX, PX);
  ctx.translate(RW / 2, RH / 2); ctx.rotate(rad);
  ctx.strokeStyle = s.colore; ctx.fillStyle = s.colore; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  if (s.forma === 'rettangolo') {
    ctx.lineWidth = 2.2; roundRect(ctx, -W / 2 + 1.5, -H / 2 + 1.5, W - 3, H - 3, 4); ctx.stroke();
    if (s.doppioBordo) { ctx.lineWidth = 0.9; roundRect(ctx, -W / 2 + 5, -H / 2 + 5, W - 10, H - 10, 2.5); ctx.stroke(); }
  } else if (s.forma === 'tondo') {
    const R = W / 2 - 1.5;
    ctx.lineWidth = 2.2; ctx.beginPath(); ctx.arc(0, 0, R, 0, Math.PI * 2); ctx.stroke();
    const inner = s.bordoTesto ? R - 19 : R - 5;
    ctx.lineWidth = 0.9; ctx.beginPath(); ctx.arc(0, 0, inner, 0, Math.PI * 2); ctx.stroke();
    if (s.bordoTesto) testoSuCerchio(ctx, s.bordoTesto, R - 10, 10);
  }
  ctx.font = `bold ${corpo}px ${FONT}`;
  const tot = righe.length * corpo * 1.25;
  righe.forEach((r, i) => {
    let size = corpo;
    const max = s.forma === 'tondo' ? (W / 2 - (s.bordoTesto ? 24 : 10)) * 2 * 0.92 : W - 16;
    ctx.font = `bold ${size}px ${FONT}`;
    while (ctx.measureText(r).width > max && size > 6) { size -= 0.5; ctx.font = `bold ${size}px ${FONT}`; }
    ctx.fillText(r, 0, -tot / 2 + corpo * 1.25 * (i + 0.5) + 0.5);
  });
  // leggera irregolarità dell'inchiostro: niente effetti, un timbro pulito si legge meglio
  return { dataUrl: c.toDataURL('image/png'), w: RW, h: RH };
}
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
/** Testo distribuito lungo tutto il cerchio (come i timbri tondi degli enti): parte dal basso e gira
 *  in senso orario, così si legge salendo a sinistra, in alto da sinistra a destra, scendendo a destra. */
function testoSuCerchio(ctx, testo, r, size) {
  const t = testo.trim().replace(/[\s•·-]+$/, '') + ' • ';
  let fs = size;
  ctx.font = `bold ${fs}px ${FONT}`;
  while (ctx.measureText(t).width > 2 * Math.PI * r * 0.97 && fs > 5) { fs -= 0.5; ctx.font = `bold ${fs}px ${FONT}`; }
  const larghezze = [...t].map((ch) => ctx.measureText(ch).width);
  const gap = (2 * Math.PI * r - larghezze.reduce((x, y) => x + y, 0)) / larghezze.length;
  let ang = Math.PI / 2; // in basso
  [...t].forEach((ch, i) => {
    const w = larghezze[i] + gap;
    const centro = ang + w / r / 2;
    ctx.save(); ctx.rotate(centro + Math.PI / 2); ctx.fillText(ch, 0, -r); ctx.restore();
    ang += w / r;
  });
}

/** Immagine di un timbro salvato o di un modello. → Promise<{ dataUrl, w, h }> */
export async function immagineTimbro(archivio, t) {
  if (t.spec && (t.tipo === 'testo' || !t.blob)) return disegnaTimbro(t.spec);
  const dataUrl = await archivio.immagine(t.blob);
  if (t.spec?.colore && t.ricolora) return { dataUrl: await ricoloraDataUrl(dataUrl, t.spec.colore), w: t.w, h: t.h };
  return { dataUrl, w: t.w || 120, h: t.h || 60 };
}
async function ricoloraDataUrl(u, colore) {
  const img = new Image(); img.src = u; await img.decode();
  const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
  const ctx = c.getContext('2d', { willReadFrequently: true }); ctx.drawImage(img, 0, 0);
  const d = ctx.getImageData(0, 0, c.width, c.height); ricolora(d.data, hexRgb(colore)); ctx.putImageData(d, 0, 0);
  return c.toDataURL('image/png');
}
/** Ruota un'immagine (PNG con trasparenza) di qualche grado. → { dataUrl, w, h } */
export async function ruotaImmagine(dataUrl, w, h, gradi) {
  if (!gradi) return { dataUrl, w, h };
  const img = new Image(); img.src = dataUrl; await img.decode();
  const rad = (gradi * Math.PI) / 180;
  const k = img.naturalWidth / (w || img.naturalWidth);
  const RW = Math.abs(w * Math.cos(rad)) + Math.abs(h * Math.sin(rad)); const RH = Math.abs(w * Math.sin(rad)) + Math.abs(h * Math.cos(rad));
  const c = document.createElement('canvas'); c.width = Math.ceil(RW * k); c.height = Math.ceil(RH * k);
  const ctx = c.getContext('2d'); ctx.translate(c.width / 2, c.height / 2); ctx.rotate(rad); ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
  return { dataUrl: c.toDataURL('image/png'), w: RW, h: RH };
}

/**
 * Finestra «Timbro dell'ente»: composto con il testo oppure da un'immagine caricata.
 * → timbro salvato nell'archivio | null
 */
export async function creaTimbroDialog(app, archivio, { iniziale = null } = {}) {
  const { h } = app.ui;
  const prof = archivio.profilo?.() || {};
  const st = normalizzaSpec(iniziale || { forma: 'tondo', bordoTesto: (prof.ente || '').toUpperCase(), righe: [(prof.ufficio || 'UFFICIO').toUpperCase()], colore: '#1d3f9a' });
  let scheda = 'testo';
  const prev = h('div', { class: 'tim-prev', 'aria-live': 'polite' });
  const aggiorna = () => {
    const spec = leggi();
    const r = disegnaTimbro(spec);
    prev.textContent = '';
    prev.append(h('img', { src: r.dataUrl, alt: 'Anteprima del timbro: ' + nomeTimbro(spec), style: { width: Math.min(260, r.w * 1.4) + 'px' } }));
  };
  const forma = h('div', { class: 'radio-group', role: 'radiogroup', 'aria-label': 'Forma' }, [['tondo', 'Tondo'], ['rettangolo', 'Rettangolare'], ['nessuna', 'Senza bordo']].map(([v, l]) => h('label', { class: 'radio' }, h('input', { type: 'radio', name: 'tim-forma', value: v, checked: st.forma === v, onchange: () => { bordo.closest('.field').hidden = v !== 'tondo'; aggiorna(); } }), h('span', {}, l))));
  const bordo = h('input', { type: 'text', value: st.bordoTesto, maxlength: 120, placeholder: 'es. COMUNE DI PRATO', oninput: aggiorna });
  const righe = h('textarea', { rows: 3, maxlength: 400, oninput: aggiorna }); righe.value = st.righe.join('\n');
  const colori = h('div', { class: 'sig-colors', role: 'radiogroup', 'aria-label': 'Colore' }, COLORI_TIMBRO.map((c) => h('button', { type: 'button', role: 'radio', 'aria-checked': String(c.v === st.colore), class: 'sig-color' + (c.v === st.colore ? ' on' : ''), title: c.l, 'aria-label': c.l, style: { background: c.v }, onclick: (e) => { colori.querySelectorAll('.sig-color').forEach((b) => { b.classList.toggle('on', b === e.currentTarget); b.setAttribute('aria-checked', String(b === e.currentTarget)); }); colori.dataset.v = c.v; aggiorna(); } })));
  colori.dataset.v = st.colore;
  const rot = h('input', { type: 'range', min: -30, max: 30, value: st.rotazione, 'aria-label': 'Rotazione in gradi', oninput: aggiorna });
  const doppio = h('input', { type: 'checkbox', checked: st.doppioBordo, onchange: aggiorna });
  const data = h('input', { type: 'checkbox', checked: st.data, onchange: aggiorna });
  const nome = h('input', { type: 'text', value: iniziale?.nome || 'Timbro dell\'ente', maxlength: 80 });
  function leggi() {
    return normalizzaSpec({ forma: forma.querySelector('input:checked')?.value, bordoTesto: bordo.value, righe: righe.value.split('\n'), colore: colori.dataset.v, rotazione: Number(rot.value), doppioBordo: doppio.checked, data: data.checked });
  }
  const campo = (label, input, extra = {}) => h('div', { class: 'field', ...extra }, h('label', {}, label), input);
  const pannelloTesto = h('div', { class: 'tim-panel' },
    h('div', { class: 'tim-cols' },
      h('div', { class: 'tim-form' },
        campo('Forma', forma),
        campo('Testo lungo il bordo', bordo, { hidden: st.forma !== 'tondo' }),
        campo('Righe al centro (una per riga; «[data]» = data di oggi)', righe),
        campo('Colore', colori),
        campo('Rotazione', rot),
        h('label', { class: 'chk' }, doppio, 'Doppio bordo'),
        h('label', { class: 'chk' }, data, 'Aggiungi la data di oggi')),
      prev));
  const foto = fotoPanel(app, { colori: COLORI_TIMBRO, colore: '#1d3f9a', testo: 'Scegli la scansione o la foto del timbro dell\'ente su carta bianca: lo sfondo viene tolto da solo.' });
  const pannelloFoto = h('div', { class: 'tim-panel', hidden: true }, foto.el);
  const tabs = h('div', { class: 'sig-tabs', role: 'tablist' }, [['testo', 'Componi con il testo'], ['foto', 'Da un\'immagine']].map(([k, l]) => h('button', {
    type: 'button', role: 'tab', class: 'sig-tab' + (k === scheda ? ' on' : ''), 'aria-selected': String(k === scheda),
    onclick: (e) => { scheda = k; tabs.querySelectorAll('.sig-tab').forEach((t) => { t.classList.toggle('on', t === e.currentTarget); t.setAttribute('aria-selected', String(t === e.currentTarget)); }); pannelloTesto.hidden = k !== 'testo'; pannelloFoto.hidden = k !== 'foto'; },
  }, l)));
  const body = h('div', { class: 'tim-dialog' }, tabs, pannelloTesto, pannelloFoto, campo('Nome del timbro', nome));
  aggiorna();
  let risultato = null;
  const ok = await app.ui.dialog({
    title: 'Timbro dell\'ente', body, okLabel: 'Salva il timbro', width: 680,
    validate: () => {
      if (scheda === 'foto') { const r = foto.produce(); if (r?.error) return r.error; risultato = { tipo: 'immagine', immagine: r.dataUrl, w: r.w / 4, h: r.h / 4 }; }
      else { const spec = leggi(); const r = disegnaTimbro(spec); risultato = haData(spec) ? { tipo: 'testo', spec, w: r.w, h: r.h } : { tipo: 'testo', spec, immagine: r.dataUrl, w: r.w, h: r.h }; }
      return null;
    },
  });
  if (!ok || !risultato) return null;
  // un timbro composto si ridisegna ogni volta (data aggiornata); l'immagine si salva solo per quelli caricati
  const t = await archivio.aggiungiTimbro({ nome: nome.value, tipo: risultato.tipo, immagine: risultato.tipo === 'immagine' ? risultato.immagine : null, w: risultato.w, h: risultato.h, spec: risultato.spec || null });
  app.ui.toast('Timbro salvato', { kind: 'success' });
  return t;
}
