// Stati e note d'ufficio dei documenti dell'archivio. Si salvano nell'indice di Leggio (mai nel PDF)
// e si legano al file tramite la sua impronta (SHA-256 del contenuto): così sopravvivono a rinomina
// e spostamento dentro le cartelle collegate. Logica pura.
import { normalizza } from './testo.js';

/**
 * Stato di un documento (tutti i campi facoltativi):
 * { protocollo: 'da'|'fatto', numeroProtocollo, firma: 'da'|'fatto', pagamento: 'da'|'fatto',
 *   pubblicato: true, archiviato: true, etichette: [..], nota: '', aggiornato: ms }
 */
export const VOCI_STATO = [
  { id: 'da-protocollare', label: 'Da protocollare', campo: 'protocollo', valore: 'da' },
  { id: 'protocollato', label: 'Protocollato', campo: 'protocollo', valore: 'fatto' },
  { id: 'da-firmare', label: 'Da firmare', campo: 'firma', valore: 'da' },
  { id: 'firmato', label: 'Firmato', campo: 'firma', valore: 'fatto' },
  { id: 'da-pagare', label: 'Da pagare', campo: 'pagamento', valore: 'da' },
  { id: 'pagato', label: 'Pagato', campo: 'pagamento', valore: 'fatto' },
  { id: 'pubblicato', label: 'Pubblicato', campo: 'pubblicato', valore: true },
  { id: 'archiviato', label: 'Archiviato', campo: 'archiviato', valore: true },
];
export const LABEL_STATO = Object.fromEntries(VOCI_STATO.map((v) => [v.id, v.label]));

const MAX_ETICHETTE = 30;
const pulisciEtichetta = (e) => String(e || '').replace(/[\u0000-\u001f;"]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40);

/** Lo stato è vuoto (nessuna informazione da conservare)? */
export function vuoto(s) {
  return !s || (!s.protocollo && !s.firma && !s.pagamento && !s.pubblicato && !s.archiviato && !(s.etichette?.length) && !s.nota && !s.numeroProtocollo);
}

/** Lo stato corrisponde alla voce (id di VOCI_STATO, 'senza-stato', 'etichetta:xxx')? */
export function haStato(s, id) {
  if (id === 'senza-stato') return vuoto(s);
  if (!s) return false;
  if (id.startsWith('etichetta:')) { const e = normalizza(id.slice(10)); return (s.etichette || []).some((x) => normalizza(x) === e); }
  const v = VOCI_STATO.find((x) => x.id === id);
  return !!v && s[v.campo] === v.valore;
}

/**
 * Applica una modifica a uno stato (restituisce un nuovo oggetto, o null se resta vuoto).
 * modifica: { imposta: id di VOCI_STATO, togli: id, numeroProtocollo, dataProtocollo,
 *             aggiungiEtichette: [..], togliEtichette: [..], nota (stringa; '' per cancellare) }
 */
export function applica(s, modifica, ora = Date.now()) {
  const n = { ...(s || {}) };
  n.etichette = [...(s?.etichette || [])];
  if (modifica.imposta) {
    const v = VOCI_STATO.find((x) => x.id === modifica.imposta);
    if (!v) throw new Error('Stato sconosciuto: ' + modifica.imposta);
    n[v.campo] = v.valore;
    if (v.id === 'da-protocollare') { delete n.numeroProtocollo; delete n.dataProtocollo; }
  }
  if (modifica.togli) {
    const v = VOCI_STATO.find((x) => x.id === modifica.togli);
    if (v && n[v.campo] === v.valore) delete n[v.campo];
    if (v?.campo === 'protocollo') { delete n.numeroProtocollo; delete n.dataProtocollo; }
  }
  if (modifica.numeroProtocollo != null) {
    const num = String(modifica.numeroProtocollo).trim().slice(0, 40);
    if (num) { n.numeroProtocollo = num; n.protocollo = 'fatto'; } else delete n.numeroProtocollo;
  }
  if (modifica.dataProtocollo) n.dataProtocollo = String(modifica.dataProtocollo).slice(0, 10);
  for (const e of modifica.aggiungiEtichette || []) {
    const c = pulisciEtichetta(e);
    if (c && !n.etichette.some((x) => normalizza(x) === normalizza(c)) && n.etichette.length < MAX_ETICHETTE) n.etichette.push(c);
  }
  if (modifica.togliEtichette?.length) {
    const via = new Set(modifica.togliEtichette.map((e) => normalizza(pulisciEtichetta(e))));
    n.etichette = n.etichette.filter((x) => !via.has(normalizza(x)));
  }
  if (modifica.nota != null) { const t = String(modifica.nota).slice(0, 4000).trim(); if (t) n.nota = t; else delete n.nota; }
  if (!n.etichette.length) delete n.etichette;
  if (vuoto(n)) return null;
  n.aggiornato = ora;
  return n;
}

/** Etichette leggibili di uno stato, per la lista. → [{ id, testo, tipo }] */
export function descrivi(s) {
  if (!s) return [];
  const out = [];
  if (s.protocollo === 'da') out.push({ id: 'da-protocollare', testo: 'Da protocollare', tipo: 'da' });
  if (s.protocollo === 'fatto') out.push({ id: 'protocollato', testo: s.numeroProtocollo ? `Protocollato n. ${s.numeroProtocollo}` : 'Protocollato', tipo: 'fatto' });
  if (s.firma === 'da') out.push({ id: 'da-firmare', testo: 'Da firmare', tipo: 'da' });
  if (s.firma === 'fatto') out.push({ id: 'firmato', testo: 'Firmato', tipo: 'fatto' });
  if (s.pagamento === 'da') out.push({ id: 'da-pagare', testo: 'Da pagare', tipo: 'da' });
  if (s.pagamento === 'fatto') out.push({ id: 'pagato', testo: 'Pagato', tipo: 'fatto' });
  if (s.pubblicato) out.push({ id: 'pubblicato', testo: 'Pubblicato', tipo: 'fatto' });
  if (s.archiviato) out.push({ id: 'archiviato', testo: 'Archiviato', tipo: 'neutro' });
  for (const e of s.etichette || []) out.push({ id: 'etichetta:' + e, testo: e, tipo: 'etichetta' });
  return out;
}

/** Valida e ripulisce uno stato arrivato da un file importato. → stato o null */
export function ripulisci(s) {
  if (!s || typeof s !== 'object') return null;
  const n = {};
  if (s.protocollo === 'da' || s.protocollo === 'fatto') n.protocollo = s.protocollo;
  if (s.firma === 'da' || s.firma === 'fatto') n.firma = s.firma;
  if (s.pagamento === 'da' || s.pagamento === 'fatto') n.pagamento = s.pagamento;
  if (s.pubblicato === true || s.pubblicato === 'sì' || s.pubblicato === 'si') n.pubblicato = true;
  if (s.archiviato === true || s.archiviato === 'sì' || s.archiviato === 'si') n.archiviato = true;
  if (s.numeroProtocollo) { n.numeroProtocollo = String(s.numeroProtocollo).slice(0, 40); n.protocollo = 'fatto'; }
  if (s.dataProtocollo && /^\d{4}-\d{2}-\d{2}$/.test(s.dataProtocollo)) n.dataProtocollo = s.dataProtocollo;
  const et = Array.isArray(s.etichette) ? s.etichette : typeof s.etichette === 'string' ? s.etichette.split(/[|,]/) : [];
  const pul = [...new Set(et.map(pulisciEtichetta).filter(Boolean))].slice(0, MAX_ETICHETTE);
  if (pul.length) n.etichette = pul;
  if (s.nota) n.nota = String(s.nota).slice(0, 4000);
  if (vuoto(n)) return null;
  n.aggiornato = Number.isFinite(+s.aggiornato) && +s.aggiornato > 0 ? +s.aggiornato : 0;
  return n;
}

const IMPRONTA = /^[a-f0-9]{64}$/;

// ---------------- esportazione / importazione ----------------

/**
 * JSON per backup o per una collega. stati: Map|oggetto impronta → stato;
 * nomi: impronta → [{ nome, percorso }] (facoltativo, aiuta a riconoscere i file a occhio).
 */
export function esportaJson(stati, nomi = {}, ora = new Date()) {
  const voci = [];
  for (const [impronta, stato] of entries(stati)) {
    if (!IMPRONTA.test(impronta) || vuoto(stato)) continue;
    voci.push({ impronta, file: (nomi[impronta] || []).slice(0, 5), stato });
  }
  return JSON.stringify({ formato: 'leggio-archivio-stati', versione: 1, esportato: ora.toISOString(), voci }, null, 1);
}

const COLONNE = ['impronta', 'nome', 'percorso', 'protocollo', 'numero_protocollo', 'data_protocollo', 'firma', 'pagamento', 'pubblicato', 'archiviato', 'etichette', 'nota', 'aggiornato'];
const sino = (v) => (v ? 'sì' : '');
const fase = (v) => (v === 'da' ? 'da fare' : v === 'fatto' ? 'fatto' : '');
function cella(v) { const s = String(v ?? ''); return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }

/** CSV (separatore «;», come Excel in italiano). */
export function esportaCsv(stati, nomi = {}) {
  const righe = [COLONNE.join(';')];
  for (const [impronta, s] of entries(stati)) {
    if (!IMPRONTA.test(impronta) || vuoto(s)) continue;
    const f = (nomi[impronta] || [])[0] || {};
    righe.push([impronta, f.nome || '', f.percorso || '', fase(s.protocollo), s.numeroProtocollo || '', s.dataProtocollo || '', fase(s.firma), fase(s.pagamento), sino(s.pubblicato), sino(s.archiviato), (s.etichette || []).join(' | '), s.nota || '', s.aggiornato ? new Date(s.aggiornato).toISOString() : ''].map(cella).join(';'));
  }
  return '﻿' + righe.join('\r\n') + '\r\n';
}

/** Legge un CSV con «;» o «,» (virgolette, a capo dentro le celle). → righe [[...]] */
export function leggiCsv(testo) {
  const t = String(testo || '').replace(/^﻿/, '');
  const prima = t.split(/\r?\n/, 1)[0] || '';
  const sep = (prima.match(/;/g) || []).length >= (prima.match(/,/g) || []).length ? ';' : ',';
  const righe = []; let riga = []; let cur = ''; let q = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) {
      if (c === '"') { if (t[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c;
    } else if (c === '"') q = true;
    else if (c === sep) { riga.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && t[i + 1] === '\n') i++; riga.push(cur); righe.push(riga); riga = []; cur = ''; }
    else cur += c;
  }
  if (cur !== '' || riga.length) { riga.push(cur); righe.push(riga); }
  return righe.filter((r) => r.some((x) => x.trim() !== ''));
}

/**
 * Importa stati da JSON o CSV. → { voci: Map impronta → stato, scartate: n, formato }
 * Lancia un errore leggibile se il file non è riconosciuto.
 */
export function importa(testo) {
  const t = String(testo || '').trim().replace(/^﻿/, '');
  const voci = new Map(); let scartate = 0;
  if (t.startsWith('{')) {
    let j;
    try { j = JSON.parse(t); } catch { throw new Error('Il file JSON è danneggiato e non si può leggere.'); }
    if (j?.formato !== 'leggio-archivio-stati' || !Array.isArray(j.voci)) throw new Error('Questo file JSON non è un elenco di stati esportato da Leggio.');
    for (const v of j.voci) {
      const s = ripulisci(v?.stato);
      if (IMPRONTA.test(v?.impronta) && s) voci.set(v.impronta, s); else scartate++;
    }
    return { voci, scartate, formato: 'json' };
  }
  const righe = leggiCsv(t);
  if (!righe.length) throw new Error('Il file è vuoto.');
  const head = righe[0].map((x) => normalizza(x).trim().replace(/\s+/g, '_'));
  const col = (n) => head.indexOf(n);
  if (col('impronta') < 0) throw new Error('Nel CSV manca la colonna «impronta»: usa un file esportato da Leggio.');
  const daFase = (v) => { const x = normalizza(v).trim(); return x === 'da fare' || x === 'da' ? 'da' : x === 'fatto' || x === 'si' || x === 'sì' ? 'fatto' : undefined; };
  for (const r of righe.slice(1)) {
    const g = (n) => (col(n) >= 0 ? (r[col(n)] ?? '').trim() : '');
    const impronta = g('impronta').toLowerCase();
    const s = ripulisci({
      protocollo: daFase(g('protocollo')), numeroProtocollo: g('numero_protocollo'), dataProtocollo: g('data_protocollo'),
      firma: daFase(g('firma')), pagamento: daFase(g('pagamento')),
      pubblicato: /^s[iì]$/i.test(g('pubblicato')), archiviato: /^s[iì]$/i.test(g('archiviato')),
      etichette: g('etichette').split('|'), nota: g('nota'), aggiornato: Date.parse(g('aggiornato')) || 0,
    });
    if (IMPRONTA.test(impronta) && s) voci.set(impronta, s); else scartate++;
  }
  return { voci, scartate, formato: 'csv' };
}

/**
 * Unisce stati importati a quelli presenti.
 * modo: 'unisci' (vince lo stato aggiornato più di recente) | 'sostituisci' (vince sempre l'importato).
 * → { stati: nuova Map, nuovi, aggiornati, invariati }
 */
export function unisci(attuali, importati, modo = 'unisci') {
  const out = new Map(entries(attuali));
  let nuovi = 0; let aggiornati = 0; let invariati = 0;
  for (const [k, s] of entries(importati)) {
    const cur = out.get(k);
    if (!cur) { out.set(k, s); nuovi++; continue; }
    if (modo === 'sostituisci' || (s.aggiornato || 0) > (cur.aggiornato || 0)) {
      if (JSON.stringify(cur) === JSON.stringify(s)) invariati++; else { out.set(k, s); aggiornati++; }
    } else invariati++;
  }
  return { stati: out, nuovi, aggiornati, invariati };
}

function entries(x) { return x instanceof Map ? x.entries() : Object.entries(x || {}); }
