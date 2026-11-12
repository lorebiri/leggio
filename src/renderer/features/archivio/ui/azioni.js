// Azioni sui documenti dell'archivio: aprire alla pagina giusta, cambiare stato, etichette e note,
// esportare il registro, azioni guidate (operazioni dell'area avanzati), copie con il nome proposto.
// Gli originali non vengono mai modificati: i risultati sono sempre copie.
import { tutteLeOperazioni, validaSequenza, eseguiSequenza, nomeUscita, SkipError } from '../../avanzati/lib/batch-ops.js';
import { proponiNome, REGOLA_PREDEFINITA } from '../../avanzati/lib/rinomina.js';
import { VOCI_STATO } from '../lib/stati.js';
import { registroCsv, registroXlsx } from '../lib/esporta.js';
import { TIPO_LABEL } from '../lib/estrai.js';
import { isDesktop } from '../store.js';

const MAX_ELABORA = 300 * 1024 * 1024;

/** Apre un documento dell'archivio in sola lettura, alla pagina della ricerca. */
export async function apriDocumento(app, A, riga, { q, pagina } = {}) {
  if (riga.offline) { app.ui.toast(`La cartella di «${riga.nome}» non è raggiungibile in questo momento.`, { kind: 'warning', timeout: 7000 }); return; }
  const opts = { readOnly: true };
  if (pagina) opts.page = pagina;
  if (q && String(q).trim()) opts.search = String(q).trim().replace(/^"|"$/g, '');
  try {
    if (riga.ext === 'pdf' && isDesktop()) await app.openPath(riga.path, opts);
    else {
      const bytes = await A.leggiBytes(riga.path);
      await app.openFile({ path: isDesktop() ? riga.path : null, name: riga.nome, bytes }, opts);
    }
  } catch (e) { app.reportError(e, `Impossibile aprire «${riga.nome}»`); }
}

/** Dialogo «Cambia stato» per uno o più documenti. */
export async function dialogoStato(app, A, righe) {
  const n = righe.length;
  if (!n) return app.ui.toast('Seleziona prima uno o più documenti.', { kind: 'warning' });
  const v = await app.ui.dialog({
    title: n === 1 ? `Stato di «${righe[0].nome}»` : `Stato di ${n} documenti`,
    message: 'Lo stato si salva nell\'archivio di Leggio, non nel file: i documenti firmati restano intatti.',
    fields: [
      { name: 'azione', label: 'Che cosa vuoi fare', type: 'radio', value: 'imposta', options: [{ value: 'imposta', label: 'Imposta uno stato' }, { value: 'togli', label: 'Togli uno stato' }] },
      { name: 'stato', label: 'Stato', type: 'select', value: 'da-protocollare', options: VOCI_STATO.map((s) => ({ value: s.id, label: s.label })) },
      { name: 'numero', label: 'Numero di protocollo (solo per «Protocollato»)', type: 'text', value: '', placeholder: n > 1 ? 'Il primo numero: ai documenti successivi il numero seguente' : 'es. 1234' },
    ],
    okLabel: n === 1 ? 'Applica' : `Applica a ${n} documenti`,
  });
  if (!v) return;
  if (v.azione === 'togli') { await A.cambiaStato(righe.map((r) => r.id), { togli: v.stato }); app.ui.toast(`Stato tolto da ${n === 1 ? '1 documento' : n + ' documenti'}.`, { kind: 'success' }); return; }
  if (v.stato === 'protocollato' && v.numero.trim()) {
    const base = parseInt(v.numero.replace(/\D/g, ''), 10);
    const voci = righe.map((r, i) => ({ id: r.id, modifica: { imposta: 'protocollato', numeroProtocollo: n > 1 && Number.isFinite(base) ? String(base + i).padStart(v.numero.trim().length, '0') : v.numero.trim() } }));
    await A.cambiaStati(voci);
  } else await A.cambiaStato(righe.map((r) => r.id), { imposta: v.stato });
  app.ui.toast(`«${VOCI_STATO.find((s) => s.id === v.stato)?.label}» applicato a ${n === 1 ? '1 documento' : n + ' documenti'}.`, { kind: 'success' });
}

/** Etichette libere e nota. */
export async function dialogoEtichette(app, A, righe) {
  const n = righe.length;
  if (!n) return app.ui.toast('Seleziona prima uno o più documenti.', { kind: 'warning' });
  const nota = n === 1 ? righe[0].stato?.nota || '' : '';
  const v = await app.ui.dialog({
    title: n === 1 ? `Etichette e nota di «${righe[0].nome}»` : `Etichette di ${n} documenti`,
    fields: [
      { name: 'aggiungi', label: 'Aggiungi etichette (separate da virgola)', type: 'text', value: '', placeholder: 'es. progetto PNRR, gara 2026, ispezione' },
      { name: 'togli', label: 'Togli etichette (separate da virgola)', type: 'text', value: '' },
      ...(n === 1 ? [{ name: 'nota', label: 'Nota', type: 'textarea', value: nota, rows: 4 }] : [{ name: 'nota', label: 'Nota (lascia vuoto per non cambiarla)', type: 'textarea', value: '', rows: 3 }]),
    ],
    okLabel: 'Salva',
  });
  if (!v) return;
  const lista = (s) => String(s || '').split(',').map((x) => x.trim()).filter(Boolean);
  const modifica = { aggiungiEtichette: lista(v.aggiungi), togliEtichette: lista(v.togli) };
  if (n === 1 || v.nota.trim()) modifica.nota = v.nota;
  await A.cambiaStato(righe.map((r) => r.id), modifica);
  app.ui.toast('Salvato nell\'archivio.', { kind: 'success' });
}

/** Esporta le righe come registro (Excel o CSV). */
export async function esportaRegistro(app, righe, formato = 'xlsx') {
  if (!righe.length) return app.ui.toast('Nessun documento da esportare.', { kind: 'warning' });
  const data = new Date().toISOString().slice(0, 10);
  if (formato === 'csv') {
    const bytes = new TextEncoder().encode(registroCsv(righe));
    await app.exportFile(bytes, `registro_archivio_${data}.csv`, [{ name: 'CSV (Excel)', extensions: ['csv'] }]);
  } else {
    await app.exportFile(registroXlsx(righe), `registro_archivio_${data}.xlsx`, [{ name: 'Cartella di lavoro Excel', extensions: ['xlsx'] }]);
  }
}

// ---------------- azioni guidate ----------------
function operazioni(app) {
  const esterne = [];
  try { app.bus.emit('batch:operations', esterne); } catch (e) { console.error(e); }
  return tutteLeOperazioni(esterne);
}

/** Le stesse operazioni e sequenze salvate delle «Azioni guidate», applicate ai documenti scelti. */
export async function azioniGuidate(app, A, righe) {
  const pdf = righe.filter((r) => r.ext === 'pdf' && !r.offline);
  const altri = righe.length - pdf.length;
  if (!pdf.length) return app.ui.toast('Le azioni guidate lavorano sui PDF: tra i documenti scelti non ce ne sono (o la cartella non è raggiungibile).', { kind: 'warning', timeout: 7000 });
  const ops = operazioni(app);
  const sequenze = app.settings.get('avanzati.sequenze', null) || [];
  const scelte = [
    ...sequenze.map((s, i) => ({ value: 'seq:' + i, label: 'Sequenza salvata: ' + s.nome })),
    ...ops.map((o) => ({ value: 'op:' + o.id, label: o.label })),
  ];
  const v = await app.ui.dialog({
    title: `Azioni guidate su ${pdf.length} ${pdf.length === 1 ? 'documento' : 'documenti'}`,
    message: `Le copie elaborate vanno nella sottocartella «Elaborati» accanto a ogni originale (o in una cartella che scegli). Gli originali non vengono toccati.${altri ? ` ${altri} documenti non PDF o non raggiungibili verranno saltati.` : ''}`,
    fields: [
      { name: 'cosa', label: 'Operazione o sequenza', type: 'select', value: scelte[0]?.value, options: scelte },
      { name: 'dove', label: 'Dove salvare le copie', type: 'radio', value: 'elaborati', options: [{ value: 'elaborati', label: 'Nella sottocartella «Elaborati» accanto agli originali' }, { value: 'altra', label: 'In un\'altra cartella…' }] },
      { name: 'nome', label: 'Nome delle copie', type: 'select', value: 'stesso', options: [{ value: 'stesso', label: 'Stesso nome dell\'originale' }, { value: 'suffisso', label: 'Nome con «_elaborato»' }, { value: 'contenuto', label: 'Nome proposto dal contenuto' }] },
      { name: 'segna', label: 'Con il timbro di protocollo, segna gli originali come «Protocollato n. …»', type: 'checkbox', value: true },
    ],
    okLabel: 'Avanti',
  });
  if (!v) return;
  let passi;
  if (v.cosa?.startsWith('seq:')) passi = structuredClone(sequenze[+v.cosa.slice(4)]?.passi || []);
  else {
    const o = ops.find((x) => x.id === v.cosa.slice(3));
    if (!o) return;
    const fields = (o.fields || []).map((f) => ({ ...f }));
    if (o.id === 'protocollo') {
      const pref = app.settings.get('avanzati.protocollo', {}) || {};
      for (const f of fields) if (pref[f.name] != null && f.name !== 'numero') f.value = pref[f.name];
      const cont = app.settings.get('avanzati.protocollo.contatore', null);
      const f = fields.find((x) => x.name === 'numero');
      if (f && cont?.anno === new Date().getFullYear() && cont.prossimo) f.value = String(cont.prossimo);
    }
    let params = {};
    if (fields.some((f) => f.type !== 'info')) {
      params = await app.ui.dialog({ title: o.label, message: o.description, fields, okLabel: 'Conferma', validate: (x) => o.validate?.(x) || null });
      if (!params) return;
    }
    passi = [{ op: o.id, params }];
  }
  for (const s of passi) {
    if (s.op === 'proteggi' && !s.params?.password) {
      const pw = await app.ui.prompt('Password per aprire i file', '', { title: 'Proteggi con password', type: 'password', okLabel: 'Conferma' });
      if (!pw) return; s.params = { ...s.params, password: pw };
    }
  }
  const err = validaSequenza(passi, ops);
  if (err) return app.ui.toast(err, { kind: 'warning', timeout: 7000 });
  let cartella = null;
  if (v.dove === 'altra') { cartella = await A.store.scegliDestinazione('Dove salvare le copie elaborate'); if (!cartella) return; }

  const esiti = []; const protocolli = [];
  const t0 = Date.now();
  await app.ui.withProgress('Azioni guidate sull\'archivio', async (p) => {
    for (let i = 0; i < pdf.length; i++) {
      if (p.cancelled) break;
      const r = pdf[i];
      p.set(i / pdf.length, `Documento ${i + 1} di ${pdf.length}: ${r.nome}`);
      const ctx = { index: i, name: r.nome };
      try {
        if (r.size > MAX_ELABORA) throw new SkipError('Il file è troppo grande (oltre 300 MB).');
        if (r.protetto) throw new SkipError('Il file è protetto da password.');
        const bytes = await A.leggiBytes(r.path);
        const out = await eseguiSequenza(bytes, passi, { PDFLib: app.lib.PDFLib, openPdfLib: (b) => app.lib.openPdfLib(b), savePdfLib: (d) => app.lib.savePdfLib(d), ops, ctx, signal: p.signal });
        const nome = v.nome === 'contenuto' ? nomeProposto(r) : nomeUscita(r.nome, { modo: v.nome });
        const dove = await A.store.scriviCopia({ origine: r.path, cartella: cartella && cartella !== '__download__' ? cartella : null, sotto: 'Elaborati', nome, bytes: out });
        esiti.push({ r, ok: true, dove, note: ctx.note || '' });
        const m = String(ctx.note || '').match(/Prot\. n\. (\S+)/);
        if (m) protocolli.push({ id: r.id, modifica: { imposta: 'protocollato', numeroProtocollo: m[1], dataProtocollo: new Date().toISOString().slice(0, 10) } });
      } catch (e) {
        if (e?.name === 'AbortError') break;
        esiti.push({ r, ok: false, skip: e instanceof SkipError, motivo: e?.message || String(e) });
      }
      await new Promise((res) => setTimeout(res, 0));
    }
  });
  // contatore di protocollo condiviso con l'area avanzati
  const prot = passi.find((s) => s.op === 'protocollo');
  if (prot && protocolli.length) {
    const base = parseInt(String(prot.params.numero).replace(/\D/g, ''), 10);
    if (Number.isFinite(base)) app.settings.set('avanzati.protocollo.contatore', { anno: new Date().getFullYear(), prossimo: base + pdf.length });
  }
  if (v.segna && protocolli.length) await A.cambiaStati(protocolli);
  const ok = esiti.filter((e) => e.ok).length; const ko = esiti.length - ok;
  // le copie nelle cartelle collegate entrano nell'archivio alla prossima scansione
  if (ok && !cartella) A.aggiorna({ motivo: 'azioni', silenzioso: true }).catch(() => {});
  await rapporto(app, `${ok} copie create${ko ? `, ${ko} documenti non elaborati` : ''} in ${Math.max(1, Math.round((Date.now() - t0) / 1000))} s.${protocolli.length && v.segna ? ` ${protocolli.length} originali segnati come protocollati.` : ''}`, esiti);
}

async function rapporto(app, titolo, esiti) {
  const { h } = app.ui;
  const ko = esiti.filter((e) => !e.ok);
  const primo = esiti.find((e) => e.ok && e.dove && isDesktop());
  const v = await app.ui.dialog({
    title: 'Rapporto finale', message: titolo, okLabel: primo ? 'Mostra nella cartella' : 'Chiudi', cancelLabel: primo ? 'Chiudi' : null,
    body: ko.length ? h('details', { class: 'ar-rapporto', open: ko.length < 15 }, h('summary', {}, `Non elaborati (${ko.length})`), h('ul', {}, ko.slice(0, 300).map((e) => h('li', {}, `${e.r.rel || e.r.nome} — ${e.motivo}`)))) : null,
  });
  if (v && primo) app.platform.showInFolder(primo.dove);
}

const TIPO_RINOMINA = { fattura: 'Fattura', 'nota-credito': 'NotaCredito', durc: 'DURC', ordine: 'Ordine', missione: 'Missione', contratto: 'Contratto', pec: 'PEC', p7m: 'Documento', altro: 'Documento' };
/** Nome proposto dal contenuto (stessa regola della «Rinomina dal contenuto»), mantenendo l'estensione. */
export function nomeProposto(r, regola) {
  const base = proponiNome({ tipo: TIPO_RINOMINA[r.tipo] || 'Documento', soggetto: r.fornitore, numero: r.numero, data: r.data, scadenza: r.scadenza, originale: r.nome.replace(/(\.[a-z0-9]+)+$/i, '') }, regola || REGOLA_PREDEFINITA);
  const ext = (r.nome.match(/((?:\.[a-z0-9]{2,4}){1,2})$/i)?.[1] || '.pdf').toLowerCase();
  return base.replace(/\.pdf$/i, '') + (ext.endsWith('.p7m') || ext === '.xml' || ext === '.eml' ? ext : '.pdf');
}

/** Salva copie dei documenti con il nome proposto dal contenuto (gli originali restano dove sono). */
export async function copieConNomeProposto(app, A, righe) {
  const docs = righe.filter((r) => !r.offline);
  if (!docs.length) return app.ui.toast('Seleziona prima uno o più documenti raggiungibili.', { kind: 'warning' });
  const regola = app.settings.get('avanzati.rinomina.regola', REGOLA_PREDEFINITA) || REGOLA_PREDEFINITA;
  const { h } = app.ui;
  const anteprima = h('table', { class: 'ar-anteprima' }, h('tr', {}, h('th', {}, 'Nome attuale'), h('th', {}, 'Nome proposto')),
    docs.slice(0, 12).map((r) => h('tr', {}, h('td', {}, r.nome), h('td', {}, nomeProposto(r, regola)))));
  const v = await app.ui.dialog({
    title: `Copie con il nome proposto (${docs.length})`,
    message: 'Leggio crea una copia di ogni documento con un nome ricavato dal contenuto. Gli originali non vengono rinominati né spostati.',
    body: h('div', {}, anteprima, docs.length > 12 ? h('p', { class: 'av-note' }, `… e altri ${docs.length - 12}`) : null),
    fields: [{ name: 'dove', label: 'Dove salvare le copie', type: 'radio', value: 'elaborati', options: [{ value: 'elaborati', label: 'Nella sottocartella «Rinominati» accanto agli originali' }, { value: 'altra', label: 'In un\'altra cartella…' }] }],
    okLabel: 'Crea le copie', width: 720,
  });
  if (!v) return;
  let cartella = null;
  if (v.dove === 'altra') { cartella = await A.store.scegliDestinazione('Dove salvare le copie rinominate'); if (!cartella) return; }
  const esiti = [];
  await app.ui.withProgress('Copie con il nome proposto', async (p) => {
    for (let i = 0; i < docs.length; i++) {
      if (p.cancelled) break;
      const r = docs[i];
      p.set(i / docs.length, `${i + 1} di ${docs.length}: ${r.nome}`);
      try {
        const dove = await A.store.copiaFile({ path: r.path, cartella: cartella && cartella !== '__download__' ? cartella : null, sotto: 'Rinominati', nome: nomeProposto(r, regola) });
        esiti.push({ r, ok: true, dove });
      } catch (e) { esiti.push({ r, ok: false, motivo: e.message }); }
    }
  });
  const ok = esiti.filter((e) => e.ok).length;
  if (ok && !cartella) A.aggiorna({ motivo: 'copie', silenzioso: true }).catch(() => {});
  await rapporto(app, `${ok} copie create${esiti.length - ok ? `, ${esiti.length - ok} non riuscite` : ''}.`, esiti);
}

export { TIPO_LABEL };
