// «Pronta per il pagamento»: controlli sulla fattura che l'ufficio fa a mano prima di pagare, con i
// documenti già in archivio. Leggio NON decide e non paga: segnala. Logica pura.
//  - DURC valido alla data di pagamento prevista (non solo a oggi);
//  - IBAN della fattura uguale a quello dichiarato per la tracciabilità (L. 136/2010), se la dichiarazione c'è;
//  - giorni rimasti ai 30 giorni dell'indicatore di tempestività dei pagamenti (PCC): se in fattura non c'è
//    la scadenza, si contano dalla ricezione (fonti in docs/aree/archivio.md; da verificare).
// Fonti: ricerca-ufficio-cnr.md (PCC/ITP: IFEL; DURC: DM 30/1/2015; SdI: manuale CNR fatturazione elettronica).
import { aggiungiGiorni, giorniTra, oggiIso } from './testo.js';

export const GIORNI_PCC = 30;
export const GIORNI_SDI = 15;

const isoDaMs = (ms) => { if (!Number.isFinite(ms) || ms <= 0) return ''; const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

/** Data di ricezione: quella registrata, altrimenti la data del file (stima: va detto). → { data, stimata } */
export function dataRicezione(r) {
  if (r.ricezione) return { data: r.ricezione, stimata: false };
  const file = isoDaMs(r.mtime);
  // un file copiato molto dopo la data della fattura (archivio riordinato, copia da backup) non dice quando è
  // arrivata: allora si usa la data della fattura (stima prudente: il termine risulta prima, non dopo)
  if (r.data && (!file || file > aggiungiGiorni(r.data, 30) || file < r.data)) return { data: r.data, stimata: true };
  return { data: file, stimata: true };
}

/** Pagamento previsto: la scadenza scritta in fattura, altrimenti ricezione + 30 giorni (PCC). */
export function pagamentoPrevisto(r) {
  const ric = dataRicezione(r);
  const pcc = ric.data ? aggiungiGiorni(ric.data, GIORNI_PCC) : '';
  return { data: r.scadenza || pcc, fonte: r.scadenza ? 'fattura' : 'pcc', scadenzaPcc: r.scadenza && pcc ? (r.scadenza < pcc ? r.scadenza : pcc) : pcc, ricezione: ric };
}

/** Indici per fornitore (P.IVA): DURC con il periodo di validità e IBAN dichiarati per la tracciabilità. */
export function indiciFornitori(records, { durataDurc = 120 } = {}) {
  const durc = new Map(); const tracciabilita = new Map(); const ibanFatture = new Map();
  for (const r of records) {
    if (!r.piva) continue;
    if (r.tipo === 'durc') {
      const inizio = r.data || ''; const fine = r.scadenza || (r.data ? aggiungiGiorni(r.data, durataDurc) : '');
      if (!fine) continue;
      if (!durc.has(r.piva)) durc.set(r.piva, []);
      durc.get(r.piva).push({ id: r.id, nome: r.nome, inizio, fine, calcolata: !r.scadenza });
    } else if (r.tipo === 'fattura' && r.iban) {
      if (!ibanFatture.has(r.piva)) ibanFatture.set(r.piva, []);
      ibanFatture.get(r.piva).push({ id: r.id, path: r.path, nome: r.nome, iban: r.iban, data: r.data || '', numero: r.numero || '' });
    } else if (r.tipo === 'tracciabilita' && r.iban) {
      if (!tracciabilita.has(r.piva)) tracciabilita.set(r.piva, []);
      tracciabilita.get(r.piva).push({ id: r.id, path: r.path, nome: r.nome, iban: r.iban, data: r.data || '' });
    }
  }
  for (const l of durc.values()) l.sort((a, b) => b.fine.localeCompare(a.fine));
  for (const l of tracciabilita.values()) l.sort((a, b) => (b.data || '').localeCompare(a.data || ''));
  for (const l of ibanFatture.values()) l.sort((a, b) => (b.data || '').localeCompare(a.data || ''));
  return { durc, tracciabilita, ibanFatture };
}

/**
 * IBAN noti di un fornitore, dalle fatture e dalle dichiarazioni di tracciabilità indicizzate (i più recenti prima).
 * → [{ iban, data (ultima volta), dal (prima volta), fonte, documenti }]
 */
export function ibanNoti(indici, piva) {
  const m = new Map();
  const add = (iban, data, fonte) => {
    const x = m.get(iban) || { iban, data: '', dal: '', fonte: '', documenti: 0 };
    x.documenti++;
    if (data && (!x.data || data > x.data)) { x.data = data; x.fonte = fonte; }
    if (!x.fonte) x.fonte = fonte;
    if (data && (!x.dal || data < x.dal)) x.dal = data;
    m.set(iban, x);
  };
  for (const t of indici.tracciabilita.get(piva) || []) add(t.iban, t.data, `dichiarazione di tracciabilità (${t.nome})`);
  for (const f of indici.ibanFatture.get(piva) || []) add(f.iban, f.data, `fattura${f.numero ? ' n. ' + f.numero : ''} (${f.nome})`);
  return [...m.values()].sort((a, b) => (b.data || '').localeCompare(a.data || ''));
}

/**
 * Ogni IBAN visto per il fornitore, documento per documento (per l'area avanzati: «IBAN cambiato»).
 * escludiId: il documento corrente. → [{ iban, data, fonte, path }] dal più recente
 */
export function ibanFornitore(indici, piva, escludiId = null) {
  const out = [];
  for (const t of indici.tracciabilita.get(piva) || []) if (t.id !== escludiId) out.push({ iban: t.iban, data: t.data, fonte: 'dichiarazione di tracciabilità', path: t.path });
  for (const f of indici.ibanFatture.get(piva) || []) if (f.id !== escludiId) out.push({ iban: f.iban, data: f.data, fonte: `fattura${f.numero ? ' n. ' + f.numero : ''}`, path: f.path });
  return out.sort((a, b) => (b.data || '').localeCompare(a.data || ''));
}

/** IBAN della fattura diverso da quello delle fatture PRECEDENTI dello stesso fornitore? → { prima, data } | null */
export function ibanCambiato(r, indici) {
  if (!r.iban || !r.piva) return null;
  const prec = (indici.ibanFatture.get(r.piva) || []).filter((f) => f.id !== r.id && f.data && r.data && f.data < r.data);
  if (!prec.length) return null;
  const ultima = prec[0]; // la più recente prima di questa
  return ultima.iban !== r.iban ? { prima: ultima.iban, data: ultima.data, nome: ultima.nome, id: ultima.id } : null;
}

const coda = (iban) => (iban ? '…' + String(iban).slice(-4) : '');

/**
 * Semaforo per una fattura. stato: stato d'ufficio effettivo; indici da indiciFornitori.
 * → null (non è una fattura) | { esito: 'verde'|'giallo'|'rosso'|'pagata', motivi: [{ livello, testo }], previsto, giorniPcc }
 */
export function prontaPerPagamento(r, stato, indici, { oggi = oggiIso() } = {}) {
  if (r.tipo !== 'fattura') return null;
  if (stato?.pagamento === 'fatto') return { esito: 'pagata', motivi: [], previsto: null, giorniPcc: null };
  if (stato?.archiviato) return null;
  const motivi = [];
  const prev = pagamentoPrevisto(r);
  // fatture vecchie senza stato (probabilmente già pagate fuori da Leggio): nessun semaforo, per non confondere.
  // Il semaforo vale per quelle «da pagare» e per quelle con il pagamento previsto da poco o in arrivo.
  if (stato?.pagamento !== 'da' && prev.data && giorniTra(oggi, prev.data) < -30) return null;
  const giorniPcc = prev.scadenzaPcc ? giorniTra(oggi, prev.scadenzaPcc) : null;
  // DURC alla data del pagamento previsto (se il pagamento previsto è già passato, a oggi)
  const alla = prev.data && prev.data > oggi ? prev.data : oggi;
  const dl = r.piva ? indici.durc.get(r.piva) || [] : [];
  if (!r.piva) motivi.push({ livello: 'giallo', testo: 'P.IVA del fornitore non riconosciuta: DURC e tracciabilità non controllabili.' });
  else if (!dl.length) motivi.push({ livello: 'giallo', testo: 'Nessun DURC di questo fornitore in archivio.' });
  else {
    const valido = dl.find((d) => (!d.inizio || d.inizio <= alla) && d.fine >= alla);
    if (valido) motivi.push({ livello: 'ok', testo: `DURC valido fino al ${it(valido.fine)}${valido.calcolata ? ' (calcolata)' : ''}.`, id: valido.id });
    else motivi.push({ livello: 'rosso', testo: `Il DURC più recente scade il ${it(dl[0].fine)}, prima del pagamento previsto (${it(alla)}).`, id: dl[0].id });
  }
  // IBAN: solo se c'è una dichiarazione di tracciabilità del fornitore
  const tl = r.piva ? indici.tracciabilita.get(r.piva) || [] : [];
  if (tl.length && r.iban) {
    const uguale = tl.find((t) => t.iban === r.iban);
    if (uguale) motivi.push({ livello: 'ok', testo: `IBAN uguale a quello dichiarato per la tracciabilità (${coda(r.iban)}).`, id: uguale.id });
    else motivi.push({ livello: 'rosso', testo: `L'IBAN della fattura (${coda(r.iban)}) non è quello dichiarato per la tracciabilità (${tl.map((t) => coda(t.iban)).join(', ')}).`, id: tl[0].id });
  } else if (tl.length && !r.iban) motivi.push({ livello: 'giallo', testo: 'Nella fattura non c\'è l\'IBAN da confrontare con la dichiarazione di tracciabilità.' });
  // IBAN cambiato rispetto alle fatture precedenti dello stesso fornitore
  const cambio = ibanCambiato(r, indici);
  if (cambio) motivi.push({ livello: 'giallo', testo: `IBAN cambiato rispetto alla fattura precedente del ${it(cambio.data)} (${coda(cambio.prima)} → ${coda(r.iban)}): verifica con il fornitore.`, id: cambio.id });
  // 30 giorni (indicatore di tempestività dei pagamenti)
  if (giorniPcc != null) {
    const stima = prev.ricezione.stimata && prev.fonte === 'pcc' ? ' (dalla data del file: ricezione stimata)' : '';
    if (giorniPcc < 0) motivi.push({ livello: 'giallo', testo: `Termine di pagamento superato da ${-giorniPcc} giorni${stima}.` });
    else if (giorniPcc <= 7) motivi.push({ livello: 'giallo', testo: `Restano ${giorniPcc} giorni al termine di pagamento (${it(prev.scadenzaPcc)})${stima}.` });
    else motivi.push({ livello: 'ok', testo: `Termine di pagamento: ${it(prev.scadenzaPcc)} (tra ${giorniPcc} giorni)${stima}.` });
  }
  const esito = motivi.some((m) => m.livello === 'rosso') ? 'rosso' : motivi.some((m) => m.livello === 'giallo') ? 'giallo' : 'verde';
  return { esito, motivi, previsto: prev.data, giorniPcc };
}

function it(iso) { const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[3]}/${m[2]}/${m[1]}` : iso; }

/** Giorni rimasti per l'esito SdI (15 giorni dalla ricezione; poi decorrenza termini). Solo fatture XML. */
export function giorniSdi(r, oggi = oggiIso(), giorni = GIORNI_SDI) {
  if (r.tipo !== 'fattura' && r.tipo !== 'nota-credito') return null;
  if (r.contenuto !== 'fattura') return null; // solo fatture elettroniche (XML, anche .p7m)
  const ric = dataRicezione(r);
  if (!ric.data) return null;
  const fine = aggiungiGiorni(ric.data, giorni);
  return { fine, giorni: giorniTra(oggi, fine), stimata: ric.stimata };
}
