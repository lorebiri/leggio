// Operazioni strutturali sulle pagine con pdf-lib (logica pura, testata in node).
// Principio: le pagine del documento si spostano "in place" (stessi oggetti), così annotazioni,
// campi modulo e link restano validi; le copie e le pagine esterne ricevono campi modulo propri.
import {
  PDFDocument, PDFName, PDFArray, PDFDict, PDFRef, PDFNumber, PDFString, PDFHexString,
  PDFPage, PDFPageLeaf, degrees,
} from '@cantoo/pdf-lib';
import { ErroreUtente, validaIndici, aBlocchi } from './util.js';

const N = (s) => PDFName.of(s);
const EREDITABILI = ['Resources', 'MediaBox', 'CropBox', 'Rotate'];
const FIELD_EREDITABILI = ['FT', 'Ff', 'V', 'DV', 'DA', 'Q', 'Opt', 'MaxLen', 'DR'];

/** Copia sulla pagina gli attributi ereditati dai nodi Pages (necessario prima di spostarla). */
export function materializzaEreditati(page) {
  const leaf = page.node;
  for (const k of EREDITABILI) {
    if (leaf.get(N(k)) !== undefined) continue;
    const v = leaf.getInheritableAttribute(N(k));
    if (v !== undefined) leaf.set(N(k), v);
  }
  if (!leaf.get(N('MediaBox'))) leaf.set(N('MediaBox'), leaf.context.obj([0, 0, 595.28, 841.89]));
}

/**
 * Imposta l'ordine finale delle pagine del documento ricostruendo un albero Pages piatto.
 * pages: PDFPage di questo documento (uniche). Le pagine escluse vengono rimosse, insieme
 * ai campi modulo che vivevano solo su di esse.
 */
export function impostaOrdine(doc, pages) {
  const ctx = doc.context;
  const set = new Set();
  for (const p of pages) {
    if (p.doc !== doc) throw new Error('Pagina di un altro documento: usa copyPages');
    if (set.has(p.ref.toString())) throw new Error('Pagina ripetuta: usa clonaPagina per i duplicati');
    set.add(p.ref.toString());
  }
  if (!pages.length) throw new ErroreUtente('Un PDF deve avere almeno una pagina.');
  const vecchie = doc.getPages();
  for (const p of vecchie) materializzaEreditati(p);
  for (const p of pages) materializzaEreditati(p);
  const rimosse = vecchie.filter((p) => !set.has(p.ref.toString()));

  const rootRef = doc.catalog.get(N('Pages'));
  const root = doc.catalog.Pages();
  // raccoglie i nodi intermedi da eliminare
  const intermedi = [];
  const visita = (node) => {
    const kids = node.lookup(N('Kids'));
    if (!(kids instanceof PDFArray)) return;
    for (let i = 0; i < kids.size(); i++) {
      const ref = kids.get(i); const kid = ctx.lookup(ref);
      if (kid instanceof PDFDict && !(kid instanceof PDFPageLeaf) && kid.get(N('Kids'))) { intermedi.push(ref); visita(kid); }
    }
  };
  visita(root);
  root.set(N('Kids'), ctx.obj(pages.map((p) => p.ref)));
  root.set(N('Count'), PDFNumber.of(pages.length));
  for (const k of EREDITABILI) root.delete(N(k));
  for (const p of pages) p.node.setParent(rootRef);
  for (const ref of intermedi) if (ref instanceof PDFRef) ctx.delete(ref);
  if (rimosse.length) pulisciPagineRimosse(doc, rimosse);
  doc.pageCache.invalidate();
  doc.pageCount = pages.length;
  return doc.getPages();
}

/** Toglie dai moduli i widget delle pagine rimosse ed elimina gli oggetti pagina. */
function pulisciPagineRimosse(doc, rimosse) {
  const ctx = doc.context;
  const widgetRimossi = new Set();
  for (const p of rimosse) {
    const annots = p.node.Annots();
    if (annots) for (let i = 0; i < annots.size(); i++) { const r = annots.get(i); if (r instanceof PDFRef) widgetRimossi.add(r.toString()); }
  }
  const acro = doc.catalog.lookupMaybe(N('AcroForm'), PDFDict);
  if (acro && widgetRimossi.size) {
    const fields = acro.lookupMaybe(N('Fields'), PDFArray);
    if (fields) {
      const potaKids = (field) => { // → true se il campo resta vivo
        const kids = field.lookupMaybe(N('Kids'), PDFArray);
        if (!kids) return true;
        for (let i = kids.size() - 1; i >= 0; i--) {
          const r = kids.get(i); const k = ctx.lookup(r);
          if (r instanceof PDFRef && widgetRimossi.has(r.toString())) { kids.remove(i); continue; }
          if (k instanceof PDFDict && !potaKids(k)) kids.remove(i);
        }
        return kids.size() > 0;
      };
      for (let i = fields.size() - 1; i >= 0; i--) {
        const r = fields.get(i); const f = ctx.lookup(r);
        if (r instanceof PDFRef && widgetRimossi.has(r.toString())) { fields.remove(i); continue; }
        if (f instanceof PDFDict && !potaKids(f)) fields.remove(i);
      }
    }
  }
  for (const p of rimosse) ctx.delete(p.ref);
}

/** Nome completo di un campo (T separati da punto). */
function nomeCompleto(ctx, field) {
  const parti = []; let f = field; const visti = new Set();
  while (f instanceof PDFDict && !visti.has(f)) {
    visti.add(f);
    const t = f.lookup(N('T'));
    if (t instanceof PDFString || t instanceof PDFHexString) parti.unshift(t.decodeText());
    f = f.lookupMaybe(N('Parent'), PDFDict);
  }
  return parti.join('.');
}

function nomiCampiEsistenti(doc) {
  const out = new Set();
  const acro = doc.catalog.lookupMaybe(N('AcroForm'), PDFDict);
  const fields = acro?.lookupMaybe(N('Fields'), PDFArray);
  if (!fields) return out;
  for (let i = 0; i < fields.size(); i++) {
    const f = fields.lookup(i);
    if (f instanceof PDFDict) { const t = f.lookup(N('T')); if (t instanceof PDFString || t instanceof PDFHexString) out.add(t.decodeText()); }
  }
  return out;
}

function nomeUnico(base, usati) {
  if (!usati.has(base)) { usati.add(base); return base; }
  for (let k = 2; ; k++) { const n = `${base}_${k}`; if (!usati.has(n)) { usati.add(n); return n; } }
}

function campoTerminale(ctx, widget) {
  // il widget stesso se ha /T (campo+widget fusi), altrimenti il genitore diretto
  if (widget.get(N('T'))) return widget;
  return widget.lookupMaybe(N('Parent'), PDFDict) || widget;
}

/**
 * Rende "locali" i campi modulo dei widget indicati: crea campi di primo livello nuovi che
 * contengono solo quei widget (con gli attributi ereditati copiati). I widget vengono modificati.
 * → array di PDFRef dei nuovi campi.
 */
export function localizzaCampi(doc, widgetRefs, { usati, rinomina = true } = {}) {
  const ctx = doc.context;
  const gruppi = new Map(); // terminale → [widgetRef]
  for (const wr of widgetRefs) {
    const w = ctx.lookup(wr);
    if (!(w instanceof PDFDict)) continue;
    const term = campoTerminale(ctx, w);
    if (!gruppi.has(term)) gruppi.set(term, []);
    gruppi.get(term).push(wr);
  }
  const nuovi = [];
  for (const [term, wrefs] of gruppi) {
    const nome = nomeCompleto(ctx, term) || 'campo';
    const ereditati = {};
    for (const k of FIELD_EREDITABILI) {
      let f = term; const visti = new Set();
      while (f instanceof PDFDict && !visti.has(f)) { visti.add(f); const v = f.get(N(k)); if (v !== undefined) { ereditati[k] = v; break; } f = f.lookupMaybe(N('Parent'), PDFDict); }
    }
    const nomeNuovo = rinomina && usati ? nomeUnico(nome, usati) : nome;
    const fuso = wrefs.length === 1 && ctx.lookup(wrefs[0]) === term;
    if (fuso) {
      const w = term;
      for (const [k, v] of Object.entries(ereditati)) if (w.get(N(k)) === undefined) w.set(N(k), v);
      w.delete(N('Parent'));
      w.set(N('T'), PDFHexString.fromText(nomeNuovo));
      nuovi.push(wrefs[0]);
    } else {
      const campo = ctx.obj({});
      for (const [k, v] of Object.entries(ereditati)) campo.set(N(k), v);
      campo.set(N('T'), PDFHexString.fromText(nomeNuovo));
      campo.set(N('Kids'), ctx.obj(wrefs));
      const campoRef = ctx.register(campo);
      for (const wr of wrefs) {
        const w = ctx.lookup(wr);
        w.set(N('Parent'), campoRef);
        w.delete(N('T'));
      }
      nuovi.push(campoRef);
    }
  }
  return nuovi;
}

function aggiungiCampiAcroForm(doc, campoRefs) {
  if (!campoRefs.length) return;
  const ctx = doc.context;
  let acro = doc.catalog.lookupMaybe(N('AcroForm'), PDFDict);
  if (!acro) { acro = ctx.obj({ Fields: [] }); doc.catalog.set(N('AcroForm'), ctx.register(acro)); }
  let fields = acro.lookupMaybe(N('Fields'), PDFArray);
  if (!fields) { fields = ctx.obj([]); acro.set(N('Fields'), fields); }
  for (const r of campoRefs) fields.push(r);
}

function isWidget(annot) { return annot instanceof PDFDict && annot.get(N('Subtype'))?.toString() === '/Widget'; }

/**
 * Crea una copia della pagina nello stesso documento (non ancora inserita nell'albero).
 * Contenuti e risorse sono condivisi (nessuna duplicazione di dati); le annotazioni vengono copiate
 * e i campi modulo diventano campi nuovi con nome distinto (es. "nome_2").
 */
export function clonaPagina(doc, page, usati = nomiCampiEsistenti(doc)) {
  const ctx = doc.context;
  materializzaEreditati(page);
  const leaf = page.node.clone();
  const contents = page.node.get(N('Contents'));
  const cl = ctx.lookup(contents);
  if (cl instanceof PDFArray && !(contents instanceof PDFRef)) leaf.set(N('Contents'), ctx.obj(cl.asArray()));
  for (const k of ['MediaBox', 'CropBox', 'BleedBox', 'TrimBox', 'ArtBox']) {
    const v = page.node.lookup(N(k));
    if (v instanceof PDFArray) leaf.set(N(k), ctx.obj(v.asArray()));
  }
  leaf.delete(N('StructParents')); leaf.delete(N('B')); leaf.delete(N('Thumb'));
  const ref = ctx.register(leaf);
  const annots = page.node.Annots();
  if (annots) {
    const nuove = []; const widget = [];
    const mappa = new Map(); // vecchio ref → nuovo ref (per Popup/IRT/Parent)
    for (let i = 0; i < annots.size(); i++) {
      const r = annots.get(i); const a = ctx.lookup(r);
      if (!(a instanceof PDFDict)) continue;
      const c = a.clone(ctx);
      c.set(N('P'), ref);
      const cr = ctx.register(c);
      if (r instanceof PDFRef) mappa.set(r.toString(), cr);
      nuove.push(cr);
      if (isWidget(a)) widget.push(cr);
    }
    for (const cr of nuove) {
      const c = ctx.lookup(cr);
      for (const k of ['Popup', 'IRT', 'Parent']) {
        const v = c.get(N(k));
        if (v instanceof PDFRef && mappa.has(v.toString())) c.set(N(k), mappa.get(v.toString()));
      }
    }
    leaf.set(N('Annots'), ctx.obj(nuove));
    if (widget.length) aggiungiCampiAcroForm(doc, localizzaCampi(doc, widget, { usati }));
  }
  const p = PDFPage.of(leaf, ref, doc);
  doc.pageMap.set(leaf, p);
  return p;
}

/**
 * Prepara pagine di un documento sorgente (usa e getta) per essere copiate altrove:
 * campi modulo resi locali, link verso pagine non copiate disattivati, riferimenti superflui tolti.
 * Evita che copyPages trascini con sé pagine e campi di tutto il documento.
 * → funzione che ripristina i link disattivati (la sorgente resta riutilizzabile).
 */
export function preparaPerCopia(src, indici) {
  const ctx = src.context;
  const pages = src.getPages();
  const copiate = new Set(indici.map((i) => pages[i].ref.toString()));
  const ripristini = [];
  for (const i of indici) {
    const p = pages[i];
    materializzaEreditati(p);
    p.node.delete(N('B')); p.node.delete(N('StructParents')); p.node.delete(N('Thumb'));
    const annots = p.node.Annots();
    if (!annots) continue;
    const widget = [];
    for (let k = 0; k < annots.size(); k++) {
      const r = annots.get(k); const a = ctx.lookup(r);
      if (!(a instanceof PDFDict)) continue;
      if (isWidget(a) && r instanceof PDFRef) widget.push(r);
      // link interni verso pagine che non verranno copiate → disattivati
      const dest = a.lookup(N('Dest'));
      const action = a.lookupMaybe(N('A'), PDFDict);
      const d = dest || action?.lookup(N('D'));
      if (d instanceof PDFArray && d.get(0) instanceof PDFRef && !copiate.has(d.get(0).toString())) {
        const k = dest ? N('Dest') : N('A');
        ripristini.push([a, k, a.get(k)]);
        a.delete(k);
      }
      a.delete(N('StructParent'));
    }
    if (widget.length) localizzaCampi(src, widget, { rinomina: false });
  }
  return () => { for (const [a, k, v] of ripristini) a.set(k, v); };
}

/**
 * Copia pagine da un documento esterno (già caricato, usa e getta) dentro doc.
 * I campi modulo copiati vengono registrati nel modulo di doc (rinominati se il nome esiste).
 * → PDFPage copiate (non ancora inserite nell'albero).
 */
export async function copiaPagineEsterne(doc, src, indici) {
  if (!indici.length) return [];
  const ripristina = preparaPerCopia(src, indici);
  let copiate;
  try { copiate = await doc.copyPages(src, indici); } finally { ripristina(); }
  const ctx = doc.context;
  const usati = nomiCampiEsistenti(doc);
  const nuoviCampi = [];
  for (const p of copiate) {
    const annots = p.node.Annots();
    if (!annots) continue;
    for (let k = 0; k < annots.size(); k++) {
      const a = annots.lookup(k);
      if (!isWidget(a)) continue;
      let top = a; const visti = new Set();
      while (top.lookupMaybe(N('Parent'), PDFDict) && !visti.has(top)) { visti.add(top); top = top.lookupMaybe(N('Parent'), PDFDict); }
      const topRef = top === a ? annots.get(k) : ctx.getObjectRef(top);
      if (!topRef || nuoviCampi.some((r) => r.toString() === topRef.toString())) continue;
      const t = top.lookup(N('T'));
      const nome = t instanceof PDFString || t instanceof PDFHexString ? t.decodeText() : 'campo';
      const nn = nomeUnico(nome, usati);
      if (nn !== nome) top.set(N('T'), PDFHexString.fromText(nn));
      nuoviCampi.push(topRef);
    }
  }
  aggiungiCampiAcroForm(doc, nuoviCampi);
  // risorse predefinite dei moduli (font usati da DA)
  const srcAcro = src.catalog.lookupMaybe(N('AcroForm'), PDFDict);
  const srcDR = srcAcro?.lookupMaybe(N('DR'), PDFDict);
  if (nuoviCampi.length && srcDR) {
    const acro = doc.catalog.lookupMaybe(N('AcroForm'), PDFDict);
    let dr = acro.lookupMaybe(N('DR'), PDFDict);
    if (!dr) { dr = ctx.obj({}); acro.set(N('DR'), dr); }
    const srcFont = srcDR.lookupMaybe(N('Font'), PDFDict);
    if (srcFont) {
      let font = dr.lookupMaybe(N('Font'), PDFDict);
      if (!font) { font = ctx.obj({}); dr.set(N('Font'), font); }
      // copia dei font mancanti (oggetti piccoli)
      const { PDFObjectCopier } = await import('@cantoo/pdf-lib');
      const copier = PDFObjectCopier ? PDFObjectCopier.for(src.context, ctx) : null;
      for (const [k, v] of srcFont.entries()) {
        if (font.get(k) !== undefined) continue;
        if (copier) font.set(k, copier.copy(v));
      }
    }
  }
  return copiate;
}

/** Ruota le pagine di delta gradi (multiplo di 90), in senso orario. */
export function ruota(doc, indici, delta) {
  if (delta % 90 !== 0) throw new ErroreUtente('La rotazione deve essere di 90, 180 o 270 gradi.');
  const pages = doc.getPages();
  for (const i of validaIndici(indici, pages.length)) {
    const p = pages[i];
    const cur = p.getRotation().angle || 0;
    p.setRotation(degrees((((cur + delta) % 360) + 360) % 360));
  }
}

/** Elimina le pagine indicate (non tutte). */
export function elimina(doc, indici) {
  const n = doc.getPageCount();
  const del = new Set(validaIndici(indici, n));
  if (del.size >= n) throw new ErroreUtente('Non puoi eliminare tutte le pagine: un PDF deve averne almeno una.');
  impostaOrdine(doc, doc.getPages().filter((_, i) => !del.has(i)));
}

/** Riordina: order = array di indici vecchi nel nuovo ordine (permutazione completa o parziale). */
export function riordina(doc, order) {
  const pages = doc.getPages();
  validaIndici(order, pages.length);
  if (new Set(order).size !== order.length) throw new Error('Ordine con pagine ripetute');
  impostaOrdine(doc, order.map((i) => pages[i]));
}

/** Sposta le pagine indicate prima della posizione target (0..n). */
export function sposta(doc, indici, target) {
  const n = doc.getPageCount();
  const moving = validaIndici(indici, n);
  const rest = [...Array(n).keys()].filter((i) => !moving.includes(i));
  const insertAt = rest.filter((i) => i < target).length;
  riordina(doc, [...rest.slice(0, insertAt), ...moving, ...rest.slice(insertAt)]);
}

/** Inverte l'ordine delle pagine indicate (le altre restano dove sono). Vuoto = tutte. */
export function inverti(doc, indici) {
  const n = doc.getPageCount();
  const sel = indici?.length ? validaIndici(indici, n) : [...Array(n).keys()];
  const order = [...Array(n).keys()];
  const rev = [...sel].reverse();
  sel.forEach((pos, k) => { order[pos] = rev[k]; });
  riordina(doc, order);
}

/** Duplica le pagine: ogni copia subito dopo l'originale (dove='dopo') o tutte in fondo ('fine'). */
export function duplica(doc, indici, { copie = 1, dove = 'dopo' } = {}) {
  const pages = doc.getPages();
  const sel = new Set(validaIndici(indici, pages.length));
  copie = Math.max(1, Math.min(100, Math.floor(copie || 1)));
  const usati = nomiCampiEsistenti(doc);
  const out = []; const coda = [];
  pages.forEach((p, i) => {
    out.push(p);
    if (!sel.has(i)) return;
    for (let c = 0; c < copie; c++) (dove === 'fine' ? coda : out).push(clonaPagina(doc, p, usati));
  });
  impostaOrdine(doc, [...out, ...coda]);
}

/** Inserisce pagine vuote. at = posizione (0..n). size = [w,h]. */
export function inserisciVuote(doc, at, count = 1, size = [595.28, 841.89]) {
  const n = doc.getPageCount();
  if (!(at >= 0 && at <= n)) throw new ErroreUtente('Posizione di inserimento non valida.');
  count = Math.max(1, Math.min(500, Math.floor(count || 1)));
  const pages = doc.getPages();
  const nuove = [];
  for (let k = 0; k < count; k++) {
    const p = doc.addPage(size); // aggiunta in fondo, poi ricollocata
    nuove.push(p);
  }
  impostaOrdine(doc, [...pages.slice(0, at), ...nuove, ...pages.slice(at)]);
}

/** Inserisce pagine (già copiate in doc, non nell'albero) alla posizione at. */
export function inserisciPagine(doc, at, nuove) {
  const pages = doc.getPages().filter((p) => !nuove.includes(p));
  if (!(at >= 0 && at <= pages.length)) throw new ErroreUtente('Posizione di inserimento non valida.');
  impostaOrdine(doc, [...pages.slice(0, at), ...nuove, ...pages.slice(at)]);
}

/** Inserisce pagine di un PDF esterno (PDFDocument usa e getta) prima della posizione at. */
export async function inserisciDaPdf(doc, src, srcIndici, at) {
  const idx = validaIndici(srcIndici, src.getPageCount());
  const nuove = await copiaPagineEsterne(doc, src, idx);
  inserisciPagine(doc, at, nuove);
}

/** Sostituisce le pagine indicate (in ordine) con le pagine di src (stesso numero). */
export async function sostituisci(doc, indici, src, srcIndici) {
  const n = doc.getPageCount();
  const target = validaIndici(indici, n);
  const sorg = validaIndici(srcIndici, src.getPageCount());
  if (target.length !== sorg.length) throw new ErroreUtente(`Stai sostituendo ${target.length} pagine con ${sorg.length}: il numero deve essere uguale.`);
  const nuove = await copiaPagineEsterne(doc, src, sorg);
  const pages = doc.getPages().filter((p) => !nuove.includes(p));
  const out = pages.slice();
  target.forEach((t, k) => { out[t] = nuove[k]; });
  impostaOrdine(doc, out);
}

/**
 * Costruisce un nuovo documento con le pagine indicate di src (src non viene modificato se
 * caricato apposta). Per estrazione/divisione. → PDFDocument
 */
export async function estraiInNuovo(src, indici, { titolo } = {}) {
  const idx = validaIndici(indici, src.getPageCount());
  const out = await PDFDocument.create();
  const copiate = await copiaPagineEsterne(out, src, idx);
  for (const p of copiate) out.addPage(p);
  try { const t = titolo ?? src.getTitle(); if (t) out.setTitle(t); const a = src.getAuthor(); if (a) out.setAuthor(a); } catch {}
  return out;
}

/**
 * Applica una disposizione (dalla vista Organizza) al documento.
 * items: [{ tipo:'pagina', indice, rot } | { tipo:'vuota', size:[w,h], rot } | { tipo:'esterna', file, indice, rot }]
 * esterni: Map file → PDFDocument usa e getta. rot = rotazione aggiuntiva in gradi.
 */
export async function applicaDisposizione(doc, items, esterni = new Map(), { onProgress, signal } = {}) {
  if (!items.length) throw new ErroreUtente('Il documento deve avere almeno una pagina.');
  const pages = doc.getPages();
  const usati = nomiCampiEsistenti(doc);
  const usate = new Set();
  // pagine esterne: copiate a gruppi per file (una copyPages per file)
  const perFile = new Map();
  items.forEach((it, k) => { if (it.tipo === 'esterna') { if (!perFile.has(it.file)) perFile.set(it.file, []); perFile.get(it.file).push(k); } });
  const copiateEst = new Map();
  for (const [file, ks] of perFile) {
    const src = esterni.get(file);
    if (!src) throw new Error('File esterno mancante: ' + file);
    const nuove = await copiaPagineEsterne(doc, src, ks.map((k) => items[k].indice));
    ks.forEach((k, j) => copiateEst.set(k, nuove[j]));
  }
  const out = new Array(items.length);
  await aBlocchi(items.length, (k) => {
    const it = items[k];
    let p;
    if (it.tipo === 'pagina') {
      if (!(it.indice >= 0 && it.indice < pages.length)) throw new Error('Indice pagina non valido: ' + it.indice);
      if (!usate.has(it.indice)) { usate.add(it.indice); p = pages[it.indice]; } else p = clonaPagina(doc, pages[it.indice], usati);
    } else if (it.tipo === 'vuota') {
      p = doc.addPage(it.size || [595.28, 841.89]);
    } else p = copiateEst.get(k);
    out[k] = p;
  }, { onProgress: (f) => onProgress?.(f * 0.8), signal, blocco: 100 });
  const finali = impostaOrdine(doc, out);
  items.forEach((it, k) => {
    if (it.rot) { const cur = finali[k].getRotation().angle || 0; finali[k].setRotation(degrees((((cur + it.rot) % 360) + 360) % 360)); }
  });
  onProgress?.(1);
  return finali;
}

/** Dimensioni visibili (con rotazione) della pagina: { w, h } in punti. */
export function dimensioniVisibili(page) {
  const { width, height } = page.getCropBox ? page.getCropBox() : page.getSize();
  const rot = ((page.getRotation().angle || 0) % 360 + 360) % 360;
  return rot === 90 || rot === 270 ? { w: height, h: width } : { w: width, h: height };
}

/** Carica un PDF esterno per le operazioni (usa e getta). Lancia ErroreUtente leggibili. */
export async function caricaPdf(bytes, { password, nome = 'il file' } = {}) {
  try {
    return await PDFDocument.load(bytes, { password: password || undefined, ignoreEncryption: false, updateMetadata: false, throwOnInvalidObject: false });
  } catch (err) {
    const msg = String(err?.message || err);
    if (/encrypt|password/i.test(msg) || err?.name === 'EncryptedPDFError') {
      const e = new ErroreUtente(`«${nome}» è protetto da password.`); e.protetto = true; throw e;
    }
    throw new ErroreUtente(`«${nome}» non sembra un PDF valido o è danneggiato.`);
  }
}
