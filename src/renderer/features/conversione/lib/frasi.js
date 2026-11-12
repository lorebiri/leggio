// Divisione del testo in frasi (per la lettura ad alta voce) e statistiche di testo. Logica pura.

const ABBR = new Set(['art', 'artt', 'n', 'nn', 'pag', 'pagg', 'p', 'pp', 'ecc', 'etc', 'dott', 'dott.ssa', 'sig', 'sigg', 'sig.ra', 'prof', 'ing', 'avv', 'geom', 'rag', 'arch', 'on', 'egr', 'spett', 'gent', 'c.a', 'cfr', 'es', 'vol', 'cap', 'tab', 'fig', 'all', 'lett', 'co', 'comma', 'd.lgs', 'd.p.r', 'l', 'mr', 'mrs', 'dr', 'st', 'vs', 'e.g', 'i.e', 's.p.a', 's.r.l', 'spa', 'srl', 'tel', 'fax', 'cod', 'rif', 'prot', 'num', 'ca', 'gg', 'mod', 'ss', 'segg', 'sez', 'reg', 'n.ro']);

/**
 * Raggruppa parole (array di stringhe) in frasi. → [{ start, end, text }] con intervalli [start, end)
 * Una frase termina con . ! ? … (o ; :) se la parola seguente inizia con maiuscola/cifra/virgolette,
 * esclusi abbreviazioni comuni ("art.", "n.", "dott.") e numeri ("1.234").
 */
export function dividiFrasi(words, { maxParole = 60 } = {}) {
  const out = [];
  let start = 0;
  for (let i = 0; i < words.length; i++) {
    const w = String(words[i]);
    const next = words[i + 1];
    let fine = false;
    if (/[.!?…]["»”')\]]*$/.test(w)) {
      const base = w.replace(/["»”')\]]+$/, '').replace(/[.!?…]+$/, '').toLowerCase().replace(/^["«“(]+/, '').replace(/^.*['’]/, '');
      const abbr = /\.$/.test(w) && (ABBR.has(base) || /^[a-zà-ÿ]$/i.test(base) || /^(\d+\.)+\d*$/.test(w.replace(/\.$/, '') + '.'));
      if (next == null || (!abbr && /^["«“(]?[A-ZÀ-ÝÈÉ0-9]/.test(next)) || /[!?…]$/.test(w)) fine = true;
    } else if (/[;:]$/.test(w) && i - start >= 25) fine = true;
    if (i - start + 1 >= maxParole) fine = true; // frasi lunghissime (elenchi, tabelle): spezzate
    if (fine || next == null) {
      out.push({ start, end: i + 1, text: words.slice(start, i + 1).join(' ') });
      start = i + 1;
    }
  }
  return out;
}

/** Statistiche di un testo: parole, caratteri, frasi. */
export function statisticheTesto(text) {
  const t = String(text || '');
  const parole = t.match(/[\p{L}\p{N}][\p{L}\p{N}'’\-.,]*/gu) || [];
  return {
    parole: parole.length,
    caratteri: t.replace(/\n/g, '').length,
    caratteriSenzaSpazi: t.replace(/\s/g, '').length,
    frasi: dividiFrasi(t.split(/\s+/).filter(Boolean)).length,
  };
}

/** Minuti di lettura stimati (230 parole al minuto, arrotondati). */
export function minutiLettura(parole, wpm = 230) {
  return Math.max(parole ? 1 : 0, Math.round(parole / wpm));
}

/** Nome del formato della pagina (A4, A3, Lettera…) da larghezza e altezza in punti. */
export function formatoPagina(w, h) {
  const [a, b] = [Math.min(w, h), Math.max(w, h)];
  const F = [['A5', 420, 595], ['A4', 595, 842], ['A3', 842, 1191], ['A2', 1191, 1684], ['Lettera', 612, 792], ['Legale', 612, 1008], ['B5', 499, 709]];
  for (const [n, x, y] of F) if (Math.abs(a - x) < 6 && Math.abs(b - y) < 6) return n + (w > h ? ' orizzontale' : '');
  return `${Math.round(w / 72 * 25.4)} × ${Math.round(h / 72 * 25.4)} mm`;
}
