// Strumento «Timbro di protocollo».
import { applicaProtocollo, POSIZIONI, DIREZIONI, oggi, normalizzaData, contatoreCorrente, avanzaContatore, formattaNumero } from '../lib/protocollo.js';

const KEY = 'avanzati.protocollo';

export function preferenze(app) {
  return { ente: '', ufficio: '', direzione: 'entrata', classificazione: '', posizione: 'alto-destra', pagine: 'prima', colore: '#1f4e9a', cifre: 0, automatico: true, ...app.settings.get(KEY, {}) };
}

export async function timbroProtocollo(app, deps) {
  const pref = preferenze(app);
  const cont = contatoreCorrente(app.settings.get(KEY + '.contatore', null));
  const v = await app.ui.dialog({
    title: 'Timbro di protocollo', width: 520,
    message: 'Aggiunge il riquadro «Prot. n. … del …». Il numero successivo viene proposto da solo; puoi sempre scriverne o incollarne un altro.',
    fields: [
      { name: 'ente', label: 'Ente o istituto', type: 'text', value: pref.ente, placeholder: 'es. ICCOM-CNR' },
      { name: 'ufficio', label: 'Ufficio (facoltativo)', type: 'text', value: pref.ufficio, placeholder: 'es. Amministrazione' },
      { name: 'numero', label: 'Numero di protocollo', type: 'text', value: pref.automatico ? formattaNumero(cont.prossimo, pref.cifre) : '', required: true },
      { name: 'data', label: 'Data', type: 'text', value: oggi(), help: 'Accetta anche 12.11.26 o 12-11-2026.' },
      { name: 'direzione', label: 'Entrata / uscita', type: 'select', value: pref.direzione, options: DIREZIONI },
      { name: 'classificazione', label: 'Classificazione (facoltativa)', type: 'text', value: pref.classificazione, placeholder: 'es. 3.2' },
      { name: 'posizione', label: 'Posizione', type: 'select', value: pref.posizione, options: POSIZIONI },
      { name: 'pagine', label: 'Su quali pagine', type: 'radio', value: pref.pagine, options: [{ value: 'prima', label: 'Solo la prima' }, { value: 'tutte', label: 'Tutte le pagine' }] },
      { name: 'colore', label: 'Colore', type: 'color', value: pref.colore },
      { name: 'cifre', label: 'Cifre del numero (0 = come scritto)', type: 'number', value: pref.cifre, min: 0, max: 10 },
      { name: 'automatico', label: 'Proponi il numero successivo la prossima volta', type: 'checkbox', value: pref.automatico },
    ],
    okLabel: 'Applica il timbro',
    validate: (x) => {
      if (!String(x.numero).trim()) return 'Scrivi il numero di protocollo.';
      if (String(x.numero).length > 40) return 'Il numero è troppo lungo.';
      if (!normalizzaData(x.data)) return 'La data non è valida. Esempio: 12/11/2026';
      return null;
    },
  });
  if (!v) return;
  const data = normalizzaData(v.data);
  const cifre = Math.max(0, Math.min(10, Number(v.cifre) || 0));
  const numero = formattaNumero(String(v.numero).trim(), cifre);
  app.settings.set(KEY, { ente: v.ente, ufficio: v.ufficio, direzione: v.direzione, classificazione: v.classificazione, posizione: v.posizione, pagine: v.pagine, colore: v.colore, cifre, automatico: v.automatico });
  const ok = await app.editWithPdfLib(`Timbro di protocollo n. ${numero}`, async (pdfDoc, PDFLib) => {
    if (pdfDoc.isEncrypted) throw new Error('Il documento è protetto: togli la protezione prima di applicare il timbro.');
    await applicaProtocollo(pdfDoc, PDFLib, { ...v, numero, data, cifre: 0 });
  });
  if (ok) app.settings.set(KEY + '.contatore', avanzaContatore(app.settings.get(KEY + '.contatore', null), numero));
  void deps;
}
