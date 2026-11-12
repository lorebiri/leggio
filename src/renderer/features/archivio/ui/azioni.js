// Azioni sui documenti dell'archivio: aprire alla pagina giusta, cambiare stato, etichette e note,
// esportare il registro, azioni guidate (operazioni dell'area avanzati), copie con il nome proposto.
// Gli originali non vengono mai modificati: i risultati sono sempre copie.
import { tutteLeOperazioni, validaSequenza, eseguiSequenza, nomeUscita, SkipError } from '../../avanzati/lib/batch-ops.js';
import { proponiNome, REGOLA_PREDEFINITA } from '../../avanzati/lib/rinomina.js';
import { VOCI_STATO, leggiElencoProtocolli } from '../lib/stati.js';
import { dataDaTesto } from '../lib/testo.js';
import { registroCsv, registroXlsx } from '../lib/esporta.js';
import { TIPO_LABEL } from '../lib/estrai.js';
import { isDesktop } from '../store.js';
import { openP7m, looksLikeP7m } from '../../avanzati/lib/cades.js';
import { parseFattura, fatturaDocument, nomeProposto as nomeFatturaPdf, isFattura } from '../../avanzati/lib/fattura.js';

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
    message: 'Puoi spuntare più stati insieme. Lo stato si salva nell\'archivio di Leggio, non nel file: i documenti firmati restano intatti. Il protocollo si fa in Titulus: qui si annota soltanto.',
    fields: [
      { name: 'azione', label: 'Che cosa vuoi fare', type: 'radio', value: 'imposta', options: [{ value: 'imposta', label: 'Imposta gli stati spuntati' }, { value: 'togli', label: 'Togli gli stati spuntati' }] },
      ...VOCI_STATO.map((s) => ({ name: 's_' + s.id, label: s.label, type: 'checkbox', value: false })),
    ],
    okLabel: n === 1 ? 'Applica' : `Applica a ${n} documenti`,
    validate: (x) => (VOCI_STATO.some((s) => x['s_' + s.id]) ? null : 'Spunta almeno uno stato.'),
  });
  if (!v) return;
  let scelti = VOCI_STATO.filter((s) => v['s_' + s.id]).map((s) => s.id);
  // stati opposti dello stesso tipo: vale il secondo («fatto»)
  for (const [a, b] of [['da-protocollare', 'protocollato'], ['da-firmare', 'firmato'], ['da-pagare', 'pagato']]) if (scelti.includes(a) && scelti.includes(b) && v.azione === 'imposta') scelti = scelti.filter((x) => x !== a);
  const ids = righe.map((r) => r.id);
  for (const id of scelti) {
    if (v.azione === 'imposta' && id === 'protocollato') continue;
    await A.cambiaStato(ids, v.azione === 'togli' ? { togli: id } : { imposta: id });
  }
  const etichette = scelti.map((id) => VOCI_STATO.find((s) => s.id === id)?.label).join(', ');
  if (v.azione === 'imposta' && scelti.includes('protocollato')) return dialogoProtocollato(app, A, righe);
  app.ui.toast(`${v.azione === 'togli' ? 'Tolto' : 'Applicato'} «${etichette}» ${v.azione === 'togli' ? 'da' : 'a'} ${n === 1 ? '1 documento' : n + ' documenti'}.`, { kind: 'success' });
}

/**
 * «Protocollato (Titulus)»: il numero viene SEMPRE da Titulus. Leggio non genera numeri:
 * per un documento lo si scrive (o incolla); per più documenti si incolla un elenco «file → numero».
 */
async function dialogoProtocollato(app, A, righe) {
  const n = righe.length;
  if (n === 1) {
    const r = righe[0];
    const v = await app.ui.dialog({
      title: `Protocollato (Titulus): «${r.nome}»`,
      message: 'Scrivi o incolla il numero e la data di protocollo che ti ha dato Titulus.',
      fields: [
        { name: 'numero', label: 'N. protocollo (da Titulus)', type: 'text', value: r.stato?.origineProtocollo ? '' : r.stato?.numeroProtocollo || '', placeholder: 'es. 0012345' },
        { name: 'data', label: 'Data di protocollo (gg/mm/aaaa)', type: 'text', value: '', placeholder: 'es. 12/11/2026' },
      ],
      okLabel: 'Salva',
      validate: (x) => (x.data.trim() && !dataDaTesto(x.data) ? 'La data non è valida: scrivila come gg/mm/aaaa.' : null),
    });
    if (!v) return;
    await A.cambiaStati([{ id: r.id, modifica: { imposta: 'protocollato', numeroProtocollo: v.numero.trim() || undefined, dataProtocollo: dataDaTesto(v.data) || undefined } }]);
    app.ui.toast('Salvato nell\'archivio.', { kind: 'success' });
    return;
  }
  const { h } = app.ui;
  const elenco = righe.map((r) => `${r.nome}\t`).join('\n');
  const v = await app.ui.dialog({
    title: `Protocollato (Titulus): ${n} documenti`,
    message: 'Ogni documento ha il SUO numero, quello dato da Titulus: Leggio non ne inventa. Accanto a ogni nome scrivi o incolla il numero (e, se vuoi, la data), separati da una tabulazione, «;» o «→». Puoi anche incollare due colonne copiate da Excel. I documenti senza numero restano «Protocollato» senza numero.',
    fields: [{ name: 'elenco', label: 'Nome del file → numero di protocollo [→ data]', type: 'textarea', rows: Math.min(14, n + 2), value: elenco }],
    body: h('p', { class: 'av-note' }, 'Esempio: «Fattura_Alfa_12.pdf → 0012345 → 12/11/2026». Se nel PDF c\'è la segnatura stampata da Titulus, Leggio la legge da solo durante l\'indicizzazione.'),
    okLabel: 'Salva', width: 720,
  });
  if (!v) return;
  const letti = leggiElencoProtocolli(v.elenco);
  const perNome = new Map(letti.map((x) => [x.nome.toLowerCase(), x]));
  let conNumero = 0;
  const voci = righe.map((r) => {
    const x = perNome.get(r.nome.toLowerCase()) || perNome.get((r.rel || '').toLowerCase());
    if (x) conNumero++;
    return { id: r.id, modifica: { imposta: 'protocollato', numeroProtocollo: x?.numero, dataProtocollo: x?.data || undefined } };
  });
  const ignoti = letti.filter((x) => !righe.some((r) => r.nome.toLowerCase() === x.nome.toLowerCase() || (r.rel || '').toLowerCase() === x.nome.toLowerCase()));
  await A.cambiaStati(voci);
  app.ui.toast(`${n} documenti segnati «Protocollato (Titulus)», ${conNumero} con il numero.${ignoti.length ? ` ${ignoti.length} righe dell'elenco non corrispondono ai documenti scelti.` : ''}`, { kind: ignoti.length ? 'warning' : 'success', timeout: 8000 });
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
  // PDF e fatture elettroniche (XML, anche firmate .p7m): le fatture diventano prima PDF impaginati
  const pdf = righe.filter((r) => (r.ext === 'pdf' || (r.contenuto === 'fattura' && isDesktop())) && !r.offline);
  const altri = righe.length - pdf.length;
  if (!pdf.length) return app.ui.toast('Le azioni guidate lavorano sui PDF e sulle fatture elettroniche: tra i documenti scelti non ce ne sono (o la cartella non è raggiungibile).', { kind: 'warning', timeout: 7000 });
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

  const esiti = [];
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
        const bytes = r.ext === 'pdf' ? await A.leggiBytes(r.path) : (await fatturaInPdf(app, A, r)).bytes;
        const out = await eseguiSequenza(bytes, passi, { PDFLib: app.lib.PDFLib, openPdfLib: (b) => app.lib.openPdfLib(b), savePdfLib: (d) => app.lib.savePdfLib(d), ops, ctx, signal: p.signal });
        const nome = v.nome === 'contenuto' ? nomeProposto(r) : nomeUscita(r.nome.replace(/(\.xml)(\.p7m)*$/i, '.pdf'), { modo: v.nome });
        const dove = await A.store.scriviCopia({ origine: r.path, cartella: cartella && cartella !== '__download__' ? cartella : null, sotto: 'Elaborati', nome, bytes: out });
        esiti.push({ r, ok: true, dove, note: ctx.note || '' });
      } catch (e) {
        if (e?.name === 'AbortError') break;
        esiti.push({ r, ok: false, skip: e instanceof SkipError, motivo: e?.message || String(e) });
      }
      await new Promise((res) => setTimeout(res, 0));
    }
  });
  const ok = esiti.filter((e) => e.ok).length; const ko = esiti.length - ok;
  // le copie nelle cartelle collegate entrano nell'archivio alla prossima scansione
  if (ok && !cartella) A.aggiorna({ motivo: 'azioni', silenzioso: true }).catch(() => {});
  await rapporto(app, `${ok} copie create${ko ? `, ${ko} documenti non elaborati` : ''} in ${Math.max(1, Math.round((Date.now() - t0) / 1000))} s.`, esiti);
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

// ---------------- fatture elettroniche, stampa, firma ----------------

/** Byte della fattura XML (anche dentro una busta .p7m) → { f (fattura letta), xml } */
async function leggiFattura(A, r) {
  let b = await A.leggiBytes(r.path);
  if (looksLikeP7m(b) || /\.p7m$/i.test(r.nome)) { const x = await openP7m(b, { verify: false }); if (!x.content) throw new Error('La busta firmata non contiene la fattura.'); b = x.content; }
  if (!isFattura(b)) throw new Error('Non è una fattura elettronica.');
  return { f: parseFattura(b), xml: b };
}

/**
 * Fattura elettronica → PDF impaginato (stessa impaginazione dell'area avanzati: fatturaDocument +
 * printToPDF del suo canale «html-to-pdf»). Se l'area avanzati offre app.services.fatturaPdf si usa quello.
 * → { bytes, nome }
 */
export async function fatturaInPdf(app, A, r) {
  const { f, xml } = await leggiFattura(A, r);
  if (typeof app.services?.fatturaPdf === 'function') {
    const out = await app.services.fatturaPdf(xml);
    const bytes = out instanceof Uint8Array ? out : out?.bytes;
    if (bytes instanceof Uint8Array) return { bytes, nome: nomeFatturaPdf(f) };
  }
  if (!isDesktop()) throw new Error('La conversione delle fatture in PDF funziona nell\'app desktop.');
  const res = await app.platform.invokeFeature('avanzati:html-to-pdf', { html: fatturaDocument(f, { nomeFile: r.nome }), pageSize: 'A4', margins: 0 });
  if (!res?.ok) throw new Error(res?.error || 'Impaginazione della fattura non riuscita.');
  return { bytes: res.value instanceof Uint8Array ? res.value : new Uint8Array(res.value), nome: nomeFatturaPdf(f) };
}

/** «Fatture in PDF»: una copia PDF impaginata per ogni fattura elettronica selezionata, in «Elaborati». */
export async function fattureInPdf(app, A, righe) {
  const xml = righe.filter((r) => r.contenuto === 'fattura' && !r.offline);
  if (!xml.length) return app.ui.toast('Tra i documenti scelti non ci sono fatture elettroniche (XML).', { kind: 'warning' });
  if (!isDesktop()) return app.ui.toast('La conversione delle fatture in PDF funziona nell\'app desktop.', { kind: 'warning' });
  const esiti = []; const t0 = Date.now();
  await app.ui.withProgress('Fatture elettroniche in PDF', async (p) => {
    for (let i = 0; i < xml.length; i++) {
      if (p.cancelled) break;
      const r = xml[i];
      p.set(i / xml.length, `${i + 1} di ${xml.length}: ${r.nome}`);
      try {
        const { bytes, nome } = await fatturaInPdf(app, A, r);
        const dove = await A.store.scriviCopia({ origine: r.path, sotto: 'Elaborati', nome, bytes });
        esiti.push({ r, ok: true, dove });
      } catch (e) { esiti.push({ r, ok: false, motivo: e.message }); }
    }
  });
  const ok = esiti.filter((e) => e.ok).length;
  if (ok) A.aggiorna({ motivo: 'azioni', silenzioso: true }).catch(() => {});
  await rapporto(app, `${ok} fatture salvate in PDF nella sottocartella «Elaborati»${esiti.length - ok ? `, ${esiti.length - ok} non riuscite` : ''} (${Math.max(1, Math.round((Date.now() - t0) / 1000))} s). Gli XML originali non sono stati toccati.`, esiti);
}

/** Stampa dei documenti selezionati (PDF, fatture elettroniche impaginate, PDF dentro i .p7m). */
export async function stampaSelezionati(app, A, righe) {
  const docs = righe.filter((r) => !r.offline);
  if (!docs.length) return app.ui.toast('Seleziona prima uno o più documenti raggiungibili.', { kind: 'warning' });
  if (docs.length > 200) return app.ui.toast('Troppi documenti in una volta: selezionane al massimo 200.', { kind: 'warning' });
  const sources = []; const saltati = [];
  await app.ui.withProgress('Preparazione della stampa', async (p) => {
    for (let i = 0; i < docs.length; i++) {
      if (p.cancelled) return;
      const r = docs[i];
      p.set(i / docs.length, `${i + 1} di ${docs.length}: ${r.nome}`);
      try {
        if (r.contenuto === 'fattura') { const x = await fatturaInPdf(app, A, r); sources.push({ name: x.nome, bytes: x.bytes }); continue; }
        let b = await A.leggiBytes(r.path);
        if (r.ext === 'p7m') { const x = await openP7m(b, { verify: false }); b = x.content; }
        if (!b || !new TextDecoder('latin1').decode(b.subarray(0, 1024)).includes('%PDF')) { saltati.push(`${r.nome} (non è un PDF)`); continue; }
        if (r.protetto) { saltati.push(`${r.nome} (protetto da password)`); continue; }
        sources.push({ name: r.nome.replace(/\.p7m$/i, ''), bytes: b });
      } catch (e) { saltati.push(`${r.nome} (${e.message})`); }
    }
  });
  if (saltati.length) app.ui.toast(`Non stampati: ${saltati.slice(0, 5).join('; ')}${saltati.length > 5 ? ` e altri ${saltati.length - 5}` : ''}.`, { kind: 'warning', timeout: 10000 });
  if (sources.length) await app.printFiles(sources);
}

/**
 * Firma dei documenti selezionati con «Firma più file» dell'area moduli (app.services.firmaFile): un solo
 * certificato e PIN, finestra dei risultati solo se qualcosa non va. Per ogni file firmato l'area moduli emette
 * «archivio:stato» (stato «Firmato» sull'originale); le copie _firmato, accanto agli originali, entrano
 * nell'archivio con il prossimo aggiornamento e finiscono nella stessa pratica (stessi CIG, CUP, protocollo).
 */
export async function firmaSelezionati(app, A, righe) {
  const docs = righe.filter((r) => !r.offline);
  if (!docs.length) return app.ui.toast('Seleziona prima uno o più documenti raggiungibili.', { kind: 'warning' });
  if (typeof app.services?.firmaFile !== 'function' || !isDesktop()) return app.ui.toast('La firma digitale di più file è disponibile nell\'app desktop.', { kind: 'warning' });
  try { await app.services.firmaFile(docs.map((r) => ({ path: r.path, name: r.nome }))); }
  finally { A.aggiorna({ motivo: 'firma', silenzioso: true }).catch(() => {}); }
}

export { TIPO_LABEL };
