// Profilo personale («io»): dati ricorrenti (nome, codice fiscale, ufficio, IBAN…) salvati nell'archivio
// personale cifrato, solo su questo computer.
import { PROFILE_FIELDS } from './lib/store.js';
import { apriArchivio } from './personale.js';
import { validaCodiceFiscale, validaIban, validaPartitaIva, validaEmail, validaPec } from '../personale/lib/validatori.js';

export const CAMPI_PROFILO = [...PROFILE_FIELDS, { key: 'iban', label: 'IBAN (per rimborsi e compensi)' }];
const CONTROLLI = { codiceFiscale: validaCodiceFiscale, iban: validaIban, partitaIva: validaPartitaIva, email: validaEmail, pec: validaPec };

export async function editProfileDialog(app, store) {
  const a = await apriArchivio(app);
  if (!a) return null;
  const p = a.profilo();
  const v = await app.ui.dialog({
    title: 'I miei dati personali', width: 580,
    message: 'Servono per compilare i moduli con un clic («Dati» in Compila e firma, «Compila a nome di» sui moduli compilabili). Restano solo su questo computer, nell\'archivio personale cifrato.',
    fields: CAMPI_PROFILO.map((f) => ({ name: f.key, label: f.label, type: 'text', value: p[f.key] || '', placeholder: f.key === 'nomeCompleto' ? 'Se vuoto: nome + cognome' : '' })),
    okLabel: 'Salva',
  });
  if (!v) return null;
  const saved = a.salvaProfilo(v);
  // avvisi, mai blocchi
  const avvisi = Object.entries(CONTROLLI).map(([k, fn]) => (saved[k] ? fn(saved[k]).avviso : null)).filter(Boolean);
  app.ui.toast(avvisi.length ? 'Dati salvati. Attenzione: ' + avvisi[0] : 'Dati personali salvati', { kind: avvisi.length ? 'warning' : 'success', timeout: avvisi.length ? 8000 : 3800 });
  try { store?.invalidaProfilo?.(); } catch { /* */ }
  return saved;
}
