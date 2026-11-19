// Assistente IA, logica pura: passaggi del testo, ricerca per parole (BM25), fusione dei risultati,
// scelta tra documento intero e passaggi (RAG), prompt e lettura della risposta.
// Valori tarati nello studio di fattibilità (docs/IA-FATTIBILITA.md, ramo claude/ia-fattibilita).

/** Sotto questa stima di token il documento si manda intero; oltre, solo i passaggi pertinenti. */
export const MAX_TOKEN_INTERO = 8000;
/** Passaggi mandati al modello in modalità RAG. */
export const PASSAGGI_RAG = 5;
/** Caratteri per token in italiano (stima prudente per Gemma e Qwen: 3,6–4,3). */
const CAR_PER_TOKEN = 3.5;

export const stimaToken = (testo) => Math.ceil(String(testo || '').length / CAR_PER_TOKEN);

const spazi = (s) => String(s || '').replace(/\s+/g, ' ').trim();

/**
 * Divide le pagine in passaggi di circa `lung` caratteri (con sovrapposizione), ognuno con la sua pagina.
 * pagine: [{ n, testo }] (n 1-based) → [{ pagina, testo, i }]
 */
export function passaggi(pagine, { lung = 600, sovrapp = 100 } = {}) {
  const out = [];
  for (const p of pagine || []) {
    const t = spazi(p.testo);
    if (!t) continue;
    let i = 0;
    while (i < t.length) {
      let fine = Math.min(t.length, i + lung);
      if (fine < t.length) {
        const sp = t.lastIndexOf(' ', fine);
        if (sp > i + lung - 80) fine = sp;
      }
      out.push({ pagina: p.n, testo: t.slice(i, fine).trim(), i: out.length });
      if (fine >= t.length) break;
      i = Math.max(fine - sovrapp, i + 1);
      // il passaggio successivo parte da inizio parola
      if (t[i - 1] !== ' ') { const sp = t.indexOf(' ', i); i = sp < 0 || sp >= fine ? fine : sp + 1; }
      while (t[i] === ' ') i++;
    }
  }
  return out;
}

/** Pagine da un testo con le pagine separate da \f (come nell'indice dell'archivio). */
export function pagineDaTesto(testo) {
  return String(testo || '').split('\f').map((t, i) => ({ n: i + 1, testo: t }));
}

const PAROLE_VUOTE = new Set('il lo la i gli le un una uno di da in con su per tra fra a e o ed che chi non del della dello dei degli delle al alla allo ai agli alle dal dalla dai dagli dalle nel nella nello nei negli nelle sul sulla sui sugli sulle è sono come quale quali quanto quanti quando dove cosa qual'.split(' '));

/** Parole per la ricerca: minuscole, senza accenti, almeno 2 caratteri, senza parole vuote. */
export function parole(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .split(/[^a-z0-9]+/).filter((w) => w.length >= 2 && !PAROLE_VUOTE.has(w));
}

/** Punteggi BM25 della domanda per ogni passaggio. */
export function bm25(pz, domanda, { k1 = 1.5, b = 0.75 } = {}) {
  const docs = pz.map((p) => parole(p.testo));
  const N = docs.length || 1;
  const media = docs.reduce((s, d) => s + d.length, 0) / N || 1;
  const df = new Map();
  for (const d of docs) for (const w of new Set(d)) df.set(w, (df.get(w) || 0) + 1);
  const q = [...new Set(parole(domanda))];
  return docs.map((d) => {
    const tf = new Map();
    for (const w of d) tf.set(w, (tf.get(w) || 0) + 1);
    let s = 0;
    for (const w of q) {
      const f = tf.get(w);
      if (!f) continue;
      const idf = Math.log(1 + (N - df.get(w) + 0.5) / (df.get(w) + 0.5));
      s += idf * (f * (k1 + 1)) / (f + k1 * (1 - b + (b * d.length) / media));
    }
    return s;
  });
}

/** Ordine (indici) dal punteggio più alto. Con soloPositivi gli elementi a 0 restano fuori (BM25 senza parole in comune). */
export const ordina = (punteggi, { soloPositivi = false } = {}) => punteggi.map((s, i) => [s, i]).filter((x) => !soloPositivi || x[0] > 0)
  .sort((a, b) => b[0] - a[0] || a[1] - b[1]).map((x) => x[1]);

/** Fusione dei ranghi (Reciprocal Rank Fusion) di più ordinamenti: → indici in ordine. */
export function fondi(ordinamenti, k = 60) {
  const s = new Map();
  for (const ord of ordinamenti) ord.forEach((idx, r) => s.set(idx, (s.get(idx) || 0) + 1 / (k + r + 1)));
  return [...s.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]).map((x) => x[0]);
}

/** Similarità del coseno tra un vettore e ogni riga (vettori normalizzati o no). */
export function coseni(vettori, q) {
  const nq = Math.hypot(...q) || 1;
  return vettori.map((v) => {
    let d = 0; let n = 0;
    for (let i = 0; i < v.length; i++) { d += v[i] * q[i]; n += v[i] * v[i]; }
    return d / ((Math.sqrt(n) || 1) * nq);
  });
}

/** Contiene codici o numeri (CIG, CUP, protocollo, importi)? Allora la ricerca per parole pesa di più. */
export const haCodici = (q) => /\b[A-Z0-9]{8,}\b/i.test(q) && /\d/.test(q) || /\d{3,}/.test(q);

/**
 * Sceglie il contesto da mandare al modello.
 * pagine: [{n, testo}]; opz.vettori/vettoreDomanda per la parte "per significato" (facoltativi).
 * → { modo: 'intero'|'passaggi', testo, pagine: [n...] }
 */
export function scegliContesto(pagine, domanda, { vettori = null, vettoreDomanda = null, pz = null, max = MAX_TOKEN_INTERO, k = PASSAGGI_RAG } = {}) {
  const intero = testoConPagine(pagine);
  if (stimaToken(intero) <= max) return { modo: 'intero', testo: intero, pagine: (pagine || []).filter((p) => spazi(p.testo)).map((p) => p.n) };
  const ps = pz || passaggi(pagine);
  const ord = [ordina(bm25(ps, domanda), { soloPositivi: true })];
  if (vettori && vettoreDomanda && vettori.length === ps.length) ord.push(ordina(coseni(vettori, vettoreDomanda)));
  if (!ord.some((o) => o.length)) ord.push(ps.map((_, i) => i)); // nessun indizio: l'inizio del documento
  const scelti = fondi(ord).slice(0, k).map((i) => ps[i]).sort((a, b) => a.pagina - b.pagina || a.i - b.i);
  return { modo: 'passaggi', testo: scelti.map((p) => `=== Pagina ${p.pagina} ===\n${p.testo}`).join('\n\n'), pagine: [...new Set(scelti.map((p) => p.pagina))] };
}

export function testoConPagine(pagine) {
  return (pagine || []).filter((p) => spazi(p.testo)).map((p) => `=== Pagina ${p.n} ===\n${String(p.testo).trim()}`).join('\n\n');
}

export const SISTEMA = 'Sei l\'assistente di un ufficio pubblico italiano. Lavori solo sul documento fornito: '
  + 'non aggiungere informazioni che non ci sono. Rispondi in italiano corretto.';

export const SCHEMA_RISPOSTA = {
  type: 'object',
  properties: { risposta: { type: 'string' }, pagina: { type: ['integer', 'null'] } },
  required: ['risposta', 'pagina'],
};

/** Messaggi per la domanda (il documento viene prima: così resta nella cache tra una domanda e l'altra). */
export function messaggiDomanda(contesto, domanda) {
  const compito = `Domanda: ${String(domanda).trim()}\nRispondi in modo breve usando solo il documento, e indica il numero della pagina `
    + '(il numero dopo \'=== Pagina\') in cui si trova la risposta. Se la risposta non c\'è, scrivi "non presente" e pagina null. '
    + 'Rispondi SOLO con un oggetto JSON {"risposta": ..., "pagina": ...}.';
  return [{ role: 'system', content: SISTEMA }, { role: 'user', content: `DOCUMENTO:\n${contesto}\n\n---\n${compito}` }];
}

const NON_PRESENTE = /^(non presente|non (è )?(indicat|specificat|riportat|present)\w*|nessuna informazione|n\.?d\.?)\b/i;

/**
 * Legge la risposta del modello. → { trovata, risposta, pagina, paginaVerificata }
 * paginaVerificata: la pagina citata esiste ed è tra quelle mandate al modello.
 */
export function leggiRisposta(testo, { pagineValide = [] } = {}) {
  let j = null;
  const s = String(testo || '');
  try { const a = s.indexOf('{'); const b = s.lastIndexOf('}'); if (a >= 0 && b > a) j = JSON.parse(s.slice(a, b + 1)); } catch { j = null; }
  const risposta = spazi(j ? j.risposta : s);
  const n = j && Number.isInteger(j.pagina) ? j.pagina : (j && /^\d+$/.test(String(j.pagina ?? '')) ? Number(j.pagina) : null);
  const trovata = !!risposta && !NON_PRESENTE.test(risposta);
  return { trovata, risposta: trovata ? risposta : '', pagina: trovata ? n : null, paginaVerificata: trovata && n != null && pagineValide.includes(n) };
}

/** Frase da cercare nella pagina citata per evidenziarla: la parte più "rara" della risposta (numeri, nomi). */
export function daEvidenziare(risposta, testoPagina) {
  const t = spazi(testoPagina).toLowerCase();
  const r = spazi(risposta);
  if (!r || !t) return '';
  if (t.includes(r.toLowerCase())) return r;
  const pezzi = r.split(/[;:()«»"]|,\s+|\s+-\s+|\s+e\s+/).map(spazi).filter((x) => x.length >= 3).sort((a, b) => b.length - a.length);
  for (const p of pezzi) if (t.includes(p.toLowerCase())) return p;
  const num = r.match(/\d[\d.,/]*\d|\d/g) || [];
  for (const x of num.sort((a, b) => b.length - a.length)) if (x.length >= 3 && t.includes(x.toLowerCase())) return x;
  return '';
}
