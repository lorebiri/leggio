// Dialoghi degli strumenti semplici: estrai, elimina, ruota, inserisci, sostituisci, duplica, inverti,
// ridimensiona, N-up, opuscolo, etichette di pagina, rimozione degli elementi aggiunti.
import * as S from '../logica/struttura.js';
import * as I from '../logica/impaginazione.js';
import * as B from '../logica/segnalibri.js';
import * as T from '../logica/timbri.js';
import { FORMATI, FORMATI_ETICHETTE, mmToPt, intervalli, indiciInTesto, nomeFileSicuro, senzaEstensione } from '../logica/util.js';
import { pdfDaImmagini } from '../logica/crea.js';
import { caricaEsterno, caricaAttivo, mostraErrore, protetto, apriRisultato, nomeRisultato, preparaImmagine, eImmagine, FILTRO_TUTTI, trovaPagineBianche } from './comune.js';

const pagineDi = (app, s) => intervalli(s, app.activeDoc.pageCount);
const valida = (app, s) => { try { pagineDi(app, s); return null; } catch (e) { return e.message; } };
const conta = (n) => (n === 1 ? '1 pagina' : `${n} pagine`);

/** Esegue una modifica annullabile con pdf-lib mostrando l'avanzamento per i documenti grandi. */
export async function modifica(app, etichetta, fn) {
  const doc = app.activeDoc;
  try {
    const grande = doc.pageCount > 150 || doc.bytes.length > 20e6;
    if (!grande) return await app.editWithPdfLib(etichetta, fn, doc);
    return await app.ui.withProgress(etichetta, async (p) => {
      p.set(null, `Elaborazione di ${doc.pageCount} pagine…`);
      return app.editWithPdfLib(etichetta, (pdfDoc, L, d) => fn(pdfDoc, L, d, p), doc);
    });
  } catch (err) { mostraErrore(app, err, etichetta); return false; }
}

/** Legge un PDF (o immagini → PDF) scelto dall'utente. → { nome, lib (PDFDocument) } | null */
export async function scegliPdf(app, titolo = 'Scegli un PDF', { immagini = true } = {}) {
  const files = await app.platform.openFiles({ multiple: immagini, filters: immagini ? FILTRO_TUTTI : [{ name: 'Documenti PDF', extensions: ['pdf'] }], raw: true, title: titolo });
  if (!files?.length) return null;
  if (immagini && files.every((f) => eImmagine(f.name))) {
    const imgs = [];
    for (const f of files) imgs.push({ ...(await preparaImmagine(app, f.bytes, f.name)), nome: f.name });
    const d = await pdfDaImmagini(imgs, { formato: 'A4', margine: 10 });
    return { nome: files.length === 1 ? files[0].name : `${files.length} immagini`, lib: await S.caricaPdf(await d.save()) };
  }
  const f = files[0];
  const lib = await caricaEsterno(app, f.bytes, f.name);
  return lib ? { nome: f.name, lib } : null;
}

// ---------------- estrai ----------------
export async function estrai(app, preset) {
  const doc = app.activeDoc;
  const v = preset ? { pages: indiciInTesto(preset), modo: 'scheda', elimina: false } : await app.ui.dialog({ title: 'Estrai pagine', message: 'Copia le pagine scelte in un nuovo documento. L\'originale non cambia, a meno che tu non scelga di togliere le pagine.', fields: [
    { name: 'pages', label: 'Pagine da estrarre', type: 'pages', value: String(app.viewer.page), help: 'Esempi: 1-2, 28 · pari · dispari · 5-' },
    { name: 'modo', label: 'Risultato', type: 'radio', value: 'scheda', options: [{ value: 'scheda', label: 'Un nuovo documento con tutte le pagine estratte' }, { value: 'file', label: 'Un file separato per ogni pagina (in una cartella)' }] },
    { name: 'elimina', label: 'Togli le pagine estratte da questo documento', type: 'checkbox', value: false },
  ], okLabel: 'Estrai', validate: (x) => valida(app, x.pages) });
  if (!v) return;
  const indici = pagineDi(app, v.pages);
  if (v.elimina && indici.length >= doc.pageCount) return app.ui.toast('Non puoi togliere tutte le pagine dal documento: deseleziona «Togli le pagine estratte».', { kind: 'warning', timeout: 6000 });
  const base = senzaEstensione(doc.name);
  const ok = await protetto(app, 'Estrai pagine', async () => {
    if (v.modo === 'file') {
      const cartella = await app.platform.chooseFolder('Dove salvo le pagine estratte?');
      if (!cartella) return false;
      const cifre = Math.max(2, String(doc.pageCount).length);
      await app.ui.withProgress('Estrazione delle pagine', async (p) => {
        let src = await caricaAttivo(app);
        for (let k = 0; k < indici.length; k++) {
          if (p.cancelled) throw Object.assign(new Error(), { name: 'AbortError' });
          p.set(k / indici.length, `Pagina ${indici[k] + 1}`);
          const out = await S.estraiInNuovo(src, [indici[k]]);
          await app.platform.writeInFolder(cartella, `${nomeFileSicuro(base)}_pag${String(indici[k] + 1).padStart(cifre, '0')}.pdf`, await out.save());
          if (k % 25 === 24) src = await caricaAttivo(app);
        }
      });
      app.ui.toast(`Salvati ${indici.length} file`, { kind: 'success', timeout: 6000 });
    } else {
      const bytes = await app.ui.withProgress('Estrazione delle pagine', async (p) => { p.set(null); const src = await caricaAttivo(app); return (await S.estraiInNuovo(src, indici)).save(); });
      if (bytes) await apriRisultato(app, bytes, nomeRisultato(app, 'estratto'));
    }
    return true;
  });
  if (ok && v.elimina) { const orig = app.docs.find((d) => d === doc); if (orig) { app.activate(orig); await modifica(app, `Tolte ${conta(indici.length)} estratte`, (d) => S.elimina(d, indici)); } }
}

// ---------------- elimina ----------------
export async function eliminaDialogo(app) {
  const v = await app.ui.dialog({ title: 'Elimina pagine', fields: [
    { name: 'modo', type: 'radio', value: 'pagine', options: [{ value: 'pagine', label: 'Le pagine indicate' }, { value: 'bianche', label: 'Le pagine bianche (le cerco io e ti chiedo conferma)' }] },
    { name: 'pages', label: 'Pagine da eliminare', type: 'pages', value: String(app.viewer.page), help: 'Esempi: 3 · 2-4, 9 · pari. Puoi sempre annullare con Ctrl+Z.' },
  ], okLabel: 'Elimina', danger: true, validate: (x) => (x.modo === 'pagine' ? valida(app, x.pages) : null) });
  if (!v) return;
  if (v.modo === 'bianche') return eliminaBianche(app);
  return eliminaPagine(app, pagineDi(app, v.pages));
}
export async function eliminaPagine(app, indici) {
  const n = app.activeDoc.pageCount;
  if (indici.length >= n) return app.ui.toast('Non puoi eliminare tutte le pagine: un PDF deve averne almeno una.', { kind: 'warning', timeout: 6000 });
  const ok = await modifica(app, indici.length === 1 ? `Eliminata la pagina ${indici[0] + 1}` : `Eliminate ${indici.length} pagine`, (d) => S.elimina(d, indici));
  if (ok) app.ui.toast(indici.length === 1 ? `Eliminata la pagina ${indici[0] + 1}` : `Eliminate ${indici.length} pagine (${indiciInTesto(indici)})`, { kind: 'success', timeout: 10000, action: { label: 'Annulla', run: () => app.undo() } });
}
export async function eliminaBianche(app) {
  const doc = app.activeDoc;
  const bianche = await trovaPagineBianche(app, doc.pdf, [...Array(doc.pageCount).keys()]).catch((e) => mostraErrore(app, e, 'Pagine bianche'));
  if (!bianche) return;
  if (!bianche.length) return app.ui.toast('Nessuna pagina bianca trovata', { kind: 'success' });
  if (bianche.length >= doc.pageCount) return app.ui.toast('Tutte le pagine sembrano bianche: non elimino nulla.', { kind: 'warning' });
  const ok = await app.ui.confirm(`Ho trovato ${conta(bianche.length)} bianca${bianche.length === 1 ? '' : 'he'}: ${indiciInTesto(bianche)}.\nVuoi eliminarle?`, { title: 'Pagine bianche', okLabel: 'Elimina', danger: true });
  if (ok) await eliminaPagine(app, bianche);
}

// ---------------- ruota ----------------
export async function ruotaDialogo(app) {
  const v = await app.ui.dialog({ title: 'Ruota pagine', message: 'La rotazione viene salvata nel file (non è solo la visualizzazione).', fields: [
    { name: 'gradi', label: 'Direzione', type: 'radio', value: '90', options: [{ value: '90', label: '↻ A destra (90° in senso orario)' }, { value: '-90', label: '↺ A sinistra (90° in senso antiorario)' }, { value: '180', label: 'Capovolgi (180°)' }] },
    { name: 'pages', label: 'Pagine', type: 'pages', value: '', help: 'Vuoto = tutte · es. 2-4, 7 · pari · dispari' },
  ], okLabel: 'Ruota', validate: (x) => valida(app, x.pages) });
  if (!v) return;
  const indici = pagineDi(app, v.pages);
  await modifica(app, `Ruotate ${conta(indici.length)}`, (d) => S.ruota(d, indici, +v.gradi));
}

// ---------------- inserisci ----------------
export async function inserisci(app, { dopo = app.viewer.pageIndex, sorgente } = {}) {
  const doc = app.activeDoc; const n = doc.pageCount;
  const v = await app.ui.dialog({ title: 'Inserisci pagine', fields: [
    { name: 'src', label: 'Cosa inserire', type: 'radio', value: sorgente || 'file', options: [{ value: 'file', label: 'Pagine da un file (PDF o foto)…' }, { value: 'vuota', label: 'Pagine vuote' }] },
    { name: 'dove', label: 'Posizione', type: 'select', value: 'dopo', options: [{ value: 'prima', label: 'Prima della pagina' }, { value: 'dopo', label: 'Dopo la pagina' }, { value: 'inizio', label: 'All\'inizio del documento' }, { value: 'fine', label: 'Alla fine del documento' }] },
    { name: 'rif', label: `Pagina di riferimento (1-${n})`, type: 'number', min: 1, max: n, step: 1, value: dopo + 1 },
    { name: 'quante', label: 'Quante pagine vuote', type: 'number', min: 1, max: 500, step: 1, value: 1 },
    { name: 'formato', label: 'Formato delle pagine vuote', type: 'select', value: 'uguale', options: [{ value: 'uguale', label: 'Uguale alla pagina di riferimento' }, ...FORMATI_ETICHETTE.map(([k, l]) => ({ value: k, label: l })), { value: 'A4o', label: 'A4 orizzontale' }] },
  ], okLabel: 'Continua', validate: (x) => {
    if (['prima', 'dopo'].includes(x.dove) && !(Number.isInteger(x.rif) && x.rif >= 1 && x.rif <= n)) return `La pagina di riferimento deve essere tra 1 e ${n}.`;
    if (x.src === 'vuota' && !(Number.isInteger(x.quante) && x.quante >= 1 && x.quante <= 500)) return 'Puoi inserire da 1 a 500 pagine vuote.';
  } });
  if (!v) return;
  const at = { prima: v.rif - 1, dopo: v.rif, inizio: 0, fine: n }[v.dove];
  if (v.src === 'vuota') {
    let size;
    if (v.formato === 'uguale') {
      const p = await doc.pdf.getPage(Math.min(n, Math.max(1, v.rif)));
      const rv = p.getViewport({ scale: 1 }); size = [rv.width, rv.height];
    } else size = v.formato === 'A4o' ? [FORMATI.A4[1], FORMATI.A4[0]] : FORMATI[v.formato];
    return modifica(app, v.quante === 1 ? 'Inserita una pagina vuota' : `Inserite ${v.quante} pagine vuote`, (d) => S.inserisciVuote(d, at, v.quante, size));
  }
  const scelto = await protetto(app, 'Inserisci pagine', () => scegliPdf(app, 'Scegli il PDF o le foto da inserire'));
  if (!scelto) return;
  let indici = [...Array(scelto.lib.getPageCount()).keys()];
  if (indici.length > 1) {
    const w = await app.ui.dialog({ title: 'Quali pagine inserire?', message: `«${scelto.nome}» ha ${indici.length} pagine.`, fields: [{ name: 'p', label: 'Pagine del file', type: 'pages', value: '', help: 'Vuoto = tutte' }], okLabel: 'Inserisci', validate: (x) => { try { intervalli(x.p, indici.length); } catch (e) { return e.message; } } });
    if (!w) return;
    indici = intervalli(w.p, indici.length);
  }
  await modifica(app, `Inserite ${conta(indici.length)} da «${scelto.nome}»`, (d) => S.inserisciDaPdf(d, scelto.lib, indici, at));
}

// ---------------- sostituisci ----------------
export async function sostituisci(app, preset) {
  const n = app.activeDoc.pageCount;
  const v = await app.ui.dialog({ title: 'Sostituisci pagine', message: 'Le pagine indicate vengono sostituite, nello stesso punto, con pagine prese da un altro file.', fields: [
    { name: 'pages', label: 'Pagine da sostituire', type: 'pages', value: preset ? indiciInTesto(preset) : String(app.viewer.page), placeholder: 'es. 3 oppure 3-4' },
    { name: 'da', label: 'Nel file nuovo, inizia dalla pagina', type: 'number', min: 1, step: 1, value: 1 },
  ], okLabel: 'Scegli il file…', validate: (x) => valida(app, x.pages) || (!(Number.isInteger(x.da) && x.da >= 1) ? 'La pagina iniziale deve essere 1 o più.' : null) });
  if (!v) return;
  const target = pagineDi(app, v.pages);
  const scelto = await protetto(app, 'Sostituisci pagine', () => scegliPdf(app, 'Scegli il file con le pagine nuove'));
  if (!scelto) return;
  const m = scelto.lib.getPageCount();
  if (v.da - 1 + target.length > m) return app.ui.dialog({ title: 'Sostituisci pagine', message: `«${scelto.nome}» ha ${m} pagine: non bastano per sostituirne ${target.length} partendo dalla ${v.da}.`, cancelLabel: null, okLabel: 'Ho capito' });
  const src = target.map((_, k) => v.da - 1 + k);
  await modifica(app, `Sostituite ${conta(target.length)}`, (d) => S.sostituisci(d, target, scelto.lib, src));
}

// ---------------- duplica / inverti ----------------
export async function duplicaDialogo(app, preset) {
  const v = await app.ui.dialog({ title: 'Duplica pagine', fields: [
    { name: 'pages', label: 'Pagine da duplicare', type: 'pages', value: preset ? indiciInTesto(preset) : String(app.viewer.page) },
    { name: 'copie', label: 'Numero di copie', type: 'number', min: 1, max: 100, step: 1, value: 1 },
    { name: 'dove', label: 'Dove mettere le copie', type: 'radio', value: 'dopo', options: [{ value: 'dopo', label: 'Subito dopo ogni pagina' }, { value: 'fine', label: 'In fondo al documento' }] },
  ], okLabel: 'Duplica', validate: (x) => valida(app, x.pages) || (!(Number.isInteger(x.copie) && x.copie >= 1 && x.copie <= 100) ? 'Le copie vanno da 1 a 100.' : null) });
  if (!v) return;
  const indici = pagineDi(app, v.pages);
  await modifica(app, `Duplicate ${conta(indici.length)}`, (d) => S.duplica(d, indici, { copie: v.copie, dove: v.dove }));
}
export async function invertiDialogo(app) {
  const v = await app.ui.dialog({ title: 'Inverti ordine delle pagine', message: 'Utile per le scansioni fatte dall\'ultima pagina alla prima.', fields: [
    { name: 'pages', label: 'Pagine', type: 'pages', value: '', help: 'Vuoto = tutto il documento' },
  ], okLabel: 'Inverti', validate: (x) => valida(app, x.pages) });
  if (!v) return;
  const indici = pagineDi(app, v.pages);
  await modifica(app, 'Ordine delle pagine invertito', (d) => S.inverti(d, indici));
}

// ---------------- ridimensiona ----------------
export async function ridimensionaDialogo(app) {
  const v = await app.ui.dialog({ title: 'Ridimensiona pagine', message: 'Porta le pagine a un formato carta. Il contenuto viene adattato senza deformarlo; commenti e campi seguono il contenuto.', fields: [
    { name: 'formato', label: 'Formato', type: 'select', value: 'A4', options: [...FORMATI_ETICHETTE.map(([k, l]) => ({ value: k, label: l })), { value: 'custom', label: 'Personalizzato (mm)…' }] },
    { name: 'w', label: 'Larghezza (mm) — solo per «Personalizzato»', type: 'number', min: 20, max: 5000, value: 210 },
    { name: 'hh', label: 'Altezza (mm) — solo per «Personalizzato»', type: 'number', min: 20, max: 5000, value: 297 },
    { name: 'orient', label: 'Orientamento', type: 'select', value: 'auto', options: [{ value: 'auto', label: 'Come ogni pagina (verticali restano verticali)' }, { value: 'verticale', label: 'Tutte verticali' }, { value: 'orizzontale', label: 'Tutte orizzontali' }] },
    { name: 'modo', label: 'Contenuto', type: 'radio', value: 'adatta', options: [{ value: 'adatta', label: 'Adatta alla nuova pagina (ingrandisce o riduce)' }, { value: 'centra', label: 'Lascia la grandezza originale e centra' }] },
    { name: 'pages', label: 'Pagine', type: 'pages', value: '' },
  ], okLabel: 'Ridimensiona', validate: (x) => valida(app, x.pages) || (x.formato === 'custom' && !(x.w >= 20 && x.hh >= 20 && x.w <= 5000 && x.hh <= 5000) ? 'Misure tra 20 e 5000 mm.' : null) });
  if (!v) return;
  const size = v.formato === 'custom' ? [mmToPt(v.w), mmToPt(v.hh)] : FORMATI[v.formato];
  const indici = pagineDi(app, v.pages);
  await modifica(app, `Pagine portate a ${v.formato === 'custom' ? `${v.w}×${v.hh} mm` : v.formato}`, (d, L, doc, p) => I.ridimensiona(d, indici, size, { modo: v.modo, orientamento: v.orient, onProgress: (f) => p?.set(f), signal: p?.signal }));
}

// ---------------- N-up e opuscolo ----------------
export async function nUpDialogo(app) {
  const v = await app.ui.dialog({ title: 'Più pagine per foglio', message: 'Crea un nuovo documento con più pagine affiancate su ogni foglio (comodo per stampare giustificativi piccoli).', fields: [
    { name: 'n', label: 'Pagine per foglio', type: 'radio', value: '2', options: [{ value: '2', label: '2 (foglio orizzontale)' }, { value: '4', label: '4' }, { value: '6', label: '6' }, { value: '9', label: '9' }] },
    { name: 'formato', label: 'Formato del foglio', type: 'select', value: 'A4', options: FORMATI_ETICHETTE.map(([k, l]) => ({ value: k, label: l })) },
    { name: 'bordo', label: 'Disegna un bordo attorno a ogni pagina', type: 'checkbox', value: true },
    { name: 'pages', label: 'Pagine', type: 'pages', value: '' },
  ], okLabel: 'Crea', validate: (x) => valida(app, x.pages) });
  if (!v) return;
  const indici = pagineDi(app, v.pages);
  const bytes = await protetto(app, 'Più pagine per foglio', () => app.ui.withProgress('Impaginazione', async (p) => {
    const out = await I.nUp(await caricaAttivo(app), { perFoglio: +v.n, formato: FORMATI[v.formato], bordo: v.bordo, indici, onProgress: (f) => p.set(f), signal: p.signal });
    return out.save();
  }));
  if (bytes) await apriRisultato(app, bytes, nomeRisultato(app, `${v.n}xfoglio`));
}
export async function opuscoloDialogo(app) {
  const v = await app.ui.dialog({ title: 'Opuscolo', message: 'Crea un nuovo documento con le pagine disposte per piegare i fogli a metà. Stampa fronte/retro capovolgendo sul lato corto.', fields: [
    { name: 'formato', label: 'Formato del foglio', type: 'select', value: 'A4', options: FORMATI_ETICHETTE.map(([k, l]) => ({ value: k, label: l })) },
    { name: 'ril', label: 'Rilegatura', type: 'radio', value: 'sinistra', options: [{ value: 'sinistra', label: 'A sinistra (come un libro)' }, { value: 'destra', label: 'A destra' }] },
  ], okLabel: 'Crea' });
  if (!v) return;
  const bytes = await protetto(app, 'Opuscolo', () => app.ui.withProgress('Impaginazione dell\'opuscolo', async (p) => (await I.opuscolo(await caricaAttivo(app), { formato: FORMATI[v.formato], rilegatura: v.ril, onProgress: (f) => p.set(f), signal: p.signal })).save()));
  if (bytes) await apriRisultato(app, bytes, nomeRisultato(app, 'opuscolo'));
}

// ---------------- etichette di pagina ----------------
export async function etichetteDialogo(app) {
  const { h } = app.ui;
  const doc = app.activeDoc; const n = doc.pageCount;
  const lib = await caricaAttivo(app);
  let righe = B.leggiEtichette(lib).map((r) => ({ ...r }));
  if (!righe.length) righe = [{ da: 0, stile: 'D', prefisso: '', inizio: 1 }];
  const box = h('div', {});
  const anteprima = h('p', { class: 'help' });
  const disegna = () => {
    box.innerHTML = '';
    righe.forEach((r, k) => {
      const da = h('input', { type: 'number', class: 'pg-input', min: 1, max: n, value: r.da + 1, disabled: k === 0, 'aria-label': 'Dalla pagina' });
      const st = h('select', { class: 'pg-input', 'aria-label': 'Stile' }, B.STILI_ETICHETTA.map(([v2, l]) => h('option', { value: v2, selected: v2 === r.stile }, l)));
      const pr = h('input', { type: 'text', class: 'pg-input', value: r.prefisso, placeholder: 'es. A-', 'aria-label': 'Prefisso' });
      const ini = h('input', { type: 'number', class: 'pg-input', min: 1, value: r.inizio, 'aria-label': 'Inizia da' });
      const agg = () => { r.da = Math.max(0, (parseInt(da.value, 10) || 1) - 1); r.stile = st.value; r.prefisso = pr.value; r.inizio = parseInt(ini.value, 10) || 1; aggiornaAnteprima(); };
      [da, st, pr, ini].forEach((x) => x.addEventListener('input', agg));
      box.append(h('div', { class: 'pg-riga' },
        h('div', { class: 'field' }, h('label', {}, 'Dalla pagina'), da), h('div', { class: 'field' }, h('label', {}, 'Stile'), st),
        h('div', { class: 'field' }, h('label', {}, 'Prefisso'), pr), h('div', { class: 'field' }, h('label', {}, 'Inizia da'), ini),
        k ? h('button', { type: 'button', class: 'btn small', onclick: () => { righe.splice(k, 1); disegna(); } }, 'Togli') : h('span', { style: { width: '52px' } })));
    });
    aggiornaAnteprima();
  };
  const aggiornaAnteprima = () => {
    const esempi = [...new Set([0, 1, 2, ...righe.map((r) => r.da), ...righe.map((r) => r.da + 1), n - 1])].filter((i) => i >= 0 && i < n).sort((a, b) => a - b).slice(0, 10);
    anteprima.textContent = 'Anteprima: ' + esempi.map((i) => `pag. ${i + 1} → «${B.etichettaPagina(righe, i)}»`).join(' · ');
  };
  disegna();
  const corpo = h('div', {}, h('p', { class: 'dlg-msg' }, 'Le etichette sono i numeri di pagina mostrati dai lettori PDF (es. i, ii, iii per la prefazione e poi 1, 2, 3). Non cambiano il contenuto stampato.'), box,
    h('button', { type: 'button', class: 'btn small', onclick: () => { righe.push({ da: Math.min(n - 1, (righe[righe.length - 1]?.da || 0) + 1), stile: 'D', prefisso: '', inizio: 1 }); disegna(); } }, '+ Aggiungi un intervallo'), anteprima);
  const v = await app.ui.dialog({ title: 'Etichette di pagina', body: corpo, width: 620, okLabel: 'Applica', fields: [{ name: 'rimuovi', label: 'Togli tutte le etichette (torna a 1, 2, 3…)', type: 'checkbox', value: false }],
    validate: () => { const ord = righe.map((r) => r.da); if (new Set(ord).size !== ord.length) return 'Due intervalli iniziano dalla stessa pagina.'; if (righe.some((r) => r.da >= n)) return `Le pagine vanno da 1 a ${n}.`; return null; } });
  if (!v) return;
  await modifica(app, v.rimuovi ? 'Etichette di pagina rimosse' : 'Etichette di pagina impostate', (d) => B.scriviEtichette(d, v.rimuovi ? [] : righe));
}

// ---------------- rimuovi elementi aggiunti ----------------
export async function rimuoviAggiunti(app) {
  const lib = await caricaAttivo(app);
  const presenti = T.elementiAggiunti(lib);
  const nomi = { Intestazione: 'Intestazioni e piè di pagina / numeri di pagina', Bates: 'Numerazione progressiva degli allegati (Bates)', Filigrana: 'Filigrane', Sfondo: 'Sfondi' };
  const tipi = Object.keys(presenti);
  if (!tipi.length) return app.ui.dialog({ title: 'Rimuovi elementi aggiunti', message: 'In questo documento non ci sono intestazioni, numeri, filigrane o sfondi aggiunti con Leggio.', cancelLabel: null, okLabel: 'Chiudi' });
  const v = await app.ui.dialog({ title: 'Rimuovi elementi aggiunti', message: 'Scegli cosa togliere (solo gli elementi aggiunti con Leggio).', fields: tipi.map((t) => ({ name: t, label: `${nomi[t] || t} (${presenti[t]} pagine)`, type: 'checkbox', value: true })), okLabel: 'Rimuovi', danger: true });
  if (!v) return;
  const scelti = tipi.filter((t) => v[t]);
  if (!scelti.length) return;
  await modifica(app, 'Elementi aggiunti rimossi', (d) => { T.rimuoviElementi(d, scelti); });
}
