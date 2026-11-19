// Assistente IA — indice per la ricerca per significato nell'archivio.
// Per ogni documento (identificato dalla sua impronta SHA-256, come nell'archivio): i passaggi di testo con la
// pagina e i loro vettori. Su disco: un file NDJSON (una riga per documento, vettori Float32 in base64),
// riscritto in modo atomico. Resta solo in userData/ia/indice: «Cancella indice» lo elimina.
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

const f32b64 = (arr) => Buffer.from(new Float32Array(arr).buffer).toString('base64');
const b64f32 = (s) => { const b = Buffer.from(s, 'base64'); return new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4); };

function normalizza(v) {
  const a = Float32Array.from(v);
  let n = 0; for (let i = 0; i < a.length; i++) n += a[i] * a[i];
  n = Math.sqrt(n) || 1; for (let i = 0; i < a.length; i++) a[i] /= n;
  return a;
}

class Indice {
  constructor(cartella) {
    this.cartella = cartella;
    this.file = path.join(cartella, 'indice.ndjson');
    this.doc = new Map(); // impronta → { modello, passaggi: [{pagina, testo}], vettori: Float32Array[] }
    this.caricato = false; this.modificato = false; this.scrittura = null;
  }

  async carica() {
    if (this.caricato) return;
    this.caricato = true;
    let testo = '';
    try { testo = await fsp.readFile(this.file, 'utf8'); } catch { return; }
    for (const riga of testo.split('\n')) {
      if (!riga.trim()) continue;
      try {
        const r = JSON.parse(riga);
        this.doc.set(r.impronta, { modello: r.modello, passaggi: r.passaggi, vettori: r.vettori.map(b64f32) });
      } catch { /* riga danneggiata: quel documento verrà ricalcolato */ }
    }
  }

  ha(impronta, modello) { const d = this.doc.get(impronta); return !!d && (!modello || d.modello === modello); }

  metti(impronta, modello, passaggi, vettori) {
    this.doc.set(impronta, { modello, passaggi: passaggi.map((p) => ({ pagina: p.pagina, testo: String(p.testo).slice(0, 2000) })), vettori: vettori.map(normalizza) });
    this.modificato = true;
  }

  togli(impronte) { let n = 0; for (const i of impronte) if (this.doc.delete(i)) n++; if (n) this.modificato = true; return n; }

  /** Impronte conosciute, così il renderer manda solo i documenti nuovi. */
  impronte(modello) { return [...this.doc.entries()].filter(([, d]) => !modello || d.modello === modello).map(([k]) => k); }

  info() { let p = 0; for (const d of this.doc.values()) p += d.passaggi.length; return { documenti: this.doc.size, passaggi: p }; }

  /**
   * I passaggi più vicini alla domanda (coseno). Un documento compare con il suo passaggio migliore.
   * filtro: Set di impronte ammesse (facoltativo). → [{ impronta, pagina, testo, punteggio }]
   */
  cerca(vettore, { k = 20, filtro = null, perDocumento = true } = {}) {
    const q = normalizza(vettore);
    const migliori = new Map();
    const tutti = [];
    for (const [imp, d] of this.doc) {
      if (filtro && !filtro.has(imp)) continue;
      for (let i = 0; i < d.vettori.length; i++) {
        const v = d.vettori[i];
        if (v.length !== q.length) continue;
        let s = 0; for (let j = 0; j < v.length; j++) s += v[j] * q[j];
        const voce = { impronta: imp, pagina: d.passaggi[i].pagina, testo: d.passaggi[i].testo, punteggio: s };
        if (perDocumento) { const m = migliori.get(imp); if (!m || m.punteggio < s) migliori.set(imp, voce); } else tutti.push(voce);
      }
    }
    return (perDocumento ? [...migliori.values()] : tutti).sort((a, b) => b.punteggio - a.punteggio).slice(0, k);
  }

  async salva() {
    if (!this.modificato) return false;
    this.modificato = false;
    const fai = async () => {
      await fsp.mkdir(this.cartella, { recursive: true });
      const tmp = this.file + '.tmp';
      const out = fs.createWriteStream(tmp);
      for (const [impronta, d] of this.doc) {
        const riga = JSON.stringify({ impronta, modello: d.modello, passaggi: d.passaggi, vettori: d.vettori.map(f32b64) }) + '\n';
        if (!out.write(riga)) await new Promise((r) => out.once('drain', r));
      }
      await new Promise((ok, ko) => out.end((e) => (e ? ko(e) : ok())));
      await fsp.rename(tmp, this.file);
    };
    this.scrittura = (this.scrittura || Promise.resolve()).then(fai, fai);
    await this.scrittura;
    return true;
  }

  async cancella() {
    this.doc.clear(); this.modificato = false;
    await fsp.rm(this.file, { force: true });
    await fsp.rm(this.file + '.tmp', { force: true });
  }
}

module.exports = { Indice, normalizza };
