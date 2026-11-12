// Cifratura e decifratura con @cantoo/pdf-lib, permessi, robustezza delle password. Logica pura.
//
// Come funziona il fork (verificato nei sorgenti, node_modules/@cantoo/pdf-lib/src/core/security):
//  - pdfDoc.encrypt({ userPassword, ownerPassword, permissions, algorithm }) — predefinito AES-256 (V5/R6),
//    disponibili anche AES-128 (V4/R4) e RC4 (solo con allowWeakCryptography). La cifratura avviene al save().
//  - PDFDocument.load(bytes, { password }) decifra TUTTO in memoria e toglie /Encrypt dal trailer:
//    salvando quel documento si ottiene un file NON cifrato. Per questo l'area registra un save hook
//    che ri-cifra (vedi index.js).
//  - DIFETTO DEL FORK (2.11.1): al salvataggio cifra solo i flussi, NON le stringhe (Info, titoli dei
//    segnalibri, valori dei campi, URI…). Le stringhe restano in chiaro nel file e i lettori conformi
//    (Acrobat, Anteprima, poppler) le "decifrano" ottenendo caratteri senza senso. Correzione qui sotto:
//    cifriamo noi tutte le stringhe degli oggetti indiretti prima del salvataggio (saveEncrypted).
//  - Simmetricamente, aprendo un file cifrato correttamente il fork decifra le stringhe — ma i file
//    prodotti dal fork stesso non vanno riaperti con lui senza la nostra correzione.
//  - Se ownerPassword manca, il fork usa la password di apertura anche come password del proprietario:
//    i permessi non proteggerebbero nulla. Qui generiamo una password proprietario casuale.
import { PDFDocument, PDFDict, PDFArray, PDFString, PDFHexString, PDFStream } from '@cantoo/pdf-lib';
import { encryptionInfo } from './pdfutil.js';

export const ALGORITMI = [
  { value: 'AES-256', label: 'AES 256 bit (consigliato, Acrobat X e successivi)' },
  { value: 'AES-128', label: 'AES 128 bit (compatibile con Acrobat 7 e successivi)' },
];

/** Permessi dell'interfaccia → oggetto permessi del fork. */
export function toLibPermissions(p = {}) {
  return {
    printing: p.stampa === 'none' ? false : p.stampa === 'low' ? 'lowResolution' : 'highResolution',
    modifying: !!p.modifica,
    copying: !!p.copia,
    annotating: !!p.commenti,
    fillingForms: !!p.moduli || !!p.commenti,
    contentAccessibility: true, // lettori di schermo sempre ammessi
    documentAssembly: !!p.assemblaggio,
  };
}

/** Valore /P del dizionario di cifratura → permessi dell'interfaccia. */
export function fromPValue(P) {
  const bit = (n) => (P & (1 << (n - 1))) !== 0;
  return {
    stampa: !bit(3) ? 'none' : bit(12) ? 'high' : 'low',
    modifica: bit(4), copia: bit(5), commenti: bit(6), moduli: bit(9), assemblaggio: bit(11),
  };
}

export const TUTTI_PERMESSI = { stampa: 'high', modifica: true, copia: true, commenti: true, moduli: true, assemblaggio: true };
export function hasRestrictions(p) { const t = TUTTI_PERMESSI; return Object.keys(t).some((k) => p[k] !== t[k]); }

/** Descrizione leggibile dei permessi. */
export function describePermissions(p) {
  const out = [];
  out.push(p.stampa === 'none' ? 'stampa non consentita' : p.stampa === 'low' ? 'stampa solo a bassa risoluzione' : 'stampa consentita');
  out.push(p.copia ? 'copia del testo consentita' : 'copia del testo non consentita');
  out.push(p.modifica ? 'modifica consentita' : 'modifica non consentita');
  out.push(p.commenti ? 'commenti consentiti' : 'commenti non consentiti');
  out.push(p.moduli ? 'compilazione moduli consentita' : 'compilazione moduli non consentita');
  out.push(p.assemblaggio ? 'riorganizzazione pagine consentita' : 'riorganizzazione pagine non consentita');
  return out;
}

export function randomPassword(len = 32) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789-_';
  const r = new Uint8Array(len); globalThis.crypto.getRandomValues(r);
  return [...r].map((x) => alphabet[x % alphabet.length]).join('');
}

const COMUNI = ['password', 'passw0rd', '123456', '12345678', '123456789', 'qwerty', 'abc123', 'admin', 'letmein', 'welcome', 'iloveyou', 'ciao', 'ciaociao', 'amore', 'juventus', 'napoli', 'milan', 'inter', 'roma', 'lazio', 'francesca', 'andrea', 'qwertyuiop', 'asdfgh', 'zxcvbn', '111111', '000000', 'segreto', 'prova', 'test', 'leggio'];

/**
 * Robustezza stimata della password. → { score 0..4, label, hint, bits }
 * Stima prudente: entropia per classi di caratteri, penalità per ripetizioni, sequenze e parole comuni.
 */
export function passwordStrength(pw) {
  const s = String(pw || '');
  if (!s) return { score: 0, label: 'Nessuna', hint: 'Scegli una password.', bits: 0 };
  let pool = 0;
  if (/[a-z]/.test(s)) pool += 26;
  if (/[A-Z]/.test(s)) pool += 26;
  if (/\d/.test(s)) pool += 10;
  if (/[^A-Za-z0-9]/.test(s)) pool += 33;
  const uniq = new Set(s).size;
  let bits = Math.log2(pool || 1) * s.length * Math.min(1, (uniq / s.length) * 1.6);
  const low = s.toLowerCase();
  if (COMUNI.some((c) => low.includes(c))) bits = Math.min(bits, 18) - 4;
  if (/^(.)\1+$/.test(s)) bits = 4;
  if (/(0123|1234|2345|3456|4567|5678|6789|abcd|bcde|qwer|asdf)/i.test(s)) bits -= 10;
  if (/^\d+$/.test(s)) bits = Math.min(bits, s.length * 3.3);
  if (/(19|20)\d{2}$/.test(s)) bits -= 6;
  bits = Math.max(0, bits);
  const score = bits < 28 ? (s.length < 6 ? 0 : 1) : bits < 45 ? 2 : bits < 65 ? 3 : 4;
  const labels = ['Molto debole', 'Debole', 'Discreta', 'Buona', 'Ottima'];
  const hints = [
    'Troppo corta o troppo comune: usa almeno 12 caratteri.',
    'Facile da indovinare: allungala e mescola lettere, numeri e simboli.',
    'Accettabile. Più lunga è, meglio è (una frase di 4 parole va benissimo).',
    'Buona password.',
    'Password molto robusta.',
  ];
  return { score, label: labels[score], hint: hints[score], bits: Math.round(bits) };
}

/**
 * Cifra un PDFDocument (la cifratura effettiva avviene al save()).
 * opts: { userPassword, ownerPassword, permissions (forma dell'interfaccia), algorithm }
 * → { ownerPassword } effettivamente usata (generata se assente e servono restrizioni).
 */
export function encryptDoc(pdfDoc, { userPassword = '', ownerPassword = '', permissions = TUTTI_PERMESSI, algorithm = 'AES-256' } = {}) {
  if (!userPassword && !ownerPassword && !hasRestrictions(permissions)) throw new Error('Indica almeno una password o una restrizione.');
  if (!['AES-256', 'AES-128'].includes(algorithm)) throw new Error('Algoritmo di cifratura non supportato: ' + algorithm);
  // senza password proprietario il fork riuserebbe quella di apertura: i permessi non varrebbero nulla
  const owner = ownerPassword || randomPassword();
  if (userPassword && owner === userPassword && hasRestrictions(permissions)) {
    throw new Error('La password per le autorizzazioni deve essere diversa da quella di apertura, altrimenti chi apre il file può togliere le restrizioni.');
  }
  pdfDoc.encrypt({ userPassword: userPassword || undefined, ownerPassword: owner, permissions: toLibPermissions(permissions), algorithm });
  return { ownerPassword: owner };
}

/** Cifra le stringhe di tutti gli oggetti indiretti (rimedio al difetto del fork). → numero di stringhe */
export function encryptAllStrings(pdfDoc) {
  const ctx = pdfDoc.context; const sec = ctx.security;
  if (!sec) throw new Error('encryptAllStrings: documento non cifrato');
  const encRef = ctx.trailerInfo.Encrypt;
  let count = 0;
  for (const [ref, obj] of ctx.enumerateIndirectObjects()) {
    if (encRef && ref === encRef) continue;
    const fn = sec.getEncryptFn(ref.objectNumber, ref.generationNumber);
    const enc = (v) => {
      if (v instanceof PDFString || v instanceof PDFHexString) { count++; return PDFHexString.of(toHex(fn(v.asBytes()))); }
      if (v instanceof PDFDict) { for (const [k, x] of v.entries()) { const r = enc(x); if (r !== x) v.set(k, r); } return v; }
      if (v instanceof PDFArray) { for (let i = 0; i < v.size(); i++) { const x = v.get(i); const r = enc(x); if (r !== x) v.set(i, r); } return v; }
      if (v instanceof PDFStream) { enc(v.dict); return v; }
      return v;
    };
    const r = enc(obj);
    if (r !== obj) ctx.assign(ref, r);
  }
  return count;
}
function toHex(b) { let s = ''; for (let i = 0; i < b.length; i++) s += b[i].toString(16).padStart(2, '0'); return s; }

/**
 * Cifra dei byte PDF in chiaro e restituisce il file cifrato (conforme: flussi E stringhe cifrati).
 * Il documento viene prima risalvato in chiaro (così tutti gli oggetti sono definitivi), poi ricaricato,
 * cifrato e scritto senza flussi di oggetti.
 */
export async function encryptBytes(bytes, opts) {
  let doc = await PDFDocument.load(bytes, { updateMetadata: false, ignoreEncryption: true });
  if (doc.isEncrypted) throw new Error('Il documento è già cifrato: togli prima la protezione esistente.');
  const flat = await doc.save({ useObjectStreams: false });
  doc = await PDFDocument.load(flat, { updateMetadata: false });
  const r = encryptDoc(doc, opts);
  encryptAllStrings(doc);
  const out = await doc.save({ useObjectStreams: false, updateFieldAppearances: false, addDefaultPage: false });
  return Object.assign(out, { ownerPassword: r.ownerPassword });
}

/** Errore con messaggio comprensibile per l'utente. */
export class PasswordError extends Error { constructor(msg, code) { super(msg); this.name = 'PasswordError'; this.code = code; } }

/**
 * Apre un PDF eventualmente cifrato con pdf-lib, decifrandolo. password: stringa ('' = password vuota).
 * Lancia PasswordError se la password è errata (verifica: il fork non controlla la password e produce
 * contenuti illeggibili, quindi controlliamo che il catalogo decifrato sia valido).
 */
export async function openDecrypted(bytes, password = '') {
  let probe;
  try { probe = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false }); }
  catch (e) { throw new Error('Il file non sembra un PDF valido: ' + (e?.message || e)); }
  const info = encryptionInfo(probe);
  if (!info) return { doc: probe, info: null };
  let doc;
  try { doc = await PDFDocument.load(bytes, { password: password ?? '', updateMetadata: false }); }
  catch (e) { throw new PasswordError('Password errata o cifratura non supportata.', 'bad'); }
  return { doc, info };
}

/** Elenco delle informazioni di cifratura in forma leggibile. */
export function describeEncryption(info) {
  if (!info) return 'Nessuna cifratura';
  return `${info.algorithm} (revisione ${info.R})`;
}
