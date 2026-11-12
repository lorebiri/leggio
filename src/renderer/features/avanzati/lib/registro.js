// Azioni guidate su migliaia di file: stato del lavoro (per riprendere dopo un'interruzione) e registro dei risultati.
// Logica pura: il salvataggio su disco lo fa il chiamante.

export const VERSIONE_LAVORO = 1;
const chiave = (it) => it.path || `${it.rel || it.name}:${it.size || 0}`;

/** Nuovo lavoro. Le password delle operazioni non vengono mai conservate. */
export function nuovoLavoro({ items, passi, opzioni }) {
  return {
    v: VERSIONE_LAVORO, id: 'l' + Date.now().toString(36), creato: Date.now(), aggiornato: Date.now(),
    opzioni: opzioni || {},
    passi: passi.map((p) => ({ op: p.op, params: p.op === 'proteggi' ? { ...p.params, password: '' } : p.params })),
    items: items.map((it) => ({ k: chiave(it), path: it.path || null, rel: it.rel || it.name, name: it.name, size: it.size || 0 })),
    esiti: {},
  };
}

export function chiaveDi(it) { return chiave(it); }

/**
 * Nome di uscita senza doppioni nello stesso lavoro: se un altro file ha già preso quel nome nella stessa cartella,
 * si aggiunge « (2)», « (3)»… Il nome assegnato resta legato al file (anche alla ripresa).
 */
export function nomeUnico(lavoro, it, cartella, nome) {
  lavoro.nomi ||= {};
  const k = it.k || chiave(it);
  if (lavoro.nomi[k]) return lavoro.nomi[k].split('\u0000')[1];
  const usati = new Set(Object.entries(lavoro.nomi).filter(([kk]) => kk !== k).map(([, v]) => v.toLowerCase()));
  const m = String(nome).match(/^(.*?)(\.[^.]+)?$/);
  let n = nome; let i = 2;
  while (usati.has(`${cartella}\u0000${n}`.toLowerCase())) n = `${m[1]} (${i++})${m[2] || ''}`;
  lavoro.nomi[k] = `${cartella}\u0000${n}`;
  return n;
}
export function daFare(lavoro) { return lavoro.items.filter((it) => !lavoro.esiti[it.k]); }
export function conteggi(lavoro) {
  let ok = 0; let saltati = 0; let errori = 0;
  for (const e of Object.values(lavoro.esiti)) { if (e.s === 'ok') ok++; else if (e.s === 'saltato') saltati++; else errori++; }
  return { totale: lavoro.items.length, ok, saltati, errori, fatti: ok + saltati + errori, mancanti: lavoro.items.length - ok - saltati - errori };
}
/** Registra l'esito di un file. s: 'ok' | 'saltato' | 'errore' */
export function registra(lavoro, it, { s, dove = '', motivo = '', nota = '', ms = 0, dati = null }) {
  lavoro.esiti[it.k || chiave(it)] = { s, dove, motivo, nota, ms: Math.round(ms), t: Date.now(), ...(dati ? { dati } : {}) };
  lavoro.aggiornato = Date.now();
}

/** Valida un lavoro letto dal disco (file troncato, versione diversa…). */
export function lavoroValido(x) {
  return !!x && x.v === VERSIONE_LAVORO && Array.isArray(x.items) && x.items.every((i) => i && typeof i.k === 'string') && x.esiti && typeof x.esiti === 'object' && Array.isArray(x.passi);
}

function cella(v) { const s = String(v ?? ''); return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }
/** Registro CSV (separatore «;», per Excel in italiano). */
export function registroCsv(lavoro) {
  const lines = ['Esito;File;Dettagli;Salvato in;Durata (ms);Ora'];
  for (const it of lavoro.items) {
    const e = lavoro.esiti[it.k];
    const esito = !e ? 'DA FARE' : e.s === 'ok' ? 'FATTO' : e.s === 'saltato' ? 'SALTATO' : 'NON RIUSCITO';
    lines.push([esito, it.rel, e ? (e.s === 'ok' ? e.nota : e.motivo) : '', e?.dove || '', e?.ms ?? '', e ? new Date(e.t).toLocaleString('it-IT') : ''].map(cella).join(';'));
  }
  return '﻿' + lines.join('\r\n') + '\r\n';
}

/**
 * Dati estratti dai file (operazione «Estrai dati in Excel»): CSV con «;» e virgola decimale, una riga per documento.
 * Le colonne sono l'unione di quelle trovate, nell'ordine di comparsa; prima colonna il file.
 */
export function datiCsv(lavoro) {
  const righe = [];
  for (const it of lavoro.items) { const e = lavoro.esiti[it.k]; for (const r of [].concat(e?.dati || [])) righe.push({ File: it.rel, ...r }); }
  if (!righe.length) return null;
  const col = []; for (const r of righe) for (const k of Object.keys(r)) if (!col.includes(k)) col.push(k);
  const fmt = (v) => (typeof v === 'number' ? v.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: false }) : /^\d{4}-\d{2}-\d{2}$/.test(String(v ?? '')) ? String(v).split('-').reverse().join('/') : v);
  return '\uFEFF' + [col.map(cella).join(';'), ...righe.map((r) => col.map((k) => cella(fmt(r[k] ?? ''))).join(';'))].join('\r\n') + '\r\n';
}
