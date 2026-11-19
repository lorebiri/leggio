// Validatori dei dati italiani: codice fiscale (con omocodie), partita IVA, IBAN, codice destinatario SDI,
// email e PEC. Gli esiti sono AVVISI, mai blocchi: l'interfaccia li mostra e lascia salvare comunque.
// Ogni funzione → { valido: boolean, vuoto?: true, normalizzato: string, avviso?: string, ... }

const vuoto = (v) => ({ valido: true, vuoto: true, normalizzato: '' });

// ------------------------------------------------------------------------- codice fiscale
const OMOCODIA = 'LMNPQRSTUV'; // 0..9
const MESI = 'ABCDEHLMPRST';
const DISPARI = { 0: 1, 1: 0, 2: 5, 3: 7, 4: 9, 5: 13, 6: 15, 7: 17, 8: 19, 9: 21, A: 1, B: 0, C: 5, D: 7, E: 9, F: 13, G: 15, H: 17, I: 19, J: 21, K: 2, L: 4, M: 18, N: 20, O: 11, P: 3, Q: 6, R: 8, S: 12, T: 14, U: 16, V: 10, W: 22, X: 25, Y: 24, Z: 23 };
const POS_NUMERICHE = [6, 7, 9, 10, 12, 13, 14];

/** Carattere di controllo dei primi 15 caratteri di un codice fiscale. */
export function carattereControlloCf(primi15) {
  let s = 0;
  for (let i = 0; i < 15; i++) {
    const c = primi15[i];
    // posizioni dispari (1ª, 3ª…) = indici pari
    s += i % 2 === 0 ? DISPARI[c] : /\d/.test(c) ? Number(c) : c.charCodeAt(0) - 65;
  }
  return String.fromCharCode(65 + (s % 26));
}

/** Toglie l'omocodia (lettere al posto delle cifre). */
export function deomocodizza(cf) {
  const a = cf.split('');
  for (const p of POS_NUMERICHE) { const k = OMOCODIA.indexOf(a[p]); if (k >= 0) a[p] = String(k); }
  return a.join('');
}

export function validaCodiceFiscale(v) {
  const n = String(v ?? '').toUpperCase().replace(/[\s.-]/g, '');
  if (!n) return vuoto();
  if (/^\d{11}$/.test(n)) {
    const p = validaPartitaIva(n);
    return { ...p, normalizzato: n, tipo: 'numerico', avviso: p.valido ? undefined : 'Codice fiscale numerico (di un ente o un\'azienda) non valido: controlla le cifre.' };
  }
  if (n.length !== 16) return { valido: false, normalizzato: n, avviso: `Il codice fiscale ha 16 caratteri (qui ${n.length}).` };
  const forma = /^[A-Z]{6}[0-9LMNPQRSTUV]{2}[ABCDEHLMPRST][0-9LMNPQRSTUV]{2}[A-Z][0-9LMNPQRSTUV]{3}[A-Z]$/;
  if (!forma.test(n)) return { valido: false, normalizzato: n, avviso: 'Il codice fiscale non ha la forma giusta (6 lettere, 2 cifre, 1 lettera, 2 cifre, 1 lettera, 3 cifre, 1 lettera).' };
  if (carattereControlloCf(n.slice(0, 15)) !== n[15]) return { valido: false, normalizzato: n, avviso: 'L\'ultimo carattere del codice fiscale non torna: probabilmente c\'è un errore di battitura.' };
  const base = deomocodizza(n);
  const omocodico = base !== n;
  const giornoRaw = Number(base.slice(9, 11));
  const sesso = giornoRaw > 40 ? 'F' : 'M';
  const giorno = giornoRaw > 40 ? giornoRaw - 40 : giornoRaw;
  const mese = MESI.indexOf(base[8]) + 1;
  const anno2 = Number(base.slice(6, 8));
  const giorniMese = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mese - 1] || 31;
  if (giorno < 1 || giorno > giorniMese) return { valido: false, normalizzato: n, avviso: 'Il giorno di nascita nel codice fiscale non è possibile.' };
  return { valido: true, normalizzato: n, omocodico, sesso, giorno, mese, anno2, comune: base.slice(11, 15) };
}

/** Data di nascita (gg/mm/aaaa) ricavata dal codice fiscale; il secolo si sceglie rispetto a oggi. */
export function dataNascitaDaCf(cf, oggi = new Date()) {
  const r = validaCodiceFiscale(cf);
  if (!r.valido || r.tipo === 'numerico' || r.vuoto) return '';
  const aa = oggi.getFullYear() % 100;
  const anno = r.anno2 > aa ? 1900 + r.anno2 : 2000 + r.anno2;
  return `${String(r.giorno).padStart(2, '0')}/${String(r.mese).padStart(2, '0')}/${anno}`;
}

// ------------------------------------------------------------------------- partita IVA
export function validaPartitaIva(v) {
  let n = String(v ?? '').toUpperCase().replace(/[\s.-]/g, '');
  if (!n) return vuoto();
  if (/^IT\d{11}$/.test(n)) n = n.slice(2);
  else if (/^[A-Z]{2}[0-9A-Z]{2,13}$/.test(n)) return { valido: true, normalizzato: n, estera: true, avviso: 'Partita IVA estera: Leggio non può controllarla.' };
  if (!/^\d{11}$/.test(n)) return { valido: false, normalizzato: n, avviso: `La partita IVA italiana ha 11 cifre (qui ${n.replace(/\D/g, '').length}).` };
  let s = 0;
  for (let i = 0; i < 10; i++) {
    let d = Number(n[i]);
    if (i % 2 === 1) { d *= 2; if (d > 9) d -= 9; }
    s += d;
  }
  const ctrl = (10 - (s % 10)) % 10;
  if (ctrl !== Number(n[10])) return { valido: false, normalizzato: n, avviso: 'L\'ultima cifra della partita IVA non torna: probabilmente c\'è un errore di battitura.' };
  if (n === '00000000000') return { valido: false, normalizzato: n, avviso: 'Partita IVA composta solo da zeri.' };
  return { valido: true, normalizzato: n };
}

// ------------------------------------------------------------------------- IBAN
const LUNGHEZZE_IBAN = {
  IT: 27, SM: 27, VA: 22, AT: 20, BE: 16, BG: 22, CH: 21, CY: 28, CZ: 24, DE: 22, DK: 18, EE: 20, ES: 24, FI: 18, FR: 27,
  GB: 22, GR: 27, HR: 21, HU: 28, IE: 22, LI: 21, LT: 20, LU: 20, LV: 21, MC: 27, MT: 31, NL: 18, NO: 15, PL: 28, PT: 25,
  RO: 24, SE: 24, SI: 19, SK: 24, AL: 28, AD: 24, BA: 20, ME: 22, MK: 19, RS: 22, TR: 26, UA: 29,
};
export function validaIban(v) {
  const n = String(v ?? '').toUpperCase().replace(/[\s.-]/g, '');
  if (!n) return vuoto();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{8,30}$/.test(n)) return { valido: false, normalizzato: n, avviso: 'L\'IBAN inizia con due lettere del paese (es. IT) e due cifre di controllo.' };
  const paese = n.slice(0, 2);
  const len = LUNGHEZZE_IBAN[paese];
  if (len && n.length !== len) return { valido: false, normalizzato: n, avviso: `Un IBAN ${paese} ha ${len} caratteri (qui ${n.length}).` };
  const r = n.slice(4) + n.slice(0, 4);
  let resto = 0;
  for (const ch of r) {
    const val = /\d/.test(ch) ? ch : String(ch.charCodeAt(0) - 55);
    for (const d of val) resto = (resto * 10 + Number(d)) % 97;
  }
  if (resto !== 1) return { valido: false, normalizzato: n, avviso: 'Le cifre di controllo dell\'IBAN non tornano: probabilmente c\'è un errore di battitura.' };
  if (paese === 'IT' && !/^IT\d{2}[A-Z]\d{10}[A-Z0-9]{12}$/.test(n)) return { valido: false, normalizzato: n, avviso: 'L\'IBAN italiano non ha la forma giusta (CIN, ABI, CAB, conto).' };
  return { valido: true, normalizzato: n, paese, formattato: n.replace(/(.{4})/g, '$1 ').trim() };
}

// ------------------------------------------------------------------------- codice destinatario SDI
export function validaCodiceSdi(v) {
  const n = String(v ?? '').toUpperCase().replace(/\s/g, '');
  if (!n) return vuoto();
  if (n === 'XXXXXXX') return { valido: true, normalizzato: n, tipo: 'estero', nota: 'Destinatario estero (senza codice SDI).' };
  if (/^[A-Z0-9]{7}$/.test(n)) return { valido: true, normalizzato: n, tipo: n === '0000000' ? 'pec' : 'privato', nota: n === '0000000' ? 'Fattura recapitata via PEC o nell\'area riservata dell\'Agenzia delle Entrate.' : undefined };
  if (/^[A-Z0-9]{6}$/.test(n)) return { valido: true, normalizzato: n, tipo: 'pa', nota: 'Codice univoco ufficio di una pubblica amministrazione (6 caratteri).' };
  return { valido: false, normalizzato: n, avviso: 'Il codice destinatario ha 7 caratteri (6 per le pubbliche amministrazioni), solo lettere e cifre.' };
}

// ------------------------------------------------------------------------- email e PEC
const EMAIL = /^[^\s@<>()[\],;:"]+@[^\s@<>()[\],;:"]+\.[a-z]{2,}$/i;
export function validaEmail(v) {
  const n = String(v ?? '').trim();
  if (!n) return vuoto();
  return EMAIL.test(n) ? { valido: true, normalizzato: n.toLowerCase() } : { valido: false, normalizzato: n, avviso: 'L\'indirizzo email non sembra valido (manca la @ o il dominio).' };
}
export function validaPec(v) {
  const r = validaEmail(v);
  if (!r.valido || r.vuoto) return r.vuoto ? r : { ...r, avviso: 'L\'indirizzo PEC non sembra valido.' };
  // si guarda il dominio (dopo la @): «speck@gmail.com» non è una PEC
  if (!/(pec|legalmail|cert|postacert|arubapec|sicurezzapostale|gigapec|mypec|ticertifica|casellapec)/i.test(r.normalizzato.split('@').pop())) return { ...r, avviso: 'Controlla che sia davvero un indirizzo PEC (di solito contiene «pec» o «legalmail»).', dubbio: true };
  return r;
}
export function validaCap(v) {
  const n = String(v ?? '').trim();
  if (!n) return vuoto();
  return /^\d{5}$/.test(n) ? { valido: true, normalizzato: n } : { valido: false, normalizzato: n, avviso: 'Il CAP italiano ha 5 cifre.' };
}

/** Controlli di un contatto intero. → { campo: avviso } (solo i campi con un avviso) */
export function avvisiContatto(c = {}) {
  const out = {};
  const prova = (campo, fn) => { const r = fn(c[campo]); if (r.avviso && !r.vuoto) out[campo] = r.avviso; };
  prova('codiceFiscale', validaCodiceFiscale);
  prova('partitaIva', validaPartitaIva);
  prova('iban', validaIban);
  prova('codiceSdi', validaCodiceSdi);
  prova('email', validaEmail);
  prova('pec', validaPec);
  if (!c.nazione || /^(it|italia)$/i.test(c.nazione)) prova('cap', validaCap);
  if (!['nome', 'cognome', 'ragioneSociale', 'email', 'pec'].some((k) => String(c[k] || '').trim())) out.nome = 'Manca un nome (o una ragione sociale): il contatto sarà difficile da trovare.';
  return out;
}

/** Valori normalizzati (maiuscole, niente spazi) per i campi codificati; gli altri restano com'erano. */
export function normalizzaCodici(c = {}) {
  const o = { ...c };
  for (const [k, fn] of [['codiceFiscale', validaCodiceFiscale], ['partitaIva', validaPartitaIva], ['iban', validaIban], ['codiceSdi', validaCodiceSdi]]) {
    if (o[k]) o[k] = fn(o[k]).normalizzato;
  }
  if (o.provincia && /^[a-z]{2}$/i.test(o.provincia.trim())) o.provincia = o.provincia.trim().toUpperCase();
  return o;
}
