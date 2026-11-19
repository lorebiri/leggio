// Assistente IA, logica pura per la ricerca per significato nell'archivio.
import { fondi, haCodici } from './passaggi.js';

/** Documenti dell'archivio da indicizzare: con testo, non protetti, non scansioni. */
export const indicizzabile = (r) => !!r?.impronta && !r.scansione && !r.protetto && !r.errore && (r.pagine || 0) > 0;

/**
 * Confronta l'archivio con l'indice per significato.
 * righe: documenti dell'archivio; note: impronte già nell'indice.
 * → { nuovi: [righe da indicizzare], vecchi: [impronte da togliere], totale }
 */
export function daIndicizzare(righe, note) {
  const noteS = new Set(note);
  const presenti = new Set();
  const nuovi = [];
  for (const r of righe) {
    if (!indicizzabile(r)) continue;
    if (presenti.has(r.impronta)) continue; // copie dello stesso file: basta una volta
    presenti.add(r.impronta);
    if (!noteS.has(r.impronta)) nuovi.push(r);
  }
  return { nuovi, vecchi: [...noteS].filter((i) => !presenti.has(i)), totale: presenti.size };
}

/**
 * Unisce i risultati per significato (passaggi migliori per documento) con quelli per parole dell'archivio.
 * semantici: [{ impronta, pagina, testo, punteggio }]; parole: [{ impronta, pagina, id }]; perImpronta: Map impronta → riga.
 * Se la richiesta contiene codici o numeri (CIG, protocollo) le parole contano di più.
 * → [{ riga, pagina, estratto, perSignificato, perParole }]
 */
export function fondiRisultati(q, semantici, parole, perImpronta, { max = 30 } = {}) {
  const ordS = semantici.map((s) => s.impronta);
  const ordP = parole.map((p) => p.impronta).filter(Boolean);
  const codici = haCodici(q);
  const ordini = codici ? [ordP, ordP, ordS] : [ordS, ordS, ordP];
  const sem = new Map(semantici.map((s) => [s.impronta, s]));
  const par = new Map(parole.map((p) => [p.impronta, p]));
  return fondi(ordini).slice(0, max).map((imp) => {
    const s = sem.get(imp); const p = par.get(imp);
    const riga = perImpronta.get(imp);
    if (!riga) return null;
    const pagina = (codici ? p?.pagina || s?.pagina : s?.pagina || p?.pagina) || 1;
    return { riga, pagina, estratto: s?.testo || '', perSignificato: !!s, perParole: !!p };
  }).filter(Boolean);
}
