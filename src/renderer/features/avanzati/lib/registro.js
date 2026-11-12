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
export function daFare(lavoro) { return lavoro.items.filter((it) => !lavoro.esiti[it.k]); }
export function conteggi(lavoro) {
  let ok = 0; let saltati = 0; let errori = 0;
  for (const e of Object.values(lavoro.esiti)) { if (e.s === 'ok') ok++; else if (e.s === 'saltato') saltati++; else errori++; }
  return { totale: lavoro.items.length, ok, saltati, errori, fatti: ok + saltati + errori, mancanti: lavoro.items.length - ok - saltati - errori };
}
/** Registra l'esito di un file. s: 'ok' | 'saltato' | 'errore' */
export function registra(lavoro, it, { s, dove = '', motivo = '', nota = '', ms = 0 }) {
  lavoro.esiti[it.k || chiave(it)] = { s, dove, motivo, nota, ms: Math.round(ms), t: Date.now() };
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
