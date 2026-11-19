// Archivio personale: password, sicurezza, backup, cosa c'è archiviato.
/** Chiede la password dell'archivio. → password | null */
export async function chiediPassword(app, { errore = '' } = {}) {
  const v = await app.ui.dialog({
    title: 'Archivio personale protetto',
    message: 'Firme, timbri e rubrica sono protetti da una password. Inseriscila per continuare.',
    fields: [
      ...(errore ? [{ name: 'info', type: 'info', text: errore }] : []),
      { name: 'password', label: 'Password', type: 'password', required: true },
    ],
    okLabel: 'Apri',
  });
  return v ? v.password : null;
}
export function registerImpostazioni(_app, _ctx) {}
