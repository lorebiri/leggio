// Collegamento con l'archivio (evento «archivio:stato») e proposta «Segna come protocollato» se il documento
// porta già la segnatura di Titulus.
import { datiPerTitulus, testoDatiTitulus } from '../lib/titulus.js';
import { estraiDati } from '../lib/datichiave.js';
import { analizza } from '../lib/rinomina.js';
import { pageText } from '../lib/textsearch.js';
import { leggiSegnaturaTitulus } from './segnatura-immagine.js';

async function testo(doc, n = 3) {
  let t = '';
  for (let i = 1; i <= Math.min(n, doc.pageCount); i++) { const p = await doc.pdf.getPage(i); t += pageText((await p.getTextContent()).items) + '\n'; p.cleanup(); }
  return t;
}
async function copia(app, t) {
  try { await navigator.clipboard.writeText(t); app.ui.toast(`Copiato: ${t.length > 50 ? t.slice(0, 50) + '…' : t}`, { kind: 'success', timeout: 2500 }); }
  catch { app.ui.toast('Impossibile copiare negli appunti.', { kind: 'error' }); }
}

/** Percorso del file originale del documento (anche se la scheda è l'impaginazione di una fattura o il PDF di un .p7m). */
export function percorsoOriginale(doc) { return doc?.data?.fattura?.xmlPath || doc?.data?.p7m?.sourcePath || doc?.path || null; }

/**
 * Comunica all'archivio lo stato «Protocollato (Titulus) n. … del …». Contratto (vedi docs/aree/avanzati.md):
 * app.bus.emit('archivio:stato', { path, nome, modifica: { imposta: 'protocollato', numeroProtocollo, dataProtocollo }, origine })
 * → true se l'archivio è presente (app.archivio).
 */
export function segnalaProtocollato(app, doc, { numero, data }, origine = 'segnatura') {
  const path = percorsoOriginale(doc);
  // l'archivio conferma impostando evento.ricevuto = true (in modo sincrono) se ha trovato il documento
  const evento = { path, nome: doc?.name, modifica: { imposta: 'protocollato', numeroProtocollo: String(numero), dataProtocollo: data }, origine, ricevuto: false };
  app.bus.emit('archivio:stato', evento);
  return evento.ricevuto === true;
}

export function registerDatiTitulus(app) {
  // proposta automatica: il documento aperto porta già la segnatura di Titulus (testo o striscia)
  app.bus.on('document:loaded', ({ doc }) => {
    if (!app.archivio || !doc?.bytes || doc.bytes.length > 80 * 1048576 || doc.data?.fattura) return;
    setTimeout(async () => {
      try {
        const s = await leggiSegnaturaTitulus(app, doc.bytes, { password: doc.password });
        if (!s || !app.docs.includes(doc)) return;
        doc.data.segnaturaTitulus = s;
        app.ui.toast(`Questo documento porta la segnatura di Titulus n. ${s.numero} del ${s.data.split('-').reverse().join('/')}.`, { kind: 'info', timeout: 12000,
          action: percorsoOriginale(doc) ? { label: 'Segna come protocollato', run: () => { const ok = segnalaProtocollato(app, doc, s, 'lettura'); app.ui.toast(ok ? 'Stato aggiornato nell\'archivio.' : 'L\'archivio non ha ricevuto l\'aggiornamento: cambia lo stato dall\'archivio.', { kind: ok ? 'success' : 'warning' }); } } : undefined });
      } catch { /* nessuna segnatura leggibile: niente da proporre */ }
    }, 1200);
  });

  // i dati da copiare per Titulus sono nel riquadro «Controlli» (ui/controlli.js)
}
