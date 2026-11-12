// Utilità di basso livello su documenti pdf-lib: raccolta degli oggetti non più raggiungibili,
// lettura dei flussi, alberi dei nomi, stato della cifratura. Logica pura (nessun DOM).
import { PDFDict, PDFArray, PDFRef, PDFName, PDFStream, PDFRawStream, PDFString, PDFHexString, PDFNumber, decodePDFRawStream } from '@cantoo/pdf-lib';

export const N = (s) => PDFName.of(s);

/** Elimina dal contesto gli oggetti indiretti non raggiungibili dal trailer (Root, Info).
 *  pdf-lib altrimenti li riscrive tutti al salvataggio: contenuti "tolti" resterebbero nel file. → numero eliminati */
export function removeUnreachable(pdfDoc) {
  const ctx = pdfDoc.context;
  const seen = new Set();
  const stack = [ctx.trailerInfo.Root, ctx.trailerInfo.Info, ctx.trailerInfo.Encrypt].filter(Boolean);
  while (stack.length) {
    const o = stack.pop();
    if (o instanceof PDFRef) {
      if (seen.has(o.tag)) continue;
      seen.add(o.tag);
      const v = ctx.lookup(o); if (v) stack.push(v);
    } else if (o instanceof PDFDict) {
      for (const [, v] of o.entries()) if (v) stack.push(v);
    } else if (o instanceof PDFArray) {
      for (const v of o.asArray()) if (v) stack.push(v);
    } else if (o instanceof PDFStream) stack.push(o.dict);
  }
  let removed = 0;
  for (const [ref] of ctx.enumerateIndirectObjects()) if (!seen.has(ref.tag)) { ctx.delete(ref); removed++; }
  return removed;
}

/** Byte decodificati di un flusso (null se il filtro non è supportato). */
export function streamBytes(stream) {
  try {
    if (stream instanceof PDFRawStream) return decodePDFRawStream(stream).decode();
    if (typeof stream.getContents === 'function') return stream.getContents();
  } catch { /* filtro non supportato o dati danneggiati */ }
  return null;
}

/** Contenuto della pagina come un solo array di byte (concatena Contents se è un array). null se illeggibile. */
export function pageContentBytes(pdfDoc, pageNode) {
  const ctx = pdfDoc.context;
  const contents = ctx.lookup(pageNode.get(N('Contents')));
  const streams = contents instanceof PDFArray ? contents.asArray().map((r) => ctx.lookup(r)) : contents ? [contents] : [];
  const parts = [];
  for (const s of streams) { if (!(s instanceof PDFStream)) continue; const b = streamBytes(s); if (b == null) return null; parts.push(b); }
  const out = new Uint8Array(parts.reduce((t, p) => t + p.length + 1, 0)); let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; out[o++] = 10; }
  return out;
}

export function lookupDict(ctx, v) { const o = v && ctx.lookup(v); return o instanceof PDFDict ? o : null; }
export function lookupArray(ctx, v) { const o = v && ctx.lookup(v); return o instanceof PDFArray ? o : null; }
export function num(ctx, v, def = 0) { const o = v && ctx.lookup(v); return o instanceof PDFNumber ? o.asNumber() : def; }
export function nameOf(ctx, v) { const o = v && ctx.lookup(v); return o instanceof PDFName ? o.decodeText() : null; }
export function textOf(ctx, v) { const o = v && ctx.lookup(v); return o instanceof PDFString || o instanceof PDFHexString ? o.decodeText() : null; }

/** Voci di un albero dei nomi (Names/EmbeddedFiles, Names/JavaScript…). → [{ name, value }] */
export function nameTreeEntries(ctx, root, depth = 0, seen = new Set()) {
  const out = []; const node = lookupDict(ctx, root);
  if (!node || depth > 32 || seen.has(node)) return out;
  seen.add(node);
  const names = lookupArray(ctx, node.get(N('Names')));
  if (names) for (let i = 0; i + 1 < names.size(); i += 2) out.push({ name: textOf(ctx, names.get(i)) ?? '', value: names.get(i + 1) });
  const kids = lookupArray(ctx, node.get(N('Kids')));
  if (kids) for (const k of kids.asArray()) out.push(...nameTreeEntries(ctx, k, depth + 1, seen));
  return out;
}

/** Nuovo albero dei nomi piatto con le voci indicate ([{name, value}]). → ref */
export function writeFlatNameTree(pdfDoc, entries) {
  const ctx = pdfDoc.context;
  const sorted = [...entries].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const arr = ctx.obj([]);
  for (const e of sorted) { arr.push(PDFHexString.fromText(e.name)); arr.push(e.value); }
  return ctx.register(ctx.obj({ Names: arr }));
}

/** Stato della cifratura leggendo il trailer grezzo. → null oppure { V, R, P, length, algorithm } */
export function encryptionInfo(pdfDoc) {
  const ctx = pdfDoc.context;
  const enc = lookupDict(ctx, ctx.trailerInfo.Encrypt);
  if (!enc) return null;
  const V = num(ctx, enc.get(N('V')), 0); const R = num(ctx, enc.get(N('R')), 0);
  const P = num(ctx, enc.get(N('P')), -1); const length = num(ctx, enc.get(N('Length')), V === 1 ? 40 : 128);
  let algorithm = 'sconosciuto';
  if (V === 5) algorithm = 'AES-256';
  else if (V === 4) {
    const cf = lookupDict(ctx, enc.get(N('CF'))); const std = cf && lookupDict(ctx, cf.get(N('StdCF')));
    const cfm = std && nameOf(ctx, std.get(N('CFM')));
    algorithm = cfm === 'V2' ? 'RC4-128' : 'AES-128';
  } else if (V === 2) algorithm = `RC4-${length}`;
  else if (V === 1) algorithm = 'RC4-40';
  return { V, R, P, length, filter: nameOf(ctx, enc.get(N('Filter'))), algorithm };
}

/** Il documento contiene firme digitali (campi firma compilati o /ByteRange)? → numero di firme */
export function countSignatures(pdfDoc) {
  const ctx = pdfDoc.context; let n = 0;
  for (const [, obj] of ctx.enumerateIndirectObjects()) {
    if (obj instanceof PDFDict && obj.get(N('ByteRange')) && obj.get(N('Contents'))) n++;
  }
  return n;
}
