// Motore di ricerca in memoria dell'archivio: documenti, testo normalizzato, stati, filtri,
// ordinamento, estratti e conteggi. Gira nel Web Worker (motore.worker.js), mai nel thread
// dell'interfaccia. Logica pura (coperta dai test).
import { normalizza, interpretaRicerca, estratto, paginaDi } from './testo.js';
import { haStato, descrivi } from './stati.js';

const coll = new Intl.Collator('it', { sensitivity: 'base', numeric: true });

/** Campi del documento che vanno all'interfaccia (tutto tranne il testo). */
export function riga(r, stato, offline) {
  return {
    id: r.id, path: r.path, rel: r.rel, cartella: r.cartella, nome: r.nome, ext: r.ext, size: r.size, mtime: r.mtime,
    impronta: r.impronta, tipo: r.tipo, fornitore: r.fornitore, piva: r.piva, cf: r.cf, numero: r.numero, data: r.data,
    importo: r.importo, cig: r.cig, cup: r.cup, scadenza: r.scadenza, firme: r.firme, firmatari: r.firmatari,
    pagine: r.pagine, scansione: r.scansione, protetto: r.protetto, errore: r.errore, parziale: r.parziale,
    aggiunto: r.aggiunto, contenuto: r.contenuto, stato: stato || null, chips: descrivi(stato), offline: !!offline,
  };
}

export class Motore {
  constructor() {
    this.rec = new Map(); // id → documento
    this.norm = new Map(); // id → testo normalizzato
    this.meta = new Map(); // id → nome/fornitore/codici normalizzati
    this.stati = new Map(); // impronta → stato
    this.offline = new Set(); // id delle cartelle non raggiungibili
  }

  get size() { return this.rec.size; }

  metti(r) {
    this.rec.set(r.id, r);
    this.norm.set(r.id, normalizza(r.testo || ''));
    this.meta.set(r.id, normalizza([r.nome, r.rel, r.fornitore, r.piva, r.cf, r.numero, ...(r.cig || []), ...(r.cup || []), ...(r.firmatari || [])].join(' \u0001 ')));
  }
  togli(id) { this.rec.delete(id); this.norm.delete(id); this.meta.delete(id); }
  get(id) { return this.rec.get(id); }
  stato(r) { return r?.impronta ? this.stati.get(r.impronta) : null; }
  riga(id) { const r = this.rec.get(id); return r ? riga(r, this.stato(r), this.offline.has(r.cartella)) : null; }

  /** Testo cercabile negli stati (note ed etichette). */
  #testoStato(r) {
    const s = this.stato(r);
    if (!s) return '';
    return normalizza([s.nota, ...(s.etichette || []), s.numeroProtocollo].filter(Boolean).join(' '));
  }

  /**
   * Ricerca. f: { q, tipo, fornitore, dal, al, cigcup, stato, cartella, segnale, ordine, limite }
   * → { totale, righe, ms }
   */
  cerca(f = {}) {
    const t0 = Date.now();
    const termini = interpretaRicerca(f.q);
    const forn = f.fornitore ? normalizza(f.fornitore).trim() : '';
    const cc = f.cigcup ? String(f.cigcup).toUpperCase().replace(/\s+/g, '') : '';
    const out = [];
    for (const r of this.rec.values()) {
      if (f.tipo && r.tipo !== f.tipo) continue;
      if (f.cartella && r.cartella !== f.cartella) continue;
      if (forn && !normalizza(`${r.fornitore || ''} ${r.piva || ''} ${r.cf || ''}`).includes(forn)) continue;
      if (f.dal || f.al) {
        const d = r.data || isoDaMs(r.mtime);
        if (!d || (f.dal && d < f.dal) || (f.al && d > f.al)) continue;
      }
      if (cc && !(r.cig || []).some((x) => x.includes(cc)) && !(r.cup || []).some((x) => x.includes(cc))) continue;
      if (f.stato && !haStato(this.stato(r), f.stato)) continue;
      if (f.segnale && !segnale(r, f.segnale)) continue;
      if (f.aggiuntoDopo && !((r.aggiunto || 0) > f.aggiuntoDopo)) continue;
      let score = 0; let pos = -1;
      if (termini.length) {
        const testo = this.norm.get(r.id) || ''; const meta = this.meta.get(r.id) || '';
        let st = null; let ok = true;
        for (const { t } of termini) {
          const im = meta.indexOf(t);
          const it = testo.indexOf(t);
          let is = -1;
          if (im < 0 && it < 0) { st ??= this.#testoStato(r); is = st.indexOf(t); }
          if (im < 0 && it < 0 && is < 0) { ok = false; break; }
          if (im >= 0) score += 50;
          if (is >= 0) score += 30;
          if (it >= 0) {
            if (pos < 0) pos = it;
            let n = 1;
            for (let k = testo.indexOf(t, it + t.length); k >= 0 && n < 20; k = testo.indexOf(t, k + t.length)) n++;
            score += n;
          }
        }
        if (!ok) continue;
      }
      out.push({ r, score, pos });
    }
    ordina(out, f.ordine || (termini.length ? 'pertinenza' : 'data-desc'));
    const limite = Math.min(f.limite || 20000, 50000);
    return {
      totale: out.length,
      righe: out.slice(0, limite).map(({ r, pos }) => ({ ...riga(r, this.stato(r), this.offline.has(r.cartella)), pagina: pos >= 0 ? paginaDi(r.testo || '', pos) : null })),
      ms: Date.now() - t0,
    };
  }

  /** Estratti con il contesto per alcuni documenti. → { id: [{ pagina, prima, trovato, dopo }] } */
  estratti(ids, q, max = 3) {
    const termini = interpretaRicerca(q);
    const out = {};
    if (!termini.length) return out;
    for (const id of ids) {
      const r = this.rec.get(id); const testo = this.norm.get(id);
      if (!r || !testo) continue;
      const list = [];
      for (const { t } of termini) {
        for (let i = testo.indexOf(t); i >= 0 && list.length < max; i = testo.indexOf(t, i + t.length)) {
          if (list.some((x) => Math.abs(x.pos - i) < 80)) continue;
          list.push({ pos: i, pagina: paginaDi(r.testo, i), ...estratto(r.testo, i, i + t.length) });
        }
        if (list.length >= max) break;
      }
      out[id] = list.sort((a, b) => a.pos - b.pos);
    }
    return out;
  }

  /** Conteggi per i filtri: tipi, fornitori, etichette, cartelle, segnali. */
  conteggi() {
    const tipi = {}; const forn = new Map(); const etichette = new Map(); const cartelle = {}; const segnali = { scansione: 0, protetto: 0, errore: 0, firmato: 0 };
    for (const r of this.rec.values()) {
      tipi[r.tipo] = (tipi[r.tipo] || 0) + 1;
      cartelle[r.cartella] = (cartelle[r.cartella] || 0) + 1;
      if (r.fornitore) { const k = r.fornitore.trim(); forn.set(k, (forn.get(k) || 0) + 1); }
      for (const s of ['scansione', 'protetto', 'errore', 'firmato']) if (segnale(r, s)) segnali[s]++;
    }
    for (const s of this.stati.values()) for (const e of s.etichette || []) etichette.set(e, (etichette.get(e) || 0) + 1);
    return {
      totale: this.rec.size, tipi, cartelle, segnali,
      fornitori: [...forn.entries()].sort((a, b) => b[1] - a[1]).slice(0, 800).map(([nome, n]) => ({ nome, n })),
      etichette: [...etichette.entries()].sort((a, b) => coll.compare(a[0], b[0])).map(([nome, n]) => ({ nome, n })),
    };
  }
}

export function segnale(r, s) {
  if (s === 'scansione') return !!r.scansione;
  if (s === 'protetto') return !!r.protetto;
  if (s === 'errore') return !!r.errore;
  if (s === 'firmato') return (r.firme || 0) > 0;
  if (s === 'senza-dati') return !r.fornitore && !r.numero && !r.importo;
  return true;
}

export function isoDaMs(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return '';
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export const ORDINAMENTI = [
  { id: 'pertinenza', label: 'Più pertinenti' },
  { id: 'data-desc', label: 'Data: più recenti' },
  { id: 'data-asc', label: 'Data: più vecchi' },
  { id: 'aggiunto-desc', label: 'Arrivati di recente' },
  { id: 'nome', label: 'Nome del file (A-Z)' },
  { id: 'fornitore', label: 'Fornitore (A-Z)' },
  { id: 'importo-desc', label: 'Importo: dal più alto' },
  { id: 'scadenza', label: 'Scadenza: la più vicina' },
];

function ordina(list, ordine) {
  const d = (x) => x.r.data || isoDaMs(x.r.mtime);
  const cmp = {
    pertinenza: (a, b) => b.score - a.score || d(b).localeCompare(d(a)),
    'data-desc': (a, b) => d(b).localeCompare(d(a)) || coll.compare(a.r.nome, b.r.nome),
    'data-asc': (a, b) => d(a).localeCompare(d(b)) || coll.compare(a.r.nome, b.r.nome),
    'aggiunto-desc': (a, b) => (b.r.aggiunto || 0) - (a.r.aggiunto || 0),
    nome: (a, b) => coll.compare(a.r.nome, b.r.nome),
    fornitore: (a, b) => (a.r.fornitore ? 0 : 1) - (b.r.fornitore ? 0 : 1) || coll.compare(a.r.fornitore || '', b.r.fornitore || '') || d(b).localeCompare(d(a)),
    'importo-desc': (a, b) => (b.r.importo ?? -1) - (a.r.importo ?? -1),
    scadenza: (a, b) => (a.r.scadenza ? 0 : 1) - (b.r.scadenza ? 0 : 1) || (a.r.scadenza || '').localeCompare(b.r.scadenza || ''),
  }[ordine] || ((a, b) => b.score - a.score);
  list.sort(cmp);
}
