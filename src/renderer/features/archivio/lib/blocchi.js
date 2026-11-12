// Disposizione dell'indice su disco a blocchi NDJSON (una riga = un documento).
//
// Perché a blocchi: con migliaia di documenti riscrivere un unico file a ogni aggiornamento
// sarebbe lento; un database nativo (SQLite) richiederebbe moduli compilati per ogni sistema.
// Ogni blocco ha al massimo DIM documenti. Le scritture sono «copia e sostituisci»:
//   1. ogni blocco cambiato viene scritto con un NOME NUOVO (file temporaneo + fsync + rename);
//   2. poi si scrive il manifesto (stesso metodo) che elenca i blocchi validi;
//   3. solo dopo si eliminano i blocchi vecchi.
// Se l'app si chiude a metà, il manifesto punta sempre a blocchi completi: al riavvio
// i file orfani vengono eliminati e i documenti mancanti vengono semplicemente riletti.
// Logica pura (nessun accesso al disco): produce l'elenco delle scritture da fare.

export const DIM = 250;
export const FORMATO = 'leggio-archivio-indice';
export const VERSIONE_INDICE = 1;

export class Blocchi {
  constructor() {
    this.blocchi = new Map(); // chiave → { chiave, file, ids:Set }
    this.dove = new Map(); // id → chiave
    this.sporchi = new Set();
    this.seq = 0; // contatore per i nomi dei file
    this.aperto = null; // chiave del blocco in cui vanno i nuovi documenti
  }

  /** Ricostruisce lo stato dal manifesto caricato. blocchi: [{ file, ids:[...] }] */
  carica(manifesto, blocchi) {
    this.seq = manifesto?.seq || 0;
    for (const b of blocchi) {
      const chiave = b.chiave || b.file;
      const bl = { chiave, file: b.file, ids: new Set(b.ids) };
      this.blocchi.set(chiave, bl);
      for (const id of b.ids) {
        const prima = this.dove.get(id);
        // lo stesso documento in due blocchi (non dovrebbe succedere): vale l'ultimo, l'altro va riscritto
        if (prima && prima !== chiave) { this.blocchi.get(prima)?.ids.delete(id); this.sporchi.add(prima); }
        this.dove.set(id, chiave);
      }
      if (bl.ids.size < DIM) this.aperto = chiave;
    }
  }

  #nuovoBlocco() {
    const chiave = 'k' + (++this.seq).toString(36);
    const bl = { chiave, file: null, ids: new Set() };
    this.blocchi.set(chiave, bl);
    return bl;
  }

  /** Un documento è stato aggiunto o aggiornato. */
  metti(id) {
    const k = this.dove.get(id);
    if (k) { this.sporchi.add(k); return; }
    let bl = this.aperto && this.blocchi.get(this.aperto);
    if (!bl || bl.ids.size >= DIM) { bl = this.#nuovoBlocco(); this.aperto = bl.chiave; }
    bl.ids.add(id); this.dove.set(id, bl.chiave); this.sporchi.add(bl.chiave);
  }

  /** Un documento è stato tolto dall'indice. */
  togli(id) {
    const k = this.dove.get(id);
    if (!k) return;
    this.blocchi.get(k)?.ids.delete(id);
    this.dove.delete(id);
    this.sporchi.add(k);
  }

  get daScrivere() { return this.sporchi.size > 0; }

  /**
   * Prepara la scrittura dei blocchi cambiati. riga(id) → stringa JSON del documento.
   * → { scrivi: [{ file, testo }], manifesto, elimina: [file] } (null se non c'è niente da scrivere)
   * Le scritture vanno fatte una alla volta: dopo che sono riuscite chiamare conferma(piano),
   * se falliscono annulla(piano). I cambiamenti arrivati nel frattempo restano da scrivere.
   */
  prepara(riga) {
    if (!this.sporchi.size) return null;
    const sporchi = new Set(this.sporchi);
    this.sporchi.clear();
    const scrivi = []; const elimina = []; const nuoviFile = new Map();
    for (const k of sporchi) {
      const bl = this.blocchi.get(k);
      if (!bl) continue;
      if (bl.file) elimina.push(bl.file);
      if (!bl.ids.size) { nuoviFile.set(k, null); continue; }
      const file = `b-${k}-${(++this.seq).toString(36)}.ndjson`;
      const righe = [];
      for (const id of bl.ids) { const s = riga(id); if (s) righe.push(s); }
      scrivi.push({ file, testo: righe.join('\n') + '\n' });
      nuoviFile.set(k, file);
    }
    const blocchiManifesto = [];
    for (const bl of this.blocchi.values()) {
      const file = nuoviFile.has(bl.chiave) ? nuoviFile.get(bl.chiave) : bl.file;
      if (file && bl.ids.size) blocchiManifesto.push({ chiave: bl.chiave, file, n: bl.ids.size });
    }
    const manifesto = { formato: FORMATO, versione: VERSIONE_INDICE, seq: this.seq, scritto: Date.now(), blocchi: blocchiManifesto };
    return { scrivi, manifesto, elimina, nuoviFile, sporchi };
  }

  conferma(piano) {
    for (const [k, file] of piano.nuoviFile) {
      const bl = this.blocchi.get(k);
      if (!bl) continue;
      if (file) bl.file = file;
      else if (!bl.ids.size) { this.blocchi.delete(k); if (this.aperto === k) this.aperto = null; }
      else { bl.file = null; this.sporchi.add(k); } // riempito di nuovo durante la scrittura
    }
  }

  /** Scrittura non riuscita: i blocchi restano da scrivere (si riproverà). */
  annulla(piano) { for (const k of piano.sporchi) if (this.blocchi.has(k)) this.sporchi.add(k); }

  /** Svuota tutto (indice cancellato). */
  azzera() { this.blocchi.clear(); this.dove.clear(); this.sporchi.clear(); this.aperto = null; }
}

/** Legge un blocco NDJSON tollerando righe rovinate. → { docs, rovinate } */
export function leggiBlocco(testo) {
  const docs = []; let rovinate = 0;
  for (const line of String(testo || '').split('\n')) {
    if (!line.trim()) continue;
    try { const d = JSON.parse(line); if (d && typeof d.id === 'string') docs.push(d); else rovinate++; } catch { rovinate++; }
  }
  return { docs, rovinate };
}

/** Controlla un manifesto letto dal disco. → manifesto valido o null */
export function manifestoValido(m) {
  if (!m || m.formato !== FORMATO || !Array.isArray(m.blocchi)) return null;
  const blocchi = m.blocchi.filter((b) => b && typeof b.file === 'string' && /^b-[a-z0-9]+-[a-z0-9]+\.ndjson$/.test(b.file));
  return { ...m, blocchi };
}
