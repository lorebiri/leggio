// Scheda del documento (pannello a destra, accanto all'elenco): dati, protocollo, «pronta per il pagamento»,
// fornitore (DURC, tracciabilità, fatture da pagare) e pratica collegata (stesso protocollo, CIG o CUP) con
// il fascicolo con indice. Nessuna schermata nuova: tutto in un pannello che si chiude con un clic.
import { creaFascicolo } from '../../avanzati/lib/fascicolo.js';
import { TIPO_LABEL } from '../lib/estrai.js';
import { testoProtocollo } from '../lib/stati.js';
import { euro, dataIt } from '../lib/testo.js';
import { apriDocumento, fatturaInPdf } from './azioni.js';
import { openP7m } from '../../avanzati/lib/cades.js';
import { isDesktop } from '../store.js';

const SEMAFORO = { verde: 'Pronta per il pagamento', giallo: 'Da controllare prima di pagare', rosso: 'Non pronta per il pagamento', pagata: 'Pagata' };
export const testoSemaforo = (p) => (p ? SEMAFORO[p.esito] : '');

export async function apriScheda(app, A, riga, { q } = {}) {
  const { h } = app.ui;
  const c = app.openRightPanel('Scheda del documento', { doc: null });
  c.classList.add('ar-scheda-doc');
  const sez = (titolo, ...figli) => h('section', { class: 'ar-sch-sez' }, h('h3', {}, titolo), ...figli);
  const voce = (k, v) => (v == null || v === '' ? null : h('div', { class: 'ar-sch-voce' }, h('span', {}, k), h('strong', {}, v)));
  const apri = (r) => apriDocumento(app, A, r, { q });
  c.append(h('p', { class: 'av-note' }, 'Caricamento…'));

  const [r] = await A.righe([riga.id]);
  if (!r) { c.replaceChildren(h('p', { class: 'av-note' }, 'Il documento non è più nell\'archivio.')); return; }
  const [pratica, forn] = await Promise.all([A.pratica(r.id), r.piva ? A.fornitore(r.piva) : null]);
  c.replaceChildren();

  c.append(h('div', { class: 'ar-sch-testa' }, h('strong', {}, r.nome), h('small', {}, r.rel || ''),
    h('div', { class: 'av-row' }, h('button', { class: 'btn primary', onclick: () => apri(r) }, 'Apri'),
      isDesktop() ? h('button', { class: 'btn', onclick: () => app.platform.showInFolder(r.path) }, 'Mostra nella cartella') : null)));

  c.append(sez('Dati', voce('Tipo', TIPO_LABEL[r.tipo]), voce('Fornitore', r.fornitore), voce('P.IVA', r.piva), voce('Numero', r.numero), voce('Data', dataIt(r.data)),
    voce('Importo', r.importo != null ? euro(r.importo) : ''), voce('CIG', (r.cig || []).join(', ')), voce('CUP', (r.cup || []).join(', ')),
    voce('Scadenza', dataIt(r.scadenza)), voce('IBAN', r.iban), voce('Firme', r.firme ? (r.firmatari?.length ? r.firmatari.join(', ') : String(r.firme)) : '')));

  const s = r.stato || {};
  c.append(sez('Protocollo (Titulus)', h('p', {}, s.protocollo === 'fatto' ? testoProtocollo(s) : s.protocollo === 'da' ? 'Da protocollare in Titulus.' : s.protocollo === 'no' ? 'Non da protocollare.' : r.segnaturaDaLeggere ? 'Segnatura da leggere (in corso, in sottofondo).' : 'Nessuna segnatura trovata nel documento.')));

  if (r.pagamento) {
    const p = r.pagamento;
    c.append(sez('Pagamento', h('p', { class: 'ar-semaforo s-' + p.esito }, testoSemaforo(p)),
      p.motivi.length ? h('ul', { class: 'ar-sch-motivi' }, p.motivi.map((m) => h('li', { class: 'm-' + m.livello }, m.testo, m.id ? h('button', { class: 'btn small', onclick: async () => { const [x] = await A.righe([m.id]); if (x) apriScheda(app, A, x); } }, 'Vedi') : null))) : null,
      h('p', { class: 'av-note' }, 'Leggio segnala soltanto: il pagamento e le verifiche ufficiali restano nei sistemi dell\'ente.')));
  }

  if (forn) {
    c.append(sez(`Fornitore: ${forn.nome || forn.piva}`,
      voce('P.IVA', forn.piva),
      voce('Ultimo DURC', forn.durc[0] ? `valido fino al ${dataIt(forn.durc[0].fine)}${forn.durc[0].calcolata ? ' (calcolata)' : ''}` : 'nessuno in archivio'),
      voce('Conto dedicato (tracciabilità)', forn.tracciabilita[0] ? `${forn.tracciabilita[0].iban} (dichiarazione del ${dataIt(forn.tracciabilita[0].data) || '—'})` : 'nessuna dichiarazione in archivio'),
      voce('Fatture non pagate', forn.totaleNonPagate ? `${forn.totaleNonPagate} (${forn.fattureNonPagate.filter((f) => ['rosso', 'giallo'].includes(f.pagamento?.esito)).length} da controllare)` : 'nessuna'),
      forn.totaleNonPagate ? h('button', { class: 'btn small', onclick: () => A.emit('vedi', { filtro: { fornitore: forn.piva, tipo: 'fattura', ordine: 'scadenza' } }) }, 'Vedi le fatture del fornitore') : null));
  }

  // pratica collegata
  const altri = pratica?.documenti.filter((d) => !d.questo) || [];
  const chiavi = [pratica?.chiavi.protocollo && `protocollo ${pratica.chiavi.protocollo}`, pratica?.chiavi.cig.length && `CIG ${pratica.chiavi.cig.join(', ')}`, pratica?.chiavi.cup.length && `CUP ${pratica.chiavi.cup.join(', ')}`].filter(Boolean).join(' · ');
  const praticaSez = sez('Pratica collegata',
    h('p', { class: 'av-note' }, chiavi ? `Documenti con lo stesso ${chiavi}, in ordine di data.` : 'Il documento non ha protocollo, CIG o CUP: nessuna pratica da collegare.'));
  if (altri.length) {
    praticaSez.append(h('ol', { class: 'ar-pratica' }, pratica.documenti.map((d) => h('li', { class: d.questo ? 'questo' : '' },
      h('button', { class: 'ar-pratica-voce', onclick: () => (d.questo ? apri(d) : apriScheda(app, A, d)) },
        h('span', { class: 'ar-tipo t-' + d.tipo }, TIPO_LABEL[d.tipo] || 'Altro'),
        h('span', {}, h('strong', {}, d.nome), h('small', {}, [dataIt(d.data), d.stato?.protocollo === 'fatto' && d.stato.numeroProtocollo ? `prot. ${d.stato.numeroProtocollo}` : '', d.questo ? 'questo documento' : `stesso ${d.perche.join(', ')}`].filter(Boolean).join(' · ')))),
    ))));
    praticaSez.append(h('div', { class: 'av-row' }, h('button', { class: 'btn', onclick: () => fascicolo(app, A, pratica, r) }, `Crea il fascicolo con indice (${pratica.documenti.length} documenti)…`)));
    // liste di controllo dell'area avanzati, solo se l'ufficio le ha attivate
    if (typeof app.services?.listaControlloPratica === 'function') {
      try {
        const lista = await app.services.listaControlloPratica(pratica.documenti);
        if (lista?.voci?.length) praticaSez.append(h('h4', {}, lista.titolo || 'Lista di controllo'), h('ul', { class: 'ar-sch-motivi' }, lista.voci.map((v) => h('li', { class: v.presente ? 'm-ok' : 'm-giallo' }, `${v.presente ? 'Presente' : 'Manca'}: ${v.testo}`))));
      } catch (e) { app.log?.('warn', 'archivio: lista di controllo non disponibile', { e: e.message }); }
    }
  }
  c.append(praticaSez);
}

/** Fascicolo con indice della pratica (libreria dell'area avanzati), salvato dove sceglie l'utente. */
async function fascicolo(app, A, pratica, r0) {
  const docs = pratica.documenti.filter((d) => !d.offline);
  const titoli = (d) => [d.nome.replace(/\.(pdf|xml|p7m)+$/i, ''), d.stato?.protocollo === 'fatto' && d.stato.numeroProtocollo ? `prot. ${d.stato.numeroProtocollo}${d.stato.dataProtocollo ? ' del ' + dataIt(d.stato.dataProtocollo) : ''}` : ''].filter(Boolean).join(' — ');
  const v = await app.ui.dialog({ title: 'Fascicolo della pratica', fields: [{ name: 'titolo', label: 'Titolo', type: 'text', value: `Pratica ${pratica.chiavi.cig[0] ? 'CIG ' + pratica.chiavi.cig[0] : pratica.chiavi.protocollo ? 'prot. ' + pratica.chiavi.protocollo : r0.nome}` }], okLabel: 'Crea il fascicolo' });
  if (!v) return;
  let risultato;
  await app.ui.withProgress('Fascicolo della pratica', async (p) => {
    const input = []; const saltati = [];
    for (const [i, d] of docs.entries()) {
      if (p.cancelled) return;
      p.set(i / docs.length * 0.5, `Lettura di ${d.nome}`);
      try {
        let bytes;
        if (d.contenuto === 'fattura') bytes = (await fatturaInPdf(app, A, d)).bytes;
        else if (d.ext === 'p7m') bytes = (await openP7m(await A.leggiBytes(d.path), { verify: false })).content;
        else bytes = await A.leggiBytes(d.path);
        if (bytes) input.push({ titolo: titoli(d), bytes }); else saltati.push({ titolo: d.nome, motivo: 'non convertibile' });
      } catch (e) { saltati.push({ titolo: d.nome, motivo: e.message }); }
    }
    const out = await creaFascicolo(app.lib.PDFLib, input, { titolo: v.titolo, sottotitolo: `Creato con Leggio dall'archivio il ${new Date().toLocaleDateString('it-IT')}`, etichetta: 'Allegato', numeriPagina: true, signal: p.signal, onProgress: (f, m) => p.set(0.5 + f * 0.45, m) });
    risultato = { bytes: await app.lib.savePdfLib(out.pdfDoc), saltati: [...saltati, ...out.saltati] };
  });
  if (!risultato) return;
  await app.exportFile(risultato.bytes, `${v.titolo.replace(/[\\/:*?"<>|]+/g, '_')}.pdf`, [{ name: 'PDF', extensions: ['pdf'] }]);
  if (risultato.saltati.length) app.ui.toast(`Non inseriti nel fascicolo: ${risultato.saltati.map((s) => `${s.titolo} (${s.motivo})`).join('; ')}`, { kind: 'warning', timeout: 10000 });
}
