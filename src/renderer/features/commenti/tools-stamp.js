// Area «commenti» — Timbri: predefiniti in italiano, personalizzati con campi automatici
// ({data} {ora} {anno} {autore} {numero}), da immagine; timbro su più file nella stessa posizione.
import { STAMPS, stampSize, safeText } from './appearance.js';
import { createAnnot, getFonts } from './annots.js';
import { fillStampFields, hexToRgb, rgbToHex, normRect } from './geom.js';
import { S, setS, author, edit, overlayOf, eventPoint, previewSvg, svgEl } from './ui-common.js';

const approxFont = { widthOfTextAtSize: (s, fs) => String(s).length * fs * 0.62 }; // stima per l'anteprima

/** Elenco completo: personalizzati (in cima) + predefiniti. */
export function allStamps(app) {
  const custom = S(app, 'stamps', []).filter((s) => s && s.id && (s.label || s.image));
  return [...custom.map((s) => ({ ...s, custom: true, color: Array.isArray(s.color) ? s.color : hexToRgb(s.color || '#1c5bb3') })), ...STAMPS];
}
const currentStamp = (app) => { const all = allStamps(app); return all.find((s) => s.id === S(app, 'stamp.current', 'ricevuto')) || all[0]; };

/** Testi del timbro con i campi compilati. Il numero avanza a ogni uso se il timbro lo contiene. */
export function resolveStamp(app, st, who, { consume = true } = {}) {
  const usesNumber = /\{numero\}/i.test((st.label || '') + (st.sub || ''));
  const counters = S(app, 'stampCounters', {});
  const number = counters[st.id] ?? 1;
  if (usesNumber && consume) setS(app, 'stampCounters', { ...counters, [st.id]: number + 1 });
  const data = { author: who, number };
  const withMeta = S(app, 'stamp.meta', false) && !st.sub;
  return { label: fillStampFields(st.label, data), sub: withMeta ? fillStampFields('{autore} · {data} {ora}', data) : fillStampFields(st.sub || '', data), color: st.color, usesNumber, number };
}

function dataUrlBytes(url) {
  const [head, b64] = String(url).split(',');
  const bin = atob(b64 || '');
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return { bytes: out, type: /jpe?g/i.test(head) ? 'jpg' : 'png' };
}

/** Scrive un timbro centrato in (cx, cy) PDF sulla pagina. size: 0.6..2 */
export async function placeStamp(pdfDoc, pageIndex, st, resolved, { cx, cy, size = 1, rect, who }) {
  if (st.image) {
    const { bytes, type } = dataUrlBytes(st.image);
    const w = (st.w || 120) * size, h = (st.h || 120) * size;
    return createAnnot(pdfDoc, pageIndex, { type: 'Stamp', rect: rect || [cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2], icon: 'Leggio.Immagine', text: st.label || 'Timbro', subject: 'Timbro' }, { author: who, imageBytes: bytes, imageType: type });
  }
  const { bold } = await getFonts(pdfDoc);
  const { w, h } = stampSize(safeText(bold, resolved.label), resolved.sub ? safeText(bold, resolved.sub) : '', bold);
  const W = w * size, Hh = h * size;
  const r = rect || [cx - W / 2, cy - Hh / 2, cx + W / 2, cy + Hh / 2];
  return createAnnot(pdfDoc, pageIndex, { type: 'Stamp', rect: r, stamp: resolved, icon: st.name || 'Leggio.Personalizzato', text: [resolved.label, resolved.sub].filter(Boolean).join(' — '), subject: 'Timbro' }, { author: who });
}

/** Finestra per creare/modificare un timbro personalizzato. */
async function editCustomStamp(app, existing) {
  const H = app.ui.h;
  const v = await app.ui.dialog({
    title: existing ? 'Modifica timbro' : 'Nuovo timbro personalizzato', width: 520,
    fields: [
      { name: 'label', label: 'Testo principale', value: existing?.label || '', placeholder: 'es. VISTO SI LIQUIDI', required: true },
      { name: 'sub', label: 'Seconda riga (facoltativa)', value: existing?.sub || '', placeholder: 'es. il {data} · mandato n. {numero}' },
      { name: 'info', type: 'info', html: 'Campi automatici: <b>{data}</b> data di oggi, <b>{ora}</b>, <b>{anno}</b>, <b>{autore}</b> il tuo nome, <b>{numero}</b> numero progressivo che avanza da solo a ogni timbro.' },
      { name: 'color', label: 'Colore', type: 'color', value: existing ? rgbToHex(existing.color) : '#1c5bb3' },
      { name: 'number', label: 'Prossimo numero (se usi {numero})', type: 'number', min: 0, step: 1, value: S(app, 'stampCounters', {})[existing?.id] ?? 1 },
    ],
    okLabel: 'Salva timbro',
    validate: (x) => (x.label.trim().length > 60 ? 'Testo troppo lungo (massimo 60 caratteri).' : null),
  });
  if (!v) return null;
  const id = existing?.id || 'c-' + Date.now().toString(36);
  const st = { id, label: v.label.trim().toUpperCase() === v.label.trim() ? v.label.trim() : v.label.trim(), sub: v.sub.trim(), color: v.color };
  const list = S(app, 'stamps', []).filter((s) => s.id !== id);
  setS(app, 'stamps', [st, ...list]);
  if (Number.isInteger(v.number) && v.number >= 0) setS(app, 'stampCounters', { ...S(app, 'stampCounters', {}), [id]: v.number });
  setS(app, 'stamp.current', id);
  void H;
  return st;
}

/** Timbro da immagine (es. il timbro tondo dell'istituto scansionato), ridotto e salvato nella raccolta. */
async function imageStamp(app) {
  const files = await app.platform.openFiles({ multiple: false, filters: [{ name: 'Immagini', extensions: ['png', 'jpg', 'jpeg'] }] });
  const f = files?.[0]; if (!f) return null;
  if (f.bytes.length > 15 * 1024 * 1024) { app.ui.toast('Immagine troppo grande (massimo 15 MB)', { kind: 'error' }); return null; }
  const blob = new Blob([f.bytes]);
  let bmp;
  try { bmp = await createImageBitmap(blob); } catch { app.ui.toast('Formato immagine non riconosciuto: usa PNG o JPG', { kind: 'error' }); return null; }
  // riduzione a max 600 px e sfondo bianco reso trasparente (timbri scansionati)
  const k = Math.min(1, 600 / Math.max(bmp.width, bmp.height));
  const cv = Object.assign(document.createElement('canvas'), { width: Math.round(bmp.width * k), height: Math.round(bmp.height * k) });
  const ctx = cv.getContext('2d'); ctx.drawImage(bmp, 0, 0, cv.width, cv.height);
  const img = ctx.getImageData(0, 0, cv.width, cv.height);
  for (let i = 0; i < img.data.length; i += 4) { const m = Math.min(img.data[i], img.data[i + 1], img.data[i + 2]); if (m > 235) img.data[i + 3] = Math.max(0, 255 - (m - 235) * 12); }
  ctx.putImageData(img, 0, 0);
  const url = cv.toDataURL('image/png');
  if (url.length > 1.5e6) { app.ui.toast('Immagine troppo dettagliata per la raccolta: riducila e riprova', { kind: 'error' }); return null; }
  const name = await app.ui.prompt('Nome del timbro:', f.name.replace(/\.\w+$/, ''), { title: 'Timbro da immagine', okLabel: 'Salva' });
  if (name == null) return null;
  const ratio = cv.height / cv.width;
  const st = { id: 'i-' + Date.now().toString(36), label: name || 'Timbro', image: url, w: 120, h: Math.round(120 * ratio) };
  setS(app, 'stamps', [st, ...S(app, 'stamps', [])]);
  setS(app, 'stamp.current', st.id);
  return st;
}

export function stampTool(app) {
  let cleanup = null;
  return {
    id: 'stamp', name: 'Timbro', category: 'commenta', icon: 'stamp', quick: true, quickOrder: 25,
    description: 'Timbri pronti in italiano (RICEVUTO, PAGATO, VISTO SI LIQUIDI…) e timbri tuoi con data, nome e numero automatici.',
    keywords: 'timbro timbri stamp ricevuto pagato visto si liquidi registrato approvato bozza riservato confidenziale protocollo numero data timbro personalizzato immagine',
    interactive: {
      activate(_, opts) {
        const H = app.ui.h;
        const render = () => {
          opts.innerHTML = '';
          const cur = currentStamp(app);
          const sel = H('select', { 'aria-label': 'Timbro', class: 'lg-stamp-select' },
            H('optgroup', { label: 'I miei timbri' }, allStamps(app).filter((s) => s.custom).map((s) => H('option', { value: s.id, selected: s.id === cur.id }, s.label + (s.image ? ' (immagine)' : '')))),
            H('optgroup', { label: 'Predefiniti' }, STAMPS.map((s) => H('option', { value: s.id, selected: s.id === cur.id }, s.label + (s.sub ? ' · ' + s.sub.replace(/\{(\w+)\}/g, '…') : '')))));
          sel.addEventListener('change', () => { setS(app, 'stamp.current', sel.value); render(); });
          opts.append(H('label', { class: 'lg-opt' }, H('span', {}, 'Timbro'), sel));
          const sz = H('select', { 'aria-label': 'Dimensione' }, [['0.7', 'Piccolo'], ['1', 'Medio'], ['1.4', 'Grande']].map(([v, l]) => H('option', { value: v, selected: String(S(app, 'stamp.size', 1)) === v }, l)));
          sz.addEventListener('change', () => setS(app, 'stamp.size', +sz.value));
          opts.append(H('label', { class: 'lg-opt' }, H('span', {}, 'Dimensione'), sz));
          if (!cur.sub && !cur.image) {
            const meta = H('input', { type: 'checkbox', checked: S(app, 'stamp.meta', false) });
            meta.addEventListener('change', () => setS(app, 'stamp.meta', meta.checked));
            opts.append(H('label', { class: 'lg-opt' }, meta, H('span', {}, 'Aggiungi nome e data')));
          }
          if (/\{numero\}/i.test((cur.label || '') + (cur.sub || ''))) {
            const num = H('input', { type: 'number', min: 0, step: 1, value: S(app, 'stampCounters', {})[cur.id] ?? 1, style: { width: '80px' }, 'aria-label': 'Prossimo numero' });
            num.addEventListener('change', () => { const n = parseInt(num.value, 10); if (n >= 0) setS(app, 'stampCounters', { ...S(app, 'stampCounters', {}), [cur.id]: n }); });
            opts.append(H('label', { class: 'lg-opt' }, H('span', {}, 'Prossimo n.'), num));
          }
          opts.append(
            H('button', { class: 'btn small', onclick: async () => { if (await editCustomStamp(app)) render(); } }, 'Nuovo timbro…'),
            H('button', { class: 'btn small', onclick: async () => { if (await imageStamp(app)) render(); } }, 'Da immagine…'),
            cur.custom ? H('button', { class: 'btn small', onclick: async () => { if (cur.image) return app.ui.toast('I timbri da immagine si possono solo eliminare'); if (await editCustomStamp(app, cur)) render(); } }, 'Modifica') : null,
            cur.custom ? H('button', { class: 'btn small', onclick: async () => { if (!(await app.ui.confirm(`Eliminare il timbro «${cur.label}» dalla tua raccolta? I timbri già messi nei documenti restano.`, { okLabel: 'Elimina', danger: true }))) return; setS(app, 'stamps', S(app, 'stamps', []).filter((s) => s.id !== cur.id)); setS(app, 'stamp.current', 'ricevuto'); render(); } }, 'Elimina') : null,
            H('span', { class: 'lg-hint' }, 'Clic sulla pagina per timbrare.'));
        };
        render();
        app.viewer.setMode('tool', 'copy');
        const c = app.viewer.container;
        let ghost = null;
        const onMove = (e) => {
          const ov = overlayOf(e.target);
          if (!ov) { ghost?.remove(); ghost = null; return; }
          const p = eventPoint(app, ov, e);
          const st = currentStamp(app);
          const size = S(app, 'stamp.size', 1) * app.viewer.scale;
          const w = (st.image ? st.w : stampSize(st.label, st.sub, approxFont).w) * size, hh = (st.image ? st.h : (st.sub ? 58 : 44)) * size;
          if (!ghost || ghost.ownerSVGElement?.parentNode !== ov) { ghost?.remove(); ghost = svgEl('rect', { class: 'lg-ghost lg-stamp-ghost', rx: 6, fill: 'none', stroke: rgbToHex(st.color || [0.1, 0.3, 0.7]) || '#1c5bb3', 'stroke-width': 2, 'stroke-dasharray': '5 3' }); previewSvg(ov).append(ghost); }
          Object.entries({ x: p.x - w / 2, y: p.y - hh / 2, width: w, height: hh }).forEach(([k, v]) => ghost.setAttribute(k, v));
        };
        const onDown = async (e) => {
          const ov = overlayOf(e.target); if (!ov || e.button !== 0) return;
          e.preventDefault();
          const p = eventPoint(app, ov, e);
          const pi = +ov.dataset.pageIndex;
          const st = currentStamp(app);
          const who = await author(app);
          const resolved = resolveStamp(app, st, who);
          const size = S(app, 'stamp.size', 1);
          const ok = await edit(app, 'Timbro «' + (resolved.label || st.label) + '» aggiunto', (pdfDoc) => placeStamp(pdfDoc, pi, st, resolved, { cx: p.px, cy: p.py, size, who }));
          if (ok) setS(app, 'stamp.last', { id: st.id, pageIndex: pi, cx: p.px, cy: p.py, size });
          if (ok && app.docs.length > 1) app.ui.toast('Timbro aggiunto', { kind: 'success', timeout: 8000, action: { label: 'Timbra anche gli altri documenti aperti', run: () => stampOpenDocs(app) } });
          render();
        };
        c.addEventListener('pointermove', onMove);
        c.addEventListener('pointerdown', onDown);
        cleanup = () => { c.removeEventListener('pointermove', onMove); c.removeEventListener('pointerdown', onDown); ghost?.remove(); };
      },
      deactivate() { cleanup?.(); cleanup = null; },
    },
  };
}

/** Stesso timbro, stessa posizione, su tutti gli altri documenti aperti (ognuno annullabile). */
export async function stampOpenDocs(app) {
  const last = S(app, 'stamp.last', null);
  if (!last) return app.ui.toast('Metti prima un timbro su un documento', { kind: 'warning' });
  const st = allStamps(app).find((s) => s.id === last.id);
  if (!st) return;
  const who = await author(app);
  const current = app.activeDoc;
  let n = 0;
  for (const d of app.docs) {
    if (d === current) continue;
    const pi = Math.min(last.pageIndex, d.pageCount - 1);
    const resolved = resolveStamp(app, st, who);
    try { await app.editWithPdfLib('Timbro «' + resolved.label + '» aggiunto', (pdfDoc) => placeStamp(pdfDoc, pi, st, resolved, { ...last, who }), d); n++; }
    catch (err) { app.reportError(err, `Timbro non applicato a «${d.name}»`); }
  }
  app.ui.toast(`Timbro applicato ad altri ${n} documenti`, { kind: 'success' });
}

/** «Timbra più file»: sceglie i file, timbra nella posizione dell'ultimo timbro (o in alto a destra) e salva copie *_timbrato.pdf. */
export function stampBatchTool(app) {
  return {
    id: 'stamp-batch', name: 'Timbra più file', category: 'commenta', icon: 'stamp', needsDoc: false,
    description: 'Lo stesso timbro nella stessa posizione su molti PDF; crea copie «_timbrato» senza toccare gli originali.',
    keywords: 'timbro più file cartella tutti i pdf batch in blocco pagato ricevuto azione guidata',
    async run() {
      const stamps = allStamps(app);
      const last = S(app, 'stamp.last', null);
      const v = await app.ui.dialog({
        title: 'Timbra più file', width: 520,
        fields: [
          { name: 'stamp', label: 'Timbro', type: 'select', value: last?.id || stamps[0].id, options: stamps.map((s) => ({ value: s.id, label: s.label })) },
          { name: 'pos', label: 'Posizione', type: 'select', value: last ? 'last' : 'tr', options: [...(last ? [{ value: 'last', label: 'Come l\'ultimo timbro messo' }] : []), { value: 'tr', label: 'In alto a destra' }, { value: 'tl', label: 'In alto a sinistra' }, { value: 'br', label: 'In basso a destra' }, { value: 'c', label: 'Al centro' }] },
          { name: 'pages', label: 'Pagine', type: 'select', value: 'first', options: [{ value: 'first', label: 'Solo la prima' }, { value: 'all', label: 'Tutte' }, { value: 'last', label: 'Solo l\'ultima' }] },
          { name: 'info', type: 'info', text: 'Gli originali non vengono modificati: per ogni file viene salvata una copia con «_timbrato» nel nome.' },
        ],
        okLabel: 'Scegli i file…',
      });
      if (!v) return;
      const files = await app.platform.openFiles({ multiple: true, filters: [{ name: 'PDF', extensions: ['pdf'] }] });
      if (!files?.length) return;
      const folder = await app.platform.chooseFolder('Dove salvare le copie timbrate?');
      if (!folder) return;
      const st = stamps.find((s) => s.id === v.stamp);
      const who = await author(app);
      let ok = 0; const errors = [];
      await app.ui.withProgress('Timbro dei file', async (p) => {
        for (let i = 0; i < files.length; i++) {
          if (p.cancelled) break;
          const f = files[i];
          p.set(i / files.length, `${i + 1} di ${files.length}: ${f.name}`);
          try {
            const pdfDoc = await app.lib.openPdfLib(f.bytes);
            const n = pdfDoc.getPageCount();
            const pages = v.pages === 'all' ? [...Array(n).keys()] : v.pages === 'last' ? [n - 1] : [0];
            const resolved = resolveStamp(app, st, who);
            for (const pi of pages) {
              const pg = pdfDoc.getPage(pi); const { width: W, height: Hh } = pg.getSize();
              const m = 70;
              const pos = v.pos === 'last' && last ? { cx: last.cx, cy: last.cy, size: last.size } : { tr: { cx: W - m - 30, cy: Hh - m }, tl: { cx: m + 30, cy: Hh - m }, br: { cx: W - m - 30, cy: m }, c: { cx: W / 2, cy: Hh / 2 } }[v.pos];
              await placeStamp(pdfDoc, pi, st, resolved, { size: 1, ...pos, who });
            }
            const out = await app.lib.savePdfLib(pdfDoc);
            await app.platform.writeInFolder(folder, f.name.replace(/\.pdf$/i, '') + '_timbrato.pdf', out);
            ok++;
          } catch (err) { errors.push(`${f.name}: ${/encrypt|password/i.test(err?.message) ? 'protetto da password' : 'non leggibile'}`); }
        }
      });
      if (errors.length) app.ui.dialog({ title: 'Timbro dei file', message: `Timbrati ${ok} file su ${files.length}. Non riusciti:\n${errors.join('\n')}`, cancelLabel: null, okLabel: 'Chiudi' });
      else app.ui.toast(`Timbrati ${ok} file: copie «_timbrato» salvate`, { kind: 'success' });
    },
  };
}
export { normRect };
