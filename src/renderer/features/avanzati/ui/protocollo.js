// Lettura della segnatura di Titulus (modelli configurabili). Leggio NON appone segnature: solo Titulus
// (il protocollo informatico del CNR). Leggio non genera mai numeri di protocollo: niente contatori.
import { leggiSegnaturaTitulus } from './segnatura-immagine.js';
import { segnalaProtocollato, percorsoOriginale } from './datititulus.js';
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

// Nessuna funzione appone segnature: a ICCOM-CNR la stampigliatura di protocollo la mette solo Titulus.
