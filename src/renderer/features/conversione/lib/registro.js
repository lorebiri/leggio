// Registro dei lavori su cartelle (OCR in blocco): permette di riprendere senza rifare i file già finiti.
// Logica pura: il registro è un oggetto JSON salvato accanto ai risultati.

export const VERSIONE_REGISTRO = 1;
export const ESITI_FINITI = new Set(['fatto', 'gia-testo']);

export const chiaveFile = (f) => `${f.size}:${Math.round(f.mtimeMs || 0)}`;

export function nuovoRegistro(params = {}) {
  return { versione: VERSIONE_REGISTRO, creato: new Date().toISOString(), params, voci: {} };
}

/** Legge un registro da byte/testo JSON; se manca o è illeggibile ne crea uno nuovo. */
export function leggiRegistro(testo, params) {
  try {
    const r = JSON.parse(typeof testo === 'string' ? testo : new TextDecoder().decode(testo));
    if (r && r.versione === VERSIONE_REGISTRO && r.voci && typeof r.voci === 'object') return r;
  } catch { /* registro assente o danneggiato */ }
  return nuovoRegistro(params);
}

/** Un file è finito se il registro lo segna come tale e il file non è cambiato da allora. */
export function finito(registro, f) {
  const v = registro.voci[f.rel];
  return !!(v && ESITI_FINITI.has(v.esito) && v.chiave === chiaveFile(f));
}

/** Divide l'elenco in file da fare e già finiti. */
export function daFare(elenco, registro) {
  const fare = []; const fatti = [];
  for (const f of elenco) (finito(registro, f) ? fatti : fare).push(f);
  return { fare, fatti };
}

export function segna(registro, f, esito, extra = {}) {
  registro.voci[f.rel] = { esito, chiave: chiaveFile(f), quando: new Date().toISOString(), ...extra };
  registro.aggiornato = new Date().toISOString();
  return registro;
}

/** Riepilogo per il rapporto. */
export function riepilogo(registro) {
  const r = { fatto: 0, 'gia-testo': 0, errore: 0, pagine: 0, ms: 0 };
  for (const v of Object.values(registro.voci)) {
    r[v.esito] = (r[v.esito] || 0) + 1;
    r.pagine += v.pagine || 0; r.ms += v.ms || 0;
  }
  return r;
}

/** Percorso di uscita: stessa struttura di sottocartelle sotto la cartella di destinazione. */
export function percorsoUscita(destinazione, rel, sep = '/') {
  const pulito = String(rel).split(/[\\/]+/).filter((x) => x && x !== '..' && x !== '.').join(sep);
  return destinazione.replace(/[\\/]+$/, '') + sep + pulito;
}
