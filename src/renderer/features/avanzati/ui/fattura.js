// Visualizzazione della fattura elettronica (FatturaPA) con stampa, salvataggio in PDF e allegati.
import { parseFattura, fatturaDocument, nomeProposto, allegatoBytes, allegatoNome, euro, dataIt } from '../lib/fattura.js';
import { looksLikeP7m } from '../lib/cades.js';
import { ESITI } from '../lib/report.js';
import { isDesktop, call } from '../native.js';

export async function openFattura(app, bytes, name, { firma = null } = {}, deps) {
  let f;
  try { f = parseFattura(bytes); }
  catch (err) {
    return app.ui.dialog({ title: 'Fattura non leggibile', message: `«${name}» non può essere visualizzato: ${err.message}`, cancelLabel: null, okLabel: 'Chiudi' });
  }
  let compatta = app.settings.get('avanzati.fattura.compatta', false);
  const { h } = app.ui;
  const c0 = f.corpi[0];
  const pane = deps.openPane(app, { title: `Fattura n. ${c0.numero || '—'} del ${dataIt(c0.data) || '—'}`, subtitle: `${f.cedente?.nome || ''} — ${name}${f.corpi.length > 1 ? ` — ${f.corpi.length} documenti nel file` : ''}`, id: 'fattura' });
  const firmaTesto = firma ? `Firmato digitalmente: ${firma.result.levels.flatMap((l) => l.signers.map((s) => s.name)).join(', ')} — esito verifica: ${ESITI[firma.stato].titolo}` : '';
  const frame = h('iframe', { class: 'av-fattura-frame', title: 'Fattura impaginata', sandbox: 'allow-same-origin allow-modals' });
  const html = () => fatturaDocument(f, { compatta, firma: firmaTesto, nomeFile: name });
  const render = () => { frame.srcdoc = html(); };
  const toggle = h('button', { class: 'btn', onclick: () => { compatta = !compatta; app.settings.set('avanzati.fattura.compatta', compatta); toggle.textContent = compatta ? 'Vista completa' : 'Vista compatta'; render(); } }, compatta ? 'Vista completa' : 'Vista compatta');
  pane.actions.append(
    h('button', { class: 'btn primary', onclick: () => salvaPdf(app, f, html(), { apri: false }) }, 'Salva come PDF…'),
    isDesktop() ? h('button', { class: 'btn', onclick: () => salvaPdf(app, f, html(), { apri: true }) }, 'Apri come PDF') : null,
    h('button', { class: 'btn', onclick: () => { try { frame.contentWindow.focus(); frame.contentWindow.print(); } catch (e) { app.reportError(e, 'Stampa non riuscita'); } } }, 'Stampa…'),
    toggle);
  const side = h('aside', { class: 'av-fattura-side' });
  // riepilogo veloce: CIG/CUP, totali, avvisi, allegati, firma
  f.corpi.forEach((c, i) => {
    const box = h('div', { class: 'av-box' },
      f.corpi.length > 1 ? h('h3', {}, `Documento ${i + 1}: n. ${c.numero}`) : h('h3', {}, 'In breve'),
      h('dl', { class: 'av-dl' },
        h('dt', {}, 'CIG'), h('dd', { class: c.cig.length ? 'av-code' : 'av-missing' }, c.cig.join(', ') || 'non indicato'),
        h('dt', {}, 'CUP'), h('dd', { class: c.cup.length ? 'av-code' : 'av-missing' }, c.cup.join(', ') || 'non indicato'),
        h('dt', {}, 'Totale'), h('dd', {}, euro(c.calcoli.totale, c.divisa)),
        c.calcoli.split ? [h('dt', {}, 'Da pagare al fornitore'), h('dd', {}, euro(c.calcoli.nettoAPagare, c.divisa) + ' (scissione dei pagamenti)')] : null,
        c.pagamenti[0]?.dettagli[0]?.scadenza ? [h('dt', {}, 'Scadenza'), h('dd', {}, dataIt(c.pagamenti[0].dettagli[0].scadenza))] : null),
      c.avvisi.filter((a) => a.livello !== 'info').map((a) => h('p', { class: 'av-warn' }, a.testo)));
    side.append(box);
    if (c.allegati.length) {
      side.append(h('div', { class: 'av-box' }, h('h3', {}, `Allegati nella fattura (${c.allegati.length})`),
        h('ul', { class: 'av-list' }, c.allegati.map((a) => h('li', {},
          h('div', { class: 'av-list-name' }, allegatoNome(a)), a.descrizione ? h('small', {}, a.descrizione) : null,
          h('div', { class: 'av-row' },
            h('button', { class: 'btn small', onclick: () => apriAllegato(app, a, deps) }, 'Apri'),
            h('button', { class: 'btn small', onclick: () => salvaAllegato(app, a) }, 'Salva…')))))));
    }
  });
  if (firma) {
    side.append(h('div', { class: 'av-box' }, h('h3', {}, 'Firma digitale'),
      deps.signatureView(app, firma, { compact: true }),
      h('div', { class: 'av-btn-col' },
        h('button', { class: 'btn small', onclick: () => deps.saveContent(app, firma) }, 'Salva l\'XML della fattura…'),
        h('button', { class: 'btn small', onclick: () => deps.saveReport(app, firma) }, 'Salva rapporto di verifica (PDF)…'))));
  }
  pane.body.classList.add('av-fattura-body');
  pane.body.append(h('div', { class: 'av-fattura-doc' }, frame), side);
  render();
  return pane;
}

async function salvaPdf(app, f, html, { apri }) {
  const nome = nomeProposto(f);
  if (!isDesktop()) {
    app.ui.toast('Nell\'anteprima web usa «Stampa…» e scegli «Salva come PDF» come stampante.', { kind: 'info', timeout: 7000 });
    return;
  }
  try {
    const bytes = await app.ui.withProgress('Creazione del PDF della fattura', async (p) => { p.set(null, 'Impaginazione…'); return call(app, 'html-to-pdf', { html, pageSize: 'A4', margins: 0 }); }, { cancellable: false });
    if (!bytes) return;
    const named = await setTitle(app, bytes, nome.replace(/\.pdf$/, ''));
    if (apri) await app.openBytes(named, { name: nome });
    else await app.exportFile(named, nome, [{ name: 'PDF', extensions: ['pdf'] }]);
  } catch (err) { app.reportError(err, 'PDF della fattura non creato'); }
}

async function setTitle(app, bytes, title) {
  try { const d = await app.lib.openPdfLib(bytes); d.setTitle(title); d.setLanguage('it-IT'); d.setCreator('Leggio'); return await app.lib.savePdfLib(d); } catch { return bytes; }
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
