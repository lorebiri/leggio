// Pannello «Livelli» (contenuto opzionale / OCG): mostra/nascondi, e visibilità predefinita per stampa ed esportazione.
import { impostaVisibilitaPredefinita } from '../lib/ocg.js';

export function registerLayersPanel(app) {
  // la visibilità scelta resta anche dopo una modifica al documento (che ricarica pdf.js)
  app.bus.on('viewer:pagesinit', async ({ doc }) => {
    const vis = doc?.data?.ocgVis;
    if (!vis || !Object.keys(vis).length) return;
    try {
      const cfg = await app.viewer.pdfViewer.optionalContentConfigPromise;
      if (!cfg) return;
      let changed = false;
      for (const [id, g] of cfg) if (id in vis && g.visible !== vis[id]) { cfg.setVisibility(id, vis[id], false); changed = true; }
      if (changed) app.viewer.pdfViewer.optionalContentConfigPromise = Promise.resolve(cfg);
    } catch {}
  });

  app.registerPanel({
    id: 'layers', title: 'Livelli', icon: 'layers', order: 64,
    render(c) {
      const { h } = app.ui;
      const doc = app.activeDoc;
      const wrap = h('div', { class: 'pad av-side' }, h('p', { class: 'av-note' }, 'Lettura dei livelli…'));
      c.append(wrap);
      let alive = true;
      (async () => {
        let cfg = null;
        try { cfg = await app.viewer.pdfViewer.optionalContentConfigPromise; } catch {}
        if (!cfg) { try { cfg = await doc.pdf.getOptionalContentConfig({ intent: 'display' }); } catch {} }
        if (!alive) return;
        wrap.innerHTML = '';
        const groups = cfg ? [...cfg] : [];
        if (!groups.length) {
          wrap.append(h('p', {}, 'Questo documento non contiene livelli.'), h('p', { class: 'av-note' }, 'I livelli si trovano soprattutto nei disegni tecnici, nelle mappe e nei PDF creati da programmi di grafica: permettono di mostrare o nascondere parti della pagina.'));
          return;
        }
        doc.data.ocgVis ||= {};
        const apply = () => { app.viewer.pdfViewer.optionalContentConfigPromise = Promise.resolve(cfg); };
        const set = (id, v) => { cfg.setVisibility(id, v, true); for (const [gid, g] of cfg) doc.data.ocgVis[gid] = g.visible; };
        const list = h('ul', { class: 'av-layers', 'aria-label': 'Livelli del documento' });
        const boxes = new Map();
        const addItem = (id, depth) => {
          const g = cfg.getGroup(id); if (!g) return;
          const cb = h('input', { type: 'checkbox', checked: g.visible, onchange: () => { set(id, cb.checked); sync(); apply(); } });
          boxes.set(id, cb);
          list.append(h('li', { class: depth ? 'av-sub' : '' }, h('label', {}, cb, g.name || 'Livello senza nome')));
        };
        const walk = (items, depth) => {
          for (const it of items || []) {
            if (typeof it === 'string') addItem(it, depth);
            else if (it && typeof it === 'object') {
              if (it.name) list.append(h('li', { class: depth ? 'av-sub' : '' }, h('strong', {}, it.name)));
              walk(it.order, depth + 1);
            }
          }
        };
        const order = cfg.getOrder();
        walk(order, 0);
        for (const [id] of groups) if (!boxes.has(id)) addItem(id, 0); // livelli non presenti nell'ordine
        const sync = () => { for (const [id, cb] of boxes) cb.checked = !!cfg.getGroup(id)?.visible; };
        wrap.append(
          h('div', { class: 'av-row' },
            h('button', { class: 'btn small', onclick: () => { for (const [id] of cfg) set(id, true); sync(); apply(); } }, 'Mostra tutti'),
            h('button', { class: 'btn small', onclick: () => { for (const [id] of cfg) set(id, false); sync(); apply(); } }, 'Nascondi tutti')),
          list,
          h('button', { class: 'btn', onclick: async () => {
            const stato = {}; for (const [id, g] of cfg) stato[id] = g.visible;
            try {
              await app.editWithPdfLib('Visibilità dei livelli resa predefinita', (pdfDoc, PDFLib) => { impostaVisibilitaPredefinita(pdfDoc, PDFLib, stato); });
            } catch (err) { app.reportError(err, 'Livelli non aggiornati'); }
          } }, 'Usa questa visibilità per stampa e salvataggio'),
          h('p', { class: 'av-note' }, 'Mostrare o nascondere un livello cambia solo la vista. Con il pulsante qui sopra la scelta viene scritta nel file: la stampa, il salvataggio e gli altri programmi mostreranno gli stessi livelli. Si può annullare.'));
      })();
      return () => { alive = false; };
    },
  });
}
