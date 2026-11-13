// «Crea PDF dalla cartella delle scansioni»: osserva la cartella dove lo scanner/multifunzione salva le immagini
// e crea un PDF da quelle nuove. (L'acquisizione diretta dallo scanner non è possibile senza componenti aggiuntivi.)
import { chooseFolder, relist, isDesktop, apriRisultato } from '../native.js';
import { pdfDaImmagini, imageType } from '../lib/images.js';

const EXT = ['jpg', 'jpeg', 'png', 'webp', 'bmp', 'gif', 'tif', 'tiff', 'heic'];
const KEY = 'avanzati.scans';
const MAX_SHOW = 300;

export function openScans(app, deps) {
  const { h } = app.ui;
  const pane = deps.openPane(app, { title: 'Crea PDF dalla cartella delle scansioni', subtitle: 'Scegli la cartella in cui lo scanner salva le immagini: Leggio mostra quelle nuove e le unisce in un PDF.', id: 'scans' });
  const pref = app.settings.get(KEY, {});
  const state = { folder: null, label: '', items: [], sel: new Set(), urls: new Map(), timer: null };
  const info = h('div', { class: 'av-note' }, 'Nessuna cartella scelta.');
  const grid = h('div', { class: 'av-thumbs', role: 'listbox', 'aria-multiselectable': 'true', 'aria-label': 'Scansioni' });
  const formato = h('select', { 'aria-label': 'Formato delle pagine' }, h('option', { value: 'A4' }, 'Pagine A4 (consigliato)'), h('option', { value: 'immagine' }, 'Come le immagini (200 dpi)'));
  formato.value = pref.formato || 'A4';
  const ocr = h('input', { type: 'checkbox', id: 'av-sc-ocr', checked: pref.ocr !== false });
  const createBtn = h('button', { class: 'btn primary', onclick: () => crea() }, 'Crea PDF');
  const updateBtn = () => { createBtn.textContent = state.sel.size ? `Crea PDF con ${state.sel.size} ${state.sel.size === 1 ? 'immagine' : 'immagini'}` : 'Crea PDF'; createBtn.disabled = !state.sel.size; };
  pane.actions.append(createBtn);
  pane.body.append(h('div', { class: 'av-narrow', style: { maxWidth: '1100px' } },
    h('div', { class: 'av-row' },
      h('button', { class: 'btn', onclick: () => scegli() }, 'Scegli la cartella delle scansioni…'),
      h('button', { class: 'btn', onclick: () => { state.items.forEach((it) => state.sel.add(key(it))); render(); } }, 'Seleziona tutte'),
      h('button', { class: 'btn', onclick: () => { state.sel.clear(); render(); } }, 'Deseleziona'),
      formato,
      app.tools.get('ocr') ? h('label', { class: 'chk', for: 'av-sc-ocr' }, ocr, 'Rendi ricercabile il testo (OCR)') : null),
    info,
    h('p', { class: 'av-note' }, 'Sono evidenziate le immagini arrivate dopo l\'ultima volta. Formati: JPEG, PNG (anche WebP, BMP, GIF). Le immagini TIFF e HEIC non sono supportate: imposta lo scanner per salvare in JPEG, PNG o direttamente in PDF.'),
    grid));
  const key = (it) => it.path || it.rel + ':' + it.size + ':' + it.mtime;

  async function scegli() {
    try {
      const r = await chooseFolder(app, { exts: EXT, recursive: false, title: 'Cartella delle scansioni' });
      if (!r) return;
      state.folder = r.folder; state.label = r.label;
      load(r.items, true);
      clearInterval(state.timer);
      if (isDesktop() && state.folder) state.timer = setInterval(async () => {
        if (!pane.el.isConnected) return clearInterval(state.timer);
        try { load(await relist(app, state.folder, { exts: EXT }), false); } catch {}
      }, 4000);
    } catch (e) { app.reportError(e, 'Cartella non leggibile'); }
  }

  function load(items, first) {
    const last = (app.settings.get(KEY, {}).ultime || {})[state.folder || state.label] || 0;
    const prevKeys = new Set(state.items.map(key));
    state.items = items.sort((a, b) => a.mtime - b.mtime).slice(-MAX_SHOW);
    for (const it of state.items) if ((first && it.mtime > last) || (!first && !prevKeys.has(key(it)))) state.sel.add(key(it));
    const nuove = state.items.filter((it) => it.mtime > last).length;
    info.textContent = `«${state.label}»: ${state.items.length} immagini, ${nuove} nuove dall'ultima volta.${isDesktop() ? ' La cartella viene controllata ogni pochi secondi.' : ''}`;
    if (!first && state.items.length !== prevKeys.size) app.ui.toast('Nuove scansioni nella cartella', { kind: 'info' });
    render();
  }

  function render() {
    grid.innerHTML = '';
    for (const it of state.items) {
      const k = key(it);
      const img = h('img', { alt: it.name, loading: 'lazy' });
      const fig = h('figure', { class: state.sel.has(k) ? 'sel' : '', role: 'option', tabindex: 0, 'aria-selected': String(state.sel.has(k)), title: it.name }, img,
        h('figcaption', {}, `${it.name} — ${new Date(it.mtime).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}`));
      const toggle = () => { state.sel.has(k) ? state.sel.delete(k) : state.sel.add(k); fig.classList.toggle('sel'); fig.setAttribute('aria-selected', String(state.sel.has(k))); updateBtn(); };
      fig.addEventListener('click', toggle);
      fig.addEventListener('keydown', (e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); toggle(); } });
      grid.append(fig);
      thumb(it, img);
    }
    updateBtn();
  }

  async function thumb(it, img) {
    const k = key(it);
    if (state.urls.has(k)) { img.src = state.urls.get(k); return; }
    if (/\.(tiff?|heic)$/i.test(it.name)) { img.alt = 'Formato non supportato'; return; }
    try {
      if (it.size > 40 * 1024 * 1024) return;
      const bytes = await it.read();
      const url = URL.createObjectURL(new Blob([bytes]));
      state.urls.set(k, url); img.src = url;
    } catch {}
  }

  async function crea() {
    const scelte = state.items.filter((it) => state.sel.has(key(it)));
    if (!scelte.length) return;
    app.settings.set(KEY, { ...app.settings.get(KEY, {}), formato: formato.value, ocr: ocr.checked });
    const res = await app.ui.withProgress('Creazione del PDF dalle scansioni', async (p) => {
      const imgs = [];
      for (const [i, it] of scelte.entries()) {
        if (p.cancelled) throw new DOMException('Annullato', 'AbortError');
        p.set(i / scelte.length / 2, `Lettura di ${it.name}`);
        try { imgs.push({ name: it.name, bytes: await normalizza(await it.read()) }); }
        catch { imgs.push({ name: it.name, bytes: new Uint8Array(0) }); }
      }
      const r = await pdfDaImmagini(app.lib.PDFLib, imgs, { formato: formato.value, signal: p.signal, onProgress: (i, n, name) => p.set(0.5 + i / n / 2, `Pagina ${i + 1} di ${n}: ${name}`) });
      return { ...r, bytes: r.aggiunte ? await app.lib.savePdfLib(r.pdfDoc) : null };
    });
    if (!res) return;
    if (res.scartate.length) app.ui.toast(`${res.scartate.length} immagini non usate: ${res.scartate.slice(0, 3).map((s) => `${s.name} (${s.motivo})`).join('; ')}`, { kind: 'warning', timeout: 9000 });
    if (!res.bytes) return;
    const d = new Date();
    const nome = `Scansioni_${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}.pdf`;
    const ultime = { ...(app.settings.get(KEY, {}).ultime || {}), [state.folder || state.label]: Math.max(...scelte.map((s) => s.mtime)) };
    app.settings.set(KEY, { ...app.settings.get(KEY, {}), ultime });
    state.sel.clear();
    clearInterval(state.timer);
    pane.close();
    const doc = await apriRisultato(app, res.bytes, nome);
    if (doc && ocr.checked && app.tools.get('ocr')) setTimeout(() => app.tools.run('ocr'), 400);
  }

  const origClose = pane.close;
  pane.close = (s) => { clearInterval(state.timer); for (const u of state.urls.values()) URL.revokeObjectURL(u); origClose(s); };
}

/** WebP/BMP/GIF → PNG tramite canvas; JPEG e PNG restano come sono. */
async function normalizza(bytes) {
  if (imageType(bytes)) return bytes;
  const bmp = await createImageBitmap(new Blob([bytes]));
  const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
  c.getContext('2d').drawImage(bmp, 0, 0);
  bmp.close?.();
  const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
  return new Uint8Array(await blob.arrayBuffer());
}
