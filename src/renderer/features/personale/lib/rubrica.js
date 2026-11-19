// Rubrica di persone ed enti: ricerca, duplicati e unione, importazione (CSV/Excel/vCard), esportazione CSV,
// contatti dalle fatture elettroniche. Logica pura (niente DOM): il modello dei dati è archivio.js.
import { CAMPI_CONTATTO, CHIAVI_CONTATTO, nomeContatto } from './campi.js';
import { normalizzaCodici, avvisiContatto } from './validatori.js';
import { csvDaTabella } from './tabelle.js';
export { leggiVcard } from './vcard.js';

const pulito = (v) => (v == null ? '' : String(v).trim());

// ============================================================================ ricerca e ordinamento
/** Minuscole, senza accenti, spazi compattati. */
export function normalizzaTesto(s) {
  return String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}
const CAMPI_RICERCA = ['nome', 'cognome', 'ragioneSociale', 'codiceFiscale', 'partitaIva', 'email', 'pec', 'telefono', 'citta', 'provincia', 'ruolo', 'note'];
/** Valore «gruppo» speciale per i contatti senza gruppo. */
export const SENZA_GRUPPO = '\u0000senza';

// i contatti salvati sono oggetti nuovi a ogni modifica (normalizzaContatto): la cache per oggetto è sempre valida
const cacheTesto = new WeakMap();
const cacheChiave = new WeakMap();
/** Testo in cui cercare (normalizzato), con telefono e codici anche senza spazi. */
export function testoRicerca(c) {
  let t = cacheTesto.get(c);
  if (t != null) return t;
  const parti = CAMPI_RICERCA.map((k) => c[k]).filter(Boolean);
  if (c.telefono) parti.push(String(c.telefono).replace(/[^\d+]/g, ''));
  if (c.partitaIva) parti.push('it' + String(c.partitaIva).replace(/\s/g, ''));
  for (const g of c.gruppi || []) parti.push(g);
  t = normalizzaTesto(parti.join(' \u0001 '));
  cacheTesto.set(c, t);
  return t;
}
/** Chiave di ordinamento: «cognome nome», altrimenti la ragione sociale (o l'email). */
export function chiaveOrdinamento(c) {
  let k = cacheChiave.get(c);
  if (k != null) return k;
  const persona = [c.cognome, c.nome].map(pulito).filter(Boolean).join(' ');
  k = persona || pulito(c.ragioneSociale) || pulito(c.email) || pulito(c.pec) || '￿';
  cacheChiave.set(c, k);
  return k;
}
const collatore = new Intl.Collator('it', { sensitivity: 'base', numeric: true });
/** Ordinamento alfabetico italiano (come localeCompare 'it', ma più veloce su migliaia di contatti). */
export function confrontaContatti(a, b) {
  return collatore.compare(chiaveOrdinamento(a), chiaveOrdinamento(b)) || collatore.compare(pulito(a.ragioneSociale), pulito(b.ragioneSociale));
}
export function ordinaContatti(lista) { return [...lista].sort(confrontaContatti); }

/** Parole della ricerca (normalizzate). */
export function paroleRicerca(q) { return normalizzaTesto(q).split(' ').filter(Boolean); }

/** Il contatto corrisponde alla ricerca e al gruppo? */
export function corrisponde(c, parole, gruppo = '') {
  if (gruppo) {
    const gs = c.gruppi || [];
    if (gruppo === SENZA_GRUPPO ? gs.length : !gs.includes(gruppo)) return false;
  }
  if (!parole.length) return true;
  const t = testoRicerca(c);
  for (const p of parole) if (!t.includes(p)) return false;
  return true;
}

let ordineCache = { copia: [], ordinati: [] };
const stessiOggetti = (a, b) => { if (a.length !== b.length) return false; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false; return true; };
/**
 * Ricerca istantanea: tutte le parole devono comparire (in qualunque campo), filtro per gruppo, ordine alfabetico.
 * L'ordinamento della rubrica intera si ricorda finché i contatti (gli stessi oggetti) non cambiano. → contatti ordinati
 */
export function cercaContatti(contatti, query = '', { gruppo = '' } = {}) {
  const lista = contatti || [];
  if (!stessiOggetti(ordineCache.copia, lista)) ordineCache = { copia: lista.slice(), ordinati: ordinaContatti(lista) };
  const parole = paroleRicerca(query);
  if (!parole.length && !gruppo) return ordineCache.ordinati.slice();
  return ordineCache.ordinati.filter((c) => corrisponde(c, parole, gruppo));
}
/** Dimentica l'ordinamento ricordato (da chiamare quando la rubrica cambia). */
export function dimenticaOrdine() { ordineCache = { copia: [], ordinati: [] }; }

// ============================================================================ chiavi di confronto
/** Codice fiscale o partita IVA confrontabile: maiuscole, senza spazi né punti, senza «IT» davanti alla P.IVA. */
export function chiaveFiscale(v) {
  let s = String(v ?? '').toUpperCase().replace(/[\s.\-/]/g, '');
  if (/^IT\d{11}$/.test(s)) s = s.slice(2);
  return s.length >= 8 ? s : '';
}
export function chiaveEmail(v) { const s = String(v ?? '').trim().toLowerCase().replace(/^mailto:/, ''); return s.includes('@') ? s : ''; }
function chiaveNome(c) {
  const n = normalizzaTesto(c.nome); const g = normalizzaTesto(c.cognome);
  if (n && g) return 'p:' + [n, g].sort().join(' '); // «Mario Rossi» = «Rossi Mario» (nome e cognome invertiti)
  if (!n && !g && c.ragioneSociale) return 'r:' + normalizzaTesto(c.ragioneSociale).replace(/[.,'"]/g, '').replace(/\b(s ?r ?l|s ?p ?a|s ?n ?c|s ?a ?s|srls)\b/g, '').replace(/\s+/g, ' ').trim();
  return '';
}
/** Chiavi «forti» di un contatto (identificano la stessa persona/ente). */
export function chiaviForti(c) {
  const out = [];
  const cf = chiaveFiscale(c.codiceFiscale); const pi = chiaveFiscale(c.partitaIva);
  if (cf) out.push({ k: 'f:' + cf, motivo: 'stesso codice fiscale' });
  if (pi && pi !== cf) out.push({ k: 'f:' + pi, motivo: 'stessa partita IVA' });
  const e = chiaveEmail(c.email); const p = chiaveEmail(c.pec);
  if (e) out.push({ k: 'm:' + e, motivo: 'stessa email' });
  if (p && p !== e) out.push({ k: 'm:' + p, motivo: 'stessa PEC' });
  return out;
}
/** Due contatti con lo stesso nome sono compatibili se non hanno codici o date di nascita diverse. */
function compatibili(a, b) {
  const diversi = (x, y, fn) => { const p = fn(x); const q = fn(y); return p && q && p !== q; };
  if (diversi(a.codiceFiscale, b.codiceFiscale, chiaveFiscale)) return false;
  if (diversi(a.partitaIva, b.partitaIva, chiaveFiscale)) return false;
  if (diversi(a.dataNascita, b.dataNascita, (x) => pulito(x).replace(/\D/g, ''))) return false;
  return true;
}

// ============================================================================ duplicati
/**
 * Gruppi di contatti doppi. Stesso CF o stessa P.IVA (anche incrociati: CF numerico = P.IVA), stessa email o PEC,
 * oppure stesso nome e cognome (o ragione sociale) con dati compatibili.
 * → [{ contatti: [c…] (il più recente per primo), motivi: ['stesso codice fiscale', …] }]
 */
export function trovaDuplicati(contatti) {
  const n = contatti.length;
  const padre = Array.from({ length: n }, (_, i) => i);
  const trova = (i) => { while (padre[i] !== i) { padre[i] = padre[padre[i]]; i = padre[i]; } return i; };
  const motivi = new Map(); // radice → Set
  const unisci = (i, j, motivo) => {
    let a = trova(i); let b = trova(j);
    if (a !== b) { if (b < a) [a, b] = [b, a]; padre[b] = a; const mb = motivi.get(b); if (mb) { const ma = motivi.get(a) || new Set(); mb.forEach((m) => ma.add(m)); motivi.set(a, ma); motivi.delete(b); } }
    if (!motivi.has(a)) motivi.set(a, new Set());
    motivi.get(a).add(motivo);
  };
  const visti = new Map();
  const perNome = new Map();
  contatti.forEach((c, i) => {
    for (const { k, motivo } of chiaviForti(c)) {
      if (visti.has(k)) unisci(visti.get(k), i, motivo); else visti.set(k, i);
    }
    const kn = chiaveNome(c);
    if (kn) { if (!perNome.has(kn)) perNome.set(kn, []); perNome.get(kn).push(i); }
  });
  for (const [kn, idx] of perNome) {
    if (idx.length < 2) continue;
    // sottogruppi in cui ognuno è compatibile con tutti gli altri (niente catene: A~B e B~C ma A≠C)
    const sotto = [];
    for (const i of idx) {
      const s = sotto.find((g) => g.every((j) => compatibili(contatti[i], contatti[j])));
      if (s) s.push(i); else sotto.push([i]);
    }
    const motivo = kn.startsWith('p:') ? 'stesso nome e cognome' : 'stessa ragione sociale';
    for (const s of sotto) for (let x = 1; x < s.length; x++) unisci(s[0], s[x], motivo);
  }
  const gruppi = new Map();
  for (let i = 0; i < n; i++) { const r = trova(i); if (r !== i || gruppi.has(r)) { if (!gruppi.has(r)) gruppi.set(r, [contatti[r]]); if (r !== i) gruppi.get(r).push(contatti[i]); } }
  return [...gruppi].filter(([, cs]) => cs.length > 1)
    .map(([r, cs]) => ({ contatti: cs.sort((a, b) => (pulito(b.modificato) > pulito(a.modificato) ? 1 : -1)), motivi: [...(motivi.get(r) || [])] }))
    .sort((a, b) => confrontaContatti(a.contatti[0], b.contatti[0]));
}

// ============================================================================ unione
const confrontabile = (k, v) => (['codiceFiscale', 'partitaIva'].includes(k) ? chiaveFiscale(v) || normalizzaTesto(v)
  : ['email', 'pec'].includes(k) ? chiaveEmail(v) || normalizzaTesto(v)
    : ['iban', 'codiceSdi', 'cap'].includes(k) ? String(v).toUpperCase().replace(/\s/g, '')
      : k === 'telefono' ? String(v).replace(/[^\d+]/g, '').replace(/^(\+|00)39/, '') : normalizzaTesto(v));
const etichetta = (k) => CAMPI_CONTATTO.find((c) => c.key === k)?.label || k;

/**
 * Calcola l'unione di due o più contatti (funzione pura).
 * opzioni.scelte: { campo: valore } per risolvere i conflitti (predefinito: vince il contatto modificato più di recente).
 * opzioni.tieni: id del contatto da tenere (predefinito: il più recente).
 * → { risultato, tieni, elimina: [id], conflitti: [{ campo, etichetta, valori: [{ valore, id, nome }], scelto }] }
 */
export function calcolaUnione(contatti, { scelte = {}, tieni = null } = {}) {
  const lista = [...(contatti || [])].filter(Boolean);
  if (lista.length < 2) throw new Error('Per unire servono almeno due contatti.');
  const perData = [...lista].sort((a, b) => (pulito(b.modificato) > pulito(a.modificato) ? 1 : pulito(b.modificato) < pulito(a.modificato) ? -1 : 0));
  const base = (tieni && lista.find((c) => c.id === tieni)) || perData[0];
  const risultato = { id: base.id };
  const conflitti = [];
  for (const k of CHIAVI_CONTATTO) {
    if (k === 'note') continue;
    const valori = [];
    for (const c of perData) {
      const v = pulito(c[k]); if (!v) continue;
      const kk = confrontabile(k, v);
      if (!valori.some((x) => x.kk === kk)) valori.push({ valore: v, id: c.id, nome: nomeContatto(c), kk });
    }
    if (!valori.length) continue;
    let scelto = valori[0].valore;
    if (Object.prototype.hasOwnProperty.call(scelte, k) && pulito(scelte[k])) scelto = pulito(scelte[k]);
    risultato[k] = scelto;
    if (valori.length > 1) conflitti.push({ campo: k, etichetta: etichetta(k), valori: valori.map(({ valore, id, nome }) => ({ valore, id, nome })), scelto });
  }
  // note: tutte, senza ripetizioni (dalla più recente)
  const note = [];
  for (const c of perData) { const t = pulito(c.note); if (t && !note.some((x) => normalizzaTesto(x) === normalizzaTesto(t))) note.push(t); }
  if (note.length) risultato.note = note.join('\n\n');
  risultato.gruppi = [...new Set(perData.flatMap((c) => c.gruppi || []))];
  risultato.creato = lista.map((c) => c.creato).filter(Boolean).sort()[0] || base.creato;
  if (base.origine) risultato.origine = base.origine;
  return { risultato, tieni: base.id, elimina: lista.filter((c) => c.id !== base.id).map((c) => c.id), conflitti };
}

/**
 * Applica un'unione all'archivio: salva il contatto unito, sposta firme, voci di registro e riferimenti nei modelli
 * sul contatto che resta, poi elimina gli altri. → { contatto, eliminati, firmeSpostate, registroSpostato }
 */
export async function applicaUnione(archivio, unione) {
  const { risultato, tieni, elimina } = unione;
  if (!archivio.contatto(tieni)) throw new Error('Il contatto da tenere non è più in rubrica.');
  const contatto = archivio.salvaContatto({ ...risultato, id: tieni });
  const nome = nomeContatto(contatto);
  let firmeSpostate = 0; let registroSpostato = 0;
  for (const id of elimina) {
    for (const f of archivio.firme({ proprietario: id })) { archivio.aggiornaFirma(f.id, { proprietario: tieni }); firmeSpostate++; }
    // il registro non ha una funzione di modifica: le voci sono oggetti dell'indice, si aggiornano sul posto
    // (il salvataggio successivo di eliminaContatto le scrive)
    for (const r of archivio.registro({ proprietario: id })) { r.proprietario = tieni; r.proprietarioNome = nome; registroSpostato++; }
    for (const m of archivio.indice?.modelli || []) {
      if (Array.isArray(m.selezione) && m.selezione.includes(id)) m.selezione = [...new Set(m.selezione.map((x) => (x === id ? tieni : x)))];
    }
  }
  const eliminati = [];
  for (const id of elimina) { if (await archivio.eliminaContatto(id, { registro: false })) eliminati.push(id); }
  return { contatto: archivio.contatto(tieni) || contatto, eliminati, firmeSpostate, registroSpostato };
}

/**
 * Completa un contatto esistente con i dati di un altro (solo i campi vuoti; gruppi aggiunti).
 * → { contatto (nuovo oggetto), campi: [chiavi aggiunte], gruppi: [gruppi aggiunti] }
 */
export function completaContatto(esistente, nuovo) {
  const out = { ...esistente }; const campi = [];
  for (const k of CHIAVI_CONTATTO) {
    const v = pulito(nuovo?.[k]);
    if (v && !pulito(esistente[k])) { out[k] = v; campi.push(k); }
  }
  const gs = esistente.gruppi || [];
  const gruppi = (nuovo?.gruppi || []).filter((g) => g && !gs.includes(g));
  out.gruppi = [...gs, ...gruppi];
  return { contatto: out, campi, gruppi };
}

// ============================================================================ importazione: colonne
/** Destinazioni possibili di una colonna (oltre ai campi del contatto). */
export const DESTINAZIONI = [...CAMPI_CONTATTO.map((c) => ({ key: c.key, label: c.label })), { key: 'gruppi', label: 'Gruppi' }];

const compatto = (s) => normalizzaTesto(s).replace(/[^a-z0-9]+/g, '');
const ALIAS = {
  nome: ['nome', 'firstname', 'first', 'givenname', 'prenome', 'nomeproprio', 'nomedibattesimo'],
  cognome: ['cognome', 'lastname', 'last', 'surname', 'familyname'],
  ragioneSociale: ['ragionesociale', 'ragsoc', 'ragionesocialeente', 'denominazione', 'azienda', 'ditta', 'societa', 'ente', 'impresa', 'company', 'companyname', 'organization', 'organisation', 'organizzazione', 'business', 'fornitore', 'cliente'],
  codiceFiscale: ['codicefiscale', 'cf', 'codfisc', 'codfiscale', 'codicefisc', 'fiscalcode', 'taxcode', 'taxid', 'cfpiva'],
  partitaIva: ['partitaiva', 'piva', 'pi', 'partiva', 'vat', 'vatnumber', 'vatcode', 'vatid', 'numeroiva'],
  dataNascita: ['datadinascita', 'datanascita', 'natoil', 'natail', 'natoail', 'birthday', 'birthdate', 'dateofbirth', 'dob', 'compleanno', 'nascita'],
  luogoNascita: ['luogodinascita', 'luogonascita', 'natoa', 'nataa', 'comunedinascita', 'comunenascita', 'placeofbirth', 'birthplace'],
  pec: ['pec', 'indirizzopec', 'emailpec', 'mailpec', 'postacertificata', 'postaelettronicacertificata', 'certifiedemail'],
  email: ['email', 'mail', 'emailaddress', 'indirizzoemail', 'postaelettronica', 'emailprincipale', 'email1', 'emailpersonale', 'emaillavoro', 'emailaziendale', 'emailvalue', 'email1value'],
  telefono: ['telefono', 'tel', 'cellulare', 'cell', 'mobile', 'phone', 'telephone', 'numeroditelefono', 'numerotelefono', 'recapitotelefonico', 'telefonofisso', 'fisso', 'mobilephone', 'businessphone', 'homephone', 'phone1value', 'telefonocellulare', 'recapito'],
  iban: ['iban', 'codiceiban', 'coordinatebancarie', 'contocorrente', 'cc'],
  codiceSdi: ['codicesdi', 'sdi', 'codicedestinatario', 'coddestinatario', 'codicedestinatariosdi', 'codiceunivoco', 'codiceunivocoufficio', 'cuu', 'recipientcode'],
  indirizzo: ['indirizzo', 'via', 'address', 'street', 'residenza', 'sede', 'indirizzodiresidenza', 'indirizzoresidenza', 'viaenumero', 'viaecivico', 'indirizzoviaenumero', 'civico', 'numerocivico', 'ncivico', 'n', 'businessstreet', 'homestreet', 'address1street', 'sedelegale'],
  cap: ['cap', 'zip', 'zipcode', 'postalcode', 'codicepostale', 'businesspostalcode', 'homepostalcode', 'address1postalcode'],
  citta: ['citta', 'comune', 'city', 'town', 'localita', 'comunediresidenza', 'cittadiresidenza', 'cittacomune', 'businesscity', 'homecity', 'address1city'],
  provincia: ['provincia', 'prov', 'pr', 'province', 'siglaprovincia', 'state', 'region', 'businessstate', 'address1region'],
  nazione: ['nazione', 'stato', 'paese', 'country', 'nazionalita', 'countryregion', 'address1country'],
  ruolo: ['ruolo', 'qualifica', 'jobtitle', 'title', 'incarico', 'posizione', 'position', 'mansione', 'professione', 'ruoloqualifica', 'carica'],
  note: ['note', 'notes', 'nota', 'annotazioni', 'commenti', 'commento', 'osservazioni', 'descrizione'],
  gruppi: ['gruppo', 'gruppi', 'categoria', 'categorie', 'group', 'groups', 'categories', 'tag', 'tags', 'etichetta', 'etichette', 'labels', 'groupmembership', 'lista'],
  nominativo: ['nominativo', 'nomeecognome', 'cognomeenome', 'fullname', 'name', 'displayname', 'nomecompleto', 'intestatario', 'contatto'],
};
// riconoscimento «contiene» (dopo gli alias esatti), dal più specifico
const CONTIENE = [
  ['pec', /\bpec\b|certificat/],
  ['codiceFiscale', /codice ?fiscale|cod\.? ?fisc|\bc ?f\b/],
  ['partitaIva', /partita ?iva|\bp ?iva\b|\bvat\b/],
  ['codiceSdi', /\bsdi\b|codice ?destinatario|codice ?univoco/],
  ['dataNascita', /data.*nascit|nat[oa] il/],
  ['luogoNascita', /(luogo|comune).*nascit|nat[oa] a\b/],
  ['iban', /\biban\b/],
  ['email', /e ?mail/],
  ['telefono', /telefon|cellular|\bphone\b|\bmobile\b/],
  ['cap', /\bcap\b|postal/],
  ['provincia', /provinc/],
  ['citta', /citta|comune|\bcity\b/],
  ['indirizzo', /indirizz|\bvia\b|address|street|civico/],
  ['ragioneSociale', /ragione ?sociale|denominaz|azienda|company/],
  ['cognome', /cognome|surname|last ?name/],
  ['nome', /^nome|first ?name|given ?name/],
  ['gruppi', /grupp|categori/],
  ['ruolo', /ruolo|qualifica|incaric/],
  ['note', /\bnot[ae]\b/],
];
// campi che possono ricevere più colonne (i valori si uniscono)
const CUMULABILI = { indirizzo: ' ', telefono: ' / ', note: '\n', gruppi: ', ' };

/** Destinazione proposta per un'intestazione di colonna. → chiave | 'nominativo' | '' */
export function destinazioneColonna(intestazione) {
  const c = compatto(intestazione);
  if (!c) return '';
  // le intestazioni esportate da Leggio stesso (etichette dei campi)
  for (const f of DESTINAZIONI) if (compatto(f.label) === c) return f.key;
  for (const [k, lista] of Object.entries(ALIAS)) if (lista.includes(c)) return k;
  const n = normalizzaTesto(intestazione).replace(/[._\-/()]+/g, ' ').replace(/\s+/g, ' ');
  for (const [k, re] of CONTIENE) if (re.test(n)) return k;
  return '';
}

/**
 * Corrispondenza automatica colonne → campi. Una colonna «Nominativo / Nome e cognome» va nel campo Nome se il file
 * non ha già colonne per nome e cognome (altrimenti non si importa). Un campo già assegnato non viene riassegnato
 * (tranne indirizzo, telefono, note e gruppi, che uniscono più colonne). → { intestazione: chiave | '' }
 */
export function mappaColonne(intestazioni) {
  const prop = intestazioni.map((h) => destinazioneColonna(h));
  const haNome = prop.includes('nome') || prop.includes('cognome');
  const out = {}; const presi = new Set();
  intestazioni.forEach((h, i) => {
    let k = prop[i];
    if (k === 'nominativo') k = haNome || presi.has('nome') ? '' : 'nome';
    if (k && presi.has(k) && !CUMULABILI[k]) k = '';
    if (k) presi.add(k);
    out[h] = k;
  });
  return out;
}

/** Data in gg/mm/aaaa da formati comuni (aaaa-mm-gg, gg.mm.aaaa, gg-mm-aa). Se non la riconosce la lascia com'è. */
export function normalizzaData(v) {
  const s = pulito(v);
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/.exec(s);
  if (m) return `${m[3].padStart(2, '0')}/${m[2].padStart(2, '0')}/${m[1]}`;
  m = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/.exec(s);
  if (m) return `${m[1].padStart(2, '0')}/${m[2].padStart(2, '0')}/${m[3]}`;
  m = /^(\d{1,2})[./-](\d{1,2})[./-](\d{2})$/.exec(s);
  if (m) { const aa = Number(m[3]); const anno = aa > new Date().getFullYear() % 100 ? 1900 + aa : 2000 + aa; return `${m[1].padStart(2, '0')}/${m[2].padStart(2, '0')}/${anno}`; }
  return s;
}
const dividiGruppi = (s) => String(s || '').split(/[,;|]/).map((g) => g.trim()).filter(Boolean);

/** Un contatto (dati puliti, codici normalizzati) da un oggetto qualsiasi con chiavi del contatto. */
export function preparaContatto(dati, { gruppo = '' } = {}) {
  const c = {};
  for (const k of CHIAVI_CONTATTO) { const v = pulito(dati[k]); if (v) c[k] = v; }
  if (c.dataNascita) c.dataNascita = normalizzaData(c.dataNascita);
  if (c.email && !c.pec && /@(pec|legalmail|postacert)\b|\.pec\./i.test(c.email)) { c.pec = c.email; delete c.email; }
  const gruppi = [...(Array.isArray(dati.gruppi) ? dati.gruppi : dividiGruppi(dati.gruppi)), ...dividiGruppi(gruppo)];
  c.gruppi = [...new Set(gruppi.map((g) => String(g).trim()).filter(Boolean))];
  return normalizzaCodici(c);
}

/**
 * Righe di una tabella → contatti, secondo la corrispondenza delle colonne. Le righe vuote si saltano.
 * → [{ riga (1 = prima riga di dati), contatto, avvisi: { campo: avviso } }]
 */
export function righeAContatti(righe, mappa, { gruppo = '' } = {}) {
  const out = [];
  righe.forEach((r, i) => {
    const d = {};
    for (const [col, k] of Object.entries(mappa)) {
      if (!k) continue;
      const v = pulito(r[col]); if (!v) continue;
      if (d[k]) { if (CUMULABILI[k]) d[k] += CUMULABILI[k] + v; } else d[k] = v;
    }
    if (!Object.keys(d).length) return;
    const contatto = preparaContatto(d, { gruppo });
    out.push({ riga: i + 1, contatto, avvisi: avvisiContatto(contatto) });
  });
  return out;
}

/** Il contatto che in `esistenti` ha la stessa P.IVA/CF o la stessa email/PEC. → { contatto, motivo } | null */
export function cercaDoppione(contatto, indice) {
  for (const { k, motivo } of chiaviForti(contatto)) { const e = indice.get(k); if (e) return { contatto: e, motivo }; }
  return null;
}
function indiceChiavi(contatti) {
  const m = new Map();
  for (const c of contatti) for (const { k } of chiaviForti(c)) if (!m.has(k)) m.set(k, c);
  return m;
}

/**
 * Piano di importazione. duplicati: 'salta' | 'aggiorna' (completa i campi vuoti del contatto esistente) | 'aggiungi'.
 * Riconosce anche i doppioni dentro lo stesso file. Non modifica nulla: restituisce cosa salvare.
 * → { daSalvare: contatti[] (nuovi senza id, aggiornati con id), aggiunti, aggiornati, saltati, invariati, doppioni, avvisi: [{ riga, nome, avvisi }] }
 */
export function pianificaImport(voci, esistenti, { duplicati = 'aggiorna' } = {}) {
  const indice = indiceChiavi(esistenti || []);
  const piano = new Map(); // oggetto pianificato → contatto da salvare
  const res = { daSalvare: [], aggiunti: 0, aggiornati: 0, saltati: 0, invariati: 0, doppioni: 0, avvisi: [] };
  for (const v of voci) {
    const c = v.contatto || v;
    const dop = cercaDoppione(c, indice);
    if (dop) res.doppioni++;
    if (dop && duplicati === 'salta') { res.saltati++; continue; }
    if (dop && duplicati === 'aggiorna') {
      const base = piano.get(dop.contatto) || dop.contatto;
      const { contatto, campi, gruppi } = completaContatto(base, c);
      if (!campi.length && !gruppi.length) { if (!piano.has(dop.contatto)) res.invariati++; continue; }
      if (!piano.has(dop.contatto)) { if (dop.contatto.id) res.aggiornati++; }
      piano.set(dop.contatto, contatto);
      for (const { k } of chiaviForti(contatto)) if (!indice.has(k)) indice.set(k, dop.contatto);
      continue;
    }
    const nuovo = { ...c };
    piano.set(nuovo, nuovo);
    res.aggiunti++;
    for (const { k } of chiaviForti(nuovo)) if (!indice.has(k)) indice.set(k, nuovo);
    const avvisi = v.avvisi || avvisiContatto(nuovo);
    if (Object.keys(avvisi).length) res.avvisi.push({ riga: v.riga ?? null, nome: nomeContatto(nuovo), avvisi });
  }
  res.daSalvare = [...piano.values()];
  return res;
}

// ============================================================================ esportazione CSV
export const INTESTAZIONI_CSV = [...CAMPI_CONTATTO.map((c) => c.label), 'Gruppi'];
/** Testo CSV (separatore «;», con BOM: Excel in italiano lo apre bene) dei contatti indicati. */
export function esportaCsv(contatti) {
  const righe = contatti.map((c) => {
    const r = {};
    for (const f of CAMPI_CONTATTO) r[f.label] = c[f.key] || '';
    r.Gruppi = (c.gruppi || []).join(', ');
    return r;
  });
  return csvDaTabella(INTESTAZIONI_CSV, righe);
}

// ============================================================================ fatture elettroniche
/** Divide «Via Roma 10, 50019 Sesto Fiorentino (FI), DE» (indirizzo della fattura già composto). */
function sedeDaTesto(s) {
  const out = {};
  const parti = String(s || '').split(/,\s*/);
  if (parti[0]) out.indirizzo = parti[0];
  const m = /^(\d{5})?\s*(.*?)\s*(?:\(([A-Z]{2})\))?$/.exec(parti[1] || '');
  if (m) { if (m[1]) out.cap = m[1]; if (m[2]) out.citta = m[2]; if (m[3]) out.provincia = m[3]; }
  if (parti[2]) out.nazione = parti[2];
  return out;
}

/**
 * Contatto della rubrica da una parte della fattura (risultato di parseFattura: f.cedente o f.cessionario).
 * ruolo: 'cedente' (→ gruppo «fornitori») | 'cessionario' (→ gruppo «clienti»).
 * fattura (facoltativa): l'intera fattura, per il codice destinatario e la PEC del cessionario e l'IBAN del fornitore.
 * → contatto (senza id) | null se la parte è vuota
 */
export function contattoDaFattura(parte, ruolo = 'cedente', fattura = null) {
  if (!parte || !(parte.nome || parte.partitaIva || parte.codiceFiscale)) return null;
  const c = {};
  if (parte.denominazione) c.ragioneSociale = parte.denominazione;
  else if (parte.nomeProprio || parte.cognome) { if (parte.nomeProprio) c.nome = parte.nomeProprio; if (parte.cognome) c.cognome = parte.cognome; }
  else if (parte.nome) c.ragioneSociale = parte.nome;
  const piva = String(parte.partitaIva || '').toUpperCase().replace(/\s/g, '');
  if (piva) c.partitaIva = /^IT\d{11}$/.test(piva) ? piva.slice(2) : piva;
  if (parte.codiceFiscale) c.codiceFiscale = String(parte.codiceFiscale).toUpperCase().replace(/\s/g, '');
  if (c.codiceFiscale && c.codiceFiscale === c.partitaIva) { /* CF uguale alla P.IVA: va bene tenerli entrambi */ }
  const s = parte.sede;
  if (s && (s.indirizzo || s.comune)) {
    const ind = [s.indirizzo, s.numeroCivico].map(pulito).filter(Boolean).join(' ');
    if (ind) c.indirizzo = ind;
    if (s.cap) c.cap = s.cap;
    if (s.comune) c.citta = s.comune;
    if (s.provincia) c.provincia = s.provincia;
    if (s.nazione && s.nazione !== 'IT') c.nazione = s.nazione;
  } else if (parte.indirizzo) Object.assign(c, sedeDaTesto(parte.indirizzo));
  if (parte.telefono) c.telefono = parte.telefono;
  if (parte.email) c.email = parte.email;
  if (parte.pec) c.pec = parte.pec;
  const tr = fattura?.trasmissione;
  if (ruolo === 'cessionario' && tr) {
    const cod = String(tr.codiceDestinatario || '').toUpperCase();
    if (cod && cod !== '0000000' && cod !== 'XXXXXXX') c.codiceSdi = cod;
    if (tr.pecDestinatario && !c.pec) c.pec = tr.pecDestinatario;
  }
  if (ruolo === 'cedente' && fattura?.corpi) {
    const iban = fattura.corpi.flatMap((x) => x.pagamenti || []).flatMap((p) => p.dettagli || []).map((d) => d.iban).find(Boolean);
    if (iban) c.iban = iban;
  }
  c.gruppi = [ruolo === 'cessionario' ? 'clienti' : 'fornitori'];
  c.origine = 'fattura';
  return preparaContattoConOrigine(c);
}
function preparaContattoConOrigine(c) { const o = preparaContatto(c); o.origine = c.origine; return o; }

/** Contatto già in rubrica con la stessa partita IVA o lo stesso codice fiscale (anche incrociati). → contatto | null */
export function trovaEsistente(archivio, contatto) {
  const lista = Array.isArray(archivio) ? archivio : archivio?.contatti?.() || [];
  const chiavi = [chiaveFiscale(contatto?.partitaIva), chiaveFiscale(contatto?.codiceFiscale)].filter(Boolean);
  if (!chiavi.length) return null;
  return lista.find((c) => chiavi.includes(chiaveFiscale(c.partitaIva)) || chiavi.includes(chiaveFiscale(c.codiceFiscale))) || null;
}

/**
 * Salva in rubrica il soggetto di una fattura senza creare doppioni: se c'è già (stessa P.IVA/CF) completa solo i
 * campi mancanti (se aggiorna: true). → { stato: 'aggiunto'|'aggiornato'|'presente', contatto, campi }
 */
export function salvaDaFattura(archivio, contatto, { aggiorna = true } = {}) {
  const esistente = trovaEsistente(archivio, contatto);
  if (!esistente) return { stato: 'aggiunto', contatto: archivio.salvaContatto(contatto), campi: [] };
  if (!aggiorna) return { stato: 'presente', contatto: esistente, campi: [] };
  const { contatto: c, campi, gruppi } = completaContatto(esistente, contatto);
  if (!campi.length && !gruppi.length) return { stato: 'presente', contatto: esistente, campi: [] };
  return { stato: 'aggiornato', contatto: archivio.salvaContatto(c), campi };
}
