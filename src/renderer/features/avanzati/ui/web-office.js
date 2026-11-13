// Crea PDF da pagina web / file HTML e da documenti Office (LibreOffice o Microsoft Office).
import { isDesktop, call, chooseFiles, apriRisultato } from '../native.js';

export const OFFICE_EXT = ['doc', 'docx', 'docm', 'dot', 'dotx', 'odt', 'ott', 'rtf', 'txt', 'xls', 'xlsx', 'xlsm', 'ods', 'csv', 'ppt', 'pptx', 'pps', 'ppsx', 'odp', 'odg'];

function soloApp(app) {
  app.ui.dialog({ title: 'Disponibile nell\'app', message: 'Questa funzione usa componenti del computer ed è disponibile solo nell\'app Leggio installata, non nell\'anteprima web.', cancelLabel: null, okLabel: 'Chiudi' });
}

export async function creaDaWeb(app) {
  if (!isDesktop()) return soloApp(app);
  const pref = app.settings.get('avanzati.web', { formato: 'A4', orientamento: 'verticale', margini: 'normali', sfondi: true });
  const v = await app.ui.dialog({
    title: 'Crea PDF da pagina web', width: 520,
    fields: [
      { name: 'origine', label: 'Che cosa vuoi convertire', type: 'radio', value: 'url', options: [{ value: 'url', label: 'Un indirizzo web' }, { value: 'file', label: 'Un file HTML sul computer' }] },
      { name: 'url', label: 'Indirizzo web', type: 'text', value: '', placeholder: 'https://www.esempio.it/pagina', help: 'Serve la connessione a Internet solo per scaricare la pagina.' },
      { name: 'formato', label: 'Formato della pagina', type: 'select', value: pref.formato, options: ['A4', 'A3', 'A5', 'Letter', 'Legal'] },
      { name: 'orientamento', label: 'Orientamento', type: 'select', value: pref.orientamento, options: [{ value: 'verticale', label: 'Verticale' }, { value: 'orizzontale', label: 'Orizzontale' }] },
      { name: 'margini', label: 'Margini', type: 'select', value: pref.margini, options: [{ value: 'normali', label: 'Normali (12 mm)' }, { value: 'minimi', label: 'Minimi (5 mm)' }, { value: 'nessuno', label: 'Nessuno' }] },
      { name: 'sfondi', label: 'Stampa colori e immagini di sfondo', type: 'checkbox', value: pref.sfondi },
    ],
    okLabel: 'Crea PDF',
    validate: (x) => (x.origine === 'url' && !/^\s*(https?:\/\/)?[^\s/]+\.[^\s]{2,}/i.test(x.url) ? 'Scrivi un indirizzo web valido, per esempio https://www.cnr.it' : null),
  });
  if (!v) return;
  app.settings.set('avanzati.web', { formato: v.formato, orientamento: v.orientamento, margini: v.margini, sfondi: v.sfondi });
  const opts = { pageSize: v.formato, landscape: v.orientamento === 'orizzontale', margins: { normali: 'default', minimi: 'minimum', nessuno: 'none' }[v.margini], printBackground: v.sfondi };
  let nome = 'pagina web.pdf';
  if (v.origine === 'url') {
    let url = v.url.trim(); if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
    opts.url = url;
    try { nome = (new URL(url).hostname.replace(/^www\./, '') + new URL(url).pathname.replace(/\/$/, '').replace(/[^A-Za-z0-9]+/g, '_')).slice(0, 80) + '.pdf'; } catch {}
  } else {
    const [f] = await chooseFiles(app, { exts: ['html', 'htm', 'xhtml', 'svg', 'txt'], multiple: false, title: 'Scegli il file HTML', filterName: 'Pagine web' });
    if (!f) return;
    opts.filePath = f.path; nome = f.name.replace(/\.[^.]+$/, '') + '.pdf';
  }
  const bytes = await app.ui.withProgress('Creazione del PDF', async (p) => { p.set(null, v.origine === 'url' ? 'Caricamento della pagina…' : 'Impaginazione…'); return call(app, 'html-to-pdf', opts); }, { cancellable: false });
  if (bytes) await apriRisultato(app, bytes, nome);
}

export async function creaDaOffice(app) {
  if (!isDesktop()) return soloApp(app);
  const items = await chooseFiles(app, { exts: OFFICE_EXT, multiple: true, title: 'Scegli i documenti da convertire in PDF', filterName: 'Documenti Office e OpenDocument' });
  for (const it of items) {
    const bytes = await it.read();
    const ok = await convertOfficeBytes(app, bytes, it.name);
    if (ok === 'stop') break;
  }
}

/** Converte byte di un documento Office e apre il PDF in una scheda. → true | false | 'stop' */
export async function convertOfficeBytes(app, bytes, name) {
  if (!isDesktop()) { soloApp(app); return 'stop'; }
  const jobId = 'j' + Date.now() + Math.random().toString(36).slice(2, 7);
  try {
    const r = await app.ui.withProgress(`Conversione in PDF: ${name}`, async (p) => {
      p.set(null, 'Conversione in corso: può richiedere fino a un minuto…');
      p.signal.addEventListener('abort', () => { call(app, 'cancel', { jobId }).catch(() => {}); });
      return call(app, 'office-convert', { name, bytes, jobId, timeoutMs: 180000 });
    });
    if (!r) return false;
    await apriRisultato(app, r.bytes, name.replace(/\.[^.]+$/, '') + '.pdf');
    return true;
  } catch (err) {
    if (err.code === 'NO_OFFICE') { await spiegaLibreOffice(app); return 'stop'; }
    app.reportError(err, `«${name}» non convertito`);
    return false;
  }
}

async function spiegaLibreOffice(app) {
  const info = await app.platform.info();
  const mac = info.platform === 'darwin'; const win = info.platform === 'win32';
  const r = await app.ui.dialog({
    title: 'Serve LibreOffice (gratuito)',
    body: app.ui.h('div', { class: 'av-pre' }, `Per trasformare in PDF i documenti Word, Excel e PowerPoint, Leggio usa LibreOffice, un programma gratuito e libero.\n\n1. Apri il sito ufficiale www.libreoffice.org e scegli «Scarica».\n2. ${mac ? 'Apri il file scaricato e trascina LibreOffice nella cartella Applicazioni.' : win ? 'Avvia il file scaricato e segui l\'installazione (vanno bene le scelte proposte).' : 'Installalo dal gestore dei programmi del tuo sistema.'}\n3. Torna in Leggio e riprova: non serve riavviare.${win ? '\n\nIn alternativa, se sul computer è installato Microsoft Office, Leggio lo usa automaticamente.' : ''}\n\nSe nel tuo ufficio non puoi installare programmi, chiedi al servizio informatico.`),
    okLabel: 'Apri il sito di LibreOffice', cancelLabel: 'Chiudi',
  });
  if (r) app.platform.openExternal('https://www.libreoffice.org/download/download/');
}
