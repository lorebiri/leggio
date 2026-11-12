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
  const voce = (x, testo, sotto, classe = '') => h('li', {}, h('button', { class: 'ar-oggi-voce ' + classe, onclick: () => apri(x.id), title: 'Apri ' + x.nome },
    h('span', { class: 'ar-oggi-t' }, testo), sotto ? h('span', { class: 'ar-oggi-s' }, sotto) : null));
  const sezione = (titolo, n, lista, render, filtro, vuota) => {
    const sec = h('section', { class: 'ar-oggi-sec' + (n ? '' : ' vuota') },
      h('header', {}, h('h3', {}, titolo, h('span', { class: 'ar-num' + (n ? ' attivo' : '') }, String(n))),
        n > max && vedi && filtro ? h('button', { class: 'btn small', onclick: () => vedi(filtro) }, 'Vedi tutti') : null));
    if (!n) sec.append(h('p', { class: 'av-note' }, vuota));
    else sec.append(h('ul', { class: 'ar-oggi-lista' }, lista.slice(0, max).map(render)));
    return sec;
  };
  const c = o.conteggi;
  const imp = A.impostazioni();
  box.replaceChildren(
    sezione('DURC scaduti o in scadenza', o.durc.length, o.durc,
      (d) => voce(d, `${d.fornitore || d.nome}`, `${testoGiorni(d.giorni)} (${dataIt(d.scadenza)}${d.calcolata ? `, calcolata: ${imp.durataDurc} giorni dalla data del documento` : ''})`, d.scaduto ? 'scaduto' : 'vicino'),
      { tipo: 'durc', ordine: 'scadenza' }, `Nessun DURC scaduto o in scadenza nei prossimi ${imp.preavvisoDurc} giorni.`),
    sezione('Fatture da pagare', c.fatture, o.fatture,
      (f) => voce(f, `${f.fornitore || f.nome}${f.importo != null ? ' — ' + euro(f.importo) : ''}`, f.scadenza ? `${testoGiorni(f.giorni, { maschile: false })} (${dataIt(f.scadenza)})` : 'senza scadenza indicata', f.scaduto ? 'scaduto' : f.vicina ? 'vicino' : ''),
      { stato: 'da-pagare', ordine: 'scadenza' }, 'Nessuna fattura segnata «Da pagare».'),
    sezione('Da protocollare', c.daProtocollare, o.daProtocollare,
      (d) => voce(d, d.nome, [d.fornitore, d.data && dataIt(d.data)].filter(Boolean).join(' · ')),
      { stato: 'da-protocollare' }, 'Nessun documento segnato «Da protocollare».'),
    sezione('Da firmare', c.daFirmare, o.daFirmare,
      (d) => voce(d, d.nome, [d.fornitore, d.data && dataIt(d.data)].filter(Boolean).join(' · ')),
      { stato: 'da-firmare' }, 'Nessun documento segnato «Da firmare».'),
    sezione('Arrivati dall\'ultima apertura', c.nuovi, o.nuovi,
      (d) => voce(d, d.nome, [TIPO_LABEL[d.tipo], d.fornitore].filter(Boolean).join(' · ')),
      { ordine: 'aggiunto-desc', dalVisto: true }, A.soglia ? 'Nessun documento nuovo nelle cartelle collegate.' : 'Alla prossima apertura qui vedrai i documenti arrivati nel frattempo.'),
  );
  return o;
}
