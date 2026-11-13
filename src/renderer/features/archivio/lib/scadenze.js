// Scadenzario e «Oggi»: DURC in scadenza o scaduti, fatture da pagare, documenti da protocollare
// o da firmare, documenti nuovi dall'ultima apertura. Logica pura.
import { aggiungiGiorni, giorniTra, oggiIso, normalizza } from './testo.js';
import { conSegnatura } from './stati.js';
import { pagamentoPrevisto, giorniSdi } from './pagamento.js';
import { numeroConfrontabile } from './segnatura.js';

/**
 * Impostazioni predefinite. La durata del DURC va verificata sulla normativa vigente
 * (oggi 120 giorni dalla richiesta per il DURC online: D.M. 30/01/2015): per questo è un'impostazione.
 */
export const IMPOSTAZIONI_PREDEFINITE = {
  durataDurc: 120, // giorni di validità, usati solo se nel DURC non c'è la data di scadenza
  preavvisoDurc: 15, // giorni prima della scadenza in cui avvisare
  preavvisoFatture: 15, // pagamenti in scadenza proposti in «Oggi» (scadenza in fattura o 30 giorni PCC)
  avvisoSdi: 5, // fatture elettroniche: avvisa quando mancano N giorni ai 15 per l'esito SdI
  giorniNonProtocollati: 3, // documenti arrivati da più di N giorni senza protocollo
  mesiPubblicazione: 3, // incarichi: pubblicare entro 3 mesi dal conferimento (art. 15 d.lgs. 33/2013, da verificare)
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
export function riepilogoOggi({ records, stati, impostazioni = {}, ultimaApertura = 0, inizioArchivio = 0, oggi = oggiIso(), max = 200 }) {
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

  const fatture = []; const inScadenza = []; const sdi = []; const nonProtocollati = []; const pubblicazioni = []; const perProtocollo = new Map(); const daProtocollare = []; const daFirmare = []; const nuovi = [];
  for (const r of records) {
    const s = st(r);
    if (s?.pagamento === 'da' && !s.archiviato) {
      const giorni = r.scadenza ? giorniTra(oggi, r.scadenza) : null;
      fatture.push({ id: r.id, nome: r.nome, fornitore: r.fornitore, importo: r.importo ?? null, scadenza: r.scadenza || '', giorni, scaduto: giorni != null && giorni < 0, vicina: giorni != null && giorni <= imp.preavvisoFatture });
    }
    // pagamenti in scadenza: dalla scadenza in fattura (DataScadenzaPagamento o letta nel PDF) o, se manca,
    // dai 30 giorni dalla ricezione (PCC); anche se nessuno ha ancora segnato la fattura «da pagare»
    if (r.tipo === 'fattura' && !s?.pagamento && !s?.archiviato) {
      const p = pagamentoPrevisto(r);
      const giorni = p.data ? giorniTra(oggi, p.data) : null;
      if (giorni != null && giorni <= imp.preavvisoFatture && giorni >= -imp.scaduteDaProporre) inScadenza.push({ id: r.id, nome: r.nome, fornitore: r.fornitore, importo: r.importo ?? null, scadenza: p.data, fonte: p.fonte, stimata: p.fonte === 'pcc' && p.ricezione.stimata, giorni, scaduto: giorni < 0 });
    }
    // fatture elettroniche: 15 giorni dalla ricezione per accettare o rifiutare (poi decorrenza termini)
    if (!s && !r.segnatura?.numero) {
      const g = giorniSdi(r, oggi, imp.giorniSdi || 15);
      if (g && g.giorni >= 0 && g.giorni <= imp.avvisoSdi) sdi.push({ id: r.id, nome: r.nome, fornitore: r.fornitore, fine: g.fine, giorni: g.giorni, stimata: g.stimata });
    }
    // arrivati e non protocollati: entrati DOPO la prima indicizzazione, da più di N giorni, senza segnatura né stato
    if (inizioArchivio && r.aggiunto > inizioArchivio && !s?.protocollo && !/(^|[\\/])(Elaborati|Rinominati)([\\/]|$)/i.test(r.rel || '')
      && ['fattura', 'nota-credito', 'pec', 'p7m', 'contratto', 'ordine', 'durc', 'incarico', 'tracciabilita'].includes(r.tipo)) {
      const giorni = Math.floor((Date.parse(oggi + 'T23:59:59') - r.aggiunto) / 86400000);
      if (giorni >= imp.giorniNonProtocollati) nonProtocollati.push({ id: r.id, nome: r.nome, fornitore: r.fornitore, giorni });
    }
    // trasparenza: incarichi e assegni «da pubblicare» entro N mesi dal conferimento (data del documento)
    if (s?.pubblicato === 'da' && !s.archiviato) {
      const entro = r.data ? aggiungiMesi(r.data, imp.mesiPubblicazione) : '';
      const fine = r.dataFine ? aggiungiMesi(r.dataFine, 36) : '';
      pubblicazioni.push({ id: r.id, nome: r.nome, fornitore: r.fornitore, entro, giorni: entro ? giorniTra(oggi, entro) : null, finoAl: fine });
    }
    // anomalie: stesso numero di protocollo letto o scritto su documenti diversi (contenuto diverso)
    if (s?.protocollo === 'fatto' && s.numeroProtocollo && !/(^|[\\/])(Elaborati|Rinominati)([\\/]|$)/i.test(r.rel || '')) {
      const k = `${numeroConfrontabile(s.numeroProtocollo)}|${(s.dataProtocollo || '').slice(0, 4)}`;
      if (!perProtocollo.has(k)) perProtocollo.set(k, []);
      perProtocollo.get(k).push({ id: r.id, nome: r.nome, impronta: r.impronta, numero: s.numeroProtocollo, data: s.dataProtocollo || '' });
    }
    if (s?.protocollo === 'da' && !s.archiviato) daProtocollare.push({ id: r.id, nome: r.nome, fornitore: r.fornitore, data: r.data });
    if (s?.firma === 'da' && !s.archiviato) daFirmare.push({ id: r.id, nome: r.nome, fornitore: r.fornitore, data: r.data });
    if (ultimaApertura && r.aggiunto > ultimaApertura) nuovi.push({ id: r.id, nome: r.nome, tipo: r.tipo, fornitore: r.fornitore, aggiunto: r.aggiunto });
  }
  // prima le scadute, poi per scadenza (quelle senza scadenza in fondo)
  fatture.sort((a, b) => (a.scadenza ? 0 : 1) - (b.scadenza ? 0 : 1) || a.scadenza.localeCompare(b.scadenza));
  inScadenza.sort((a, b) => a.scadenza.localeCompare(b.scadenza));
  sdi.sort((a, b) => a.giorni - b.giorni);
  nonProtocollati.sort((a, b) => b.giorni - a.giorni);
  pubblicazioni.sort((a, b) => (a.entro || '9').localeCompare(b.entro || '9'));
  const anomalie = [];
  for (const l of perProtocollo.values()) {
    const impronte = new Set(l.map((x) => x.impronta));
    if (impronte.size > 1) anomalie.push({ numero: l[0].numero, data: l[0].data, documenti: l.slice(0, 10), id: l[0].id, nome: l.map((x) => x.nome).slice(0, 3).join(', ') });
  }
  daProtocollare.sort((a, b) => (a.data || '').localeCompare(b.data || ''));
  daFirmare.sort((a, b) => (a.data || '').localeCompare(b.data || ''));
  nuovi.sort((a, b) => b.aggiunto - a.aggiunto);
  return {
    conteggi: {
      durcScaduti: durc.filter((d) => d.scaduto).length, durcInScadenza: durc.filter((d) => !d.scaduto).length,
      fatture: fatture.length, fattureScadute: fatture.filter((f) => f.scaduto).length, inScadenza: inScadenza.length, sdi: sdi.length, nonProtocollati: nonProtocollati.length, pubblicazioni: pubblicazioni.length, anomalie: anomalie.length,
      daProtocollare: daProtocollare.length, daFirmare: daFirmare.length, nuovi: nuovi.length,
    },
    durc: durc.slice(0, max), fatture: fatture.slice(0, max), inScadenza: inScadenza.slice(0, max), sdi: sdi.slice(0, max), nonProtocollati: nonProtocollati.slice(0, max), pubblicazioni: pubblicazioni.slice(0, max), anomalie: anomalie.slice(0, max), daProtocollare: daProtocollare.slice(0, max), daFirmare: daFirmare.slice(0, max), nuovi: nuovi.slice(0, max),
  };
}

/** Quante «cose da fare» ci sono in Oggi (per il link nella schermata iniziale e nel pannello). */
export function contaDaFare(o) {
  const c = o?.conteggi || {};
  return (c.anomalie || 0) + (c.sdi || 0) + (c.inScadenza || 0) + (c.fatture || 0) + (o?.durc?.length || 0)
    + (c.daProtocollare || 0) + (c.nonProtocollati || 0) + (c.daFirmare || 0) + (c.pubblicazioni || 0);
}

/** ISO + n mesi (fine mese gestita: 31/01 + 1 mese = 28 o 29/02). */
export function aggiungiMesi(iso, n) {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return '';
  const y = +m[1]; const mo = +m[2] - 1 + n; const d = +m[3];
  const anno = y + Math.floor(mo / 12); const mese = ((mo % 12) + 12) % 12;
  const ultimo = new Date(Date.UTC(anno, mese + 1, 0)).getUTCDate();
  return `${anno}-${String(mese + 1).padStart(2, '0')}-${String(Math.min(d, ultimo)).padStart(2, '0')}`;
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
