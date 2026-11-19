// Stato della sessione per l'avvio (logica pura + file, testata in Node).
// userData/sessione.json: { v: 2, running, docs: [{path, page}], active, last: {path, page} | null, at }
// - running: true mentre una finestra di Leggio è aperta; torna false solo alla chiusura regolare.
//   Se all'avvio è ancora true, la sessione precedente si è interrotta (crash, chiusura forzata).
// - docs: documenti aperti in questo momento (alla chiusura regolare: quelli lasciati aperti).
//   Un documento chiuso dall'utente esce subito dall'elenco: non può più ricomparire.
// - last: l'ultimo documento usato, per il pulsante «Riapri l'ultimo documento».
// Il file si scrive subito (non come localStorage, che Chromium salva su disco più tardi e un crash perde).
const fs = require('node:fs');
const path = require('node:path');

const VERSION = 2;
const MAX_DOCS = 30;

function voce(d) {
  if (!d || typeof d.path !== 'string' || !d.path || d.path.length > 4096 || !path.isAbsolute(d.path)) return null;
  const page = Number(d.page);
  return { path: d.path, page: Number.isInteger(page) && page > 0 && page < 1e6 ? page : 1 };
}

/** Normalizza uno stato ricevuto dal renderer o letto dal disco: mai eccezioni, campi sempre validi. */
function normalizza(s) {
  const o = s && typeof s === 'object' ? s : {};
  const seen = new Set();
  const docs = (Array.isArray(o.docs) ? o.docs : []).map(voce).filter((d) => d && !seen.has(d.path) && seen.add(d.path)).slice(0, MAX_DOCS);
  const active = typeof o.active === 'string' && docs.some((d) => d.path === o.active) ? o.active : null;
  return { v: VERSION, running: o.running === true, docs, active, last: voce(o.last), at: Number(o.at) || 0 };
}

function createSessionStore(file) {
  const leggi = () => {
    try { const s = JSON.parse(fs.readFileSync(file, 'utf8')); return s && s.v === VERSION ? normalizza(s) : null; } catch { return null; }
  };
  const scrivi = (s) => {
    const tmp = `${file}.${process.pid}.tmp`;
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(tmp, JSON.stringify(s));
      fs.renameSync(tmp, file);
    } catch { try { fs.unlinkSync(tmp); } catch { /* */ } }
  };
  return {
    read: leggi,
    /**
     * Una finestra comincia: restituisce lo stato precedente (con interrupted = la sessione si era interrotta)
     * e segna la nuova sessione in corso, senza documenti. «last» resta.
     */
    start() {
      const prev = leggi();
      const interrupted = !!prev?.running;
      scrivi({ ...normalizza({ last: prev?.last }), running: true, at: Date.now() });
      return { previous: prev, interrupted };
    },
    /** Aggiornamento dal renderer (documenti aperti, ultimo documento, chiusura regolare). */
    update(s) { const n = normalizza(s); n.at = Date.now(); scrivi(n); return n; },
  };
}

module.exports = { createSessionStore, normalizza, VERSION, MAX_DOCS };
