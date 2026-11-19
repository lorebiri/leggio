// «Novità di questa versione»: si mostrano UNA volta, al primo avvio dopo un aggiornamento.
// REGOLA (vedi docs/RILASCIO.md): a ogni rilascio aggiungere in cima una voce con la nuova versione
// (uguale a "version" di package.json), poche righe in italiano semplice, pensate per chi non è tecnico:
// cosa può fare di nuovo, non come è fatto. Senza voce per la versione, all'utente non viene mostrato nulla.
export const NOVITA = [
  {
    versione: '0.2.2',
    titolo: 'Un avvio più pulito',
    punti: [
      'All’avvio Leggio non riapre più da solo i documenti della volta prima: trovi la schermata iniziale con i recenti e il pulsante «Riapri l’ultimo documento».',
      'Un documento che hai chiuso non ricompare più al riavvio.',
      'Se preferisci il comportamento di prima, lo trovi nelle Impostazioni: «All’avvio riapri i documenti lasciati aperti».',
    ],
  },
  {
    versione: '0.2.1',
    titolo: 'Correzioni importanti per l’oscuramento',
    punti: [
      'Oscuramento più sicuro: ora i dati vengono tolti davvero anche nei testi in arabo o ebraico e nelle scansioni con la pagina ruotata.',
      'Su Windows, Leggio non diventa più il programma predefinito per PDF e .p7m se ne hai già installato un altro.',
      '«Segnala un problema» non include più i nomi delle tue cartelle.',
      'La modifica del testo è molto più veloce sulle pagine con disegni tecnici o mappe.',
      'Copia documento fronte/retro più robusta: angoli spostati male, file non validi e foto molto grandi non bloccano più il lavoro.',
    ],
  },
  {
    versione: '0.2.0',
    titolo: 'Copia dei documenti e tante correzioni',
    punti: [
      'Nuovo: «Copia documento fronte/retro». Dalla scansione di carta d’identità, patente o tessera sanitaria, Leggio ritaglia la tessera e mette fronte e retro su un solo foglio A4, a grandezza reale.',
      'Ora puoi modificare il testo delle tabelle una cella alla volta, senza spostare le altre.',
      'I file firmati .p7m non vengono più toccati: l’originale resta com’era.',
      'Risolto il problema della stampa di fogli bianchi.',
      'Nuovo: oscuramento guidato dei dati dei documenti d’identità, con filigrana «Copia per uso…».',
      'Leggio è disponibile anche per Linux, e oltre 50 altri piccoli problemi sono stati corretti.',
    ],
  },
  {
    versione: '0.1.0',
    titolo: 'La prima versione di Leggio',
    punti: [
      'Leggi, commenta, firma, compila, oscura, unisci e converti i PDF: tutto gratis e senza internet.',
      'Apri i file firmati .p7m e le fatture elettroniche XML, con i controlli già fatti nel riquadro «Controlli».',
      'Archivio d’ufficio: collega le tue cartelle, cerca in migliaia di documenti e vedi in «Oggi» cosa c’è da fare.',
      'Leggio legge la segnatura di Titulus e ti prepara i dati da copiare per Titulus e U-GOV.',
      'Leggio ti avvisa quando esce una nuova versione: basta premere «Scarica».',
      'Qualcosa non va? Aiuto › «Segnala un problema…» prepara una mail già pronta, anche con l’immagine della finestra se vuoi.',
    ],
  },
];
