// Segnalibri (Outlines) e etichette di pagina (PageLabels) con pdf-lib. Logica pura.
import { PDFName, PDFArray, PDFDict, PDFRef, PDFNumber, PDFString, PDFHexString, PDFNull } from '@cantoo/pdf-lib';
import { ErroreUtente, numeroRomano, numeroLettere } from './util.js';

const N = (s) => PDFName.of(s);
const testo = (v) => (v instanceof PDFString || v instanceof PDFHexString ? v.decodeText() : '');

function mappaPagine(doc) {
  const m = new Map();
  doc.getPages().forEach((p, i) => m.set(p.ref.toString(), i));
  return m;
}

function cercaNome(doc, nome) {
  const ctx = doc.context;
  // /Dests nel catalogo (PDF 1.1)
  const dests = doc.catalog.lookupMaybe(N('Dests'), PDFDict);
  if (dests) { const v = dests.lookup(N(nome)); if (v) return v instanceof PDFDict ? v.lookup(N('D')) : v; }
  // albero dei nomi /Names /Dests
  const names = doc.catalog.lookupMaybe(N('Names'), PDFDict);
  const tree = names?.lookupMaybe(N('Dests'), PDFDict);
  const visita = (node, prof = 0) => {
    if (!node || prof > 32) return null;
    const arr = node.lookupMaybe(N('Names'), PDFArray);
    if (arr) for (let i = 0; i + 1 < arr.size(); i += 2) if (testo(arr.lookup(i)) === nome) { const v = arr.lookup(i + 1); return v instanceof PDFDict ? v.lookup(N('D')) : v; }
    const kids = node.lookupMaybe(N('Kids'), PDFArray);
    if (kids) for (let i = 0; i < kids.size(); i++) { const r = visita(kids.lookup(i), prof + 1); if (r) return r; }
    return null;
  };
  void ctx;
  return visita(tree);
}

/** Destinazione (array, nome o stringa) → indice pagina o null. */
export function paginaDiDestinazione(doc, dest, pagine = mappaPagine(doc)) {
  let d = dest;
  if (d instanceof PDFName) d = cercaNome(doc, d.decodeText());
  else if (d instanceof PDFString || d instanceof PDFHexString) d = cercaNome(doc, d.decodeText());
  if (d instanceof PDFArray && d.size() > 0) {
    const p = d.get(0);
    if (p instanceof PDFRef) return pagine.has(p.toString()) ? pagine.get(p.toString()) : null;
    if (p instanceof PDFNumber) return p.asNumber();
  }
  return null;
}

/**
 * Legge i segnalibri. → [{ titolo, pagina, top, aperto, figli, raw:{Dest|A, C, F} }]
 * L'ordine e la struttura coincidono con quelli mostrati da pdf.js (First/Next).
 */
export function leggiSegnalibri(doc) {
  const ctx = doc.context;
  const root = doc.catalog.lookupMaybe(N('Outlines'), PDFDict);
  if (!root) return [];
  const pagine = mappaPagine(doc);
  const visti = new Set();
  const leggi = (parent, prof) => {
    const out = [];
    if (prof > 64) return out;
    let ref = parent.get(N('First'));
    while (ref instanceof PDFRef && !visti.has(ref.toString())) {
      visti.add(ref.toString());
      const it = ctx.lookup(ref);
      if (!(it instanceof PDFDict)) break;
      const dest = it.lookup(N('Dest'));
      const az = it.lookupMaybe(N('A'), PDFDict);
      let pagina = null; let top = null;
      const d = dest ?? (az && az.lookup(N('S'))?.toString() === '/GoTo' ? az.lookup(N('D')) : undefined);
      if (d !== undefined) {
        pagina = paginaDiDestinazione(doc, d, pagine);
        if (d instanceof PDFArray && d.lookup(1)?.toString() === '/XYZ') { const t = d.lookup(3); if (t instanceof PDFNumber) top = t.asNumber(); }
      }
      const count = it.lookup(N('Count'));
      out.push({
        titolo: testo(it.lookup(N('Title'))),
        pagina, top,
        aperto: count instanceof PDFNumber ? count.asNumber() > 0 : false,
        figli: leggi(it, prof + 1),
        raw: { Dest: it.get(N('Dest')), A: it.get(N('A')), C: it.get(N('C')), F: it.get(N('F')) },
      });
      ref = it.get(N('Next'));
    }
    return out;
  };
  return leggi(root, 0);
}

/**
 * Scrive i segnalibri (sostituisce quelli esistenti). Nodi: { titolo, pagina, top, aperto, figli, raw? }.
 * Se il nodo ha `raw` e la pagina non è stata cambiata (cambiato !== true) la destinazione originale
 * (anche link esterni o azioni) viene conservata.
 */
export function scriviSegnalibri(doc, albero) {
  const ctx = doc.context;
  const pages = doc.getPages();
  const vecchio = doc.catalog.get(N('Outlines'));
  if (!albero?.length) { doc.catalog.delete(N('Outlines')); void vecchio; return; }
  const rootRef = ctx.nextRef();
  const visibili = (nodi) => nodi.reduce((s, n) => s + 1 + (n.aperto && n.figli?.length ? visibili(n.figli) : 0), 0);
  const costruisci = (nodi, parentRef) => {
    const refs = nodi.map(() => ctx.nextRef());
    nodi.forEach((n, k) => {
      const d = ctx.obj({});
      d.set(N('Title'), PDFHexString.fromText(String(n.titolo ?? '').slice(0, 500) || 'Senza titolo'));
      d.set(N('Parent'), parentRef);
      if (k > 0) d.set(N('Prev'), refs[k - 1]);
      if (k < nodi.length - 1) d.set(N('Next'), refs[k + 1]);
      const usaRaw = n.raw && !n.cambiato && (n.raw.Dest || n.raw.A);
      if (usaRaw) {
        if (n.raw.Dest) d.set(N('Dest'), n.raw.Dest);
        if (n.raw.A) d.set(N('A'), n.raw.A);
      } else if (n.pagina != null && n.pagina >= 0 && n.pagina < pages.length) {
        const p = pages[n.pagina];
        const top = n.top ?? (p.getCropBox().y + p.getCropBox().height);
        d.set(N('Dest'), ctx.obj([p.ref, N('XYZ'), PDFNull, PDFNumber.of(Math.round(top * 100) / 100), PDFNull]));
      }
      if (n.raw?.C) d.set(N('C'), n.raw.C);
      if (n.raw?.F) d.set(N('F'), n.raw.F);
      if (n.figli?.length) {
        const kr = costruisci(n.figli, refs[k]);
        d.set(N('First'), kr[0]); d.set(N('Last'), kr[kr.length - 1]);
        d.set(N('Count'), PDFNumber.of(n.aperto ? visibili(n.figli) : -n.figli.length));
      }
      ctx.assign(refs[k], d);
    });
    return refs;
  };
  const top = costruisci(albero, rootRef);
  ctx.assign(rootRef, ctx.obj({ Type: 'Outlines', First: top[0], Last: top[top.length - 1], Count: visibili(albero) }));
  doc.catalog.set(N('Outlines'), rootRef);
}

// ---------- operazioni sull'albero (per percorso: array di indici) ----------

export function nodoA(albero, percorso) {
  let lista = albero; let n = null;
  for (const i of percorso) { n = lista?.[i]; if (!n) return null; lista = n.figli; }
  return n;
}
function listaDi(albero, percorsoGenitore) {
  if (!percorsoGenitore.length) return albero;
  const g = nodoA(albero, percorsoGenitore);
  if (!g) throw new Error('Percorso non valido');
  g.figli ||= [];
  return g.figli;
}
export function rimuoviA(albero, percorso) {
  const lista = listaDi(albero, percorso.slice(0, -1));
  const [n] = lista.splice(percorso[percorso.length - 1], 1);
  if (!n) throw new Error('Segnalibro non trovato');
  return n;
}
export function inserisciA(albero, percorso, nodo) {
  const lista = listaDi(albero, percorso.slice(0, -1));
  lista.splice(Math.min(percorso[percorso.length - 1], lista.length), 0, nodo);
}
/** Sposta il nodo in `da` rispetto al nodo `verso`: dove = 'prima' | 'dopo' | 'dentro'. */
export function spostaNodo(albero, da, verso, dove) {
  const pref = da.join('.') + '.';
  if ((verso.join('.') + '.').startsWith(pref)) throw new ErroreUtente('Non puoi spostare un segnalibro dentro sé stesso.');
  const nodo = nodoA(albero, da);
  const target = nodoA(albero, verso);
  if (!nodo || !target) throw new Error('Segnalibro non trovato');
  rimuoviA(albero, da);
  // ritrova il bersaglio (il percorso può essere cambiato dopo la rimozione)
  const trova = (lista, p = []) => { for (let i = 0; i < lista.length; i++) { if (lista[i] === target) return [...p, i]; const r = trova(lista[i].figli || [], [...p, i]); if (r) return r; } return null; };
  const pv = trova(albero);
  if (dove === 'dentro') { target.figli ||= []; target.figli.push(nodo); target.aperto = true; return; }
  const idx = pv[pv.length - 1] + (dove === 'dopo' ? 1 : 0);
  inserisciA(albero, [...pv.slice(0, -1), idx], nodo);
}

/** Rimappa le pagine dei segnalibri (per unione/estrazione): fn(indiceVecchio) → nuovo | null. */
export function rimappa(albero, fn) {
  return albero.map((n) => ({ titolo: n.titolo, pagina: n.pagina == null ? null : fn(n.pagina), top: n.top, aperto: n.aperto, cambiato: true, raw: n.raw?.C || n.raw?.F ? { C: n.raw.C, F: n.raw.F } : undefined, figli: rimappa(n.figli || [], fn) }))
    .filter((n) => n.pagina != null || n.figli.length);
}

// ---------- etichette di pagina ----------

export const STILI_ETICHETTA = [
  ['D', '1, 2, 3'], ['r', 'i, ii, iii'], ['R', 'I, II, III'], ['a', 'a, b, c'], ['A', 'A, B, C'], ['', 'Nessun numero (solo prefisso)'],
];

/** Legge /PageLabels → [{ da (indice 0-based), stile, prefisso, inizio }] ordinati. */
export function leggiEtichette(doc) {
  const pl = doc.catalog.lookupMaybe(N('PageLabels'), PDFDict);
  if (!pl) return [];
  const out = [];
  const visita = (node, prof = 0) => {
    if (prof > 32 || !node) return;
    const nums = node.lookupMaybe(N('Nums'), PDFArray);
    if (nums) for (let i = 0; i + 1 < nums.size(); i += 2) {
      const k = nums.lookup(i); const v = nums.lookup(i + 1);
      if (!(k instanceof PDFNumber) || !(v instanceof PDFDict)) continue;
      const s = v.lookup(N('S')); const st = v.lookup(N('St'));
      out.push({ da: k.asNumber(), stile: s instanceof PDFName ? s.decodeText() : '', prefisso: testo(v.lookup(N('P'))), inizio: st instanceof PDFNumber ? st.asNumber() : 1 });
    }
    const kids = node.lookupMaybe(N('Kids'), PDFArray);
    if (kids) for (let i = 0; i < kids.size(); i++) visita(kids.lookup(i), prof + 1);
  };
  visita(pl);
  return out.sort((a, b) => a.da - b.da);
}

/** Scrive /PageLabels. intervalli vuoto = rimuove le etichette. */
export function scriviEtichette(doc, intervalli) {
  const n = doc.getPageCount();
  if (!intervalli?.length) { doc.catalog.delete(N('PageLabels')); return; }
  const ord = [...intervalli].sort((a, b) => a.da - b.da);
  if (ord[0].da !== 0) throw new ErroreUtente('Il primo intervallo deve iniziare dalla pagina 1.');
  const visti = new Set();
  for (const r of ord) {
    if (!(r.da >= 0 && r.da < n)) throw new ErroreUtente(`La pagina ${r.da + 1} non esiste (il documento ha ${n} pagine).`);
    if (visti.has(r.da)) throw new ErroreUtente(`Due intervalli iniziano dalla stessa pagina (${r.da + 1}).`);
    visti.add(r.da);
    if (!(Number.isInteger(r.inizio) && r.inizio >= 1)) throw new ErroreUtente('Il numero iniziale deve essere un intero da 1 in su.');
  }
  const ctx = doc.context;
  const nums = [];
  for (const r of ord) {
    const d = ctx.obj({});
    if (r.stile) d.set(N('S'), N(r.stile));
    if (r.prefisso) d.set(N('P'), PDFHexString.fromText(r.prefisso));
    if (r.inizio && r.inizio !== 1) d.set(N('St'), PDFNumber.of(r.inizio));
    nums.push(PDFNumber.of(r.da), d);
  }
  doc.catalog.set(N('PageLabels'), ctx.register(ctx.obj({ Nums: ctx.obj(nums) })));
}

/** Etichetta della pagina i secondo gli intervalli (come la mostrano i lettori). */
export function etichettaPagina(intervalli, i) {
  const ord = [...(intervalli || [])].sort((a, b) => a.da - b.da);
  let r = null; for (const x of ord) if (x.da <= i) r = x;
  if (!r) return String(i + 1);
  const n = (r.inizio || 1) + (i - r.da);
  const num = { D: String(n), r: numeroRomano(n), R: numeroRomano(n).toUpperCase(), a: numeroLettere(n), A: numeroLettere(n).toUpperCase() }[r.stile] ?? '';
  return (r.prefisso || '') + num;
}
