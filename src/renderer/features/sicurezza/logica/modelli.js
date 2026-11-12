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

const MESI = 'gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre';
const DATA = `(?:\\d{1,2}[/.-]\\d{1,2}[/.-](?:\\d{4}|\\d{2})|\\d{1,2}\\s+(?:${MESI})\\s+\\d{4})`;
const TOPONIMI = 'via|viale|v\\.le|piazza|p\\.zza|p\\.za|piazzale|p\\.le|corso|c\\.so|largo|vicolo|vico|strada|località|loc\\.|contrada|c\\.da|borgo|lungarno|lungomare|lungotevere|calle|frazione|fraz\\.';
// CAP italiano (00010–98168) seguito dal comune con l'iniziale maiuscola ed eventuale sigla della provincia
const CAP_COMUNE = `\\d{5}\\s+[A-ZÀ-Ü][\\p{L}'’-]*(?:\\s+(?:di|del|della|in|sul|sulla|[A-ZÀ-Ü][\\p{L}'’-]*)){0,3}?(?:\\s*\\([A-Z]{2}\\))?(?![\\p{L}])`;
export function capValido(s) { const n = Number(String(s).slice(0, 5)); return n >= 10 && n <= 98168; }

/**
 * Numero di telefono plausibile, che NON sia un altro dato: una partita IVA valida (11 cifre), un numero
 * preceduto da «P.IVA», «Partita IVA», «C.F.», «codice fiscale», una data, un importo.
 */
export function telefonoValido(s, { before = '' } = {}) {
  const raw = String(s);
  if (/^\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}$/.test(raw.trim())) return false; // data
  const intl = /^(?:\+|00)39/.test(raw.trim());
  const d = raw.replace(/\D/g, '').replace(/^(00)?39(?=\d{9,})/, '');
  if (d.length < 8 || d.length > 11) return false;
  if (!intl && d.length === 11 && partitaIvaValida(d)) return false;
  if (/(?:p\.?\s*i\.?\s*v\.?\s*a\.?|partita\s+iva|c\.?\s*f\.?|cod(?:ice|\.)?\s*fisc(?:ale|\.)?|iban|cig|cup|prot(?:ocollo|\.)?\s*(?:n\.?|nr\.?)?|n\.\s*fattura|fattura\s*n\.?)[\s:.°n]*$/i.test(before)) return false;
  return true;
}

export const MODELLI = [
  { id: 'cf', label: 'Codice fiscale', esempio: 'RSSMRA85T10A562S', re: /\b[A-Za-z]{6}\s?[0-9LMNPQRSTUVlmnpqrstuv]{2}[A-Za-z][0-9LMNPQRSTUVlmnpqrstuv]{2}\s?[A-Za-z][0-9LMNPQRSTUVlmnpqrstuv]{3}[A-Za-z]\b/g, check: codiceFiscaleValido },
  { id: 'iban', label: 'IBAN', esempio: 'IT60 X054 2811 1010 0000 0123 456', re: /\b[A-Z]{2}\d{2}(?:[ -]?[A-Z0-9]{4}){2,7}(?:[ -]?[A-Z0-9]{1,4})?\b/g, check: ibanValido },
  { id: 'piva', label: 'Partita IVA', esempio: '12345678903', re: /\b(?:IT\s?)?\d{11}\b/g, check: (s) => partitaIvaValida(s.replace(/^IT\s?/i, '')) },
  { id: 'email', label: 'Indirizzo email', esempio: 'nome@esempio.it', re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g },
  { id: 'tel', label: 'Numero di telefono', esempio: '+39 333 123 4567', re: /(?<![\w+])(?:(?:\+|00)39[\s.-]?)?(?:3\d{2}|0\d{1,3})[\s./-]?\d{2,4}[\s.-]?\d{2,4}(?:[\s.-]?\d{1,4})?(?!\w)/g, check: telefonoValido },
  { id: 'targa', label: 'Targa', esempio: 'AB 123 CD', re: /\b[A-HJ-NPR-TV-Z]{2}\s?\d{3}\s?[A-HJ-NPR-TV-Z]{2}\b/g },
  { id: 'date', label: 'Date', esempio: '10/12/1985', re: /\b(?:\d{1,2}[/.-]\d{1,2}[/.-](?:\d{4}|\d{2})|\d{4}-\d{2}-\d{2}|\d{1,2}\s+(?:gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre)\s+\d{4})\b/gi },
  { id: 'nascita', label: 'Luogo e data di nascita', esempio: 'nato a Pisa il 10/12/1985', res: [
    // «nato/a a Pisa (PI) il 10/12/1985»: si oscurano luogo e data, non «nato a»
    new RegExp(`(?<=\\bnat[oa]\\s+a\\s+)[A-ZÀ-Ü][\\p{L}'’.-]*(?:\\s+[\\p{L}'’.-]+){0,4}?(?:\\s*\\([A-Z]{2}\\))?,?\\s+(?:il\\s+)?${DATA}`, 'giu'),
    new RegExp(`(?<=\\bnat[oa]\\s+(?:il\\s+)?)${DATA}`, 'giu'),
    new RegExp(`(?<=\\bdata\\s+di\\s+nascita\\s*[:.]?\\s*)${DATA}`, 'giu'),
    new RegExp(`(?<=\\bluogo\\s+di\\s+nascita\\s*[:.]?\\s*)[A-ZÀ-Ü][\\p{L}'’.-]*(?:\\s+[A-ZÀ-Ü][\\p{L}'’.-]*){0,3}(?:\\s*\\([A-Z]{2}\\))?`, 'gu'),
  ] },
  { id: 'indirizzo', label: 'Indirizzo (via e numero, CAP e comune)', esempio: 'Via Verdi 3, 56124 Pisa', res: [
    new RegExp(`\\b(?:${TOPONIMI})\\s+(?:[\\p{L}'’.]+\\s+){0,5}?[\\p{L}'’.]+,?\\s*(?:n\\.?\\s*|nr\\.?\\s*|civ(?:ico)?\\.?\\s*)?\\d{1,4}(?:\\s?\\/?\\s?[A-Za-z](?![\\p{L}]))?(?:\\s*[,–-]?\\s*${CAP_COMUNE})?`, 'giu'),
    new RegExp(`(?<=(?:^|[,;\\n–-])\\s*)${CAP_COMUNE}`, 'gu'),
    new RegExp(`(?<![\\d\\p{L}])\\d{5}\\s+[A-ZÀ-Ü][\\p{L}'’-]*(?:\\s+[A-ZÀ-Ü][\\p{L}'’-]*){0,3}\\s*\\([A-Z]{2}\\)`, 'gu'),
  ], check: (s) => !/^\d{5}\s/.test(s) || capValido(s) },
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
  for (const id of models) {
    const m = MODELLI.find((x) => x.id === id);
    if (!m) continue;
    for (const re of m.res || [m.re]) out.push({ ...m, re: new RegExp(re.source, re.flags) });
  }
  return out;
}

/** Trova le occorrenze in un testo. → [{ start, end, text, matcher }] (non sovrapposte, ordinate). */
// Modelli «numerici» che possono catturare per sbaglio pezzi di altri dati: un telefono dentro un IBAN,
// una P.IVA o una data non è un telefono. Si scartano anche se il modello dell'altro dato non è spuntato.
const GUARDATI = new Set(['tel', 'carta']);
const GUARDIE = ['iban', 'piva', 'cf', 'date', 'carta'];
function spansDi(text, exceptId) {
  const spans = [];
  for (const id of GUARDIE) {
    if (id === exceptId) continue;
    const m = MODELLI.find((x) => x.id === id);
    const re = new RegExp(m.re.source, m.re.flags);
    let r;
    while ((r = re.exec(text))) {
      if (!r[0].length) { re.lastIndex++; continue; }
      if (m.check && !m.check(r[0], { before: text.slice(Math.max(0, r.index - 40), r.index) })) continue;
      spans.push([r.index, r.index + r[0].length]);
    }
  }
  return spans;
}

export function findMatches(text, matchers, { limit = 50000 } = {}) {
  const hits = [];
  const guardie = new Map();
  for (const m of matchers) {
    m.re.lastIndex = 0;
    let r;
    while ((r = m.re.exec(text)) && hits.length < limit) {
      if (r[0].length === 0) { m.re.lastIndex++; continue; }
      if (m.check && !m.check(r[0], { before: text.slice(Math.max(0, r.index - 40), r.index) })) continue;
      if (GUARDATI.has(m.id)) {
        if (!guardie.has(m.id)) guardie.set(m.id, spansDi(text, m.id));
        const a = r.index; const b = r.index + r[0].length;
        if (guardie.get(m.id).some(([x, y]) => a < y && x < b)) continue;
      }
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
