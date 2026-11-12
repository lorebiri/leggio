// Richieste della segreteria: dichiarazione di conformità all'originale, rinomina intelligente, messaggi PEC (.eml).
import { componi, mancanti, applicaConformita, SEGNAPOSTO } from '../lib/conformita.js';
import { analizza, proponiNome, REGOLA_PREDEFINITA } from '../lib/rinomina.js';
import { parseMime, bodyText, attachments, summary, parseDaticert, MAX_EML } from '../lib/mime.js';
import { pageText } from '../lib/textsearch.js';
import { looksLikeP7m } from '../lib/cades.js';
import { isFattura } from '../lib/fattura.js';
import { oggi, normalizzaData } from '../lib/protocollo.js';
import { openPdfJs } from '../../../core/pdf.js';
import { destroyPdf } from '../native.js';

// ---------------- dichiarazione di conformità ----------------
const KEY_CONF = 'avanzati.conformita';

export async function dichiarazioneConformita(app) {
  const doc = app.activeDoc;
  const pref = { modelli: [], nome: app.settings.get('author', ''), qualifica: '', luogo: '', dove: 'pagina', spazioFirma: true, ...app.settings.get(KEY_CONF, {}) };
  const profilo = app.services?.profiloCompleto?.() || {};
  const ente = profilo.ente?.denominazione || app.settings.get('avanzati.protocollo', {}).ente || '';
  if (!pref.nome) pref.nome = profilo.personale?.nomeCompleto || [profilo.personale?.nome, profilo.personale?.cognome].filter(Boolean).join(' ');
  if (!pref.qualifica) pref.qualifica = profilo.personale?.qualifica || '';
  if (!pref.luogo) pref.luogo = profilo.ente?.citta || '';
  const modelli = Array.isArray(pref.modelli) ? pref.modelli : [];
  const v = await app.ui.dialog({
    title: 'Dichiarazione di conformità all\'originale', width: 620,
    message: 'Aggiunge al documento il testo di attestazione usato dal tuo ufficio, con nome, qualifica, luogo e data, pronto per la firma digitale. Leggio non scrive il testo al posto tuo: incollalo la prima volta e salvalo come modello.',
    fields: [
      modelli.length ? { name: 'modello', label: 'Modello salvato', type: 'select', value: '0', options: [...modelli.map((m, i) => ({ value: String(i), label: m.nome })), { value: 'nuovo', label: 'Nuovo testo…' }] } : null,
      { name: 'testo', label: 'Testo dell\'attestazione', type: 'textarea', rows: 6, value: modelli[0]?.testo || '', placeholder: 'Incolla qui il testo fornito dall\'ufficio. Puoi usare {nome}, {qualifica}, {data}, {luogo}, {pagine}, {file}, {ente}.', required: true },
      { name: 'nome', label: 'Nome e cognome di chi attesta', type: 'text', value: pref.nome },
      { name: 'qualifica', label: 'Qualifica', type: 'text', value: pref.qualifica, placeholder: 'es. Funzionario amministrativo' },
      { name: 'luogo', label: 'Luogo', type: 'text', value: pref.luogo, placeholder: 'es. Sesto Fiorentino' },
      { name: 'data', label: 'Data', type: 'text', value: oggi() },
      { name: 'dove', label: 'Dove inserirla', type: 'radio', value: pref.dove, options: [{ value: 'pagina', label: 'Su una pagina aggiunta in fondo (consigliato)' }, { value: 'calce-ultima', label: 'In calce all\'ultima pagina' }, { value: 'calce-prima', label: 'In calce alla prima pagina' }] },
      { name: 'spazioFirma', label: 'Lascia lo spazio per la firma', type: 'checkbox', value: pref.spazioFirma },
      { name: 'salva', label: 'Ricorda questo testo come modello', type: 'checkbox', value: !modelli.length },
      { name: 'nomeModello', label: 'Nome del modello', type: 'text', value: modelli[0]?.nome || 'Conformità all\'originale' },
      { name: 'info', type: 'info', text: 'Segnaposto: ' + SEGNAPOSTO.map(([k, d]) => `${k} = ${d}`).join('; ') + '.' },
    ].filter(Boolean),
    okLabel: 'Inserisci la dichiarazione',
    onOpen: (form) => {
      const sel = form.querySelector('select'); const ta = form.querySelector('textarea');
      if (sel && ta) sel.addEventListener('change', () => { const m = modelli[+sel.value]; ta.value = m ? m.testo : ''; });
    },
    validate: (x) => {
      if (!String(x.testo).trim()) return 'Incolla il testo dell\'attestazione.';
      if (!normalizzaData(x.data)) return 'La data non è valida. Esempio: 12/11/2026';
      const t = componi(x.testo, { nome: x.nome, qualifica: x.qualifica, luogo: x.luogo, data: normalizzaData(x.data), pagine: doc.pageCount + (x.dove === 'pagina' ? 1 : 0), file: doc.name, ente });
      const mm = mancanti(t);
      return mm.length ? `Compila i campi che il testo usa: ${mm.join(', ')}.` : null;
    },
  });
  if (!v) return;
  const data = normalizzaData(v.data);
  const nuovi = [...modelli];
  if (v.salva && v.nomeModello.trim()) { const i = nuovi.findIndex((m) => m.nome === v.nomeModello.trim()); const m = { nome: v.nomeModello.trim().slice(0, 80), testo: v.testo }; if (i >= 0) nuovi[i] = m; else nuovi.unshift(m); }
  app.settings.set(KEY_CONF, { modelli: nuovi.slice(0, 20), nome: v.nome, qualifica: v.qualifica, luogo: v.luogo, dove: v.dove, spazioFirma: v.spazioFirma });
  const testo = componi(v.testo, { nome: v.nome, qualifica: v.qualifica, luogo: v.luogo, data, pagine: doc.pageCount + (v.dove === 'pagina' ? 1 : 0), file: doc.name, ente });
  const ok = await app.editWithPdfLib('Dichiarazione di conformità', async (pdfDoc, PDFLib) => {
    await applicaConformita(pdfDoc, PDFLib, { testo, firmatario: v.nome, qualifica: v.qualifica, luogoData: [v.luogo, data].filter(Boolean).join(', '), dove: v.dove, spazioFirma: v.spazioFirma });
  });
  if (ok) {
    const sign = app.tools.list().find((t) => t.id === 'sign' || /firma digital/i.test(t.name));
    app.ui.toast('Dichiarazione inserita. Ora il documento è pronto per la firma digitale.', { kind: 'success', timeout: 9000, action: sign ? { label: 'Firma ora', run: () => app.tools.run(sign.id) } : undefined });
  }
}

// ---------------- rinomina intelligente ----------------
const KEY_REG = 'avanzati.rinomina.regola';

export async function testoPrimePagine(pdf, n = 2) {
  let t = '';
  for (let i = 1; i <= Math.min(n, pdf.numPages); i++) { const p = await pdf.getPage(i); t += pageText((await p.getTextContent()).items) + '\n'; p.cleanup(); }
  return t;
}

/** Nome proposto per dei byte PDF (usato anche dalle azioni guidate). */
export async function nomeDalContenuto(bytes, nomeOriginale, regola) {
  let pdf;
  try { ({ pdf } = await openPdfJs(bytes)); return proponiNome(analizza(await testoPrimePagine(pdf), nomeOriginale), regola || REGOLA_PREDEFINITA); }
  catch { return nomeOriginale; }
  finally { destroyPdf(pdf); }
}

export async function rinominaIntelligente(app) {
  const doc = app.activeDoc;
  const testo = await testoPrimePagine(doc.pdf).catch(() => '');
  if (!testo.trim()) return app.ui.dialog({ title: 'Rinomina dal contenuto', message: 'In questo documento non c\'è testo leggibile (forse è una scansione). Fai prima il riconoscimento del testo (OCR), poi riprova.', cancelLabel: null, okLabel: 'Chiudi' });
  const c = analizza(testo, doc.name);
  let regola = app.settings.get(KEY_REG, REGOLA_PREDEFINITA);
  const v = await app.ui.dialog({
    title: 'Rinomina dal contenuto', width: 560,
    message: 'Leggio propone un nome leggendo il documento. Correggi i campi se serve: il nome si aggiorna da solo.',
    fields: [
      { name: 'tipo', label: 'Tipo di documento', type: 'text', value: c.tipo },
      { name: 'soggetto', label: 'Fornitore, ente o persona', type: 'text', value: c.soggetto },
      { name: 'numero', label: 'Numero', type: 'text', value: c.numero },
      { name: 'data', label: 'Data (aaaa-mm-gg)', type: 'text', value: c.data },
      { name: 'scadenza', label: 'Scadenza (aaaa-mm-gg)', type: 'text', value: c.scadenza },
      { name: 'regola', label: 'Regola del nome', type: 'text', value: regola, help: 'Campi: {tipo} {soggetto} {numero} {data} {scadenza} {originale}. Le parti con un campo vuoto vengono tolte.' },
      { name: 'info', type: 'info', html: '<strong>Nome proposto:</strong> <span class="av-nome-proposto"></span>' },
    ],
    okLabel: 'Salva con questo nome…',
    onOpen: (form, inputs) => {
      const out = form.querySelector('.av-nome-proposto');
      const upd = () => { const x = Object.fromEntries(Object.entries(inputs).map(([k, g]) => [k, g()])); out.textContent = proponiNome({ ...x, originale: c.originale }, x.regola || REGOLA_PREDEFINITA); };
      form.addEventListener('input', upd); upd();
    },
  });
  if (!v) return;
  regola = v.regola || REGOLA_PREDEFINITA;
  app.settings.set(KEY_REG, regola);
  const nome = proponiNome({ ...v, originale: c.originale }, regola);
  const vecchio = doc.name;
  doc.name = nome;
  const ok = await app.save(doc, { as: true });
  if (!ok) doc.name = vecchio;
}

// ---------------- messaggi PEC (.eml) ----------------
export async function apriEml(app, bytes, name, deps) {
  if (bytes.length > MAX_EML) return app.ui.toast('Il messaggio è troppo grande per essere aperto.', { kind: 'error' });
  let m;
  try { m = parseMime(bytes); } catch (err) { return app.reportError(err, `«${name}» non è un messaggio di posta leggibile`); }
  const { h } = app.ui;
  const all = attachments(m);
  const dcAtt = all.find((a) => /daticert\.xml$/i.test(a.name));
  let dc = null; try { if (dcAtt) dc = parseDaticert(dcAtt.bytes); } catch { dc = null; }
  const postacert = all.find((a) => /postacert\.eml$/i.test(a.name) || a.contentType === 'message/rfc822');
  let orig = null; try { if (postacert) orig = parseMime(postacert.bytes); } catch { orig = null; }
  const s = summary(m); const so = orig ? summary(orig) : null;
  const allegati = orig ? attachments(orig) : all.filter((a) => a !== dcAtt && !/smime\.p7s$/i.test(a.name));
  const pane = deps.openPane(app, { title: dc ? dc.tipoLabel : 'Messaggio di posta', subtitle: name, id: 'pec' });
  pane.actions.append(h('button', { class: 'btn', onclick: () => app.exportFile(bytes, name, [{ name: 'Messaggio di posta', extensions: ['eml'] }]) }, 'Salva il messaggio (.eml)…'));
  const righe = [
    ['Oggetto', dc?.oggetto || so?.oggetto || s.oggetto],
    ['Mittente', dc?.mittente || so?.da || s.da],
    ['Destinatari', dc ? dc.destinatari.join('; ') : (so?.a || s.a)],
    dc?.data ? ['Data e ora (dal gestore PEC)', dc.data] : ['Data', so?.data || s.data],
    dc?.gestore ? ['Gestore PEC', dc.gestore] : null,
    dc?.identificativo ? ['Identificativo del messaggio', dc.identificativo] : null,
    dc && dc.errore !== 'nessuno' ? ['Errore', `${dc.errore}${dc.erroreEsteso ? ' — ' + dc.erroreEsteso : ''}`] : null,
    dc?.consegna ? ['Consegnato a', dc.consegna] : null,
  ].filter((r) => r && r[1]);
  const apri = async (a) => {
    const b = a.bytes; const n = a.name;
    try {
      if (/\.pdf$/i.test(n) || new TextDecoder('latin1').decode(b.subarray(0, 1024)).includes('%PDF-')) return app.openBytes(b, { name: /\.pdf$/i.test(n) ? n : n + '.pdf' });
      if (/\.(p7m|p7s|tsd|m7m)$/i.test(n) && !/smime\.p7s$/i.test(n) || looksLikeP7m(b)) return deps.openSignedFile(app, { bytes: b, name: n });
      if (isFattura(b)) return deps.openFattura(app, b, n);
      if (/\.eml$/i.test(n) || a.contentType === 'message/rfc822') return apriEml(app, b, n.endsWith('.eml') ? n : n + '.eml', deps);
      return salva(a);
    } catch (err) { app.reportError(err, `Impossibile aprire «${n}»`); }
  };
  const salva = (a) => { const ext = a.name.includes('.') ? a.name.split('.').pop() : '*'; return app.exportFile(a.bytes, a.name.replace(/[\\/:*?"<>|]/g, '_'), [{ name: ext.toUpperCase(), extensions: [ext] }]); };
  const kb = (n) => (n < 1048576 ? Math.max(1, Math.round(n / 1024)) + ' KB' : (n / 1048576).toFixed(1).replace('.', ',') + ' MB');
  const testo = bodyText(orig || m);
  const pdfs = allegati.filter((a) => /\.pdf$/i.test(a.name));
  if (pdfs.length > 1) pane.actions.append(h('button', { class: 'btn primary', onclick: async () => { for (const a of pdfs) await apri(a); } }, `Apri tutti i PDF (${pdfs.length})`));
  pane.body.append(h('div', { class: 'av-narrow' },
    dc ? h('div', { class: `av-sem av-sem-${dc.errore === 'nessuno' && !/non-accettazione|errore|virus/.test(dc.tipo) ? 'valid' : 'invalid'}` }, h('span', { class: 'av-sem-dot' }), h('div', {}, h('strong', {}, dc.tipoLabel), h('div', { class: 'av-sem-txt' }, dc.errore === 'nessuno' ? 'Dati di certificazione presenti (daticert.xml).' : 'Il gestore segnala un errore: leggi i dettagli.'))) : h('p', { class: 'av-note' }, 'Questo messaggio non contiene i dati di certificazione PEC (daticert.xml): è un messaggio di posta ordinaria o una ricevuta incompleta.'),
    h('div', { class: 'av-box' }, h('dl', { class: 'av-dl' }, righe.flatMap(([k, val]) => [h('dt', {}, k), h('dd', {}, val)]))),
    h('div', { class: 'av-box' }, h('h3', {}, `Allegati del messaggio (${allegati.length})`),
      allegati.length ? h('ul', { class: 'av-list' }, allegati.map((a) => h('li', {}, h('div', { class: 'av-row' },
        h('div', { class: 'av-grow' }, h('div', { class: 'av-list-name' }, a.name), h('small', { class: 'av-note' }, kb(a.bytes?.length || 0))),
        h('button', { class: 'btn small', onclick: () => apri(a) }, 'Apri'),
        h('button', { class: 'btn small', onclick: () => salva(a) }, 'Salva…'))))) : h('p', { class: 'av-note' }, 'Nessun allegato.')),
    testo ? h('div', { class: 'av-box' }, h('h3', {}, 'Testo del messaggio'), h('div', { class: 'av-pre' }, testo.slice(0, 20000))) : null,
    dcAtt ? h('div', { class: 'av-row' }, h('button', { class: 'btn small', onclick: () => salva(dcAtt) }, 'Salva daticert.xml…')) : null,
    h('p', { class: 'av-note' }, 'La firma del gestore PEC sul messaggio (smime.p7s) non viene verificata da Leggio: fa fede il messaggio conservato nella casella PEC.')));
}
