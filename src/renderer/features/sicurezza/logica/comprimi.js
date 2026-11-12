// Riduci dimensioni file (Comprimi PDF): ricompressione JPEG delle immagini con riduzione ai DPI
// desiderati, rimozione di oggetti inutilizzati e dati superflui. La decodifica/codifica delle immagini
// è affidata a un «codec» passato dal chiamante (canvas nel browser, finto nei test): qui niente DOM.
//
// Prudenza: si toccano SOLO immagini a 8 bit, RGB o scala di grigi, compresse JPEG (DCT) o Flate
// (anche con predittore PNG) o non compresse. CMYK, JBIG2, CCITT, JPEG 2000, 16 bit, indicizzate,
// maschere, matrici /Decode: restano intatte. Un'immagine viene sostituita solo se diventa più piccola.
import { PDFRawStream, PDFStream, PDFRef, PDFArray, PDFDict, PDFName, PDFNumber } from '@cantoo/pdf-lib';
import { N, lookupDict, lookupArray, nameOf, num, pageContentBytes, streamBytes, removeUnreachable } from './pdfutil.js';
import { parseOps, xobjectPlacements, placedSize, mulMatrix } from './flusso.js';

/** Livelli predefiniti, dal più leggero al più forte. */
export const LIVELLI = [
  { id: 'archivio', label: 'Bassa compressione (qualità alta, per archivio)', dpi: 220, quality: 0.85 },
  { id: 'media', label: 'Media compressione (consigliata)', dpi: 150, quality: 0.72 },
  { id: 'alta', label: 'Alta compressione (file piccolo, per PEC e portali)', dpi: 110, quality: 0.6 },
];
/** Scala usata da «Riduci sotto N MB»: dalla qualità migliore alla più compressa (testo sempre vettoriale). */
export const SCALA = [
  { dpi: 220, quality: 0.85 }, { dpi: 170, quality: 0.78 }, { dpi: 150, quality: 0.72 }, { dpi: 130, quality: 0.66 },
  { dpi: 110, quality: 0.6 }, { dpi: 96, quality: 0.55 }, { dpi: 80, quality: 0.5 }, { dpi: 72, quality: 0.42 },
  { dpi: 60, quality: 0.35 },
];

const MAX_PIXELS = 60e6;

/** Componenti dichiarati nel marcatore SOF di un JPEG (0 se non trovato). */
export function jpegComponents(b) {
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) { i++; continue; }
    const m = b[i + 1];
    if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue; }
    const len = (b[i + 2] << 8) | b[i + 3];
    if ((m >= 0xc0 && m <= 0xc3) || (m >= 0xc5 && m <= 0xc7) || (m >= 0xc9 && m <= 0xcb) || (m >= 0xcd && m <= 0xcf)) return b[i + 9];
    i += 2 + len;
  }
  return 0;
}

/** Toglie il predittore PNG (Predictor ≥ 10) da dati Flate decodificati. null se non supportato. */
export function unpredictPng(data, { colors = 1, bpc = 8, columns = 1 }) {
  const bpp = Math.max(1, Math.ceil((colors * bpc) / 8));
  const rowLen = Math.ceil((colors * bpc * columns) / 8);
  const rows = Math.floor(data.length / (rowLen + 1));
  const out = new Uint8Array(rows * rowLen);
  let prev = new Uint8Array(rowLen);
  for (let r = 0; r < rows; r++) {
    const type = data[r * (rowLen + 1)];
    const row = data.subarray(r * (rowLen + 1) + 1, (r + 1) * (rowLen + 1));
    const cur = out.subarray(r * rowLen, (r + 1) * rowLen);
    for (let i = 0; i < rowLen; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0; const b = prev[i]; const c = i >= bpp ? prev[i - bpp] : 0;
      let v = row[i];
      if (type === 1) v += a;
      else if (type === 2) v += b;
      else if (type === 3) v += (a + b) >> 1;
      else if (type === 4) { const p = a + b - c; const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      else if (type !== 0) return null;
      cur[i] = v & 255;
    }
    prev = cur;
  }
  return out;
}

/**
 * Classifica un'immagine. → { ok:true, kind:'jpeg'|'raw', width, height, components, csKeep } | { ok:false, reason }
 */
export function classifyImage(ctx, stream) {
  const d = stream.dict;
  if (nameOf(ctx, d.get(N('Subtype'))) !== 'Image') return { ok: false, reason: 'non è un\'immagine' };
  if (String(ctx.lookup(d.get(N('ImageMask')))) === 'true') return { ok: false, reason: 'maschera' };
  const width = num(ctx, d.get(N('Width'))); const height = num(ctx, d.get(N('Height')));
  if (!(width > 0 && height > 0)) return { ok: false, reason: 'dimensioni non valide' };
  if (width * height > MAX_PIXELS) return { ok: false, reason: 'immagine troppo grande' };
  if (num(ctx, d.get(N('BitsPerComponent')), 8) !== 8) return { ok: false, reason: 'profondità diversa da 8 bit' };
  if (d.get(N('Decode'))) return { ok: false, reason: 'matrice /Decode' };
  if (lookupArray(ctx, d.get(N('Mask')))) return { ok: false, reason: 'maschera a chiave di colore' };
  if (d.get(N('SMaskInData'))) return { ok: false, reason: 'trasparenza incorporata' };
  // spazio colore
  const csObj = ctx.lookup(d.get(N('ColorSpace')));
  let components = 0; let csKeep = null;
  if (csObj instanceof PDFName) {
    const n = csObj.decodeText();
    if (n === 'DeviceRGB' || n === 'RGB') components = 3; else if (n === 'DeviceGray' || n === 'G') components = 1;
    else return { ok: false, reason: `spazio colore ${n}` };
    if (components === 3) csKeep = d.get(N('ColorSpace'));
  } else if (csObj instanceof PDFArray && nameOf(ctx, csObj.get(0)) === 'ICCBased') {
    const icc = ctx.lookup(csObj.get(1));
    const n = icc instanceof PDFStream ? num(ctx, icc.dict.get(N('N'))) : 0;
    if (n === 3) { components = 3; csKeep = d.get(N('ColorSpace')); } else if (n === 1) components = 1;
    else return { ok: false, reason: 'profilo colore CMYK o sconosciuto' };
  } else return { ok: false, reason: csObj ? 'spazio colore particolare' : 'senza spazio colore' };
  // filtri
  const f = ctx.lookup(d.get(N('Filter')));
  const filters = f instanceof PDFArray ? f.asArray().map((x) => nameOf(ctx, x)) : f ? [nameOf(ctx, f)] : [];
  if (filters.length > 1) return { ok: false, reason: 'filtri multipli' };
  const filter = filters[0] || null;
  if (filter === 'DCTDecode' || filter === 'DCT') {
    const comp = jpegComponents(stream instanceof PDFRawStream ? stream.contents : new Uint8Array());
    if (comp !== components) return { ok: false, reason: 'JPEG CMYK o non coerente' };
    return { ok: true, kind: 'jpeg', width, height, components, csKeep };
  }
  if (filter === 'FlateDecode' || filter === 'Fl' || filter === null) {
    const parms = lookupDict(ctx, d.get(N('DecodeParms')));
    const pred = parms ? num(ctx, parms.get(N('Predictor')), 1) : 1;
    if (pred !== 1 && pred < 10) return { ok: false, reason: 'predittore TIFF' };
    return { ok: true, kind: 'raw', width, height, components, csKeep, predictor: pred, columns: parms ? num(ctx, parms.get(N('Columns')), width) : width };
  }
  return { ok: false, reason: `filtro ${filter}` };
}

/** Pixel grezzi (width×height×components) di un'immagine 'raw'. null se illeggibile. */
export function rawPixels(stream, info) {
  let data = stream instanceof PDFRawStream && !stream.dict.get(N('Filter')) ? stream.contents : streamBytes(stream);
  if (!data) return null;
  if (info.predictor >= 10) data = unpredictPng(data, { colors: info.components, bpc: 8, columns: info.columns });
  const need = info.width * info.height * info.components;
  if (!data || data.length < need) return null;
  return data.subarray(0, need);
}

/**
 * Dimensione massima (in punti) con cui ogni immagine è disegnata nel documento.
 * → Map(ref.tag → { ref, w, h }) ; le immagini mai trovate nei contenuti non compaiono.
 */
export function imageUsage(pdfDoc, { signal } = {}) {
  const ctx = pdfDoc.context; const usage = new Map(); const seenForms = new Set();
  const visit = (resources, bytes, base, depth) => {
    if (!bytes || depth > 10) return;
    const xobjs = lookupDict(ctx, resources?.get(N('XObject')));
    if (!xobjs) return;
    for (const { name, ctm } of xobjectPlacements(parseOps(bytes), base)) {
      const ref = xobjs.get(N(name)); const x = ref && ctx.lookup(ref);
      if (!(x instanceof PDFStream) || !(ref instanceof PDFRef)) continue;
      const st = nameOf(ctx, x.dict.get(N('Subtype')));
      if (st === 'Image') {
        const s = placedSize(ctm); const u = usage.get(ref.tag);
        if (!u) usage.set(ref.tag, { ref, w: s.w, h: s.h }); else { u.w = Math.max(u.w, s.w); u.h = Math.max(u.h, s.h); }
      } else if (st === 'Form') {
        const key = ref.tag + '@' + ctm.map((v) => v.toFixed(2)).join(',');
        if (seenForms.has(key)) continue; seenForms.add(key);
        const m = lookupArray(ctx, x.dict.get(N('Matrix')));
        const fm = m && m.size() === 6 ? [0, 1, 2, 3, 4, 5].map((i) => num(ctx, m.get(i))) : [1, 0, 0, 1, 0, 0];
        visit(lookupDict(ctx, x.dict.get(N('Resources'))) || resources, streamBytes(x), mulMatrix(fm, ctm), depth + 1);
      }
    }
  };
  for (const p of pdfDoc.getPages()) {
    if (signal?.aborted) throw new DOMException('Annullato', 'AbortError');
    visit(p.node.Resources(), pageContentBytes(pdfDoc, p.node), [1, 0, 0, 1, 0, 0], 0);
  }
  return usage;
}

/**
 * Comprime le immagini del documento (in memoria). Un'immagine alla volta: memoria contenuta.
 * opts: { dpi, quality, gray, codec: { recompress(job) → Promise<Uint8Array|null> }, signal, onProgress(frac, testo), minGain }
 * job = { kind, bytes|pixels, width, height, components, targetWidth, targetHeight, quality, gray }
 * → statistiche { images, changed, savedBytes, skipped: { motivo: n } }
 */
export async function compressImages(pdfDoc, { dpi = 150, quality = 0.72, gray = false, codec, signal, onProgress, minGain = 0.9 } = {}) {
  const ctx = pdfDoc.context;
  const usage = imageUsage(pdfDoc, { signal });
  const pages = pdfDoc.getPages();
  const maxPage = pages.reduce((m, p) => { const { width, height } = p.getSize(); return Math.max(m, width, height); }, 612);
  // tutte le immagini, anche quelle non trovate nei contenuti (annotazioni, motivi)
  const all = [];
  for (const [ref, obj] of ctx.enumerateIndirectObjects()) {
    if (obj instanceof PDFStream && nameOf(ctx, obj.dict.get(N('Subtype'))) === 'Image') all.push(ref);
  }
  const stats = { images: all.length, changed: 0, savedBytes: 0, skipped: {} };
  const skip = (r) => { stats.skipped[r] = (stats.skipped[r] || 0) + 1; };
  // le maschere (SMask) non si toccano: servono alle immagini che le usano
  const smasks = new Set();
  for (const ref of all) { const s = ctx.lookup(ref).dict.get(N('SMask')); if (s instanceof PDFRef) smasks.add(s.tag); const m = ctx.lookup(ref).dict.get(N('Mask')); if (m instanceof PDFRef) smasks.add(m.tag); }
  let k = 0;
  for (const ref of all) {
    k++;
    if (signal?.aborted) throw new DOMException('Annullato', 'AbortError');
    onProgress?.(k / all.length, `Immagine ${k} di ${all.length}`);
    if (smasks.has(ref.tag)) { skip('maschera di trasparenza'); continue; }
    const stream = ctx.lookup(ref);
    let info;
    try { info = classifyImage(ctx, stream); } catch { info = { ok: false, reason: 'non leggibile' }; }
    if (!info.ok) { skip(info.reason); continue; }
    const oldSize = stream instanceof PDFRawStream ? stream.contents.length : 0;
    if (oldSize < 8 * 1024 || info.width < 48 || info.height < 48) { skip('troppo piccola per guadagnare'); continue; }
    const u = usage.get(ref.tag);
    const dispW = u ? u.w : maxPage; const dispH = u ? u.h : maxPage;
    const curDpi = Math.min(info.width / Math.max(1, dispW / 72), info.height / Math.max(1, dispH / 72));
    const scale = curDpi > dpi * 1.1 ? dpi / curDpi : 1;
    const tw = Math.max(1, Math.round(info.width * scale)); const th = Math.max(1, Math.round(info.height * scale));
    const job = { kind: info.kind, width: info.width, height: info.height, components: info.components, targetWidth: tw, targetHeight: th, quality, gray };
    if (info.kind === 'jpeg') job.bytes = stream.contents;
    else { job.pixels = rawPixels(stream, info); if (!job.pixels) { skip('dati non leggibili'); continue; } }
    let out = null;
    try { out = await codec.recompress(job); } catch { out = null; }
    if (!out || !out.length) { skip('non decodificabile'); continue; }
    if (out.length >= oldSize * minGain) { skip('già ottimizzata'); continue; }
    const dict = stream.dict.clone(ctx);
    for (const key of ['Filter', 'DecodeParms', 'Length', 'Width', 'Height', 'BitsPerComponent', 'ColorSpace', 'Interpolate']) dict.delete(N(key));
    dict.set(N('Filter'), N('DCTDecode'));
    dict.set(N('Width'), PDFNumber.of(tw)); dict.set(N('Height'), PDFNumber.of(th));
    dict.set(N('BitsPerComponent'), PDFNumber.of(8));
    dict.set(N('ColorSpace'), info.csKeep && !gray ? info.csKeep : N('DeviceRGB'));
    dict.set(N('Length'), PDFNumber.of(out.length));
    ctx.assign(ref, PDFRawStream.of(dict, out));
    stats.changed++; stats.savedBytes += oldSize - out.length;
    // lascia respirare l'interfaccia
    if (k % 4 === 0) await new Promise((r) => setTimeout(r, 0));
  }
  return stats;
}

/** Pulizie strutturali: dati privati, miniature, (facoltativo) metadati; poi oggetti orfani. → oggetti tolti */
export function cleanupStructure(pdfDoc, { removeMetadata = false } = {}) {
  const ctx = pdfDoc.context;
  for (const [, obj] of ctx.enumerateIndirectObjects()) {
    const d = obj instanceof PDFDict ? obj : obj instanceof PDFStream ? obj.dict : null;
    if (!d) continue;
    d.delete(N('PieceInfo')); d.delete(N('Thumb'));
    if (removeMetadata) d.delete(N('Metadata'));
  }
  if (removeMetadata) {
    const info = lookupDict(ctx, ctx.trailerInfo.Info);
    if (info) for (const k of info.keys()) if (k !== N('Title')) info.delete(k);
  }
  return removeUnreachable(pdfDoc);
}

/**
 * «Riduci sotto N MB»: sceglie il primo gradino della scala (dal migliore) il cui risultato sta sotto il limite.
 * attempt(step) → Promise<{ size, bytes }>. Ricerca binaria (assume dimensione decrescente lungo la scala).
 * → { index, result, reached }  (reached=false: nemmeno il gradino più forte basta; result = il più piccolo)
 */
export async function searchUnderLimit(steps, limitBytes, attempt, { signal } = {}) {
  // memoria: si tengono i byte solo del miglior risultato valido (e del più forte finché serve)
  const sizes = new Map(); let best = null; let strongest = null;
  const tryAt = async (i) => {
    if (signal?.aborted) throw new DOMException('Annullato', 'AbortError');
    if (sizes.has(i)) return sizes.get(i);
    const r = await attempt(steps[i], i);
    sizes.set(i, r.size);
    if (i === steps.length - 1) strongest = r;
    if (r.size <= limitBytes && (!best || i < best.index)) best = { index: i, result: r };
    return r.size;
  };
  let lo = 0; let hi = steps.length - 1;
  if ((await tryAt(hi)) > limitBytes) return { index: hi, result: strongest, reached: false };
  if ((await tryAt(0)) <= limitBytes) return { index: 0, result: best.result, reached: true };
  strongest = null;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if ((await tryAt(mid)) <= limitBytes) hi = mid; else lo = mid;
  }
  return { index: best.index, result: best.result, reached: true };
}
