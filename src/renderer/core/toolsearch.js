// Classifica della ricerca in «Tutti gli strumenti» (logica pura, testata in Node).
// Ordine: nome uguale o che inizia con la ricerca > parola intera nel nome > nome che la contiene >
// nome Acrobat > parole chiave > descrizione. Con più parole servono tutte (in un campo qualunque).

export const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
const words = (s) => norm(s).split(/[^a-z0-9]+/).filter(Boolean);

/** Stessa radice (comprimere ~ comprimi, togliere ~ togli): prefisso comune lungo almeno len−3 (min 4). */
function sameStem(a, b) {
  if (a === b) return true;
  let k = 0; while (k < a.length && k < b.length && a[k] === b[k]) k++;
  return k >= Math.max(4, Math.max(a.length, b.length) - 3);
}

/** Punteggio di una frase (o parola) in un singolo strumento; 0 = nessuna corrispondenza. */
function phraseScore(t, q) {
  const name = norm(t.name), acro = norm(t.acrobatName), kw = norm(t.keywords), desc = norm(t.description);
  const qw = words(q);
  const hasWords = (field) => { const fw = words(field); let i = 0; return qw.length > 0 && fw.some((_, k) => qw.every((w, j) => fw[k + j] === w)) && ++i; };
  if (name === q) return 1000;
  if (name.startsWith(q)) return 900;
  if (hasWords(t.name)) return 800;
  if (name.includes(q)) return 700;
  if (acro === q || acro.startsWith(q)) return 600;
  if (hasWords(t.acrobatName) || acro.includes(q)) return 550;
  if (hasWords(t.keywords)) return 400;
  if (kw.includes(q)) return 350;
  if (hasWords(t.description)) return 200;
  if (desc.includes(q)) return 150;
  // ultima risorsa: parole con la stessa radice (verbi all'infinito, plurali)
  const stem = (field) => { const fw = words(field); return qw.length > 0 && qw.every((w) => fw.some((f) => sameStem(w, f))); };
  if (stem(t.name)) return 120;
  if (stem(t.acrobatName)) return 110;
  if (stem(t.keywords)) return 100;
  if (stem(t.description)) return 50;
  return 0;
}

/** Punteggio complessivo (0 = escluso). */
export function scoreTool(t, query) {
  const q = norm(query);
  if (!q) return 1;
  const whole = phraseScore(t, q);
  if (whole) return whole + 50; // la frase intera vale più delle singole parole
  const ws = q.split(' ');
  if (ws.length < 2) return 0;
  let min = Infinity;
  for (const w of ws) { const s = phraseScore(t, w); if (!s) return 0; min = Math.min(min, s); }
  return min;
}

/** Strumenti in ordine di classifica (esclusi quelli nascosti o senza corrispondenza). */
export function rankTools(tools, query) {
  return tools
    .filter((t) => !t.hidden)
    .map((t, i) => ({ t, s: scoreTool(t, query), i }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || norm(a.t.name).length - norm(b.t.name).length || a.i - b.i)
    .map((x) => x.t);
}
