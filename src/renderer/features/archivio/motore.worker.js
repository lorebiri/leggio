// Web Worker con l'indice in memoria: ricerca, filtri, conteggi, «Oggi», stati d'ufficio e
// preparazione delle scritture a blocchi. Il thread dell'interfaccia manda solo richieste brevi.
import { Motore } from './lib/motore.js';
import { Blocchi, leggiBlocco, manifestoValido } from './lib/blocchi.js';
import { applica, esportaJson, esportaCsv, importa, unisci, ripulisci } from './lib/stati.js';
import { riepilogoOggi } from './lib/scadenze.js';
import { VERSIONE_ESTRAZIONE } from './lib/estrai.js';

const M = new Motore();
const B = new Blocchi();
const perImpronta = new Map(); // impronta → Set(id)
let rovinate = 0;
let pianoInCorso = null;

function indicizzaImpronta(r, via = false) {
  if (!r?.impronta) return;
  let s = perImpronta.get(r.impronta);
  if (via) { s?.delete(r.id); if (s && !s.size) perImpronta.delete(r.impronta); return; }
  if (!s) perImpronta.set(r.impronta, (s = new Set()));
  s.add(r.id);
}

function metti(doc, { persisti = true } = {}) {
  const prima = M.get(doc.id);
  let statiCambiati = false;
  if (prima) {
    indicizzaImpronta(prima, true);
    // stesso file, contenuto cambiato (es. timbrato da un altro programma): lo stato lo segue
    if (prima.impronta && doc.impronta && prima.impronta !== doc.impronta && M.stati.has(prima.impronta) && !M.stati.has(doc.impronta) && !perImpronta.get(prima.impronta)?.size) {
      M.stati.set(doc.impronta, M.stati.get(prima.impronta));
      M.stati.delete(prima.impronta);
      statiCambiati = true;
    }
    if (!doc.aggiunto) doc.aggiunto = prima.aggiunto;
  }
  M.metti(doc);
  indicizzaImpronta(doc);
  if (persisti) B.metti(doc.id);
  return statiCambiati;
}
function togli(id) {
  const r = M.get(id);
  if (!r) return;
  indicizzaImpronta(r, true);
  M.togli(id);
  B.togli(id);
}

function statiJson() {
  return JSON.stringify({ formato: 'leggio-archivio-stati-interno', versione: 1, stati: Object.fromEntries(M.stati) });
}
function nomiPerImpronta() {
  const out = {};
  for (const [imp, ids] of perImpronta) out[imp] = [...ids].slice(0, 5).map((id) => { const r = M.get(id); return { nome: r?.nome, percorso: r?.path }; });
  return out;
}

const H = {
  azzera() { M.rec.clear(); M.norm.clear(); M.meta.clear(); B.azzera(); perImpronta.clear(); return true; },
  'carica-inizio'({ manifesto }) { H.azzera(); return { manifesto: manifestoValido(manifesto) }; },
  'carica-blocco'({ chiave, file, testo }) {
    const { docs, rovinate: r } = leggiBlocco(testo);
    rovinate += r;
    for (const d of docs) metti(d, { persisti: false });
    return { chiave, file, ids: docs.map((d) => d.id) };
  },
  'carica-fine'({ manifesto, blocchi }) {
    B.carica(manifesto, blocchi);
    return { n: M.size, rovinate };
  },
  stati({ testo }) {
    M.stati.clear();
    if (!testo) return 0;
    try {
      const j = JSON.parse(testo);
      for (const [k, v] of Object.entries(j?.stati || {})) { const s = ripulisci(v); if (s && /^[a-f0-9]{64}$/.test(k)) M.stati.set(k, { ...s, aggiornato: v.aggiornato || s.aggiornato }); }
    } catch { /* file illeggibile: gestito dal chiamante (riserva) */ }
    return M.stati.size;
  },
  offline({ cartelle }) { M.offline = new Set(cartelle || []); return true; },
  metti({ doc }) { return { statiCambiati: metti(doc) }; },
  togli({ ids }) { for (const id of ids) togli(id); return true; },
  'togli-cartella'({ cartella }) {
    const ids = [...M.rec.values()].filter((r) => r.cartella === cartella).map((r) => r.id);
    for (const id of ids) togli(id);
    return ids.length;
  },
  /** Confronta l'elenco di una cartella con l'indice. → { daLeggere: [[rel,size,mtime]], spariti: [id] } */
  confronta({ cartella, base, file, sep, protetti = [], parziale = false }) {
    const visti = new Set(); const daLeggere = [];
    for (const f of file) {
      const id = chiaveId(base + sep + f[0]);
      visti.add(id);
      const r = M.get(id);
      if (!r || r.size !== f[1] || r.mtime !== f[2] || (r.v || 0) < VERSIONE_ESTRAZIONE || r.erroreTemporaneo) daLeggere.push(f);
    }
    const spariti = [];
    // non si toglie nulla se l'elenco è incompleto (troppi file) o sotto sottocartelle non leggibili
    const pref = protetti.filter((x) => x && x !== '.').map((x) => x + sep);
    if (!parziale && !protetti.includes('.')) {
      for (const r of M.rec.values()) if (r.cartella === cartella && !visti.has(r.id) && !pref.some((p) => r.rel.startsWith(p))) spariti.push(r.id);
    }
    return { daLeggere, spariti };
  },
  /** Un file letto ha un'impronta già nota (spostato, rinominato, copiato)? Allora si riusa l'estrazione. */
  riusa({ doc }) {
    const ids = perImpronta.get(doc.impronta);
    if (!ids?.size) return false;
    for (const id of ids) {
      const r = M.get(id);
      if (!r || (r.v || 0) < VERSIONE_ESTRAZIONE || r.errore) continue;
      const nuovo = { ...r, ...doc, aggiunto: M.get(doc.id)?.aggiunto || r.aggiunto || doc.aggiunto };
      metti(nuovo);
      return true;
    }
    return false;
  },
  cerca({ f }) { return M.cerca(f); },
  estratti({ ids, q }) { return M.estratti(ids, q); },
  conteggi() { return M.conteggi(); },
  righe({ ids }) { return ids.map((id) => M.riga(id)).filter(Boolean); },
  documento({ id }) { const r = M.get(id); return r ? { ...M.riga(id), testo: r.testo } : null; },
  oggi({ impostazioni, ultimaApertura, oggi }) {
    return riepilogoOggi({ records: [...M.rec.values()], stati: M.stati, impostazioni, ultimaApertura, oggi });
  },
  'cambia-stato'({ ids, modifica, ora }) {
    const impronte = new Set();
    for (const id of ids) { const r = M.get(id); if (r?.impronta) impronte.add(r.impronta); }
    let n = 0;
    for (const imp of impronte) {
      const s = applica(M.stati.get(imp), modifica, ora || Date.now());
      if (s) M.stati.set(imp, s); else M.stati.delete(imp);
      n++;
    }
    return { n, json: statiJson() };
  },
  /** Stato diverso per ogni documento (es. numero di protocollo per file). voci: [{ id, modifica }] */
  'cambia-stati'({ voci, ora }) {
    let n = 0;
    for (const v of voci) {
      const r = M.get(v.id); if (!r?.impronta) continue;
      const s = applica(M.stati.get(r.impronta), v.modifica, ora || Date.now());
      if (s) M.stati.set(r.impronta, s); else M.stati.delete(r.impronta);
      n++;
    }
    return { n, json: statiJson() };
  },
  'stati-esporta'({ formato }) {
    const nomi = nomiPerImpronta();
    return formato === 'csv' ? esportaCsv(M.stati, nomi) : esportaJson(M.stati, nomi);
  },
  'stati-importa'({ testo, modo }) {
    const imp = importa(testo);
    const r = unisci(M.stati, imp.voci, modo);
    M.stati = r.stati;
    let presenti = 0;
    for (const k of imp.voci.keys()) if (perImpronta.has(k)) presenti++;
    return { nuovi: r.nuovi, aggiornati: r.aggiornati, invariati: r.invariati, scartate: imp.scartate, presenti, totale: imp.voci.size, json: statiJson() };
  },
  'stati-json'() { return statiJson(); },
  'stati-azzera'() { M.stati.clear(); return { json: statiJson() }; },
  /** Piano di scrittura dei blocchi cambiati (uno alla volta). */
  'prepara-scrittura'() {
    if (pianoInCorso) return null;
    const piano = B.prepara((id) => { const r = M.get(id); return r ? JSON.stringify(r) : null; });
    if (!piano) return null;
    pianoInCorso = piano;
    return { scrivi: piano.scrivi, manifesto: piano.manifesto, elimina: piano.elimina };
  },
  'esito-scrittura'({ ok }) {
    const p = pianoInCorso; pianoInCorso = null;
    if (!p) return false;
    if (ok) B.conferma(p); else B.annulla(p);
    return B.daScrivere;
  },
  'da-scrivere'() { return B.daScrivere; },
  /** Documenti con un errore temporaneo (es. cartella non raggiungibile durante la lettura). */
  'ids-cartella'({ cartella }) { return [...M.rec.values()].filter((r) => r.cartella === cartella).map((r) => r.id); },
  info() { return { documenti: M.size, stati: M.stati.size, impronte: perImpronta.size }; },
};

let caseInsensitive = true;
function chiaveId(p) { return caseInsensitive ? p.toLowerCase() : p; }
H.piattaforma = ({ ci }) => { caseInsensitive = !!ci; return true; };

self.onmessage = (ev) => {
  const { req, t, ...a } = ev.data || {};
  const fn = H[t];
  if (!fn) { self.postMessage({ req, ok: false, errore: 'Richiesta sconosciuta: ' + t }); return; }
  try {
    self.postMessage({ req, ok: true, r: fn(a) });
  } catch (e) {
    self.postMessage({ req, ok: false, errore: e?.message || String(e) });
  }
};
