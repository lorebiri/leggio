// «Crea PDF»: da foto/immagini, da file di testo, pagine vuote. E foto trascinate nella finestra.
import { pdfDaTesto, pdfVuoto } from '../logica/crea.js';
import { FORMATI_ETICHETTE, senzaEstensione } from '../logica/util.js';
import { inserisciDaPdf, caricaPdf } from '../logica/struttura.js';
import { pdfDaImmagini } from '../logica/crea.js';
import { apriUnisci } from './unisci.js';
import { apriRisultato, mostraErrore, eImmagine, preparaImmagine, leggiFile, FILTRO_IMMAGINI } from './comune.js';
import { salva } from '../logica/util.js';
import { modificaDoc } from './comune.js';

export async function apriCrea(app) {
  const v = await app.ui.dialog({ title: 'Crea PDF', message: 'Da cosa vuoi creare il PDF?', fields: [
    { name: 'da', type: 'radio', value: 'immagini', options: [
      { value: 'immagini', label: 'Da foto o immagini (JPG, PNG, HEIC…) — una per pagina' },
      { value: 'testo', label: 'Da un file di testo (.txt)' },
      { value: 'vuoto', label: 'Documento vuoto' },
    ] },
    { name: 'info', type: 'info', text: 'Per documenti Word, Excel o LibreOffice usa lo strumento «Converti in PDF», se disponibile.' },
  ], okLabel: 'Continua' });
  if (!v) return;
  if (v.da === 'immagini') return creaDaImmagini(app);
  if (v.da === 'testo') return creaDaTesto(app);
  return creaVuoto(app);
}

export async function creaDaImmagini(app, file) {
  if (!file) {
    const fs = await app.platform.openFiles({ multiple: true, filters: FILTRO_IMMAGINI, raw: true, title: 'Scegli le foto o le immagini' });
    if (!fs?.length) return;
    file = fs;
  }
  file = [...file].sort((a, b) => a.name.localeCompare(b.name, 'it', { numeric: true }));
  return apriUnisci(app, { file, includiAttivo: false, titolo: 'Crea PDF da immagini', nomeRisultato: file.length === 1 ? `${senzaEstensione(file[0].name)}.pdf` : 'Immagini.pdf' });
}

function decodifica(bytes) {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes);
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { return new TextDecoder('windows-1252').decode(bytes); }
}

export async function creaDaTesto(app, file) {
  if (!file) {
    const fs = await app.platform.openFiles({ multiple: false, filters: [{ name: 'Testo', extensions: ['txt', 'text', 'csv', 'md', 'log'] }], raw: true, title: 'Scegli il file di testo' });
    if (!fs?.length) return;
    file = fs[0];
  }
  if (file.bytes.length > 30 * 1048576) return mostraErrore(app, Object.assign(new Error(`«${file.name}» è troppo grande per essere impaginato (oltre 30 MB di testo).`), { name: 'ErroreUtente' }), 'Crea PDF');
  const ultimo = app.settings.get('pagine.testo', { formato: 'A4', font: 'helvetica', dimensione: 11, margine: 20 });
  const v = await app.ui.dialog({ title: 'Crea PDF da testo', message: `«${file.name}»`, fields: [
    { name: 'formato', label: 'Formato pagina', type: 'select', value: ultimo.formato, options: FORMATI_ETICHETTE.map(([k, l]) => ({ value: k, label: l })) },
    { name: 'font', label: 'Carattere', type: 'select', value: ultimo.font, options: [{ value: 'helvetica', label: 'Helvetica (senza grazie)' }, { value: 'times', label: 'Times (con grazie)' }, { value: 'courier', label: 'Courier (a spaziatura fissa, per tabelle di testo)' }] },
    { name: 'dimensione', label: 'Dimensione (pt)', type: 'number', min: 6, max: 36, value: ultimo.dimensione },
    { name: 'margine', label: 'Margini (mm)', type: 'number', min: 5, max: 50, value: ultimo.margine },
  ], okLabel: 'Crea', validate: (x) => (!(x.dimensione >= 6 && x.dimensione <= 36) ? 'Dimensione tra 6 e 36.' : !(x.margine >= 5 && x.margine <= 50) ? 'Margini tra 5 e 50 mm.' : null) });
  if (!v) return;
  app.settings.set('pagine.testo', v);
  const bytes = await app.ui.withProgress('Impaginazione del testo', async (p) => {
    const d = await pdfDaTesto(decodifica(file.bytes), { ...v, titolo: senzaEstensione(file.name), onProgress: (f) => p.set(f), signal: p.signal });
    return salva(d);
  }).catch((e) => { mostraErrore(app, e, 'Crea PDF'); return null; });
  if (bytes) await apriRisultato(app, bytes, `${senzaEstensione(file.name)}.pdf`);
}

export async function creaVuoto(app) {
  const v = await app.ui.dialog({ title: 'Documento vuoto', fields: [
    { name: 'formato', label: 'Formato', type: 'select', value: 'A4', options: FORMATI_ETICHETTE.map(([k, l]) => ({ value: k, label: l })) },
    { name: 'orizz', label: 'Orientamento orizzontale', type: 'checkbox', value: false },
    { name: 'pagine', label: 'Numero di pagine', type: 'number', min: 1, max: 1000, step: 1, value: 1 },
  ], okLabel: 'Crea', validate: (x) => (!(Number.isInteger(x.pagine) && x.pagine >= 1 && x.pagine <= 1000) ? 'Da 1 a 1000 pagine.' : null) });
  if (!v) return;
  const d = await pdfVuoto({ formato: v.formato, pagine: v.pagine, orizzontale: v.orizz });
  await apriRisultato(app, await salva(d), 'Nuovo documento.pdf');
}

/** Foto o testi trascinati nella finestra (non PDF). */
export function installaTrascinamento(app) {
  app.bus.on('files:dropped-nonpdf', async ({ files }) => {
    // se la vista Organizza è aperta, i file li gestisce lei
    if (document.querySelector('.pg-org:not([hidden])')) return;
    const immagini = files.filter((f) => eImmagine(f.name));
    const testi = files.filter((f) => /\.(txt|text)$/i.test(f.name));
    try {
      if (immagini.length) {
        const letti = []; for (const f of immagini) letti.push(await leggiFile(f));
        const doc = app.activeDoc;
        let scelta = 'nuovo';
        if (doc) {
          const v = await app.ui.dialog({ title: immagini.length === 1 ? 'Una foto trascinata' : `${immagini.length} foto trascinate`, fields: [{ name: 'a', type: 'radio', value: 'nuovo', options: [{ value: 'nuovo', label: 'Crea un nuovo PDF con le foto' }, { value: 'aggiungi', label: `Aggiungile in fondo a «${doc.name}»` }] }], okLabel: 'Continua' });
          if (!v) return; scelta = v.a;
        }
        if (scelta === 'nuovo') await creaDaImmagini(app, letti);
        else {
          const imgs = []; for (const f of letti) imgs.push({ ...(await preparaImmagine(app, f.bytes, f.name)), nome: f.name });
          const src = await caricaPdf(await salva(await pdfDaImmagini(imgs, { formato: 'A4', margine: 10 })));
          await modificaDoc(app, `Aggiunte ${imgs.length} foto`, (d) => inserisciDaPdf(d, src, [...Array(src.getPageCount()).keys()], d.getPageCount()));
        }
      }
      for (const f of testi) await creaDaTesto(app, await leggiFile(f));
    } catch (err) { mostraErrore(app, err, 'File trascinati'); }
  });
}
