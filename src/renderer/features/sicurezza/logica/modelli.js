// Modelli predefiniti per «Cerca e oscura»: espressioni regolari + verifiche (somme di controllo)
// per ridurre i falsi positivi. Logica pura, senza DOM.

const CF_ODD = { 0: 1, 1: 0, 2: 5, 3: 7, 4: 9, 5: 13, 6: 15, 7: 17, 8: 19, 9: 21, A: 1, B: 0, C: 5, D: 7, E: 9, F: 13, G: 15, H: 17, I: 19, J: 21, K: 2, L: 4, M: 18, N: 20, O: 11, P: 3, Q: 6, R: 8, S: 12, T: 14, U: 16, V: 10, W: 22, X: 25, Y: 24, Z: 23 };

/** Codice fiscale italiano: verifica il carattere di controllo (anche con omocodie). */
export function codiceFiscaleValido(s) {
  const cf = String(s).toUpperCase().replace(/\s+/g, '');
  if (!/^[A-Z]{6}[0-9LMNPQRSTUV]{2}[A-Z][0-9LMNPQRSTUV]{2}[A-Z][0-9LMNPQRSTUV]{3}[A-Z]$/.test(cf)) return false;
  let sum = 0;
  for (let i = 0; i < 15; i++) {
    const c = cf[i];
    if (i % 2 === 0) sum += CF_ODD[c];
    else sum += /[0-9]/.test(c) ? Number(c) : c.charCodeAt(0) - 65;
  }
  return String.fromCharCode(65 + (sum % 26)) === cf[15];
}

/** IBAN: controllo mod 97 (ISO 13616). */
export function ibanValido(s) {
  const iban = String(s).toUpperCase().replace(/[\s-]+/g, '');
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(iban)) return false;
  if (iban.startsWith('IT') && iban.length !== 27) return false;
  const r = iban.slice(4) + iban.slice(0, 4);
  let rem = 0;
  for (const ch of r) {
    const v = /[A-Z]/.test(ch) ? String(ch.charCodeAt(0) - 55) : ch;
    for (const d of v) rem = (rem * 10 + Number(d)) % 97;
  }
  return rem === 1;
}

/** Partita IVA italiana (11 cifre, algoritmo di Luhn modificato). */
export function partitaIvaValida(s) {
  const p = String(s).replace(/\D/g, '');
  if (p.length !== 11 || /^0+$/.test(p)) return false;
  let sum = 0;
  for (let i = 0; i < 10; i++) {
    let d = Number(p[i]);
    if (i % 2 === 1) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
  }
  return (10 - (sum % 10)) % 10 === Number(p[10]);
}

/** Numero di carta: algoritmo di Luhn, 13–19 cifre. */
export function luhnValido(s) {
  const n = String(s).replace(/\D/g, '');
  if (n.length < 13 || n.length > 19) return false;
  let sum = 0; let dbl = false;
  for (let i = n.length - 1; i >= 0; i--) {
    let d = Number(n[i]);
    if (dbl) { d *= 2; if (d > 9) d -= 9; }
    sum += d; dbl = !dbl;
  }
  return sum % 10 === 0;
}

export const MODELLI = [
  { id: 'cf', label: 'Codice fiscale', esempio: 'RSSMRA85T10A562S', re: /\b[A-Za-z]{6}\s?[0-9LMNPQRSTUVlmnpqrstuv]{2}[A-Za-z][0-9LMNPQRSTUVlmnpqrstuv]{2}\s?[A-Za-z][0-9LMNPQRSTUVlmnpqrstuv]{3}[A-Za-z]\b/g, check: codiceFiscaleValido },
  { id: 'iban', label: 'IBAN', esempio: 'IT60 X054 2811 1010 0000 0123 456', re: /\b[A-Z]{2}\d{2}(?:[ -]?[A-Z0-9]{4}){2,7}(?:[ -]?[A-Z0-9]{1,4})?\b/g, check: ibanValido },
  { id: 'piva', label: 'Partita IVA', esempio: '12345678903', re: /\b(?:IT\s?)?\d{11}\b/g, check: (s) => partitaIvaValida(s.replace(/^IT\s?/i, '')) },
  { id: 'email', label: 'Indirizzo email', esempio: 'nome@esempio.it', re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g },
  { id: 'tel', label: 'Numero di telefono', esempio: '+39 333 123 4567', re: /(?<![\w+])(?:(?:\+|00)39[\s.-]?)?(?:3\d{2}|0\d{1,3})[\s./-]?\d{2,4}[\s.-]?\d{2,4}(?:[\s.-]?\d{1,4})?(?!\w)/g, check: (s) => { const d = s.replace(/\D/g, '').replace(/^(00)?39(?=\d{9,})/, ''); return d.length >= 8 && d.length <= 11; } },
  { id: 'targa', label: 'Targa', esempio: 'AB 123 CD', re: /\b[A-HJ-NPR-TV-Z]{2}\s?\d{3}\s?[A-HJ-NPR-TV-Z]{2}\b/g },
  { id: 'date', label: 'Date', esempio: '10/12/1985', re: /\b(?:\d{1,2}[/.-]\d{1,2}[/.-](?:\d{4}|\d{2})|\d{4}-\d{2}-\d{2}|\d{1,2}\s+(?:gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre)\s+\d{4})\b/gi },
  { id: 'carta', label: 'Numero di carta di pagamento', esempio: '4111 1111 1111 1111', re: /\b(?:\d[ -]?){12,18}\d\b/g, check: luhnValido },
];

/** Escape per usare un testo letterale dentro una RegExp. */
export function escapeRegExp(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

/**
 * Costruisce i cercatori.
 * opts: { terms: string[], regex: string, caseSensitive, wholeWord, models: string[] (id) }
 * → [{ id, label, re, check? }]. Lancia un errore leggibile se l'espressione regolare non è valida.
 */
export function buildMatchers({ terms = [], regex = '', caseSensitive = false, wholeWord = false, models = [] } = {}) {
  const out = [];
  const flags = 'g' + (caseSensitive ? '' : 'i') + 'u';
  for (const t of terms.map((x) => String(x).trim()).filter(Boolean)) {
    const body = escapeRegExp(t).replace(/\s+/g, '\\s+');
    out.push({ id: 'term', label: `«${t}»`, re: new RegExp(wholeWord ? `(?<![\\p{L}\\p{N}])${body}(?![\\p{L}\\p{N}])` : body, flags) });
  }
  if (regex && regex.trim()) {
    let re;
    try { re = new RegExp(regex.trim(), flags); }
    catch (e) { throw new Error(`L'espressione regolare non è valida: ${e.message}`); }
    if (re.test('')) throw new Error("L'espressione regolare trova anche il testo vuoto: rendila più precisa.");
    re.lastIndex = 0;
    out.push({ id: 'regex', label: 'Espressione regolare', re });
  }
  for (const id of models) { const m = MODELLI.find((x) => x.id === id); if (m) out.push({ ...m, re: new RegExp(m.re.source, m.re.flags) }); }
  return out;
}

/** Trova le occorrenze in un testo. → [{ start, end, text, matcher }] (non sovrapposte, ordinate). */
export function findMatches(text, matchers, { limit = 50000 } = {}) {
  const hits = [];
  for (const m of matchers) {
    m.re.lastIndex = 0;
    let r;
    while ((r = m.re.exec(text)) && hits.length < limit) {
      if (r[0].length === 0) { m.re.lastIndex++; continue; }
      if (m.check && !m.check(r[0])) continue;
      hits.push({ start: r.index, end: r.index + r[0].length, text: r[0], matcher: m.label });
    }
  }
  hits.sort((a, b) => a.start - b.start || b.end - a.end);
  const out = [];
  for (const h of hits) {
    const last = out[out.length - 1];
    if (last && h.start < last.end) { if (h.end > last.end) { last.end = h.end; last.text = text.slice(last.start, h.end); } continue; }
    out.push({ ...h });
  }
  return out;
}
