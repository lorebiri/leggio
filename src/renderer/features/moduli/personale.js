// Collegamento dell'area «moduli» all'archivio personale (area «personale»): apertura con password,
// scelta di chi firma, conferma esplicita e registro per le firme di altre persone.
import { archivioPersonale } from '../personale/lib/condiviso.js';
import { nomeContatto } from '../personale/lib/campi.js';
import { scegliContatto } from '../personale/ui/scegli.js';

/** Apre l'archivio personale (chiede la password se serve). → archivio | null */
export async function apriArchivio(app) {
  const a = archivioPersonale();
  if (!a) { app.ui.toast('Archivio personale non disponibile.', { kind: 'error' }); return null; }
  try { return (await a.apri()) ? a : null; }
  catch (err) { app.reportError(err, 'Archivio personale non disponibile'); return null; }
}

/** Funzione per cambiare il proprietario di una firma: → 'io' | { id, nome } | null */
export function sceltaProprietario(app, archivio) {
  return async () => {
    const r = await scegliContatto(app, archivio, { titolo: 'Di chi è questa firma?', messaggio: 'Scegli «Io» oppure la persona della rubrica a cui appartiene la firma.', consentiIo: true, testoIo: 'Io: è la mia firma' });
    if (!r) return null;
    return r === 'io' ? 'io' : { id: r.id, nome: nomeContatto(r) };
  };
}

const confermate = new Set(); // firma|documento già confermate in questa sessione
/**
 * Prima di usare la firma di un'altra persona serve una conferma esplicita (una volta per documento e
 * sessione). → true se si può procedere
 */
export async function confermaFirmaAltrui(app, archivio, firma, nomeDoc = 'questo documento') {
  if (!archivio?.altrui(firma)) return true;
  const chiave = firma.id + '|' + nomeDoc;
  if (confermate.has(chiave)) return true;
  const chi = archivio.nomeProprietario(firma);
  const v = await app.ui.dialog({
    title: 'Firma di un\'altra persona',
    message: `Stai per usare ${firma.tipo === 'sigla' ? 'la sigla' : 'la firma'} di ${chi} su «${nomeDoc}».`,
    fields: [
      { name: 'info', type: 'info', text: `Usala solo se ${chi} ti ha autorizzato per questo documento. Leggio annota l'uso nel registro locale (quale firma, quale documento, quando): lo trovi in «Archivio personale» → «Registro delle firme».` },
      { name: 'ok', type: 'checkbox', label: `Confermo di essere autorizzato/a da ${chi}`, value: false },
    ],
    okLabel: 'Usa la firma',
    validate: (x) => (x.ok ? null : 'Per continuare spunta la conferma.'),
  });
  if (!v) return false;
  confermate.add(chiave);
  return true;
}

/** Annota nel registro le firme altrui scritte in un documento. items: elementi con firmaRef e pageIndex */
export function registraUsi(archivio, items, nomeDoc, azione = 'inserita') {
  if (!archivio) return;
  const perFirma = new Map();
  for (const it of items) {
    if (!it.firmaRef || !archivio.altrui(it.firmaRef)) continue;
    const e = perFirma.get(it.firmaRef.id) || { firma: it.firmaRef, pagine: new Set() };
    e.pagine.add(it.pageIndex + 1); perFirma.set(it.firmaRef.id, e);
  }
  for (const { firma, pagine } of perFirma.values()) {
    const p = [...pagine].sort((a, b) => a - b);
    archivio.registra({ firma, documento: nomeDoc, pagine: p.length > 12 ? `${p.length} pagine` : p.join(', '), azione });
  }
}

export { nomeContatto };
