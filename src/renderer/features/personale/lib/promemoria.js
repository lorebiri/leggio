// Promemoria gentile per esportare il backup dell'archivio personale e avviso (una volta) del portachiavi mancante.
// Logica senza DOM, coperta dai test. Lo stato sta nel localStorage: sono solo date e scelte, nessun dato personale.
//
// Quando si propone il backup:
//   - «primo»: dopo il salvataggio della prima firma, se non è mai stato fatto un backup;
//   - «periodico»: se ci sono dati nuovi dall'ultimo backup e sono passati almeno 30 giorni dall'ultimo backup
//     o dall'ultimo «Non ora»;
//   - mai dopo «Non ricordarmelo più», mai con l'archivio vuoto.

export const CHIAVE_PROMEMORIA = 'leggio.personale.promemoria.v1';
export const GIORNI_PROMEMORIA = 30;
const GIORNO = 24 * 3600 * 1000;

const numero = (v) => (Number.isFinite(v) && v > 0 ? v : null);

export function normalizzaPromemoria(o, ora = Date.now()) {
  const s = o && typeof o === 'object' ? o : {};
  return {
    dal: numero(s.dal) || ora,                 // da quando si tiene il conto (primo avvio con la 0.3.1)
    ultimoBackup: numero(s.ultimoBackup),
    ultimoPromemoria: numero(s.ultimoPromemoria),
    ultimaModifica: numero(s.ultimaModifica),
    primoMostrato: !!s.primoMostrato,
    maiPiu: !!s.maiPiu,
    portachiaviAvvisato: numero(s.portachiaviAvvisato),
  };
}

/**
 * → 'primo' | 'periodico' | null
 * inventario: archivio.inventario() (conta firme, timbri, contatti, modelli…)
 */
export function decidiPromemoria(stato, inventario, ora = Date.now()) {
  const s = normalizzaPromemoria(stato, ora);
  if (s.maiPiu || !inventario) return null;
  const firme = (inventario.firmeMie || 0) + (inventario.sigleMie || 0) + (inventario.firmeAltrui || 0);
  const elementi = firme + (inventario.timbri || 0) + (inventario.contatti || 0) + (inventario.modelli || 0) + (inventario.profilo || 0);
  if (!elementi) return null;
  if (!s.ultimoBackup && !s.primoMostrato && firme > 0) return 'primo';
  const nuovi = s.ultimaModifica && s.ultimaModifica > (s.ultimoBackup || 0);
  if (!nuovi) return null;
  const riferimento = Math.max(s.ultimoBackup || 0, s.ultimoPromemoria || 0, s.dal);
  return ora - riferimento >= GIORNI_PROMEMORIA * GIORNO ? 'periodico' : null;
}

export const azioni = {
  nonOra: (s, ora = Date.now()) => ({ ...normalizzaPromemoria(s, ora), ultimoPromemoria: ora, primoMostrato: true }),
  maiPiu: (s, ora = Date.now()) => ({ ...normalizzaPromemoria(s, ora), maiPiu: true, primoMostrato: true }),
  backupFatto: (s, ora = Date.now()) => ({ ...normalizzaPromemoria(s, ora), ultimoBackup: ora, primoMostrato: true }),
  modificato: (s, ora = Date.now()) => ({ ...normalizzaPromemoria(s, ora), ultimaModifica: ora }),
  portachiaviAvvisato: (s, ora = Date.now()) => ({ ...normalizzaPromemoria(s, ora), portachiaviAvvisato: ora }),
};

/** Lo stato salvato nel localStorage (o in memoria se non c'è). */
export function createStatoPromemoria(storage = null) {
  let mem = null;
  const leggi = () => {
    if (!storage) return normalizzaPromemoria(mem);
    try { return normalizzaPromemoria(JSON.parse(storage.getItem(CHIAVE_PROMEMORIA) || 'null')); } catch { return normalizzaPromemoria(null); }
  };
  const scrivi = (s) => { mem = s; if (storage) { try { storage.setItem(CHIAVE_PROMEMORIA, JSON.stringify(s)); } catch { /* spazio esaurito: pazienza */ } } return s; };
  // la data di partenza si fissa subito, così i 30 giorni contano dal primo avvio
  scrivi(leggi());
  return {
    leggi,
    applica: (nome, ora) => scrivi(azioni[nome](leggi(), ora)),
    decidi: (inventario, ora) => decidiPromemoria(leggi(), inventario, ora),
  };
}
