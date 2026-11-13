// L'archivio d'ufficio: cartelle collegate, indice in un Web Worker, indicizzazione incrementale
// in sottofondo (annullabile, ripresa al riavvio), stati d'ufficio, «Oggi».
// Nessun file originale viene mai spostato o modificato.
import { PDFJS_ASSETS } from '../../core/pdf.js';
import { Rpc, Pool } from './rpc.js';
import { isDesktop, storeDesktop, storeWeb, idDa, sepPercorso, percorsiSenzaMaiuscole } from './store.js';
import { datiDaTesto, VERSIONE_ESTRAZIONE, CODICI_ENTE_PREDEFINITI } from './lib/estrai.js';
import { IMPOSTAZIONI_PREDEFINITE } from './lib/scadenze.js';
import { oggiIso } from './lib/testo.js';
import { regole as regoleDa } from '../avanzati/lib/controlli.js';
import { segnaturaGenerica, normalizzaSegnatura } from './lib/segnatura.js';
import { modificaDaEvento } from './lib/stati.js';
import { LettoreSegnature } from './segnatura-ocr.js';

/** Versione della lettura delle strisce di segnatura: se cambia, le strisce non lette si riprovano. */
export const VERSIONE_SEGNATURE = 1;

const MAX_LETTURA = 200 * 1024 * 1024;
const TEMPO_FILE = 60000;
const OGNI_QUANTO_SCRIVERE = 4000; // ms durante l'indicizzazione
// controllo leggero (solo dimensione e data dei file) per accorgersi dei documenti nuovi; sulle cartelle
// locali avvisa prima fs.watch (vedi electron/features/archivio.cjs)
const AGGIORNA_OGNI = 90 * 1000;

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
  #cambiato() { this.versione++; this.emit('cambiato'); this.#aggiornaNoti(); }

  // ---------------- stato richiesto da altre aree (evento «archivio:stato») ----------------
  /** Elenco sincrono di percorsi e impronte indicizzati (per confermare subito gli eventi). */
  #aggiornaNoti() {
    clearTimeout(this.timerNoti);
    this.timerNoti = setTimeout(async () => {
      try { const n = await this.motore.call('noti'); this.noti = { ids: new Set(n.ids), impronte: new Set(n.impronte) }; } catch { /* */ }
      this.#applicaInAttesa();
    }, 300);
  }
  #dentroCartelle(p) {
    const k = idDa(p, this.ci);
    return this.cartelle.some((c) => { const r = idDa(c.percorso, this.ci).replace(/[\\/]+$/, ''); return k.startsWith(r + '/') || k.startsWith(r + '\\'); });
  }
  /**
   * Evento dell'area avanzati (segnatura di Titulus letta aprendo un documento):
   * { path (file ORIGINALE, anche .xml/.p7m), impronta?, modifica: { imposta, numeroProtocollo, dataProtocollo }, origine, ricevuto }
   * oppure in forma semplice { path, stato, numero, data, uor }. Si conferma in modo SINCRONO con ev.ricevuto = true
   * se il documento è nell'archivio (o in una cartella collegata: in quel caso lo stato si applica appena indicizzato).
   */
  riceviStato(ev) {
    if (!ev || ev.ricevuto) return false;
    const id = ev.path ? idDa(ev.path, this.ci) : null;
    const noto = (id && this.noti?.ids.has(id)) || (ev.impronta && this.noti?.impronte.has(ev.impronta));
    if (!noto && !(ev.path && this.#dentroCartelle(ev.path))) return false;
    const modifica = modificaDaEvento(ev);
    if (!modifica) return false;
    ev.ricevuto = true;
    this.inAttesa ??= [];
    this.inAttesa.push({ id, impronta: ev.impronta || null, modifica, tentativi: 0 });
    if (noto) this.#applicaInAttesa();
    else this.aggiorna({ motivo: 'stato', silenzioso: true }).catch(() => {}); // file non ancora indicizzato
    return true;
  }
  async #applicaInAttesa() {
    if (!this.inAttesa?.length || this.applicando) return;
    this.applicando = true;
    try {
      const resto = [];
      for (const x of this.inAttesa.splice(0)) {
        const noto = (x.id && this.noti?.ids.has(x.id)) || (x.impronta && this.noti?.impronte.has(x.impronta));
        if (!noto) { if (++x.tentativi < 5) resto.push(x); continue; }
        try {
          const r = await this.motore.call('cambia-stato', { ids: x.id && this.noti.ids.has(x.id) ? [x.id] : [], impronte: x.impronta ? [x.impronta] : [], modifica: x.modifica, ora: Date.now() });
          await this.store.statiScrivi(r.json);
          this.versione++; this.emit('cambiato');
        } catch (e) { this.app.log?.('warn', 'archivio: stato da evento non applicato', { e: e.message }); }
      }
      this.inAttesa.push(...resto);
    } finally { this.applicando = false; }
  }

  pratica(id) { return this.motore.call('pratica', { id }); }
  testi(ids) { return this.motore.call('testi', { ids }); }
  fornitore(piva) { return this.motore.call('fornitore', { piva }); }
  ibanNoti(piva) { return this.motore.call('iban-noti', { piva }); }
  /** Le impostazioni sono cambiate: il motore ricalcola DURC e semafori. */
  async impostazioniCambiate() { await this.motore.call('impostazioni', { imp: this.impostazioni() }); this.versione++; this.emit('cambiato'); }

  /** Lettura per le altre aree: stato d'ufficio (con protocollo) del documento con quel percorso, o null. */
  async statoArchivio(path) {
    if (!path) return null;
    const id = idDa(path, this.ci);
    const [r] = await this.motore.call('righe', { ids: [id] });
    if (!r) return null;
    const s = r.stato || {};
    return {
      nome: r.nome, path: r.path, impronta: r.impronta, tipo: r.tipo, stati: (r.chips || []).map((c) => c.id),
      protocollato: s.protocollo === 'fatto', daProtocollare: s.protocollo === 'da',
      numero: s.protocollo === 'fatto' ? s.numeroProtocollo || '' : '', data: s.protocollo === 'fatto' ? s.dataProtocollo || '' : '',
      uor: s.uorProtocollo || '', origine: s.protocollo === 'fatto' ? s.origineProtocollo || 'utente' : '',
      etichette: s.etichette || [], nota: s.nota || '',
    };
  }

  get attivo() { return this.cartelle.length > 0; }
  /**
   * Regole che cambiano nel tempo (durata del DURC, giorni SdI…): una sola fonte, il file di regole dell'area
   * avanzati (dati/regole-ufficio.json, con fonte e data; l'ufficio lo aggiorna dalle Impostazioni).
   */
  regole() { try { return regoleDa(this.app.settings.get('avanzati.regole', null)); } catch { return null; } }
  impostazioni() {
    const s = this.app.settings;
    const R = this.regole();
    return {
      durataDurc: +R?.durc?.giorniValidita || IMPOSTAZIONI_PREDEFINITE.durataDurc,
      fonteDurc: R?.durc ? `${R.durc.fonte} (aggiornato il ${R.durc.aggiornato})` : '',
      giorniSdi: +R?.sdi?.giorniEsito || 15,
      preavvisoDurc: +s.get('archivio.preavvisoDurc', IMPOSTAZIONI_PREDEFINITE.preavvisoDurc) || 0,
      preavvisoFatture: +s.get('archivio.preavvisoFatture', IMPOSTAZIONI_PREDEFINITE.preavvisoFatture) || 0,
      scaduteDaProporre: IMPOSTAZIONI_PREDEFINITE.scaduteDaProporre,
      avvisoSdi: IMPOSTAZIONI_PREDEFINITE.avvisoSdi,
      giorniNonProtocollati: +s.get('archivio.giorniNonProtocollati', IMPOSTAZIONI_PREDEFINITE.giorniNonProtocollati) || IMPOSTAZIONI_PREDEFINITE.giorniNonProtocollati,
      mesiPubblicazione: IMPOSTAZIONI_PREDEFINITE.mesiPubblicazione,
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
    // da quando l'archivio esiste: i «non protocollati» si contano solo per i documenti arrivati dopo
    if (!this.app.settings.get('archivio.inizio', 0) && this.misure.caricamento?.documenti) this.app.settings.set('archivio.inizio', Date.now());
    if (this.attivo) setTimeout(() => this.aggiorna({ motivo: 'avvio' }).catch((e) => this.app.log?.('warn', 'archivio: aggiornamento non riuscito', { e: e.message })), 2500);
    this.#avviaSorveglianza();
  }

  /** Cartelle locali sorvegliate con fs.watch; tutte controllate ogni 90 s (solo dimensione e data). */
  #avviaSorveglianza() {
    clearInterval(this.timerAgg);
    this.timerAgg = setInterval(() => { if (this.attivo && !this.lavoro && !document.hidden) this.aggiorna({ motivo: 'periodico', silenzioso: true }).catch(() => {}); }, AGGIORNA_OGNI);
    if (!this.offCambiata) this.offCambiata = this.store.onCambiata(({ id } = {}) => { if (id && this.cartelle.some((c) => c.id === id)) this.aggiorna({ cartelle: [id], motivo: 'sorveglianza', silenzioso: true }).catch(() => {}); });
    this.store.sorveglia().then((r) => { this.sorvegliate = r || {}; this.emit('cartelle'); }).catch(() => {});
  }
  async #haIndice() { try { const m = await this.store.manifesto(); return !!m?.manifesto?.blocchi?.length; } catch { return false; } }

  /** Carica indice e stati dal disco nel worker. */
  async carica() {
    const t0 = performance.now();
    await this.motore.call('impostazioni', { imp: this.impostazioni() });
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
    this.#avviaSorveglianza();
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
    this.store.sorveglia().catch(() => {});
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
    this.interrompiSegnature();
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
      av.nuovi = (av.nuovi || 0) + (conf.nuovi || 0);
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
    if (av.fatti || av.rimossi) this.#cambiato();
    // prima indicizzazione: da qui in poi i file che arrivano sono «nuovi dall'ultima apertura»
    if (!this.soglia && !lavoro.annullato) { this.soglia = Date.now(); this.app.settings.set('archivio.vistoFino', this.soglia); }
    if (!this.app.settings.get('archivio.inizio', 0) && !lavoro.annullato) this.app.settings.set('archivio.inizio', Date.now());
    else if (av.nuovi && ['periodico', 'sorveglianza'].includes(lavoro.motivo)) this.emit('nuovi', { n: av.nuovi });
    if (!lavoro.annullato) setTimeout(() => this.leggiSegnature().catch((e) => this.app.log?.('warn', 'archivio: coda segnature', { e: e.message })), 1500);
    return av;
  }

  // ---------------- coda delle segnature (striscia-immagine di Titulus) ----------------
  /**
   * Legge con l'OCR mirato le strisce di segnatura dei documenti indicizzati. Coda a parte, a bassa
   * priorità: un documento alla volta, con pause, si ferma se riparte l'indicizzazione; annullabile;
   * ripresa al riavvio (i documenti non ancora letti restano «da leggere: protocollo» nell'indice).
   */
  leggiSegnature() {
    if (this.codaSeg || !this.attivo) return this.codaSeg?.promise;
    const lett = new LettoreSegnature(this.app);
    if (!lett.disponibile) return Promise.resolve(null);
    const coda = { annullata: false, fatti: 0, lette: 0, totale: 0 };
    this.codaSeg = coda;
    coda.promise = (async () => {
      const ids = await this.motore.call('segnature-da-leggere', { versione: VERSIONE_SEGNATURE });
      coda.totale = ids.length;
      this.emit('segnature', coda);
      const t0 = performance.now(); let ultimaScrittura = performance.now();
      try {
        for (const id of ids) {
          if (coda.annullata) break;
          while (this.lavoro && !coda.annullata) await new Promise((r) => setTimeout(r, 1000)); // l'indicizzazione ha la precedenza
          await new Promise((r) => (typeof requestIdleCallback === 'function' ? requestIdleCallback(r, { timeout: 1000 }) : setTimeout(r, 50)));
          const [riga] = await this.motore.call('righe', { ids: [id] });
          if (!riga?.striscia || riga.offline) continue;
          let seg = null; let esito = 'non-letta';
          try {
            const l = await this.store.leggi(riga.path, MAX_LETTURA);
            if (l.bytes && l.impronta === riga.impronta) { seg = await lett.leggi(l.bytes, riga.striscia); esito = seg ? 'letta' : 'non-letta'; }
            else esito = 'cambiato';
          } catch (e) { esito = 'errore'; }
          if (esito === 'cambiato') continue; // il file è cambiato: lo rilegge la prossima indicizzazione
          await this.motore.call('imposta-segnatura', { id, segnatura: seg, ocr: { v: VERSIONE_SEGNATURE, esito, quando: Date.now() } });
          coda.fatti++; if (seg) coda.lette++;
          this.emit('segnature', coda);
          if (performance.now() - ultimaScrittura > OGNI_QUANTO_SCRIVERE) { ultimaScrittura = performance.now(); this.scriviOra().catch(() => {}); this.#cambiato(); }
        }
      } finally {
        await lett.chiudi();
        coda.ms = Math.round(performance.now() - t0);
        this.misure.segnature = { fatti: coda.fatti, lette: coda.lette, totale: coda.totale, ms: coda.ms, annullata: coda.annullata };
        this.codaSeg = null;
        await this.scriviOra();
        this.emit('segnature', { ...coda, finita: true });
        this.#cambiato();
      }
      return coda;
    })();
    return coda.promise;
  }
  /** Diagnostica (collaudo): estrazione e lettura della segnatura su byte qualsiasi, senza toccare l'indice. */
  async provaSegnatura(bytes, nome = 'prova.pdf') {
    const pool = this.#pool();
    const r = await pool.esegui('estrai', { bytes: bytes.slice(), nome, escludi: this.codiciEnte() }, [], TEMPO_FILE);
    const daTesto = await this.segnatura(r.testo);
    let daStriscia = null; const t0 = performance.now();
    let testoOcr = '';
    if (!daTesto && r.striscia) { const l = new LettoreSegnature(this.app); try { daStriscia = await l.leggi(bytes, r.striscia); testoOcr = l.ultimoTesto || ''; this._immaginiProva = l.ultimeImmagini; } finally { await l.chiudi(); } }
    if (!this.lavoro) { this.pool?.terminate(); this.pool = null; }
    return { striscia: r.striscia, daTesto, daStriscia, testoOcr, msStriscia: Math.round(performance.now() - t0) };
  }

  interrompiSegnature() { if (this.codaSeg) this.codaSeg.annullata = true; }

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
    r.segnatura = await this.segnatura(r.testo);
    r.segnaturaOcr = null; // striscia eventuale: da leggere nella coda delle segnature
    if (r.errore || r.protetto) av.saltati.push({ rel, motivo: r.protetto ? 'protetto da password' : r.errore });
    const res = await this.motore.call('metti', { doc: { ...doc, ...r, v: VERSIONE_ESTRAZIONE } });
    if (res?.statiCambiati) await this.#salvaStati();
  }

  /**
   * Segnatura di protocollo (Titulus) stampata sul documento: numero, data, sigla AOO.
   * Si usa il modello configurabile dell'area avanzati se c'è, altrimenti il ripiego generico.
   * Leggio non genera mai numeri di protocollo: li legge soltanto.
   */
  async segnatura(testo) {
    if (!testo) return null;
    const pagine = String(testo).split('\f');
    const inizio = pagine.slice(0, 2).join('\n').slice(0, 8000);
    const fine = pagine.length > 2 ? pagine[pagine.length - 1].slice(0, 4000) : '';
    for (const t of [inizio, fine].filter(Boolean)) {
      let s = null;
      try { if (typeof this.app.services?.segnaturaTitulus === 'function') s = normalizzaSegnatura(await this.app.services.segnaturaTitulus(t)); } catch { s = null; }
      if (s?.numero) return { ...s, fonte: 'testo (modello)' };
      s = segnaturaGenerica(t);
      if (s?.numero) return { ...s, fonte: 'testo' };
    }
    return null;
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
    return this.motore.call('oggi', { impostazioni: this.impostazioni(), ultimaApertura: this.soglia, inizioArchivio: this.app.settings.get('archivio.inizio', 0), oggi: oggiIso() });
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
