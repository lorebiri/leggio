// Strumento «Link»: crea, modifica, elimina collegamenti; crea link automatici da URL ed email nel testo.
import { addLink, listLinks, updateLink, deleteLink, addLinksIfFree } from '../links.js';
import { findLinksInText } from '../blocks.js';
import { analyze, pageSearchText } from '../operations.js';
import { readOnlyPdfLib, forEachRenderedPage, toolLayer, clearLayers, place, pageOfEvent, confirmSigned, rectToCss } from './common.js';

const LAYER = 'lgm-links';

export function linksTool(app) {
  const { h } = app.ui;
  const S = { active: false, unsub: [] };

  async function draw(pageIndex, overlay) {
    if (!S.active || !overlay) return;
    const doc = app.activeDoc;
    const version = doc.bytes;
    let links = [];
    try { links = listLinks(await readOnlyPdfLib(app, doc), pageIndex); } catch (err) { console.warn('[modifica] link', err); }
    if (!S.active || doc.bytes !== version) return;
    const layer = toolLayer(overlay, LAYER);
    layer.innerHTML = '';
    for (const l of links) {
      const el = h('div', { class: 'lgm-link', title: describe(l.target) + ' — clic per modificare' });
      place(el, rectToCss(app, pageIndex, l.rect));
      el.addEventListener('mousedown', (e) => e.stopPropagation());
      el.addEventListener('click', (e) => { e.stopPropagation(); linkMenu(e, pageIndex, l); });
      layer.append(el);
    }
  }

  function describe(t) {
    if (t.type === 'url') return 'Sito: ' + t.url;
    if (t.type === 'email') return 'Email: ' + t.email;
    if (t.type === 'page') return 'Vai a pagina ' + (t.page + 1);
    if (t.type === 'named') return 'Destinazione «' + t.name + '»';
    return 'Collegamento di altro tipo';
  }

  async function askTarget(initial = { type: 'url', url: '' }) {
    const n = app.activeDoc.pageCount;
    const v = await app.ui.dialog({
      title: 'Destinazione del collegamento', okLabel: 'Salva', width: 460,
      fields: [
        { name: 'type', type: 'radio', label: 'Dove porta', value: initial.type === 'other' || initial.type === 'named' ? 'url' : initial.type, options: [{ value: 'url', label: 'Un sito web' }, { value: 'page', label: 'Una pagina di questo documento' }, { value: 'email', label: 'Un indirizzo email' }] },
        { name: 'url', label: 'Indirizzo del sito', value: initial.url || '', placeholder: 'https://www.esempio.it' },
        { name: 'page', label: `Numero di pagina (1–${n})`, type: 'number', min: 1, max: n, value: (initial.page ?? app.viewer.pageIndex) + 1 },
        { name: 'email', label: 'Indirizzo email', value: initial.email || '', placeholder: 'nome@esempio.it' },
      ],
      validate: (x) => {
        if (x.type === 'url' && !/\S+\.\S+/.test(x.url || '')) return 'Scrivi l\'indirizzo del sito, per esempio www.cnr.it';
        if (x.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((x.email || '').replace(/^mailto:/i, ''))) return 'Scrivi un indirizzo email valido, per esempio nome@cnr.it';
        if (x.type === 'page' && !(x.page >= 1 && x.page <= n)) return `Scrivi un numero di pagina tra 1 e ${n}`;
        return null;
      },
    });
    if (!v) return null;
    if (v.type === 'url') return { type: 'url', url: v.url.trim() };
    if (v.type === 'email') return { type: 'email', email: v.email.trim() };
    return { type: 'page', page: (parseInt(v.page, 10) || 1) - 1 };
  }

  function linkMenu(e, pageIndex, l) {
    app.ui.contextMenu(e.clientX, e.clientY, [
      { label: describe(l.target), disabled: true },
      '-',
      { label: 'Cambia destinazione…', icon: 'link', run: async () => {
        const t = await askTarget(l.target); if (!t) return;
        if (!(await confirmSigned(app))) return;
        await app.editWithPdfLib('Collegamento modificato', (d) => updateLink(d, pageIndex, l.index, t));
      } },
      l.target.type === 'url' || l.target.type === 'page' ? { label: l.target.type === 'url' ? 'Apri il sito' : 'Vai alla pagina', run: () => { if (l.target.type === 'url') window.open(l.target.url, '_blank', 'noopener'); else app.viewer.page = l.target.page + 1; } } : null,
      { label: 'Elimina collegamento', icon: 'trash', danger: true, run: async () => {
        if (!(await confirmSigned(app))) return;
        await app.editWithPdfLib('Collegamento eliminato', (d) => deleteLink(d, pageIndex, l.index));
      } },
    ].filter(Boolean));
  }

  function onDown(e) {
    if (e.button !== 0) return;
    const pageIndex = pageOfEvent(e);
    if (pageIndex < 0 || e.target.closest('.lgm-link')) return;
    e.preventDefault();
    const p0 = app.viewer.clientToPdf(pageIndex, e.clientX, e.clientY);
    const layer = toolLayer(app.viewer.getOverlay(pageIndex), LAYER);
    const ghost = h('div', { class: 'lgm-link ghost' });
    layer.append(ghost);
    let p1 = p0;
    const move = (ev) => { p1 = app.viewer.clientToPdf(pageIndex, ev.clientX, ev.clientY); place(ghost, rectToCss(app, pageIndex, [p0[0], p0[1], p1[0], p1[1]])); };
    const up = async () => {
      window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up);
      if (Math.abs(p1[0] - p0[0]) < 3 || Math.abs(p1[1] - p0[1]) < 3) { ghost.remove(); app.ui.toast('Trascina un rettangolo sopra il testo o l\'immagine che deve diventare un collegamento.'); return; }
      const t = await askTarget();
      ghost.remove();
      if (!t || !(await confirmSigned(app))) return;
      await app.editWithPdfLib('Collegamento creato', (d) => { addLink(d, pageIndex, [p0[0], p0[1], p1[0], p1[1]], t); });
    };
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
  }

  return {
    id: 'links', name: 'Link', category: 'modifica', icon: 'link',
    description: 'Crea, modifica ed elimina collegamenti a siti, pagine o email; crea i link automatici dal testo',
    keywords: 'link collegamento collegamenti ipertestuale url sito email mailto pagina crea link automatici modifica pdf',
    interactive: {
      activate(appRef, optionsEl) {
        S.active = true;
        app.viewer.setMode('tool', 'crosshair');
        optionsEl.append(
          h('span', { class: 'lgm-hint' }, 'Trascina un rettangolo per creare un collegamento; fai clic su un collegamento per modificarlo.'),
          h('button', { class: 'btn small', onclick: () => autoLinks(app) }, 'Crea link automatici'));
        S.unsub.push(app.bus.on('page:rendered', ({ pageIndex, overlay }) => draw(pageIndex, overlay)));
        S.unsub.push(app.bus.on('document:activated', () => app.tools.deactivate()));
        S.down = (e) => { if (e.target.closest?.('.leggio-overlay')) onDown(e); };
        app.viewer.container.addEventListener('mousedown', S.down);
        forEachRenderedPage(app, (i, ov) => draw(i, ov));
      },
      deactivate() {
        S.active = false;
        S.unsub.forEach((u) => u()); S.unsub = [];
        app.viewer.container.removeEventListener('mousedown', S.down);
        clearLayers(app, LAYER);
      },
    },
  };
}

/** Rettangoli (uno per riga) dei glifi di un tratto di testo. */
function rectsOf(refs) {
  const gl = refs.filter(Boolean);
  const lines = [];
  for (const e of gl) {
    let ln = lines.find((l) => Math.abs(l.y - e.ly) < 0.5 * e.efs);
    if (!ln) { ln = { y: e.ly, pts: [] }; lines.push(ln); }
    ln.pts.push(e.g.o, e.g.e, e.g.top);
  }
  return lines.map((l) => { const xs = l.pts.map((p) => p[0]), ys = l.pts.map((p) => p[1]); return [Math.min(...xs), Math.min(...ys) - 1, Math.max(...xs), Math.max(...ys) + 1]; });
}

export async function autoLinks(app) {
  if (!(await confirmSigned(app))) return;
  const doc = app.activeDoc;
  const n = doc.pageCount;
  let added = 0, found = 0;
  await app.editWithPdfLib('Link automatici creati', async (pdfDoc) => {
    await app.ui.withProgress('Ricerca di indirizzi web ed email', async (p) => {
      for (let i = 0; i < n; i++) {
        if (p.cancelled) throw Object.assign(new Error('annullato'), { name: 'AbortError' });
        p.set(i / n, `Pagina ${i + 1} di ${n}`);
        let A;
        try { A = analyze(pdfDoc, i); } catch { continue; }
        const pst = pageSearchText(A);
        const items = [];
        for (const m of findLinksInText(pst.text)) {
          const target = m.kind === 'url' ? { type: 'url', url: m.value } : { type: 'email', email: m.value };
          for (const rect of rectsOf(pst.refs.slice(m.start, m.end))) items.push({ rect, target });
          found++;
        }
        if (items.length) added += addLinksIfFree(pdfDoc, i, items);
        if (i % 5 === 4) await new Promise((r) => setTimeout(r));
      }
    });
    if (!added) return false;
  });
  app.ui.toast(added ? `Creati ${added} collegamenti.` : found ? 'Gli indirizzi trovati hanno già un collegamento.' : 'Nessun indirizzo web o email trovato nel testo.', { kind: added ? 'success' : 'info' });
}
