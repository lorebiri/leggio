// «Novità di questa versione»: si mostrano UNA volta, al primo avvio dopo un aggiornamento.
// REGOLA (vedi docs/RILASCIO.md): a ogni rilascio aggiungere in cima una voce con la nuova versione
// (uguale a "version" di package.json), poche righe in italiano semplice, pensate per chi non è tecnico:
// cosa può fare di nuovo, non come è fatto. Senza voce per la versione, all'utente non viene mostrato nulla.
export const NOVITA = [
  {
    versione: '0.1.0',
    titolo: 'La prima versione di Leggio',
    punti: [
      'Apri, leggi, cerca e stampa i PDF, anche più documenti insieme in schede separate.',
      'Leggio ti avvisa quando esce una nuova versione: basta premere «Scarica».',
    ],
  },
];
