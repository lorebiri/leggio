// Archivio personale (lato renderer): modello dei dati e cache in memoria sopra il backend cifrato.
// Un'unica istanza per l'app (vedi condiviso.js). Logica senza DOM, coperta dai test.
//
// Indice (versione 1):
//   profilo   { nome, cognome, codiceFiscale, … }                 dati personali («io»)
//   firme     [{ id, nome, tipo:'firma'|'sigla', proprietario:'io'|idContatto, blob, w, h, origine, creata, usata }]
//   timbri    [{ id, nome, tipo:'immagine'|'testo', blob, w, h, spec, creato, usato }]
//   contatti  [{ id, nome, cognome, …CAMPI_CONTATTO, gruppi:[], creato, modificato, origine }]
//   registro  [{ id, quando, firmaId, firmaNome, tipo, proprietario, proprietarioNome, documento, pagine, azione }]
//   modelli   [{ id, nome, tipo:'acroform'|'zone', blob?, campi:[], corrispondenze:{}, zone:[], creato, modificato, usato }]
//   migrazioni { 'firme-0.2': data }
import { CHIAVI_CONTATTO, nomeContatto } from './campi.js';

const SEZIONI = ['firme', 'timbri', 'contatti', 'registro', 'modelli'];
const LEGACY = { firme: 'leggio.moduli.firme.v1', profilo: 'leggio.moduli.profilo.v1' };
const MAX_REGISTRO = 50000;
const RITARDO_SALVATAGGIO = 250;

export function nuovoId(prefisso = 'el') {
  const rnd = Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => b.toString(16).padStart(2, '0')).join('');
  return `${prefisso}-${Date.now().toString(36)}-${rnd}`;
}
export function dataUrlToBytes(u) {
  const m = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(String(u || ''));
  if (!m) throw new Error('Immagine non valida.');
  if (!m[2]) return new TextEncoder().encode(decodeURIComponent(m[3]));
  const b = atob(m[3]); const a = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) a[i] = b.charCodeAt(i);
  return a;
}
export function bytesToDataUrl(bytes, mime = 'image/png') {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return `data:${mime};base64,${btoa(s)}`;
}
function mimeDi(bytes) {
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return 'image/png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'image/jpeg';
  if (bytes[0] === 0x25 && bytes[1] === 0x50) return 'application/pdf';
  return 'application/octet-stream';
}

const testo = (v, max = 500) => (v == null ? '' : String(v).slice(0, max));
const ora = () => new Date().toISOString();

/** Indice vuoto o normalizzato (campi mancanti, tipi sbagliati). */
export function normalizzaIndice(i) {
  const o = i && typeof i === 'object' && !Array.isArray(i) ? { ...i } : {};
  o.formato = 'leggio-personale'; o.versione = 1;
  for (const s of SEZIONI) o[s] = Array.isArray(o[s]) ? o[s].filter((x) => x && typeof x === 'object' && typeof x.id === 'string') : [];
  o.profilo = o.profilo && typeof o.profilo === 'object' && !Array.isArray(o.profilo) ? o.profilo : {};
  o.migrazioni = o.migrazioni && typeof o.migrazioni === 'object' ? o.migrazioni : {};
  o.contatti = o.contatti.map(normalizzaContatto);
  return o;
}
export function normalizzaContatto(c) {
  const out = { id: typeof c.id === 'string' && c.id ? c.id : nuovoId('c') };
  for (const k of CHIAVI_CONTATTO) { const v = c[k]; if (v != null && String(v).trim()) out[k] = testo(v, k === 'note' ? 5000 : 300).trim(); }
  out.gruppi = [...new Set((Array.isArray(c.gruppi) ? c.gruppi : typeof c.gruppi === 'string' ? c.gruppi.split(/[,;|]/) : []).map((g) => String(g).trim()).filter(Boolean).map((g) => g.slice(0, 60)))];
  out.creato = c.creato || ora();
  out.modificato = c.modificato || out.creato;
  if (c.origine) out.origine = testo(c.origine, 120);
  return out;
}

const quando = (x) => x?.modificato || x?.usata || x?.usato || x?.creata || x?.creato || x?.quando || '';
/**
 * Unisce un indice importato con quello attuale (per id; vince la versione modificata più di recente).
 * Il profilo attuale ha la precedenza sui campi già compilati.
 */
export function unisciIndici(attuale, importato) {
  const a = normalizzaIndice(attuale); const b = normalizzaIndice(importato);
  const out = normalizzaIndice(a);
  for (const s of SEZIONI) {
    const m = new Map(a[s].map((x) => [x.id, x]));
    for (const x of b[s]) { const y = m.get(x.id); if (!y || quando(x) > quando(y)) m.set(x.id, x); }
    out[s] = [...m.values()];
  }
  out.registro.sort((x, y) => (x.quando < y.quando ? 1 : -1));
  out.profilo = { ...b.profilo };
  for (const [k, v] of Object.entries(a.profilo)) if (v) out.profilo[k] = v;
  out.migrazioni = { ...b.migrazioni, ...a.migrazioni };
  return out;
}

/**
 * createArchivio({ backend, legacyStorage, chiediPassword, log })
 *   chiediPassword({ errore }) → password | null (interfaccia; null = lascia perdere)
 */
export function createArchivio({ backend, legacyStorage = null, chiediPassword = async () => null, log = () => {} } = {}) {
  let indice = null;
  let apertura = null;
  let timer = null; let inVolo = null; let sporco = false; let purgaInAttesa = false;
  const immagini = new Map(); // id blob → dataUrl
  const ascoltatori = new Map();
  const emetti = (ev, p) => { for (const fn of ascoltatori.get(ev) || []) { try { fn(p); } catch (e) { console.error(e); } } };

  function richiedi() { if (!indice) throw new Error('Archivio personale non ancora aperto.'); return indice; }
  function cambia(sezione, fn, { purga = false } = {}) {
    const i = richiedi();
    const r = fn(i);
    sporco = true; if (purga) purgaInAttesa = true;
    emetti('cambiato', { sezione });
    pianifica();
    return r;
  }
  function pianifica() { clearTimeout(timer); timer = setTimeout(() => { salvaOra().catch(() => {}); }, RITARDO_SALVATAGGIO); }
  async function salvaOra() {
    clearTimeout(timer);
    if (inVolo) { await inVolo.catch(() => {}); }
    if (!sporco || !indice) return;
    sporco = false; const purga = purgaInAttesa; purgaInAttesa = false;
    const copia = JSON.parse(JSON.stringify(indice));
    inVolo = backend.salva(copia, { purga });
    try { await inVolo; emetti('salvato', {}); }
    catch (e) { sporco = true; if (purga) purgaInAttesa = true; log('error', 'salvataggio dell\'archivio personale non riuscito', { error: e.message }); emetti('errore', e); throw e; }
    finally { inVolo = null; }
  }

  async function migra() {
    if (!legacyStorage || indice.migrazioni['firme-0.2']) return false;
    let firmeVecchie = []; let profiloVecchio = {};
    try { firmeVecchie = JSON.parse(legacyStorage.getItem(LEGACY.firme) || '[]'); } catch { firmeVecchie = []; }
    try { profiloVecchio = JSON.parse(legacyStorage.getItem(LEGACY.profilo) || '{}'); } catch { profiloVecchio = {}; }
    if (!Array.isArray(firmeVecchie)) firmeVecchie = [];
    if (!profiloVecchio || typeof profiloVecchio !== 'object' || Array.isArray(profiloVecchio)) profiloVecchio = {};
    let n = 0;
    // se qualcosa va storto si torna allo stato di prima: un salvataggio successivo non deve fissare una
    // migrazione a metà (al prossimo avvio le firme verrebbero copiate due volte, o il localStorage resterebbe)
    const prima = { firme: indice.firme.slice(), profilo: { ...indice.profilo }, migrazioni: { ...indice.migrazioni } };
    const annulla = () => { indice.firme = prima.firme; indice.profilo = prima.profilo; indice.migrazioni = prima.migrazioni; };
    try {
    for (const [i, f] of firmeVecchie.entries()) {
      if (!f || typeof f.dataUrl !== 'string' || !f.dataUrl.startsWith('data:image/')) continue;
      try {
        const id = nuovoId(f.kind === 'initials' ? 'sigla' : 'firma');
        await backend.scriviBlob(id, dataUrlToBytes(f.dataUrl));
        const tipo = f.kind === 'initials' ? 'sigla' : 'firma';
        // l'ordine della 0.2 (la più recente in cima) diventa la data d'uso
        indice.firme.push({ id, nome: testo(f.label, 80) || (tipo === 'sigla' ? 'Le mie iniziali' : 'La mia firma') + (i ? ' ' + (i + 1) : ''), tipo, proprietario: 'io', blob: id, w: +f.w || 0, h: +f.h || 0, origine: '0.2', creata: f.created ? new Date(f.created).toISOString() : ora(), usata: new Date(Date.now() - i * 1000).toISOString() });
        n++;
      } catch (e) { log('warn', 'migrazione di una firma non riuscita', { error: e.message }); throw e; }
    }
    for (const [k, v] of Object.entries(profiloVecchio)) if (typeof v === 'string' && v.trim() && !indice.profilo[k]) indice.profilo[k] = v.trim();
    indice.migrazioni['firme-0.2'] = ora();
    sporco = true;
    await salvaOra();
    } catch (e) { annulla(); sporco = false; purgaInAttesa = false; throw e; }
    // solo dopo il salvataggio riuscito: via dal localStorage (che non è cifrato)
    try { legacyStorage.removeItem(LEGACY.firme); legacyStorage.removeItem(LEGACY.profilo); } catch { /* */ }
    log('info', 'archivio personale: migrazione dalla 0.2', { firme: n, profilo: Object.keys(profiloVecchio).length });
    return true;
  }

  const api = {
    on(ev, fn) { if (!ascoltatori.has(ev)) ascoltatori.set(ev, new Set()); ascoltatori.get(ev).add(fn); return () => ascoltatori.get(ev)?.delete(fn); },
    get aperto() { return !!indice; },
    get backend() { return backend; },
    /** Apre l'archivio (chiede la password se serve). → true se aperto, false se l'utente ha lasciato perdere. */
    apri({ interattivo = true } = {}) {
      if (indice) return Promise.resolve(true);
      if (apertura) return apertura;
      apertura = (async () => {
        const st = await backend.stato();
        if (st?.errore) { const e = new Error(st.errore); e.code = st.codice; throw e; }
        if (st?.bloccato) {
          if (!interattivo) return false;
          let errore = '';
          for (;;) {
            const pw = await chiediPassword({ errore });
            if (pw == null) return false;
            try { await backend.sblocca(pw); break; } catch (e) { if (e.code !== 'password-errata') throw e; errore = e.message; }
          }
        }
        const r = await backend.leggi();
        indice = normalizzaIndice(r?.indice);
        if (r?.stato?.ripristinato) emetti('ripristinato', {});
        try { await migra(); } catch (e) { log('warn', 'migrazione rimandata', { error: e.message }); }
        emetti('aperto', {});
        emetti('cambiato', { sezione: '*' });
        return true;
      })().finally(() => { apertura = null; });
      return apertura;
    },
    /** Chiude la cache (dopo «Blocca» o un'importazione con sostituzione). */
    async chiudi() { await salvaOra().catch(() => {}); indice = null; immagini.clear(); emetti('cambiato', { sezione: '*' }); },
    salvaOra,
    stato: () => backend.stato(),
    get indice() { return indice; },

    // ------------------------------------------------------------------ profilo
    profilo() { return { ...(indice?.profilo || {}) }; },
    salvaProfilo(p) {
      return cambia('profilo', (i) => {
        const out = {};
        for (const [k, v] of Object.entries(p || {})) if (typeof v === 'string' && v.trim() && /^[a-zA-Z]{1,40}$/.test(k)) out[k] = v.trim().slice(0, 300);
        i.profilo = out; return { ...out };
      });
    },

    // ------------------------------------------------------------------ immagini (firme, timbri)
    async immagine(blobId) {
      if (!blobId) throw new Error('Immagine mancante.');
      if (immagini.has(blobId)) return immagini.get(blobId);
      const bytes = await backend.leggiBlob(blobId);
      const u = bytesToDataUrl(bytes, mimeDi(bytes));
      immagini.set(blobId, u);
      return u;
    },
    async leggiBlob(blobId) { return backend.leggiBlob(blobId); },
    async _scriviImmagine(prefisso, sorgente) {
      const bytes = typeof sorgente === 'string' ? dataUrlToBytes(sorgente) : sorgente;
      if (!(bytes instanceof Uint8Array) || !bytes.length) throw new Error('Immagine non valida.');
      const id = nuovoId(prefisso);
      await backend.scriviBlob(id, bytes);
      immagini.set(id, typeof sorgente === 'string' ? sorgente : bytesToDataUrl(bytes, mimeDi(bytes)));
      return id;
    },

    // ------------------------------------------------------------------ firme e sigle
    /** filtro: { tipo:'firma'|'sigla', proprietario:'io'|id|'altri' }. Ordine: usate di recente prima. */
    firme({ tipo, proprietario } = {}) {
      return (indice?.firme || []).filter((f) => (!tipo || f.tipo === tipo) && (!proprietario || (proprietario === 'altri' ? f.proprietario !== 'io' : f.proprietario === proprietario)))
        .sort((a, b) => (quando(b) > quando(a) ? 1 : -1));
    },
    firma(id) { return (indice?.firme || []).find((f) => f.id === id) || null; },
    async aggiungiFirma({ nome = '', tipo = 'firma', proprietario = 'io', immagine, w = 0, h = 0, origine = 'disegno' }) {
      richiedi();
      const blob = await api._scriviImmagine(tipo === 'sigla' ? 'sigla' : 'firma', immagine);
      const prop = proprietario === 'io' || api.contatto(proprietario) ? proprietario : 'io';
      const f = { id: blob, nome: testo(nome, 80).trim() || (tipo === 'sigla' ? 'Sigla' : 'Firma'), tipo: tipo === 'sigla' ? 'sigla' : 'firma', proprietario: prop, blob, w: +w || 0, h: +h || 0, origine: testo(origine, 20), creata: ora(), usata: ora() };
      cambia('firme', (i) => { i.firme.push(f); });
      return f;
    },
    aggiornaFirma(id, patch) {
      return cambia('firme', (i) => {
        const f = i.firme.find((x) => x.id === id); if (!f) return null;
        if (patch.nome != null) f.nome = testo(patch.nome, 80).trim() || f.nome;
        if (patch.tipo) f.tipo = patch.tipo === 'sigla' ? 'sigla' : 'firma';
        if (patch.proprietario && (patch.proprietario === 'io' || api.contatto(patch.proprietario))) f.proprietario = patch.proprietario;
        f.modificato = ora();
        return f;
      });
    },
    usaFirma(id) { if (!api.firma(id)) return; cambia('firme', (i) => { const f = i.firme.find((x) => x.id === id); f.usata = ora(); }); },
    async eliminaFirma(id) {
      const f = api.firma(id); if (!f) return false;
      cambia('firme', (i) => { i.firme = i.firme.filter((x) => x.id !== id); });
      immagini.delete(f.blob);
      await salvaOra();
      await backend.cancellaBlob(f.blob).catch(() => {});
      return true;
    },
    /** La firma è di un'altra persona? */
    altrui(f) { return !!f && f.proprietario !== 'io'; },
    nomeProprietario(f) { if (!f || f.proprietario === 'io') return 'io'; return nomeContatto(api.contatto(f.proprietario)) || 'contatto eliminato'; },

    // ------------------------------------------------------------------ registro degli utilizzi (firme altrui)
    registra({ firma, documento = '', pagine = '', azione = 'inserita' }) {
      if (!firma) return null;
      const e = { id: nuovoId('reg'), quando: ora(), firmaId: firma.id, firmaNome: testo(firma.nome, 80), tipo: firma.tipo, proprietario: firma.proprietario, proprietarioNome: api.nomeProprietario(firma), documento: testo(documento, 400), pagine: testo(pagine, 200), azione: testo(azione, 60) };
      cambia('registro', (i) => { i.registro.unshift(e); if (i.registro.length > MAX_REGISTRO) i.registro.length = MAX_REGISTRO; });
      return e;
    },
    registro({ proprietario } = {}) { return (indice?.registro || []).filter((r) => !proprietario || r.proprietario === proprietario); },

    // ------------------------------------------------------------------ timbri
    timbri() { return [...(indice?.timbri || [])].sort((a, b) => (quando(b) > quando(a) ? 1 : -1)); },
    timbro(id) { return (indice?.timbri || []).find((t) => t.id === id) || null; },
    async aggiungiTimbro({ nome = 'Timbro', tipo = 'immagine', immagine, w = 0, h = 0, spec = null }) {
      richiedi();
      const blob = immagine ? await api._scriviImmagine('timbro', immagine) : null;
      const t = { id: blob || nuovoId('timbro'), nome: testo(nome, 80).trim() || 'Timbro', tipo: tipo === 'testo' ? 'testo' : 'immagine', blob, w: +w || 0, h: +h || 0, spec: spec ? JSON.parse(JSON.stringify(spec)) : null, creato: ora(), usato: ora() };
      cambia('timbri', (i) => { i.timbri.push(t); });
      return t;
    },
    usaTimbro(id) { if (!api.timbro(id)) return; cambia('timbri', (i) => { i.timbri.find((x) => x.id === id).usato = ora(); }); },
    async eliminaTimbro(id) {
      const t = api.timbro(id); if (!t) return false;
      cambia('timbri', (i) => { i.timbri = i.timbri.filter((x) => x.id !== id); });
      await salvaOra();
      if (t.blob) { immagini.delete(t.blob); await backend.cancellaBlob(t.blob).catch(() => {}); }
      return true;
    },

    // ------------------------------------------------------------------ rubrica
    contatti() { return indice?.contatti || []; },
    contatto(id) { return (indice?.contatti || []).find((c) => c.id === id) || null; },
    gruppi() {
      const m = new Map();
      for (const c of indice?.contatti || []) for (const g of c.gruppi || []) m.set(g, (m.get(g) || 0) + 1);
      return [...m].map(([nome, n]) => ({ nome, n })).sort((a, b) => a.nome.localeCompare(b.nome, 'it'));
    },
    /** Aggiunge o aggiorna (stesso id). → contatto salvato */
    salvaContatto(c) {
      return cambia('contatti', (i) => {
        const esistente = c.id ? i.contatti.findIndex((x) => x.id === c.id) : -1;
        const n = normalizzaContatto({ ...(esistente >= 0 ? { creato: i.contatti[esistente].creato } : {}), ...c, modificato: ora() });
        if (esistente >= 0) i.contatti[esistente] = n; else i.contatti.push(n);
        return n;
      });
    },
    /** Più contatti in una volta (importazioni): un solo salvataggio. */
    salvaContatti(lista) {
      return cambia('contatti', (i) => {
        const pos = new Map(i.contatti.map((x, k) => [x.id, k]));
        return lista.map((c) => {
          const k = c.id != null ? pos.get(c.id) : undefined;
          const n = normalizzaContatto({ ...(k != null ? { creato: i.contatti[k].creato } : {}), ...c, modificato: ora() });
          if (k != null) i.contatti[k] = n; else { pos.set(n.id, i.contatti.length); i.contatti.push(n); }
          return n;
        });
      });
    },
    /**
     * Cancella una persona e tutto ciò che la riguarda: le sue firme (anche i file), le voci del registro
     * (se registro: true) e i riferimenti nei modelli. Anche il backup automatico prende la nuova versione.
     */
    async eliminaContatto(id, { registro = true } = {}) {
      const c = api.contatto(id); if (!c) return null;
      const firme = (indice.firme || []).filter((f) => f.proprietario === id);
      const res = { contatto: nomeContatto(c), firme: firme.length, registro: 0 };
      cambia('contatti', (i) => {
        i.contatti = i.contatti.filter((x) => x.id !== id);
        i.firme = i.firme.filter((f) => f.proprietario !== id);
        if (registro) { const prima = i.registro.length; i.registro = i.registro.filter((r) => r.proprietario !== id); res.registro = prima - i.registro.length; }
        for (const m of i.modelli) if (Array.isArray(m.selezione)) m.selezione = m.selezione.filter((x) => x !== id);
      }, { purga: true });
      await salvaOra();
      for (const f of firme) { immagini.delete(f.blob); await backend.cancellaBlob(f.blob).catch(() => {}); }
      return res;
    },
    /** Sposta firme, voci di registro e riferimenti nei modelli da un contatto a un altro (unione dei doppioni). */
    riassegnaProprietario(daId, aId) {
      if (!api.contatto(aId) || daId === aId) return { firme: 0, registro: 0 };
      const nome = nomeContatto(api.contatto(aId));
      return cambia('firme', (i) => {
        let firme = 0; let registro = 0;
        for (const f of i.firme) if (f.proprietario === daId) { f.proprietario = aId; f.modificato = ora(); firme++; }
        for (const r of i.registro) if (r.proprietario === daId) { r.proprietario = aId; r.proprietarioNome = nome; registro++; }
        for (const m of i.modelli) if (Array.isArray(m.selezione) && m.selezione.includes(daId)) m.selezione = [...new Set(m.selezione.map((x) => (x === daId ? aId : x)))];
        return { firme, registro };
      });
    },
    /** Tutto ciò che riguarda una persona (diritto di accesso GDPR). Le firme con l'immagine. */
    async datiPersona(id) {
      const c = api.contatto(id); if (!c) return null;
      const firme = [];
      for (const f of api.firme({ proprietario: id })) {
        let immagine = null; try { immagine = await api.immagine(f.blob); } catch { /* */ }
        firme.push({ nome: f.nome, tipo: f.tipo, creata: f.creata, usata: f.usata, origine: f.origine, immagine });
      }
      return { formato: 'leggio-dati-persona', esportato: ora(), contatto: { ...c }, firme, registro: api.registro({ proprietario: id }).map((r) => ({ quando: r.quando, firma: r.firmaNome, documento: r.documento, pagine: r.pagine, azione: r.azione })) };
    },
    /** Elenco di cosa c'è archiviato (riepilogo per la pagina «Cosa c'è nell'archivio»). */
    inventario() {
      const i = indice || normalizzaIndice({});
      return {
        profilo: Object.keys(i.profilo).length,
        contatti: i.contatti.length,
        gruppi: api.gruppi().length,
        firmeMie: i.firme.filter((f) => f.proprietario === 'io' && f.tipo === 'firma').length,
        sigleMie: i.firme.filter((f) => f.proprietario === 'io' && f.tipo === 'sigla').length,
        firmeAltrui: i.firme.filter((f) => f.proprietario !== 'io').length,
        timbri: i.timbri.length,
        modelli: i.modelli.length,
        registro: i.registro.length,
      };
    },

    // ------------------------------------------------------------------ modelli
    modelli({ tipo } = {}) { return (indice?.modelli || []).filter((m) => !tipo || m.tipo === tipo).sort((a, b) => (quando(b) > quando(a) ? 1 : -1)); },
    modello(id) { return (indice?.modelli || []).find((m) => m.id === id) || null; },
    /** pdf (facoltativo): i byte del PDF di base, salvati cifrati (necessari per i modelli «a zone»). */
    async salvaModello(m, pdf = null) {
      richiedi();
      let blob = m.blob || null;
      if (pdf) { blob = nuovoId('modello'); await backend.scriviBlob(blob, pdf); }
      return cambia('modelli', (i) => {
        const k = m.id ? i.modelli.findIndex((x) => x.id === m.id) : -1;
        const n = { ...JSON.parse(JSON.stringify({ ...m, blob })), id: m.id || nuovoId('mod'), nome: testo(m.nome, 120).trim() || 'Modello', creato: k >= 0 ? i.modelli[k].creato : ora(), modificato: ora() };
        if (k >= 0) i.modelli[k] = n; else i.modelli.push(n);
        return n;
      });
    },
    usaModello(id) { if (!api.modello(id)) return; cambia('modelli', (i) => { i.modelli.find((x) => x.id === id).usato = ora(); }); },
    async pdfModello(id) { const m = api.modello(id); if (!m?.blob) return null; return backend.leggiBlob(m.blob); },
    async eliminaModello(id) {
      const m = api.modello(id); if (!m) return false;
      cambia('modelli', (i) => { i.modelli = i.modelli.filter((x) => x.id !== id); });
      await salvaOra();
      if (m.blob) await backend.cancellaBlob(m.blob).catch(() => {});
      return true;
    },

    // ------------------------------------------------------------------ backup e importazione
    /** Importa un indice (da un backup): 'unisci' oppure 'sostituisci'. */
    async applicaImportato(importato, modo = 'unisci') {
      richiedi();
      cambia('*', (i) => {
        const nuovo = modo === 'sostituisci' ? normalizzaIndice(importato) : unisciIndici(i, importato);
        nuovo.migrazioni = { ...nuovo.migrazioni, ...i.migrazioni };
        Object.keys(i).forEach((k) => delete i[k]);
        Object.assign(i, nuovo);
      });
      immagini.clear();
      await salvaOra();
      return api.inventario();
    },
  };
  return api;
}
