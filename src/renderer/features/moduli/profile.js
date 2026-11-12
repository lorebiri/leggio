// Profilo personale: dati ricorrenti (nome, codice fiscale, ufficio…) salvati solo su questo computer.
import { PROFILE_FIELDS } from './lib/store.js';

export async function editProfileDialog(app, store) {
  const p = store.getProfile();
  const v = await app.ui.dialog({
    title: 'I miei dati personali', width: 560,
    message: 'Servono per compilare i moduli con un clic («Dati personali» in Compila e firma, «Compila con i miei dati» sui moduli compilabili). Restano solo su questo computer.',
    fields: PROFILE_FIELDS.map((f) => ({ name: f.key, label: f.label, type: 'text', value: p[f.key] || '', placeholder: f.key === 'nomeCompleto' ? 'Se vuoto: nome + cognome' : '' })),
    okLabel: 'Salva',
  });
  if (!v) return null;
  const saved = store.setProfile(v);
  app.ui.toast('Dati personali salvati', { kind: 'success' });
  return saved;
}
