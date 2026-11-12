// Estrazione dei dati chiave dai documenti di acquisto: CIG, CUP, P.IVA, codici fiscali, IBAN, importi, date e scadenze,
// e stato del DURC. Logica pura sul testo (le verifiche dei caratteri di controllo sono incluse qui, senza dipendenze).
import { trovaDate } from './rinomina.js';

export const DURATA_DURC_GIORNI = 120; // durata predefinita (impostazione modificabile: verificare la norma vigente)

export function partitaIvaValida(s) {
  const d = String(s).replace(/\D/g, '');
  if (d.length !== 11 || /^0{11}$/.test(d)) return false;
  let sum = 0;
  for (let i = 0; i < 10; i++) { let n = +d[i]; if (i % 2 === 1) { n *= 2; if (n > 9) n -= 9; } sum += n; }
  return (10 - (sum % 10)) % 10 === +d[10];
}
const CF_DISPARI = [1, 0, 5, 7, 9, 13, 15, 17, 19, 21, 2, 4, 18, 20, 11, 3, 6, 8, 12, 14, 16, 10, 22, 25, 24, 23];
export function codiceFiscaleValido(s) {
  const c = String(s).toUpperCase();
  if (!/^[A-Z]{6}[0-9LMNPQRSTUV]{2}[A-Z][0-9LMNPQRSTUV]{2}[A-Z][0-9LMNPQRSTUV]{3}[A-Z]$/.test(c)) return false;
  let sum = 0;
  for (let i = 0; i < 15; i++) {
    const ch = c[i]; const v = /\d/.test(ch) ? +ch : ch.charCodeAt(0) - 65;
    sum += i % 2 === 0 ? CF_DISPARI[v] : v;
  }
  return String.fromCharCode(65 + (sum % 26)) === c[15];
}
export function ibanValido(s) {
  const c = String(s).replace(/[\s-]/g, '').toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(c)) return false;
  if (c.startsWith('IT') && c.length !== 27) return false;
  const r = c.slice(4) + c.slice(0, 4);
  let mod = 0;
  for (const ch of r) { const v = /\d/.test(ch) ? ch : String(ch.charCodeAt(0) - 55); for (const d of v) mod = (mod * 10 + +d) % 97; }
  return mod === 1;
}

/** Importo in formato italiano o internazionale → numero (o null). */
export function importo(s) {
  let t = String(s).replace(/[€\s]|EUR/gi, '');
  if (/,\d{1,2}$/.test(t)) t = t.replace(/\./g, '').replace(',', '.');
  else if (/\.\d{1,2}$/.test(t) && (t.match(/\./g) || []).length === 1) t = t.replace(/,/g, '');
  else t = t.replace(/[.,]/g, '');
  const v = Number(t);
  return Number.isFinite(v) ? v : null;
}

const uniq = (arr, key = (x) => x.valore) => { const s = new Set(); return arr.filter((x) => { const k = key(x); if (s.has(k)) return false; s.add(k); return true; }); };
const ctx = (t, i, len) => t.slice(Math.max(0, i - 45), Math.min(t.length, i + len + 45)).replace(/\s+/g, ' ').trim();

/**
 * Estrae i dati chiave. opts: { oggi: Date, durataDurc }
 * → { cig, cup, piva, cf, iban, importi, date, scadenze, totale, durc: { è, scadenza, scaduto, giorniResidui, calcolata } }
 */
export function estraiDati(testo, { oggi = new Date(), durataDurc = DURATA_DURC_GIORNI } = {}) {
  const t = String(testo || '').replace(/[ \t]+/g, ' ').slice(0, 400000);
  const out = { cig: [], cup: [], piva: [], cf: [], iban: [], importi: [], scadenze: [], date: [], totale: null, durc: null };
  let m;
  // CIG: 10 caratteri (CIG ordinario numerico+esadecimale, smart CIG che inizia con Z/X/Y…), cercato vicino all'etichetta
  for (const re = /\bC\.?\s?I\.?\s?G\.?\s*(?:n\.?|:|=)?\s*([0-9A-Z]{10})\b/gi; (m = re.exec(t));) if (/\d/.test(m[1])) out.cig.push({ valore: m[1].toUpperCase(), contesto: ctx(t, m.index, m[0].length) });
  // CUP: 15 caratteri: lettera, 2 cifre (anno), lettera, poi 11 alfanumerici
  for (const re = /\b([A-Z]\d{2}[A-Z][0-9A-Z]{11})\b/g; (m = re.exec(t));) out.cup.push({ valore: m[1], contesto: ctx(t, m.index, 15) });
  for (const re = /\bC\.?\s?U\.?\s?P\.?\s*(?:n\.?|:|=)?\s*([0-9A-Z]{15})\b/gi; (m = re.exec(t));) out.cup.push({ valore: m[1].toUpperCase(), contesto: ctx(t, m.index, m[0].length) });
  for (const re = /(?<![\d])(?:IT\s?)?(\d{11})(?!\d)/g; (m = re.exec(t));) if (partitaIvaValida(m[1])) out.piva.push({ valore: m[1], contesto: ctx(t, m.index, m[0].length) });
  for (const re = /\b([A-Z]{6}[0-9LMNPQRSTUV]{2}[A-Z][0-9LMNPQRSTUV]{2}[A-Z][0-9LMNPQRSTUV]{3}[A-Z])\b/gi; (m = re.exec(t));) if (codiceFiscaleValido(m[1])) out.cf.push({ valore: m[1].toUpperCase(), contesto: ctx(t, m.index, 16) });
  for (const re = /\b([A-Z]{2}\d{2}(?:\s?[A-Z0-9]{4}){2,7}(?:\s?[A-Z0-9]{1,4})?)\b/g; (m = re.exec(t));) { const v = m[1].replace(/\s/g, ''); if (ibanValido(v)) out.iban.push({ valore: v, contesto: ctx(t, m.index, m[0].length) }); }
  // importi: con € o EUR vicino
  for (const re = /(?:€|EUR|euro)\s?(\d{1,3}(?:[.\s]\d{3})*(?:,\d{2})|\d+(?:[.,]\d{2})?)|(\d{1,3}(?:[.\s]\d{3})*,\d{2}|\d+,\d{2})\s?(?:€|EUR|euro)\b/gi; (m = re.exec(t));) {
    const v = importo(m[1] || m[2]); if (v == null || v <= 0) continue;
    const before = t.slice(Math.max(0, m.index - 40), m.index).toLowerCase();
    out.importi.push({ valore: v, testo: (m[1] || m[2]).trim(), etichetta: /totale|importo complessivo|da pagare|netto a pagare/.test(before) ? 'Totale' : /imponibile/.test(before) ? 'Imponibile' : /iva/.test(before) ? 'IVA' : '', contesto: ctx(t, m.index, m[0].length) });
  }
  const tot = out.importi.filter((x) => x.etichetta === 'Totale');
  out.totale = tot.length ? tot[tot.length - 1].valore : null;
  out.date = uniq(trovaDate(t).map((d) => ({ valore: d.iso, contesto: ctx(t, d.index, 10) })));
  for (const re = /(scadenza(?: validit[aà]| pagamento)?|valid[oa] fino al|entro il|da pagare entro|termine)\s*:?\s*(?:il\s*)?(\d{1,2}[/.\-]\d{1,2}[/.\-]\d{2,4})/gi; (m = re.exec(t));) {
    const d = trovaDate(m[2])[0]; if (d) out.scadenze.push({ valore: d.iso, etichetta: m[1].replace(/\s+/g, ' ').toLowerCase(), contesto: ctx(t, m.index, m[0].length) });
  }
  for (const k of ['cig', 'cup', 'piva', 'cf', 'iban', 'scadenze']) out[k] = uniq(out[k]);
  // il CUP generico può catturare un CF o un IBAN: togli quelli
  out.cup = out.cup.filter((x) => !out.cf.some((c) => c.valore.includes(x.valore)) && !out.iban.some((i) => i.valore.includes(x.valore)));
  // DURC
  if (/\bdurc\b|documento unico di regolarit[aà] contributiva/i.test(t)) {
    let scadenza = null; let calcolata = false;
    const s = t.match(/scadenza(?: (?:della )?validit[aà])?\s*:?\s*(\d{1,2}[/.\-]\d{1,2}[/.\-]\d{2,4})/i);
    if (s) scadenza = trovaDate(s[1])[0]?.iso || null;
    if (!scadenza) {
      const r = t.match(/data (?:della )?richiesta\s*:?\s*(\d{1,2}[/.\-]\d{1,2}[/.\-]\d{2,4})/i);
      const d = r && trovaDate(r[1])[0]?.iso;
      if (d) { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + durataDurc); scadenza = x.toISOString().slice(0, 10); calcolata = true; }
    }
    const regolare = /\bRISULTA REGOLARE\b|risulta regolare/i.test(t) ? true : /\bNON RISULTA REGOLARE\b|non regolare/i.test(t) ? false : null;
    const oggiIso = new Date(Date.UTC(oggi.getFullYear(), oggi.getMonth(), oggi.getDate())).toISOString().slice(0, 10);
    const giorni = scadenza ? Math.round((Date.parse(scadenza) - Date.parse(oggiIso)) / 86400000) : null;
    out.durc = { scadenza, calcolata, scaduto: giorni != null ? giorni < 0 : null, giorniResidui: giorni, regolare };
  }
  return out;
}

/** Testo semplice da copiare negli appunti. */
export function riepilogoTesto(d) {
  const r = [];
  const add = (k, arr, f = (x) => x.valore) => { if (arr.length) r.push(`${k}: ${arr.map(f).join(', ')}`); };
  add('CIG', d.cig); add('CUP', d.cup); add('P.IVA', d.piva); add('Codice fiscale', d.cf); add('IBAN', d.iban);
  if (d.totale != null) r.push(`Totale: ${d.totale.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: 'always' })} €`);
  add('Scadenze', d.scadenze, (x) => `${x.etichetta} ${x.valore.split('-').reverse().join('/')}`);
  if (d.durc?.scadenza) r.push(`DURC: scadenza ${d.durc.scadenza.split('-').reverse().join('/')}${d.durc.scaduto ? ' (SCADUTO)' : ''}`);
  return r.join('\n');
}
