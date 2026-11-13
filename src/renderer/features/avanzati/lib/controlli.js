// Controlli sul documento aperto (riquadro «Controlli»): FatturaPA, ordini e determine (anche MePA), contratti (bollo),
// dati da copiare per Titulus e U-GOV. Logica pura. Leggio SEGNALA soltanto: non rifiuta fatture e non decide esiti.
// Le regole che cambiano nel tempo stanno in dati/regole-ufficio.json (fonte e data per ciascuna).
import REGOLE_PREDEFINITE from '../dati/regole-ufficio.json';
import { estraiDati, importo as leggiImporto } from './datichiave.js';
import { trovaDate } from './rinomina.js';

/** Regole effettive: predefinite + aggiornamenti caricati dall'ufficio (stessa struttura, voce per voce). */
export function regole(aggiornamento) {
  const r = structuredClone(REGOLE_PREDEFINITE);
  if (aggiornamento && typeof aggiornamento === 'object') for (const [k, v] of Object.entries(aggiornamento)) if (v && typeof v === 'object' && !Array.isArray(v) && k in r) r[k] = { ...r[k], ...v };
  if (aggiornamento?.versione) r.versione = String(aggiornamento.versione);
  return r;
}
/** Controlla un file di regole caricato dall'ufficio. → messaggio d'errore o null */
export function validaRegole(x) {
  if (!x || typeof x !== 'object') return 'Il file non contiene regole.';
  const f = x.bolloContratti?.fasce;
  if (f && (!Array.isArray(f) || f.some((y) => typeof y.importo !== 'number'))) return 'La tabella del bollo sui contratti non è valida.';
  if (x.sdi && x.sdi.giorniEsito != null && !(x.sdi.giorniEsito > 0)) return 'I giorni per accettare o rifiutare non sono validi.';
  return null;
}

const giorno = 86400000;
const isoOggi = (d) => new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())).toISOString().slice(0, 10);
const euro = (v) => Number(v).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: 'always' }) + ' €';
const dataIt = (iso) => (iso ? iso.split('-').reverse().join('/') : '');

/**
 * Avviso: { id, livello: 'avviso'|'info', testo (breve), aiuto (fonte), azione?: { tipo, etichetta, … } }
 * Il riquadro mostra solo gli avvisi; nessun avviso = tutto a posto.
 */

// ---------------------------------------------------------------- FatturaPA
/**
 * f: fattura (parseFattura). o: { oggi: Date, dataRicezione: 'aaaa-mm-gg' | null, fonteRicezione: 'metadati'|'indicata'|'stima',
 *   cupDovuto: bool (progetto d'investimento, CUP nell'ordine o nella pratica, o regola dell'ufficio), ibanNoti: [{ iban, numero, data }],
 *   regole }. Senza data di ricezione non si dice nulla sui 15 giorni (niente richieste ripetute).
 */
export function controlliFattura(f, { oggi = new Date(), dataRicezione = null, fonteRicezione = 'indicata', cupDovuto = false, ibanNoti = [], regole: R = regole() } = {}) {
  const out = [];
  const add = (x) => out.push({ livello: 'avviso', ...x });
  // 15 giorni dalla consegna SdI per accettare o rifiutare
  const gg = R.sdi.giorniEsito;
  if (dataRicezione) {
    const scad = new Date(Date.parse(dataRicezione) + gg * giorno).toISOString().slice(0, 10);
    const rimasti = Math.round((Date.parse(scad) - Date.parse(isoOggi(oggi))) / giorno);
    const stima = fonteRicezione === 'stima' ? ' Data stimata dal file: correggila se serve.' : '';
    const az = { tipo: 'data-ricezione', etichetta: 'Correggi la data', valore: dataRicezione };
    if (rimasti < 0) { if (rimasti >= -30) add({ id: 'sdi-scaduto', livello: 'info', testo: `Termine per rifiutare scaduto il ${dataIt(scad)}: la fattura si considera accettata.${stima}`, aiuto: R.sdi.fonte, azione: az }); }
    else add({ id: 'sdi-giorni', livello: rimasti <= 5 ? 'avviso' : 'info', testo: (rimasti === 0 ? 'Oggi è l\'ultimo giorno per accettare o rifiutare (in U-GOV).' : `Restano ${rimasti} giorni per accettare o rifiutare (fino al ${dataIt(scad)}).`) + stima, aiuto: R.sdi.fonte, azione: az });
  }
  f.corpi.forEach((c, i) => {
    const qual = f.corpi.length > 1 ? ` (documento ${i + 1}: n. ${c.numero})` : '';
    // CIG / CUP
    const cigErr = c.cig.filter((x) => !/^[A-Z0-9]{10}$/.test(x));
    if (!c.cig.length) add({ id: 'cig-mancante', testo: `Manca il CIG${qual}. È tra le cause di rifiuto ammesse, salvo i casi esclusi dalla tracciabilità.`, aiuto: R.cigCup.fonte, azione: { tipo: 'copia', etichetta: 'Copia il motivo', valore: 'Fattura priva del CIG (art. 25 DL 66/2014; causa di rifiuto ai sensi del DM 132/2020)' } });
    else if (cigErr.length) add({ id: 'cig-formato', testo: `CIG non valido: ${cigErr.join(', ')}${qual}. Deve avere 10 caratteri.`, aiuto: R.cigCup.fonte });
    if (!c.cup.length) { if (cupDovuto) add({ id: 'cup-mancante', testo: `Manca il CUP${qual}, che questo acquisto richiede. È tra le cause di rifiuto ammesse.`, aiuto: R.cigCup.fonte }); }
    else if (c.cup.some((x) => !/^[A-Z]\d{2}[A-Z][0-9A-Z]{11}$/.test(x))) add({ id: 'cup-formato', testo: `CUP non valido${qual}: deve avere 15 caratteri.`, aiuto: R.cigCup.fonte });
    // IBAN diverso da quello delle fatture precedenti dello stesso fornitore
    const iban = c.pagamenti.flatMap((p) => p.dettagli.map((d) => d.iban)).find(Boolean);
    const noti = [...new Set((ibanNoti || []).map((x) => String(x.iban || '').replace(/\s+/g, '').toUpperCase()).filter(Boolean))];
    if (i === 0 && iban && noti.length && !noti.includes(iban.toUpperCase())) add({ id: 'iban-cambiato', testo: `IBAN diverso da quello delle fatture precedenti di questo fornitore (${noti[0].slice(0, 4)}…${noti[0].slice(-4)}). Verifica il conto dedicato prima di pagare.`, aiuto: 'L. 136/2010 art. 3 (tracciabilità: conto dedicato dichiarato dal fornitore). Confronto con le fatture già in archivio.', azione: { tipo: 'copia', etichetta: 'Copia i due IBAN', valore: `IBAN in fattura: ${iban}\nIBAN precedente: ${noti.join(', ')}` } });
    // nota di credito senza fattura collegata
    if (c.tipo === 'TD04' && !c.riferimenti.some((r) => r.tipo === 'DatiFattureCollegate' && r.idDocumento)) add({ id: 'nc-senza-fattura', testo: `Nota di credito senza la fattura collegata${qual}. Chiedi al fornitore il riferimento.`, aiuto: 'Manuale CNR fatturazione elettronica: le note di credito vanno abbinate alla fattura che rettificano.', azione: { tipo: 'cerca', etichetta: 'Cerca la fattura del fornitore', valore: f.cedente?.partitaIva || f.cedente?.nome } });
    // split payment con ritenuta
    if (c.calcoli.split && c.ritenute.some((r) => r.tipo === 'RT01' || r.tipo === 'RT02' || r.importo)) add({ id: 'split-ritenuta', testo: `Scissione dei pagamenti insieme a una ritenuta d'acconto${qual}: di solito non va applicata ai compensi con ritenuta.`, aiuto: R.splitPayment.fonte });
    // fornitore estero con split
    if (c.calcoli.split && f.cedente?.partitaIva && !/^IT/i.test(f.cedente.partitaIva)) add({ id: 'split-estero', testo: `Fornitore estero con scissione dei pagamenti${qual}: controlla il trattamento IVA.`, aiuto: R.splitPayment.fonte });
    // bollo mancante sulle fatture esenti
    const esente = c.riepilogo.filter((r) => r.natura && R.bolloFatture.nature.includes(r.natura)).reduce((s, r) => s + (r.imponibile || 0), 0);
    if (esente > R.bolloFatture.soglia && !(c.bollo && (c.bollo.virtuale === 'SI' || c.bollo.importo))) add({ id: 'bollo-mancante', testo: `Manca il bollo: ${euro(esente)} senza IVA superano ${euro(R.bolloFatture.soglia)}${qual}. Chiedi al fornitore una nota di variazione.`, aiuto: R.bolloFatture.fonte });
  });
  return out;
}

/** Data di ricezione SdI dal nome o dal contenuto dei metadati SdI (…_MT_001.xml: <DataOraRicezione>), se c'è. */
export function dataRicezioneDaMetadati(testoXml) {
  const m = String(testoXml || '').match(/<(?:\w+:)?DataOra(?:Ricezione|Consegna)>\s*(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

// ---------------------------------------------------------------- ordini, determine, MePA
/**
 * Riconosce ordini e determine (anche MePA: ordine diretto ODA, trattativa diretta TD, RdO) dal testo.
 * → { tipo, numero, cig, cup, importo, piva, fornitore } | null
 */
export function riconosciOrdine(testo) {
  const t = String(testo || '').replace(/\s+/g, ' ').slice(0, 200000);
  let tipo = null;
  if (/ordine diretto (di acquisto)?|\bODA\b/i.test(t) && /mepa|acquistinretepa|consip|mercato elettronico/i.test(t)) tipo = 'Ordine diretto MePA (ODA)';
  else if (/trattativa diretta/i.test(t)) tipo = 'Trattativa diretta MePA';
  else if (/richiesta di offerta|\bRdO\b/i.test(t) && /mepa|acquistinretepa|consip/i.test(t)) tipo = 'RdO MePA';
  else if (/documento di stipula/i.test(t)) tipo = 'Documento di stipula';
  else if (/determin[ae]\w* (a|di) contrarre|decisione di contrarre|determina(zione)? (di )?affidamento/i.test(t)) tipo = 'Determina';
  else if (/\bbuono d['’]ordine\b|\bordine (di acquisto|n\.?|numero)\b|\bordinativo\b/i.test(t)) tipo = 'Ordine';
  if (!tipo) return null;
  const d = estraiDati(t);
  let numero = '';
  const n = t.match(/(?:numero (?:ordine|trattativa|identificativo (?:dell['’])?ordine|RdO)|n\.\s*(?:ordine|trattativa)|ordine (?:n\.|nr\.?|numero)|trattativa (?:diretta )?(?:n\.|nr\.?|numero)|identificativo (?:univoco )?(?:dell['’])?ordine)\s*:?\s*([A-Z0-9][A-Z0-9/\-_.]{1,24})/i)
    || t.match(/\b(?:determina(?:zione)?|provvedimento|decreto)(?:\s+[a-zà-ù]+){0,3}?\s+(?:n\.|nr\.?|numero)\s*([A-Z0-9][A-Z0-9/\-_.]{0,24})/i);
  if (n) numero = n[1].replace(/[.\-/]+$/, '');
  // importo: totale dell'ordine o importo di aggiudicazione / contrattuale
  let importo = null;
  const im = t.match(/(?:totale (?:ordine|complessivo|imponibile|contratto)|importo (?:totale|complessivo|contrattuale|di aggiudicazione|dell['’]affidamento|offerto)|valore (?:complessivo|dell['’]ordine))[^0-9€]{0,40}(?:€|EUR|euro)?\s*([0-9.\s]{1,15},\d{2}|\d+(?:\.\d{2})?)/i);
  if (im) importo = leggiImporto(im[1]);
  if (importo == null) importo = d.totale;
  let fornitore = '';
  const fo = t.match(/(?:fornitore|operatore economico|ragione sociale|affidatario|ditta)\s*:?\s*([A-Z][A-Za-zÀ-ÿ0-9&'.\- ]{2,60}?)(?=\s+(?:P\.?\s?IVA|C\.?F\.?|codice fiscale|partita|via|sede|con sede|,)|$)/i);
  if (fo) fornitore = fo[1].trim();
  return { tipo, numero, cig: d.cig.map((x) => x.valore), cup: d.cup.map((x) => x.valore), importo, piva: d.piva.map((x) => x.valore), fornitore };
}

/**
 * Abbina una fattura agli ordini/determine noti. ordini: [{ id, nome, tipo, numero, cig[], importo, piva[] }]
 * Criteri: CIG uguale (forte), numero d'ordine citato nella fattura (forte), P.IVA del fornitore (debole).
 * → { abbinati: [{ ordine, motivi[], punteggio }], avvisi: [] }
 */
export function abbinaFatturaOrdini(f, ordini = []) {
  const c = f.corpi[0];
  const piva = String(f.cedente?.partitaIva || '').replace(/^IT/i, '');
  const numeriFattura = c.riferimenti.filter((r) => r.tipo === 'DatiOrdineAcquisto' || r.tipo === 'DatiContratto' || r.tipo === 'DatiConvenzione').map((r) => String(r.idDocumento || '').replace(/\s+/g, '').toUpperCase()).filter(Boolean);
  const abbinati = [];
  for (const o of ordini) {
    const motivi = []; let p = 0;
    if (o.cig?.some((x) => c.cig.includes(x))) { motivi.push('stesso CIG'); p += 3; }
    if (o.numero && numeriFattura.includes(String(o.numero).replace(/\s+/g, '').toUpperCase())) { motivi.push('numero d\'ordine citato in fattura'); p += 3; }
    if (piva && o.piva?.some((x) => String(x).replace(/^IT/i, '') === piva)) { motivi.push('stessa P.IVA'); p += 1; }
    if (p >= 3 || (p >= 1 && motivi.length >= 1 && o.cig?.length === 0 && !o.numero)) abbinati.push({ ordine: o, motivi, punteggio: p });
  }
  abbinati.sort((a, b) => b.punteggio - a.punteggio);
  const avvisi = [];
  const best = abbinati[0];
  const imponibile = f.corpi.reduce((s, x) => s + (x.calcoli.imponibile || 0), 0);
  if (best?.ordine.importo != null && imponibile > best.ordine.importo + 0.01) {
    avvisi.push({ id: 'supera-ordine', livello: 'avviso', testo: `La fattura (${euro(imponibile)} imponibile) supera l'ordinato (${euro(best.ordine.importo)}) di «${best.ordine.nome}».`, aiuto: 'Confronto tra l\'imponibile della fattura e l\'importo dell\'ordine o della determina abbinati.', azione: { tipo: 'apri', etichetta: 'Apri l\'ordine', valore: best.ordine.id } });
  }
  if (!abbinati.length && (c.cig.length || numeriFattura.length)) avvisi.push({ id: 'ordine-non-trovato', livello: 'info', testo: 'Non ho trovato l\'ordine o la determina di questa fattura tra i documenti disponibili.', aiuto: 'Abbinamento per CIG, numero d\'ordine citato in fattura e P.IVA.', azione: { tipo: 'cerca', etichetta: 'Cerca nell\'archivio', valore: c.cig[0] || numeriFattura[0] } });
  return { abbinati, avvisi };
}

// ---------------------------------------------------------------- contratti: imposta di bollo (All. I.4)
export function bolloContratto(importoMassimo, R = regole()) {
  if (!(importoMassimo > 0)) return null;
  const fascia = R.bolloContratti.fasce.find((x) => x.fino == null || importoMassimo < x.fino) || R.bolloContratti.fasce[R.bolloContratti.fasce.length - 1];
  return { importo: fascia.importo, codiceTributo: R.bolloContratti.codiceTributo };
}
/** Riconosce un contratto e il suo importo (massimo) dal testo. → { importo } | null */
export function riconosciContratto(testo) {
  const t = String(testo || '').replace(/\s+/g, ' ').slice(0, 200000);
  if (!/\bcontratto\b|documento di stipula|lettera (d['’])?ordine|scrittura privata/i.test(t)) return null;
  const im = t.match(/(?:importo (?:massimo|contrattuale|complessivo|del contratto)|valore (?:massimo|stimato|del contratto)|corrispettivo (?:complessivo|massimo)?)[^0-9€]{0,40}(?:€|EUR|euro)?\s*([0-9.\s]{1,15},\d{2}|\d+(?:\.\d{2})?)/i);
  return { importo: im ? leggiImporto(im[1]) : null };
}
/** C'è la ricevuta F24 con il codice tributo del bollo tra i testi della pratica? */
export function trovaF24(testi, R = regole()) {
  const cod = R.bolloContratti.codiceTributo;
  return testi.findIndex((t) => /\bF24\b|modello F24|delega di pagamento/i.test(t) && new RegExp(`\\b${cod}\\b`).test(t));
}
export function controlliContratto(testo, { testiPratica = [], regole: R = regole() } = {}) {
  const c = riconosciContratto(testo);
  if (!c) return [];
  const out = [];
  if (c.importo == null) { out.push({ id: 'bollo-importo', livello: 'info', testo: 'Contratto: indica l\'importo massimo per sapere il bollo dovuto.', aiuto: R.bolloContratti.fonte, azione: { tipo: 'importo-contratto', etichetta: 'Indica l\'importo' } }); return out; }
  const b = bolloContratto(c.importo, R);
  if (!b.importo) return out; // sotto la prima soglia: esente
  const f24 = trovaF24([testo, ...testiPratica], R);
  out.push({ id: 'bollo-contratto', livello: f24 >= 0 ? 'info' : 'avviso',
    testo: `Contratto da ${euro(c.importo)}: bollo di ${euro(b.importo)} a carico dell'appaltatore. ${f24 >= 0 ? 'Ricevuta F24 con codice ' + b.codiceTributo + ' trovata.' : 'Manca la ricevuta F24 con codice ' + b.codiceTributo + '.'}`,
    aiuto: R.bolloContratti.fonte, azione: f24 >= 0 ? undefined : { tipo: 'cerca', etichetta: 'Cerca la ricevuta F24', valore: `F24 ${b.codiceTributo}` } });
  return out;
}

// ---------------------------------------------------------------- dati da copiare per U-GOV
/**
 * Campi per la registrazione in U-GOV, nell'ordine della maschera di registrazione della fattura passiva (soggetto,
 * documento, importi, IVA, riferimenti, pagamento). L'ordine esatto dei campi della maschera va confermato con un utente.
 * → [{ chiave, etichetta, valore }]
 */
export function datiPerUgov({ fattura, testo } = {}) {
  const out = [];
  const add = (chiave, etichetta, valore) => { if (valore != null && String(valore).trim() !== '') out.push({ chiave, etichetta, valore: String(valore).trim() }); };
  if (fattura) {
    const f = fattura; const c = f.corpi[0]; const p = c.pagamenti[0]?.dettagli[0] || {};
    add('soggetto', 'Soggetto (fornitore)', f.cedente?.nome);
    add('piva', 'P.IVA / codice fiscale', f.cedente?.partitaIva || f.cedente?.codiceFiscale);
    add('tipo', 'Tipo documento', ({ TD01: 'Fattura', TD04: 'Nota di credito', TD05: 'Nota di debito', TD06: 'Parcella' })[c.tipo] || c.tipo);
    add('numero', 'Numero documento', c.numero);
    add('data', 'Data documento', dataIt(c.data));
    add('descrizione', 'Descrizione', c.causali[0] || c.linee[0]?.descrizione);
    add('imponibile', 'Imponibile', c.calcoli.imponibile.toFixed(2).replace('.', ','));
    add('iva', 'IVA', c.calcoli.imposta.toFixed(2).replace('.', ','));
    add('totale', 'Totale documento', c.calcoli.totale.toFixed(2).replace('.', ','));
    add('esigibilita', 'Esigibilità IVA', c.calcoli.split ? 'Scissione dei pagamenti (S)' : c.riepilogo[0]?.esigibilita === 'D' ? 'Differita (D)' : 'Immediata (I)');
    add('natura', 'Natura IVA (righe senza imposta)', [...new Set(c.riepilogo.map((r) => r.natura).filter(Boolean))].join(', '));
    add('cig', 'CIG', c.cig.join(', '));
    add('cup', 'CUP', c.cup.join(', '));
    add('ordine', 'Riferimento ordine / contratto', c.riferimenti.filter((r) => r.idDocumento && r.tipo !== 'DatiFattureCollegate').map((r) => r.idDocumento).join(', '));
    add('collegata', 'Fattura collegata (note di credito)', c.riferimenti.filter((r) => r.tipo === 'DatiFattureCollegate').map((r) => `${r.idDocumento}${r.data ? ' del ' + dataIt(r.data) : ''}`).join(', '));
    add('ritenuta', 'Ritenuta', c.calcoli.ritenute ? c.calcoli.ritenute.toFixed(2).replace('.', ',') : '');
    add('scadenza', 'Scadenza pagamento', dataIt(p.scadenza));
    add('iban', 'IBAN', p.iban);
  } else if (testo) {
    const d = estraiDati(testo);
    add('piva', 'P.IVA', d.piva[0]?.valore);
    add('cig', 'CIG', d.cig.map((x) => x.valore).join(', '));
    add('cup', 'CUP', d.cup.map((x) => x.valore).join(', '));
    add('totale', 'Totale', d.totale != null ? d.totale.toFixed(2).replace('.', ',') : '');
    add('scadenza', 'Scadenza', dataIt(d.scadenze[0]?.valore));
    add('iban', 'IBAN', d.iban[0]?.valore);
    const date = trovaDate(testo); if (date[0]) add('data', 'Data', dataIt(date[0].iso));
  }
  return out;
}
