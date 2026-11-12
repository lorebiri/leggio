// Area «commenti» — lettura e scrittura delle annotazioni PDF con pdf-lib.
// Nessun DOM: tutto è collaudabile in node (test/commenti-annots.test.js).
// Le annotazioni sono "vere" annotazioni standard con aspetto /AP generato (appearance.js),
// così le vedono allo stesso modo Acrobat, Anteprima, i browser e pdf.js.
import { PDFName, PDFNumber, PDFString, PDFHexString, PDFArray, PDFDict, PDFRef, PDFStream, PDFBool, StandardFonts } from '@cantoo/pdf-lib';
import { buildAppearance } from './appearance.js';
import { normRect, rectFromPoints, pairs, quadsBounds, inflate, pdfDate, newName, r2, flattenPts } from './geom.js';

/** Tipi considerati "commenti" (si escludono Link, Widget, Popup e simili). */
export const COMMENT_TYPES = new Set(['Text', 'FreeText', 'Line', 'Square', 'Circle', 'Polygon', 'PolyLine', 'Highlight', 'Underline', 'Squiggly', 'StrikeOut', 'Stamp', 'Caret', 'Ink', 'FileAttachment', 'Sound']);
/** Tipi di cui sappiamo generare l'aspetto. */
export const GENERATED_TYPES = new Set(['Text', 'FreeText', 'Line', 'Square', 'Circle', 'Polygon', 'PolyLine', 'Highlight', 'Underline', 'Squiggly', 'StrikeOut', 'Stamp', 'Caret', 'Ink']);
export const TYPE_LABELS = {
  Text: 'Nota', FreeText: 'Casella di testo', Line: 'Linea', Square: 'Rettangolo', Circle: 'Ellisse', Polygon: 'Poligono',
  PolyLine: 'Polilinea', Highlight: 'Evidenziazione', Underline: 'Sottolineatura', Squiggly: 'Ondulato', StrikeOut: 'Barrato',
  Stamp: 'Timbro', Caret: 'Inserimento testo', Ink: 'Disegno a mano libera', FileAttachment: 'Allegato', Sound: 'Audio',
};
export const STATE_LABELS = { Accepted: 'Accettato', Rejected: 'Rifiutato', Cancelled: 'Annullato', Completed: 'Completato', None: 'Nessuno', Marked: 'Contrassegnato', Unmarked: 'Non contrassegnato' };

const N = (s) => PDFName.of(s);
const FLAG_PRINT = 4, FLAG_NOZOOM = 8, FLAG_NOROTATE = 16, FLAG_NOVIEW = 32, FLAG_HIDDEN = 2;

// ---------------------------------------------------------------- utilità di lettura
export function refKey(ref) { return ref instanceof PDFRef ? (ref.generationNumber ? `${ref.objectNumber}R${ref.generationNumber}` : `${ref.objectNumber}R`) : null; }
export function parseKey(key) {
  const m = /^(\d+)R(\d*)$/.exec(String(key || ''));
  return m ? PDFRef.of(+m[1], m[2] ? +m[2] : 0) : null;
}
const look = (ctx, o) => { try { return ctx.lookup(o); } catch { return undefined; } };
function textOf(ctx, o) {
  const v = look(ctx, o);
  if (v instanceof PDFString || v instanceof PDFHexString) { try { return v.decodeText(); } catch { return ''; } }
  if (v instanceof PDFName) return v.decodeText();
  return '';
}
function nameOf(ctx, o) { const v = look(ctx, o); return v instanceof PDFName ? v.decodeText() : null; }
function numOf(ctx, o, def = null) { const v = look(ctx, o); return v instanceof PDFNumber ? v.asNumber() : def; }
function numsOf(ctx, o) {
  const a = look(ctx, o);
  if (!(a instanceof PDFArray)) return null;
  const out = [];
  for (let i = 0; i < a.size(); i++) { const n = look(ctx, a.get(i)); if (n instanceof PDFNumber && Number.isFinite(n.asNumber())) out.push(n.asNumber()); }
  return out;
}
const get = (dict, k) => dict.get(N(k));
const txt = (s) => PDFHexString.fromText(String(s ?? ''));
const arr = (ctx, nums) => ctx.obj(nums.map((v) => r2(v)));

/** Colore /DA "… r g b rg" e dimensione "/Font size Tf". */
export function parseDA(da) {
  const out = { fontSize: null, textColor: null, font: null };
  if (!da) return out;
  const tf = /\/([^\s/]+)\s+([\d.]+)\s+Tf/.exec(da); if (tf) { out.font = tf[1]; out.fontSize = +tf[2] || null; }
  const rg = /([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+rg/.exec(da); if (rg) out.textColor = [+rg[1], +rg[2], +rg[3]];
  else { const g = /([\d.]+)\s+g(\s|$)/.exec(da); if (g) out.textColor = [+g[1], +g[1], +g[1]]; }
  return out;
}

/** Elenco [{ ref, dict, index }] delle annotazioni di una pagina (ignora elementi non validi). */
export function pageAnnots(pdfDoc, pageIndex) {
  const page = pdfDoc.getPage(pageIndex);
  const ctx = pdfDoc.context;
  const annots = look(ctx, page.node.get(N('Annots')));
  const out = [];
  if (!(annots instanceof PDFArray)) return out;
  for (let i = 0; i < annots.size(); i++) {
    const raw = annots.get(i);
    const dict = look(ctx, raw);
    if (dict instanceof PDFDict) out.push({ ref: raw instanceof PDFRef ? raw : null, dict, index: i });
  }
  return out;
}

/**
 * Legge un dizionario di annotazione in una "spec" normalizzata. Non lancia mai:
 * restituisce null se l'annotazione è inutilizzabile.
 */
export function readAnnot(ctx, dict) {
  try {
    const type = nameOf(ctx, get(dict, 'Subtype'));
    if (!type) return null;
    const s = { type };
    s.rect = normRect(numsOf(ctx, get(dict, 'Rect')));
    const c = numsOf(ctx, get(dict, 'C')); s.color = c && c.length ? toRgb(c) : null;
    const ic = numsOf(ctx, get(dict, 'IC')); s.interior = ic && ic.length ? toRgb(ic) : null;
    s.opacity = numOf(ctx, get(dict, 'CA'), 1);
    const bs = look(ctx, get(dict, 'BS'));
    s.width = bs instanceof PDFDict ? numOf(ctx, bs.get(N('W')), 1) : (numsOf(ctx, get(dict, 'Border'))?.[2] ?? 1);
    if (bs instanceof PDFDict) { const d = numsOf(ctx, bs.get(N('D'))); if (nameOf(ctx, bs.get(N('S'))) === 'D') s.dash = d && d.length ? d : [3]; }
    const be = look(ctx, get(dict, 'BE'));
    if (be instanceof PDFDict && nameOf(ctx, be.get(N('S'))) === 'C') s.cloud = numOf(ctx, be.get(N('I')), 1) || 1;
    s.text = textOf(ctx, get(dict, 'Contents'));
    s.author = textOf(ctx, get(dict, 'T'));
    s.subject = textOf(ctx, get(dict, 'Subj'));
    s.nm = textOf(ctx, get(dict, 'NM'));
    s.modDate = textOf(ctx, get(dict, 'M'));
    s.creationDate = textOf(ctx, get(dict, 'CreationDate'));
    s.flags = numOf(ctx, get(dict, 'F'), 0);
    const irt = get(dict, 'IRT'); if (irt instanceof PDFRef) s.irt = refKey(irt);
    s.replyType = nameOf(ctx, get(dict, 'RT')) || (s.irt ? 'R' : null);
    s.state = textOf(ctx, get(dict, 'State')) || null;
    s.stateModel = textOf(ctx, get(dict, 'StateModel')) || null;
    s.icon = nameOf(ctx, get(dict, 'Name'));
    s.intent = nameOf(ctx, get(dict, 'IT'));
    const qp = numsOf(ctx, get(dict, 'QuadPoints')); if (qp && qp.length >= 8) s.quadPoints = qp.slice(0, qp.length - (qp.length % 8));
    const L = numsOf(ctx, get(dict, 'L')); if (L && L.length >= 4) s.line = L.slice(0, 4);
    const v = numsOf(ctx, get(dict, 'Vertices')); if (v && v.length >= 4) s.vertices = pairs(v);
    const le = look(ctx, get(dict, 'LE'));
    if (le instanceof PDFArray) s.lineEnding = [0, 1].map((i) => nameOf(ctx, le.get(i)) || 'None');
    const ink = look(ctx, get(dict, 'InkList'));
    if (ink instanceof PDFArray) {
      s.inkList = [];
      for (let i = 0; i < ink.size(); i++) { const st = numsOf(ctx, ink.get(i)); if (st && st.length >= 2) s.inkList.push(pairs(st)); }
    }
    if (type === 'FreeText') {
      const da = parseDA(textOf(ctx, get(dict, 'DA')));
      s.fontSize = da.fontSize || 12; s.textColor = da.textColor || [0, 0, 0];
      s.align = numOf(ctx, get(dict, 'Q'), 0);
      if (!bs && !get(dict, 'Border')) s.width = 1;
      s.borderWidth = s.width;
    }
    // rettangolo mancante o degenere: lo ricaviamo dalla geometria
    if (!s.rect || (s.rect[2] - s.rect[0] <= 0 && s.rect[3] - s.rect[1] <= 0)) s.rect = geometryBounds(s) || s.rect;
    if (!s.rect) return null;
    return s;
  } catch { return null; }
}
function toRgb(c) {
  if (c.length === 1) return [c[0], c[0], c[0]];
  if (c.length === 4) return [(1 - c[0]) * (1 - c[3]), (1 - c[1]) * (1 - c[3]), (1 - c[2]) * (1 - c[3])];
  if (c.length >= 3) return c.slice(0, 3);
  return null;
}
export function geometryBounds(s) {
  const w = (s.width || 1) + 2;
  if (s.quadPoints) return quadsBounds(s.quadPoints);
  if (s.inkList?.length) return rectFromPoints(s.inkList.flat(), w);
  if (s.vertices?.length) return rectFromPoints(s.vertices, w + (s.cloud ? 10 : 0));
  if (s.line) return rectFromPoints([[s.line[0], s.line[1]], [s.line[2], s.line[3]]], w * 4);
  return null;
}

/**
 * Tutte le annotazioni-commento del documento.
 * → [{ key, pageIndex, index, ...spec }]; warnings raccoglie quelle saltate.
 */
export function readAllAnnotations(pdfDoc, { pages, warnings = [] } = {}) {
  const ctx = pdfDoc.context;
  const out = [];
  const n = pdfDoc.getPageCount();
  for (const p of pages || [...Array(n).keys()]) {
    let list;
    try { list = pageAnnots(pdfDoc, p); } catch { warnings.push(`Pagina ${p + 1}: elenco annotazioni illeggibile`); continue; }
    for (const { ref, dict, index } of list) {
      const type = nameOf(ctx, get(dict, 'Subtype'));
      if (!COMMENT_TYPES.has(type)) continue;
      const s = readAnnot(ctx, dict);
      if (!s) { warnings.push(`Pagina ${p + 1}: annotazione ${type} danneggiata, saltata`); continue; }
      out.push({ key: ref ? refKey(ref) : `p${p}i${index}`, pageIndex: p, index, ...s });
    }
  }
  return out;
}

/**
 * Trova un'annotazione. target: { key ('12R' come pdf.js, o 'p3i5'), nm, pageIndex, rect, type }.
 * → { pageIndex, ref, dict, index } | null
 */
export function findAnnot(pdfDoc, target) {
  if (!target) return null;
  const ctx = pdfDoc.context;
  const n = pdfDoc.getPageCount();
  const order = Number.isInteger(target.pageIndex) && target.pageIndex >= 0 && target.pageIndex < n
    ? [target.pageIndex, ...[...Array(n).keys()].filter((i) => i !== target.pageIndex)] : [...Array(n).keys()];
  const ref = parseKey(target.key);
  const pk = /^p(\d+)i(\d+)$/.exec(target.key || '');
  if (pk) {
    const list = pageAnnots(pdfDoc, +pk[1]);
    const hit = list.find((a) => a.index === +pk[2]);
    if (hit) return { pageIndex: +pk[1], ...hit };
  }
  for (const p of order) {
    for (const a of pageAnnots(pdfDoc, p)) {
      if (ref && a.ref && a.ref.objectNumber === ref.objectNumber && a.ref.generationNumber === ref.generationNumber) return { pageIndex: p, ...a };
      if (target.nm && textOf(ctx, get(a.dict, 'NM')) === target.nm) return { pageIndex: p, ...a };
    }
    // pdf.js non dà riferimento alle annotazioni dirette: confronto per tipo e rettangolo
    if (!ref && target.rect && p === target.pageIndex) {
      const tr = normRect(target.rect);
      for (const a of pageAnnots(pdfDoc, p)) {
        const r = normRect(numsOf(ctx, get(a.dict, 'Rect')));
        if (r && tr && (!target.type || nameOf(ctx, get(a.dict, 'Subtype')) === target.type) && r.every((v, i) => Math.abs(v - tr[i]) < 0.5)) return { pageIndex: p, ...a };
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------- scrittura
const fontCache = new WeakMap();
async function getFonts(pdfDoc) {
  let f = fontCache.get(pdfDoc);
  if (!f) {
    f = { regular: await pdfDoc.embedFont(StandardFonts.Helvetica), bold: await pdfDoc.embedFont(StandardFonts.HelveticaBold) };
    fontCache.set(pdfDoc, f);
  }
  return f;
}

/** Crea e assegna /AP /N al dizionario. spec.imageRef per i timbri da immagine. */
export async function writeAppearance(pdfDoc, dict, spec) {
  const ctx = pdfDoc.context;
  const fonts = await getFonts(pdfDoc);
  const ap = buildAppearance(spec, fonts);
  if (!ap) return false;
  const gs = { Type: 'ExtGState', CA: r2(ap.gs.CA), ca: r2(ap.gs.ca) };
  if (ap.gs.BM) gs.BM = ap.gs.BM;
  const res = { ExtGState: { GS0: gs } };
  if (Object.keys(ap.fonts).length) { res.Font = {}; for (const [k, v] of Object.entries(ap.fonts)) res.Font[k] = fonts[v].ref; }
  if (ap.xobjects.Im0 && spec.imageRef) res.XObject = { Im0: spec.imageRef };
  const stream = ctx.flateStream(ap.content, { Type: 'XObject', Subtype: 'Form', FormType: 1, BBox: ap.bbox, Matrix: [1, 0, 0, 1, 0, 0], Resources: res });
  const sref = ctx.register(stream);
  dict.set(N('AP'), ctx.obj({ N: sref }));
  return true;
}

function flagsFor(spec) {
  if (spec.reply) return FLAG_PRINT | FLAG_NOZOOM | FLAG_NOROTATE; // come Acrobat; aspetto vuoto (NoView le nasconderebbe anche a pdf.js)
  if (spec.type === 'Text') return FLAG_PRINT | FLAG_NOZOOM | FLAG_NOROTATE;
  return FLAG_PRINT;
}

/** Scrive nel dizionario tutte le chiavi descritte dalla spec (geometria, stile, testo). */
function writeKeys(pdfDoc, dict, spec) {
  const ctx = pdfDoc.context;
  const set = (k, v) => (v === undefined || v === null ? dict.delete(N(k)) : dict.set(N(k), v));
  set('Rect', arr(ctx, spec.rect));
  set('C', spec.color ? arr(ctx, spec.color) : spec.type === 'FreeText' ? ctx.obj([]) : null);
  if (['Square', 'Circle', 'Polygon', 'Line', 'PolyLine'].includes(spec.type)) set('IC', spec.interior ? arr(ctx, spec.interior) : null);
  if (spec.opacity != null && spec.opacity < 1) set('CA', PDFNumber.of(r2(spec.opacity))); else set('CA', null);
  if (spec.text != null) set('Contents', spec.text ? txt(spec.text) : null);
  if (['Square', 'Circle', 'Polygon', 'PolyLine', 'Line', 'Ink', 'FreeText'].includes(spec.type)) {
    const bs = { Type: 'Border', W: r2(spec.type === 'FreeText' ? (spec.borderWidth ?? 0) : (spec.width ?? 1)), S: spec.dash ? 'D' : 'S' };
    if (spec.dash) bs.D = spec.dash;
    set('BS', ctx.obj(bs));
    dict.delete(N('Border'));
  }
  if (spec.cloud) set('BE', ctx.obj({ S: 'C', I: Math.min(2, Math.max(0, spec.cloud)) })); else if (spec.type === 'Square' || spec.type === 'Circle' || spec.type === 'Polygon') set('BE', null);
  if (spec.quadPoints) set('QuadPoints', arr(ctx, spec.quadPoints));
  if (spec.line) set('L', arr(ctx, spec.line));
  if (spec.vertices) set('Vertices', arr(ctx, flattenPts(spec.vertices)));
  if (spec.lineEnding) set('LE', ctx.obj(spec.lineEnding.map((x) => x || 'None')));
  if (spec.inkList) set('InkList', ctx.obj(spec.inkList.map((s) => flattenPts(s))));
  if (spec.type === 'FreeText') {
    const tc = spec.textColor || [0, 0, 0];
    set('DA', PDFString.of(`/Helv ${r2(spec.fontSize || 12)} Tf ${r2(tc[0])} ${r2(tc[1])} ${r2(tc[2])} rg`));
    set('Q', PDFNumber.of(spec.align || 0));
    set('DS', PDFString.of(`font: Helvetica ${r2(spec.fontSize || 12)}pt; text-align:${['left', 'center', 'right'][spec.align || 0]}; color:#${(spec.textColor || [0, 0, 0]).map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('')}`));
    dict.delete(N('RC')); // il testo ricco non è più valido
    if (spec.interior) set('IC', arr(ctx, spec.interior)); else set('IC', null);
  }
  if (spec.intent) set('IT', N(spec.intent));
  if (spec.measure) set('Measure', ctx.obj(spec.measure));
  if (spec.icon) set('Name', N(spec.icon));
  if (spec.subject) set('Subj', txt(spec.subject));
  set('M', PDFString.of(pdfDate()));
}

/**
 * Crea un'annotazione sulla pagina. spec.type obbligatorio; il rettangolo, se manca, è ricavato dalla geometria.
 * opts: { author, imageBytes, imageType: 'png'|'jpg' }. → chiave ('12R')
 */
export async function createAnnot(pdfDoc, pageIndex, spec0, opts = {}) {
  const n = pdfDoc.getPageCount();
  if (!Number.isInteger(pageIndex) || pageIndex < 0 || pageIndex >= n) throw new Error(`Pagina ${pageIndex + 1} inesistente`);
  if (!GENERATED_TYPES.has(spec0?.type)) throw new Error('Tipo di annotazione non supportato: ' + spec0?.type);
  const ctx = pdfDoc.context;
  const page = pdfDoc.getPage(pageIndex);
  const spec = { opacity: 1, ...spec0 };
  if (!spec.rect) spec.rect = geometryBounds(spec);
  spec.rect = normRect(spec.rect);
  if (!spec.rect) throw new Error('Posizione dell\'annotazione non valida');
  if (opts.imageBytes) {
    const img = opts.imageType === 'jpg' ? await pdfDoc.embedJpg(opts.imageBytes) : await pdfDoc.embedPng(opts.imageBytes);
    spec.imageRef = img.ref; spec.image = { w: img.width, h: img.height };
  }
  const now = pdfDate();
  const dict = ctx.obj({ Type: 'Annot', Subtype: spec.type, F: flagsFor(spec), P: page.ref });
  dict.set(N('NM'), txt(spec.nm || newName()));
  dict.set(N('T'), txt(opts.author ?? spec.author ?? ''));
  dict.set(N('CreationDate'), PDFString.of(now));
  if (spec.irt) { const r = parseKey(spec.irt); if (r) dict.set(N('IRT'), r); if (spec.replyType && spec.replyType !== 'R') dict.set(N('RT'), N(spec.replyType)); }
  if (spec.state) { dict.set(N('State'), PDFString.of(spec.state)); dict.set(N('StateModel'), PDFString.of(spec.stateModel || 'Review')); }
  writeKeys(pdfDoc, dict, spec);
  if (spec.type === 'Text' && !spec.icon) dict.set(N('Name'), N('Comment'));
  await writeAppearance(pdfDoc, dict, spec);
  const ref = ctx.register(dict);
  page.node.addAnnot(ref);
  // nota adesiva: finestra popup collegata, come fa Acrobat
  if (spec.type === 'Text' && !spec.reply) {
    const [, , x2, y2] = spec.rect;
    const pw = Math.min(220, Math.max(140, page.getWidth() - x2 - 4));
    const popup = ctx.obj({ Type: 'Annot', Subtype: 'Popup', Rect: [r2(x2 + 4), r2(y2 - 120), r2(x2 + 4 + pw), r2(y2)], Parent: ref, Open: PDFBool.False, F: FLAG_PRINT | FLAG_NOZOOM | FLAG_NOROTATE });
    const pref = ctx.register(popup);
    dict.set(N('Popup'), pref);
    page.node.addAnnot(pref);
  }
  return refKey(ref);
}

/** Matrice affine che porta il rettangolo `from` in `to`. */
export function rectTransform(from, to) {
  const f = normRect(from), t = normRect(to);
  const sx = f[2] - f[0] ? (t[2] - t[0]) / (f[2] - f[0]) : 1;
  const sy = f[3] - f[1] ? (t[3] - t[1]) / (f[3] - f[1]) : 1;
  return (x, y) => [t[0] + (x - f[0]) * sx, t[1] + (y - f[1]) * sy];
}
/** Applica una trasformazione di punti alla geometria della spec (in place). */
export function transformSpec(spec, fn) {
  const tp = (p) => fn(p[0], p[1]);
  if (spec.quadPoints) spec.quadPoints = pairs(spec.quadPoints).map(tp).flat();
  if (spec.line) { const a = fn(spec.line[0], spec.line[1]), b = fn(spec.line[2], spec.line[3]); spec.line = [...a, ...b]; }
  if (spec.vertices) spec.vertices = spec.vertices.map(tp);
  if (spec.inkList) spec.inkList = spec.inkList.map((s) => s.map(tp));
  const a = fn(spec.rect[0], spec.rect[1]), b = fn(spec.rect[2], spec.rect[3]);
  spec.rect = normRect([...a, ...b]);
  return spec;
}

/**
 * Modifica un'annotazione esistente (anche di altri programmi).
 * changes: { color, interior, opacity, width, text, fontSize, textColor, align, cloud, dash, lineEnding,
 *            translate:[dx,dy], rect:[…] (sposta/ridimensiona), inkList, author }
 */
export async function updateAnnot(pdfDoc, target, changes = {}) {
  const found = findAnnot(pdfDoc, target);
  if (!found) throw new Error('Commento non trovato: forse è stato eliminato. Aggiorna l\'elenco e riprova.');
  const ctx = pdfDoc.context;
  const { dict } = found;
  const spec = readAnnot(ctx, dict);
  if (!spec) throw new Error('Questo commento è danneggiato e non si può modificare.');
  const hadAP = !!get(dict, 'AP');
  const keys = Object.keys(changes).filter((k) => changes[k] !== undefined);
  const onlyMove = keys.length > 0 && keys.every((k) => k === 'translate');
  if (changes.translate) { const [dx, dy] = changes.translate.map(Number); if (Number.isFinite(dx) && Number.isFinite(dy)) transformSpec(spec, (x, y) => [x + dx, y + dy]); }
  if (changes.rect) {
    const to = normRect(changes.rect);
    if (!to || to[2] - to[0] < 1 || to[3] - to[1] < 1) throw new Error('Dimensioni non valide');
    transformSpec(spec, rectTransform(spec.rect, to));
    spec.rect = to;
  }
  for (const k of ['color', 'interior', 'opacity', 'width', 'text', 'fontSize', 'textColor', 'align', 'cloud', 'dash', 'lineEnding', 'inkList', 'borderWidth']) if (k in changes) spec[k] = changes[k];
  if ('width' in changes && spec.type === 'FreeText') spec.borderWidth = changes.width;
  if (changes.inkList) spec.rect = geometryBounds(spec);
  if (spec.type === 'Text' && get(dict, 'IRT')) spec.reply = true;
  if (changes.author != null) dict.set(N('T'), txt(changes.author));
  // spostamento puro: l'aspetto originale segue il rettangolo, nessuna perdita di fedeltà
  if (onlyMove && hadAP) {
    const set = (k, v) => dict.set(N(k), v);
    set('Rect', arr(ctx, spec.rect));
    if (spec.quadPoints) set('QuadPoints', arr(ctx, spec.quadPoints));
    if (spec.line) set('L', arr(ctx, spec.line));
    if (spec.vertices) set('Vertices', arr(ctx, flattenPts(spec.vertices)));
    if (spec.inkList) set('InkList', ctx.obj(spec.inkList.map((s) => flattenPts(s))));
    set('M', PDFString.of(pdfDate()));
    movePopup(pdfDoc, dict, changes.translate);
    return refKey(found.ref) || target.key;
  }
  // i timbri di altri programmi non si ridisegnano: si scala l'aspetto esistente
  const keepAP = hadAP && (spec.type === 'Stamp' || !GENERATED_TYPES.has(spec.type)) && keys.every((k) => k === 'rect' || k === 'translate' || k === 'text' || k === 'author');
  if (spec.type === 'Stamp' && hadAP && !keepAP) { /* cambio colore di un timbro: non supportato, si lascia l'aspetto */ }
  writeKeys(pdfDoc, dict, spec);
  if (!keepAP && GENERATED_TYPES.has(spec.type) && spec.type !== 'Stamp') await writeAppearance(pdfDoc, dict, spec);
  return refKey(found.ref) || target.key;
}
function movePopup(pdfDoc, dict, d) {
  if (!d) return;
  const ctx = pdfDoc.context;
  const p = look(ctx, get(dict, 'Popup'));
  if (!(p instanceof PDFDict)) return;
  const r = normRect(numsOf(ctx, p.get(N('Rect'))));
  if (r) p.set(N('Rect'), arr(ctx, [r[0] + d[0], r[1] + d[1], r[2] + d[0], r[3] + d[1]]));
}

/** Elimina annotazioni (con popup e risposte). targets: array di target. → numero eliminate */
export function deleteAnnots(pdfDoc, targets) {
  const ctx = pdfDoc.context;
  let count = 0;
  const victims = new Set(); // chiavi ref eliminate (per trovare le risposte)
  for (const t of targets) {
    const f = findAnnot(pdfDoc, t);
    if (!f) continue;
    removeOne(pdfDoc, f); count++;
    if (f.ref) victims.add(refKey(f.ref));
  }
  // risposte e stati collegati (anche annidati)
  let again = victims.size > 0;
  while (again) {
    again = false;
    for (let p = 0; p < pdfDoc.getPageCount(); p++) {
      for (const a of pageAnnots(pdfDoc, p)) {
        const irt = get(a.dict, 'IRT');
        if (irt instanceof PDFRef && victims.has(refKey(irt))) { removeOne(pdfDoc, { pageIndex: p, ...a }); if (a.ref) victims.add(refKey(a.ref)); again = true; }
      }
    }
  }
  return count;
}
function removeOne(pdfDoc, f) {
  const ctx = pdfDoc.context;
  const page = pdfDoc.getPage(f.pageIndex);
  const annots = look(ctx, page.node.get(N('Annots')));
  if (!(annots instanceof PDFArray)) return;
  const popup = get(f.dict, 'Popup');
  // rimuove per identità (riferimento o dizionario diretto)
  for (let i = annots.size() - 1; i >= 0; i--) {
    const raw = annots.get(i);
    const d = look(ctx, raw);
    if ((f.ref && raw instanceof PDFRef && raw === f.ref) || (f.ref && raw instanceof PDFRef && raw.objectNumber === f.ref.objectNumber && raw.generationNumber === f.ref.generationNumber) || d === f.dict || (popup && raw instanceof PDFRef && popup instanceof PDFRef && raw.objectNumber === popup.objectNumber)) {
      annots.remove(i);
    }
  }
  if (f.ref) ctx.delete(f.ref);
  if (popup instanceof PDFRef) ctx.delete(popup);
}

/** Risposta a un commento. → chiave della risposta */
export async function addReply(pdfDoc, target, { author, text }) {
  const f = findAnnot(pdfDoc, target);
  if (!f || !f.ref) throw new Error('Si può rispondere solo a commenti salvati come oggetti del PDF.');
  if (!String(text || '').trim()) throw new Error('Scrivi il testo della risposta.');
  const r = normRect(numsOf(pdfDoc.context, get(f.dict, 'Rect'))) || [0, 0, 20, 20];
  return createAnnot(pdfDoc, f.pageIndex, { type: 'Text', reply: true, irt: refKey(f.ref), rect: [r[0], r[3] - 20, r[0] + 20, r[3]], text, icon: 'Comment', subject: 'Risposta' }, { author });
}
/** Stato di revisione (Accepted|Rejected|Cancelled|Completed|None) o contrassegno (Marked|Unmarked). */
export async function setStatus(pdfDoc, target, { author, state }) {
  if (!STATE_LABELS[state]) throw new Error('Stato non valido');
  const f = findAnnot(pdfDoc, target);
  if (!f || !f.ref) throw new Error('Commento non trovato.');
  const model = state === 'Marked' || state === 'Unmarked' ? 'Marked' : 'Review';
  const r = normRect(numsOf(pdfDoc.context, get(f.dict, 'Rect'))) || [0, 0, 20, 20];
  return createAnnot(pdfDoc, f.pageIndex, {
    type: 'Text', reply: true, irt: refKey(f.ref), rect: [r[0], r[3] - 20, r[0] + 20, r[3]], state, stateModel: model,
    text: `${author || 'Utente'} ha impostato lo stato: ${STATE_LABELS[state]}`, icon: 'Comment',
  }, { author });
}

/** Pagine da elaborare: indici validi oppure tutte. */
function pageList(pdfDoc, pages) { const n = pdfDoc.getPageCount(); return (pages || [...Array(n).keys()]).filter((p) => Number.isInteger(p) && p >= 0 && p < n); }

/** Elimina tutti i commenti (non tocca link e campi modulo). → numero eliminati */
export function deleteAllComments(pdfDoc, { pages, filter } = {}) {
  const ctx = pdfDoc.context;
  let count = 0;
  for (const p of pageList(pdfDoc, pages)) {
    const page = pdfDoc.getPage(p);
    const annots = look(ctx, page.node.get(N('Annots')));
    if (!(annots instanceof PDFArray)) continue;
    for (let i = annots.size() - 1; i >= 0; i--) {
      const raw = annots.get(i);
      const d = look(ctx, raw);
      if (!(d instanceof PDFDict)) { annots.remove(i); continue; } // voce rotta: la togliamo
      const type = nameOf(ctx, get(d, 'Subtype'));
      let isComment = COMMENT_TYPES.has(type);
      if (type === 'Popup') { const par = look(ctx, get(d, 'Parent')); isComment = !(par instanceof PDFDict) || COMMENT_TYPES.has(nameOf(ctx, get(par, 'Subtype'))); }
      if (!isComment) continue;
      if (filter && type !== 'Popup' && !filter(readAnnot(ctx, d) || { type })) continue;
      annots.remove(i);
      if (raw instanceof PDFRef) ctx.delete(raw);
      if (type !== 'Popup') count++;
    }
  }
  return count;
}

/**
 * Appiattisce i commenti nel contenuto della pagina (diventano parte del disegno, non più modificabili).
 * Le annotazioni senza aspetto vengono prima ridisegnate se possibile. → { flattened, skipped }
 */
export async function flattenComments(pdfDoc, { pages, warnings = [] } = {}) {
  const ctx = pdfDoc.context;
  let flattened = 0, skipped = 0;
  for (const p of pageList(pdfDoc, pages)) {
    const page = pdfDoc.getPage(p);
    const list = pageAnnots(pdfDoc, p);
    let ops = '';
    for (const a of list) {
      const type = nameOf(ctx, get(a.dict, 'Subtype'));
      if (!COMMENT_TYPES.has(type)) continue;
      const flags = numOf(ctx, get(a.dict, 'F'), 0);
      const isReply = get(a.dict, 'IRT') && type === 'Text';
      if (!(flags & (FLAG_HIDDEN | FLAG_NOVIEW)) && !isReply) {
        let stream = apStream(ctx, a.dict);
        if (!stream && GENERATED_TYPES.has(type)) {
          const s = readAnnot(ctx, a.dict);
          if (s && await writeAppearance(pdfDoc, a.dict, s).catch(() => false)) stream = apStream(ctx, a.dict);
        }
        const rect = normRect(numsOf(ctx, get(a.dict, 'Rect')));
        if (stream && rect) {
          const m = apMatrix(ctx, stream.dict, rect);
          if (m) {
            const name = page.node.newXObject('LgFl', stream.ref);
            ops += `q ${m.map(r2).join(' ')} cm /${name.decodeText ? name.decodeText() : String(name).slice(1)} Do Q\n`;
            flattened++;
          } else { skipped++; warnings.push(`Pagina ${p + 1}: ${TYPE_LABELS[type] || type} con aspetto non valido, non appiattita`); continue; }
        } else { skipped++; warnings.push(`Pagina ${p + 1}: ${TYPE_LABELS[type] || type} senza aspetto, non appiattita`); continue; }
      }
      removeOne(pdfDoc, { pageIndex: p, ...a });
    }
    // popup rimasti orfani
    for (const a of pageAnnots(pdfDoc, p)) {
      if (nameOf(ctx, get(a.dict, 'Subtype')) !== 'Popup') continue;
      const par = look(ctx, get(a.dict, 'Parent'));
      if (!(par instanceof PDFDict) || COMMENT_TYPES.has(nameOf(ctx, get(par, 'Subtype')))) removeOne(pdfDoc, { pageIndex: p, ...a });
    }
    if (ops) {
      page.node.normalize();
      page.node.wrapContentStreams(ctx.getPushGraphicsStateContentStream(), ctx.getPopGraphicsStateContentStream());
      page.node.addContentStream(ctx.register(ctx.flateStream(ops)));
    }
  }
  return { flattened, skipped };
}
function apStream(ctx, dict) {
  const ap = look(ctx, get(dict, 'AP'));
  if (!(ap instanceof PDFDict)) return null;
  let nRaw = ap.get(N('N'));
  let n = look(ctx, nRaw);
  if (n instanceof PDFDict && !(n instanceof PDFStream)) {
    const as = nameOf(ctx, get(dict, 'AS'));
    nRaw = as ? n.get(N(as)) : null; n = look(ctx, nRaw);
  }
  if (!(n instanceof PDFStream)) return null;
  const ref = nRaw instanceof PDFRef ? nRaw : ctx.register(n);
  return { ref, dict: n.dict };
}
/** Matrice che porta il BBox (trasformato da /Matrix) nel /Rect, come da specifica PDF 12.5.5. */
export function apMatrix(ctx, sdict, rect) {
  const bbox = normRect(numsOf(ctx, sdict.get(N('BBox'))));
  if (!bbox) return null;
  const mtx = numsOf(ctx, sdict.get(N('Matrix')));
  const M = mtx && mtx.length === 6 ? mtx : [1, 0, 0, 1, 0, 0];
  const pts = [[bbox[0], bbox[1]], [bbox[2], bbox[1]], [bbox[0], bbox[3]], [bbox[2], bbox[3]]].map(([x, y]) => [M[0] * x + M[2] * y + M[4], M[1] * x + M[3] * y + M[5]]);
  const b = rectFromPoints(pts);
  const bw = b[2] - b[0], bh = b[3] - b[1];
  if (bw <= 0 || bh <= 0) return null;
  const sx = (rect[2] - rect[0]) / bw, sy = (rect[3] - rect[1]) / bh;
  const A = [sx, 0, 0, sy, rect[0] - b[0] * sx, rect[1] - b[1] * sy];
  // il disegno usa prima Matrix, poi A (cm moltiplica a sinistra della CTM: il form applica Matrix internamente)
  return A;
}
export { inflate };
