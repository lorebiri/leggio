// Pannello «Foto o scansione»: firma o timbro su carta → immagine con sfondo trasparente.
// Rimozione automatica di sfondo e colore della carta (lib/foto.js), sensibilità regolabile, rotazione,
// ritaglio (automatico o trascinando il riquadro, anche da tastiera) e colore dell'inchiostro.
import { pulisciFoto, hexRgb } from './lib/foto.js';
import { opaqueBounds } from './lib/geom.js';

const MAX_LATO = 1600;
const PV_W = 540; const PV_H = 230;

/**
 * → { el, produce(): { dataUrl, w, h } | { error } | null }
 * opts: { colori: [{v,l}], colore: '#…' | 'originale', testo }
 */
export function fotoPanel(app, { colori = [{ v: '#111111', l: 'Nero' }, { v: '#1d3f9a', l: 'Blu' }], colore = '#111111', testo = 'Scegli la foto o la scansione della firma su carta: lo sfondo e il colore della carta vengono tolti da soli.' } = {}) {
  const { h } = app.ui;
  const st = { orig: null, rot: 0, sens: 0.5, colore, crop: null, lavorata: null };
  const prev = h('canvas', { class: 'foto-prev', width: PV_W, height: PV_H, 'aria-label': 'Anteprima: il riquadro tratteggiato è il ritaglio. Trascinalo o usa le frecce (Maiuscole + frecce per ridimensionare).', tabindex: '0' });
  const pctx = prev.getContext('2d');
  const msg = h('p', { class: 'muted foto-msg' }, testo);
  const sens = h('input', { type: 'range', min: 0, max: 100, value: 50, 'aria-label': 'Sensibilità', oninput: () => { st.sens = sens.value / 100; ricalcola(); } });
  const coloreSel = h('div', { class: 'sig-colors', role: 'radiogroup', 'aria-label': 'Colore dell\'inchiostro' },
    [...colori, { v: 'originale', l: 'Colore originale' }].map((c) => h('button', {
      type: 'button', role: 'radio', 'aria-checked': String(c.v === st.colore), class: 'sig-color' + (c.v === 'originale' ? ' orig' : '') + (c.v === st.colore ? ' on' : ''), title: c.l, 'aria-label': c.l,
      style: c.v === 'originale' ? null : { background: c.v },
      onclick: (e) => { st.colore = c.v; coloreSel.querySelectorAll('.sig-color').forEach((b) => { b.classList.toggle('on', b === e.currentTarget); b.setAttribute('aria-checked', String(b === e.currentTarget)); }); ricalcola(); },
    }, c.v === 'originale' ? 'A' : '')));
  const strumenti = h('div', { class: 'foto-tools', hidden: true },
    h('label', { class: 'foto-sens' }, 'Sensibilità', sens),
    coloreSel,
    h('button', { type: 'button', class: 'btn small', onclick: () => { st.rot = (st.rot + 90) % 360; st.crop = null; ricalcola(); } }, '↻ Ruota'),
    h('button', { type: 'button', class: 'btn small', onclick: () => { st.crop = null; ricalcola(); } }, 'Ritaglio automatico'));
  const pick = h('button', { type: 'button', class: 'btn', onclick: () => scegli() }, 'Scegli foto o scansione…');
  const el = h('div', { class: 'foto-panel' }, h('div', { class: 'sig-row' }, pick), msg, h('div', { class: 'foto-wrap', hidden: true }, prev), strumenti);

  async function scegli() {
    try {
      const files = await app.platform.openFiles({ filters: [{ name: 'Immagini', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif', 'heic'] }], raw: true, title: 'Scegli la foto o la scansione' });
      const f = files?.[0]; if (!f) return;
      if (f.bytes.length > 40 * 1024 * 1024) throw new Error('L\'immagine è troppo grande (oltre 40 MB).');
      const ext = (f.name.split('.').pop() || 'png').toLowerCase();
      const bmp = await createImageBitmap(new Blob([f.bytes], { type: ext === 'jpg' ? 'image/jpeg' : 'image/' + ext })).catch(() => { throw new Error('Immagine non leggibile. Usa un file JPG o PNG (le foto HEIC dell\'iPhone vanno prima convertite).'); });
      const s = Math.min(1, MAX_LATO / Math.max(bmp.width, bmp.height));
      const cv = document.createElement('canvas'); cv.width = Math.max(2, Math.round(bmp.width * s)); cv.height = Math.max(2, Math.round(bmp.height * s));
      cv.getContext('2d').drawImage(bmp, 0, 0, cv.width, cv.height); bmp.close?.();
      st.orig = cv; st.rot = 0; st.crop = null;
      el.querySelector('.foto-wrap').hidden = false; strumenti.hidden = false;
      msg.textContent = 'Controlla l\'anteprima: regola la sensibilità se mancano pezzi o resta sporco; trascina il riquadro per ritagliare.';
      ricalcola();
    } catch (err) { app.ui.toast(err.message || String(err), { kind: 'error' }); }
  }

  let timer = null;
  function ricalcola() { clearTimeout(timer); timer = setTimeout(elabora, 30); }
  function elabora() {
    if (!st.orig) return;
    const o = st.orig; const r = st.rot;
    const cv = document.createElement('canvas');
    cv.width = r % 180 ? o.height : o.width; cv.height = r % 180 ? o.width : o.height;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.translate(cv.width / 2, cv.height / 2); ctx.rotate((r * Math.PI) / 180); ctx.drawImage(o, -o.width / 2, -o.height / 2);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const img = ctx.getImageData(0, 0, cv.width, cv.height);
    pulisciFoto(img.data, cv.width, cv.height, { sensibilita: st.sens, inchiostro: st.colore === 'originale' ? null : hexRgb(st.colore) });
    ctx.putImageData(img, 0, 0);
    st.lavorata = cv;
    if (!st.crop) {
      const b = opaqueBounds(img.data, cv.width, cv.height, 40);
      const m = Math.round(Math.max(cv.width, cv.height) * 0.01);
      st.crop = b ? { x: Math.max(0, b.x - m), y: Math.max(0, b.y - m), w: Math.min(cv.width, b.w + 2 * m), h: Math.min(cv.height, b.h + 2 * m) } : { x: 0, y: 0, w: cv.width, h: cv.height };
      st.crop.w = Math.min(st.crop.w, cv.width - st.crop.x); st.crop.h = Math.min(st.crop.h, cv.height - st.crop.y);
    }
    disegna();
  }
  const scala = () => Math.min(PV_W / st.lavorata.width, PV_H / st.lavorata.height);
  const offset = () => { const s = scala(); return { ox: (PV_W - st.lavorata.width * s) / 2, oy: (PV_H - st.lavorata.height * s) / 2, s }; };
  function disegna() {
    const cv = st.lavorata; if (!cv) return;
    pctx.clearRect(0, 0, PV_W, PV_H);
    // scacchiera: si vede che lo sfondo è trasparente
    for (let y = 0; y < PV_H; y += 10) for (let x = 0; x < PV_W; x += 10) { pctx.fillStyle = (x + y) / 10 % 2 ? '#f2f2f2' : '#ffffff'; pctx.fillRect(x, y, 10, 10); }
    const { ox, oy, s } = offset();
    pctx.drawImage(cv, ox, oy, cv.width * s, cv.height * s);
    const c = st.crop;
    pctx.save(); pctx.fillStyle = 'rgba(0,0,0,0.25)';
    pctx.fillRect(0, 0, PV_W, oy + c.y * s); pctx.fillRect(0, oy + (c.y + c.h) * s, PV_W, PV_H);
    pctx.fillRect(0, oy + c.y * s, ox + c.x * s, c.h * s); pctx.fillRect(ox + (c.x + c.w) * s, oy + c.y * s, PV_W, c.h * s);
    pctx.setLineDash([5, 4]); pctx.strokeStyle = '#0a66c2'; pctx.lineWidth = 1.5;
    pctx.strokeRect(ox + c.x * s + 0.5, oy + c.y * s + 0.5, c.w * s, c.h * s);
    pctx.setLineDash([]); pctx.fillStyle = '#0a66c2';
    for (const [hx, hy] of [[c.x, c.y], [c.x + c.w, c.y], [c.x, c.y + c.h], [c.x + c.w, c.y + c.h]]) pctx.fillRect(ox + hx * s - 4, oy + hy * s - 4, 8, 8);
    pctx.restore();
  }
  // ritaglio col puntatore
  let drag = null;
  const pt = (e) => { const r = prev.getBoundingClientRect(); const { ox, oy, s } = offset(); return { x: ((e.clientX - r.left) * (PV_W / r.width) - ox) / s, y: ((e.clientY - r.top) * (PV_H / r.height) - oy) / s }; };
  prev.addEventListener('pointerdown', (e) => {
    if (!st.lavorata) return;
    e.preventDefault(); prev.setPointerCapture(e.pointerId); prev.focus();
    const p = pt(e); const c = st.crop; const tol = 10 / scala();
    const near = (a, b) => Math.abs(a - b) < tol;
    const edge = { l: near(p.x, c.x), r: near(p.x, c.x + c.w), t: near(p.y, c.y), b: near(p.y, c.y + c.h) };
    if ((edge.l || edge.r) && (edge.t || edge.b)) drag = { mode: 'resize', edge, start: p, c0: { ...c } };
    else if (p.x > c.x && p.x < c.x + c.w && p.y > c.y && p.y < c.y + c.h) drag = { mode: 'move', start: p, c0: { ...c } };
    else drag = { mode: 'new', start: p, c0: { ...c } };
  });
  prev.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const p = pt(e); const W = st.lavorata.width; const H = st.lavorata.height;
    const cl = (v, a, b) => Math.max(a, Math.min(b, v));
    const dx = p.x - drag.start.x; const dy = p.y - drag.start.y; const c0 = drag.c0;
    let c;
    if (drag.mode === 'move') c = { x: cl(c0.x + dx, 0, W - c0.w), y: cl(c0.y + dy, 0, H - c0.h), w: c0.w, h: c0.h };
    else if (drag.mode === 'new') { const x1 = cl(Math.min(drag.start.x, p.x), 0, W); const y1 = cl(Math.min(drag.start.y, p.y), 0, H); c = { x: x1, y: y1, w: cl(Math.abs(dx), 4, W - x1), h: cl(Math.abs(dy), 4, H - y1) }; }
    else {
      let x1 = c0.x; let y1 = c0.y; let x2 = c0.x + c0.w; let y2 = c0.y + c0.h;
      if (drag.edge.l) x1 = cl(p.x, 0, x2 - 4); if (drag.edge.r) x2 = cl(p.x, x1 + 4, W);
      if (drag.edge.t) y1 = cl(p.y, 0, y2 - 4); if (drag.edge.b) y2 = cl(p.y, y1 + 4, H);
      c = { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
    }
    st.crop = c; disegna();
  });
  const fine = () => { drag = null; };
  prev.addEventListener('pointerup', fine); prev.addEventListener('pointercancel', fine);
  prev.addEventListener('keydown', (e) => {
    if (!st.lavorata || !/^Arrow/.test(e.key)) return;
    e.preventDefault(); e.stopPropagation();
    const step = Math.max(2, Math.round(Math.max(st.lavorata.width, st.lavorata.height) / 100)) * (e.altKey ? 5 : 1);
    const c = { ...st.crop }; const W = st.lavorata.width; const H = st.lavorata.height;
    const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    if (e.shiftKey) { c.w = Math.max(8, Math.min(W - c.x, c.w + d[0])); c.h = Math.max(8, Math.min(H - c.y, c.h + d[1])); }
    else { c.x = Math.max(0, Math.min(W - c.w, c.x + d[0])); c.y = Math.max(0, Math.min(H - c.h, c.y + d[1])); }
    st.crop = c; disegna();
  });

  return {
    el,
    produce() {
      if (!st.lavorata) return { error: 'Scegli un\'immagine.' };
      const c = st.crop; const x = Math.round(c.x); const y = Math.round(c.y); const w = Math.max(1, Math.round(c.w)); const hh = Math.max(1, Math.round(c.h));
      const src = st.lavorata.getContext('2d', { willReadFrequently: true }).getImageData(x, y, w, hh);
      const b = opaqueBounds(src.data, w, hh, 8);
      if (!b) return { error: 'Nel riquadro non si vede nessun tratto: prova ad aumentare la sensibilità o usa una foto più contrastata.' };
      const pad = 4;
      const out = document.createElement('canvas'); out.width = b.w + pad * 2; out.height = b.h + pad * 2;
      out.getContext('2d').putImageData(st.lavorata.getContext('2d').getImageData(x + b.x, y + b.y, b.w, b.h), pad, pad);
      return { dataUrl: out.toDataURL('image/png'), w: out.width, h: out.height };
    },
  };
}
