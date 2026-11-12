// Sanifica documento, Proprietà e vista iniziale, pannello Allegati, Ripara PDF.
import { VOCI, analyze, sanitize } from './logica/sanifica.js';
import { readProperties, writeProperties, LAYOUT, MODE, ZOOM } from './logica/metadati.js';
import { listAttachments, readAttachment, addAttachment, removeAttachment } from './logica/allegati.js';
import { probeWithPdfjs, rewriteWithPdfLib, rebuildFromPdfjs } from './logica/ripara.js';
import { renderRedactedPage } from './codec.js';
import { openForEdit, modifica, salvaCopia, copyName, boxAvviso, baseName } from './comune.js';

const fmtSize = (n) => (n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(1).replace('.', ',') + ' KB' : (n / 1048576).toFixed(1).replace('.', ',') + ' MB');

// ---------------- Sanifica ----------------
export async function sanitizeTool(app) {
  const doc = app.activeDoc; const { h } = app.ui;
  const bytes = await app.currentBytes(doc);
  const found = analyze(await openForEdit(bytes, doc), bytes);
  const total = Object.values(found).reduce((a, b) => a + b, 0);
  if (!total) { await app.ui.dialog({ title: 'Sanifica documento', okLabel: 'Chiudi', cancelLabel: null, body: boxAvviso(app, 'Il documento non contiene informazioni nascoste: niente metadati, JavaScript, allegati, commenti, livelli nascosti o versioni precedenti.', 'ok') }); return; }
  const fields = VOCI.map((x) => ({ type: 'checkbox', name: x.id, label: `${x.label}${found[x.id] ? ` — trovati: ${found[x.id]}` : ' — nessuno'}`, value: x.def && found[x.id] > 0 }));
  const v = await app.ui.dialog({
    title: 'Sanifica documento (rimuovi informazioni nascoste)', okLabel: 'Rimuovi', width: 580,
    body: h('p', {}, 'Prima di pubblicare o inviare un documento, togli ciò che non si vede ma resta nel file. Scegli cosa rimuovere:'),
    fields: [...fields, { type: 'radio', name: 'out', value: 'doc', options: [{ value: 'doc', label: 'Applica al documento aperto (si può annullare)' }, { value: 'copy', label: `Salva una copia «${copyName(doc, 'sanificato')}»` }] }],
  });
  if (!v) return;
  const opts = Object.fromEntries(VOCI.map((x) => [x.id, !!v[x.id]]));
  let report;
  if (v.out === 'copy') {
    const pd = await openForEdit(bytes, doc); report = sanitize(pd, opts);
    await salvaCopia(app, await pd.save({ useObjectStreams: true }), copyName(doc, 'sanificato'));
  } else {
    await modifica(app, 'Documento sanificato', (pd) => { report = sanitize(pd, opts); });
  }
  if (!report) return;
  const lines = VOCI.filter((x) => opts[x.id] && report[x.id]).map((x) => h('li', {}, `${x.label}: ${report[x.id]}`));
  await app.ui.dialog({ title: 'Sanifica documento', okLabel: 'Chiudi', cancelLabel: null, body: h('div', {}, boxAvviso(app, 'Pulizia completata.', 'ok'), lines.length ? h('ul', {}, lines) : h('p', {}, 'Nessun elemento da rimuovere.')) });
}

// ---------------- Proprietà ----------------
export async function metadataTool(app) {
  const doc = app.activeDoc;
  const bytes = await app.currentBytes(doc);
  const cur = readProperties(await openForEdit(bytes, doc));
  const v = await app.ui.dialog({
    title: 'Proprietà del documento', okLabel: 'Salva proprietà', width: 560,
    fields: [
      { type: 'text', name: 'title', label: 'Titolo', value: cur.title, help: 'È il nome che compare nei risultati di ricerca e, se scegli sotto, nella barra della finestra.' },
      { type: 'text', name: 'author', label: 'Autore', value: cur.author, placeholder: 'es. ICCOM-CNR' },
      { type: 'text', name: 'subject', label: 'Oggetto', value: cur.subject },
      { type: 'text', name: 'keywords', label: 'Parole chiave (separate da virgole)', value: cur.keywords },
      { type: 'text', name: 'creator', label: 'Applicazione di origine', value: cur.creator },
      { type: 'text', name: 'producer', label: 'Programma che ha creato il PDF', value: cur.producer },
      { type: 'datetime-local', name: 'creationDate', label: 'Data di creazione', value: cur.creationDate },
      { type: 'datetime-local', name: 'modDate', label: 'Data di modifica', value: cur.modDate },
      { type: 'info', html: '<strong>Vista all\'apertura</strong> — come si presenta il documento quando qualcuno lo apre (in Acrobat e nei lettori che lo rispettano).' },
      { type: 'select', name: 'pageMode', label: 'Mostra', value: cur.pageMode, options: MODE },
      { type: 'select', name: 'pageLayout', label: 'Disposizione delle pagine', value: cur.pageLayout, options: LAYOUT },
      { type: 'select', name: 'openZoom', label: 'Ingrandimento', value: cur.openZoom, options: ZOOM },
      { type: 'number', name: 'openPage', label: 'Apri alla pagina', value: cur.openPage, min: 1, max: doc.pageCount, step: 1 },
      { type: 'checkbox', name: 'displayDocTitle', label: 'Mostra il titolo (invece del nome del file) nella barra della finestra', value: cur.displayDocTitle },
      { type: 'checkbox', name: 'fitWindow', label: 'Adatta la finestra alla pagina', value: cur.fitWindow },
      { type: 'checkbox', name: 'centerWindow', label: 'Centra la finestra sullo schermo', value: cur.centerWindow },
    ],
    validate: (x) => (x.openPage && (x.openPage < 1 || x.openPage > doc.pageCount) ? `La pagina deve essere tra 1 e ${doc.pageCount}.` : null),
  });
  if (!v) return;
  await modifica(app, 'Proprietà del documento', (pd) => { writeProperties(pd, { ...cur, ...v, openPage: v.openPage || 1 }); });
}

// ---------------- Allegati ----------------
export function attachmentsPanel(app) {
  return {
    id: 'attachments', title: 'Allegati', icon: 'paperclip', order: 40,
    render(c) {
      const { h } = app.ui; const doc = app.activeDoc;
      const list = h('ul', { class: 'lg-att' });
      const add = h('button', { class: 'btn small primary', onclick: () => addFiles().catch((e) => app.reportError(e, 'Aggiungi allegato')) }, 'Aggiungi file…');
      c.append(h('div', { class: 'pad', style: { display: 'flex', gap: '8px', alignItems: 'center' } }, add), list);
      let alive = true;
      async function refresh() {
        list.innerHTML = '';
        let items = [];
        try { items = listAttachments(await openForEdit(await app.currentBytes(doc), doc)); }
        catch (e) { list.append(h('li', { class: 'muted' }, 'Impossibile leggere gli allegati: ' + e.message)); return; }
        if (!alive) return;
        if (!items.length) { list.append(h('li', { class: 'muted' }, 'Questo documento non contiene allegati. Puoi aggiungerne (es. l\'XML di una fattura o un documento di supporto).')); return; }
        for (const it of items) {
          const isPdf = /\.pdf$/i.test(it.fileName) || it.mime === 'application/pdf';
          list.append(h('li', {},
            h('div', { class: 'nm' }, it.fileName),
            h('div', { class: 'meta' }, [fmtSize(it.size), it.kind === 'commento' ? `allegato come commento a pag. ${it.page}` : null, it.description].filter(Boolean).join(' · ')),
            h('div', { class: 'acts' },
              isPdf ? h('button', { class: 'btn small', onclick: () => openIt(it) }, 'Apri') : null,
              h('button', { class: 'btn small', onclick: () => saveIt(it) }, 'Salva…'),
              h('button', { class: 'btn small', onclick: () => removeIt(it) }, 'Togli'))));
        }
      }
      async function bytesOf(it) {
        const b = readAttachment(await openForEdit(await app.currentBytes(doc), doc), it.key);
        if (!b) throw new Error('Il contenuto di questo allegato non è leggibile (formato di compressione non supportato o file danneggiato).');
        return b;
      }
      async function openIt(it) { try { await app.openBytes(await bytesOf(it), { name: it.fileName }); } catch (e) { app.reportError(e, 'Apri allegato'); } }
      async function saveIt(it) { try { const ext = (it.fileName.split('.').pop() || '*'); const r = await app.exportFile(await bytesOf(it), it.fileName, [{ name: 'File', extensions: [ext] }]); if (r) app.ui.toast('Allegato salvato', { kind: 'success' }); } catch (e) { app.reportError(e, 'Salva allegato'); } }
      async function removeIt(it) {
        if (!(await app.ui.confirm(`Togliere «${it.fileName}» dal documento?`, { okLabel: 'Togli', danger: true }))) return;
        await modifica(app, 'Allegato tolto', (pd) => removeAttachment(pd, it.key) || false);
      }
      async function addFiles() {
        const files = await app.platform.openFiles({ multiple: true, filters: [{ name: 'Tutti i file', extensions: ['*'] }], title: 'Scegli i file da allegare' });
        if (!files?.length) return;
        await modifica(app, files.length === 1 ? 'Allegato aggiunto' : 'Allegati aggiunti', async (pd) => { for (const f of files) await addAttachment(pd, f.bytes, f.name); });
      }
      const off = app.bus.on('document:changed', ({ doc: d }) => { if (d === doc) refresh(); });
      refresh();
      return () => { alive = false; off(); };
    },
  };
}

/** Avviso all'apertura: «Questo PDF contiene N allegati». */
export function watchAttachments(app) {
  app.bus.on('document:loaded', async ({ doc }) => {
    try {
      const att = await doc.pdf.getAttachments();
      const n = att instanceof Map ? att.size : att ? Object.keys(att).length : 0;
      if (n) app.ui.toast(`Questo PDF contiene ${n} ${n === 1 ? 'allegato' : 'allegati'}.`, { timeout: 8000, action: { label: 'Mostra', run: () => app.sidebar.show('attachments') } });
    } catch { /* niente */ }
  });
}

// ---------------- Ripara ----------------
export async function repairTool(app) {
  const doc = app.activeDoc;
  let bytes; let name; let password;
  if (doc) {
    const v = await app.ui.dialog({ title: 'Ripara PDF', okLabel: 'Continua', fields: [{ type: 'radio', name: 's', value: 'cur', options: [{ value: 'cur', label: `Il documento aperto («${doc.name}»)` }, { value: 'file', label: 'Un altro file che non si apre…' }] }] });
    if (!v) return;
    if (v.s === 'cur') { bytes = await app.currentBytes(doc); name = doc.name; password = doc.password; }
  }
  if (!bytes) {
    const files = await app.platform.openFiles({ multiple: false, title: 'Scegli il PDF da riparare' });
    if (!files?.length) return;
    bytes = files[0].bytes; name = files[0].name;
  }
  const { pdfjs } = app.lib;
  const res = await app.ui.withProgress('Riparazione in corso…', async (p) => {
    p.set(0.05, 'Analisi del file…');
    const before = await probeWithPdfjs(pdfjs, bytes, { password });
    p.set(0.2, 'Ricostruzione della struttura…');
    const rewritten = await rewriteWithPdfLib(bytes, password);
    if (rewritten) {
      const after = await probeWithPdfjs(pdfjs, rewritten);
      if (after.pages > 0 && after.ok >= before.ok) return { bytes: rewritten, how: 'struttura', before, after };
    }
    if (!before.pages) return { error: before.error };
    p.set(0.3, 'Ricostruzione dalle pagine leggibili…');
    const reb = await rebuildFromPdfjs(pdfjs, bytes, (pdf, i) => renderRedactedPage(pdfjs, pdf, i, [], { dpi: 200 }), { signal: p.signal, onProgress: (f, t) => p.set(0.3 + f * 0.7, t), getDocumentOptions: { password } });
    return { bytes: reb.bytes, how: 'pagine', before, failed: reb.failed };
  });
  if (!res) return;
  const { h } = app.ui;
  if (res.error) {
    await app.ui.dialog({ title: 'Ripara PDF', okLabel: 'Chiudi', cancelLabel: null, body: boxAvviso(app, `Il file è troppo danneggiato per essere recuperato: non contiene pagine leggibili. Chiedi a chi l'ha mandato di inviarlo di nuovo (meglio se compresso in .zip, per evitare che la posta lo alteri). Dettaglio tecnico: ${res.error}`, 'error') });
    return;
  }
  const msg = res.how === 'struttura'
    ? `Riparazione riuscita: la struttura interna del file è stata ricostruita senza perdere nulla (${res.after.pages} pagine).`
    : `Il file era molto danneggiato: Leggio ha ricostruito le ${res.before.pages} pagine leggibili come immagini con il testo ancora ricercabile. Link, moduli e commenti non sono recuperabili.${res.failed?.length ? ` Pagine non recuperate (lasciate bianche): ${res.failed.join(', ')}.` : ''}`;
  const ok = await app.ui.dialog({ title: 'Ripara PDF', okLabel: 'Apri il file riparato', body: boxAvviso(app, msg, res.how === 'struttura' ? 'ok' : 'warning'), width: 520 });
  if (ok) await app.openBytes(res.bytes, { name: `${baseName(name)}_riparato.pdf` });
  void h;
}
