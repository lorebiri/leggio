// «Organizza pagine»: griglia a tutto schermo con miniature grandi.
// Le modifiche si fanno su un modello locale (istantaneo, con Annulla/Ripeti propri) e vengono
// applicate al documento in un solo passaggio annullabile («Applica» o «Salva»).
import { openPdfJs } from '../../../core/pdf.js';
import { icon } from '../../../core/icons.js';
import { applicaDisposizione, caricaPdf, inserisciDaPdf } from '../logica/struttura.js';
import { pdfDaImmagini } from '../logica/crea.js';
import { indiciInTesto } from '../logica/util.js';
import { caricaEsterno, preparaImmagine, eImmagine, ePdf, leggiFile, analizzaPagina, mostraErrore, apriRisultato, nomeRisultato, FILTRO_TUTTI } from './comune.js';
import { apriVeloce } from '../logica/struttura.js';
import { salva } from '../logica/util.js';
import { modificaDoc } from './comune.js';

const controllori = new Map(); // doc.id → Organizza
let seq = 1;
const nuovoId = () => 'i' + seq++;

export function apriOrganizza(app, opzioni = {}) {
  const doc = app.activeDoc;
  if (!doc) return;
  let c = controllori.get(doc.id);
  if (!c) { c = new Organizza(app, doc); controllori.set(doc.id, c); }
  c.mostra();
  if (opzioni.selezione) c.seleziona(opzioni.selezione);
  return c;
}
export function organizzaAperto(app) { const c = app.activeDoc && controllori.get(app.activeDoc.id); return c && !c.root.hidden ? c : null; }

export function installaOrganizza(app) {
  app.bus.on('document:activated', ({ doc }) => {
    for (const [id, c] of controllori) c.root.hidden = !(doc && id === doc.id && c.aperto);
  });
  app.bus.on('document:closed', ({ doc }) => { const c = controllori.get(doc.id); if (c) { c.distruggi(); controllori.delete(doc.id); } });
  app.bus.on('document:changed', ({ doc }) => { const c = controllori.get(doc.id); if (c && c.aperto) c.documentoCambiato(); });
}

class Organizza {
  constructor(app, doc) {
    this.app = app; this.doc = doc;
    this.items = []; this.esterni = new Map();
    this.sel = new Set(); this.anchor = null; this.focus = null;
    this.storia = []; this.futuro = []; this.modificato = false;
    this.zoom = app.settings.get('pagine.org.zoom', 190);
    this.cache = new Map(); // chiave → { url, larghezza, rotDelta }
    this.dimensioni = new Map(); // chiave → [w, h]
    this.coda = []; this.inCorso = 0; this.applicando = false;
    this.cards = new Map();
    this.aperto = false;
    this.#costruisci();
    this.#ricostruisciModello();
  }

  // ---------------- modello ----------------
  #ricostruisciModello() {
    this.items = [];
    for (let i = 0; i < this.doc.pageCount; i++) this.items.push({ id: nuovoId(), tipo: 'pagina', indice: i, orig: i, rot: 0 });
    this.storia = []; this.futuro = []; this.modificato = false;
    this.sel.clear(); this.anchor = this.focus = null;
    this.#caricaDimensioni();
  }
  #istantanea() { return { items: this.items.map((x) => ({ ...x })), sel: [...this.sel] }; }
  #prima(etichetta) { this.storia.push({ ...this.#istantanea(), etichetta }); if (this.storia.length > 200) this.storia.shift(); this.futuro = []; }
  #dopo() { this.modificato = this.storia.length > 0; this.render(); }
  annulla() { const s = this.storia.pop(); if (!s) return this.app.ui.toast('Niente da annullare'); this.futuro.push(this.#istantanea()); this.items = s.items; this.sel = new Set(s.sel); this.modificato = this.storia.length > 0; this.render(); this.app.ui.toast('Annullato: ' + s.etichetta); }
  ripeti() { const s = this.futuro.pop(); if (!s) return; this.storia.push({ ...this.#istantanea(), etichetta: 'ripeti' }); this.items = s.items; this.sel = new Set(s.sel); this.modificato = true; this.render(); }

  selezionati() { return this.items.filter((x) => this.sel.has(x.id)); }
  seleziona(indici) { this.sel = new Set(indici.map((i) => this.items[i]?.id).filter(Boolean)); this.anchor = this.focus = [...this.sel][0] || null; this.render(); }
  #bersaglio(itDaMenu) { const s = this.selezionati(); if (s.length) return s; if (itDaMenu) return [itDaMenu]; return []; }
  #richiedi(azione, s) { if (!s.length) { this.app.ui.toast(`Seleziona prima le pagine da ${azione} (clic sulla miniatura, Ctrl o Maiusc per più pagine)`, { kind: 'warning', timeout: 5000 }); return false; } return true; }

  ruota(delta, it) {
    const s = this.#bersaglio(it); if (!this.#richiedi('ruotare', s)) return;
    this.#prima(delta > 0 ? 'Rotazione a destra' : 'Rotazione a sinistra');
    for (const x of s) x.rot = (((x.rot + delta) % 360) + 360) % 360;
    this.#dopo();
  }
  elimina(it, s = this.#bersaglio(it)) {
    if (!this.#richiedi('eliminare', s)) return;
    if (s.length >= this.items.length) { this.app.ui.toast('Non puoi eliminare tutte le pagine: un PDF deve averne almeno una.', { kind: 'warning' }); return; }
    this.#prima(s.length === 1 ? 'Pagina eliminata' : `${s.length} pagine eliminate`);
    const ids = new Set(s.map((x) => x.id));
    const primo = this.items.findIndex((x) => ids.has(x.id));
    this.items = this.items.filter((x) => !ids.has(x.id));
    this.sel.clear();
    const f = this.items[Math.min(primo, this.items.length - 1)]; this.focus = this.anchor = f?.id || null;
    this.#dopo();
    this.app.ui.toast(s.length === 1 ? 'Pagina eliminata' : `Eliminate ${s.length} pagine`, { kind: 'success', timeout: 10000, action: { label: 'Annulla', run: () => this.annulla() } });
  }
  duplica(it) {
    const s = this.#bersaglio(it); if (!this.#richiedi('duplicare', s)) return;
    this.#prima('Pagine duplicate');
    const ids = new Set(s.map((x) => x.id)); const out = []; const nuove = [];
    for (const x of this.items) { out.push(x); if (ids.has(x.id)) { const c = { ...x, id: nuovoId() }; out.push(c); nuove.push(c.id); } }
    this.items = out; this.sel = new Set(nuove);
    this.#dopo();
  }
  /** Sposta gli elementi selezionati prima della posizione pos (0..n, indice nel modello). */
  sposta(pos, s = this.selezionati()) {
    if (!s.length) return;
    const ids = new Set(s.map((x) => x.id));
    const prima = this.items.slice(0, pos).filter((x) => !ids.has(x.id));
    const dopo = this.items.slice(pos).filter((x) => !ids.has(x.id));
    const nuovo = [...prima, ...s, ...dopo];
    if (nuovo.every((x, k) => x === this.items[k])) return;
    this.#prima(s.length === 1 ? 'Pagina spostata' : 'Pagine spostate');
    this.items = nuovo; this.#dopo();
    this.#scorriA(s[0].id);
  }
  async spostaDialogo(it) {
    const s = this.#bersaglio(it); if (!this.#richiedi('spostare', s)) return;
    const n = this.items.length;
    const v = await this.app.ui.dialog({ title: 'Sposta pagine', message: s.length === 1 ? `Sposta la pagina ${this.items.indexOf(s[0]) + 1}.` : `Sposta le ${s.length} pagine selezionate.`, fields: [
      { name: 'dove', type: 'radio', value: 'pos', options: [{ value: 'inizio', label: 'All\'inizio del documento' }, { value: 'pos', label: 'Alla posizione indicata qui sotto' }, { value: 'fine', label: 'Alla fine del documento' }] },
      { name: 'pos', label: `Posizione (da 1 a ${n})`, type: 'number', min: 1, max: n, step: 1, value: Math.min(n, 1) },
    ], okLabel: 'Sposta', validate: (x) => (x.dove === 'pos' && !(Number.isInteger(x.pos) && x.pos >= 1 && x.pos <= n) ? `Scrivi una posizione tra 1 e ${n}.` : null) });
    if (!v) return;
    if (v.dove === 'inizio') return this.sposta(0, s);
    if (v.dove === 'fine') return this.sposta(n, s);
    // la pagina deve finire esattamente alla posizione scritta
    const resto = this.items.filter((x) => !s.includes(x));
    const pos = Math.min(v.pos - 1, resto.length);
    const target = resto[pos];
    this.sposta(target ? this.items.indexOf(target) : n, s);
  }
  inverti() {
    const s = this.selezionati(); const tutte = s.length < 2;
    this.#prima('Ordine invertito');
    if (tutte) this.items.reverse();
    else { const pos = s.map((x) => this.items.indexOf(x)).sort((a, b) => a - b); const rev = pos.map((p) => this.items[p]).reverse(); pos.forEach((p, k) => { this.items[p] = rev[k]; }); }
    this.#dopo();
  }
  #posInserimento(dove = 'dopo', it) {
    const s = it ? [it] : this.selezionati();
    if (!s.length) return dove === 'prima' ? 0 : this.items.length;
    const pos = s.map((x) => this.items.indexOf(x));
    return dove === 'prima' ? Math.min(...pos) : Math.max(...pos) + 1;
  }
  inserisciVuota(dove = 'dopo', it) {
    const pos = this.#posInserimento(dove, it);
    const vicino = this.items[Math.max(0, Math.min(pos - 1, this.items.length - 1))];
    const dim = vicino ? this.#dimItem(vicino) : [595.28, 841.89];
    const size = vicino && vicino.rot % 180 ? [dim[1], dim[0]] : dim;
    this.#prima('Pagina vuota inserita');
    const nuova = { id: nuovoId(), tipo: 'vuota', size, rot: 0 };
    this.items.splice(pos, 0, nuova);
    this.sel = new Set([nuova.id]); this.#dopo(); this.#scorriA(nuova.id);
  }
  async inserisciDaFile(dove = 'dopo', it) {
    const files = await this.app.platform.openFiles({ multiple: true, filters: FILTRO_TUTTI, raw: true, title: 'Scegli PDF o immagini da inserire' });
    if (files?.length) await this.#aggiungiFile(files, this.#posInserimento(dove, it));
  }
  async inserisciDaAperto(it) {
    const altri = this.app.docs.filter((d) => d !== this.doc);
    if (!altri.length) return this.app.ui.toast('Non ci sono altri documenti aperti. Apri un altro PDF in una nuova scheda.', { kind: 'warning' });
    const v = await this.app.ui.dialog({ title: 'Inserisci da un documento aperto', fields: [
      { name: 'd', label: 'Documento', type: 'select', value: String(altri[0].id), options: altri.map((d) => ({ value: String(d.id), label: `${d.name} (${d.pageCount} pagine)` })) },
      { name: 'p', label: 'Pagine da inserire', type: 'pages', value: '' },
    ], okLabel: 'Inserisci', validate: (x) => { const d = altri.find((y) => String(y.id) === x.d); try { this.app.ui.parsePageRanges(x.p, d.pageCount); } catch (e) { return e.message; } } });
    if (!v) return;
    const d = altri.find((y) => String(y.id) === v.d);
    const indici = this.app.ui.parsePageRanges(v.p, d.pageCount);
    const bytes = await this.app.currentBytes(d);
    await this.#aggiungiEsterno({ nome: d.name, bytes, password: d.password }, this.#posInserimento('dopo', it), indici);
  }
  async sostituisci(it) {
    const s = this.#bersaglio(it); if (!this.#richiedi('sostituire', s)) return;
    const files = await this.app.platform.openFiles({ multiple: false, filters: FILTRO_TUTTI, raw: true, title: 'Scegli il file con le pagine nuove' });
    if (!files?.length) return;
    const pos = this.items.indexOf(s[0]);
    const prima = this.items.length;
    const fattoPrima = this.storia.length;
    await this.#aggiungiFile(files, pos, { max: s.length });
    const aggiunte = this.items.length - prima;
    if (!aggiunte) return;
    // un solo passo di Annulla: unisce le due modifiche
    const ids = new Set(s.map((x) => x.id));
    this.items = this.items.filter((x) => !ids.has(x.id));
    if (this.storia.length > fattoPrima + 1) this.storia.splice(fattoPrima + 1);
    if (this.storia[fattoPrima]) this.storia[fattoPrima].etichetta = 'Pagine sostituite';
    this.#dopo();
    if (aggiunte !== s.length) this.app.ui.toast(`Sostituite ${s.length} pagine con ${aggiunte} pagine del file.`, { kind: 'warning', timeout: 7000 });
  }
  async #aggiungiFile(files, pos, { max } = {}) {
    let pos2 = pos;
    for (const f of files) {
      try {
        if (eImmagine(f.name)) {
          const img = await preparaImmagine(this.app, f.bytes, f.name);
          const d = await pdfDaImmagini([{ ...img, nome: f.name }], { formato: 'A4', margine: 10 });
          pos2 += await this.#aggiungiEsterno({ nome: f.name, bytes: await salva(d) }, pos2, null, max);
        } else if (ePdf(f.name) || f.bytes?.[0] === 0x25) {
          pos2 += await this.#aggiungiEsterno({ nome: f.name, bytes: f.bytes }, pos2, null, max);
        } else this.app.ui.toast(`«${f.name}» non è un PDF né un'immagine: ignorato`, { kind: 'warning' });
      } catch (err) { mostraErrore(this.app, err, `Impossibile inserire «${f.name}»`); }
      if (max != null) max -= pos2 - pos; // quante ne restano da sostituire
      if (max != null && max <= 0) break;
    }
  }
  async #aggiungiEsterno({ nome, bytes, password }, pos, indici, max) {
    const libDoc = await caricaEsterno(this.app, bytes, nome); // valida e chiede la password se serve
    if (!libDoc) return 0;
    const file = 'f' + seq++;
    // se protetto, salviamo una versione senza cifratura per anteprima e unione
    let b = bytes;
    if (libDoc.isEncrypted || password) b = await salva(libDoc);
    const { pdf } = await openPdfJs(b, { password });
    this.esterni.set(file, { nome, bytes: b, pdf });
    let idx = indici || [...Array(pdf.numPages).keys()];
    if (max != null) idx = idx.slice(0, Math.max(0, max));
    this.#prima(`Inserito «${nome}»`);
    const nuovi = idx.map((i) => ({ id: nuovoId(), tipo: 'esterna', file, indice: i, rot: 0 }));
    this.items.splice(pos, 0, ...nuovi);
    this.sel = new Set(nuovi.map((x) => x.id));
    this.#dopo();
    if (nuovi[0]) this.#scorriA(nuovi[0].id);
    this.#caricaDimensioniEsterno(file, pdf);
    this.app.ui.toast(`Inserite ${nuovi.length} pagine da «${nome}»`, { kind: 'success' });
    return nuovi.length;
  }

  async pagineBianche() {
    const candidati = this.items.filter((x) => x.tipo !== 'vuota');
    const trovate = [];
    const ok = await this.app.ui.withProgress('Ricerca delle pagine bianche', async (p) => {
      for (let k = 0; k < candidati.length; k++) {
        if (p.cancelled) return false;
        const x = candidati[k];
        p.set(k / candidati.length, `Controllo la pagina ${this.items.indexOf(x) + 1} di ${this.items.length}`);
        const chiave = this.#chiave(x);
        let r = this.bianche?.get(chiave);
        if (r === undefined) {
          const { pdf, i } = this.#sorgente(x);
          r = (await analizzaPagina(pdf, i, { scala: 0.3 })).vuota;
          (this.bianche ||= new Map()).set(chiave, r);
        }
        if (r) trovate.push(x);
      }
      return true;
    });
    const vuote = this.items.filter((x) => x.tipo === 'vuota');
    const tutte = [...trovate, ...vuote];
    if (!ok) return;
    if (!tutte.length) return this.app.ui.toast('Nessuna pagina bianca trovata', { kind: 'success' });
    this.sel = new Set(tutte.map((x) => x.id)); this.render(); this.#scorriA(tutte[0].id);
    const elenco = indiciInTesto(tutte.map((x) => this.items.indexOf(x)));
    if (tutte.length >= this.items.length) return this.app.ui.toast('Tutte le pagine sembrano bianche: non le elimino.', { kind: 'warning' });
    const v = await this.app.ui.dialog({ title: 'Pagine bianche', message: `Ho trovato ${tutte.length === 1 ? '1 pagina bianca' : tutte.length + ' pagine bianche'}: ${elenco}.\nLe ho selezionate in verde: controllale prima di eliminarle.`, okLabel: tutte.length === 1 ? 'Elimina la pagina' : `Elimina ${tutte.length} pagine`, cancelLabel: 'Lascia solo selezionate' });
    if (v) this.elimina(null, tutte);
  }

  async estrai(it) {
    const s = this.#bersaglio(it); if (!this.#richiedi('estrarre', s)) return;
    const bytes = await this.#componi(s, 'Estrazione delle pagine');
    if (bytes) await apriRisultato(this.app, bytes, nomeRisultato(this.app, 'estratto', this.doc.name));
  }

  /** Costruisce i byte di un documento con gli elementi dati (senza toccare il documento). */
  async #componi(items, titolo) {
    return this.app.ui.withProgress(titolo, async (p) => {
      p.set(null, 'Preparazione…');
      const pdfDoc = await apriVeloce(await this.app.currentBytes(this.doc), this.doc.password);
      await applicaDisposizione(pdfDoc, this.#perLogica(items), await this.#esterniLib(items), { signal: p.signal });
      return salva(pdfDoc);
    }).catch((err) => { mostraErrore(this.app, err, titolo); return null; });
  }
  #perLogica(items) { return items.map((x) => ({ tipo: x.tipo, indice: x.indice, file: x.file, size: x.size, rot: x.rot })); }
  async #esterniLib(items) {
    const m = new Map();
    for (const x of items) if (x.tipo === 'esterna' && !m.has(x.file)) m.set(x.file, await caricaPdf(this.esterni.get(x.file).bytes, { nome: this.esterni.get(x.file).nome }));
    return m;
  }

  /** Applica il modello al documento (un solo passo annullabile). */
  async applica({ salva = false } = {}) {
    if (this.applicando) return false;
    if (this.modificato) {
      this.applicando = true;
      const vecchi = this.items.map((x) => ({ chiave: this.#chiave(x), rot: x.rot }));
      try {
        const ok = await this.app.ui.withProgress('Applicazione delle modifiche', async (p) => {
          p.set(null, `Riorganizzo ${this.items.length} pagine…`);
          const items = this.#perLogica(this.items); const est = await this.#esterniLib(this.items);
          return modificaDoc(this.app, 'Pagine organizzate', async (pdfDoc) => { await applicaDisposizione(pdfDoc, items, est, { signal: p.signal }); }, this.doc);
        }, { cancellable: false });
        if (!ok) return false;
        // le miniature già pronte restano valide: la rotazione ora è nel file
        const cache = new Map();
        vecchi.forEach((v, k) => { const c = this.cache.get(v.chiave); if (c) cache.set('p:' + k, { ...c, rotDelta: (c.rotDelta || 0) - v.rot }); });
        const dims = new Map(); vecchi.forEach((v, k) => { const d = this.dimensioni.get(v.chiave); if (d) dims.set('p:' + k, v.rot % 180 ? [d[1], d[0]] : d); });
        for (const [k, c] of this.cache) if (![...cache.values()].some((x) => x.url === c.url)) URL.revokeObjectURL(c.url);
        this.cache = cache; this.dimensioni = dims; this.bianche = null;
        this.#ricostruisciModello(); this.render();
      } catch (err) { mostraErrore(this.app, err, 'Organizza pagine'); return false; }
      finally { this.applicando = false; }
    }
    if (salva) return this.app.save(this.doc);
    return true;
  }
  documentoCambiato() {
    if (this.applicando) return;
    if (this.modificato) this.app.ui.toast('Il documento è cambiato: le modifiche non applicate in «Organizza pagine» sono state annullate.', { kind: 'warning', timeout: 7000 });
    for (const c of this.cache.values()) URL.revokeObjectURL(c.url);
    this.cache.clear(); this.dimensioni.clear(); this.bianche = null; this.coda = [];
    this.#ricostruisciModello(); this.render();
  }

  async chiudi() {
    if (this.modificato) {
      const v = await this.app.ui.dialog({ title: 'Modifiche non applicate', message: 'Vuoi applicare le modifiche alle pagine prima di chiudere?', fields: [{ name: 'a', type: 'radio', value: 'applica', options: [{ value: 'applica', label: 'Applica le modifiche' }, { value: 'scarta', label: 'Non applicare (le perdi)' }] }], okLabel: 'Chiudi', cancelLabel: 'Torna a «Organizza»' });
      if (!v) return false;
      if (v.a === 'applica' && !(await this.applica())) return false;
      if (v.a === 'scarta') this.#ricostruisciModello();
    }
    this.aperto = false; this.root.hidden = true;
    window.removeEventListener('keydown', this.onKey, true);
    this.app.el.root.classList.remove('pg-org-aperto');
    if (this.barraLaterale) { this.app.el.root.classList.remove('sidebar-closed'); this.barraLaterale = false; }
    return true;
  }
  mostra() {
    this.aperto = true; this.root.hidden = false;
    if (!this.root.isConnected) this.app.el.main.querySelector('.stage').append(this.root);
    window.addEventListener('keydown', this.onKey, true);
    this.app.el.root.classList.add('pg-org-aperto');
    // più spazio alla griglia: la barra laterale si richiude e torna com'era alla chiusura
    if (!this.app.el.root.classList.contains('sidebar-closed')) { this.barraLaterale = true; this.app.el.root.classList.add('sidebar-closed'); }
    this.render();
    requestAnimationFrame(() => { (this.cards.get(this.focus) || this.grid).focus({ preventScroll: true }); if (!this.focus) this.#scorriA(this.items[this.app.viewer.pageIndex]?.id); });
  }
  distruggi() {
    window.removeEventListener('keydown', this.onKey, true);
    this.io?.disconnect();
    for (const c of this.cache.values()) URL.revokeObjectURL(c.url);
    for (const e of this.esterni.values()) e.pdf?.loadingTask?.destroy();
    this.root.remove();
  }

  // ---------------- dimensioni e miniature ----------------
  #chiave(x) { return x.tipo === 'pagina' ? 'p:' + x.indice : x.tipo === 'esterna' ? `e:${x.file}:${x.indice}` : null; }
  #sorgente(x) { return x.tipo === 'pagina' ? { pdf: this.doc.pdf, i: x.indice } : { pdf: this.esterni.get(x.file).pdf, i: x.indice }; }
  #dimItem(x) { if (x.tipo === 'vuota') return x.size; return this.dimensioni.get(this.#chiave(x)) || this.dimBase || [595, 842]; }
  async #caricaDimensioni() {
    const pdf = this.doc.pdf; const n = this.doc.pageCount; const token = (this.tokenDim = {});
    try {
      const p1 = await pdf.getPage(1); const v = p1.getViewport({ scale: 1 }); this.dimBase = [v.width, v.height];
      for (let a = 0; a < n; a += 64) {
        if (this.tokenDim !== token || pdf !== this.doc.pdf) return;
        const pages = await Promise.all([...Array(Math.min(64, n - a)).keys()].map((k) => pdf.getPage(a + k + 1)));
        pages.forEach((pg, k) => { const vp = pg.getViewport({ scale: 1 }); this.dimensioni.set('p:' + (a + k), [vp.width, vp.height]); });
        if (this.aperto) this.#aggiornaBox();
      }
    } catch { /* documento chiuso o ricaricato */ }
  }
  async #caricaDimensioniEsterno(file, pdf) {
    for (let i = 0; i < pdf.numPages; i++) {
      try { const pg = await pdf.getPage(i + 1); const vp = pg.getViewport({ scale: 1 }); this.dimensioni.set(`e:${file}:${i}`, [vp.width, vp.height]); } catch { return; }
      if (i % 32 === 31) this.#aggiornaBox();
    }
    this.#aggiornaBox();
  }
  #misureBox(x) {
    const [w0, h0] = this.#dimItem(x);
    const rotTot = x.rot + (this.cache.get(this.#chiave(x))?.rotDelta || 0);
    const [w, h] = x.rot % 180 ? [h0, w0] : [w0, h0];
    const maxW = this.zoom, maxH = this.zoom * 1.3;
    const s = Math.min(maxW / w, maxH / h);
    return { bw: Math.round(w * s), bh: Math.round(h * s), rotTot };
  }
  #aggiornaBox() { for (const x of this.items) { const c = this.cards.get(x.id); if (c) this.#stileBox(c, x); } }
  #stileBox(card, x) {
    const box = card.firstChild; const img = box.querySelector('img');
    const { bw, bh, rotTot } = this.#misureBox(x);
    box.style.width = bw + 'px'; box.style.height = bh + 'px';
    const r = ((rotTot % 360) + 360) % 360;
    img.style.width = (r % 180 ? bh : bw) + 'px'; img.style.height = (r % 180 ? bw : bh) + 'px';
    img.style.transform = `translate(-50%, -50%) rotate(${r}deg)`;
  }
  #richiediMiniatura(x) {
    const k = this.#chiave(x); if (!k) return;
    const voluta = Math.round(this.zoom * Math.min(2, devicePixelRatio || 1) * 1.3);
    const c = this.cache.get(k);
    if (c && c.larghezza >= voluta * 0.75) return;
    if (this.coda.some((q) => q.k === k)) return;
    this.coda.push({ k, x, voluta });
    this.#lavora();
  }
  async #lavora() {
    while (this.inCorso < 2 && this.coda.length) {
      // priorità alle miniature visibili adesso
      const vis = this.coda.findIndex((q) => this.visibili?.has(q.x.id));
      const [q] = this.coda.splice(vis >= 0 ? vis : 0, 1);
      if (!this.visibili?.has(q.x.id) && !this.items.includes(q.x)) continue;
      this.inCorso++;
      this.#disegna(q).finally(() => { this.inCorso--; this.#lavora(); });
    }
  }
  async #disegna({ k, x, voluta }) {
    let page;
    try {
      const { pdf, i } = this.#sorgente(x);
      page = await pdf.getPage(i + 1);
      const vp0 = page.getViewport({ scale: 1 });
      this.dimensioni.set(k, [vp0.width, vp0.height]);
      const lato = Math.max(vp0.width, vp0.height / 1.3);
      const vp = page.getViewport({ scale: Math.min(4, voluta / lato) });
      const cv = document.createElement('canvas'); cv.width = Math.ceil(vp.width); cv.height = Math.ceil(vp.height);
      const ctx = cv.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
      await page.render({ canvasContext: ctx, canvas: cv, viewport: vp }).promise;
      const blob = await new Promise((r) => cv.toBlob(r, 'image/jpeg', 0.82));
      cv.width = cv.height = 0;
      const vecchia = this.cache.get(k);
      const url = URL.createObjectURL(blob);
      this.cache.set(k, { url, larghezza: voluta, rotDelta: 0 });
      if (vecchia) setTimeout(() => URL.revokeObjectURL(vecchia.url), 1000);
      for (const y of this.items) if (this.#chiave(y) === k) { const c = this.cards.get(y.id); if (c) { c.querySelector('img').src = url; c.classList.add('pronta'); this.#stileBox(c, y); } }
    } catch { /* documento ricaricato: verrà ridisegnata */ }
    finally { page?.cleanup(); }
  }

  // ---------------- interfaccia ----------------
  #costruisci() {
    const { h } = this.app.ui; const ic = (n, s = 18) => this.app.ui.h('span', { class: 'pg-ico', html: iconSvg(this.app, n, s) });
    const B = (label, icona, onclick, extra = {}) => h('button', { type: 'button', class: 'pg-tb-btn', onclick, title: extra.title || label, ...extra }, ic(icona), h('span', {}, label));
    this.info = h('span', { class: 'pg-org-info' });
    this.zoomIn = h('input', { type: 'range', min: 110, max: 420, step: 10, value: this.zoom, 'aria-label': 'Grandezza miniature' });
    this.zoomIn.addEventListener('input', () => this.#impostaZoom(+this.zoomIn.value));
    this.btnAnnulla = B('Annulla', 'undo', () => this.annulla(), { title: 'Annulla (Ctrl+Z)' });
    this.btnRipeti = B('Ripeti', 'redo', () => this.ripeti(), { title: 'Ripeti (Ctrl+Maiusc+Z)' });
    this.btnApplica = h('button', { type: 'button', class: 'btn', onclick: () => this.applica() }, 'Applica');
    this.btnSalva = h('button', { type: 'button', class: 'btn primary', onclick: () => this.applica({ salva: true }), title: 'Applica le modifiche e salva il file (Ctrl+S)' }, 'Salva');
    const menuInserisci = (e) => this.app.ui.contextMenu(e.currentTarget.getBoundingClientRect().left, e.currentTarget.getBoundingClientRect().bottom + 4, [
      { label: 'Pagina vuota', icon: 'file', run: () => this.inserisciVuota() },
      { label: 'Da file (PDF o foto)…', icon: 'open', run: () => this.inserisciDaFile() },
      { label: 'Da un documento aperto…', icon: 'pages', run: () => this.inserisciDaAperto() },
      '-', { label: 'Sostituisci le pagine selezionate…', icon: 'convert', run: () => this.sostituisci() },
    ]);
    const menuAltro = (e) => this.app.ui.contextMenu(e.currentTarget.getBoundingClientRect().left, e.currentTarget.getBoundingClientRect().bottom + 4, [
      { label: 'Trova ed elimina pagine bianche…', icon: 'sparkles', run: () => this.pagineBianche() },
      { label: 'Inverti l\'ordine', icon: 'convert', run: () => this.inverti() },
      { label: 'Sposta alla posizione…', icon: 'chevronRight', run: () => this.spostaDialogo() },
      '-',
      { label: 'Seleziona tutte', run: () => this.#selTutte(() => true), hint: 'Ctrl+A' },
      { label: 'Seleziona pagine pari', run: () => this.#selTutte((x, k) => k % 2 === 1) },
      { label: 'Seleziona pagine dispari', run: () => this.#selTutte((x, k) => k % 2 === 0) },
      { label: 'Seleziona pagine orizzontali', run: () => this.#selTutte((x) => { const [w, hh] = this.#dimItem(x); return (x.rot % 180 ? hh : w) > (x.rot % 180 ? w : hh); }) },
      { label: 'Seleziona pagine verticali', run: () => this.#selTutte((x) => { const [w, hh] = this.#dimItem(x); return (x.rot % 180 ? hh : w) <= (x.rot % 180 ? w : hh); }) },
      { label: 'Deseleziona tutto', run: () => { this.sel.clear(); this.render(); } },
    ]);
    const bar = h('div', { class: 'pg-org-bar', role: 'toolbar', 'aria-label': 'Comandi di Organizza pagine' },
      h('div', { class: 'pg-org-title' }, h('strong', {}, 'Organizza pagine'), this.info),
      h('div', { class: 'pg-tb-group' },
        B('Inserisci', 'plus', menuInserisci, { 'aria-haspopup': 'menu' }),
        B('Ruota a sinistra', 'rotateLeft', () => this.ruota(-90), { title: 'Ruota a sinistra (Maiusc+R)' }),
        B('Ruota a destra', 'rotate', () => this.ruota(90), { title: 'Ruota a destra (R)' }),
        B('Elimina', 'trash', () => this.elimina(), { title: 'Elimina (Canc)' }),
        B('Duplica', 'copy', () => this.duplica(), { title: 'Duplica (Ctrl+D)' }),
        B('Estrai', 'export', () => this.estrai(), { title: 'Copia le pagine selezionate in un nuovo documento' }),
        B('Pagine bianche', 'sparkles', () => this.pagineBianche(), { title: 'Trova ed elimina le pagine bianche (con conferma)' }),
        B('Altro', 'chevronDown', menuAltro, { 'aria-haspopup': 'menu' })),
      h('div', { class: 'pg-tb-group' }, this.btnAnnulla, this.btnRipeti),
      h('div', { class: 'pg-tb-spacer' }),
      h('label', { class: 'pg-zoom', title: 'Grandezza delle miniature (anche Ctrl + rotellina)' }, ic('minus', 14), this.zoomIn, ic('plus', 14)),
      h('div', { class: 'pg-org-fine' }, h('button', { type: 'button', class: 'btn', onclick: () => this.chiudi() }, 'Chiudi'), this.btnApplica, this.btnSalva));
    this.grid = h('div', { class: 'pg-org-grid', role: 'listbox', 'aria-multiselectable': 'true', 'aria-label': 'Pagine del documento', tabindex: 0 });
    this.marker = h('div', { class: 'pg-marker', hidden: true });
    this.scroll = h('div', { class: 'pg-org-scroll' }, this.grid, this.marker);
    this.suggerimento = h('div', { class: 'pg-org-hint' }, 'Clic per selezionare · Ctrl o Maiusc + clic per più pagine · trascina per spostare (anche su un\'altra scheda) · trascina qui PDF e foto dal computer');
    this.root = h('section', { class: 'pg-org', hidden: true, 'aria-label': 'Organizza pagine' }, bar, this.scroll, this.suggerimento);
    this.root.style.setProperty('--pg-zoom', this.zoom + 'px');
    this.io = new IntersectionObserver((entries) => {
      this.visibili ||= new Set();
      for (const e of entries) {
        const id = e.target.dataset.id;
        if (e.isIntersecting) { this.visibili.add(id); const x = this.items.find((y) => y.id === id); if (x) this.#richiediMiniatura(x); }
        else this.visibili.delete(id);
      }
    }, { root: this.scroll, rootMargin: '400px 0px' });
    this.#eventi();
  }

  #impostaZoom(z) {
    this.zoom = Math.max(110, Math.min(420, z)); this.zoomIn.value = this.zoom;
    this.root.style.setProperty('--pg-zoom', this.zoom + 'px');
    this.app.settings.set('pagine.org.zoom', this.zoom);
    this.#aggiornaBox();
    for (const x of this.items) if (this.visibili?.has(x.id)) this.#richiediMiniatura(x);
  }
  #selTutte(fn) { this.sel = new Set(this.items.filter(fn).map((x) => x.id)); this.render(); }

  render() {
    if (!this.aperto) return;
    const { h } = this.app.ui;
    const frag = document.createDocumentFragment();
    const vivi = new Set();
    this.items.forEach((x, k) => {
      vivi.add(x.id);
      let c = this.cards.get(x.id);
      if (!c) {
        const img = h('img', { alt: '', draggable: 'false' });
        const strumenti = h('div', { class: 'pg-card-tools' },
          h('button', { type: 'button', class: 'pg-mini', title: 'Ruota a sinistra', 'aria-label': 'Ruota a sinistra', 'data-az': 'sx', html: iconSvg(this.app, 'rotateLeft', 17) }),
          h('button', { type: 'button', class: 'pg-mini', title: 'Ruota a destra', 'aria-label': 'Ruota a destra', 'data-az': 'dx', html: iconSvg(this.app, 'rotate', 17) }),
          h('button', { type: 'button', class: 'pg-mini danger', title: 'Elimina', 'aria-label': 'Elimina', 'data-az': 'del', html: iconSvg(this.app, 'trash', 17) }));
        c = h('div', { class: 'pg-card', 'data-id': x.id, role: 'option', tabindex: -1 },
          h('div', { class: 'pg-box' }, img, x.tipo === 'vuota' ? h('span', { class: 'pg-vuota' }, 'Pagina vuota') : null, strumenti, h('span', { class: 'pg-check', html: iconSvg(this.app, 'check', 14) })),
          h('div', { class: 'pg-num' }));
        const ch = this.cache.get(this.#chiave(x));
        if (ch) { img.src = ch.url; c.classList.add('pronta'); }
        if (x.tipo === 'vuota') c.classList.add('pronta', 'vuota');
        this.cards.set(x.id, c); this.io.observe(c);
      }
      const ch = this.cache.get(this.#chiave(x));
      const img = c.querySelector('img');
      if (ch && img.getAttribute('src') !== ch.url) { img.src = ch.url; c.classList.add('pronta'); }
      this.#stileBox(c, x);
      const sel = this.sel.has(x.id);
      c.classList.toggle('selected', sel); c.setAttribute('aria-selected', String(sel));
      c.classList.toggle('focus', this.focus === x.id);
      const etichetta = x.tipo === 'esterna' ? `da ${this.esterni.get(x.file)?.nome || 'file'}` : x.tipo === 'pagina' && x.orig !== k ? `era la ${x.orig + 1}` : '';
      const num = c.lastChild; num.textContent = String(k + 1);
      if (etichetta) num.append(h('small', {}, etichetta));
      if (x.rot) num.append(h('small', { class: 'pg-rot' }, `↻ ${x.rot}°`));
      c.setAttribute('aria-label', `Pagina ${k + 1}${etichetta ? ', ' + etichetta : ''}${x.rot ? ', ruotata di ' + x.rot + ' gradi' : ''}`);
      frag.append(c);
    });
    for (const [id, c] of this.cards) if (!vivi.has(id)) { this.io.unobserve(c); c.remove(); this.cards.delete(id); this.visibili?.delete(id); }
    this.grid.append(frag);
    const n = this.items.length, s = this.sel.size;
    this.info.textContent = `${this.doc.name} · ${n} ${n === 1 ? 'pagina' : 'pagine'}${s ? ` · ${s} ${s === 1 ? 'selezionata' : 'selezionate'}` : ''}${this.modificato ? ' · modifiche da applicare' : ''}`;
    this.btnAnnulla.disabled = !this.storia.length; this.btnRipeti.disabled = !this.futuro.length;
    this.btnApplica.disabled = !this.modificato;
    this.root.classList.toggle('modificato', this.modificato);
  }

  #scorriA(id) { requestAnimationFrame(() => this.cards.get(id)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })); }

  #clic(x, e) {
    const k = this.items.indexOf(x);
    if (e.shiftKey && this.anchor) {
      const a = this.items.findIndex((y) => y.id === this.anchor);
      if (!(e.metaKey || e.ctrlKey)) this.sel.clear();
      for (let i = Math.min(a, k); i <= Math.max(a, k); i++) this.sel.add(this.items[i].id);
    } else if (e.metaKey || e.ctrlKey) { this.sel.has(x.id) ? this.sel.delete(x.id) : this.sel.add(x.id); this.anchor = x.id; }
    else { this.sel = new Set([x.id]); this.anchor = x.id; }
    this.focus = x.id; this.render();
    this.cards.get(x.id)?.focus({ preventScroll: true });
  }

  #eventi() {
    const g = this.grid;
    g.addEventListener('click', (e) => {
      const card = e.target.closest('.pg-card');
      if (!card) { if (!e.shiftKey && !e.metaKey && !e.ctrlKey) { this.sel.clear(); this.render(); } return; }
      if (this.trascinato) { this.trascinato = false; return; }
      const x = this.items.find((y) => y.id === card.dataset.id); if (!x) return;
      const az = e.target.closest('[data-az]')?.dataset.az;
      if (az) {
        // i pulsanti sulla miniatura agiscono su di essa (o sulla selezione se ne fa parte)
        const bers = this.sel.has(x.id) ? undefined : x;
        if (!this.sel.has(x.id)) { this.sel = new Set([x.id]); this.anchor = x.id; }
        if (az === 'sx') this.ruota(-90, bers); else if (az === 'dx') this.ruota(90, bers); else this.elimina(bers);
        return;
      }
      this.#clic(x, e);
    });
    g.addEventListener('dblclick', (e) => {
      const card = e.target.closest('.pg-card'); if (!card || e.target.closest('[data-az]')) return;
      const x = this.items.find((y) => y.id === card.dataset.id);
      if (x?.tipo === 'pagina' && !this.modificato) { this.chiudi(); this.app.viewer.page = x.indice + 1; }
    });
    g.addEventListener('contextmenu', (e) => {
      const card = e.target.closest('.pg-card'); if (!card) return;
      e.preventDefault();
      const x = this.items.find((y) => y.id === card.dataset.id);
      if (!this.sel.has(x.id)) { this.sel = new Set([x.id]); this.anchor = this.focus = x.id; this.render(); }
      const n = this.sel.size;
      this.app.ui.contextMenu(e.clientX, e.clientY, [
        { label: 'Ruota a destra', icon: 'rotate', run: () => this.ruota(90), hint: 'R' },
        { label: 'Ruota a sinistra', icon: 'rotateLeft', run: () => this.ruota(-90), hint: '⇧R' },
        { label: n > 1 ? `Elimina ${n} pagine` : 'Elimina', icon: 'trash', danger: true, run: () => this.elimina(), hint: 'Canc' },
        { label: 'Duplica', icon: 'copy', run: () => this.duplica() },
        { label: 'Estrai in un nuovo documento', icon: 'export', run: () => this.estrai() },
        '-',
        { label: 'Sposta all\'inizio', icon: 'chevronUp', run: () => this.sposta(0) },
        { label: 'Sposta alla fine', icon: 'chevronDown', run: () => this.sposta(this.items.length) },
        { label: 'Sposta alla posizione…', icon: 'chevronRight', run: () => this.spostaDialogo() },
        '-',
        { label: 'Inserisci pagina vuota prima', icon: 'file', run: () => this.inserisciVuota('prima') },
        { label: 'Inserisci pagina vuota dopo', icon: 'file', run: () => this.inserisciVuota('dopo') },
        { label: 'Inserisci da file dopo…', icon: 'open', run: () => this.inserisciDaFile('dopo') },
        { label: 'Sostituisci con pagine da file…', icon: 'convert', run: () => this.sostituisci() },
      ]);
    });
    this.scroll.addEventListener('wheel', (e) => { if (e.ctrlKey || e.metaKey) { e.preventDefault(); this.#impostaZoom(this.zoom * Math.exp(-e.deltaY * 0.004)); } }, { passive: false });
    this.#trascinamento();
    this.#dropFile();
    this.onKey = (e) => this.#tasti(e);
  }

  #tasti(e) {
    if (this.root.hidden || document.querySelector('#overlay-root .backdrop, #overlay-root .ctx-menu, .tools-hub')) return;
    const t = e.target;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) && t.type !== 'range') return;
    const mod = e.metaKey || e.ctrlKey; const k = e.key;
    const stop = () => { e.preventDefault(); e.stopPropagation(); };
    if (mod && k.toLowerCase() === 'z') { stop(); return e.shiftKey ? this.ripeti() : this.annulla(); }
    if (mod && k.toLowerCase() === 'y') { stop(); return this.ripeti(); }
    if (mod && k.toLowerCase() === 's') { stop(); return this.applica({ salva: true }); }
    if (mod && k.toLowerCase() === 'a') { stop(); return this.#selTutte(() => true); }
    if (mod && k.toLowerCase() === 'd') { stop(); return this.duplica(); }
    if (k === 'Escape') { stop(); if (this.drag) return this.#fineTrascina(null); return this.chiudi(); }
    if (k === 'Delete' || k === 'Backspace') { stop(); return this.elimina(); }
    if (!mod && (k === 'r' || k === 'R')) { stop(); return this.ruota(e.shiftKey ? -90 : 90); }
    if (k === 'Enter' && this.focus) { stop(); const x = this.items.find((y) => y.id === this.focus); if (x) this.#clic(x, { ctrlKey: false }); return; }
    if (k === ' ' && this.focus) { stop(); const x = this.items.find((y) => y.id === this.focus); if (x) this.#clic(x, { ctrlKey: true }); return; }
    const frecce = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: 'su', ArrowDown: 'giu', Home: 'inizio', End: 'fine' };
    if (k in frecce) {
      stop();
      const i = Math.max(0, this.items.findIndex((y) => y.id === this.focus));
      const perRiga = Math.max(1, Math.round(this.grid.clientWidth / ((this.cards.values().next().value?.offsetWidth || 200) + 16)));
      const d = frecce[k];
      let j = d === 'su' ? i - perRiga : d === 'giu' ? i + perRiga : d === 'inizio' ? 0 : d === 'fine' ? this.items.length - 1 : i + d;
      j = Math.max(0, Math.min(this.items.length - 1, j));
      if (e.altKey && this.sel.size) { this.sposta(j > i ? j + 1 : j); return; } // Alt+frecce: sposta la selezione
      const x = this.items[j]; if (!x) return;
      if (e.shiftKey) this.#clic(x, { shiftKey: true });
      else { this.focus = x.id; if (!mod) { this.sel = new Set([x.id]); this.anchor = x.id; } this.render(); this.cards.get(x.id)?.focus(); }
      this.#scorriA(x.id);
    }
  }

  // ---------------- trascinamento delle pagine ----------------
  #trascinamento() {
    let start = null;
    this.grid.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || e.target.closest('[data-az]')) return;
      const card = e.target.closest('.pg-card'); if (!card) return;
      start = { x: e.clientX, y: e.clientY, id: card.dataset.id, pid: e.pointerId };
    });
    window.addEventListener('pointermove', (e) => {
      if (!start || this.root.hidden) return;
      if (!this.drag) {
        if (Math.hypot(e.clientX - start.x, e.clientY - start.y) < 7) return;
        this.#inizioTrascina(start.id, e);
      }
      this.#muoviTrascina(e);
    });
    window.addEventListener('pointerup', (e) => { if (this.drag) { this.trascinato = true; this.#fineTrascina(e); } start = null; });
    window.addEventListener('pointercancel', () => { if (this.drag) this.#fineTrascina(null); start = null; });
  }
  #inizioTrascina(id, e) {
    if (!this.sel.has(id)) { this.sel = new Set([id]); this.anchor = this.focus = id; this.render(); }
    const s = this.selezionati();
    const { h } = this.app.ui;
    const prima = this.cards.get(s[0].id)?.querySelector('img');
    const ghost = h('div', { class: 'pg-ghost' }, prima?.src ? h('img', { src: prima.src }) : h('div', { class: 'pg-ghost-vuota' }), s.length > 1 ? h('span', { class: 'pg-badge' }, String(s.length)) : null);
    document.body.append(ghost);
    for (const x of s) this.cards.get(x.id)?.classList.add('trascinata');
    this.drag = { s, ghost, pos: null, tab: null };
    this.root.classList.add('trascinando');
    document.body.style.cursor = 'grabbing';
    this.#autoscroll();
  }
  #muoviTrascina(e) {
    const d = this.drag; if (!d) return;
    d.ghost.style.transform = `translate(${e.clientX + 12}px, ${e.clientY + 12}px)`;
    d.ultimo = { x: e.clientX, y: e.clientY };
    // sopra una scheda di un altro documento?
    const tab = document.elementFromPoint(e.clientX, e.clientY)?.closest?.('.tab');
    document.querySelectorAll('.tab.pg-drop-tab').forEach((t) => t !== tab && t.classList.remove('pg-drop-tab'));
    const altro = tab ? this.#docDiScheda(tab) : null;
    if (altro && altro !== this.doc) { tab.classList.add('pg-drop-tab'); d.tab = altro; this.marker.hidden = true; d.pos = null; return; }
    d.tab = null;
    d.pos = this.#posizioneDa(e.clientX, e.clientY);
  }
  #docDiScheda(tab) { const tabs = [...document.querySelectorAll('.tabs .tab')]; return this.app.docs[tabs.indexOf(tab)] || null; }
  /** Posizione di inserimento (0..n) dal punto e disegna l'indicatore. */
  #posizioneDa(cx, cy) {
    const cards = this.items.map((x) => this.cards.get(x.id));
    if (!cards.length) return 0;
    const sr = this.scroll.getBoundingClientRect();
    if (cy < sr.top || cy > sr.bottom || cx < sr.left || cx > sr.right) { this.marker.hidden = true; return null; }
    let best = null, bd = Infinity;
    for (let k = 0; k < cards.length; k++) {
      const r = cards[k].getBoundingClientRect();
      if (r.bottom < sr.top - 50 || r.top > sr.bottom + 50) continue;
      const dy = cy < r.top ? r.top - cy : cy > r.bottom ? cy - r.bottom : 0;
      const dx = cx < r.left ? r.left - cx : cx > r.right ? cx - r.right : 0;
      const dist = dy * 4 + dx;
      if (dist < bd) { bd = dist; best = { k, r }; }
    }
    if (!best) return null;
    const dopo = cx > best.r.left + best.r.width / 2;
    const pos = best.k + (dopo ? 1 : 0);
    const gr = this.scroll.getBoundingClientRect();
    this.marker.hidden = false;
    this.marker.style.height = best.r.height + 'px';
    this.marker.style.transform = `translate(${(dopo ? best.r.right + 6 : best.r.left - 6) - gr.left + this.scroll.scrollLeft - 2}px, ${best.r.top - gr.top + this.scroll.scrollTop}px)`;
    return pos;
  }
  #autoscroll() {
    const passo = () => {
      if (!this.drag && !this.dropFile) return;
      const p = this.drag?.ultimo || this.dropFile;
      if (p) {
        const r = this.scroll.getBoundingClientRect(); const zona = 70;
        let v = 0;
        if (p.y < r.top + zona) v = -Math.ceil((r.top + zona - p.y) / 5);
        else if (p.y > r.bottom - zona) v = Math.ceil((p.y - (r.bottom - zona)) / 5);
        if (v) { this.scroll.scrollTop += Math.max(-18, Math.min(18, v)); if (this.drag) this.drag.pos = this.#posizioneDa(p.x, p.y); }
      }
      requestAnimationFrame(passo);
    };
    requestAnimationFrame(passo);
  }
  async #fineTrascina(e) {
    const d = this.drag; this.drag = null;
    d.ghost.remove(); this.marker.hidden = true; this.root.classList.remove('trascinando'); document.body.style.cursor = '';
    document.querySelectorAll('.pg-drop-tab').forEach((t) => t.classList.remove('pg-drop-tab'));
    for (const x of d.s) this.cards.get(x.id)?.classList.remove('trascinata');
    if (!e) return;
    if (d.tab) return this.#copiaInDocumento(d.tab, d.s);
    if (d.pos != null) this.sposta(d.pos, d.s);
  }
  async #copiaInDocumento(dest, items) {
    const bytes = await this.#componi(items, 'Copia delle pagine');
    if (!bytes) return;
    try {
      const ok = await modificaDoc(this.app, `Pagine copiate da «${this.doc.name}»`, async (pdfDoc) => {
        const src = await caricaPdf(bytes);
        await inserisciDaPdf(pdfDoc, src, [...Array(src.getPageCount()).keys()], pdfDoc.getPageCount());
      }, dest);
      if (ok) this.app.ui.toast(`${items.length === 1 ? 'Pagina copiata' : items.length + ' pagine copiate'} in fondo a «${dest.name}»`, { kind: 'success', timeout: 8000, action: { label: 'Vai', run: () => this.app.activate(dest) } });
    } catch (err) { mostraErrore(this.app, err, 'Copia delle pagine'); }
  }

  // ---------------- file trascinati dal computer ----------------
  #dropFile() {
    const s = this.scroll;
    s.addEventListener('dragover', (e) => {
      if (!e.dataTransfer?.types?.includes('Files')) return;
      e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = 'copy';
      const primo = !this.dropFile;
      this.dropFile = { x: e.clientX, y: e.clientY };
      this.dropPos = this.#posizioneDa(e.clientX, e.clientY);
      if (primo) this.#autoscroll();
    });
    s.addEventListener('dragleave', (e) => { if (!s.contains(e.relatedTarget)) { this.dropFile = null; this.marker.hidden = true; } });
    s.addEventListener('drop', async (e) => {
      if (!e.dataTransfer?.files?.length) return;
      e.preventDefault(); e.stopPropagation();
      this.app.el.root.classList.remove('dragging');
      const pos = this.dropPos ?? this.items.length;
      this.dropFile = null; this.marker.hidden = true;
      const files = [];
      for (const f of e.dataTransfer.files) files.push(await leggiFile(f));
      await this.#aggiungiFile(files, pos);
    });
  }
}

function iconSvg(_app, nome, size) { return icon(nome, size); }
