// Web Worker della compilazione in serie: pdf-lib fuori dal thread dell'interfaccia. Riceve il modulo,
// il modello e i record; invia i PDF a gruppi e aspetta la conferma prima di continuare (memoria costante).
//   → { t:'genera', base, modello, records, opzioni }   ← { t:'progresso' } { t:'gruppo', esiti } { t:'fine', risultato } { t:'errore' }
//   → { t:'ack' } dopo ogni gruppo · { t:'interrompi' }
import * as PDFLib from '@cantoo/pdf-lib';
import { generaSerie } from './lib/serie.js';

const stato = { aborted: false };
let ack = null;
let ultimoProgresso = 0;

// cede il controllo in fretta (MessageChannel, senza il ritardo minimo di setTimeout): così «interrompi» arriva
const canale = new MessageChannel();
const coda = [];
canale.port1.onmessage = () => coda.shift()?.();
const cedi = () => new Promise((r) => { coda.push(r); canale.port2.postMessage(0); });

self.onmessage = async (ev) => {
  const m = ev.data || {};
  // il gruppo in corso lo sblocca solo l'«ack»: arriva quando il thread principale ha finito di scriverne i file
  if (m.t === 'interrompi') { stato.aborted = true; return; }
  if (m.t === 'ack') { const a = ack; ack = null; a?.(); return; }
  if (m.t !== 'genera') return;
  stato.aborted = false;
  try {
    const risultato = await generaSerie({
      PDFLib, base: m.base, modello: m.modello, records: m.records, opzioni: m.opzioni, signal: stato, cedi, gruppo: m.gruppo || 10,
      onProgresso: (fatti, totale, etichetta) => {
        const ora = Date.now();
        if (ora - ultimoProgresso > 80 || fatti === totale) { ultimoProgresso = ora; self.postMessage({ t: 'progresso', fatti, totale, etichetta }); }
      },
      onGruppo: (esiti) => new Promise((resolve) => {
        if (stato.aborted && !esiti.some((e) => e.bytes)) { resolve(); return; }
        ack = resolve;
        self.postMessage({ t: 'gruppo', esiti }, esiti.filter((e) => e.bytes).map((e) => e.bytes.buffer));
      }),
    });
    self.postMessage({ t: 'fine', risultato }, risultato.unico ? [risultato.unico.buffer] : []);
  } catch (e) {
    self.postMessage({ t: 'errore', messaggio: e?.message || String(e) });
  }
};
