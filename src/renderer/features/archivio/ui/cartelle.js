// «Cartelle e privacy»: cartelle collegate, stato dell'indice, esportazione e importazione degli
// stati d'ufficio, cancellazione dell'indice.
import { formatBytes } from '../../../core/ui.js';

export async function apriCartelle(app, A) {
  const { h } = app.ui;
  const lista = h('ul', { class: 'ar-cartelle' });
  const info = h('p', { class: 'av-note' });
  async function disegna() {
    let conteggi = null;
    try { conteggi = await A.conteggi(); } catch { /* */ }
    lista.replaceChildren(...(A.cartelle.length ? A.cartelle.map((c) => h('li', {},
      h('div', { class: 'ar-cart-t' }, h('strong', {}, c.nome), h('small', {}, c.percorso),
        h('small', { class: A.offline.has(c.id) ? 'err' : '' }, A.offline.has(c.id) ? A.offline.get(c.id) : `${(conteggi?.cartelle[c.id] || 0).toLocaleString('it-IT')} documenti indicizzati${A.offline.has(c.id + ':parziale') ? ' · ' + A.offline.get(c.id + ':parziale') : ''}`)),
      h('button', { class: 'btn', onclick: async () => { await A.aggiorna({ cartelle: [c.id], motivo: 'manuale' }); disegna(); } }, 'Aggiorna'),
      h('button', { class: 'btn', onclick: async () => {
        if (!(await app.ui.confirm(`Scollegare «${c.nome}» dall'archivio? I file nella cartella non vengono toccati; spariscono solo dall'indice. Gli stati d'ufficio restano salvati e tornano se ricolleghi la cartella.`, { title: 'Scollega cartella', okLabel: 'Scollega' }))) return;
        await A.togliCartella(c.id); disegna();
      } }, 'Scollega'))) : [h('li', {}, h('span', { class: 'av-note' }, 'Nessuna cartella collegata.'))]));
    const dim = await A.store.dimensione().catch(() => null);
    const m = A.misure.ultime[0];
    info.textContent = `Indice: ${(conteggi?.totale || 0).toLocaleString('it-IT')} documenti${dim ? `, ${formatBytes(dim)} su disco` : ''}. Si trova in: ${A.datiDir || '—'}.${m ? ` Ultimo aggiornamento: ${new Date(m.fine || m.inizio).toLocaleString('it-IT')} (${m.fatti} letti in ${(m.ms / 1000).toFixed(1).replace('.', ',')} s).` : ''}`;
  }
  const body = h('div', { class: 'ar-dlg' },
    h('h3', {}, 'Cartelle collegate'),
    h('p', { class: 'av-note' }, 'Leggio legge i documenti di queste cartelle (e delle sottocartelle) senza spostarli né modificarli. Vanno bene anche cartelle di rete e di OneDrive: se non sono raggiungibili l\'indice resta e i documenti tornano disponibili quando la cartella si ricollega.'),
    lista,
    h('div', { class: 'av-row' },
      h('button', { class: 'btn primary', onclick: async () => { try { await A.aggiungiCartella(); disegna(); } catch (e) { app.reportError(e, 'Cartella non collegata'); } } }, 'Collega una cartella…'),
      h('button', { class: 'btn', onclick: async () => { await A.aggiorna({ motivo: 'manuale' }); disegna(); } }, 'Aggiorna tutte')),
    h('h3', {}, 'Stati d\'ufficio: copia di sicurezza'),
    h('p', { class: 'av-note' }, 'Gli stati («da protocollare», «pagato»…), le etichette e le note si salvano solo in Leggio. Puoi esportarli per una copia di sicurezza o per passarli a una collega che usa le stesse cartelle: vengono riconosciuti dall\'impronta del file, anche se è stato rinominato.'),
    h('div', { class: 'av-row' },
      h('button', { class: 'btn', onclick: () => esporta('json') }, 'Esporta stati (JSON)…'),
      h('button', { class: 'btn', onclick: () => esporta('csv') }, 'Esporta stati (CSV per Excel)…'),
      h('button', { class: 'btn', onclick: importa }, 'Importa stati…')),
    h('h3', {}, 'Privacy'),
    h('p', { class: 'av-note' }, 'L\'indice contiene il testo dei documenti, compresi dati personali. Resta solo su questo computer (nella cartella dei dati di Leggio), non viene mai inviato in rete e non viene condiviso. Puoi cancellarlo quando vuoi: i documenti originali non vengono toccati.'),
    info,
    h('div', { class: 'av-row' },
      h('button', { class: 'btn danger', onclick: async () => {
        if (!(await app.ui.confirm('Cancellare l\'indice dell\'archivio (testo e dati estratti)? I documenti originali, le cartelle collegate e gli stati d\'ufficio restano. L\'indice si ricostruisce al prossimo aggiornamento.', { title: 'Cancella indice', okLabel: 'Cancella indice', danger: true }))) return;
        await A.cancella(''); app.ui.toast('Indice cancellato.', { kind: 'success' }); disegna();
      } }, 'Cancella indice'),
      h('button', { class: 'btn', onclick: async () => {
        if (!(await app.ui.confirm('Cancellare TUTTO l\'archivio di Leggio: indice, stati d\'ufficio, etichette, note ed elenco delle cartelle collegate? I documenti originali non vengono toccati. Gli stati non si potranno recuperare se non hai fatto un\'esportazione.', { title: 'Cancella tutto l\'archivio', okLabel: 'Cancella tutto', danger: true }))) return;
        await A.cancella('tutto'); app.ui.toast('Archivio cancellato.', { kind: 'success' }); disegna();
      } }, 'Cancella tutto (anche gli stati)…')));

  async function esporta(formato) {
    try {
      const testo = await A.esportaStati(formato);
      const data = new Date().toISOString().slice(0, 10);
      await app.exportFile(new TextEncoder().encode(testo), `stati_archivio_${data}.${formato}`, [{ name: formato === 'csv' ? 'CSV (Excel)' : 'JSON', extensions: [formato] }]);
    } catch (e) { app.reportError(e, 'Esportazione non riuscita'); }
  }
  async function importa() {
    try {
      const files = await app.platform.openFiles({ multiple: false, raw: true, title: 'Importa stati dell\'archivio', filters: [{ name: 'Stati dell\'archivio (JSON o CSV)', extensions: ['json', 'csv'] }] });
      const f = files?.[0]; if (!f) return;
      const modo = await app.ui.choice({ title: 'Importa stati', message: `Come unire gli stati di «${f.name}» con quelli che hai già?`, buttons: [
        { value: null, label: 'Lascia perdere', left: true },
        { value: 'sostituisci', label: 'Vincono quelli importati' },
        { value: 'unisci', label: 'Vince il più recente', primary: true }] });
      if (!modo) return;
      const r = await A.importaStati(new TextDecoder().decode(f.bytes), modo);
      await app.ui.dialog({ title: 'Stati importati', cancelLabel: null, okLabel: 'Chiudi', message: `${r.totale} stati letti: ${r.nuovi} nuovi, ${r.aggiornati} aggiornati, ${r.invariati} invariati${r.scartate ? `, ${r.scartate} righe scartate` : ''}. ${r.presenti} riguardano documenti presenti ora nell'archivio; gli altri si applicheranno quando quei file compariranno nelle cartelle collegate.` });
    } catch (e) { app.reportError(e, 'Importazione non riuscita'); }
  }
  const offA = A.on((t) => { if (t === 'cartelle') disegna(); });
  disegna();
  await app.ui.dialog({ title: 'Cartelle e privacy dell\'archivio', body, okLabel: 'Chiudi', cancelLabel: null, width: 760 });
  offA();
}
