// L'unica istanza dell'archivio personale, condivisa fra le aree (moduli, avanzati, personale).
let istanza = null;
export function impostaArchivio(a) { istanza = a; }
/** → archivio (createArchivio) oppure null se l'area «personale» non è caricata (es. nei test). */
export function archivioPersonale() { return istanza; }
