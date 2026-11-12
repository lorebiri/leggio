// Fattura elettronica (FatturaPA).
// Nell'app desktop la fattura diventa un documento in una SCHEDA SUA (PDF impaginato da Leggio) con accanto il
// pannello «Fattura elettronica» (CIG/CUP, avvisi, allegati, firma). Nell'anteprima web, senza printToPDF,
// si mostra impaginata in uno spazio di lavoro con «Stampa».
import { parseFattura, fatturaDocument, nomeProposto, allegatoBytes, allegatoNome, euro, dataIt } from '../lib/fattura.js';
import { looksLikeP7m, openP7m } from '../lib/cades.js';
import { ESITI } from '../lib/report.js';
import { isDesktop, call } from '../native.js';

const firmaTesto = (firma) => (firma ? `Firmato digitalmente: ${firma.result.levels.flatMap((l) => l.signers.map((s) => s.name)).join(', ')} — esito verifica: ${ESITI[firma.stato].titolo}` : '');

/**
 * Fattura (XML o .p7m con XML) → PDF impaginato (solo app desktop). → { bytes, fattura, nome } | lancia un errore leggibile.
 * Esposto come app.services.fatturaPdf(bytes) per l'area archivio e usato dalle Azioni guidate.
 */
export async function fatturaPdfDaBytes(app, bytes, { nomeFile = 'fattura.xml', compatta = false } = {}) {
  if (!isDesktop()) throw new Error('L\'impaginazione in PDF della fattura è disponibile nell\'app desktop.');
  let xml = bytes;
  if (looksLikeP7m(bytes)) { const r = await openP7m(bytes, { verify: false }); if (!r.content) throw new Error('Il file firmato non contiene il documento.'); xml = r.content; }
  const f = parseFattura(xml);
  const pdf = await creaPdf(app, f, { compatta, nomeFile, silenzioso: true });
  if (!pdf) throw new Error('Impaginazione non riuscita.');
  return { bytes: pdf, fattura: f, nome: nomeProposto(f) };
}

export async function openFattura(app, bytes, name, { firma = null, path = null } = {}, deps) {
  let f;
  try { f = parseFattura(bytes); }
  catch (err) {
    return app.ui.dialog({ title: 'Fattura non leggibile', message: `«${name}» non può essere visualizzato: ${err.message}`, cancelLabel: null, okLabel: 'Chiudi' });
  }
  const compatta = app.settings.get('avanzati.fattura.compatta', false);
  if (isDesktop()) {
    try {
      const pdf = await creaPdf(app, f, { compatta, firma, nomeFile: name });
      if (pdf) {
        const doc = await app.openBytes(pdf, { name: nomeProposto(f) });
        if (doc) {
          doc.data.fattura = { f, xmlName: name, xmlBytes: bytes, xmlPath: path || firma?.sourcePath || null, firma, compatta };
          if (firma) doc.data.p7m = firma;
          app.sidebar.show('fattura');
          const avvisi = f.corpi.flatMap((c) => c.avvisi.filter((a) => a.livello !== 'info'));
          if (avvisi.length) app.ui.toast(`Controlla la fattura: ${avvisi[0].testo}${avvisi.length > 1 ? ` (e altri ${avvisi.length - 1} avvisi nel pannello)` : ''}`, { kind: 'warning', timeout: 9000 });
          return doc;
        }
      }
    } catch (err) { console.error('[avanzati] fattura come PDF', err); }
  }
  return paneFattura(app, f, name, { firma, compatta }, deps);
}

/** PDF impaginato della fattura (solo app desktop). */
async function creaPdf(app, f, { compatta, firma, nomeFile, silenzioso = false }) {
  const html = fatturaDocument(f, { compatta, firma: firmaTesto(firma), nomeFile });
  const bytes = silenzioso ? await call(app, 'html-to-pdf', { html, pageSize: 'A4', margins: 0 })
    : await app.ui.withProgress('Impaginazione della fattura', async (p) => { p.set(null, 'Creazione del PDF della fattura…'); return call(app, 'html-to-pdf', { html, pageSize: 'A4', margins: 0 }); }, { cancellable: false });
  if (!bytes) return null;
  try { const d = await app.lib.openPdfLib(bytes); d.setTitle(nomeProposto(f).replace(/\.pdf$/, '')); d.setLanguage('it-IT'); d.setCreator('Leggio'); return await app.lib.savePdfLib(d); } catch { return bytes; }
}

/** Riepilogo (CIG/CUP, totali, avvisi, allegati, firma): usato dal pannello e dallo spazio di lavoro. */
function riepilogo(app, f, firma, deps) {
  const { h } = app.ui;
  const out = [];
  f.corpi.forEach((c, i) => {
    out.push(h('div', { class: 'av-box' },
      f.corpi.length > 1 ? h('h3', {}, `Documento ${i + 1}: n. ${c.numero}`) : h('h3', {}, `Fattura n. ${c.numero || '—'} del ${dataIt(c.data) || '—'}`),
      h('dl', { class: 'av-dl' },
        h('dt', {}, 'Fornitore'), h('dd', {}, f.cedente?.nome || '—'),
        h('dt', {}, 'CIG'), h('dd', { class: c.cig.length ? 'av-code' : 'av-missing' }, c.cig.join(', ') || 'non indicato'),
        h('dt', {}, 'CUP'), h('dd', { class: c.cup.length ? 'av-code' : 'av-missing' }, c.cup.join(', ') || 'non indicato'),
        h('dt', {}, 'Totale'), h('dd', {}, euro(c.calcoli.totale, c.divisa)),
        c.calcoli.split ? [h('dt', {}, 'Da pagare al fornitore'), h('dd', {}, euro(c.calcoli.nettoAPagare, c.divisa) + ' (scissione dei pagamenti)')] : null,
        c.pagamenti[0]?.dettagli[0]?.scadenza ? [h('dt', {}, 'Scadenza'), h('dd', {}, dataIt(c.pagamenti[0].dettagli[0].scadenza))] : null,
        c.pagamenti[0]?.dettagli[0]?.iban ? [h('dt', {}, 'IBAN'), h('dd', { class: 'av-code av-small' }, c.pagamenti[0].dettagli[0].iban)] : null),
      c.avvisi.filter((a) => a.livello !== 'info').map((a) => h('p', { class: 'av-warn' }, a.testo))));
    if (c.allegati.length) {
      out.push(h('div', { class: 'av-box' }, h('h3', {}, `Allegati nella fattura (${c.allegati.length})`),
        h('ul', { class: 'av-list' }, c.allegati.map((a) => h('li', {},
          h('div', { class: 'av-list-name' }, allegatoNome(a)), a.descrizione ? h('small', {}, a.descrizione) : null,
          h('div', { class: 'av-row' },
            h('button', { class: 'btn small', onclick: () => apriAllegato(app, a, deps) }, 'Apri'),
            h('button', { class: 'btn small', onclick: () => salvaAllegato(app, a) }, 'Salva…')))))));
    }
  });
  if (firma) {
    out.push(h('div', { class: 'av-box' }, h('h3', {}, 'Firma digitale'),
      deps.signatureView(app, firma, { compact: true }),
      h('div', { class: 'av-btn-col' },
        h('button', { class: 'btn small', onclick: () => deps.saveReport(app, firma) }, 'Salva rapporto di verifica (PDF)…'))));
  }
  return out;
}

/** Pannello laterale «Fattura elettronica» per i documenti nati da un XML. */
export function registerFatturaPanel(app, deps) {
  app.registerPanel({
    id: 'fattura', title: 'Fattura elettronica', icon: 'file', order: 61,
    render(c) {
      const { h } = app.ui;
      const doc = app.activeDoc;
      const info = doc?.data?.fattura;
      if (!info) {
        c.append(h('div', { class: 'pad av-side' }, h('p', {}, 'Questo documento non è una fattura elettronica.'),
          h('button', { class: 'btn', onclick: () => app.tools.run('fattura-elettronica') }, 'Apri fattura elettronica (XML)…')));
        return;
      }
      const toggle = async () => {
        try {
          const compatta = !info.compatta;
          const pdf = await creaPdf(app, info.f, { compatta, firma: info.firma, nomeFile: info.xmlName });
          if (!pdf) return;
          await app.applyEdit(compatta ? 'Vista compatta della fattura' : 'Vista completa della fattura', async () => pdf, doc);
          info.compatta = compatta; app.settings.set('avanzati.fattura.compatta', compatta);
          app.sidebar.show('fattura');
        } catch (err) { app.reportError(err, 'Impaginazione non riuscita'); }
      };
      c.append(h('div', { class: 'pad av-side' },
        h('div', { class: 'av-btn-col' },
          h('button', { class: 'btn primary', onclick: () => app.save(doc, { as: true }) }, 'Salva come PDF…'),
          h('button', { class: 'btn', onclick: () => app.print() }, 'Stampa…'),
          h('button', { class: 'btn', onclick: toggle }, info.compatta ? 'Vista completa' : 'Vista compatta'),
          h('button', { class: 'btn', onclick: () => app.exportFile(info.xmlBytes, info.xmlName.replace(/(\.p7m)+$/i, ''), [{ name: 'XML', extensions: ['xml'] }]) }, 'Salva l\'XML originale…')),
        h('p', { class: 'av-note' }, `Copia leggibile del file ${info.xmlName}. Il documento con valore fiscale resta il file XML.`),
        ...riepilogo(app, info.f, info.firma, deps)));
    },
  });
}

/** Spazio di lavoro con la fattura impaginata (anteprima web o ripiego). */
function paneFattura(app, f, name, { firma, compatta }, deps) {
  const { h } = app.ui;
  const c0 = f.corpi[0];
  const pane = deps.openPane(app, { title: `Fattura n. ${c0.numero || '—'} del ${dataIt(c0.data) || '—'}`, subtitle: `${f.cedente?.nome || ''} — ${name}${f.corpi.length > 1 ? ` — ${f.corpi.length} documenti nel file` : ''}`, id: 'fattura' });
  const frame = h('iframe', { class: 'av-fattura-frame', title: 'Fattura impaginata', sandbox: 'allow-same-origin allow-modals' });
  const render = () => { frame.srcdoc = fatturaDocument(f, { compatta, firma: firmaTesto(firma), nomeFile: name }); };
  const toggle = h('button', { class: 'btn', onclick: () => { compatta = !compatta; app.settings.set('avanzati.fattura.compatta', compatta); toggle.textContent = compatta ? 'Vista completa' : 'Vista compatta'; render(); } }, compatta ? 'Vista completa' : 'Vista compatta');
  const stampa = () => { try { frame.contentWindow.focus(); frame.contentWindow.print(); } catch (e) { app.reportError(e, 'Stampa non riuscita'); } };
  pane.actions.append(
    h('button', { class: 'btn primary', onclick: () => { app.ui.toast('Nella finestra di stampa scegli «Salva come PDF» come stampante.', { kind: 'info', timeout: 7000 }); stampa(); } }, 'Salva come PDF…'),
    h('button', { class: 'btn', onclick: stampa }, 'Stampa…'),
    toggle);
  pane.body.classList.add('av-fattura-body');
  pane.body.append(h('div', { class: 'av-fattura-doc' }, frame), h('aside', { class: 'av-fattura-side' }, ...riepilogo(app, f, firma, deps)));
  render();
  return pane;
}

async function apriAllegato(app, a, deps) {
  let bytes;
  try { bytes = allegatoBytes(a); } catch { return app.ui.toast('Allegato danneggiato: non è possibile decodificarlo.', { kind: 'error' }); }
  if (a.compressione) return app.ui.toast(`L'allegato è compresso (${a.compressione}): salvalo e aprilo con un programma adatto.`, { kind: 'warning', timeout: 6000 });
  const nome = allegatoNome(a);
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 1024));
  if (head.includes('%PDF-')) return app.openBytes(bytes, { name: /\.pdf$/i.test(nome) ? nome : nome + '.pdf' });
  if (looksLikeP7m(bytes)) return deps.openSignedFile(app, { bytes, name: nome });
  return salvaAllegato(app, a);
}

async function salvaAllegato(app, a) {
  try {
    const bytes = allegatoBytes(a);
    const nome = allegatoNome(a);
    const ext = nome.includes('.') ? nome.split('.').pop() : '*';
    await app.exportFile(bytes, nome, [{ name: ext.toUpperCase(), extensions: [ext] }]);
  } catch (err) { app.reportError(err, 'Allegato non salvato'); }
}
