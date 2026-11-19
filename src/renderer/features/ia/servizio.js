// Assistente IA: chiamate al modulo main (canali feat:ia:*). Solo nell'app desktop.

export const disponibile = (app) => typeof window !== 'undefined' && !!window.leggio && !!app?.platform?.invokeFeature;

export async function chiama(app, nome, args = {}) {
  if (!disponibile(app)) throw new Error('L\'assistente IA è disponibile solo nell\'app desktop di Leggio.');
  const r = await app.platform.invokeFeature('ia:' + nome, args);
  if (!r || !r.ok) { const e = new Error(r?.error || 'Operazione non riuscita.'); e.code = r?.code; throw e; }
  return r.value;
}

/** Avanzamento dei download: fn({ componente, fase, fatti, totale, errore }). → funzione per smettere */
export const suAvanzamento = (app, fn) => app.platform.on('feat:ia:avanzamento', fn);

let n = 0;
export const nuovoId = () => `r${Date.now().toString(36)}${(n++).toString(36)}`;
