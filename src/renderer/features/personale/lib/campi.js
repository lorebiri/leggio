// Campi della rubrica e del profilo personale, con le etichette che li riconoscono nei moduli PDF.
// Estende PROFILE_FIELDS dell'area «moduli» (stesso riconoscimento, più campi). Logica pura.

/** Campi di un contatto della rubrica (ordine = ordine nel modulo di modifica). */
export const CAMPI_CONTATTO = [
  { key: 'nome', label: 'Nome' },
  { key: 'cognome', label: 'Cognome' },
  { key: 'ragioneSociale', label: 'Ragione sociale / ente' },
  { key: 'codiceFiscale', label: 'Codice fiscale' },
  { key: 'partitaIva', label: 'Partita IVA' },
  { key: 'dataNascita', label: 'Data di nascita' },
  { key: 'luogoNascita', label: 'Luogo di nascita' },
  { key: 'pec', label: 'PEC' },
  { key: 'email', label: 'Email' },
  { key: 'telefono', label: 'Telefono' },
  { key: 'iban', label: 'IBAN' },
  { key: 'codiceSdi', label: 'Codice destinatario SDI' },
  { key: 'indirizzo', label: 'Indirizzo (via e numero)' },
  { key: 'cap', label: 'CAP' },
  { key: 'citta', label: 'Città / comune' },
  { key: 'provincia', label: 'Provincia' },
  { key: 'nazione', label: 'Nazione' },
  { key: 'ruolo', label: 'Ruolo / qualifica' },
  { key: 'note', label: 'Note' },
];
export const CHIAVI_CONTATTO = CAMPI_CONTATTO.map((c) => c.key);

/**
 * Campi riconoscibili nei moduli. `match` si applica al nome del campo ripulito (trattini, numeri e
 * punteggiatura diventano spazi). L'ordine di prova va dal più specifico al più generico.
 */
export const CAMPI_MODULO = [
  { key: 'nomeCompleto', label: 'Nome e cognome', match: /(nome.?e.?cognome|cognome.?e.?nome|full.?name|nominativo|sottoscritt[oa]|il.?la.?sottoscritt)/i },
  { key: 'dataNascita', label: 'Data di nascita', match: /(data.?(di.?)?nascita|nat[oa].?il|birth.?date|date.?of.?birth)/i },
  { key: 'luogoNascita', label: 'Luogo di nascita', match: /(luogo.?(di.?)?nascita|comune.?(di.?)?nascita|nat[oa].?a$|birth.?place|place.?of.?birth)/i },
  { key: 'codiceFiscale', label: 'Codice fiscale', match: /(codice.?fiscale|^c\.? ?f\.?$|fiscal.?code|tax.?code)/i },
  { key: 'codiceSdi', label: 'Codice destinatario SDI', match: /(codice.?(destinatario|sdi|univoco)|^sdi$|^cod.?dest)/i },
  { key: 'iban', label: 'IBAN', match: /(^iban$|iban|coordinate.?bancarie|conto.?corrente)/i },
  { key: 'pec', label: 'PEC', match: /^pec$|posta.?elettronica.?certificata|\bpec\b/i },
  { key: 'partitaIva', label: 'Partita IVA', match: /(partita.?iva|p\.?\s?iva|^piva$|\bvat\b|\bvat ?(n|num|number|no|id|code)\b)/i },
  { key: 'email', label: 'Email', match: /(e[\s-]?mail|posta.?elettronica|^mail$)/i },
  { key: 'ragioneSociale', label: 'Ragione sociale', match: /(ragione.?sociale|denominazione|company.?name|^ditta$|^impresa$)/i },
  { key: 'cognome', label: 'Cognome', match: /^(cognome|surname|last.?name|family.?name)$/i },
  { key: 'nome', label: 'Nome', match: /^(nome|first.?name|given.?name)$/i },
  { key: 'cap', label: 'CAP', match: /^(cap|c ?a ?p|c\.a\.p\.?|zip|postal.?code)$/i },
  { key: 'provincia', label: 'Provincia', match: /^(prov(incia)?\.?|province)$/i },
  { key: 'nazione', label: 'Nazione', match: /^(nazione|stato|paese|country|nazionalit[aà])$/i },
  { key: 'citta', label: 'Città', match: /(citt[aà]|comune|^luogo$|city|town|localit[aà])/i },
  { key: 'indirizzo', label: 'Indirizzo', match: /(indirizzo|^via$|residen|address|street)/i },
  { key: 'telefono', label: 'Telefono', match: /(telefono|^tel\.?$|cellulare|phone|mobile)/i },
  { key: 'ufficio', label: 'Ufficio / struttura', match: /(ufficio|struttura|servizio|reparto|department|unit[aà])/i },
  { key: 'qualifica', label: 'Qualifica / ruolo', match: /(qualifica|ruolo|profilo|incarico|job.?title|position|in.?qualit[aà].?di)/i },
  { key: 'ente', label: 'Ente / istituto', match: /(^ente$|istituto|amministrazione|organizzazione|azienda|company|organi[sz]ation)/i },
];
export const CHIAVI_MODULO = CAMPI_MODULO.map((c) => c.key);
export const etichettaCampo = (key) => CAMPI_MODULO.find((c) => c.key === key)?.label || CAMPI_CONTATTO.find((c) => c.key === key)?.label || (key === 'oggi' ? 'Data di oggi' : key);

const pulito = (v) => (v == null ? '' : String(v).trim());

/** Dati di compilazione da un contatto della rubrica. */
export function datiDaContatto(c = {}) {
  const d = {};
  for (const k of CHIAVI_CONTATTO) if (k !== 'note' && pulito(c[k])) d[k] = pulito(c[k]);
  const full = [d.nome, d.cognome].filter(Boolean).join(' ');
  d.nomeCompleto = full || d.ragioneSociale || '';
  if (d.ruolo) d.qualifica = d.ruolo;
  if (d.ragioneSociale) d.ente = d.ragioneSociale;
  return pulisciVuoti(d);
}
/** Dati di compilazione dal profilo personale («io»): stesse chiavi dei moduli. */
export function datiDaProfilo(p = {}) {
  const d = {};
  for (const [k, v] of Object.entries(p || {})) if (typeof v === 'string' && v.trim()) d[k] = v.trim();
  if (!d.nomeCompleto) d.nomeCompleto = [d.nome, d.cognome].filter(Boolean).join(' ');
  if (!d.ruolo && d.qualifica) d.ruolo = d.qualifica;
  if (!d.qualifica && d.ruolo) d.qualifica = d.ruolo;
  return pulisciVuoti(d);
}
function pulisciVuoti(d) { for (const k of Object.keys(d)) if (!d[k]) delete d[k]; return d; }

/** Nome del campo ripulito per il riconoscimento. */
export function nomeRipulito(nomeCampo) {
  return String(nomeCampo || '').replace(/[_\-.[\]0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Quale chiave dei dati corrisponde a un campo del modulo (dal nome o dall'etichetta vicina). → chiave | 'oggi' | null */
export function chiavePerCampo(nomeCampo) {
  const n = nomeRipulito(nomeCampo);
  if (!n) return null;
  for (const f of CAMPI_MODULO) if (f.match.test(n)) return f.key;
  if (/^(data|date|li|lì|il giorno|data odierna|data compilazione)$/i.test(n)) return 'oggi';
  return null;
}

/** Valore per un campo del modulo. → { key, value } | null (come profileValueFor dell'area moduli) */
export function valorePerCampo(nomeCampo, dati, oggi) {
  const key = chiavePerCampo(nomeCampo);
  if (!key) return null;
  if (key === 'oggi') return oggi ? { key, value: oggi } : null;
  const v = dati?.[key];
  return v ? { key, value: String(v) } : null;
}

/**
 * Proposte di compilazione per un elenco di campi. corrispondenze (facoltativo): { nomeCampo: chiave }
 * salvate in un modello, che hanno la precedenza sul riconoscimento automatico ('' = non compilare).
 * → [{ campo, key, value, origine: 'modello'|'automatico' }]
 */
export function proponiCompilazione(nomiCampi, dati, { oggi, corrispondenze = null, soloVuoti = null } = {}) {
  const out = [];
  for (const campo of nomiCampi) {
    if (soloVuoti && !soloVuoti(campo)) continue;
    let key; let origine = 'automatico';
    if (corrispondenze && Object.prototype.hasOwnProperty.call(corrispondenze, campo)) { key = corrispondenze[campo]; origine = 'modello'; }
    else key = chiavePerCampo(campo);
    if (!key) continue;
    const value = key === 'oggi' ? oggi : key.startsWith('fisso:') ? key.slice(6) : dati?.[key];
    if (value) out.push({ campo, key, value: String(value), origine });
  }
  return out;
}

/** Nome visibile di un contatto. */
export function nomeContatto(c) {
  if (!c) return '';
  const p = [c.nome, c.cognome].map(pulito).filter(Boolean).join(' ');
  return p && c.ragioneSociale ? `${p} (${pulito(c.ragioneSociale)})` : p || pulito(c.ragioneSociale) || pulito(c.email) || pulito(c.pec) || 'Contatto senza nome';
}
