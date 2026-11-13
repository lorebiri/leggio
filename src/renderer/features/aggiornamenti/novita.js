// «Novità di questa versione»: si mostrano UNA volta, al primo avvio dopo un aggiornamento.
// REGOLA (vedi docs/RILASCIO.md): a ogni rilascio aggiungere in cima una voce con la nuova versione
// (uguale a "version" di package.json), poche righe in italiano semplice, pensate per chi non è tecnico:
// cosa può fare di nuovo, non come è fatto. Senza voce per la versione, all'utente non viene mostrato nulla.
export const NOVITA = [
  {
    versione: '0.1.0',
    titolo: 'La prima versione di Leggio',
    punti: [
      'Leggi, commenta, firma, compila, oscura, unisci e converti i PDF: tutto gratis e senza internet.',
      'Apri i file firmati .p7m e le fatture elettroniche XML, con i controlli già fatti nel riquadro «Controlli».',
      'Archivio d’ufficio: collega le tue cartelle, cerca in migliaia di documenti e vedi in «Oggi» cosa c’è da fare.',
      'Leggio legge la segnatura di Titulus e ti prepara i dati da copiare per Titulus e U-GOV.',
      'Leggio ti avvisa quando esce una nuova versione: basta premere «Scarica».',
    ],
  },
];
