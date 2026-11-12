// Pannello «Segnalibri» modificabile: aggiungi dalla pagina corrente (col testo selezionato come titolo),
// rinomina, elimina, trascina per riordinare o annidare. Sostituisce il pannello di base (stesso id).
import { icon } from '../../../core/icons.js';
import * as B from '../logica/segnalibri.js';
import { mostraErrore, modificaDoc } from './comune.js';

/** Albero da pdf.js con le pagine risolte. → [{ titolo, pagina, dest, url, figli, grassetto, corsivo }] */
async function leggiDaPdfJs(pdf) {
  const outline = await pdf.getOutline().catch(() => null);
  if (!outline?.length) return [];
  const pagina = async (dest) => {
    try {
      let d = dest;
      if (typeof d === 'string') d = await pdf.getDestination(d);
      if (!Array.isArray(d) || !d[0]) return null;
      if (typeof d[0] === 'object') return await pdf.getPageIndex(d[0]);
      if (Number.isInteger(d[0])) return d[0];
    } catch {}
    return null;
  };
  const conv = async (items) => Promise.all(items.map(async (it) => ({ titolo: it.title, dest: it.dest, url: it.url, pagina: it.dest ? await pagina(it.dest) : null, grassetto: it.bold, corsivo: it.italic, figli: it.items?.length ? await conv(it.items) : [] })));
  return conv(outline);
}

export function pannelloSegnalibri(app) {
  return {
    id: 'outline', title: 'Segnalibri', icon: 'bookmark', order: 20,
    render(c) {
      const { h } = app.ui;
      const doc = app.activeDoc;
      let albero = [];
      let selezione = null; // percorso (array)
      const aperti = doc.data.pgOutlineAperti ||= new Set();
      const btn = (label, ic, fn, title) => h('button', { type: 'button', title: title || label, onclick: fn, html: icon(ic, 15) + `<span>${label}</span>` });
      const bAgg = btn('Aggiungi', 'plus', () => aggiungi(), 'Nuovo segnalibro alla pagina che stai guardando (il testo selezionato diventa il titolo)');
      const bSub = btn('Sotto-segnalibro', 'chevronRight', () => aggiungi(true), 'Nuovo segnalibro dentro quello selezionato');
      const bRin = btn('Rinomina', 'text', () => rinomina());
      const bDest = btn('Imposta pagina', 'bookmark', () => impostaPagina(), 'Il segnalibro selezionato porterà alla pagina corrente');
      const bDel = btn('Elimina', 'trash', () => elimina());
      const barra = h('div', { class: 'pg-ol-bar', role: 'toolbar', 'aria-label': 'Comandi dei segnalibri' }, bAgg, bSub, bRin, bDest, bDel);
      const corpo = h('div', { class: 'pg-ol-corpo' });
      c.append(barra, corpo);
      const aggiornaBarra = () => { const s = !!selezione; bSub.disabled = !s; bRin.disabled = !s; bDel.disabled = !s; bDest.disabled = !s; };

      const chiave = (p) => p.join('.');
      const disegna = () => {
        corpo.innerHTML = '';
        if (!albero.length) {
          corpo.append(h('div', { class: 'pg-ol-vuoto' }, 'Questo documento non ha segnalibri.', h('br'), 'Vai alla pagina che vuoi segnare e premi «Aggiungi». Se selezioni un titolo nel testo, verrà usato come nome.'));
          aggiornaBarra(); return;
        }
        const costruisci = (nodi, base) => h('ul', { class: 'pg-ol' + (base.length ? '' : ' pg-ol-root'), role: base.length ? 'group' : 'tree' }, nodi.map((n, k) => {
          const p = [...base, k];
          const figli = n.figli?.length;
          const li = h('li', { class: figli && aperti.has(chiave(p)) ? 'open' : '', role: 'treeitem' });
          const riga = h('div', { class: 'pg-ol-row' + (selezione && chiave(selezione) === chiave(p) ? ' sel' : ''), draggable: 'true', 'data-p': chiave(p) },
            figli ? h('button', { type: 'button', class: 'pg-ol-tw', 'aria-label': 'Espandi o comprimi', onclick: (e) => { e.stopPropagation(); li.classList.toggle('open'); li.classList.contains('open') ? aperti.add(chiave(p)) : aperti.delete(chiave(p)); }, html: icon('chevronDown', 14) }) : h('span', { class: 'pg-ol-sp' }),
            h('button', { type: 'button', class: 'pg-ol-titolo', style: { fontWeight: n.grassetto ? '600' : null, fontStyle: n.corsivo ? 'italic' : null }, title: n.titolo }, n.titolo || '(senza titolo)'),
            h('span', { class: 'pg-ol-pag' }, n.pagina != null ? String(n.pagina + 1) : n.url ? 'link' : ''));
          riga.addEventListener('click', () => { selezione = p; vai(n); disegna(); });
          riga.addEventListener('dblclick', () => { selezione = p; rinomina(); });
          riga.addEventListener('contextmenu', (e) => { e.preventDefault(); selezione = p; disegna(); app.ui.contextMenu(e.clientX, e.clientY, [
            { label: 'Vai', icon: 'chevronRight', run: () => vai(n) },
            { label: 'Rinomina', icon: 'text', run: () => rinomina() },
            { label: 'Imposta alla pagina corrente', icon: 'bookmark', run: () => impostaPagina() },
            { label: 'Aggiungi sotto-segnalibro', icon: 'plus', run: () => aggiungi(true) },
            '-', { label: 'Elimina', icon: 'trash', danger: true, run: () => elimina() },
          ]); });
          // trascina: sopra la metà alta = prima, bassa = dopo, centro = dentro
          riga.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/x-leggio-ol', chiave(p)); e.dataTransfer.effectAllowed = 'move'; });
          const zona = (e) => { const r = riga.getBoundingClientRect(); const y = (e.clientY - r.top) / r.height; return y < 0.3 ? 'prima' : y > 0.7 ? 'dopo' : 'dentro'; };
          riga.addEventListener('dragover', (e) => { if (!e.dataTransfer.types.includes('text/x-leggio-ol')) return; e.preventDefault(); riga.classList.remove('drop-prima', 'drop-dopo', 'drop-dentro'); riga.classList.add('drop-' + zona(e)); });
          riga.addEventListener('dragleave', () => riga.classList.remove('drop-prima', 'drop-dopo', 'drop-dentro'));
          riga.addEventListener('drop', (e) => {
            const da = e.dataTransfer.getData('text/x-leggio-ol'); if (!da) return;
            e.preventDefault(); const z = zona(e); riga.classList.remove('drop-prima', 'drop-dopo', 'drop-dentro');
            if (da === chiave(p)) return;
            modifica('Segnalibro spostato', (t) => B.spostaNodo(t, da.split('.').map(Number), p, z));
          });
          li.append(riga);
          if (figli) li.append(costruisci(n.figli, p));
          return li;
        }));
        corpo.append(costruisci(albero, []));
        aggiornaBarra();
      };
      const vai = (n) => { if (n.dest) app.viewer.goToDestination(n.dest); else if (n.pagina != null) app.viewer.page = n.pagina + 1; else if (n.url) app.platform.openExternal(n.url); };

      /** Modifica l'albero dentro pdf-lib (stessa struttura letta da pdf.js) e salva in modo annullabile. */
      async function modifica(etichetta, fn) {
        try {
          await modificaDoc(app, etichetta, (pdfDoc) => {
            const t = B.leggiSegnalibri(pdfDoc);
            const r = fn(t, pdfDoc);
            if (r === false) return false;
            B.scriviSegnalibri(pdfDoc, t);
          });
        } catch (err) { mostraErrore(app, err, 'Segnalibri'); }
      }
      const posizioneCorrente = () => {
        const loc = app.viewer.pdfViewer._location; // { pageNumber, top } in coordinate PDF
        return { pagina: app.viewer.pageIndex, top: loc && loc.pageNumber === app.viewer.page && Number.isFinite(loc.top) ? loc.top : null };
      };
      async function aggiungi(dentro = false) {
        const sel = window.getSelection()?.toString().replace(/\s+/g, ' ').trim().slice(0, 200);
        const { pagina, top } = posizioneCorrente();
        const titolo = await app.ui.prompt('Titolo del segnalibro:', sel || `Pagina ${pagina + 1}`, { title: dentro ? 'Nuovo sotto-segnalibro' : 'Nuovo segnalibro', okLabel: 'Aggiungi' });
        if (titolo == null) return;
        const nodo = { titolo: titolo.trim() || `Pagina ${pagina + 1}`, pagina, top, figli: [], cambiato: true };
        const s = selezione;
        await modifica('Segnalibro aggiunto', (t) => {
          if (dentro && s) { const g = B.nodoA(t, s); if (!g) return false; g.figli.push(nodo); g.aperto = true; aperti.add(chiave(s)); }
          else if (s) B.inserisciA(t, [...s.slice(0, -1), s[s.length - 1] + 1], nodo);
          else {
            // in ordine di pagina tra i segnalibri di primo livello
            let k = t.findIndex((n) => n.pagina != null && n.pagina > pagina); if (k < 0) k = t.length;
            t.splice(k, 0, nodo);
          }
        });
      }
      async function rinomina() {
        if (!selezione) return;
        const n = B.nodoA(albero, selezione); if (!n) return;
        const titolo = await app.ui.prompt('Nuovo titolo:', n.titolo, { title: 'Rinomina segnalibro', okLabel: 'Rinomina' });
        if (titolo == null || titolo === n.titolo) return;
        const s = selezione;
        await modifica('Segnalibro rinominato', (t) => { const x = B.nodoA(t, s); if (!x) return false; x.titolo = titolo.trim() || x.titolo; });
      }
      async function impostaPagina() {
        if (!selezione) return;
        const { pagina, top } = posizioneCorrente(); const s = selezione;
        await modifica(`Segnalibro impostato alla pagina ${pagina + 1}`, (t) => { const x = B.nodoA(t, s); if (!x) return false; x.pagina = pagina; x.top = top; x.cambiato = true; });
      }
      async function elimina() {
        if (!selezione) return;
        const n = B.nodoA(albero, selezione); if (!n) return;
        const s = selezione; selezione = null;
        await modifica(n.figli?.length ? 'Segnalibro eliminato (con i sotto-segnalibri)' : 'Segnalibro eliminato', (t) => { B.rimuoviA(t, s); });
      }

      let vivo = true;
      leggiDaPdfJs(doc.pdf).then((a) => {
        if (!vivo) return;
        albero = a;
        if (!aperti.size && a.length < 40) a.forEach((n, k) => { if (n.figli?.length) aperti.add(String(k)); });
        disegna();
      });
      const onKey = (e) => {
        if (!c.contains(document.activeElement) || !selezione) return;
        if (e.key === 'F2') { e.preventDefault(); rinomina(); }
        if (e.key === 'Delete') { e.preventDefault(); elimina(); }
      };
      document.addEventListener('keydown', onKey);
      return () => { vivo = false; document.removeEventListener('keydown', onKey); };
    },
  };
}
