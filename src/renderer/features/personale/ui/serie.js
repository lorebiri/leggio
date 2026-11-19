// Compilazione in serie: procedura guidata in 4 passaggi (modulo, dati, abbinamento con anteprima, opzioni),
// generazione in un Web Worker (ripiego sul thread principale), riepilogo per record esportabile in CSV.
// Registra anche gli strumenti dei modelli (ui/modelli.js).
import '../serie.css';
import { registerModelli, selettoreChiave, salvaModelloConPdf } from './modelli.js';
import {
  modelloDaPdf, modelloPerDocumento, normalizzaModello, compilaConModello, corrispondenzeModello, etichettaChiave, posizionePredefinita, paginaEffettiva,
} from '../lib/modelli.js';
import {
  generaSerie, recordDaContatto, recordDaRiga, abbinaColonne, abbinaRubrica, controllaRecord, nomeFileDaSchema, segnapostoDisponibili, riepilogo, riepilogoCsv,
} from '../lib/serie.js';
import { tabellaDaFile } from '../lib/tabelle.js';
import { nomeContatto } from '../lib/campi.js';
import { dataUrlToBytes } from '../lib/archivio.js';
import { todayIt } from '../../moduli/lib/geom.js';
import { PDFJS_ASSETS } from '../../../core/pdf.js';

const PASSI = ['Modulo', 'Dati', 'Abbinamento', 'Opzioni'];
const DIMENSIONI_IMG = { piccola: 110, media: 150, grande: 200 };
const MAX_LISTA = 400; // contatti mostrati nella lista (la ricerca restringe)

// ------------------------------------------------------------------------------------------- esecuzione
/** Cede il controllo al browser fra un record e l'altro (ripiego senza Worker). */
function cediSubito() {
  return new Promise((r) => { const c = new MessageChannel(); c.port1.onmessage = () => r(); c.port2.postMessage(0); });
}

/**
 * Genera la serie in un Web Worker (o nel thread principale se il Worker non parte).
 * onGruppo(esiti) riceve i PDF a gruppi (va atteso: la generazione aspetta). signal: AbortSignal.
 * → { esiti, unico?, pagineUnico?, interrotto, inWorker }
 */
export async function eseguiSerie({ PDFLib, base, modello, records, opzioni, onGruppo, onProgresso, signal, worker: usaWorker = true }) {
  const principale = async () => ({ ...(await generaSerie({ PDFLib, base, modello, records, opzioni, signal, onGruppo, onProgresso, cedi: cediSubito })), inWorker: false });
  let w = null;
  if (usaWorker && typeof Worker !== 'undefined') {
    try { w = new Worker(new URL('../serie.worker.js', import.meta.url), { type: 'module', name: 'compilazione-serie' }); } catch { w = null; }
  }
  if (!w) return principale();
  return new Promise((resolve, reject) => {
    let avviato = false; let finito = false;
    const fine = (fn, v) => { if (finito) return; finito = true; signal?.removeEventListener('abort', onAbort); try { w.terminate(); } catch { /* */ } fn(v); };
    const onAbort = () => { w.postMessage({ t: 'interrompi' }); };
    signal?.addEventListener('abort', onAbort);
    w.onmessage = async ({ data: m }) => {
      avviato = true;
      if (m.t === 'progresso') onProgresso?.(m.fatti, m.totale, m.etichetta);
      else if (m.t === 'gruppo') {
        try { await onGruppo?.(m.esiti); } catch (e) { fine(reject, e); return; }
        w.postMessage({ t: 'ack' });
      } else if (m.t === 'fine') fine(resolve, { ...m.risultato, inWorker: true });
      else if (m.t === 'errore') fine(reject, new Error(m.messaggio));
    };
    w.onerror = (e) => {
      e.preventDefault?.();
      if (!avviato && !finito) { finito = true; signal?.removeEventListener('abort', onAbort); try { w.terminate(); } catch { /* */ } principale().then(resolve, reject); return; }
      fine(reject, new Error('La generazione in sottofondo si è interrotta: ' + (e.message || 'errore')));
    };
    const copia = base.slice();
    w.postMessage({ t: 'genera', base: copia, modello, records, opzioni }, [copia.buffer]);
  });
}

// ------------------------------------------------------------------------------------------- procedura guidata
/**
 * Apre la procedura guidata. opts: { modelloId, bytes, nome } per partire da un modello salvato o da un PDF.
 * → Promise risolta alla chiusura della procedura (o alla fine della generazione).
 */
export async function avviaSerie(app, ctx, opts = {}) {
  const { h } = app.ui; const { archivio } = ctx; const PDFLib = app.lib.PDFLib;
  await ctx.apri().catch(() => false);
  const doc = app.activeDoc;
  const s = {
    passo: 0,
    sorgente: opts.modelloId ? 'modello' : opts.bytes ? 'disco' : doc ? 'doc' : (archivio.aperto && archivio.modelli().length ? 'modello' : 'disco'),
    modelloId: opts.modelloId || '', disco: opts.bytes ? { name: opts.nome || 'modulo.pdf', bytes: opts.bytes } : null,
    base: null, nomeModulo: '', modello: null, salvato: null, riconosciuto: false,
    datiTipo: archivio.aperto && archivio.gruppi().length ? 'gruppo' : archivio.aperto && archivio.contatti().length ? 'contatti' : 'file',
    gruppo: '', selezione: new Set(), ricerca: '', tabella: null, file: null, foglio: null,
    records: [], corrispondenze: {}, zone: [], anteprima: 0, paginaAnteprima: 0,
    salvaModello: true, nomeModello: '',
    immagine: '', posizione: 'basso-destra', dimensione: 'media', schema: '', destinazione: 'cartella', appiattisci: false,
  };

  // ---------------------------------------------------------------- finestra
  let chiusa = false; let risolvi;
  const finita = new Promise((r) => { risolvi = r; });
  const titolo = h('h2', { id: 'serie-titolo' }, 'Compilazione in serie');
  const passi = h('ol', { class: 'serie-passi', 'aria-label': 'Passaggi' });
  const corpo = h('div', { class: 'dlg-body serie-corpo' });
  const errore = h('div', { class: 'dlg-error serie-errore', role: 'alert' });
  const bIndietro = h('button', { type: 'button', class: 'btn', onclick: () => vai(s.passo - 1) }, 'Indietro');
  const bAvanti = h('button', { type: 'button', class: 'btn primary', onclick: () => avanti() }, 'Avanti');
  const bLascia = h('button', { type: 'button', class: 'btn spacer-left', onclick: () => chiudi() }, 'Lascia perdere');
  const box = h('div', { class: 'dlg serie-dlg', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'serie-titolo' },
    h('header', { class: 'dlg-head' }, titolo, h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Chiudi', title: 'Chiudi', onclick: () => chiudi(), html: '<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>' })),
    passi, corpo, errore,
    h('footer', { class: 'dlg-foot' }, bLascia, bIndietro, bAvanti));
  const back = h('div', { class: 'backdrop serie-back' }, box);
  const prevFocus = document.activeElement;
  const modal = app.ui.openModal(back, () => chiudi());
  document.getElementById('overlay-root').append(back);
  function chiudi(v = null) {
    if (chiusa) return; chiusa = true;
    clearTimeout(timerAnteprima);
    back.remove(); app.ui.closeModal(modal); prevFocus?.focus?.();
    risolvi(v);
  }
  const occupato = (on, testo = 'Attendi…') => { bAvanti.disabled = on; bIndietro.disabled = on; box.classList.toggle('serie-occupato', on); if (on) bAvanti.dataset.testo = bAvanti.textContent; bAvanti.textContent = on ? testo : (bAvanti.dataset.testo || bAvanti.textContent); };

  function disegnaPassi() {
    passi.textContent = '';
    PASSI.forEach((p, i) => passi.append(h('li', { class: 'serie-passo' + (i === s.passo ? ' attuale' : i < s.passo ? ' fatto' : ''), 'aria-current': i === s.passo ? 'step' : null }, h('span', { class: 'serie-passo-n', 'aria-hidden': 'true' }, i < s.passo ? '✓' : String(i + 1)), h('span', {}, p))));
  }
  function vai(n) {
    if (n < 0 || n >= PASSI.length) return;
    s.passo = n; errore.textContent = '';
    disegnaPassi();
    corpo.textContent = '';
    corpo.scrollTop = 0;
    bIndietro.hidden = n === 0;
    bAvanti.textContent = n === PASSI.length - 1 ? `Genera ${s.records.length} PDF` : 'Avanti';
    [passoModulo, passoDati, passoAbbinamento, passoOpzioni][n]();
    requestAnimationFrame(() => corpo.querySelector('input:checked, input, select, button')?.focus());
  }
  async function avanti() {
    errore.textContent = '';
    occupato(true, s.passo === PASSI.length - 1 ? 'Preparazione…' : 'Attendi…');
    let ok = false;
    try { ok = await [validaModulo, validaDati, validaAbbinamento, genera][s.passo](); }
    catch (err) { errore.textContent = err?.message || String(err); }
    finally { if (!chiusa) occupato(false); }
    if (ok && !chiusa && s.passo < PASSI.length - 1) vai(s.passo + 1);
  }

  // elementi comuni
  const scelta = (nome, valore, attuale, titoloScelta, descr, extra = null, { disabled = false, onSelect } = {}) => {
    const input = h('input', { type: 'radio', name: nome, value: valore, checked: attuale === valore, disabled });
    const lab = h('label', { class: 'serie-scelta' + (disabled ? ' disabilitata' : '') }, input, h('span', { class: 'serie-scelta-txt' }, h('strong', {}, titoloScelta), descr ? h('small', {}, descr) : null));
    input.addEventListener('change', () => { if (input.checked) onSelect?.(valore); });
    return h('div', { class: 'serie-scelta-box' + (attuale === valore ? ' scelta' : '') }, lab, extra ? h('div', { class: 'serie-scelta-extra' }, extra) : null);
  };
  const aggiornaScelte = (cont, nome) => cont.querySelectorAll('.serie-scelta-box').forEach((b) => b.classList.toggle('scelta', !!b.querySelector(`input[name="${nome}"]:checked`)));

  // ---------------------------------------------------------------- 1. modulo
  function passoModulo() {
    const modelli = archivio.aperto ? archivio.modelli() : [];
    const selModello = h('select', { 'aria-label': 'Modello salvato', onchange: () => { s.modelloId = selModello.value; segna('modello'); } },
      modelli.map((m) => h('option', { value: m.id, selected: m.id === s.modelloId }, `${m.nome} (${m.tipo === 'zone' ? 'a zone' : 'compilabile'})`)));
    if (!s.modelloId && modelli[0]) s.modelloId = modelli[0].id;
    const nomeDisco = h('span', { class: 'serie-file-nome' }, s.disco ? s.disco.name : 'Nessun file scelto');
    const bDisco = h('button', { type: 'button', class: 'btn small', onclick: async () => {
      const f = (await app.platform.openFiles({ raw: true, title: 'Scegli il modulo PDF', filters: [{ name: 'Documenti PDF', extensions: ['pdf'] }] }))?.[0];
      if (!f) return;
      s.disco = { name: f.name, bytes: f.bytes }; nomeDisco.textContent = f.name; segna('disco');
    } }, 'Scegli il PDF…');
    const cont = h('div', { class: 'serie-scelte', role: 'radiogroup', 'aria-label': 'Modulo da compilare' });
    const segna = (v) => { s.sorgente = v; cont.querySelector(`input[value="${v}"]`).checked = true; aggiornaScelte(cont, 'serie-sorgente'); };
    cont.append(
      scelta('serie-sorgente', 'doc', s.sorgente, 'Il documento aperto', doc ? doc.name : 'Nessun documento aperto', null, { disabled: !doc, onSelect: segna }),
      scelta('serie-sorgente', 'modello', s.sorgente, 'Un modello salvato', modelli.length ? 'Con i campi già abbinati ai dati' : (archivio.aperto ? 'Non hai ancora modelli: li crei con «Salva come modello» o «Zone da compilare»' : 'L\'archivio personale è chiuso'), modelli.length ? selModello : null, { disabled: !modelli.length, onSelect: segna }),
      scelta('serie-sorgente', 'disco', s.sorgente, 'Un PDF dal computer', 'Un modulo compilabile', h('div', { class: 'serie-riga' }, bDisco, nomeDisco), { onSelect: segna }),
    );
    if (s.sorgente === 'doc' && !doc) segna(modelli.length ? 'modello' : 'disco');
    corpo.append(h('p', { class: 'serie-intro' }, 'Crea tanti PDF dallo stesso modulo, uno per ogni persona o riga di un foglio Excel. Per cominciare scegli il modulo.'), cont, nonCompilabile = h('div', { class: 'serie-avviso', hidden: true, role: 'status' }));
  }
  let nonCompilabile = null;

  async function validaModulo() {
    let bytes; let nome; let salvato = null;
    if (s.sorgente === 'doc') {
      if (!doc || !app.docs.includes(doc)) throw new Error('Il documento non è più aperto: scegli un\'altra strada.');
      bytes = doc.bytes; nome = doc.name;
      if (doc.password) { const d = await app.lib.openPdfLib(bytes, doc.password); bytes = await d.save(); }
    } else if (s.sorgente === 'modello') {
      salvato = archivio.modello(s.modelloId);
      if (!salvato) throw new Error('Scegli un modello.');
      bytes = await archivio.pdfModello(salvato.id);
      if (!bytes) throw new Error('Il PDF di questo modello non è stato salvato: apri il modulo, poi scegli «Il documento aperto».');
      nome = salvato.nome + '.pdf';
    } else {
      if (!s.disco) throw new Error('Scegli il PDF del modulo.');
      bytes = s.disco.bytes; nome = s.disco.name;
    }
    let pdfDoc;
    try { pdfDoc = await PDFLib.PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false }); }
    catch { throw new Error('Questo PDF non si riesce a leggere (danneggiato o protetto da password).'); }
    s.riconosciuto = false;
    if (!salvato && archivio.aperto) { salvato = await modelloPerDocumento(archivio, bytes, { PDFLib, pdfDoc }); s.riconosciuto = !!salvato; }
    const letto = await modelloDaPdf(PDFLib, bytes, { nome: nome.replace(/\.pdf$/i, ''), pdfDoc });
    if (salvato?.tipo === 'zone') {
      if (!salvato.zone?.length) throw new Error('Il modello a zone non contiene zone: aprilo con «Zone da compilare (modello)» e disegnale.');
      s.modello = normalizzaModello({ ...salvato, impronta: letto.impronta, pagine: letto.pagine });
    } else if (letto.campi.length) {
      s.modello = normalizzaModello({ ...letto, ...(salvato || {}), tipo: 'acroform', campi: letto.campi, impronta: salvato?.impronta || letto.impronta, chiaveCampi: letto.chiaveCampi, pagine: letto.pagine });
    } else {
      nonCompilabile.hidden = false; nonCompilabile.textContent = '';
      const puoAprire = s.sorgente === 'doc' || s.sorgente === 'disco';
      nonCompilabile.append(
        h('strong', {}, 'Questo PDF non ha campi compilabili.'),
        h('span', {}, ' Per compilarlo in serie indica prima dove scrivere i dati con «Zone da compilare (modello)»: disegni i riquadri sulla pagina, scegli il dato di ognuno e salvi il modello. Poi torna qui e scegli il modello.'),
        puoAprire ? h('button', { type: 'button', class: 'btn small', onclick: async () => {
          chiudi();
          if (s.sorgente === 'disco') await app.openBytes(bytes, { name: nome });
          app.tools.run('template-zones');
        } }, 'Apri «Zone da compilare»') : null);
      return false;
    }
    s.base = bytes; s.nomeModulo = nome; s.salvato = salvato?.id ? archivio.modello(salvato.id) : null;
    s.nomeModello = s.salvato?.nome || nome.replace(/\.pdf$/i, '');
    s.corrispondenze = null; // ricalcolate al passo 3
    if (s.salvato?.nomeFile) s.schema = s.salvato.nomeFile;
    return true;
  }

  // ---------------------------------------------------------------- 2. dati
  function passoDati() {
    const aperto = archivio.aperto;
    const gruppi = aperto ? archivio.gruppi() : [];
    const contatti = aperto ? archivio.contatti() : [];
    if (!s.gruppo && gruppi[0]) s.gruppo = gruppi[0].nome;
    const cont = h('div', { class: 'serie-scelte', role: 'radiogroup', 'aria-label': 'Da dove prendere i dati' });
    const segna = (v) => { s.datiTipo = v; cont.querySelector(`input[value="${v}"]`).checked = true; aggiornaScelte(cont, 'serie-dati'); };
    const selGruppo = h('select', { 'aria-label': 'Gruppo della rubrica', onchange: () => { s.gruppo = selGruppo.value; segna('gruppo'); } }, gruppi.map((g) => h('option', { value: g.nome, selected: g.nome === s.gruppo }, `${g.nome} (${g.n})`)));

    // contatti scelti: ricerca + caselle
    const conta = h('span', { class: 'serie-conta', 'aria-live': 'polite' });
    const elenco = h('div', { class: 'serie-contatti', role: 'group', 'aria-label': 'Contatti' });
    const cerca = h('input', { type: 'search', placeholder: 'Cerca per nome, ente, codice fiscale…', 'aria-label': 'Cerca nei contatti', value: s.ricerca });
    const visibili = () => { const q = s.ricerca.trim().toLowerCase(); return contatti.filter((c) => !q || [nomeContatto(c), c.codiceFiscale, c.email, c.citta, ...(c.gruppi || [])].some((x) => String(x || '').toLowerCase().includes(q))); };
    const aggiornaConta = () => { conta.textContent = s.selezione.size === 1 ? '1 scelto' : `${s.selezione.size} scelti`; };
    const disegnaElenco = () => {
      elenco.textContent = '';
      const v = visibili();
      for (const c of v.slice(0, MAX_LISTA)) {
        const cb = h('input', { type: 'checkbox', checked: s.selezione.has(c.id), onchange: () => { cb.checked ? s.selezione.add(c.id) : s.selezione.delete(c.id); aggiornaConta(); segna('contatti'); } });
        elenco.append(h('label', { class: 'serie-contatto' }, cb, h('span', {}, nomeContatto(c)), c.codiceFiscale ? h('small', {}, c.codiceFiscale) : null));
      }
      if (v.length > MAX_LISTA) elenco.append(h('p', { class: 'serie-nota' }, `Altri ${v.length - MAX_LISTA} contatti: restringi la ricerca.`));
      if (!v.length) elenco.append(h('p', { class: 'serie-nota' }, contatti.length ? 'Nessun contatto corrisponde alla ricerca.' : 'La rubrica è vuota.'));
      aggiornaConta();
    };
    cerca.addEventListener('input', () => { s.ricerca = cerca.value; disegnaElenco(); });
    const tutti = h('button', { type: 'button', class: 'btn small', onclick: () => { for (const c of visibili()) s.selezione.add(c.id); disegnaElenco(); segna('contatti'); } }, 'Scegli tutti quelli visibili');
    const nessuno = h('button', { type: 'button', class: 'btn small', onclick: () => { s.selezione.clear(); disegnaElenco(); } }, 'Togli tutti');
    disegnaElenco();

    // file
    const infoFile = h('span', { class: 'serie-file-nome' }, s.tabella ? descriviTabella() : 'Nessun file scelto');
    const selFoglio = h('select', { 'aria-label': 'Foglio del file Excel', hidden: !(s.tabella?.fogli?.length > 1), onchange: async () => { try { await leggiFile(s.file, selFoglio.value); infoFile.textContent = descriviTabella(); } catch (e) { errore.textContent = e.message; } } });
    const riempiFogli = () => { selFoglio.textContent = ''; for (const f of s.tabella?.fogli || []) selFoglio.append(h('option', { value: f, selected: f === s.tabella.foglio }, f)); selFoglio.hidden = !(s.tabella?.fogli?.length > 1); };
    riempiFogli();
    const bFile = h('button', { type: 'button', class: 'btn small', onclick: async () => {
      const f = (await app.platform.openFiles({ raw: true, title: 'Scegli il file dei dati', filters: [{ name: 'Fogli di calcolo', extensions: ['csv', 'xlsx', 'txt'] }] }))?.[0];
      if (!f) return;
      try { await leggiFile(f); infoFile.textContent = descriviTabella(); riempiFogli(); segna('file'); errore.textContent = ''; }
      catch (e) { errore.textContent = e.message; }
    } }, 'Scegli il file…');

    cont.append(
      scelta('serie-dati', 'gruppo', s.datiTipo, 'Un gruppo della rubrica', gruppi.length ? 'Tutte le persone e gli enti del gruppo' : (aperto ? 'Non ci sono gruppi nella rubrica' : 'L\'archivio personale è chiuso'), gruppi.length ? selGruppo : null, { disabled: !gruppi.length, onSelect: segna }),
      scelta('serie-dati', 'contatti', s.datiTipo, 'Alcuni contatti della rubrica', contatti.length ? 'Scegli le persone una per una' : 'La rubrica è vuota', contatti.length ? h('div', { class: 'serie-scegli-contatti' }, h('div', { class: 'serie-riga' }, cerca, conta), elenco, h('div', { class: 'serie-riga' }, tutti, nessuno)) : null, { disabled: !contatti.length, onSelect: segna }),
      scelta('serie-dati', 'file', s.datiTipo, 'Un file Excel o CSV', 'La prima riga contiene i nomi delle colonne (Cognome, Nome, Codice fiscale…)', h('div', { class: 'serie-riga' }, bFile, infoFile, selFoglio), { onSelect: segna }),
    );
    if ((s.datiTipo === 'gruppo' && !gruppi.length) || (s.datiTipo === 'contatti' && !contatti.length)) segna(contatti.length ? 'contatti' : 'file');
    corpo.append(h('p', { class: 'serie-intro' }, `Modulo: «${s.nomeModulo}»${s.riconosciuto ? ` — riconosciuto il modello «${s.salvato?.nome}»` : ''}. Ora scegli le persone o il file con i dati: verrà creato un PDF per ognuno.`), cont);
  }
  function descriviTabella() { const t = s.tabella; return t ? `${s.file.name}: ${t.righe.length} ${t.righe.length === 1 ? 'riga' : 'righe'}, ${t.intestazioni.length} colonne` : ''; }
  async function leggiFile(f, foglio = null) {
    const t = await tabellaDaFile(f, { foglio });
    if (!t.intestazioni.length || !t.righe.length) throw new Error('Il file non contiene righe di dati (la prima riga deve avere i nomi delle colonne).');
    s.file = f; s.tabella = t; s.corrispondenze = null;
  }
  async function validaDati() {
    let records = [];
    if (s.datiTipo === 'gruppo') records = archivio.contatti().filter((c) => (c.gruppi || []).includes(s.gruppo)).map(recordDaContatto);
    else if (s.datiTipo === 'contatti') records = archivio.contatti().filter((c) => s.selezione.has(c.id)).map(recordDaContatto);
    else {
      if (!s.tabella) throw new Error('Scegli il file con i dati.');
      records = s.tabella.righe.map((r, i) => recordDaRiga(r, s.tabella.intestazioni, i));
    }
    if (!records.length) throw new Error(s.datiTipo === 'contatti' ? 'Scegli almeno un contatto.' : s.datiTipo === 'gruppo' ? 'Il gruppo è vuoto.' : 'Il file non contiene righe.');
    const tipoPrima = s.records.__tipo;
    s.records = records; s.records.__tipo = s.datiTipo === 'file' ? 'file' : 'rubrica';
    if (tipoPrima !== s.records.__tipo) s.corrispondenze = null;
    s.anteprima = 0;
    if (!s.schema) s.schema = schemaPredefinito();
    return true;
  }
  const colonne = () => (s.records.__tipo === 'file' ? s.tabella?.intestazioni || [] : []);
  function schemaPredefinito() {
    const base = s.nomeModulo.replace(/\.pdf$/i, '').slice(0, 40);
    const d = s.records[0]?.dati || {};
    if (d.cognome || d.nome) return `{cognome}_{nome}_${base}.pdf`;
    if (d.ragioneSociale) return `{ragioneSociale}_${base}.pdf`;
    return `{n}_${base}.pdf`;
  }

  // ---------------------------------------------------------------- 3. abbinamento e anteprima
  function corrispondenzeIniziali() {
    const cols = colonne();
    const valida = (k) => typeof k === 'string' && (!k.startsWith('colonna:') || cols.includes(k.slice(8)));
    if (s.modello.tipo === 'zone') {
      s.zone = s.modello.zone.map((z) => ({ ...z, chiave: valida(z.chiave) ? z.chiave : '' }));
      return {};
    }
    const auto = cols.length ? abbinaColonne(s.modello.campi, cols) : abbinaRubrica(s.modello.campi);
    const salvate = s.salvato?.tipo === 'acroform' ? s.salvato.corrispondenze || {} : {};
    const out = {};
    for (const c of s.modello.campi) out[c.nome] = Object.prototype.hasOwnProperty.call(salvate, c.nome) && valida(salvate[c.nome]) && (salvate[c.nome] || !auto[c.nome]) ? salvate[c.nome] : auto[c.nome] || '';
    return out;
  }
  const modelloCorrente = () => (s.modello.tipo === 'zone' ? { ...s.modello, zone: s.zone } : { ...s.modello, corrispondenze: s.corrispondenze });

  let timerAnteprima = null; let gen = 0;
  let anteprimaEl = null; let navEl = null; let avvisiEl = null;
  function passoAbbinamento() {
    if (!s.corrispondenze) s.corrispondenze = corrispondenzeIniziali();
    const cols = colonne();
    const righe = [];
    const cambia = () => { pianificaAnteprima(); };
    if (s.modello.tipo === 'zone') {
      s.zone.forEach((z, i) => {
        const sel = selettoreChiave(app, { valore: z.chiave, colonne: cols, etichetta: `Dato per la zona ${i + 1}`, onChange: (v) => { z.chiave = v; cambia(); } });
        righe.push(h('tr', {}, h('th', { scope: 'row', class: 'serie-campo' }, `Zona ${i + 1}`, h('span', { class: 'serie-tipo' }, `pagina ${z.pagina + 1}`)), h('td', {}, sel)));
      });
    } else {
      for (const c of s.modello.campi) {
        const sel = selettoreChiave(app, { valore: s.corrispondenze[c.nome] || '', colonne: cols, etichetta: `Dato per il campo ${c.nome}`, onChange: (v) => { s.corrispondenze[c.nome] = v; cambia(); } });
        righe.push(h('tr', {}, h('th', { scope: 'row', class: 'serie-campo', title: c.nome }, c.nome, c.tipo !== 'text' ? h('span', { class: 'serie-tipo' }, { checkbox: 'casella (Sì/No)', radio: 'scelta', dropdown: 'elenco', listbox: 'elenco' }[c.tipo] || '') : null), h('td', {}, sel)));
      }
    }
    const nAbbinati = s.modello.tipo === 'zone' ? s.zone.filter((z) => z.chiave).length : Object.values(s.corrispondenze).filter(Boolean).length;
    const nomeIn = h('input', { type: 'text', value: s.nomeModello, maxlength: 120, 'aria-label': 'Nome del modello', oninput: () => { s.nomeModello = nomeIn.value; } });
    const salva = h('input', { type: 'checkbox', checked: s.salvaModello, onchange: () => { s.salvaModello = salva.checked; nomeIn.disabled = !salva.checked; } });
    nomeIn.disabled = !s.salvaModello;
    anteprimaEl = h('div', { class: 'serie-anteprima-pagina', 'aria-live': 'polite' }, h('span', { class: 'serie-nota' }, 'Anteprima in preparazione…'));
    navEl = h('div', { class: 'serie-anteprima-nav' });
    avvisiEl = h('div', { class: 'serie-anteprima-avvisi' });
    corpo.append(
      h('p', { class: 'serie-intro' }, `Scegli quale dato va in ogni ${s.modello.tipo === 'zone' ? 'zona' : 'campo'} (${nAbbinati} già ${nAbbinati === 1 ? 'abbinato' : 'abbinati'} in automatico). A destra vedi il risultato per ogni record.`),
      h('div', { class: 'serie-abbina' },
        h('div', { class: 'serie-abbina-sx' },
          h('div', { class: 'serie-tabella-wrap' }, h('table', { class: 'serie-tabella' }, h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, s.modello.tipo === 'zone' ? 'Zona' : 'Campo del modulo'), h('th', { scope: 'col' }, 'Dato'))), h('tbody', {}, righe))),
          h('div', { class: 'serie-salva-modello' }, h('label', { class: 'serie-check' }, salva, h('span', {}, s.salvato ? `Aggiorna il modello «${s.salvato.nome}» con questo abbinamento` : 'Salva questo abbinamento come modello')), s.salvato ? null : nomeIn)),
        h('div', { class: 'serie-abbina-dx' }, navEl, anteprimaEl, avvisiEl)));
    pianificaAnteprima(0);
  }
  function pianificaAnteprima(ritardo = 300) { clearTimeout(timerAnteprima); timerAnteprima = setTimeout(() => anteprima().catch((e) => { if (anteprimaEl) anteprimaEl.textContent = 'Anteprima non disponibile: ' + e.message; }), ritardo); }
  async function anteprima() {
    if (chiusa || s.passo !== 2) return;
    const mio = ++gen;
    const n = s.records.length; s.anteprima = Math.max(0, Math.min(n - 1, s.anteprima));
    const rec = s.records[s.anteprima];
    const modello = modelloCorrente();
    // navigazione fra i record
    navEl.textContent = '';
    const prec = h('button', { type: 'button', class: 'btn small', 'aria-label': 'Record precedente', disabled: s.anteprima === 0, onclick: () => { s.anteprima--; s.paginaAnteprima = 0; pianificaAnteprima(0); } }, '‹');
    const succ = h('button', { type: 'button', class: 'btn small', 'aria-label': 'Record successivo', disabled: s.anteprima >= n - 1, onclick: () => { s.anteprima++; s.paginaAnteprima = 0; pianificaAnteprima(0); } }, '›');
    navEl.append(prec, h('span', { class: 'serie-anteprima-chi' }, h('strong', {}, rec.etichetta), h('small', {}, `Record ${s.anteprima + 1} di ${n}`)), succ);
    // controlli del record
    const ctrl = controllaRecord(rec, modello);
    avvisiEl.textContent = '';
    if (ctrl.avvisi.length) avvisiEl.append(h('ul', { class: 'serie-avvisi' }, ctrl.avvisi.map((a) => h('li', {}, a))));
    else avvisiEl.append(h('p', { class: 'serie-ok' }, '✓ Nessun problema per questo record.'));
    // PDF del record e prima pagina disegnata
    const pdfDoc = await PDFLib.PDFDocument.load(s.base, { ignoreEncryption: true, updateMetadata: false });
    await compilaConModello(PDFLib, pdfDoc, modello, rec.dati, { oggi: todayIt() });
    const bytes = await pdfDoc.save();
    if (mio !== gen || chiusa) return;
    const task = app.lib.pdfjs.getDocument({ data: bytes, ...PDFJS_ASSETS, isEvalSupported: false, verbosity: 0 });
    try {
      const pdf = await task.promise;
      const np = pdf.numPages; s.paginaAnteprima = Math.max(0, Math.min(np - 1, s.paginaAnteprima));
      const larghezza = Math.max(240, Math.min(420, anteprimaEl.clientWidth || 360));
      const pagina = await pdf.getPage(s.paginaAnteprima + 1);
      const scala = larghezza / pagina.getViewport({ scale: 1 }).width;
      const canvas = await app.lib.renderPageToCanvas(pdf, s.paginaAnteprima, scala * (window.devicePixelRatio || 1), { background: '#ffffff' });
      if (mio !== gen || chiusa) return;
      canvas.style.width = '100%'; canvas.setAttribute('role', 'img'); canvas.setAttribute('aria-label', `Anteprima della pagina ${s.paginaAnteprima + 1} per ${rec.etichetta}`);
      anteprimaEl.textContent = '';
      anteprimaEl.append(canvas);
      if (np > 1) {
        anteprimaEl.append(h('div', { class: 'serie-anteprima-pag' },
          h('button', { type: 'button', class: 'btn small', disabled: s.paginaAnteprima === 0, onclick: () => { s.paginaAnteprima--; pianificaAnteprima(0); } }, 'Pagina precedente'),
          h('span', {}, `Pagina ${s.paginaAnteprima + 1} di ${np}`),
          h('button', { type: 'button', class: 'btn small', disabled: s.paginaAnteprima >= np - 1, onclick: () => { s.paginaAnteprima++; pianificaAnteprima(0); } }, 'Pagina successiva')));
      }
    } finally { task.destroy().catch?.(() => {}); }
  }
  async function validaAbbinamento() {
    const m = modelloCorrente();
    const abbinati = m.tipo === 'zone' ? m.zone.filter((z) => z.chiave).length : Object.values(m.corrispondenze).filter(Boolean).length;
    if (!abbinati) throw new Error('Scegli il dato per almeno un campo.');
    if (s.salvaModello && !s.salvato && !s.nomeModello.trim()) throw new Error('Scrivi un nome per il modello, oppure togli la spunta.');
    return true;
  }

  // ---------------------------------------------------------------- 4. opzioni
  function passoOpzioni() {
    const aperto = archivio.aperto;
    const mie = aperto ? archivio.firme({ tipo: 'firma', proprietario: 'io' }) : [];
    const altrui = aperto ? archivio.firme({ tipo: 'firma', proprietario: 'altri' }) : [];
    const timbri = aperto ? archivio.timbri().filter((t) => t.blob) : [];
    const anteprimaImg = h('div', { class: 'serie-img-anteprima', 'aria-hidden': 'true' });
    const mostraImg = async () => {
      anteprimaImg.textContent = '';
      const sc = sceltaImmagine();
      if (!sc) return;
      try { const u = await archivio.immagine(sc.blob); anteprimaImg.append(h('img', { src: u, alt: '' })); } catch { /* */ }
    };
    const selImg = h('select', { 'aria-label': 'Firma o timbro da aggiungere', onchange: () => { s.immagine = selImg.value; aggiornaPos(); mostraImg(); } },
      h('option', { value: '' }, 'Nessuna'),
      mie.length ? h('optgroup', { label: 'Le mie firme' }, mie.map((f) => h('option', { value: 'firma:' + f.id }, f.nome))) : null,
      altrui.length ? h('optgroup', { label: 'Firme di altre persone' }, altrui.map((f) => h('option', { value: 'firma:' + f.id }, `${f.nome} — di ${archivio.nomeProprietario(f)}`))) : null,
      timbri.length ? h('optgroup', { label: 'Timbri' }, timbri.map((t) => h('option', { value: 'timbro:' + t.id }, t.nome))) : null);
    selImg.value = s.immagine; if (selImg.value !== s.immagine) s.immagine = '';
    const selPos = h('select', { 'aria-label': 'Posizione', onchange: () => { s.posizione = selPos.value; } });
    const selDim = h('select', { 'aria-label': 'Dimensione', onchange: () => { s.dimensione = selDim.value; } }, [['piccola', 'Piccola'], ['media', 'Media'], ['grande', 'Grande']].map(([v, l]) => h('option', { value: v, selected: s.dimensione === v }, l)));
    const avvisoAltrui = h('p', { class: 'serie-avviso', hidden: true });
    function aggiornaPos() {
      const tipo = s.immagine.split(':')[0];
      const salvata = s.modello[tipo] || null;
      selPos.textContent = '';
      if (salvata) selPos.append(h('option', { value: 'modello' }, 'La posizione salvata nel modello'));
      for (const [v, l] of [['basso-destra', 'In basso a destra dell\'ultima pagina'], ['basso-sinistra', 'In basso a sinistra dell\'ultima pagina'], ['basso-centro', 'In basso al centro dell\'ultima pagina'], ['prima-destra', 'In basso a destra della prima pagina']]) selPos.append(h('option', { value: v }, l));
      if (salvata && (s.posizione === 'basso-destra' || !s.posizione)) s.posizione = 'modello';
      selPos.value = s.posizione; if (selPos.value !== s.posizione) { s.posizione = selPos.value; }
      const dis = !s.immagine; selPos.disabled = dis; selDim.disabled = dis || s.posizione === 'modello';
      const sc = sceltaImmagine();
      avvisoAltrui.hidden = !(sc && tipo === 'firma' && archivio.altrui(sc));
      if (!avvisoAltrui.hidden) avvisoAltrui.textContent = `Questa è la firma di ${archivio.nomeProprietario(sc)}: prima di generare ti verrà chiesta una conferma, e ogni documento firmato sarà annotato nel registro delle firme.`;
    }
    selPos.addEventListener('change', () => { selDim.disabled = !s.immagine || s.posizione === 'modello'; });
    aggiornaPos(); mostraImg();

    // nome dei file
    const schemaIn = h('input', { type: 'text', value: s.schema, 'aria-label': 'Schema del nome dei file', spellcheck: 'false' });
    const esempio = h('p', { class: 'serie-esempio', 'aria-live': 'polite' });
    const aggEsempio = () => { s.schema = schemaIn.value; const r = s.records[0]; esempio.textContent = 'Esempio: ' + nomeFileDaSchema(s.schema, r?.dati, { n: 1, totale: s.records.length }); };
    schemaIn.addEventListener('input', aggEsempio);
    const chips = h('div', { class: 'serie-segnaposto', role: 'group', 'aria-label': 'Inserisci un segnaposto' }, segnapostoDisponibili(colonne()).slice(0, 18).map((p) => h('button', { type: 'button', class: 'serie-chip', title: 'Inserisci ' + p.value, onclick: () => {
      const a = schemaIn.selectionStart ?? schemaIn.value.length; const b = schemaIn.selectionEnd ?? a;
      schemaIn.value = schemaIn.value.slice(0, a) + p.value + schemaIn.value.slice(b); schemaIn.focus(); schemaIn.setSelectionRange(a + p.value.length, a + p.value.length); aggEsempio();
    } }, p.label)));
    aggEsempio();

    // destinazione
    const dest = h('div', { class: 'serie-scelte compatte', role: 'radiogroup', 'aria-label': 'Dove mettere i PDF' });
    const segnaDest = (v) => { s.destinazione = v; aggiornaScelte(dest, 'serie-dest'); };
    dest.append(
      scelta('serie-dest', 'cartella', s.destinazione, 'Un file per ogni record, in una cartella', 'Scegli la cartella al passo successivo', null, { onSelect: segnaDest }),
      scelta('serie-dest', 'unico-salva', s.destinazione, 'Un unico PDF con tutti i record', 'Da salvare dove vuoi (i campi diventano testo fisso)', null, { onSelect: segnaDest }),
      scelta('serie-dest', 'unico-apri', s.destinazione, 'Un unico PDF, aperto in Leggio', 'Per controllarlo o stamparlo subito', null, { onSelect: segnaDest }));
    const appiattisci = h('input', { type: 'checkbox', checked: s.appiattisci, onchange: () => { s.appiattisci = appiattisci.checked; } });

    corpo.append(
      h('section', { class: 'serie-sezione' }, h('h3', {}, 'Firma o timbro (facoltativo)'),
        h('div', { class: 'serie-griglia' }, h('label', { class: 'serie-etichetta' }, 'Da aggiungere a tutti', selImg), h('label', { class: 'serie-etichetta' }, 'Posizione', selPos), h('label', { class: 'serie-etichetta' }, 'Dimensione', selDim), anteprimaImg),
        avvisoAltrui,
        !mie.length && !altrui.length && !timbri.length ? h('p', { class: 'serie-nota' }, aperto ? 'Non ci sono firme o timbri nell\'archivio personale.' : 'L\'archivio personale è chiuso: firme e timbri non sono disponibili.') : null),
      h('section', { class: 'serie-sezione' }, h('h3', {}, 'Nome dei file'), schemaIn, chips, esempio),
      h('section', { class: 'serie-sezione' }, h('h3', {}, 'Dove mettere i PDF'), dest,
        h('label', { class: 'serie-check' }, appiattisci, h('span', {}, 'Appiattisci i campi: i PDF generati non saranno più modificabili'))),
    );
  }
  function sceltaImmagine() {
    if (!s.immagine) return null;
    const [tipo, id] = [s.immagine.slice(0, s.immagine.indexOf(':')), s.immagine.slice(s.immagine.indexOf(':') + 1)];
    return tipo === 'firma' ? archivio.firma(id) : archivio.timbro(id);
  }

  // ---------------------------------------------------------------- generazione
  async function genera() {
    if (!s.schema.trim()) throw new Error('Scrivi lo schema del nome dei file (per esempio {cognome}_{nome}.pdf).');
    const totale = s.records.length;
    const modello = modelloCorrente();
    const opzioni = { schema: s.schema, unico: s.destinazione !== 'cartella', appiattisci: s.appiattisci, oggi: todayIt(), data: new Date() };
    // firma o timbro
    const im = sceltaImmagine(); const tipoIm = s.immagine.split(':')[0];
    let firmaAltrui = null;
    if (im) {
      if (tipoIm === 'firma' && archivio.altrui(im)) {
        const ok = await app.ui.confirm(`La firma «${im.nome}» è di ${archivio.nomeProprietario(im)}. Confermi di avere la sua autorizzazione a usarla su ${totale} ${totale === 1 ? 'documento' : 'documenti'}? Ogni documento firmato verrà annotato nel registro delle firme.`, { title: 'Firma di un\'altra persona', okLabel: 'Sì, sono autorizzato' });
        if (!ok) return false;
        firmaAltrui = im;
      }
      const bytes = dataUrlToBytes(await archivio.immagine(im.blob));
      opzioni[tipoIm] = { bytes, posizione: await posizioneImmagine(tipoIm, im) };
    }
    // destinazione
    let cartella = null;
    if (s.destinazione === 'cartella') {
      cartella = await app.platform.chooseFolder('Scegli la cartella dove salvare i PDF');
      if (!cartella) return false;
    }
    // modello salvato (abbinamento, schema dei nomi)
    if (s.salvaModello) {
      try {
        const m = normalizzaModello({ ...(s.salvato || {}), ...modello, id: s.salvato?.id, nome: s.salvato?.nome || s.nomeModello.trim() || 'Modello', nomeFile: s.schema, blob: s.salvato?.blob || null });
        s.salvato = await salvaModelloConPdf(archivio, m, s.base, s.salvato);
      } catch (err) { app.log?.('warn', 'modello della serie non salvato', { error: err.message }); }
    }
    if (s.salvato?.id) archivio.usaModello(s.salvato.id);
    if (im) (tipoIm === 'firma' ? archivio.usaFirma(im.id) : archivio.usaTimbro(im.id));
    chiudi('genera');
    await esegui({ modello, opzioni, cartella, firmaAltrui, pagina: opzioni[tipoIm]?.posizione?.pagina });
    return true;
  }
  async function posizioneImmagine(tipo, im) {
    if (s.posizione === 'modello' && s.modello[tipo]) return s.modello[tipo];
    const d = await PDFLib.PDFDocument.load(s.base, { ignoreEncryption: true, updateMetadata: false });
    const n = d.getPageCount();
    const pagina = s.posizione === 'prima-destra' ? 0 : n - 1;
    const p = d.getPage(pagina); const { width, height } = p.getSize(); const rot = (p.getRotation().angle || 0) % 180 !== 0;
    const w = DIMENSIONI_IMG[s.dimensione] || 150;
    const ratio = (im.w && im.h) ? im.w / im.h : tipo === 'timbro' ? 1 : 2.6;
    const hh = Math.min(w / ratio, w);
    const dove = s.posizione === 'prima-destra' ? 'basso-destra' : s.posizione;
    const vis = posizionePredefinita(rot ? [height, width] : [width, height], dove, { size: [w, hh], pagina });
    if (!rot) return vis;
    // pagina ruotata: dal riquadro visivo al riquadro nelle coordinate del PDF
    const [x1, y1, x2, y2] = vis.rect; const a = p.getRotation().angle % 360;
    const conv = (x, y) => (a === 90 ? [width - y, x] : [y, height - x]);
    const [ax, ay] = conv(x1, y1); const [bx, by] = conv(x2, y2);
    return { pagina, rect: [Math.min(ax, bx), Math.min(ay, by), Math.max(ax, bx), Math.max(ay, by)] };
  }

  async function esegui({ modello, opzioni, cartella, firmaAltrui, pagina }) {
    const totale = s.records.length;
    const scritti = new Map(); // n → percorso
    const falliti = new Map(); // n → errore di scrittura
    let ultimoPercorso = null;
    const t0 = performance.now();
    const ris = await app.ui.withProgress(`Compilazione in serie (${totale} PDF)`, async (p) => {
      p.set(0, 'Preparazione del modulo…');
      const r = await eseguiSerie({
        PDFLib, base: s.base, modello, records: s.records, opzioni, signal: p.signal,
        onProgresso: (fatti, tot, chi) => p.set(fatti / tot, `${fatti} di ${tot}: ${chi}`),
        onGruppo: async (esiti) => {
          if (!cartella) return;
          for (const e of esiti) {
            if (!e.bytes) continue;
            try {
              const percorso = await app.platform.writeInFolder(cartella, e.nome, e.bytes);
              scritti.set(e.n, percorso); ultimoPercorso = percorso;
              if (firmaAltrui) archivio.registra({ firma: firmaAltrui, documento: typeof percorso === 'string' ? percorso : e.nome, pagine: String(paginaEffettiva(pagina ?? -1, s.modello.pagine || 1) + 1), azione: 'compilazione in serie' });
            } catch (err) { falliti.set(e.n, err?.userMessage || err?.message || String(err)); }
          }
        },
      });
      return r;
    });
    if (!ris) return;
    for (const e of ris.esiti) if (falliti.has(e.n)) { e.stato = 'errore'; e.errore = 'File non salvato: ' + falliti.get(e.n); }
    let unicoSalvato = null;
    if (ris.unico) {
      const nome = `${s.nomeModulo.replace(/\.pdf$/i, '')}_serie.pdf`;
      if (s.destinazione === 'unico-apri') { await app.openBytes(ris.unico, { name: nome }); unicoSalvato = nome; }
      else { const r = await app.exportFile(ris.unico, nome, [{ name: 'Documento PDF', extensions: ['pdf'] }]); unicoSalvato = r ? (r.path || r.name || nome) : null; }
      if (firmaAltrui && unicoSalvato) for (const e of ris.esiti) if (e.stato !== 'errore') archivio.registra({ firma: firmaAltrui, documento: `${unicoSalvato} — ${e.etichetta}`, pagine: '', azione: 'compilazione in serie (PDF unico)' });
    }
    app.log?.('info', 'compilazione in serie', { record: totale, ms: Math.round(performance.now() - t0), worker: ris.inWorker, unico: !!ris.unico, interrotto: ris.interrotto });
    await mostraRiepilogo(app, ris, { cartella, ultimoPercorso, unicoSalvato, unico: opzioni.unico, totale });
  }

  vai(s.passo);
  return finita;
}

/** Riepilogo finale: generati, con avvisi, falliti; elenco per record; esportazione CSV. */
async function mostraRiepilogo(app, ris, { cartella, ultimoPercorso, unicoSalvato, unico, totale }) {
  const { h } = app.ui;
  const r = riepilogo(ris.esiti);
  const problemi = ris.esiti.filter((e) => e.stato !== 'ok');
  const righe = problemi.slice(0, 300).map((e) => h('tr', { class: 'serie-esito-' + e.stato },
    h('td', {}, String(e.n)), h('td', {}, e.etichetta), h('td', {}, e.stato === 'errore' ? 'Non generato' : 'Con avvisi'),
    h('td', {}, [...(e.avvisi || []), e.errore].filter(Boolean).join(' · '))));
  const body = h('div', { class: 'serie-riepilogo' },
    h('div', { class: 'serie-conteggi' },
      h('div', { class: 'serie-conteggio ok' }, h('strong', {}, String(r.ok)), h('span', {}, 'generati senza problemi')),
      h('div', { class: 'serie-conteggio avvisi' }, h('strong', {}, String(r.avvisi)), h('span', {}, 'generati con avvisi')),
      h('div', { class: 'serie-conteggio errori' }, h('strong', {}, String(r.errori)), h('span', {}, 'non generati'))),
    ris.interrotto ? h('p', { class: 'serie-avviso' }, `Interrotto: elaborati ${ris.esiti.length} record su ${totale}.`) : null,
    unico ? h('p', { class: 'serie-nota' }, unicoSalvato ? `PDF unico: «${unicoSalvato}»${ris.pagineUnico ? ` (${ris.pagineUnico} pagine)` : ''}.` : 'Il PDF unico non è stato salvato.') : null,
    cartella && cartella !== '__download__' ? h('p', { class: 'serie-nota' }, `Cartella: ${cartella}`) : null,
    problemi.length ? h('div', { class: 'serie-tabella-wrap alta' }, h('table', { class: 'serie-tabella' }, h('thead', {}, h('tr', {}, ['N.', 'Record', 'Esito', 'Dettagli'].map((t) => h('th', { scope: 'col' }, t)))), h('tbody', {}, righe))) : h('p', { class: 'serie-ok' }, '✓ Tutti i record sono stati generati senza avvisi.'),
    problemi.length > 300 ? h('p', { class: 'serie-nota' }, `Mostrati i primi 300 su ${problemi.length}: l'elenco completo è nel riepilogo CSV.`) : null);
  const bottoni = [{ value: 'csv', label: 'Esporta il riepilogo (CSV)', left: true }];
  if (ultimoPercorso && typeof ultimoPercorso === 'string' && cartella !== '__download__') bottoni.push({ value: 'cartella', label: 'Mostra nella cartella' });
  bottoni.push({ value: 'chiudi', label: 'Chiudi', primary: true });
  for (;;) {
    const v = await app.ui.choice({ title: ris.interrotto ? 'Compilazione in serie interrotta' : 'Compilazione in serie completata', body, buttons: bottoni, width: 760 });
    if (v === 'csv') {
      const bytes = new TextEncoder().encode(riepilogoCsv(ris.esiti));
      await app.exportFile(bytes, 'riepilogo_compilazione_serie.csv', [{ name: 'Excel (CSV)', extensions: ['csv'] }]);
      continue;
    }
    if (v === 'cartella') { app.platform.showInFolder(ultimoPercorso); continue; }
    return r;
  }
}

// ------------------------------------------------------------------------------------------- registrazione
export function registerSerie(app, ctx) {
  const modelli = registerModelli(app, ctx);
  const avvia = (opts) => avviaSerie(app, ctx, opts);
  app.registerTool({
    id: 'mail-merge', name: 'Compilazione in serie', category: 'moduli', icon: 'mail', needsDoc: false,
    description: 'Crea un PDF per ogni persona di un gruppo della rubrica o per ogni riga di un foglio Excel, dallo stesso modulo',
    keywords: 'compilazione in serie stampa unione mail merge massiva tanti moduli excel csv rubrica gruppo modello',
    run: () => avvia(),
  });
  ctx.serie = { avvia, esegui: eseguiSerie, modelli };
}

export { corrispondenzeModello, etichettaChiave };
