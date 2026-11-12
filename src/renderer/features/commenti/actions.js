// Area «commenti» — azioni sul documento: riepilogo commenti (testo, Word, PDF, pagina stampabile),
// esporta/importa solo i commenti (XFDF), rendi definitivi (appiattisci), elimina tutti.
import { readAllAnnotations, createAnnot, deleteAllComments, flattenComments, findAnnot, refKey } from './annots.js';
import { toXfdf, fromXfdf } from './xfdf.js';
import { summaryText, summaryHtml } from './model.js';
import { threadsOf, author, edit } from './ui-common.js';

const base = (app) => (app.activeDoc?.name || 'documento').replace(/\.pdf$/i, '');
const enc = (s) => new TextEncoder().encode(s);

async function getThreads(app, getFiltered) {
  const f = getFiltered?.();
  if (f) return f;
  return app.ui.withProgress('Lettura dei commenti', async (p) => threadsOf(app, { signal: p.signal, onProgress: (d, n) => p.set(d / n, `Pagina ${d} di ${n}`) }));
}

export async function copySummary(app, getFiltered) {
  const th = await getThreads(app, getFiltered); if (!th) return;
  const txt = summaryText(th, { docName: app.activeDoc.name });
  try { await navigator.clipboard.writeText(txt); app.ui.toast(`Elenco di ${th.length} commenti copiato: incollalo in una mail`, { kind: 'success' }); }
  catch { await app.exportFile(enc(txt), base(app) + '_commenti.txt', [{ name: 'Testo', extensions: ['txt'] }]); }
}
export async function exportSummary(app, format, getFiltered) {
  const th = await getThreads(app, getFiltered); if (!th) return;
  const docName = app.activeDoc.name;
  try {
    if (format === 'docx') {
      const { summaryDocx } = await import('./summary-docs.js');
      return app.exportFile(await summaryDocx(th, { docName }), base(app) + '_riepilogo_commenti.docx', [{ name: 'Documento Word', extensions: ['docx'] }]);
    }
    if (format === 'pdf') {
      const { summaryPdf } = await import('./summary-docs.js');
      const bytes = await summaryPdf(th, { docName });
      const r = await app.exportFile(bytes, base(app) + '_riepilogo_commenti.pdf', [{ name: 'PDF', extensions: ['pdf'] }]);
      return r;
    }
    if (format === 'txt') return app.exportFile(enc(summaryText(th, { docName })), base(app) + '_commenti.txt', [{ name: 'Testo', extensions: ['txt'] }]);
    // pagina stampabile con miniature delle pagine commentate
    const thumbs = new Map();
    const pages = [...new Set(th.map((t) => t.pageIndex))].slice(0, 200);
    await app.ui.withProgress('Preparazione del riepilogo', async (p) => {
      for (let i = 0; i < pages.length; i++) {
        if (p.cancelled) break;
        p.set(i / pages.length, `Pagina ${pages[i] + 1}`);
        const cv = await app.lib.renderPageToCanvas(app.activeDoc.pdf, pages[i], 0.45, { background: '#fff' });
        thumbs.set(pages[i], cv.toDataURL('image/jpeg', 0.8));
      }
    });
    return app.exportFile(enc(summaryHtml(th, { docName, thumbs, author: app.settings.get('author', '') })), base(app) + '_riepilogo_commenti.html', [{ name: 'Pagina web', extensions: ['html'] }]);
  } catch (err) { app.reportError(err, 'Riepilogo dei commenti non riuscito'); }
}

export async function exportXfdf(app) {
  const doc = app.activeDoc;
  const warnings = [];
  const pdfDoc = await app.lib.openPdfLib(await app.currentBytes(doc), doc.password);
  const list = readAllAnnotations(pdfDoc, { warnings });
  if (!list.length) return app.ui.toast('Questo documento non ha commenti da esportare', { kind: 'warning' });
  await app.exportFile(enc(toXfdf(list, { fileName: doc.name })), base(app) + '_commenti.xfdf', [{ name: 'Solo commenti (XFDF)', extensions: ['xfdf'] }]);
  app.ui.toast(`Esportati ${list.length} commenti${warnings.length ? ` (${warnings.length} danneggiati saltati)` : ''}`, { kind: 'success' });
}

export async function importXfdf(app) {
  const files = await app.platform.openFiles({ multiple: false, filters: [{ name: 'Solo commenti (XFDF)', extensions: ['xfdf', 'xml'] }] });
  const f = files?.[0]; if (!f) return;
  if (f.bytes.length > 50 * 1024 * 1024) return app.ui.toast('File troppo grande per un elenco di commenti', { kind: 'error' });
  let items; const warnings = [];
  try { items = fromXfdf(new TextDecoder().decode(f.bytes), { pageCount: app.activeDoc.pageCount, warnings }); }
  catch (err) { return app.ui.dialog({ title: 'Importa solo i commenti', message: err.message + ' Controlla di aver scelto un file .xfdf esportato da Leggio o da Acrobat.', cancelLabel: null, okLabel: 'Chiudi' }); }
  if (!items.length) return app.ui.toast('Nel file non ci sono commenti importabili', { kind: 'warning' });
  let added = 0, dup = 0;
  const ok = await edit(app, `Importati commenti da «${f.name}»`, async (pdfDoc) => {
    const keys = new Map();
    for (const it of items) {
      if (findAnnot(pdfDoc, { nm: it.name })) { dup++; continue; } // già presente
      const spec = { ...it.spec, nm: it.name };
      if (it.irtName) { const k = keys.get(it.irtName) || refKey(findAnnot(pdfDoc, { nm: it.irtName })?.ref); if (k) spec.irt = k; else if (spec.reply) { warnings.push('Risposta senza commento di partenza, saltata'); continue; } }
      try { keys.set(it.name, await createAnnot(pdfDoc, it.pageIndex, spec, { author: it.author })); added++; }
      catch (err) { warnings.push(`${it.spec.type}: ${err.message}`); }
    }
    if (!added) return false;
  });
  const msg = `Importati ${added} commenti` + (dup ? `, ${dup} già presenti` : '') + (warnings.length ? `, ${warnings.length} saltati` : '');
  if (warnings.length) app.ui.dialog({ title: 'Importa solo i commenti', message: msg + ':\n• ' + warnings.slice(0, 15).join('\n• ') + (warnings.length > 15 ? '\n…' : ''), cancelLabel: null, okLabel: 'Chiudi' });
  else if (ok) app.ui.toast(msg, { kind: 'success' });
  else if (dup) app.ui.toast(msg);
}

export async function flattenAll(app) {
  const v = await app.ui.dialog({
    title: 'Rendi definitivi commenti e timbri', width: 520,
    message: 'Commenti, timbri e disegni diventano parte della pagina: non si potranno più spostare né cancellare (si può ancora annullare finché non chiudi il documento). Utile prima di protocollare o inviare.',
    fields: [{ name: 'pages', label: 'Pagine', type: 'pages', value: '' }],
    okLabel: 'Rendi definitivi', validate: (x) => { try { app.parsePages(x.pages); } catch (e) { return e.message; } },
  });
  if (!v) return;
  const pages = app.parsePages(v.pages);
  const warnings = [];
  let res;
  await edit(app, 'Commenti resi definitivi', async (pdfDoc) => { res = await flattenComments(pdfDoc, { pages, warnings }); if (!res.flattened && !res.skipped) return false; });
  if (!res) return;
  if (!res.flattened && !res.skipped) app.ui.toast('Nessun commento da rendere definitivo nelle pagine scelte');
  else if (warnings.length) app.ui.dialog({ title: 'Rendi definitivi', message: `Resi definitivi ${res.flattened} commenti. Non riusciti: ${res.skipped}.\n• ${warnings.slice(0, 10).join('\n• ')}`, cancelLabel: null, okLabel: 'Chiudi' });
}

export async function deleteAll(app) {
  const th = await threadsOf(app);
  if (!th.length) return app.ui.toast('Questo documento non ha commenti');
  // nessuna conferma: Annulla recupera tutto (come chiesto dagli utenti)
  await edit(app, `Eliminati tutti i commenti (${th.length})`, (pdfDoc) => (deleteAllComments(pdfDoc) ? undefined : false));
}

/** Menu «Esporta e altro» del pannello. */
export function commentActionsMenu(app, getFiltered) {
  return [
    { label: 'Copia elenco commenti (per una mail)', icon: 'file', run: () => copySummary(app, getFiltered) },
    { label: 'Riepilogo in Word…', icon: 'export', run: () => exportSummary(app, 'docx', getFiltered) },
    { label: 'Riepilogo in PDF…', icon: 'export', run: () => exportSummary(app, 'pdf', getFiltered) },
    { label: 'Riepilogo da stampare (con miniature)…', icon: 'print', run: () => exportSummary(app, 'html', getFiltered) },
    '-',
    { label: 'Esporta solo i commenti (XFDF)…', icon: 'export', run: () => exportXfdf(app) },
    { label: 'Importa solo i commenti (XFDF)…', icon: 'open', run: () => importXfdf(app) },
    '-',
    { label: 'Rendi definitivi commenti e timbri…', icon: 'lock', run: () => flattenAll(app) },
    { label: 'Elimina tutti i commenti', icon: 'trash', danger: true, run: () => deleteAll(app) },
  ];
}

export function actionTools(app) {
  return [
    { id: 'comments-summary', name: 'Riepilogo commenti', category: 'commenta', icon: 'export', description: 'Elenco dei commenti per pagina in Word, PDF o da stampare; o copiato per una mail.', keywords: 'riepilogo commenti sommario stampa commenti elenco esporta word pdf mail', run: async () => {
      const v = await app.ui.dialog({ title: 'Riepilogo commenti', fields: [{ name: 'f', type: 'radio', value: 'docx', options: [{ value: 'docx', label: 'Documento Word (.docx)' }, { value: 'pdf', label: 'PDF' }, { value: 'html', label: 'Pagina da stampare, con miniature delle pagine' }, { value: 'copy', label: 'Copia il testo (da incollare in una mail)' }, { value: 'txt', label: 'File di testo' }] }], okLabel: 'Crea riepilogo' });
      if (!v) return;
      if (v.f === 'copy') return copySummary(app);
      return exportSummary(app, v.f);
    } },
    { id: 'comments-export', name: 'Esporta solo i commenti', category: 'avanzati', icon: 'export', description: 'Salva i commenti in un file a parte (XFDF, compatibile con Acrobat).', keywords: 'esporta commenti xfdf fdf dati commenti condividi revisione', run: () => exportXfdf(app) },
    { id: 'comments-import', name: 'Importa solo i commenti', category: 'avanzati', icon: 'open', description: 'Aggiunge i commenti di un file XFDF (da Leggio o Acrobat) a questo documento.', keywords: 'importa commenti xfdf fdf unisci revisioni', run: () => importXfdf(app) },
    { id: 'comments-flatten', name: 'Rendi definitivi commenti e timbri', category: 'commenta', icon: 'lock', description: 'I commenti diventano parte della pagina (appiattisci): utile prima di protocollare.', keywords: 'appiattisci flatten rendi definitivi commenti timbri protocollo blocca', run: () => flattenAll(app) },
    { id: 'comments-delete-all', name: 'Elimina tutti i commenti', category: 'commenta', icon: 'trash', description: 'Toglie tutti i commenti (link e moduli restano). Si può annullare.', keywords: 'elimina cancella rimuovi tutti i commenti annotazioni pulisci', run: () => deleteAll(app) },
  ];
}
export { author };
