// «Oggi»: scadenzario dell'ufficio. DURC in scadenza o scaduti, fatture da pagare, documenti da
// protocollare o da firmare, documenti arrivati dall'ultima apertura. Ogni voce si apre con un clic.
import { testoGiorni } from '../lib/scadenze.js';
import { euro, dataIt } from '../lib/testo.js';
import { TIPO_LABEL } from '../lib/estrai.js';

/**
 * Disegna il riepilogo in `box`. opts: { compatto, apri(id), vedi(filtro) }
 * vedi(filtro) apre l'archivio con un filtro (es. { stato: 'da-pagare' }).
 */
export async function disegnaOggi(app, A, box, { compatto = false, apri, vedi } = {}) {
  const { h } = app.ui;
  let o;
  try { o = await A.oggi(); } catch (e) { box.replaceChildren(h('p', { class: 'av-note' }, 'Riepilogo non disponibile: ' + e.message)); return null; }
  const max = compatto ? 4 : 50;
  // ogni voce si apre con un clic; «extra» è un pulsante d'azione in più (es. «Non serve»)
  const voce = (x, testo, sotto, classe = '', extra = null) => h('li', { class: 'ar-oggi-li' }, h('button', { class: 'ar-oggi-voce ' + classe, onclick: () => apri(x.id), title: 'Apri ' + x.nome },
    h('span', { class: 'ar-oggi-t' }, testo), sotto ? h('span', { class: 'ar-oggi-s' }, sotto) : null), extra);
  // le sezioni vuote non si mostrano: in «Oggi» compare solo quello che c'è da fare
  const sezione = (titolo, n, lista, render, filtro, nota) => {
    if (!n) return null;
    const sec = h('section', { class: 'ar-oggi-sec' },
      h('header', {}, h('h3', {}, titolo, h('span', { class: 'ar-num attivo' }, String(n))),
        n > max && vedi && filtro ? h('button', { class: 'btn small', onclick: () => vedi(filtro) }, 'Vedi tutti') : null));
    sec.append(h('ul', { class: 'ar-oggi-lista' }, lista.slice(0, max).map(render)));
    if (nota && !compatto) sec.append(h('p', { class: 'av-note ar-oggi-nota' }, nota));
    return sec;
  };
  const c = o.conteggi;
  const imp = A.impostazioni();
  const nonServe = (d) => h('button', { class: 'btn small', title: 'Questo documento non va protocollato', onclick: async (e) => { e.stopPropagation(); await A.cambiaStato([d.id], { imposta: 'non-da-protocollare' }); } }, 'Non serve');
  const daProtocollare = [...o.daProtocollare.map((d) => ({ ...d, segnato: true })), ...o.nonProtocollati];
  const sezioni = [
    sezione('Anomalie di protocollo', c.anomalie, o.anomalie,
      (a) => h('li', { class: 'ar-oggi-li' }, h('button', { class: 'ar-oggi-voce scaduto', onclick: () => vedi?.({ protocollo: a.numero, ordine: 'data-asc' }) },
        h('span', { class: 'ar-oggi-t' }, `Prot. n. ${a.numero}${a.data ? ' del ' + dataIt(a.data) : ''} su ${a.documenti.length} documenti diversi`), h('span', { class: 'ar-oggi-s' }, a.nome))),
      null, 'Lo stesso numero di protocollo è stato letto o scritto su documenti con contenuto diverso: controlla in Titulus quale è giusto e correggi il numero inserito a mano.'),
    sezione('Fatture elettroniche: termine SdI', c.sdi, o.sdi,
      (f) => voce(f, f.fornitore || f.nome, `${f.giorni === 0 ? 'ultimo giorno' : `restano ${f.giorni} giorni`} per accettare o rifiutare (fino al ${dataIt(f.fine)})${f.stimata ? ' · data di ricezione stimata dal file' : ''}`, f.giorni <= 2 ? 'scaduto' : 'vicino'),
      null, '15 giorni dalla ricezione, poi vale la decorrenza termini. L\'esito si dà in U-GOV; segna qui la fattura («Da pagare», «Pagato»…) e sparisce dall\'elenco.'),
    sezione('Pagamenti in scadenza', c.inScadenza, o.inScadenza,
      (f) => voce(f, `${f.fornitore || f.nome}${f.importo != null ? ' — ' + euro(f.importo) : ''}`, `${testoGiorni(f.giorni, { maschile: false })} (${dataIt(f.scadenza)})${f.fonte === 'pcc' ? ' · 30 giorni dalla ricezione' + (f.stimata ? ' (stimata)' : '') : ''}`, f.scaduto ? 'scaduto' : 'vicino'),
      { tipo: 'fattura', scadenzaProssima: true, ordine: 'scadenza' }, 'Dalla scadenza in fattura o, se manca, dai 30 giorni dell\'indicatore di tempestività. Con «Scheda» vedi se la fattura è pronta (DURC alla data, IBAN). Segnala «Da pagare» o «Pagato» e sparisce da qui.'),
    sezione('Fatture da pagare', c.fatture, o.fatture,
      (f) => voce(f, `${f.fornitore || f.nome}${f.importo != null ? ' — ' + euro(f.importo) : ''}`, f.scadenza ? `${testoGiorni(f.giorni, { maschile: false })} (${dataIt(f.scadenza)})` : 'senza scadenza indicata', f.scaduto ? 'scaduto' : f.vicina ? 'vicino' : ''),
      { stato: 'da-pagare', ordine: 'scadenza' }),
    sezione('DURC scaduti o in scadenza', o.durc.length, o.durc,
      (d) => voce(d, `${d.fornitore || d.nome}`, `${testoGiorni(d.giorni)} (${dataIt(d.scadenza)}${d.calcolata ? `, calcolata: ${imp.durataDurc} giorni dalla data del documento` : ''})`, d.scaduto ? 'scaduto' : 'vicino'),
      { tipo: 'durc', ordine: 'scadenza' }),
    sezione('Da protocollare in Titulus', daProtocollare.length, daProtocollare,
      (d) => voce(d, d.nome, d.segnato ? [d.fornitore, d.data && dataIt(d.data)].filter(Boolean).join(' · ') : `arrivato da ${d.giorni} giorni, nessuna segnatura${d.fornitore ? ' · ' + d.fornitore : ''}`, '', d.segnato ? null : nonServe(d)),
      { stato: 'da-protocollare' }, 'Il protocollo si fa in Titulus. Quando il documento torna con la segnatura, Leggio la legge e lo toglie da qui.'),
    sezione('Da firmare', c.daFirmare, o.daFirmare,
      (d) => voce(d, d.nome, [d.fornitore, d.data && dataIt(d.data)].filter(Boolean).join(' · ')),
      { stato: 'da-firmare' }),
    sezione('Da pubblicare (Trasparenza)', c.pubblicazioni, o.pubblicazioni,
      (d) => voce(d, d.nome, d.entro ? `pubblicare entro il ${dataIt(d.entro)} (3 mesi dal conferimento)${d.finoAl ? ` · tenere pubblicato fino al ${dataIt(d.finoAl)}` : ''}` : 'data del conferimento non riconosciuta', d.giorni != null && d.giorni < 0 ? 'scaduto' : d.giorni != null && d.giorni <= 15 ? 'vicino' : ''),
      { stato: 'da-pubblicare' }, 'Art. 15 d.lgs. 33/2013 (da verificare): entro 3 mesi dal conferimento, per 3 anni dalla cessazione. Prima di pubblicare usa «Pronto per la pubblicazione».'),
    sezione('Arrivati dall\'ultima apertura', c.nuovi, o.nuovi,
      (d) => voce(d, d.nome, [TIPO_LABEL[d.tipo], d.fornitore].filter(Boolean).join(' · ')),
      { ordine: 'aggiunto-desc', dalVisto: true }),
  ].filter(Boolean);
  box.replaceChildren(...(sezioni.length ? sezioni : [h('p', { class: 'ar-oggi-niente' }, 'Niente da fare in archivio oggi.')]));
  return o;
}
