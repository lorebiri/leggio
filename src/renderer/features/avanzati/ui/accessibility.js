// «Prepara per l'accessibilità»: titolo, lingua, testo alternativo e struttura di tag di base.
// (La sola verifica è dell'area che offre il «Controllo accessibilità».)
import { statoAccessibilita, elencaFigure, creaTag, impostaBase } from '../lib/tagger.js';

const LINGUE = [
  { value: 'it-IT', label: 'Italiano' }, { value: 'en-GB', label: 'Inglese (Regno Unito)' }, { value: 'en-US', label: 'Inglese (Stati Uniti)' },
  { value: 'de-DE', label: 'Tedesco' }, { value: 'fr-FR', label: 'Francese' }, { value: 'es-ES', label: 'Spagnolo' }, { value: 'sl-SI', label: 'Sloveno' }, { value: 'de-AT', label: 'Tedesco (Alto Adige)' },
];
const MAX_FIG = 40;

export async function prepareAccessibility(app) {
  const doc = app.activeDoc;
  const { PDFLib } = app.lib;
  const analisi = await app.ui.withProgress('Analisi del documento', async (p) => {
    p.set(null, 'Ricerca di testo e immagini…');
    await new Promise((r) => setTimeout(r, 30));
    const d = await app.lib.openPdfLib(await app.currentBytes(doc), doc.password);
    return { stato: statoAccessibilita(d, PDFLib), figure: d.isEncrypted ? [] : elencaFigure(d, PDFLib), cifrato: d.isEncrypted };
  }, { cancellable: false });
  if (!analisi) return;
  if (analisi.cifrato) return app.ui.dialog({ title: 'Documento protetto', message: 'Il documento è protetto: togli prima la protezione (password) e riprova.', cancelLabel: null, okLabel: 'Chiudi' });
  const { stato, figure } = analisi;
  const fig = figure.filter((f) => !f.piccola);
  const fields = [
    { name: 'title', label: 'Titolo del documento (letto per primo dagli screen reader)', type: 'text', value: stato.title || doc.name.replace(/\.pdf$/i, ''), required: true },
    { name: 'lang', label: 'Lingua principale', type: 'select', value: LINGUE.some((l) => l.value === stato.lang) ? stato.lang : 'it-IT', options: LINGUE },
    stato.tagged
      ? { name: 'info1', type: 'info', text: 'Il documento ha già una struttura di tag: verrà mantenuta. Verranno aggiornati solo titolo e lingua.' }
      : { name: 'tag', label: 'Crea la struttura dei tag (titoli, paragrafi, immagini)', type: 'checkbox', value: true, help: 'Necessaria perché chi usa uno screen reader possa leggere il documento in ordine.' },
  ];
  if (!stato.tagged && fig.length) {
    fields.push({ name: 'info2', type: 'info', text: `Descrivi le immagini (${fig.length}). Lascia vuoto il campo se l'immagine è solo decorativa (cornici, sfondi, linee).` });
    fig.slice(0, MAX_FIG).forEach((f, i) => fields.push({ name: 'alt_' + f.id, label: `Immagine ${i + 1} — pagina ${f.page} (${f.w}×${f.h} punti)${f.probabileScansione ? ' — sembra la scansione della pagina' : ''}`, type: 'text', value: '', placeholder: f.probabileScansione ? 'Vuoto: scansione già riconosciuta come testo' : 'es. Logo del CNR' }));
    if (fig.length > MAX_FIG) fields.push({ name: 'info3', type: 'info', text: `Le altre ${fig.length - MAX_FIG} immagini saranno considerate decorative.` });
  }
  fields.push({ name: 'info4', type: 'info', text: 'Cosa fa Leggio: imposta titolo e lingua, riconosce titoli e paragrafi dalla grandezza del carattere, collega il testo alternativo alle immagini, segna linee e decorazioni come non da leggere. Cosa non fa: non riconosce tabelle, elenchi, note e colonne multiple; l\'ordine di lettura è quello in cui il testo è scritto nel file. Dopo, controlla il risultato con il controllo di accessibilità.' });
  const v = await app.ui.dialog({ title: 'Prepara per l\'accessibilità', width: 600, fields, okLabel: 'Applica' });
  if (!v) return;
  const alt = {};
  for (const f of figure) { const t = v['alt_' + f.id]; alt[f.id] = typeof t === 'string' && t.trim() ? t.trim().slice(0, 1000) : ''; }
  let report = null;
  try {
    await app.ui.withProgress('Preparazione per l\'accessibilità', async (p) => {
      p.set(null, 'Creazione della struttura…');
      await new Promise((r) => setTimeout(r, 30));
      await app.editWithPdfLib(v.tag ? 'Struttura di accessibilità creata' : 'Titolo e lingua impostati', (pdfDoc, PDFLib2) => {
        if (v.tag && !stato.tagged) report = creaTag(pdfDoc, PDFLib2, { lang: v.lang, title: v.title, alt });
        else impostaBase(pdfDoc, PDFLib2, { lang: v.lang, title: v.title });
      });
    }, { cancellable: false });
  } catch (err) { return app.reportError(err, 'Preparazione non riuscita'); }
  if (!report) return;
  const check = app.tools.list().find((t) => t.id !== 'accessibility-prepare' && /accessibilit/i.test(t.name) && /controll|verific/i.test(t.name + t.description));
  const righe = [`Pagine elaborate: ${report.pagine}`, `Titoli riconosciuti: ${report.titoli}`, `Paragrafi: ${report.paragrafi}`, `Immagini con testo alternativo: ${report.figure}`, `Elementi decorativi: ${report.decorative}`];
  if (report.senzaTesto.length) righe.push(`Pagine senza testo leggibile: ${report.senzaTesto.slice(0, 15).join(', ')}${report.senzaTesto.length > 15 ? '…' : ''} — se sono scansioni, fai prima il riconoscimento del testo (OCR).`);
  if (report.pagineSaltate.length) righe.push(`Pagine non elaborate (contenuto non leggibile): ${report.pagineSaltate.join(', ')}`);
  const r = await app.ui.dialog({ title: 'Struttura di accessibilità creata', body: app.ui.h('div', { class: 'av-pre' }, righe.join('\n') + '\n\nRicorda di salvare il documento. Puoi annullare con Annulla.'), okLabel: check ? 'Controlla l\'accessibilità' : 'Chiudi', cancelLabel: check ? 'Chiudi' : null });
  if (r && check) app.tools.run(check.id);
}
