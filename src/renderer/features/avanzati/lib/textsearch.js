// Ricerca testuale con contesto, indipendente da maiuscole e accenti. Logica pura.

/** Testo di una pagina dagli elementi di pdf.js getTextContent(). */
export function pageText(items) {
  let s = ''; let prev = null;
  for (const it of items) {
    if (typeof it.str !== 'string') continue;
    // niente spazio tra pezzi della stessa parola (molti PDF spezzano le parole in più elementi)
    if (prev && !prev.hasEOL && prev.str && !/\s$/.test(prev.str) && it.str && !/^\s/.test(it.str)) {
      const t0 = prev.transform; const t1 = it.transform;
      const attaccati = Array.isArray(t0) && Array.isArray(t1) && Math.abs(t1[5] - t0[5]) < 1 && Math.abs(t1[4] - (t0[4] + (prev.width || 0))) < Math.max(0.6, 0.12 * Math.abs(t0[3] || 10));
      if (!attaccati) s += ' ';
    }
    s += it.str;
    if (it.hasEOL) s += '\n';
    prev = it;
  }
  return s.replace(/[ \t]+/g, ' ');
}

/** Normalizza (minuscole, senza accenti) e restituisce la mappa indice normalizzato → indice originale. */
export function normalize(s, caseSensitive = false) {
  let out = ''; const map = [];
  for (let i = 0; i < s.length; i++) {
    let c = s[i];
    const code = c.charCodeAt(0);
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < s.length) { c = s.slice(i, i + 2); }
    let n = c.normalize('NFD').replace(/[̀-ͯ]/g, '');
    if (!caseSensitive) n = n.toLowerCase();
    if (/\s/.test(n)) n = ' ';
    for (let k = 0; k < n.length; k++) { out += n[k]; map.push(i); }
    if (c.length === 2) i++;
  }
  return { text: out, map };
}

/**
 * Trova le occorrenze di query nel testo. → [{ start, end, before, match, after }]
 * opts: { caseSensitive, wholeWord, context (caratteri), max }
 */
export function findMatches(text, query, { caseSensitive = false, wholeWord = false, context = 70, max = 50 } = {}) {
  const q = normalize(String(query).trim().replace(/\s+/g, ' '), caseSensitive).text;
  if (!q) return [];
  const { text: t, map } = normalize(text, caseSensitive);
  const out = [];
  let from = 0;
  const isWord = (ch) => !!ch && /[\p{L}\p{N}_]/u.test(ch);
  while (out.length < max) {
    const i = t.indexOf(q, from);
    if (i < 0) break;
    from = i + Math.max(1, q.length);
    if (wholeWord && (isWord(t[i - 1]) || isWord(t[i + q.length]))) continue;
    const start = map[i]; const end = map[i + q.length - 1] + 1;
    const a = Math.max(0, start - context); const b = Math.min(text.length, end + context);
    const clean = (x) => x.replace(/\s+/g, ' ');
    out.push({ start, end, before: (a > 0 ? '…' : '') + clean(text.slice(a, start)).trimStart(), match: clean(text.slice(start, end)), after: clean(text.slice(end, b)).trimEnd() + (b < text.length ? '…' : '') });
  }
  return out;
}
