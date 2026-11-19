# Schermate di Leggio 0.3

Prese dall'app vera (Electron, finestra 1440×900) con `npx vite build && xvfb-run -a -s "-screen 0 1920x1200x24" node scripts/schermate-0.3.mjs`.
Tutti i dati sono **inventati**: persone, codici fiscali (comune «Z999», inesistente), partite IVA, associazione e fornitore.
L'IBAN è quello d'esempio usato nella documentazione bancaria.

| File | Cosa mostra |
|---|---|
| 01-archivio-protezione-backup | Archivio personale: protezione, password, backup |
| 27-archivio-cosa-c-e | Cosa c'è archiviato |
| 28-archivio-firme-e-sigle | Firme e sigle salvate (mie e di altre persone) |
| 02 / 03 / 04 | Crea firma: Disegna, Scrivi (caratteri inclusi), Foto o scansione |
| 05-firma-foto-prima-e-dopo | Foto di una firma su carta prima e dopo la pulizia (le due immagini affiancate nella finestra di Leggio; «dopo» è l'immagine salvata dall'app) |
| 06 / 09 | «Sigla tutte le pagine»: scelta della posizione e sigla applicata |
| 07 / 08 | «Luogo, data e firma»: scelta e blocco applicato in fondo all'ultima pagina |
| 10 / 11 / 12 | Timbri: modelli pronti, «Ricevuto il» su un documento, timbro dell'ente |
| 13 / 14 / 15 | Rubrica: elenco con i gruppi, scheda con gli avvisi di validazione, modifica |
| 16 | Import da CSV con la corrispondenza delle colonne |
| 17 | FatturaPA: proposta «Salva in rubrica» (fornitore nuovo, cliente già presente) |
| 18 / 19 / 20 | «Compila a nome di»: scelta del contatto, anteprima dei campi, modulo compilato |
| 21 / 22 / 23 / 24 / 25 | Compilazione in serie: dati, corrispondenze con anteprima del primo record, opzioni, avanzamento, riepilogo (3 avvisi voluti) |
| 26 | Registro delle firme di altre persone |
