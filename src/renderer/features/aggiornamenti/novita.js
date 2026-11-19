// «Novità di questa versione»: si mostrano UNA volta, al primo avvio dopo un aggiornamento.
// REGOLA (vedi docs/RILASCIO.md): a ogni rilascio aggiungere in cima una voce con la nuova versione
// (uguale a "version" di package.json), poche righe in italiano semplice, pensate per chi non è tecnico:
// cosa può fare di nuovo, non come è fatto. Senza voce per la versione, all'utente non viene mostrato nulla.
export const NOVITA = [
  {
    versione: '0.3.1',
    titolo: 'Archivio personale più sicuro',
    punti: [
      'La password dell’archivio personale ora è molto più difficile da indovinare per chi provasse a forzarla. Non devi fare nulla: la tua password resta la stessa e la protezione si aggiorna da sola la prima volta che la inserisci.',
      'Quando scegli una password, Leggio ti dice se è debole o robusta. E nelle impostazioni dell’archivio trovi un consiglio: sul tuo PC personale la password non è indispensabile, su un PC condiviso o d’ufficio conviene metterla.',
      'Su Linux, se sul computer manca il portachiavi, Leggio ora te lo dice chiaramente e ti propone di impostare una password.',
      'Leggio ti ricorda con gentilezza di esportare un backup: dopo la prima firma salvata e poi circa una volta al mese, se ci sono dati nuovi. Puoi rispondere «Non ora» o «Non ricordarmelo più».',
      'Il backup viene controllato subito dopo l’esportazione: contiene davvero tutto, firme, timbri, rubrica e modelli con i loro PDF.',
      'Se l’archivio non si apre (per esempio dopo un problema al disco o al portachiavi) Leggio spiega cosa è successo e ti aiuta a ripartire da un backup, senza cancellare nulla. Se il disco è pieno, le modifiche restano in memoria e Leggio riprova da solo.',
    ],
  },
  {
    versione: '0.3.0',
    titolo: 'Firme, timbri, rubrica e moduli in serie',
    punti: [
      'Le tue firme, sigle e timbri, la rubrica e i modelli ora stanno in un archivio protetto (cifrato) sul tuo computer, senza più limiti di numero. Quelle che avevi sono state spostate da sole. Se vuoi, puoi aggiungere una password e fare un backup.',
      'Nuovi modi di creare la firma: scritta con un carattere a mano incluso in Leggio, oppure dalla foto di una firma su carta (sfondo e colore della carta vengono tolti da soli).',
      'Con un clic: «Sigla tutte le pagine» e il blocco «Luogo, data e firma» con la data di oggi. E i timbri: «Copia conforme», «Ricevuto il…», «Annullato», «Visto», «Pagato» e il timbro del tuo ente.',
      'Nuova Rubrica di persone ed enti: controlla codice fiscale, partita IVA e IBAN, importa da fogli di calcolo, CSV e vCard, e dalle fatture elettroniche propone di salvare fornitore e cliente.',
      '«Compila a nome di»: scegli te o un contatto e il modulo si riempie da solo, con un controllo prima di scrivere.',
      'Nuova «Compilazione in serie»: lo stesso modulo compilato per un gruppo della rubrica o per le righe di un foglio di calcolo, un PDF per persona o tutti in uno.',
      'Puoi usare anche le firme di altre persone (per esempio di un collega che ti ha autorizzato): Leggio chiede conferma e tiene un registro di quando le hai usate.',
    ],
  },
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
