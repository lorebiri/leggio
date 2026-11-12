// Profilo dell'ente (istituto/ufficio): estende il profilo personale dell'area «moduli» con i dati dell'ente
// (denominazione, sede, CF/P.IVA, codice IPA, codice univoco ufficio, PEC, direttore, firmatari).
// Logica pura: validazione, corrispondenza con i nomi dei campi dei moduli, testo per timbri e dichiarazioni.
import { partitaIvaValida } from './datichiave.js';

export const KEY_ENTE = 'avanzati.ente';

export const CAMPI_ENTE = [
  { key: 'denominazione', label: 'Denominazione dell\'ente', esempio: 'CNR - Istituto di Chimica dei Composti Organometallici (ICCOM)', match: /(denominazione|ragione.?sociale|^ente$|istituto|amministrazione|stazione.?appaltante)/i },
  { key: 'sigla', label: 'Sigla o AOO (come nella segnatura di Titulus)', esempio: 'ICCOM-CNR', match: /^sigla$/i },
  { key: 'ufficio', label: 'Ufficio', esempio: 'Ufficio amministrazione e contabilità', match: /(ufficio|struttura|servizio)/i },
  { key: 'indirizzo', label: 'Sede (via e numero)', esempio: 'Via Madonna del Piano 10', match: /(sede|indirizzo|^via$)/i },
  { key: 'cap', label: 'CAP', esempio: '50019', match: /^(cap|c\.a\.p\.?)$/i },
  { key: 'citta', label: 'Città', esempio: 'Sesto Fiorentino', match: /(citt[aà]|comune)/i },
  { key: 'provincia', label: 'Provincia', esempio: 'FI', match: /^(prov(incia)?\.?)$/i },
  { key: 'codiceFiscale', label: 'Codice fiscale dell\'ente', esempio: '80054330586', match: /(codice.?fiscale.?(ente|amministrazione|istituto)|c\.?f\.?.?ente)/i },
  { key: 'partitaIva', label: 'Partita IVA', esempio: '02118311006', match: /(partita.?iva|p\.?\s?iva)/i },
  { key: 'codiceIpa', label: 'Codice IPA dell\'ente', esempio: 'cnr', match: /(codice.?ipa|ipa)/i },
  { key: 'codiceUfficio', label: 'Codice univoco ufficio (fatturazione)', esempio: 'ABC123', match: /(codice.?univoco|codice.?ufficio|codice.?destinatario)/i },
  { key: 'pec', label: 'PEC dell\'ente', esempio: 'protocollo.iccom@pec.cnr.it', match: /(^pec$|posta.?elettronica.?certificata)/i },
  { key: 'telefono', label: 'Telefono', esempio: '055 5225…', match: /(telefono|^tel\.?$)/i },
  { key: 'direttore', label: 'Direttore', esempio: 'Nome Cognome', match: /(direttore|responsabile.?(della.?)?struttura|legale.?rappresentante)/i },
  { key: 'firmatari', label: 'Altri firmatari (uno per riga: nome — qualifica)', esempio: 'Nome Cognome — RUP', area: true },
];

export function normalizzaEnte(p = {}) {
  const out = {};
  for (const f of CAMPI_ENTE) { const v = p[f.key]; if (typeof v === 'string' && v.trim()) out[f.key] = v.trim().slice(0, f.area ? 2000 : 300); }
  return out;
}

export function validaEnte(p) {
  const e = [];
  if (p.partitaIva && !partitaIvaValida(p.partitaIva.replace(/^IT/i, ''))) e.push('La partita IVA non è valida (controlla le 11 cifre).');
  if (p.codiceFiscale && !/^(\d{11}|[A-Z0-9]{16})$/i.test(p.codiceFiscale.replace(/\s/g, ''))) e.push('Il codice fiscale dell\'ente deve avere 11 cifre.');
  if (p.pec && !/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(p.pec)) e.push('L\'indirizzo PEC non è valido.');
  if (p.codiceUfficio && !/^[A-Z0-9]{6,7}$/i.test(p.codiceUfficio)) e.push('Il codice univoco ufficio ha 6 caratteri.');
  return e;
}

export function sedeCompleta(p) { return [p.indirizzo, [p.cap, p.citta, p.provincia && `(${p.provincia})`].filter(Boolean).join(' ')].filter(Boolean).join(', '); }
export function firmatari(p) {
  const list = [];
  if (p.direttore) list.push({ nome: p.direttore, qualifica: 'Direttore' });
  for (const r of String(p.firmatari || '').split(/\r?\n/)) { const [nome, qualifica] = r.split(/\s+[—–-]\s+/); if (nome?.trim()) list.push({ nome: nome.trim(), qualifica: (qualifica || '').trim() }); }
  return list;
}

/** Voci inseribili «con un clic» (testo pronto). */
export function vociInseribili(p) {
  const v = [];
  const add = (label, testo) => { if (testo) v.push({ label, testo }); };
  add('Denominazione', p.denominazione);
  add('Denominazione e sede', [p.denominazione, sedeCompleta(p)].filter(Boolean).join('\n'));
  add('Intestazione completa', [p.denominazione, p.ufficio, sedeCompleta(p), [p.codiceFiscale && `C.F. ${p.codiceFiscale}`, p.partitaIva && `P.IVA ${p.partitaIva}`].filter(Boolean).join(' – '), p.pec && `PEC ${p.pec}`].filter(Boolean).join('\n'));
  add('Codice fiscale', p.codiceFiscale); add('Partita IVA', p.partitaIva); add('Codice IPA', p.codiceIpa); add('Codice univoco ufficio', p.codiceUfficio);
  add('PEC', p.pec); add('Sede', sedeCompleta(p));
  for (const f of firmatari(p)) add(`Firmatario: ${f.nome}`, [f.nome, f.qualifica].filter(Boolean).join('\n'));
  return v;
}

/**
 * Valore per un campo di modulo dal suo nome: prima i campi dell'ente (se il nome lo indica),
 * poi il profilo personale (fornito dall'area moduli). → { origine, key, value } | null
 */
export function valorePerCampo(nomeCampo, ente) {
  const n = String(nomeCampo || '').replace(/[_\-.[\]0-9]+/g, ' ').trim();
  if (!n) return null;
  const order = ['codiceUfficio', 'codiceIpa', 'pec', 'partitaIva', 'codiceFiscale', 'direttore', 'sigla', 'denominazione', 'cap', 'provincia', 'citta', 'indirizzo', 'telefono', 'ufficio'];
  // i campi «codice fiscale» senza riferimento all'ente sono della persona: non li tocchiamo qui
  for (const key of order) {
    const f = CAMPI_ENTE.find((x) => x.key === key);
    if (f.match?.test(n) && ente[key]) return { origine: 'ente', key, value: ente[key] };
  }
  return null;
}
