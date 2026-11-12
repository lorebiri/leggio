// L'archivio d'ufficio: cartelle collegate, indice in un Web Worker, indicizzazione incrementale
// in sottofondo (annullabile, ripresa al riavvio), stati d'ufficio, «Oggi».
// Nessun file originale viene mai spostato o modificato.
import { PDFJS_ASSETS } from '../../core/pdf.js';
import { Rpc, Pool } from './rpc.js';
import { isDesktop, storeDesktop, storeWeb, idDa, sepPercorso, percorsiSenzaMaiuscole } from './store.js';
import { datiDaTesto, VERSIONE_ESTRAZIONE, CODICI_ENTE_PREDEFINITI } from './lib/estrai.js';
import { IMPOSTAZIONI_PREDEFINITE } from './lib/scadenze.js';
import { oggiIso } from './lib/testo.js';

const MAX_LETTURA = 200 * 1024 * 1024;
const TEMPO_FILE = 60000;
const OGNI_QUANTO_SCRIVERE = 4000; // ms durante l'indicizzazione
const AGGIORNA_OGNI = 15 * 60 * 1000;

const estensione = (n) => (String(n).match(/\.([^.\\/]+)$/)?.[1] || '').toLowerCase();
const nomeDi = (p) => String(p).split(/[\\/]/).pop();

export class Archivio {
  constructor(app) {
    this.app = app;
    this.store = isDesktop() ? storeDesktop(app) : storeWeb();
    this.ci = percorsiSenzaMaiuscole();
    this.motore = new Rpc(() => new Worker(new URL('./motore.worker.js', import.meta.url), { type: 'module', name: 'archivio-motore' }));
    this.motore.call('piattaforma', { ci: this.ci });
    this.pool = null;
    this.cartelle = [];
    this.offline = new Map(); // id cartella → messaggio
    this.caricato = false;
    this.lavoro = null; // indicizzazione in corso
    this.avanzamento = { fase: 'inattivo' };
    this.ascoltatori = new Set();
    this.versione = 0; // cambia quando l'indice o gli stati cambiano
    this.scrittura = null;
    this.timerScrittura = null;
    this.ultimoErroreScrittura = 0;
    // «nuovi dall'ultima apertura»: soglia fissata all'avvio, «visto fino a» aggiornato durante la sessione
    this.soglia = app.settings.get('archivio.vistoFino', 0);
    this.misure = { ultime: [] };
  }

  on(fn) { this.ascoltatori.add(fn); return () => this.ascoltatori.delete(fn); }
  emit(tipo, dati = {}) { for (const f of this.ascoltatori) { try { f(tipo, dati); } catch (e) { console.error(e); } } }
  #cambiato() { this.versione++; this.emit('cambiato'); }

  get attivo() { return this.cartelle.length > 0; }
  impostazioni() {
    const s = this.app.settings;
    return {
      durataDurc: +s.get('archivio.durataDurc', IMPOSTAZIONI_PREDEFINITE.durataDurc) || IMPOSTAZIONI_PREDEFINITE.durataDurc,
      preavvisoDurc: +s.get('archivio.preavvisoDurc', IMPOSTAZIONI_PREDEFINITE.preavvisoDurc) || 0,
      preavvisoFatture: +s.get('archivio.preavvisoFatture', IMPOSTAZIONI_PREDEFINITE.preavvisoFatture) || 0,
    };
  }
  codiciEnte() {
    const v = this.app.settings.get('archivio.codiciEnte', CODICI_ENTE_PREDEFINITI.join(', '));
    return String(v).split(/[\s,;]+/).map((x) => x.replace(/\D/g, '')).filter((x) => x.length === 11);
  }

  // ---------------- avvio e caricamento ----------------
  async avvia() {
    const r = await this.store.cartelle();
    this.cartelle = r.cartelle || [];
    this.datiDir = r.dati;
    this.emit('cartelle');
    if (!this.attivo && !(await this.#haIndice())) { this.caricato = true; this.emit('caricato'); return; }
    await this.carica();
    if (this.attivo) setTimeout(() => this.aggiorna({ motivo: 'avvio' }).catch((e) => this.app.log?.('warn', 'archivio: aggiornamento non riuscito', { e: e.message })), 2500);
    clearInterval(this.timerAgg);
    this.timerAgg = setInterval(() => { if (this.attivo && !this.lavoro) this.aggiorna({ motivo: 'periodico', silenzioso: true }).catch(() => {}); }, AGGIORNA_OGNI);
  }
  async #haIndice() { try { const m = await this.store.manifesto(); return !!m?.manifesto?.blocchi?.length; } catch { return false; } }

  /** Carica indice e stati dal disco nel worker. */
  async carica() {
    const t0 = performance.now();
    const { manifesto: grezzo, orfani } = await this.store.manifesto();
    const { manifesto } = await this.motore.call('carica-inizio', { manifesto: grezzo });
    const blocchi = [];
    let mancanti = 0;
    for (const b of manifesto?.blocchi || []) {
      let testo = null;
      try { testo = await this.store.blocco(b.file); } catch { testo = null; }
      if (testo == null) { mancanti++; continue; } // i documenti mancanti verranno riletti alla prossima scansione
      blocchi.push(await this.motore.call('carica-blocco', { chiave: b.chiave, file: b.file, testo }));
    }
    const fine = await this.motore.call('carica-fine', { manifesto, blocchi });
    const st = await this.store.statiLeggi();
    await this.motore.call('stati', { testo: st?.testo || null });
    if (st?.riserva) this.app.ui.toast('Il file degli stati d\'ufficio era rovinato: è stata usata la copia di riserva.', { kind: 'warning', timeout: 8000 });
    this.caricato = true;
    this.misure.caricamento = { ms: Math.round(performance.now() - t0), documenti: fine.n, rovinate: fine.rovinate, mancanti, orfani };
    if (fine.rovinate || mancanti) this.app.log?.('warn', 'archivio: indice parzialmente rovinato, i documenti verranno riletti', this.misure.caricamento);
    this.emit('caricato');
    this.#cambiato();
  }

  // ---------------- cartelle ----------------
  async aggiungiCartella(percorso, files) {
    const r = await this.store.aggiungiCartella(percorso, files);
    if (!r) return null;
    if (r.assorbite?.length) for (const id of r.assorbite) await this.motore.call('togli-cartella', { cartella: id });
    const prima = this.attivo;
    this.cartelle = (await this.store.cartelle()).cartelle;
    if (!prima && !this.caricato) await this.carica();
    if (!this.timerAgg) this.timerAgg = setInterval(() => { if (this.attivo && !this.lavoro) this.aggiorna({ motivo: 'periodico', silenzioso: true }).catch(() => {}); }, AGGIORNA_OGNI);
    this.emit('cartelle');
    if (r.avviso) this.app.ui.toast(r.avviso, { kind: 'info', timeout: 7000 });
    this.aggiorna({ cartelle: [r.cartella.id], motivo: 'nuova' }).catch((e) => this.app.reportError(e, 'Indicizzazione non riuscita'));
    return r.cartella;
  }

  async togliCartella(id) {
    if (this.lavoro) this.interrompi();
    await this.lavoro?.promise?.catch(() => {});
    await this.store.togliCartella(id);
    await this.motore.call('togli-cartella', { cartella: id });
    this.cartelle = this.cartelle.filter((c) => c.id !== id);
    this.offline.delete(id);
    await this.#aggiornaOffline();
    await this.scriviOra();
    this.emit('cartelle');
    this.#cambiato();
  }
  async #aggiornaOffline() { await this.motore.call('offline', { cartelle: [...this.offline.keys()] }); }

  // ---------------- indicizzazione ----------------
  /** Scansiona le cartelle (tutte o alcune) e legge i documenti nuovi o cambiati. */
  aggiorna({ cartelle, motivo = '', silenzioso = false } = {}) {
    if (this.lavoro) {
      // già in corso: le cartelle richieste vengono aggiunte alla coda
      if (cartelle) for (const id of cartelle) this.lavoro.extra.add(id);
      return this.lavoro.promise;
    }
    const lavoro = { annullato: false, extra: new Set(), motivo, silenzioso };
    this.lavoro = lavoro;
    lavoro.promise = this.#esegui(lavoro, cartelle || this.cartelle.map((c) => c.id)).finally(() => {
      if (this.lavoro === lavoro) this.lavoro = null;
      this.emit('avanzamento', this.avanzamento);
    });
    return lavoro.promise;
  }

  interrompi() {
    if (!this.lavoro) return;
    this.lavoro.annullato = true;
    this.avanzamento = { ...this.avanzamento, fase: 'interruzione' };
    this.emit('avanzamento', this.avanzamento);
  }

  #pool() {
    if (!this.pool) {
      const n = Math.max(1, Math.min(3, (navigator.hardwareConcurrency || 4) - 2));
      const assets = { cMapUrl: PDFJS_ASSETS.cMapUrl, cMapPacked: true, standardFontDataUrl: PDFJS_ASSETS.standardFontDataUrl, wasmUrl: PDFJS_ASSETS.wasmUrl };
      this.pool = new Pool(() => new Worker(new URL('./estrai.worker.js', import.meta.url), { type: 'module', name: 'archivio-estrazione' }), { n, ricicla: 150, init: (rpc) => rpc.post({ t: 'assets', assets }) });
    }
    return this.pool;
  }

  async #esegui(lavoro, ids) {
    const t0 = performance.now();
    const av = this.avanzamento = { fase: 'scansione', fatti: 0, totale: 0, letti: 0, riusati: 0, errori: 0, rimossi: 0, corrente: '', inizio: Date.now(), saltati: [] };
    this.emit('avanzamento', av);
    const daFare = []; const spariti = [];
    const coda = [...ids];
    const tScan = performance.now();
    while (coda.length || lavoro.extra.size) {
      if (!coda.length) { coda.push(...lavoro.extra); lavoro.extra.clear(); }
      const id = coda.shift();
      const c = this.cartelle.find((x) => x.id === id);
      if (!c || lavoro.annullato) continue;
      av.corrente = c.nome; this.emit('avanzamento', av);
      let s;
      try { s = await this.store.scansiona(id); }
      catch (e) { s = { raggiungibile: false, errore: e.message, file: [] }; }
      if (!s.raggiungibile) {
        this.offline.set(id, s.errore);
        if (!lavoro.silenzioso) this.app.ui.toast(s.errore, { kind: 'warning', timeout: 10000 });
        continue;
      }
      this.offline.delete(id);
      if (s.illeggibili?.length) this.offline.set(id + ':parziale', `${s.illeggibili.length} sottocartelle di «${c.nome}» non leggibili`);
      else this.offline.delete(id + ':parziale');
      const sep = isDesktop() ? sepPercorso() : '/';
      const conf = await this.motore.call('confronta', { cartella: id, base: c.percorso, file: s.file, sep, protetti: (s.illeggibili || []).map((x) => x.rel), parziale: !!s.troncato });
      // i documenti spariti si tolgono DOPO la lettura: se sono stati solo spostati o rinominati,
      // la loro impronta permette di riusare l'estrazione già fatta
      spariti.push(...conf.spariti);
      for (const f of conf.daLeggere) daFare.push({ c, rel: f[0], size: f[1], mtime: f[2], sep });
    }
    await this.#aggiornaOffline();
    av.msScansione = Math.round(performance.now() - tScan);
    av.fase = 'lettura'; av.totale = daFare.length;
    this.emit('avanzamento', av);

    // lettura: più file in parallelo (lettura dal disco nel main, estrazione nei worker)
    const pool = daFare.length ? this.#pool() : null;
    let prossimo = 0; let ultimoEmit = 0; let ultimaScrittura = performance.now();
    const tLett = performance.now();
    const operaio = async () => {
      while (!lavoro.annullato && prossimo < daFare.length) {
        const item = daFare[prossimo++];
        await this.#indicizzaUno(item, pool, av);
        av.fatti++;
        const ora = performance.now();
        if (ora - ultimoEmit > 250) { ultimoEmit = ora; this.emit('avanzamento', av); }
        if (ora - ultimaScrittura > OGNI_QUANTO_SCRIVERE) { ultimaScrittura = ora; this.scriviOra().catch(() => {}); this.#cambiato(); }
      }
    };
    await Promise.all(Array.from({ length: pool ? pool.size + 1 : 0 }, operaio));
    av.msLettura = Math.round(performance.now() - tLett);
    if (spariti.length && !lavoro.annullato) { await this.motore.call('togli', { ids: spariti }); av.rimossi = spariti.length; }
    await this.scriviOra();
    av.fase = lavoro.annullato ? 'interrotto' : 'fatto';
    av.ms = Math.round(performance.now() - t0);
    av.fine = Date.now();
    this.misure.ultime.unshift({ ...av, saltati: av.saltati.length });
    this.misure.ultime.length = Math.min(this.misure.ultime.length, 10);
    this.app.log?.('info', 'archivio: aggiornamento', { motivo: lavoro.motivo, fatti: av.fatti, totale: av.totale, riusati: av.riusati, errori: av.errori, rimossi: av.rimossi, ms: av.ms, msScansione: av.msScansione });
    // le risorse dei worker di estrazione si liberano quando non servono
    if (this.pool && !lavoro.annullato) { this.pool.terminate(); this.pool = null; }
    else if (this.pool && lavoro.annullato) { this.pool.terminate(); this.pool = null; }
    this.emit('avanzamento', av);
    this.#cambiato();
    return av;
  }

  async #indicizzaUno({ c, rel, size, mtime, sep }, pool, av) {
    const path = c.percorso + sep + rel;
    const nome = nomeDi(rel);
    const id = idDa(path, this.ci);
    av.corrente = rel;
    const base = { id, path, rel, cartella: c.id, nome, ext: estensione(nome), size, mtime, aggiunto: Date.now(), indicizzato: Date.now(), v: VERSIONE_ESTRAZIONE };
    let letto;
    try { letto = await this.store.leggi(path, MAX_LETTURA); }
    catch (e) {
      av.errori++;
      // il file potrebbe tornare leggibile (bloccato, rete): si riprova al prossimo aggiornamento
      await this.motore.call('metti', { doc: { ...base, ...datiDaTesto('', { nome }), testo: '', errore: 'Non leggibile: ' + e.message, erroreTemporaneo: true } });
      av.saltati.push({ rel, motivo: e.message });
      return;
    }
    const doc = { ...base, impronta: letto.impronta, size: letto.size, mtime: letto.mtime };
    if (await this.motore.call('riusa', { doc })) { av.riusati++; return; }
    if (letto.troppoGrande || !letto.bytes) {
      await this.motore.call('metti', { doc: { ...doc, ...datiDaTesto('', { nome }), testo: '', errore: 'File troppo grande (oltre 200 MB): cercabile solo per nome' } });
      av.saltati.push({ rel, motivo: 'troppo grande' });
      return;
    }
    let r;
    try {
      const bytes = letto.bytes;
      r = await pool.esegui('estrai', { bytes, nome, escludi: this.codiciEnte() }, [bytes.buffer], TEMPO_FILE);
      av.letti++;
    } catch (e) {
      av.errori++;
      if (e.dettaglio) this.app.log?.('warn', 'archivio: estrazione non riuscita', { rel, e: e.message, stack: e.dettaglio });
      r = { ...datiDaTesto('', { nome }), testo: '', errore: e.message || 'Non leggibile' };
    }
    if (r.errore || r.protetto) av.saltati.push({ rel, motivo: r.protetto ? 'protetto da password' : r.errore });
    const res = await this.motore.call('metti', { doc: { ...doc, ...r, v: VERSIONE_ESTRAZIONE } });
    if (res?.statiCambiati) await this.#salvaStati();
  }

  /** Scrive su disco i blocchi cambiati (una scrittura alla volta, atomica). */
  scriviOra() {
    if (this.scrittura) { this.scritturaDiNuovo = true; return this.scrittura; }
    this.scrittura = (async () => {
      try {
        for (let i = 0; i < 50; i++) {
          this.scritturaDiNuovo = false;
          const piano = await this.motore.call('prepara-scrittura');
          if (!piano) break;
          let ok = false;
          try { await this.store.scrivi(piano); ok = true; }
          catch (e) {
            if (Date.now() - this.ultimoErroreScrittura > 60000) { this.ultimoErroreScrittura = Date.now(); this.app.ui.toast('Non riesco a salvare l\'indice dell\'archivio: ' + e.message + ' Riproverò più tardi.', { kind: 'warning', timeout: 10000 }); }
            this.app.log?.('warn', 'archivio: scrittura indice non riuscita', { e: e.message });
          }
          const ancora = await this.motore.call('esito-scrittura', { ok });
          if (!ok || !ancora) break;
        }
      } finally { this.scrittura = null; }
    })();
    return this.scrittura;
  }

  // ---------------- ricerca ----------------
  cerca(f) { return this.motore.call('cerca', { f }); }
  estratti(ids, q) { return this.motore.call('estratti', { ids, q }); }
  conteggi() { return this.motore.call('conteggi'); }
  righe(ids) { return this.motore.call('righe', { ids }); }
  documento(id) { return this.motore.call('documento', { id }); }
  oggi() {
    return this.motore.call('oggi', { impostazioni: this.impostazioni(), ultimaApertura: this.soglia, oggi: oggiIso() });
  }
  /** Segna che l'utente ha visto i documenti arrivati finora (per la prossima apertura). */
  segnaVisto() { this.app.settings.set('archivio.vistoFino', Date.now()); }

  // ---------------- stati ----------------
  async #salvaStati(json) {
    const testo = json || (await this.motore.call('stati-json').catch(() => null));
    if (testo) await this.store.statiScrivi(testo);
  }
  async cambiaStato(ids, modifica) {
    const r = await this.motore.call('cambia-stato', { ids, modifica, ora: Date.now() });
    await this.store.statiScrivi(r.json);
    this.#cambiato();
    return r.n;
  }
  async cambiaStati(voci) {
    const r = await this.motore.call('cambia-stati', { voci, ora: Date.now() });
    await this.store.statiScrivi(r.json);
    this.#cambiato();
    return r.n;
  }
  esportaStati(formato) { return this.motore.call('stati-esporta', { formato }); }
  async importaStati(testo, modo) {
    const r = await this.motore.call('stati-importa', { testo, modo });
    await this.store.statiScrivi(r.json);
    this.#cambiato();
    return r;
  }

  // ---------------- privacy ----------------
  /** Cancella l'indice (testo e dati estratti). anche='tutto' cancella anche stati e cartelle collegate. */
  async cancella(anche = '') {
    this.interrompi();
    await this.lavoro?.promise?.catch(() => {});
    await this.scrittura?.catch(() => {});
    await this.store.cancella(anche);
    await this.motore.call('azzera');
    if (anche === 'tutto') { await this.motore.call('stati', { testo: null }); this.cartelle = []; this.offline.clear(); }
    await this.#aggiornaOffline();
    this.emit('cartelle');
    this.#cambiato();
  }

  /** Legge i byte di un documento dell'archivio (per aprirlo o elaborarlo). */
  async leggiBytes(path) { const r = await this.store.leggi(path, MAX_LETTURA); if (!r.bytes) throw new Error('Il file è troppo grande per essere elaborato qui.'); return r.bytes; }
}
