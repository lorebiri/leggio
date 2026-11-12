// Scadenzario e «Oggi»: DURC in scadenza o scaduti, fatture da pagare, documenti da protocollare
// o da firmare, documenti nuovi dall'ultima apertura. Logica pura.
import { aggiungiGiorni, giorniTra, oggiIso, normalizza } from './testo.js';
import { conSegnatura } from './stati.js';

/**
 * Impostazioni predefinite. La durata del DURC va verificata sulla normativa vigente
 * (oggi 120 giorni dalla richiesta per il DURC online: D.M. 30/01/2015): per questo è un'impostazione.
 */
export const IMPOSTAZIONI_PREDEFINITE = {
  durataDurc: 120, // giorni di validità, usati solo se nel DURC non c'è la data di scadenza
  preavvisoDurc: 15, // giorni prima della scadenza in cui avvisare
  preavvisoFatture: 15, // fatture in scadenza proposte in «Oggi» (e evidenziate tra quelle da pagare)
  scaduteDaProporre: 30, // fatture già scadute, non segnate come pagate, proposte fino a quanti giorni dopo
};

/** Scadenza del DURC: quella scritta nel documento o, in mancanza, data + durata. */
export function scadenzaDurc(r, durata = IMPOSTAZIONI_PREDEFINITE.durataDurc) {
  if (r.scadenza) return { scadenza: r.scadenza, calcolata: false };
  if (r.data) return { scadenza: aggiungiGiorni(r.data, durata), calcolata: true };
  return { scadenza: '', calcolata: false };
}

/**
 * Calcola il riepilogo di «Oggi».
 * opts: { records: [{ id, nome, tipo, fornitore, piva, data, scadenza, impronta, aggiunto }],
 *         stati: Map impronta → stato, impostazioni, ultimaApertura (ms), oggi (ISO), max }
 */
export function riepilogoOggi({ records, stati, impostazioni = {}, ultimaApertura = 0, oggi = oggiIso(), max = 200 }) {
  const imp = { ...IMPOSTAZIONI_PREDEFINITE, ...impostazioni };
  // la segnatura letta dal documento vale «protocollato»: non resta tra i promemoria
  const st = (r) => conSegnatura(stati && r.impronta ? stati.get(r.impronta) : null, r.segnatura);

  // DURC: per ogni fornitore conta solo il più recente (un DURC nuovo «copre» quelli vecchi)
  const durcPerFornitore = new Map();
  for (const r of records) {
    if (r.tipo !== 'durc') continue;
    const s = st(r);
    if (s?.archiviato) continue;
    const { scadenza, calcolata } = scadenzaDurc(r, imp.durataDurc);
    if (!scadenza) continue;
    const chiave = r.piva || normalizza(r.fornitore || '').replace(/[^a-z0-9]+/g, ' ').trim() || r.id;
    const cur = durcPerFornitore.get(chiave);
    if (!cur || scadenza > cur.scadenza) durcPerFornitore.set(chiave, { r, scadenza, calcolata });
  }
  const durc = [];
  for (const { r, scadenza, calcolata } of durcPerFornitore.values()) {
    const giorni = giorniTra(oggi, scadenza);
    if (giorni == null || giorni > imp.preavvisoDurc) continue;
    durc.push({ id: r.id, nome: r.nome, fornitore: r.fornitore, scadenza, calcolata, giorni, scaduto: giorni < 0 });
  }
  durc.sort((a, b) => a.scadenza.localeCompare(b.scadenza));

  const fatture = []; const inScadenza = []; const daProtocollare = []; const daFirmare = []; const nuovi = [];
  for (const r of records) {
    const s = st(r);
    if (s?.pagamento === 'da' && !s.archiviato) {
      const giorni = r.scadenza ? giorniTra(oggi, r.scadenza) : null;
      fatture.push({ id: r.id, nome: r.nome, fornitore: r.fornitore, importo: r.importo ?? null, scadenza: r.scadenza || '', giorni, scaduto: giorni != null && giorni < 0, vicina: giorni != null && giorni <= imp.preavvisoFatture });
    }
    // proposte dai dati della fattura (DataScadenzaPagamento nell'XML, scadenza letta nel PDF),
    // anche se nessuno le ha ancora segnate «da pagare»
    if (r.tipo === 'fattura' && r.scadenza && !s?.pagamento && !s?.archiviato) {
      const giorni = giorniTra(oggi, r.scadenza);
      if (giorni != null && giorni <= imp.preavvisoFatture && giorni >= -imp.scaduteDaProporre) inScadenza.push({ id: r.id, nome: r.nome, fornitore: r.fornitore, importo: r.importo ?? null, scadenza: r.scadenza, giorni, scaduto: giorni < 0 });
    }
    if (s?.protocollo === 'da' && !s.archiviato) daProtocollare.push({ id: r.id, nome: r.nome, fornitore: r.fornitore, data: r.data });
    if (s?.firma === 'da' && !s.archiviato) daFirmare.push({ id: r.id, nome: r.nome, fornitore: r.fornitore, data: r.data });
    if (ultimaApertura && r.aggiunto > ultimaApertura) nuovi.push({ id: r.id, nome: r.nome, tipo: r.tipo, fornitore: r.fornitore, aggiunto: r.aggiunto });
  }
  // prima le scadute, poi per scadenza (quelle senza scadenza in fondo)
  fatture.sort((a, b) => (a.scadenza ? 0 : 1) - (b.scadenza ? 0 : 1) || a.scadenza.localeCompare(b.scadenza));
  inScadenza.sort((a, b) => a.scadenza.localeCompare(b.scadenza));
  daProtocollare.sort((a, b) => (a.data || '').localeCompare(b.data || ''));
  daFirmare.sort((a, b) => (a.data || '').localeCompare(b.data || ''));
  nuovi.sort((a, b) => b.aggiunto - a.aggiunto);
  return {
    conteggi: {
      durcScaduti: durc.filter((d) => d.scaduto).length, durcInScadenza: durc.filter((d) => !d.scaduto).length,
      fatture: fatture.length, fattureScadute: fatture.filter((f) => f.scaduto).length, inScadenza: inScadenza.length,
      daProtocollare: daProtocollare.length, daFirmare: daFirmare.length, nuovi: nuovi.length,
    },
    durc: durc.slice(0, max), fatture: fatture.slice(0, max), inScadenza: inScadenza.slice(0, max), daProtocollare: daProtocollare.slice(0, max), daFirmare: daFirmare.slice(0, max), nuovi: nuovi.slice(0, max),
  };
}

/** Testo breve per una scadenza: «scaduto da 3 giorni», «scade oggi», «scade tra 5 giorni». */
export function testoGiorni(giorni, { maschile = true } = {}) {
  if (giorni == null) return '';
  const o = maschile ? 'o' : 'a';
  if (giorni < -1) return `scadut${o} da ${-giorni} giorni`;
  if (giorni === -1) return `scadut${o} ieri`;
  if (giorni === 0) return 'scade oggi';
  if (giorni === 1) return 'scade domani';
  return `scade tra ${giorni} giorni`;
}
