// Sanifica documento (come «Sanifica documento» / «Rimuovi informazioni nascoste» di Acrobat):
// analizza cosa c'è di nascosto e lo toglie secondo le opzioni. Logica pura su pdf-lib.
import { PDFDict, PDFArray, PDFRef, PDFStream, PDFName } from '@cantoo/pdf-lib';
import { N, lookupDict, lookupArray, num, nameOf, nameTreeEntries, pageContentBytes, removeUnreachable, streamBytes } from './pdfutil.js';
import { parseOps, hiddenRanges, cutRanges } from './flusso.js';

export const VOCI = [
  { id: 'metadati', label: 'Proprietà e metadati (autore, titolo, programma, date, XMP)', def: true },
  { id: 'javascript', label: 'JavaScript e azioni automatiche (all\'apertura, alla chiusura, sui campi)', def: true },
  { id: 'allegati', label: 'File allegati e incorporati', def: true },
  { id: 'commenti', label: 'Commenti, note e timbri non resi definitivi', def: true },
  { id: 'campiNascosti', label: 'Campi del modulo nascosti', def: true },
  { id: 'livelliNascosti', label: 'Contenuto dei livelli nascosti', def: true },
  { id: 'datiPrivati', label: 'Dati privati dei programmi e miniature incorporate', def: true },
  { id: 'xfa', label: 'Dati dei moduli XFA', def: true },
  { id: 'versioni', label: 'Versioni precedenti del file (salvataggi incrementali) e oggetti inutilizzati', def: true },
];

const COMMENT_TYPES = new Set(['Text', 'FreeText', 'Line', 'Square', 'Circle', 'Polygon', 'PolyLine', 'Highlight', 'Underline', 'Squiggly', 'StrikeOut', 'Stamp', 'Caret', 'Ink', 'Popup', 'Sound', 'Redact']);
const BAD_ACTIONS = new Set(['JavaScript', 'Launch', 'SubmitForm', 'ImportData', 'Rendition', 'GoToE', 'Movie', 'Sound']);
const HIDDEN = 2; const NOVIEW = 32;

/** Numero di "%%EOF" nei byte: >1 significa salvataggi incrementali (versioni precedenti nel file). */
export function countRevisions(bytes) {
  let n = 0;
  for (let i = 0; i < bytes.length - 4; i++) if (bytes[i] === 37 && bytes[i + 1] === 37 && bytes[i + 2] === 69 && bytes[i + 3] === 79 && bytes[i + 4] === 70) n++;
  return n;
}

function allDicts(ctx, fn) {
  for (const [ref, obj] of ctx.enumerateIndirectObjects()) {
    if (obj instanceof PDFDict) fn(obj, ref);
    else if (obj instanceof PDFStream) fn(obj.dict, ref);
  }
}

function pageAnnots(ctx, page) {
  const arr = lookupArray(ctx, page.node.get(N('Annots')));
  return arr ? arr.asArray().map((ref) => ({ ref, dict: lookupDict(ctx, ref) })).filter((a) => a.dict) : [];
}

/** Livelli spenti: insieme di tag dei ref OCG. */
function hiddenOCGs(ctx, catalog) {
  const ocp = lookupDict(ctx, catalog.get(N('OCProperties')));
  const d = ocp && lookupDict(ctx, ocp.get(N('D')));
  const off = d && lookupArray(ctx, d.get(N('OFF')));
  const set = new Set();
  if (off) for (const r of off.asArray()) if (r instanceof PDFRef) set.add(r.tag);
  // BaseState /OFF: tutti spenti tranne quelli in /ON
  if (d && nameOf(ctx, d.get(N('BaseState'))) === 'OFF') {
    const on = new Set((lookupArray(ctx, d.get(N('ON')))?.asArray() || []).filter((r) => r instanceof PDFRef).map((r) => r.tag));
    for (const r of lookupArray(ctx, ocp.get(N('OCGs')))?.asArray() || []) if (r instanceof PDFRef && !on.has(r.tag)) set.add(r.tag);
  }
  return set;
}

/** Un /OC (OCG o OCMD) è nascosto? */
function ocIsHidden(ctx, ocRef, offSet) {
  if (ocRef instanceof PDFRef && offSet.has(ocRef.tag)) return true;
  const oc = lookupDict(ctx, ocRef);
  if (!oc || nameOf(ctx, oc.get(N('Type'))) !== 'OCMD') return false;
  const ocgs = ctx.lookup(oc.get(N('OCGs')));
  const list = ocgs instanceof PDFArray ? ocgs.asArray() : ocgs ? [oc.get(N('OCGs'))] : [];
  if (!list.length) return false;
  const p = nameOf(ctx, oc.get(N('P'))) || 'AnyOn';
  const hid = list.map((r) => r instanceof PDFRef && offSet.has(r.tag));
  if (p === 'AllOn') return hid.some(Boolean);
  if (p === 'AnyOff') return !hid.some(Boolean); // visibile se almeno uno spento
  if (p === 'AllOff') return !hid.every(Boolean);
  return hid.every(Boolean); // AnyOn
}

/** Analisi: quante cose nascoste ci sono. → { voce: numero } */
export function analyze(pdfDoc, bytes) {
  const ctx = pdfDoc.context; const cat = pdfDoc.catalog;
  const r = { metadati: 0, javascript: 0, allegati: 0, commenti: 0, campiNascosti: 0, livelliNascosti: 0, datiPrivati: 0, xfa: 0, versioni: 0 };
  const info = lookupDict(ctx, ctx.trailerInfo.Info);
  if (info) r.metadati += info.keys().length;
  allDicts(ctx, (d) => {
    if (d.get(N('Metadata'))) r.metadati++;
    if (d.get(N('AA'))) r.javascript++;
    const s = nameOf(ctx, d.get(N('S')));
    if (s && BAD_ACTIONS.has(s)) r.javascript++;
    if (d.get(N('PieceInfo'))) r.datiPrivati++;
    if (d.get(N('Thumb'))) r.datiPrivati++;
  });
  if (cat.get(N('OpenAction'))) r.javascript++;
  const names = lookupDict(ctx, cat.get(N('Names')));
  if (names) {
    r.javascript += nameTreeEntries(ctx, names.get(N('JavaScript'))).length;
    r.allegati += nameTreeEntries(ctx, names.get(N('EmbeddedFiles'))).length;
  }
  for (const p of pdfDoc.getPages()) for (const a of pageAnnots(ctx, p)) {
    const st = nameOf(ctx, a.dict.get(N('Subtype')));
    if (st === 'FileAttachment') r.allegati++;
    else if (COMMENT_TYPES.has(st) && st !== 'Popup') r.commenti++;
    else if (st === 'Widget' && (num(ctx, a.dict.get(N('F'))) & (HIDDEN | NOVIEW))) r.campiNascosti++;
  }
  const off = hiddenOCGs(ctx, cat);
  r.livelliNascosti = off.size;
  const acro = lookupDict(ctx, cat.get(N('AcroForm')));
  if (acro?.get(N('XFA'))) r.xfa = 1;
  if (bytes) r.versioni = Math.max(0, countRevisions(bytes) - 1);
  return r;
}

function stripActions(ctx, d) {
  let n = 0;
  if (d.get(N('AA'))) { d.delete(N('AA')); n++; }
  const a = lookupDict(ctx, d.get(N('A')));
  if (a) {
    const s = nameOf(ctx, a.get(N('S')));
    if (s && BAD_ACTIONS.has(s)) { d.delete(N('A')); n++; }
    else if (a.get(N('Next'))) { a.delete(N('Next')); n++; }
  }
  return n;
}

/**
 * Sanifica secondo le opzioni ({ voce: true/false }). → { voce: numero rimossi }
 * Non salva: il chiamante salva (e removeUnreachable è già applicato se opts.versioni).
 */
export function sanitize(pdfDoc, opts = {}) {
  const ctx = pdfDoc.context; const cat = pdfDoc.catalog;
  const on = (k) => opts[k] !== false;
  const out = { metadati: 0, javascript: 0, allegati: 0, commenti: 0, campiNascosti: 0, livelliNascosti: 0, datiPrivati: 0, xfa: 0, versioni: 0 };
  const names = lookupDict(ctx, cat.get(N('Names')));
  const removedWidgets = new Set();

  if (on('metadati')) {
    const info = lookupDict(ctx, ctx.trailerInfo.Info);
    if (info) { out.metadati += info.keys().length; for (const k of info.keys()) info.delete(k); }
    allDicts(ctx, (d) => { if (d.get(N('Metadata'))) { d.delete(N('Metadata')); out.metadati++; } });
  }
  if (on('javascript')) {
    if (names?.get(N('JavaScript'))) { out.javascript += nameTreeEntries(ctx, names.get(N('JavaScript'))).length || 1; names.delete(N('JavaScript')); }
    if (cat.get(N('OpenAction'))) { cat.delete(N('OpenAction')); out.javascript++; }
    allDicts(ctx, (d) => { out.javascript += stripActions(ctx, d); });
  }
  if (on('allegati')) {
    if (names?.get(N('EmbeddedFiles'))) { out.allegati += nameTreeEntries(ctx, names.get(N('EmbeddedFiles'))).length || 1; names.delete(N('EmbeddedFiles')); }
    for (const k of ['AF', 'Collection']) if (cat.get(N(k))) cat.delete(N(k));
  }
  for (const p of pdfDoc.getPages()) {
    const annots = pageAnnots(ctx, p);
    if (!annots.length) continue;
    const keep = [];
    for (const a of annots) {
      const st = nameOf(ctx, a.dict.get(N('Subtype')));
      if (on('allegati') && st === 'FileAttachment') { out.allegati++; continue; }
      if (on('commenti') && COMMENT_TYPES.has(st)) { if (st !== 'Popup') out.commenti++; continue; }
      if (on('commenti') && a.dict.get(N('Popup')) && st !== 'Widget' && st !== 'Link') a.dict.delete(N('Popup'));
      if (on('campiNascosti') && st === 'Widget' && (num(ctx, a.dict.get(N('F'))) & (HIDDEN | NOVIEW))) {
        out.campiNascosti++; if (a.ref instanceof PDFRef) removedWidgets.add(a.ref.tag); continue;
      }
      keep.push(a.ref);
    }
    p.node.set(N('Annots'), ctx.obj(keep));
  }
  if (removedWidgets.size) pruneFieldTree(pdfDoc, removedWidgets);
  if (on('livelliNascosti')) out.livelliNascosti = removeHiddenLayers(pdfDoc);
  if (on('datiPrivati')) allDicts(ctx, (d) => { for (const k of ['PieceInfo', 'Thumb']) if (d.get(N(k))) { d.delete(N(k)); out.datiPrivati++; } });
  if (on('xfa')) { const acro = lookupDict(ctx, cat.get(N('AcroForm'))); if (acro?.get(N('XFA'))) { acro.delete(N('XFA')); out.xfa = 1; } }
  if (on('versioni')) out.versioni = removeUnreachable(pdfDoc);
  return out;
}

function pruneFieldTree(pdfDoc, removed) {
  const ctx = pdfDoc.context;
  const acro = lookupDict(ctx, pdfDoc.catalog.get(N('AcroForm')));
  if (!acro) return;
  const prune = (arr, depth) => {
    const out = [];
    for (const ref of arr?.asArray() || []) {
      if (ref instanceof PDFRef && removed.has(ref.tag)) continue;
      const f = lookupDict(ctx, ref); if (!f || depth > 32) continue;
      const kids = lookupArray(ctx, f.get(N('Kids')));
      if (kids) { const k = prune(kids, depth + 1); if (!k.length) continue; f.set(N('Kids'), ctx.obj(k)); }
      out.push(ref);
    }
    return out;
  };
  acro.set(N('Fields'), ctx.obj(prune(lookupArray(ctx, acro.get(N('Fields'))), 0)));
}

/** Toglie il contenuto marcato con livelli spenti da pagine e moduli; aggiorna OCProperties. → livelli tolti */
export function removeHiddenLayers(pdfDoc) {
  const ctx = pdfDoc.context; const cat = pdfDoc.catalog;
  const off = hiddenOCGs(ctx, cat);
  if (!off.size) return 0;
  const done = new Set();
  const processContainer = (holder, resources, getBytes, setBytes, depth) => {
    if (depth > 12) return;
    const res = lookupDict(ctx, resources);
    const props = res && lookupDict(ctx, res.get(N('Properties')));
    const xobjs = res && lookupDict(ctx, res.get(N('XObject')));
    const bytes = getBytes();
    if (!bytes) return;
    const ops = parseOps(bytes);
    const ranges = hiddenRanges(ops, {
      isHiddenProp: (name) => !!props && ocIsHidden(ctx, props.get(N(name)), off),
      isHiddenXObject: (name) => { const x = xobjs && ctx.lookup(xobjs.get(N(name))); return x instanceof PDFStream && !!x.dict.get(N('OC')) && ocIsHidden(ctx, x.dict.get(N('OC')), off); },
    });
    if (ranges.length) setBytes(cutRanges(bytes, ranges));
    // moduli (Form XObject) annidati
    if (xobjs) for (const [, ref] of xobjs.entries()) {
      if (!(ref instanceof PDFRef) || done.has(ref.tag)) continue;
      done.add(ref.tag);
      const x = ctx.lookup(ref);
      if (!(x instanceof PDFStream) || nameOf(ctx, x.dict.get(N('Subtype'))) !== 'Form') continue;
      processContainer(x, x.dict.get(N('Resources')) || resources, () => streamBytes(x), (b) => replaceStream(ctx, ref, x, b), depth + 1);
    }
  };
  for (const p of pdfDoc.getPages()) {
    const node = p.node;
    processContainer(node, node.Resources(), () => pageContentBytes(pdfDoc, node), (b) => node.set(N('Contents'), ctx.register(ctx.flateStream(b))), 0);
    // annotazioni assegnate a livelli spenti
    const annots = pageAnnots(ctx, p);
    if (annots.length) node.set(N('Annots'), ctx.obj(annots.filter((a) => !(a.dict.get(N('OC')) && ocIsHidden(ctx, a.dict.get(N('OC')), off))).map((a) => a.ref)));
  }
  // aggiorna le proprietà dei livelli: i livelli spenti spariscono
  const ocp = lookupDict(ctx, cat.get(N('OCProperties')));
  if (ocp) {
    const keepRef = (r) => !(r instanceof PDFRef && off.has(r.tag));
    const ocgs = lookupArray(ctx, ocp.get(N('OCGs')));
    if (ocgs) ocp.set(N('OCGs'), ctx.obj(ocgs.asArray().filter(keepRef)));
    const d = lookupDict(ctx, ocp.get(N('D')));
    if (d) {
      d.delete(N('OFF')); d.delete(N('BaseState'));
      const cleanOrder = (arr, depth) => ctx.obj(arr.asArray().filter(keepRef).map((x) => { const a = ctx.lookup(x); return a instanceof PDFArray && depth < 16 ? cleanOrder(a, depth + 1) : x; }));
      const order = lookupArray(ctx, d.get(N('Order')));
      if (order) d.set(N('Order'), cleanOrder(order, 0));
      for (const k of ['ON', 'Locked', 'RBGroups', 'AS']) d.delete(N(k));
    }
  }
  return off.size;
}

function replaceStream(ctx, ref, x, bytes) {
  const dict = x.dict.clone(ctx);
  dict.delete(N('Filter')); dict.delete(N('DecodeParms')); dict.delete(N('Length'));
  const s = ctx.flateStream(bytes, {});
  for (const [k, v] of dict.entries()) if (k !== PDFName.of('Filter') && k !== PDFName.of('Length')) s.dict.set(k, v);
  ctx.assign(ref, s);
}
