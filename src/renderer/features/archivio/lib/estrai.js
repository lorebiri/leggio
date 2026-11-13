// Riconoscimento del tipo di documento e dei dati chiave (fornitore, P.IVA/CF, numero, data,
// importo, CIG, CUP, scadenza) dal testo del documento o dalla fattura elettronica già letta.
// Logica pura: niente DOM, niente pdf.js. Usa l'analisi della «Rinomina dal contenuto» dell'area avanzati.
import { analizza, trovaDate } from '../../avanzati/lib/rinomina.js';
import { numeroIt } from './testo.js';

/** Versione delle regole di estrazione: se cambia, i documenti vengono riletti alla prossima scansione. */
export const VERSIONE_ESTRAZIONE = 7; // 7: verifica delle firme .p7m nell'indice

/**
 * Esito della verifica di una busta .p7m (risultato di openP7m con verify: true):
 * 'non-valida' se una firma non è integra (documento alterato o firma rovinata), 'valida' se tutte sono integre,
 * 'non-verificata' altrimenti (es. algoritmo non supportato, solo marca temporale).
 */
export function esitoFirmeP7m(result) {
  const tutte = [];
  const giro = (s) => { tutte.push(s); (s.counterSigners || []).forEach(giro); };
  for (const l of result?.levels || []) for (const s of l.signers || []) giro(s);
  if (!tutte.length) return 'non-verificata';
  if (tutte.some((s) => s.integrity === 'invalid')) return 'non-valida';
  if (tutte.every((s) => s.integrity === 'valid')) return 'valida';
  return 'non-verificata';
}

/**
 * Etichetta della firma per l'elenco: «Firmato digitalmente» SOLO se la firma è stata verificata integra.
 * → { testo, classe } | null
 */
export function etichettaFirma(r) {
  if (!r?.firme) return null;
  if (r.firmaEsito === 'non-valida') return { testo: 'Firma non valida', classe: 'err', titolo: 'La verifica della busta .p7m è fallita: il documento potrebbe essere stato modificato dopo la firma. Aprilo per i dettagli.' };
  if (r.firmaEsito === 'valida') return { testo: r.firme === 1 ? 'Firmato digitalmente' : `Firmato digitalmente (${r.firme} firme)`, classe: 'firma', titolo: 'Firma integra. La validità del certificato (revoca, certificatore) si controlla all\'apertura.' };
  return { testo: r.firme === 1 ? 'Contiene una firma (da verificare)' : `Contiene ${r.firme} firme (da verificare)`, classe: 'neutro', titolo: 'Firma nel PDF: Leggio la verifica quando apri il documento.' };
} // 4: segnatura di protocollo (Titulus) nel testo; 5: striscia-immagine

export const TIPI = [
  { id: 'fattura', label: 'Fattura' },
  { id: 'nota-credito', label: 'Nota di credito' },
  { id: 'durc', label: 'DURC' },
  { id: 'ordine', label: 'Ordine o determina' },
  { id: 'missione', label: 'Missione' },
  { id: 'contratto', label: 'Contratto' },
  { id: 'incarico', label: 'Incarico o assegno' },
  { id: 'tracciabilita', label: 'Tracciabilità (conto dedicato)' },
  { id: 'pec', label: 'PEC' },
  { id: 'p7m', label: 'File firmato (.p7m)' },
  { id: 'altro', label: 'Altro' },
];
export const TIPO_LABEL = Object.fromEntries(TIPI.map((t) => [t.id, t.label]));

// Codici dell'ente da non scambiare per quelli del fornitore (in fattura compaiono come committente).
// CNR: C.F. 80054330586, P.IVA 02118311006 (da verificare: modificabili nelle impostazioni).
export const CODICI_ENTE_PREDEFINITI = ['80054330586', '02118311006'];

// Riconoscimento dal testo: per ogni tipo, frasi forti (titolo del documento) cercate all'inizio.
const REGOLE = [
  { id: 'tracciabilita', re: /\b(dichiarazione|comunicazione)\b[^.]{0,120}\bconto (corrente )?dedicato\b|\bconto corrente dedicato\b[^.]{0,80}\b(l\.|legge) ?136\/2010/i, peso: 6 },
  { id: 'incarico', re: /\bconferimento (di |dell['’])?incarico\b|\bcontratto di (collaborazione|lavoro autonomo|ricerca)\b|\bassegno di ricerca\b|\bincarico (di collaborazione|post-?doc|di ricerca)\b|\bborsa di studio\b/i, peso: 5 },
  { id: 'durc', re: /\bdurc\b|documento unico di regolarit[aà] contributiva|regolarit[aà] contributiva/i, peso: 5 },
  { id: 'nota-credito', re: /\bnota di credito\b|\bnota credito\b/i, peso: 4 },
  { id: 'missione', re: /\b(ordine|incarico|autorizzazione|richiesta|rimborso)( spese)? (di |per |della )?missione\b|\bmissione n\.|\btrattamento di missione\b|\brimborso spese di viaggio\b|\btrasferta\b/i, peso: 4 },
  { id: 'fattura', re: /\bfattura( elettronica| accompagnatoria| differita| n\.?| numero| nr\.?)?\b/i, peso: 3 },
  { id: 'ordine', re: /\bdetermina(zione)?( a contrarre| dirigenziale| n\.?)?\b|\bdecreto a contrarre\b|\bbuono d['’]ordine\b|\bordine (di acquisto|di fornitura|n\.?|nr\.?|numero)|\blettera d['’]ordine\b|\bordinativo\b|\bdocumento di stipula\b|\btrattativa diretta\b|\bordine diretto (d['’]acquisto|di acquisto)\b|\brichiesta di offerta\b/i, peso: 3 },
  { id: 'contratto', re: /\bcontratto( di| per| n\.?)?\b|\bconvenzione\b|\baccordo quadro\b|\bscrittura privata\b/i, peso: 2 },
  { id: 'pec', re: /posta elettronica certificata|ricevuta di (accettazione|avvenuta consegna)|\bdaticert\b/i, peso: 2 },
];
const REGOLE_NOME = [
  ['durc', /durc/i], ['nota-credito', /nota.?(di.?)?credito|\bnc[_\- ]/i], ['missione', /mission|trasfert/i],
  ['fattura', /fattur|\bfatt[_\- .]|^IT\d{11}_[A-Za-z0-9]{1,5}\./i], ['ordine', /determin|ordin|\boda[_\- ]/i],
  ['contratto', /contratt|convenzion/i], ['pec', /\bpec\b|postacert|daticert/i],
];

/** Tipo di documento dal testo (e dal nome del file come ripiego). */
export function riconosciTipo(testo, nome = '') {
  const t = String(testo || '').slice(0, 6000);
  let best = null;
  for (const r of REGOLE) {
    const m = r.re.exec(t);
    if (!m) continue;
    // conta la posizione (i titoli stanno in alto) e il peso della frase
    const score = r.peso * 1000 - Math.min(m.index, 5000) * 0.6;
    if (!best || score > best.score) best = { id: r.id, score };
  }
  // un DURC cita spesso «contratto» o «fattura»: le frasi forti vincono anche se più in basso
  if (best) return best.id;
  for (const [id, re] of REGOLE_NOME) if (re.test(nome)) return id;
  return 'altro';
}

/** Controllo della partita IVA italiana (11 cifre, carattere di controllo). */
export function pivaValida(p) {
  const s = String(p || '').replace(/^IT/i, '');
  if (!/^\d{11}$/.test(s) || /^0{11}$/.test(s)) return false;
  let sum = 0;
  for (let i = 0; i < 11; i++) {
    let d = +s[i];
    if (i % 2 === 1) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
  }
  return sum % 10 === 0;
}

const CF_DISPARI = { 0: 1, 1: 0, 2: 5, 3: 7, 4: 9, 5: 13, 6: 15, 7: 17, 8: 19, 9: 21, A: 1, B: 0, C: 5, D: 7, E: 9, F: 13, G: 15, H: 17, I: 19, J: 21, K: 2, L: 4, M: 18, N: 20, O: 11, P: 3, Q: 6, R: 8, S: 12, T: 14, U: 16, V: 10, W: 22, X: 25, Y: 24, Z: 23 };
/** Controllo del codice fiscale di persona fisica (16 caratteri). */
export function cfValido(cf) {
  const s = String(cf || '').toUpperCase();
  if (!/^[A-Z]{6}[0-9LMNPQRSTUV]{2}[A-EHLMPRST][0-9LMNPQRSTUV]{2}[A-Z][0-9LMNPQRSTUV]{3}[A-Z]$/.test(s)) return false;
  let sum = 0;
  for (let i = 0; i < 15; i++) {
    const c = s[i];
    if (i % 2 === 0) sum += CF_DISPARI[c];
    else sum += /\d/.test(c) ? +c : c.charCodeAt(0) - 65;
  }
  return String.fromCharCode(65 + (sum % 26)) === s[15];
}

function unici(a) { return [...new Set(a.filter(Boolean))]; }

/** CIG (10 caratteri) e CUP (15 caratteri) citati nel testo. */
export function trovaCigCup(testo) {
  const t = String(testo || '');
  const cig = []; const cup = [];
  const reCig = /\bC\.?\s?I\.?\s?G\.?\s*(?:n\.?|nr\.?|num\.?|:|-|=|derivato)?\s*:?\s*([A-Z0-9]{10})(?![A-Z0-9])/gi;
  for (let m; (m = reCig.exec(t));) { const v = m[1].toUpperCase(); if (/\d/.test(v)) cig.push(v); }
  const reCup = /\bC\.?\s?U\.?\s?P\.?\s*(?:n\.?|nr\.?|:|-|=)?\s*:?\s*([A-Z][0-9]{2}[A-Z][0-9A-Z]{11})(?![A-Z0-9])/gi;
  for (let m; (m = reCup.exec(t));) cup.push(m[1].toUpperCase());
  return { cig: unici(cig).slice(0, 10), cup: unici(cup).slice(0, 10) };
}

/** P.IVA e codice fiscale del soggetto (escludendo quelli dell'ente). */
export function trovaCodici(testo, escludi = CODICI_ENTE_PREDEFINITI) {
  const t = String(testo || '').slice(0, 40000);
  const no = new Set(escludi.map((x) => String(x).replace(/\D/g, '')));
  let piva = '';
  const reP = /(?:p\.?\s?iva|partita\s+iva|p\.?\s?i\.?|vat(?:\s+number)?|c\.?\s?f\.?\s*(?:e|\/)\s*p\.?\s?iva|cod(?:ice)?\.?\s*fisc(?:ale)?\.?\s*(?:e|\/)\s*p(?:artita)?\.?\s*iva)\s*(?:n\.?|nr\.?|:|-)?\s*(?:IT\s?)?(\d{11})\b/gi;
  for (let m; (m = reP.exec(t));) { if (pivaValida(m[1]) && !no.has(m[1])) { piva = m[1]; break; } }
  if (!piva) {
    for (const m of t.matchAll(/\b(?:IT)?(\d{11})\b/g)) { if (pivaValida(m[1]) && !no.has(m[1])) { piva = m[1]; break; } }
  }
  let cf = '';
  for (const m of t.toUpperCase().matchAll(/\b([A-Z]{6}[0-9LMNPQRSTUV]{2}[A-EHLMPRST][0-9LMNPQRSTUV]{2}[A-Z][0-9LMNPQRSTUV]{3}[A-Z])\b/g)) {
    if (cfValido(m[1])) { cf = m[1]; break; }
  }
  if (!cf) {
    const m = t.match(/(?:c\.?\s?f\.?|codice\s+fiscale|cod\.?\s*fisc\.?)\s*(?:n\.?|:)?\s*(\d{11})\b/i);
    if (m && !no.has(m[1])) cf = m[1];
  }
  return { piva, cf };
}

/** Importo principale del documento (totale, netto a pagare, importo complessivo). */
export function trovaImporto(testo) {
  const t = String(testo || '').replace(/\s+/g, ' ');
  const reN = '((?:€|eur(?:o)?)?\\s*(?:\\d{1,3}(?:\\.\\d{3})+|\\d+)(?:,\\d{2})|\\d+\\.\\d{2})';
  const etichette = [
    [5, 'totale\\s+(?:documento|fattura|da\\s+pagare|a\\s+pagare|generale|complessivo|dovuto|ordine)'],
    [5, 'netto\\s+a\\s+pagare'],
    [4, 'importo\\s+(?:totale|complessivo|da\\s+pagare|del(?:l[\'’]|la\\s+)?(?:ordine|contratto|affidamento|fornitura))'],
    [3, 'totale(?:\\s+euro|\\s+eur|\\s+€)?'],
    [2, 'importo(?:\\s+euro|\\s+€)?'],
    [2, '(?:per\\s+un\\s+)?(?:valore|corrispettivo|spesa)\\s+(?:complessiv[oa]|presunt[oa]|stimat[oa])?\\s*(?:di|pari\\s+a)?'],
  ];
  let best = null;
  for (const [peso, lab] of etichette) {
    const re = new RegExp(`\\b${lab}\\b[^0-9€]{0,30}${reN}`, 'gi');
    for (let m; (m = re.exec(t));) {
      const v = numeroIt(m[1]);
      if (v == null || v <= 0 || v > 1e9) continue;
      // a parità di etichetta vale l'ultima (il totale sta in fondo)
      if (!best || peso > best.peso || (peso === best.peso && m.index >= best.index)) best = { peso, index: m.index, v };
    }
    if (best && best.peso >= 4) break;
  }
  return best ? Math.round(best.v * 100) / 100 : null;
}

/** Scadenza (DURC: fine validità; fatture: scadenza del pagamento). */
export function trovaScadenza(testo, tipo) {
  const t = String(testo || '').replace(/\s+/g, ' ');
  const pat = tipo === 'durc'
    ? /(scadenza(?:\s+(?:della\s+)?validit[aà])?|valid[oa]\s+(?:fino|sino)\s+al|validit[aà]\s+(?:fino|sino)\s+al)[^0-9]{0,30}(\d{1,2}[/.\-]\d{1,2}[/.\-]\d{2,4}|\d{4}-\d{2}-\d{2})/i
    : /((?:data\s+)?scadenza(?:\s+(?:del\s+)?pagamento)?|da\s+pagare\s+entro\s+il|pagamento\s+entro\s+il)[^0-9]{0,30}(\d{1,2}[/.\-]\d{1,2}[/.\-]\d{2,4}|\d{4}-\d{2}-\d{2})/i;
  const m = t.match(pat);
  return m ? (trovaDate(m[2])[0]?.iso || '') : '';
}

/** Controllo dell'IBAN (mod 97). */
export function ibanValido(iban) {
  const s = String(iban || '').replace(/\s+/g, '').toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(s)) return false;
  const r = (s.slice(4) + s.slice(0, 4)).replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  let m = 0; for (const ch of r) m = (m * 10 + +ch) % 97;
  return m === 1;
}
/** IBAN italiani (validi) citati nel testo. */
export function trovaIban(testo) {
  const out = [];
  for (const m of String(testo || '').toUpperCase().matchAll(/\bIT\s?\d{2}\s?[A-Z]\s?(?:[0-9A-Z]\s?){22}/g)) {
    const v = m[0].replace(/\s+/g, '');
    if (v.length === 27 && ibanValido(v) && !out.includes(v)) out.push(v);
  }
  return out.slice(0, 5);
}
/** Data di fine (incarichi, contratti): «dal … al …», «fino al …», «scadenza del contratto …». */
export function trovaDataFine(testo) {
  const t = String(testo || '').replace(/\s+/g, ' ');
  const m = t.match(/\bdal(?:l['’])? ?\d{1,2}[/.\-]\d{1,2}[/.\-]\d{2,4} al (\d{1,2}[/.\-]\d{1,2}[/.\-]\d{2,4})/i) || t.match(/\b(?:fino al|sino al|termine (?:il|del)|scadenza del contratto|cessazione(?: dell['’]incarico)?)\D{0,15}(\d{1,2}[/.\-]\d{1,2}[/.\-]\d{2,4})/i);
  return m ? trovaDate(m[1])[0]?.iso || '' : '';
}

/** Numero del documento. */
export function trovaNumero(testo, tipo) {
  const t = String(testo || '').replace(/\s+/g, ' ').slice(0, 8000);
  const specifici = {
    fattura: /fattura(?:\s+elettronica)?\s+(?:n\.?|nr\.?|num\.?|numero|n°)\s*:?\s*([A-Z0-9][A-Z0-9/\-_.]{0,24})/i,
    'nota-credito': /nota\s+di\s+credito\s+(?:n\.?|nr\.?|numero|n°)\s*:?\s*([A-Z0-9][A-Z0-9/\-_.]{0,24})/i,
    ordine: /(?:ordine|determina(?:zione)?|decreto)\s+(?:di\s+acquisto\s+)?(?:n\.?|nr\.?|numero|n°)\s*:?\s*([A-Z0-9][A-Z0-9/\-_.]{0,24})/i,
    durc: /(?:numero\s+protocollo|protocollo(?:\s+documento)?|prot\.?)\s*(?:n\.?|:)?\s*([A-Z_]*\d[A-Z0-9_/\-]{3,30})/i,
    missione: /missione\s+(?:n\.?|nr\.?|numero|n°)\s*:?\s*([A-Z0-9][A-Z0-9/\-_.]{0,24})/i,
    contratto: /(?:contratto|convenzione|rep(?:ertorio)?\.?)\s+(?:n\.?|nr\.?|numero|n°)\s*:?\s*([A-Z0-9][A-Z0-9/\-_.]{0,24})/i,
  };
  const re = specifici[tipo];
  const m = re && t.match(re);
  if (m && /\d/.test(m[1])) return m[1].replace(/[.\-/]+$/, '');
  return '';
}

/** Toglie dall'inizio del nome le parole che non ne fanno parte («sociale», «a», «E», «richiesta.»). */
export function pulisciFornitore(s) {
  const w = String(s || '').trim().split(/\s+/).filter(Boolean);
  while (w.length > 1 && (/^[a-zà-ÿ]/.test(w[0]) || w[0].length <= 1 || /[.:;,]$/.test(w[0]))) w.shift();
  if (w.length === 1 && (/^[a-zà-ÿ]/.test(w[0]) || w[0].length <= 1)) return '';
  return w.join(' ');
}

/**
 * Dati chiave da un testo. opts: { nome, escludi (codici dell'ente) }
 * → { tipo, fornitore, piva, cf, numero, data, importo, cig[], cup[], scadenza }
 */
export function datiDaTesto(testo, { nome = '', escludi = CODICI_ENTE_PREDEFINITI } = {}) {
  const t = String(testo || '');
  const tipo = riconosciTipo(t, nome);
  const base = analizza(t.slice(0, 20000), nome);
  const { cig, cup } = trovaCigCup(t);
  const { piva, cf } = trovaCodici(t, escludi);
  const numero = trovaNumero(t, tipo) || base.numero || '';
  let fornitore = base.soggetto || '';
  if (/^(consiglio nazionale|cnr\b|istituto di chimica)/i.test(fornitore)) fornitore = '';
  if (!fornitore) {
    const m = t.replace(/\s+/g, ' ').match(/(?:fornitore|ditta|impresa|operatore economico|ragione sociale|denominazione|spett\.?le|cedente)\s*:?\s*([A-Z][A-Za-zÀ-ÿ0-9&'.\- ]{2,50}?)(?=\s{1,}|,|$)(?:\s*(?:S\.?r\.?l\.?s?|S\.?p\.?A\.?|S\.?n\.?c\.?|S\.?a\.?s\.?))?/i);
    if (m) fornitore = m[1].trim().split(/\s+/).slice(0, 4).join(' ');
  }
  return {
    tipo,
    fornitore: pulisciFornitore(fornitore).slice(0, 80),
    piva, cf,
    numero: String(numero).slice(0, 40),
    data: base.data || '',
    importo: ['fattura', 'nota-credito', 'ordine', 'contratto', 'missione', 'incarico'].includes(tipo) ? trovaImporto(t) : null,
    iban: ['fattura', 'nota-credito', 'tracciabilita', 'contratto', 'ordine'].includes(tipo) ? trovaIban(t)[0] || '' : '',
    dataFine: ['incarico', 'contratto'].includes(tipo) ? trovaDataFine(t) : '',
    cig, cup,
    scadenza: ['durc', 'fattura', 'nota-credito'].includes(tipo) ? trovaScadenza(t, tipo) || (tipo === 'durc' ? base.scadenza : '') : '',
  };
}

/** Dati chiave da una fattura elettronica letta con parseFattura (area avanzati). Primo corpo. */
export function datiDaFattura(f, { escludi = CODICI_ENTE_PREDEFINITI } = {}) {
  const c = f.corpi[0] || {};
  const no = new Set(escludi);
  const pivaCed = String(f.cedente?.partitaIva || '').replace(/^[A-Z]{2}/, '');
  const dettagli = (c.pagamenti || []).flatMap((p) => p.dettagli || []);
  const scadenze = dettagli.map((d) => d.scadenza).filter(Boolean).sort();
  return {
    tipo: c.tipo === 'TD04' ? 'nota-credito' : 'fattura',
    fornitore: (f.cedente?.nome || '').slice(0, 80),
    piva: no.has(pivaCed) ? '' : pivaCed,
    cf: f.cedente?.codiceFiscale || '',
    numero: String(c.numero || '').slice(0, 40),
    data: /^\d{4}-\d{2}-\d{2}/.test(c.data || '') ? c.data.slice(0, 10) : '',
    importo: c.totale ?? c.calcoli?.totale ?? null,
    cig: (c.cig || []).slice(0, 10),
    cup: (c.cup || []).slice(0, 10),
    scadenza: scadenze[0] || '',
    iban: (dettagli.map((d) => String(d.iban || '').replace(/\s+/g, '').toUpperCase()).find((x) => x) || ''),
    dataFine: '',
  };
}

/** Testo ricercabile di una fattura elettronica (intestazioni, causali, righe). */
export function testoFattura(f) {
  const righe = [];
  const a = (x) => { if (x) righe.push(String(x)); };
  a(`Fattura elettronica ${f.versione || ''}`);
  for (const [lab, s] of [['Cedente/prestatore', f.cedente], ['Cessionario/committente', f.cessionario]]) {
    if (!s) continue;
    a(`${lab}: ${s.nome} P.IVA ${s.partitaIva || ''} C.F. ${s.codiceFiscale || ''} ${s.indirizzo || ''}`);
  }
  for (const c of f.corpi) {
    a(`${c.tipo === 'TD04' ? 'Nota di credito' : 'Fattura'} n. ${c.numero} del ${c.data} Totale documento ${c.totale ?? ''}`);
    c.causali?.forEach(a);
    if (c.cig?.length) a('CIG ' + c.cig.join(' '));
    if (c.cup?.length) a('CUP ' + c.cup.join(' '));
    for (const l of c.linee || []) a(`${l.descrizione} ${l.prezzoTotale ?? ''}`);
    for (const p of c.pagamenti || []) for (const d of p.dettagli || []) a(`Pagamento ${d.modalita} scadenza ${d.scadenza} importo ${d.importo ?? ''} ${d.iban}`);
    for (const al of c.allegati || []) a(`Allegato ${al.nome} ${al.descrizione || ''}`);
  }
  return righe.join('\n');
}

/** Quanto testo per pagina serve per non considerarla una scansione. */
export const MIN_CARATTERI_PAGINA = 25;

/** È una scansione senza testo? pagine: [numero di caratteri per pagina] */
export function eScansione(caratteriPerPagina) {
  const n = caratteriPerPagina.length;
  if (!n) return false;
  const vuote = caratteriPerPagina.filter((c) => c < MIN_CARATTERI_PAGINA).length;
  return vuote / n >= 0.8;
}

/** Firme PAdES nei byte di un PDF: numero di /ByteRange e nomi dichiarati (/Name). */
export function firmePdf(bytes, { max = 20 } = {}) {
  const firme = [];
  const pat = [0x2f, 0x42, 0x79, 0x74, 0x65, 0x52, 0x61, 0x6e, 0x67, 0x65]; // "/ByteRange"
  const n = bytes.length;
  for (let i = bytes.indexOf(0x2f); i >= 0 && i < n - 10 && firme.length < max; i = bytes.indexOf(0x2f, i + 1)) {
    let ok = true;
    for (let k = 1; k < pat.length; k++) if (bytes[i + k] !== pat[k]) { ok = false; break; }
    if (!ok) continue;
    const a = Math.max(0, i - 3000); const b = Math.min(n, i + 3000);
    let s = '';
    for (let k = a; k < b; k++) s += String.fromCharCode(bytes[k]);
    const m = s.match(/\/Name\s*\(((?:\\\)|[^)]){1,120})\)/);
    firme.push(m ? m[1].replace(/\\([()\\])/g, '$1') : '');
    i += 10;
  }
  return firme;
}
