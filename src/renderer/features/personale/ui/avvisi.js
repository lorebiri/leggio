// Avvisi dell'archivio personale (0.3.1):
//  - portachiavi mancante (Linux senza libsecret/kwallet): una volta, alla creazione o al primo avvio con la 0.3.1;
//    poi resta solo il riquadro nelle impostazioni dell'archivio;
//  - promemoria gentile per esportare il backup (lib/promemoria.js decide quando);
//  - recupero quando l'archivio non si apre (chiave danneggiata o mancante, portachiavi azzerato): mettere da parte
//    l'archivio (mai cancellato) e ripristinare un backup;
//  - indicatore di robustezza della password nei dialoghi.
import { robustezzaPassword } from '../lib/robustezza.js';

const PORTACHIAVI_INTRO = 'Su questo computer manca il portachiavi, il servizio che di solito custodisce la chiave dell\'archivio.';
const PORTACHIAVI_CORPO = 'Per questo firme, timbri e rubrica sono protetti solo dai permessi del file: chi può entrare con il tuo utente, o leggere il tuo disco, potrebbe aprirli. Ti consigliamo di impostare una password.';
export const TESTO_PORTACHIAVI = PORTACHIAVI_INTRO + ' ' + PORTACHIAVI_CORPO;
export const CONSIGLIO_PASSWORD = 'Senza password l\'archivio è protetto dall\'utente del computer: va bene su un PC personale. Su un PC condiviso o d\'ufficio, usato da più persone, conviene impostare una password.';

/** Codici d'errore per cui l'archivio non si apre ma si può ricominciare (mettendolo da parte) e ripristinare un backup. */
export const ERRORI_RECUPERABILI = new Set(['sistema', 'chiave-danneggiata', 'chiave-mancante', 'danneggiato']);

/** Sotto un campo password: barra e giudizio («Debole», «Buona»…), aggiornati mentre si scrive. */
export function aggiungiIndicatore(h, input, { minimo = 8 } = {}) {
  if (!input) return null;
  const barre = [0, 1, 2, 3].map(() => h('span', { class: 'pers-forza-tacca' }));
  const testo = h('span', { class: 'pers-forza-testo' });
  const consiglio = h('small', { class: 'pers-forza-consiglio' });
  const el = h('div', { class: 'pers-forza', 'aria-live': 'polite' }, h('span', { class: 'pers-forza-barra', 'aria-hidden': 'true' }, barre), testo, consiglio);
  const aggiorna = () => {
    const r = robustezzaPassword(input.value, { minimo });
    el.dataset.livello = String(r.livello);
    el.hidden = !input.value;
    barre.forEach((b, i) => b.classList.toggle('on', i < r.livello));
    testo.textContent = r.etichetta ? 'Robustezza: ' + r.etichetta : '';
    consiglio.textContent = r.consiglio;
  };
  input.addEventListener('input', aggiorna);
  (input.closest('.field') || input).after(el);
  aggiorna();
  return el;
}

/** Riquadro «manca il portachiavi» con il pulsante per impostare la password. */
export function riquadroPortachiavi(h, onPassword) {
  return h('div', { class: 'callout warn pers-avviso', role: 'note' },
    h('div', {},
      h('p', {}, h('strong', {}, PORTACHIAVI_INTRO + ' '), PORTACHIAVI_CORPO),
      h('div', { class: 'pers-actions' }, h('button', { type: 'button', class: 'btn primary', onclick: onPassword }, 'Imposta una password…'))));
}

/** Avviso del portachiavi mancante, una volta sola (poi resta nelle impostazioni dell'archivio). */
export async function avvisoPortachiavi(app, { stato, promemoria, impostaPassword }) {
  if (!stato?.avvisoPortachiavi || promemoria.leggi().portachiaviAvvisato) return false;
  promemoria.applica('portachiaviAvvisato');
  const v = await app.ui.dialog({
    title: 'Il tuo archivio ha una protezione di base',
    message: TESTO_PORTACHIAVI,
    fields: [{ name: 'info', type: 'info', text: 'Puoi farlo anche più tardi da «Archivio personale» → «Protezione e backup».' }],
    okLabel: 'Imposta una password…', cancelLabel: 'Più tardi',
  });
  if (v) await impostaPassword();
  return true;
}

/** Promemoria del backup. → 'esporta' | 'non-ora' | 'mai-piu' */
export async function promemoriaBackup(app, tipo) {
  let maiPiu = false;
  const v = await app.ui.dialog({
    title: tipo === 'primo' ? 'Fai una copia di sicurezza?' : 'È ora di aggiornare il backup',
    message: tipo === 'primo'
      ? 'Hai salvato la tua prima firma. Ti consigliamo di esportare un backup dell\'archivio personale: se il computer si guasta o lo cambi, potrai recuperare firme, timbri, rubrica e modelli. Il file è protetto da una password che scegli tu.'
      : 'Da un po\' di tempo non esporti un backup e nell\'archivio personale ci sono dati nuovi. Vuoi esportarne uno aggiornato? Il file è protetto da una password che scegli tu.',
    okLabel: 'Esporta un backup…', cancelLabel: 'Non ora',
    onOpen: (form) => {
      const foot = form.querySelector('.dlg-foot');
      const nonOra = [...foot.querySelectorAll('button')].find((b) => b.textContent === 'Non ora');
      foot.prepend(app.ui.h('button', { type: 'button', class: 'btn ghost pers-mai-piu', onclick: () => { maiPiu = true; nonOra?.click(); } }, 'Non ricordarmelo più'));
    },
  });
  return v ? 'esporta' : maiPiu ? 'mai-piu' : 'non-ora';
}

/**
 * L'archivio non si apre: spiega cosa è successo e offre la via d'uscita (mettere da parte + backup).
 * → true se l'archivio è di nuovo utilizzabile.
 */
export async function dialogoRecupero(app, archivio, err, { importaBackup } = {}) {
  // portachiavi: spesso è un problema temporaneo (portachiavi bloccato, sessione appena aperta). Prima si riprova;
  // ricominciare è la seconda scelta, dietro un pulsante secondario.
  if (err.code === 'sistema') {
    for (;;) {
      let ricomincia = false;
      const v = await app.ui.dialog({
        title: 'Il portachiavi non apre l\'archivio personale',
        message: err.message,
        fields: [{ name: 'info', type: 'info', text: 'Se il portachiavi del computer è bloccato, sbloccalo e premi «Riprova». I tuoi dati non sono stati toccati.' }],
        okLabel: 'Riprova', cancelLabel: 'Non ora',
        onOpen: (form) => {
          const foot = form.querySelector('.dlg-foot');
          const nonOra = [...foot.querySelectorAll('button')].find((b) => b.textContent === 'Non ora');
          foot.prepend(app.ui.h('button', { type: 'button', class: 'btn ghost pers-ricomincia', onclick: () => { ricomincia = true; nonOra?.click(); } }, 'Metti da parte e ricomincia…'));
        },
      });
      if (v) {
        try { return await archivio.apri(); }
        catch (e2) {
          if (e2?.code === 'sistema') { err = e2; continue; }
          if (ERRORI_RECUPERABILI.has(e2?.code)) return dialogoRecupero(app, archivio, e2, { importaBackup });
          app.reportError(e2, 'Archivio personale'); return false;
        }
      }
      if (!ricomincia) return false;
      break; // sotto: la conferma per mettere da parte
    }
  }
  const titolo = { sistema: 'Il portachiavi non apre l\'archivio personale', 'chiave-danneggiata': 'La chiave dell\'archivio personale è danneggiata', 'chiave-mancante': 'Manca la chiave dell\'archivio personale', danneggiato: 'L\'archivio personale è danneggiato' }[err.code] || 'Archivio personale non disponibile';
  const v = await app.ui.dialog({
    title: titolo,
    message: err.message,
    fields: [{ name: 'info', type: 'info', text: 'Se scegli di ricominciare, la cartella attuale viene rinominata e lasciata dov\'è (niente viene cancellato): potrai consegnarla a un tecnico o rimetterla a posto. Subito dopo potrai importare un file di backup.' }],
    okLabel: 'Metti da parte e ricomincia', cancelLabel: 'Non ora', danger: true,
  });
  if (!v) return false;
  try {
    const r = await archivio.backend.azzera();
    await archivio.chiudi();
    app.ui.toast(`Archivio messo da parte${r?.messoDaParte ? ': ' + r.messoDaParte : ''}`, { kind: 'success', timeout: 10000 });
  } catch (e) { app.reportError(e, 'Archivio personale'); return false; }
  if (!(await archivio.apri().catch((e) => { app.reportError(e, 'Archivio personale'); return false; }))) return false;
  if (importaBackup && await app.ui.dialog({ title: 'Ripristina un backup', message: 'L\'archivio personale ora è vuoto. Vuoi importare un file di backup?', okLabel: 'Importa un backup…', cancelLabel: 'Non ora' })) await importaBackup();
  return true;
}

/**
 * Prima di chiudere Leggio: l'archivio personale salva subito ciò che è in attesa. Se non ci riesce (disco pieno,
 * permessi) l'utente viene avvisato e la chiusura si annulla, a meno che scelga «Esci comunque».
 * → true per lasciar uscire.
 */
export async function guardiaUscita(app, archivio) {
  if (!archivio?.aperto) return true;
  let errore = null;
  try { await archivio.salvaOra(); } catch (e) { errore = e; }
  if (!archivio.nonSalvato) return true;
  const v = await app.ui.dialog({
    title: 'Ci sono modifiche all\'archivio personale non salvate',
    message: `Leggio non è riuscito a salvare le ultime modifiche a firme, timbri o rubrica${errore?.message ? ': ' + errore.message : '.'} Se esci adesso andranno perse. Ti consigliamo di restare, liberare spazio sul disco (o risolvere il problema) e lasciare che Leggio riprovi da solo.`,
    okLabel: 'Esci comunque', cancelLabel: 'Resta in Leggio', danger: true,
  });
  return v !== null;
}
