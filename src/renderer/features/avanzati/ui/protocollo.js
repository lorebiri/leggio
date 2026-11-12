// «Segnatura su copia di lavoro»: riporta su una copia il numero e la data di protocollo GIÀ ASSEGNATI da Titulus
// (il protocollo informatico del CNR). Leggio non genera mai numeri di protocollo: niente contatori.
import { applicaProtocollo, applicaStriscia, POSIZIONI, DIREZIONI, normalizzaData } from '../lib/protocollo.js';
import { leggiSegnaturaTitulus } from './segnatura-immagine.js';
import { segnaturaTitulus, MODELLI_PREDEFINITI } from '../lib/titulus.js';
import { pageText } from '../lib/textsearch.js';

const KEY = 'avanzati.protocollo';
export const KEY_MODELLI = 'avanzati.titulus.modelli';

export function preferenze(app) {
  const e = app.services?.profiloEnte?.() || {};
  const p = { ...app.settings.get(KEY, {}) };
  delete p.automatico; delete p.cifre; // impostazioni del vecchio contatore: non più usate
  return { stile: 'striscia', aoo: 'CNR', uor: '', ente: e.sigla || e.denominazione || '', ufficio: e.ufficio || '', direzione: 'entrata', classificazione: '', posizione: 'alto-destra', pagine: 'prima', colore: '#1f4e9a', copia: true, ...p };
}

/** Modelli della segnatura dalle impostazioni (uno per riga), o i predefiniti. */
export function modelliTitulus(app) {
  const s = String(app.settings.get(KEY_MODELLI, '') || '').trim();
  return s ? s.split(/\r?\n/).map((x) => x.trim()).filter(Boolean) : MODELLI_PREDEFINITI;
}

/** Cerca la segnatura di Titulus nel testo (modelli delle impostazioni; se non validi, i predefiniti). */
export function cercaSegnatura(app, testo) {
  try { return segnaturaTitulus(testo, { modelli: modelliTitulus(app) }); } catch { return segnaturaTitulus(testo); }
}

/** Cerca la segnatura di Titulus nelle prime pagine del documento. */
export async function segnaturaDelDocumento(app, doc, pagine = 2) {
  let t = '';
  for (let i = 1; i <= Math.min(pagine, doc.pageCount); i++) { const p = await doc.pdf.getPage(i); t += pageText((await p.getTextContent()).items) + '\n'; p.cleanup(); }
  return cercaSegnatura(app, t);
}

export async function timbroProtocollo(app) {
  const pref = preferenze(app);
  const doc = app.activeDoc;
  // la segnatura già presente (testo o striscia-immagine di Titulus) precompila numero e data; il documento non viene toccato
  const trovata = await app.ui.withProgress('Ricerca della segnatura di Titulus', async (p) => { p.set(null, 'Lettura della prima pagina…'); return leggiSegnaturaTitulus(app, await app.currentBytes(doc), { password: doc.password, signal: p.signal }).catch(() => null); }) || null;
  const v = await app.ui.dialog({
    title: 'Segnatura su copia di lavoro', width: 540,
    message: 'Il protocollo ufficiale si fa in Titulus. Qui riporti su una copia di lavoro il numero e la data che Titulus ha già assegnato: scrivili o incollali. Leggio non assegna numeri di protocollo.',
    fields: [
      trovata ? { name: 'info', type: 'info', text: `Nel documento c'è già la segnatura di Titulus (${trovata.origine === 'immagine' ? 'letta dalla striscia' : 'nel testo'}): numero e data sono stati presi da lì. Controllali.` } : null,
      { name: 'stile', label: 'Aspetto', type: 'radio', value: pref.stile, options: [{ value: 'striscia', label: 'Come Titulus: striscia verticale rossa sul margine sinistro' }, { value: 'riquadro', label: 'Riquadro in un angolo' }] },
      { name: 'numero', label: 'Numero di protocollo (da Titulus)', type: 'text', value: trovata ? trovata.numeroOriginale : '', required: true, placeholder: 'es. 0012345' },
      { name: 'data', label: 'Data di protocollo (da Titulus)', type: 'text', value: trovata ? trovata.data.split('-').reverse().join('/') : '', required: true, placeholder: 'es. 12/11/2026', help: 'Accetta anche 12.11.26 o 12-11-2026.' },
      { name: 'aoo', label: 'AOO (sigla nella segnatura)', type: 'text', value: trovata?.aoo || pref.aoo, placeholder: 'es. CNR' },
      { name: 'uor', label: 'UOR (unità organizzativa responsabile)', type: 'text', value: trovata?.uor || pref.uor, placeholder: 'es. XX000001' },
      { name: 'info2', type: 'info', text: 'I campi qui sotto valgono solo per l\'aspetto «Riquadro».' },
      { name: 'ente', label: 'Ente', type: 'text', value: pref.ente, placeholder: 'es. ICCOM-CNR' },
      { name: 'ufficio', label: 'Ufficio (facoltativo)', type: 'text', value: pref.ufficio },
      { name: 'direzione', label: 'Entrata / uscita', type: 'select', value: pref.direzione, options: DIREZIONI },
      { name: 'classificazione', label: 'Classificazione (facoltativa)', type: 'text', value: trovata?.classifica || pref.classificazione, placeholder: 'es. III/2' },
      { name: 'posizione', label: 'Posizione', type: 'select', value: pref.posizione, options: POSIZIONI },
      { name: 'pagine', label: 'Su quali pagine', type: 'radio', value: pref.pagine, options: [{ value: 'prima', label: 'Solo la prima' }, { value: 'tutte', label: 'Tutte le pagine' }] },
      { name: 'copia', label: 'Indica che è una copia di lavoro («COPIA DI LAVORO»)', type: 'checkbox', value: pref.copia !== false },
      { name: 'colore', label: 'Colore', type: 'color', value: pref.colore },
    ].filter(Boolean),
    okLabel: 'Riporta la segnatura',
    validate: (x) => {
      if (!/^\s*[A-Za-z0-9/\-.]{1,40}\s*$/.test(String(x.numero))) return 'Scrivi il numero di protocollo come assegnato da Titulus (es. 0012345).';
      if (!normalizzaData(x.data)) return 'La data non è valida. Esempio: 12/11/2026';
      return null;
    },
  });
  if (!v) return;
  const data = normalizzaData(v.data);
  const numero = String(v.numero).trim();
  app.settings.set(KEY, { stile: v.stile, aoo: v.aoo, uor: v.uor, ente: v.ente, ufficio: v.ufficio, direzione: v.direzione, classificazione: v.classificazione, posizione: v.posizione, pagine: v.pagine, colore: v.colore, copia: v.copia });
  await app.editWithPdfLib(`Segnatura n. ${numero} (copia di lavoro)`, async (pdfDoc, PDFLib) => {
    if (pdfDoc.isEncrypted) throw new Error('Il documento è protetto: togli la protezione prima di riportare la segnatura.');
    if (v.stile === 'striscia') await applicaStriscia(pdfDoc, PDFLib, { aoo: v.aoo, numero, data, uor: v.uor, copia: v.copia, pagine: v.pagine });
    else await applicaProtocollo(pdfDoc, PDFLib, { ...v, numero, data });
  });
  app.ui.toast('Segnatura riportata. Salva questa copia con «Salva con nome»: il documento ufficiale resta quello in Titulus.', { kind: 'info', timeout: 9000 });
}
