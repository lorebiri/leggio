// Motore di ricerca in memoria dell'archivio: documenti, testo normalizzato, stati, filtri,
// ordinamento, estratti e conteggi. Gira nel Web Worker (motore.worker.js), mai nel thread
// dell'interfaccia. Logica pura (coperta dai test).
import { normalizza, interpretaRicerca, estratto, paginaDi } from './testo.js';
import { haStato, descrivi, conSegnatura } from './stati.js';
import { numeroConfrontabile } from './segnatura.js';
import { indiciFornitori, prontaPerPagamento } from './pagamento.js';

const TIPO_PAROLE = { durc: 'durc', fattura: 'fattura', fatture: 'fattura', 'nota di credito': 'nota-credito', determina: 'ordine', ordine: 'ordine', missione: 'missione', missioni: 'missione', contratto: 'contratto', contratti: 'contratto', pec: 'pec' };
const coll = new Intl.Collator('it', { sensitivity: 'base', numeric: true });

/** Campi del documento che vanno all'interfaccia (tutto tranne il testo). */
export function riga(r, stato, offline, nomeFornitore, pagamento) {
  return {
    pagamento: pagamento || null, iban: r.iban || '', dataFine: r.dataFine || '', ricezione: r.ricezione || '',
    id: r.id, path: r.path, rel: r.rel, cartella: r.cartella, nome: r.nome, ext: r.ext, size: r.size, mtime: r.mtime,
    impronta: r.impronta, tipo: r.tipo, fornitore: nomeFornitore || r.fornitore, fornitoreLetto: r.fornitore, piva: r.piva, cf: r.cf, numero: r.numero, data: r.data,
    importo: r.importo, cig: r.cig, cup: r.cup, scadenza: r.scadenza, segnatura: r.segnatura || null, striscia: r.striscia || null, segnaturaDaLeggere: segnale(r, 'segnatura-da-leggere'), segnaturaNonLetta: segnale(r, 'segnatura-non-letta'), firme: r.firme, firmatari: r.firmatari,
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
    this.gruppi = null; // P.IVA → nome più frequente (ricalcolato quando cambiano i documenti)
    this.imp = { durataDurc: 120 };
    this.indici = null; // DURC e tracciabilità per P.IVA (ricalcolati quando cambiano i documenti)
    this.oggi = null; // data di riferimento (i test la fissano)
  }

  impostazioni(imp) { this.imp = { ...this.imp, ...imp }; this.indici = null; }
  #indici() { return (this.indici ??= indiciFornitori(this.rec.values(), this.imp)); }
  /** Semaforo «pronta per il pagamento» di una fattura (null per gli altri documenti). */
  pagamento(r) { return r.tipo === 'fattura' ? prontaPerPagamento(r, this.stato(r), this.#indici(), this.oggi ? { oggi: this.oggi } : {}) : null; }
  #riga(r) { return riga(r, this.stato(r), this.offline.has(r.cartella), this.nomeFornitore(r), this.pagamento(r)); }

  /**
   * Pratica collegata: i documenti con lo stesso numero di protocollo, CIG o CUP, in ordine cronologico.
   * → { chiavi: { protocollo, cig[], cup[] }, documenti: [riga + perche[]] }
   */
  pratica(id) {
    const r0 = this.rec.get(id);
    if (!r0) return null;
    const s0 = this.stato(r0);
    const prot = s0?.protocollo === 'fatto' ? numeroConfrontabile(s0.numeroProtocollo) : '';
    const cig = new Set(r0.cig || []); const cup = new Set(r0.cup || []);
    const out = [];
    for (const r of this.rec.values()) {
      const perche = [];
      if (prot) { const s = this.stato(r); if (s?.protocollo === 'fatto' && numeroConfrontabile(s.numeroProtocollo) === prot) perche.push('protocollo'); }
      if ((r.cig || []).some((x) => cig.has(x))) perche.push('CIG');
      if ((r.cup || []).some((x) => cup.has(x))) perche.push('CUP');
      if (perche.length || r.id === id) out.push({ ...this.#riga(r), perche, questo: r.id === id });
    }
    const d = (x) => x.data || isoDaMs(x.mtime);
    out.sort((a, b) => d(a).localeCompare(d(b)) || coll.compare(a.nome, b.nome));
    return { chiavi: { protocollo: s0?.protocollo === 'fatto' ? s0.numeroProtocollo : '', cig: [...cig], cup: [...cup] }, documenti: out.slice(0, 500) };
  }

  /** Scheda del fornitore (P.IVA): nome, DURC, dichiarazioni di tracciabilità, fatture non pagate. */
  fornitore(piva) {
    if (!piva) return null;
    const ind = this.#indici();
    const fatture = [];
    for (const r of this.rec.values()) if (r.piva === piva && r.tipo === 'fattura') { const s = this.stato(r); if (s?.pagamento !== 'fatto') fatture.push(this.#riga(r)); }
    fatture.sort((a, b) => (a.pagamento?.previsto || '').localeCompare(b.pagamento?.previsto || ''));
    return { piva, nome: this.nomiPerPiva().get(piva) || '', durc: (ind.durc.get(piva) || []).slice(0, 5), tracciabilita: (ind.tracciabilita.get(piva) || []).slice(0, 5), fattureNonPagate: fatture.slice(0, 100), totaleNonPagate: fatture.length };
  }

  /** Fornitori raggruppati per P.IVA: «Delta Lab», «Delta Lab S.n.c.», «Spett.le Delta Lab» sono lo stesso. */
  nomiPerPiva() {
    if (this.gruppi) return this.gruppi;
    const conta = new Map();
    for (const r of this.rec.values()) {
      if (!r.piva || !r.fornitore) continue;
      let m = conta.get(r.piva); if (!m) conta.set(r.piva, (m = new Map()));
      const k = r.fornitore.trim(); m.set(k, (m.get(k) || 0) + 1);
    }
    this.gruppi = new Map([...conta].map(([p, m]) => [p, [...m].sort((a, b) => b[1] - a[1] || a[0].length - b[0].length)[0][0]]));
    return this.gruppi;
  }
  nomeFornitore(r) { return (r.piva && this.nomiPerPiva().get(r.piva)) || r.fornitore || ''; }

  get size() { return this.rec.size; }

  metti(r) {
    this.gruppi = null; this.indici = null;
    this.rec.set(r.id, r);
    this.norm.set(r.id, normalizza(r.testo || ''));
    this.meta.set(r.id, normalizza([r.nome, r.rel, r.fornitore, r.piva, r.cf, r.numero, r.segnatura?.numero, r.segnatura?.aoo, ...(r.cig || []), ...(r.cup || []), ...(r.firmatari || [])].join(' \u0001 ')));
  }
  togli(id) { this.gruppi = null; this.indici = null; this.rec.delete(id); this.norm.delete(id); this.meta.delete(id); }
  get(id) { return this.rec.get(id); }
  /** Stato d'ufficio più la segnatura di protocollo letta dal documento. */
  stato(r) { return conSegnatura(r?.impronta ? this.stati.get(r.impronta) : null, r?.segnatura); }
  riga(id) { const r = this.rec.get(id); return r ? this.#riga(r) : null; }

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
    const prot = f.protocollo ? numeroConfrontabile(f.protocollo) : '';
    const out = [];
    for (const r of this.rec.values()) {
      if (f.tipo && r.tipo !== f.tipo) continue;
      if (f.cartella && r.cartella !== f.cartella) continue;
      if (forn && !normalizza(`${r.fornitore || ''} ${this.nomeFornitore(r)} ${r.piva || ''} ${r.cf || ''}`).includes(forn)) continue;
      if (f.dal || f.al) {
        const d = r.data || isoDaMs(r.mtime);
        if (!d || (f.dal && d < f.dal) || (f.al && d > f.al)) continue;
      }
      if (cc && !(r.cig || []).some((x) => x.includes(cc)) && !(r.cup || []).some((x) => x.includes(cc))) continue;
      if (f.stato && !haStato(this.stato(r), f.stato)) continue;
      if (prot && !numeroConfrontabile(this.stato(r)?.numeroProtocollo).includes(prot)) continue;
      if (f.uor || f.protDal || f.protAl) {
        const s = this.stato(r);
        if (f.uor && !String(s?.uorProtocollo || '').toUpperCase().includes(String(f.uor).toUpperCase().trim())) continue;
        const d = s?.protocollo === 'fatto' ? s.dataProtocollo || '' : '';
        if ((f.protDal || f.protAl) && (!d || (f.protDal && d < f.protDal) || (f.protAl && d > f.protAl))) continue;
      }
      if (f.segnale && !segnale(r, f.segnale)) continue;
      if ((f.scadDal || f.scadAl) && (!r.scadenza || (f.scadDal && r.scadenza < f.scadDal) || (f.scadAl && r.scadenza > f.scadAl))) continue;
      if (f.pronta) { const p = this.pagamento(r); if (!p || (f.pronta === 'da-controllare' ? !['rosso', 'giallo'].includes(p.esito) : p.esito !== f.pronta)) continue; }
      if (f.nonPagate) { const s = this.stato(r); if (s?.pagamento || s?.archiviato) continue; }
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
          if (TIPO_PAROLE[t] === r.tipo) score += 80; // «durc», «fattura»…: prima i documenti di quel tipo
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
      out.push({ r, score, pos, f: f.ordine === 'fornitore' ? this.nomeFornitore(r) : '', prot: f.ordine === 'protocollo' ? this.stato(r)?.numeroProtocollo : '' });
    }
    ordina(out, f.ordine || (termini.length ? 'pertinenza' : 'data-desc'));
    const limite = Math.min(f.limite || 20000, 50000);
    return {
      totale: out.length,
      righe: out.slice(0, limite).map(({ r, pos }) => ({ ...this.#riga(r), pagina: pos >= 0 ? paginaDi(r.testo || '', pos) : null })),
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
    const tipi = {}; const forn = new Map(); const etichette = new Map(); const cartelle = {}; const segnali = { scansione: 0, protetto: 0, errore: 0, firmato: 0, 'segnatura-letta': 0, 'segnatura-da-leggere': 0, 'segnatura-non-letta': 0 };
    let protocollati = 0;
    for (const r of this.rec.values()) {
      if (r.segnatura?.numero) protocollati++;
      tipi[r.tipo] = (tipi[r.tipo] || 0) + 1;
      cartelle[r.cartella] = (cartelle[r.cartella] || 0) + 1;
      if (r.fornitore || r.piva) { const k = r.piva || normalizza(r.fornitore).replace(/[^a-z0-9]+/g, ' ').trim(); const g = forn.get(k) || { nome: this.nomeFornitore(r) || r.piva, piva: r.piva || '', n: 0 }; g.n++; forn.set(k, g); }
      for (const s of Object.keys(segnali)) if (segnale(r, s)) segnali[s]++;
    }
    for (const s of this.stati.values()) for (const e of s.etichette || []) etichette.set(e, (etichette.get(e) || 0) + 1);
    return {
      totale: this.rec.size, tipi, cartelle, segnali, segnatureLette: protocollati,
      fornitori: [...forn.values()].sort((a, b) => b.n - a.n).slice(0, 800),
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
  if (s === 'segnatura-da-leggere') return !!r.striscia && !r.segnatura?.numero && !r.segnaturaOcr;
  if (s === 'segnatura-non-letta') return !!r.striscia && !r.segnatura?.numero && !!r.segnaturaOcr;
  if (s === 'segnatura-letta') return !!r.segnatura?.numero;
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
  { id: 'protocollo', label: 'N. protocollo' },
];

function ordina(list, ordine) {
  const d = (x) => x.r.data || isoDaMs(x.r.mtime);
  const cmp = {
    pertinenza: (a, b) => b.score - a.score || d(b).localeCompare(d(a)),
    'data-desc': (a, b) => d(b).localeCompare(d(a)) || coll.compare(a.r.nome, b.r.nome),
    'data-asc': (a, b) => d(a).localeCompare(d(b)) || coll.compare(a.r.nome, b.r.nome),
    'aggiunto-desc': (a, b) => (b.r.aggiunto || 0) - (a.r.aggiunto || 0),
    nome: (a, b) => coll.compare(a.r.nome, b.r.nome),
    fornitore: (a, b) => (a.f ? 0 : 1) - (b.f ? 0 : 1) || coll.compare(a.f || '', b.f || '') || d(b).localeCompare(d(a)),
    'importo-desc': (a, b) => (b.r.importo ?? -1) - (a.r.importo ?? -1),
    protocollo: (a, b) => { const pa = numeroConfrontabile(a.prot); const pb = numeroConfrontabile(b.prot); return (pa ? 0 : 1) - (pb ? 0 : 1) || (pa.length - pb.length) || pa.localeCompare(pb); },
    scadenza: (a, b) => (a.r.scadenza ? 0 : 1) - (b.r.scadenza ? 0 : 1) || (a.r.scadenza || '').localeCompare(b.r.scadenza || ''),
  }[ordine] || ((a, b) => b.score - a.score);
  list.sort(cmp);
}
