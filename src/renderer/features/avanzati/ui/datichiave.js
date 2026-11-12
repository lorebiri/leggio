// Pannello «Dati chiave»: CIG, CUP, P.IVA, codici fiscali, IBAN, importi e scadenze del documento aperto,
// copiabili con un clic; avviso se un DURC risulta scaduto.
import { estraiDati, riepilogoTesto, DURATA_DURC_GIORNI } from '../lib/datichiave.js';
import { pageText } from '../lib/textsearch.js';

const KEY_DURC = 'avanzati.durc.giorni';
const MAX_PAGINE = 60;

async function testoDocumento(doc, signal) {
  let t = '';
  const n = Math.min(doc.pageCount, MAX_PAGINE);
  for (let i = 1; i <= n; i++) {
    if (signal?.aborted) break;
    const p = await doc.pdf.getPage(i);
    t += pageText((await p.getTextContent()).items) + '\n';
    p.cleanup();
  }
  return t;
}

async function copia(app, testo) {
  try { await navigator.clipboard.writeText(testo); app.ui.toast(`Copiato: ${testo.length > 40 ? testo.slice(0, 40) + '…' : testo}`, { kind: 'success', timeout: 2500 }); }
  catch { app.ui.toast('Impossibile copiare negli appunti.', { kind: 'error' }); }
}
const dataIt = (iso) => iso.split('-').reverse().join('/');

export function registerDatiChiave(app) {
  app.bus.on('settings:fields', (arr) => arr.push({ key: KEY_DURC, field: { label: 'Validità del DURC in giorni (da verificare con la norma vigente)', type: 'number', min: 1, max: 365, value: DURATA_DURC_GIORNI } }));
  app.registerPanel({
    id: 'dati-chiave', title: 'Dati chiave', icon: 'info', order: 63,
    render(c) {
      const { h } = app.ui;
      const doc = app.activeDoc;
      const wrap = h('div', { class: 'pad av-side' }, h('p', { class: 'av-note' }, 'Lettura del documento…'));
      c.append(wrap);
      const ctrl = new AbortController();
      (async () => {
        let d;
        try {
          const cache = doc.data.datiChiave;
          const testo = cache?.bytes === doc.bytes ? null : await testoDocumento(doc, ctrl.signal);
          if (ctrl.signal.aborted) return;
          d = cache?.bytes === doc.bytes ? cache.d : estraiDati(testo, { durataDurc: Number(app.settings.get(KEY_DURC, DURATA_DURC_GIORNI)) || DURATA_DURC_GIORNI });
          doc.data.datiChiave = { bytes: doc.bytes, d, vuoto: testo != null && !testo.trim() };
        } catch (err) { wrap.innerHTML = ''; wrap.append(h('p', {}, 'Impossibile leggere il testo del documento.')); return; }
        wrap.innerHTML = '';
        if (doc.data.datiChiave.vuoto) {
          wrap.append(h('p', {}, 'Il documento non contiene testo leggibile (forse è una scansione).'),
            app.tools.get('ocr') ? h('button', { class: 'btn', onclick: () => app.tools.run('ocr') }, 'Rendi ricercabile (OCR)') : null);
          return;
        }
        if (d.durc) {
          const x = d.durc;
          const cls = x.scaduto ? 'invalid' : x.scadenza ? 'valid' : 'warning';
          wrap.append(h('div', { class: `av-sem av-sem-${cls}`, role: 'status' }, h('span', { class: 'av-sem-dot' }),
            h('div', {}, h('strong', {}, x.scaduto ? 'DURC SCADUTO' : x.scadenza ? 'DURC in corso di validità' : 'DURC: scadenza non trovata'),
              h('div', { class: 'av-sem-txt' }, x.scadenza ? `Scadenza ${dataIt(x.scadenza)}${x.calcolata ? ` (calcolata: data della richiesta + ${app.settings.get(KEY_DURC, DURATA_DURC_GIORNI)} giorni)` : ''}${x.giorniResidui != null ? (x.scaduto ? ` — scaduto da ${-x.giorniResidui} giorni` : ` — mancano ${x.giorniResidui} giorni`) : ''}.${x.regolare === false ? ' Il documento indica che l\'impresa NON risulta regolare.' : ''}` : 'Controlla la data di scadenza sul documento.'))));
        }
        const sezione = (titolo, arr, fmt = (v) => v.valore, extra) => {
          if (!arr.length) return null;
          return h('div', { class: 'av-box' }, h('h3', {}, titolo),
            h('ul', { class: 'av-list' }, arr.slice(0, 20).map((v) => h('li', {}, h('div', { class: 'av-row' },
              h('span', { class: 'av-code av-grow', title: v.contesto || '' }, fmt(v)),
              h('button', { class: 'btn small', 'aria-label': `Copia ${fmt(v)}`, onclick: () => copia(app, String(extra ? extra(v) : fmt(v))) }, 'Copia')),
              v.contesto ? h('small', { class: 'av-note' }, `«${v.contesto}»`) : null))));
        };
        const euro = (n) => n.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: 'always' }) + ' €';
        const nessuno = !d.cig.length && !d.cup.length && !d.piva.length && !d.iban.length && !d.importi.length && !d.scadenze.length;
        wrap.append(...[
          h('div', { class: 'av-btn-col' }, h('button', { class: 'btn', disabled: nessuno, onclick: () => copia(app, riepilogoTesto(d)) }, 'Copia tutti i dati')),
          nessuno ? h('p', {}, 'Nessun CIG, CUP, partita IVA, IBAN o importo trovato in questo documento.') : null,
          sezione('CIG', d.cig), sezione('CUP', d.cup), sezione('Partita IVA', d.piva), sezione('Codice fiscale', d.cf), sezione('IBAN', d.iban),
          d.totale != null ? sezione('Totale', [{ valore: d.totale }], (v) => euro(v.valore), (v) => v.valore.toFixed(2).replace('.', ',')) : null,
          sezione('Importi', d.importi.filter((x) => x.etichetta !== 'Totale').slice(0, 8), (v) => `${v.etichetta ? v.etichetta + ': ' : ''}${euro(v.valore)}`, (v) => v.valore.toFixed(2).replace('.', ',')),
          sezione('Scadenze', d.scadenze, (v) => `${v.etichetta}: ${dataIt(v.valore)}`, (v) => dataIt(v.valore)),
          h('p', { class: 'av-note' }, `Dati riconosciuti automaticamente${doc.pageCount > MAX_PAGINE ? ` nelle prime ${MAX_PAGINE} pagine` : ''}: controllali sempre sul documento. Partite IVA, codici fiscali e IBAN sono verificati con il carattere di controllo.`)].filter(Boolean));
      })();
      return () => ctrl.abort();
    },
  });
}
