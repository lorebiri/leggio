// Funzioni d'interfaccia condivise dagli strumenti dell'area «pagine».
import { PDFDocument } from '@cantoo/pdf-lib';
import { caricaPdf } from '../logica/struttura.js';
import { tipoImmagine, sembraPdf, senzaEstensione, ErroreUtente } from '../logica/util.js';
import { analizzaPixel } from '../logica/impaginazione.js';

export { senzaEstensione, ErroreUtente };

export const FILTRO_PDF = [{ name: 'Documenti PDF', extensions: ['pdf'] }];
export const FILTRO_IMMAGINI = [{ name: 'Immagini', extensions: ['jpg', 'jpeg', 'png', 'heic', 'heif', 'webp', 'gif', 'bmp'] }];
export const FILTRO_TUTTI = [{ name: 'PDF e immagini', extensions: ['pdf', 'jpg', 'jpeg', 'png', 'heic', 'heif', 'webp', 'gif', 'bmp'] }];

/** Mostra un errore: quelli "per l'utente" come messaggio semplice, gli altri con contesto. */
export function mostraErrore(app, err, contesto) {
  if (err?.name === 'AbortError') { app.ui.toast('Operazione annullata'); return; }
  if (err?.name === 'ErroreUtente') { app.ui.dialog({ title: contesto || 'Attenzione', message: err.message, cancelLabel: null, okLabel: 'Ho capito' }); return; }
  app.reportError(err, contesto || 'Operazione non riuscita');
}

/** Esegue fn gestendo gli errori; ritorna il risultato o undefined. */
export async function protetto(app, contesto, fn) {
  try { return await fn(); } catch (err) { mostraErrore(app, err, contesto); return undefined; }
}

/** Carica un PDF esterno con pdf-lib chiedendo la password se serve. → PDFDocument | null */
export async function caricaEsterno(app, bytes, nome) {
  if (!sembraPdf(bytes)) throw new ErroreUtente(`«${nome}» non è un file PDF.`);
  try { return await caricaPdf(bytes, { nome }); } catch (err) {
    if (!err.protetto) throw err;
    // prima prova: solo restrizioni (password di apertura vuota)
    try { return await PDFDocument.load(bytes, { password: '', updateMetadata: false }); } catch {}
    for (let tentativo = 0; tentativo < 3; tentativo++) {
      const pw = await app.ui.prompt(tentativo ? 'Password errata, riprova:' : `«${nome}» è protetto. Inserisci la password per usarlo:`, '', { title: 'File protetto', type: 'password', okLabel: 'Usa il file' });
      if (pw == null) return null;
      try { return await PDFDocument.load(bytes, { password: pw, updateMetadata: false }); } catch {}
    }
    throw new ErroreUtente(`Password non corretta per «${nome}».`);
  }
}

/** Documento attivo come PDFDocument usa e getta (dai byte correnti). */
export async function caricaAttivo(app) {
  const doc = app.activeDoc;
  const bytes = await app.currentBytes(doc);
  return app.lib.openPdfLib(bytes, doc.password);
}

/** Byte di un file di immagine → { bytes, tipo:'jpg'|'png' } convertendo i formati non supportati. */
export async function preparaImmagine(app, bytes, nome) {
  const tipo = tipoImmagine(bytes);
  if (tipo === 'jpg' || tipo === 'png') return { bytes, tipo };
  if (/\.(heic|heif)$/i.test(nome) || (!tipo && isHeic(bytes))) {
    if (!window.leggio) throw new ErroreUtente(`«${nome}» è una foto HEIC (iPhone): la conversione è disponibile solo nell'app desktop su Mac. In alternativa, sul telefono imposta Fotocamera → Formati → «Più compatibile».`);
    const r = await app.platform.invokeFeature('pagine:heic', { bytes });
    if (r?.bytes) return { bytes: r.bytes, tipo: 'jpg' };
    if (r?.errore === 'non-supportato') throw new ErroreUtente(`«${nome}» è una foto HEIC (iPhone). Su Windows Leggio non può ancora convertirla: aprila con l'app Foto e scegli «Salva con nome» in JPG, oppure sul telefono imposta Fotocamera → Formati → «Più compatibile».`);
    throw new ErroreUtente(`Non riesco a convertire la foto HEIC «${nome}». Prova ad aprirla con Anteprima e a esportarla in JPG.`);
  }
  // WebP, GIF, BMP e altri formati che il browser sa leggere → PNG/JPEG via canvas
  try {
    const bmp = await createImageBitmap(new Blob([bytes]));
    const cv = document.createElement('canvas'); cv.width = bmp.width; cv.height = bmp.height;
    const ctx = cv.getContext('2d'); ctx.drawImage(bmp, 0, 0); bmp.close?.();
    const blob = await new Promise((r) => cv.toBlob(r, 'image/jpeg', 0.9));
    return { bytes: new Uint8Array(await blob.arrayBuffer()), tipo: 'jpg' };
  } catch {
    throw new ErroreUtente(`«${nome}» non è un'immagine che Leggio sa leggere (usa JPG, PNG, HEIC, WebP, GIF o BMP).`);
  }
}

function isHeic(b) {
  if (!b || b.length < 12) return false;
  const s = String.fromCharCode(...b.subarray(4, 12));
  return /^ftyp(heic|heix|hevc|hevx|heim|heis|mif1|msf1)/.test(s);
}

export const eImmagine = (nome) => /\.(jpe?g|png|heic|heif|webp|gif|bmp)$/i.test(nome || '');
export const ePdf = (nome) => /\.pdf$/i.test(nome || '');

/** File del sistema (File del drag&drop) → { name, bytes } */
export async function leggiFile(f) { return { name: f.name, path: null, bytes: new Uint8Array(await f.arrayBuffer()) }; }

/** Rende la pagina i di un PDFDocumentProxy e analizza i pixel. → { vuota, inchiostro, limiti, viewport, w, h } */
export async function analizzaPagina(pdf, i, { scala = 0.5 } = {}) {
  const page = await pdf.getPage(i + 1);
  try {
    const vp = page.getViewport({ scale: scala });
    const cv = document.createElement('canvas');
    cv.width = Math.max(1, Math.ceil(vp.width)); cv.height = Math.max(1, Math.ceil(vp.height));
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
    await page.render({ canvasContext: ctx, canvas: cv, viewport: vp }).promise;
    const { data } = ctx.getImageData(0, 0, cv.width, cv.height);
    const r = analizzaPixel(data, cv.width, cv.height);
    cv.width = cv.height = 0;
    return { ...r, viewport: vp, w: vp.width, h: vp.height };
  } finally { page.cleanup(); }
}

/** Trova le pagine bianche di un documento aperto (con avanzamento annullabile). → indici | undefined */
export async function trovaPagineBianche(app, pdf, indici) {
  return app.ui.withProgress('Ricerca delle pagine bianche', async (p) => {
    const out = [];
    for (let k = 0; k < indici.length; k++) {
      if (p.cancelled) throw Object.assign(new Error('annullata'), { name: 'AbortError' });
      p.set(k / indici.length, `Pagina ${indici[k] + 1} di ${pdf.numPages}`);
      const r = await analizzaPagina(pdf, indici[k], { scala: 0.35 });
      if (r.vuota) out.push(indici[k]);
    }
    return out;
  });
}

// ---------- preset salvabili ----------
export function preset(app, chiave) {
  const k = 'pagine.preset.' + chiave;
  return {
    elenco: () => app.settings.get(k, {}) || {},
    salva(nome, valori) { const e = { ...this.elenco(), [nome]: valori }; app.settings.set(k, e); },
    elimina(nome) { const e = { ...this.elenco() }; delete e[nome]; app.settings.set(k, e); },
    ultimo: () => app.settings.get(k + '.ultimo', null),
    ricorda: (valori) => app.settings.set(k + '.ultimo', valori),
  };
}

/** Riga con selettore dei preset + Salva/Elimina. onScegli(valori). */
export function barraPreset(app, store, { onScegli, leggi, predefiniti = {} }) {
  const { h } = app.ui;
  const sel = h('select', { class: 'pg-input', 'aria-label': 'Impostazioni salvate' });
  const riempi = (attivo) => {
    sel.innerHTML = '';
    sel.append(h('option', { value: '' }, 'Impostazioni salvate…'));
    for (const n of Object.keys(predefiniti)) sel.append(h('option', { value: 'p:' + n, selected: attivo === 'p:' + n }, n));
    for (const n of Object.keys(store.elenco())) sel.append(h('option', { value: 'u:' + n, selected: attivo === 'u:' + n }, '★ ' + n));
  };
  riempi();
  sel.addEventListener('change', () => {
    const v = sel.value; if (!v) return;
    const nome = v.slice(2);
    onScegli(v.startsWith('p:') ? predefiniti[nome] : store.elenco()[nome]);
  });
  const salva = h('button', { type: 'button', class: 'btn small', onclick: async () => {
    const nome = await app.ui.prompt('Nome per queste impostazioni (es. «Numerazione ufficio»):', '', { title: 'Salva impostazioni', okLabel: 'Salva' });
    if (!nome?.trim()) return;
    store.salva(nome.trim(), leggi()); riempi('u:' + nome.trim());
    app.ui.toast(`Impostazioni «${nome.trim()}» salvate`, { kind: 'success' });
  } }, 'Salva impostazioni…');
  const elimina = h('button', { type: 'button', class: 'btn small', onclick: () => {
    if (!sel.value.startsWith('u:')) { app.ui.toast('Scegli prima un\'impostazione salvata da te (★)'); return; }
    store.elimina(sel.value.slice(2)); riempi();
  } }, 'Elimina');
  return h('div', { class: 'pg-preset' }, sel, salva, elimina);
}

/** Campo pagine con scorciatoie (Tutte / Questa / Pari / Dispari). → { el, get() } */
export function campoPagine(app, valore = '', { conQuesta = true } = {}) {
  const { h } = app.ui;
  const input = h('input', { type: 'text', class: 'pg-input', value: valore, placeholder: 'Tutte le pagine (oppure es. 1-3, 5, 8-)', 'aria-label': 'Pagine' });
  const bott = (label, v) => h('button', { type: 'button', class: 'pg-chip', onclick: () => { input.value = v; input.dispatchEvent(new Event('input')); } }, label);
  const el = h('div', { class: 'pg-pagine' }, input, h('div', { class: 'pg-chips' },
    bott('Tutte', ''), conQuesta ? bott('Questa pagina', String(app.viewer.page)) : null, bott('Pari', 'pari'), bott('Dispari', 'dispari')));
  return { el, input, get: () => input.value };
}

/** Avvolge un campo custom per ui.dialog. */
export function campo(label, el, help) { return { name: '_' + Math.random().toString(36).slice(2), type: 'custom', label, help, render: (c) => { c.append(el); return { get: () => undefined }; } }; }

/** Nome proposto per un risultato: «originale_suffisso.pdf». */
export function nomeRisultato(app, suffisso, nome = app.activeDoc?.name) { return `${senzaEstensione(nome || 'documento')}_${suffisso}.pdf`; }

/** Apre i byte in una nuova scheda (senza percorso: «Salva» chiederà dove, l'originale resta intatto). */
export async function apriRisultato(app, bytes, nome) {
  const d = await app.openBytes(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes), { name: nome });
  if (d) { d.dirty = true; app.ui.toast(`Creato «${nome}» in una nuova scheda. Ricordati di salvarlo.`, { kind: 'success', timeout: 8000 }); }
  return d;
}
