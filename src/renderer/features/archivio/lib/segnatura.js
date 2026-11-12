// Segnatura di protocollo stampata sul documento dal sistema di protocollo informatico (all'ICCOM-CNR:
// Titulus). Leggio NON genera mai numeri di protocollo: li legge dal documento o li inserisce l'utente.
// Se l'area avanzati offre app.services.segnaturaTitulus(testo) (modello configurabile) si usa quella;
// questo è il ripiego minimo con un modello generico. Logica pura.
import { dataDaTesto } from './testo.js';

const DATA = '(\\d{1,2}[/.\\-]\\d{1,2}[/.\\-]\\d{4}|\\d{4}-\\d{2}-\\d{2})';
const AOO = '([A-Z][A-Z0-9]{1,15}(?:[-_][A-Z0-9]{2,15}){0,3})';
const NUM = '(\\d{1,10})(?:/(\\d{4}))?';

// Modelli generici, dal più preciso al più largo:
//  «Prot. CNR n. 0123456 del 01/02/2026 - UOR: SI000099», «Prot. n. 0012345 del 12/11/2026»,
//  «Protocollo n. 12345/2026 del 12.11.2026», con la sigla AOO facoltativa prima o dopo «Prot.»;
//  «CNR-ICCOM - 0012345 - 12/11/2026» (sigla AOO, numero, data)
const UOR = '(?:\\s*[-–,]?\\s*UOR\\s*[:.]?\\s*([A-Z][A-Z0-9|]{0,3}\\d{3,9}))?';
const MODELLI = [
  // «Prot. CNR n. 0123456 del 01/02/2026 - UOR: SI000099» (forma della striscia di Titulus al CNR)
  { re: new RegExp(`(?:\\b${AOO}\\s*[-–:,]?\\s*)?\\b(?:[Pp]rot(?:ocollo)?|PROT(?:OCOLLO)?)\\.?\\s*(?:${AOO}\\s+)?(?:(?:[Nn](?:\\.|°|º|r\\.?|um(?:ero)?\\.?)?|NUMERO)\\s*)?:?\\s*${NUM}\\s*(?:del|DEL|in data|[-–,])\\s*${DATA}${UOR}`), aoo: [2, 1], num: 3, anno: 4, data: 5, uor: 6 },
  // «CNR-ICCOM - 0012345 - 12/11/2026» (sigla AOO, numero, data)
  { re: new RegExp(`\\b${AOO}\\s*[-–|]\\s*(\\d{1,10})\\s*[-–|]\\s*${DATA}${UOR}`), aoo: [1], num: 2, data: 3, uor: 4, serveAoo: true },
];
// sigle che non sono un'AOO (parole comuni in maiuscolo prima di un numero e di una data)
const NON_AOO = /^(UOR|FATTURA|DEL|N|NR|NUM|NUMERO|DATA|ORDINE|DETERMINA|CIG|CUP|IVA|PIVA|TOTALE|PAG|PAGINA|REP|ART|INPS|INAIL|DURC|IBAN|TEL|FAX|CAP|DOC|PROT|PROTOCOLLO)$/i;

/**
 * Cerca la segnatura nel testo (di solito nell'intestazione della prima pagina).
 * → { numero, data (ISO), aoo, testo } oppure null
 */
export function segnaturaGenerica(testo) {
  const t = String(testo || '').slice(0, 6000).replace(/[ \t ]+/g, ' ');
  for (const m of MODELLI) {
    const x = m.re.exec(t);
    if (!x) continue;
    const aoo = (m.aoo.map((k) => x[k]).find((v) => v && !NON_AOO.test(v)) || '').toUpperCase();
    if (m.serveAoo && !aoo) continue; // senza «prot.» e senza sigla è un numero qualunque
    const data = dataDaTesto(x[m.data]);
    if (!data) continue;
    const numero = String(x[m.num]).trim();
    if (!/^\d+$/.test(numero) || /^0+$/.test(numero)) continue;
    return { numero, data, aoo, uor: normalizzaUor(x[m.uor]), testo: x[0].trim().slice(0, 140) };
  }
  return null;
}

/**
 * Codice UOR (al CNR: due lettere e sei cifre, es. SI000099). L'OCR scambia spesso I con 1 o |
 * e O con 0 nelle lettere iniziali: «S1000084» → «SI000084».
 */
export function normalizzaUor(u) {
  let s = String(u || '').toUpperCase().replace(/\s+/g, '');
  const m = s.match(/^([A-Z])([1|L0])(\d{6})$/);
  if (m) s = m[1] + ({ 1: 'I', '|': 'I', L: 'I', 0: 'O' }[m[2]]) + m[3];
  return s.slice(0, 40);
}

/** Normalizza ciò che restituisce app.services.segnaturaTitulus (forma non ancora fissata) o il ripiego. */
export function normalizzaSegnatura(s) {
  if (!s || typeof s !== 'object') return null;
  const numero = String(s.numero ?? s.number ?? s.n ?? '').trim().slice(0, 40);
  if (!numero) return null;
  const dataGrezza = String(s.data ?? s.date ?? '').trim();
  const data = /^\d{4}-\d{2}-\d{2}/.test(dataGrezza) ? dataGrezza.slice(0, 10) : dataDaTesto(dataGrezza);
  return { numero, data: data || '', aoo: String(s.aoo ?? s.sigla ?? s.siglaAoo ?? '').trim().slice(0, 40), uor: normalizzaUor(s.uor ?? s.UOR ?? ''), testo: String(s.testo ?? s.text ?? '').slice(0, 120) };
}

/** Numero di protocollo confrontabile: solo cifre e lettere, senza zeri iniziali. */
export function numeroConfrontabile(n) {
  return String(n || '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^0+(?=\d)/, '');
}
