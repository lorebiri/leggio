// Collegamento con pdf-lib: lettura del content stream di una pagina, descrizione dei font e degli
// XObject, scrittura del nuovo contenuto. Niente DOM (usabile nei test con Node).
import * as PDFLib from '@cantoo/pdf-lib';
import { parseContentStream, concatStreams, latin1 } from './contentstream.js';
import { makeFontModel } from './fontmodel.js';

const { PDFName, PDFDict, PDFArray, PDFNumber, PDFRef, PDFRawStream, PDFStream, PDFString, PDFHexString, decodePDFRawStream, StandardFonts } = PDFLib;
const N = (s) => PDFName.of(s);

/** Byte decodificati di uno stream (qualunque tipo di stream pdf-lib). */
export function streamBytes(stream) {
  if (!stream) return new Uint8Array(0);
  if (stream instanceof PDFRawStream) {
    const filter = stream.dict.get(N('Filter'));
    if (!filter) return stream.contents;
    return decodePDFRawStream(stream).decode();
  }
  if (typeof stream.getUnencodedContents === 'function') return stream.getUnencodedContents();
  if (typeof stream.getContents === 'function') return stream.getContents();
  return new Uint8Array(0);
}

/** Content stream della pagina (concatenati se in array). */
export function pageContentBytes(page) {
  const ctx = page.doc.context;
  const contents = page.node.get(N('Contents'));
  if (!contents) return new Uint8Array(0);
  const obj = ctx.lookup(contents);
  const list = [];
  if (obj instanceof PDFArray) {
    for (let i = 0; i < obj.size(); i++) { const s = ctx.lookup(obj.get(i)); if (s instanceof PDFStream) list.push(streamBytes(s)); }
  } else if (obj instanceof PDFStream) list.push(streamBytes(obj));
  return list.length === 1 ? list[0] : concatStreams(list);
}

/** Sostituisce il contenuto della pagina con un unico stream compresso. */
export function setPageContent(page, bytes) {
  const ctx = page.doc.context;
  const stream = ctx.flateStream(bytes);
  page.node.set(N('Contents'), ctx.register(stream));
}

const numOf = (o) => (o instanceof PDFNumber ? o.asNumber() : null);
function arrNums(ctx, a) {
  a = ctx.lookup(a);
  if (!(a instanceof PDFArray)) return null;
  const out = [];
  for (let i = 0; i < a.size(); i++) { const v = ctx.lookup(a.get(i)); out.push(v instanceof PDFArray ? arrNums(ctx, v) : numOf(v)); }
  return out;
}
const nameOf = (o) => (o instanceof PDFName ? o.decodeText() : null);

/** Descrizione semplice di un dizionario font per makeFontModel. */
export function describeFont(ctx, fontDict) {
  const get = (d, k) => (d ? ctx.lookup(d.get(N(k))) : undefined);
  const subtype = nameOf(get(fontDict, 'Subtype')) || 'Type1';
  const baseFont = nameOf(get(fontDict, 'BaseFont')) || '';
  const desc = { subtype, baseFont };
  const tu = get(fontDict, 'ToUnicode');
  if (tu instanceof PDFStream) { try { desc.toUnicode = latin1(streamBytes(tu)); } catch { /* ToUnicode illeggibile */ } }
  let fd = get(fontDict, 'FontDescriptor');
  if (subtype === 'Type0') {
    const enc = get(fontDict, 'Encoding');
    if (enc instanceof PDFName) desc.cmapName = enc.decodeText();
    else if (enc instanceof PDFStream) { try { desc.cmapText = latin1(streamBytes(enc)); desc.cmapName = 'embedded'; } catch { /* */ } }
    const df = get(fontDict, 'DescendantFonts');
    const d0 = df instanceof PDFArray ? ctx.lookup(df.get(0)) : null;
    if (d0 instanceof PDFDict) {
      desc.descendant = { w: arrNums(ctx, d0.get(N('W'))) || [], dw: numOf(get(d0, 'DW')) ?? 1000 };
      fd = get(d0, 'FontDescriptor');
    }
  } else {
    desc.firstChar = numOf(get(fontDict, 'FirstChar')) ?? 0;
    desc.widths = arrNums(ctx, fontDict.get(N('Widths'))) || [];
    const enc = get(fontDict, 'Encoding');
    if (enc instanceof PDFName) desc.encoding = { base: enc.decodeText() };
    else if (enc instanceof PDFDict) {
      const differences = new Map();
      const diff = get(enc, 'Differences');
      if (diff instanceof PDFArray) {
        let code = 0;
        for (let i = 0; i < diff.size(); i++) {
          const v = ctx.lookup(diff.get(i));
          if (v instanceof PDFNumber) code = v.asNumber();
          else if (v instanceof PDFName) differences.set(code++, v.decodeText());
        }
      }
      desc.encoding = { base: nameOf(get(enc, 'BaseEncoding')), differences };
    }
    if (subtype === 'Type3') desc.fontMatrix = arrNums(ctx, fontDict.get(N('FontMatrix')));
  }
  if (fd instanceof PDFDict) {
    desc.flags = numOf(get(fd, 'Flags')) ?? 0;
    desc.missingWidth = numOf(get(fd, 'MissingWidth')) ?? 0;
    desc.fontWeight = numOf(get(fd, 'FontWeight')) ?? 0;
    desc.embedded = !!(fd.get(N('FontFile')) || fd.get(N('FontFile2')) || fd.get(N('FontFile3')));
    desc.italicAngle = numOf(get(fd, 'ItalicAngle')) ?? 0;
  } else desc.embedded = subtype === 'Type3';
  return desc;
}

// larghezze dei 14 font standard (per i PDF vecchi senza /Widths)
const stdEmbedders = new Map();
function stdWidthFn(baseFont) {
  const map = {
    'Times-Roman': 'TimesRoman', 'Times-Bold': 'TimesRomanBold', 'Times-Italic': 'TimesRomanItalic', 'Times-BoldItalic': 'TimesRomanBoldItalic',
    Helvetica: 'Helvetica', 'Helvetica-Bold': 'HelveticaBold', 'Helvetica-Oblique': 'HelveticaOblique', 'Helvetica-BoldOblique': 'HelveticaBoldOblique',
    Courier: 'Courier', 'Courier-Bold': 'CourierBold', 'Courier-Oblique': 'CourierOblique', 'Courier-BoldOblique': 'CourierBoldOblique',
    Arial: 'Helvetica', 'Arial,Bold': 'HelveticaBold', TimesNewRoman: 'TimesRoman', 'TimesNewRoman,Bold': 'TimesRomanBold', CourierNew: 'Courier',
  };
  const key = map[baseFont];
  if (!key) return null;
  let emb = stdEmbedders.get(key);
  if (!emb) { try { emb = PDFLib.StandardFontEmbedder.for(StandardFonts[key]); } catch { emb = null; } stdEmbedders.set(key, emb); }
  if (!emb) return null;
  return (u) => { try { return emb.widthOfTextAtSize(u, 1000); } catch { return null; } };
}

/**
 * Oggetto risorse per l'interprete, con cache. Gestisce Form XObject annidati (con le loro risorse).
 * seenCodes: Map<fontKey, Set<code>> — codici effettivamente usati (servono per riusare un font sottoinsieme).
 */
export function makeResources(ctx, resDict, cache = new Map()) {
  const lookupIn = (sub, name) => {
    if (!(resDict instanceof PDFDict)) return null;
    const d = ctx.lookup(resDict.get(N(sub)));
    if (!(d instanceof PDFDict)) return null;
    const raw = d.get(N(name));
    return { ref: raw instanceof PDFRef ? raw : null, obj: ctx.lookup(raw) };
  };
  const res = {
    dict: resDict,
    font(name) {
      const f = lookupIn('Font', name);
      if (!f || !(f.obj instanceof PDFDict)) return null;
      const key = f.ref ? 'R' + f.ref.toString() : f.obj;
      if (cache.has(key)) return cache.get(key);
      let model = null;
      try {
        const desc = describeFont(ctx, f.obj);
        if (!desc.embedded && (!desc.widths || !desc.widths.length)) desc.stdWidth = stdWidthFn(desc.baseFont.replace(/^[A-Z]{6}\+/, ''));
        desc.seenCodes = new Set();
        model = makeFontModel(desc);
        model.key = key; model.dict = f.obj; model.ref = f.ref;
        model.seenCodes = desc.seenCodes;
      } catch (err) { model = null; }
      cache.set(key, model);
      return model;
    },
    xobject(name) {
      const x = lookupIn('XObject', name);
      if (!x || !(x.obj instanceof PDFStream)) return null;
      const st = nameOf(x.obj.dict.get(N('Subtype')));
      if (st === 'Image') {
        return { subtype: 'Image', ref: x.ref, width: numOf(ctx.lookup(x.obj.dict.get(N('Width')))), height: numOf(ctx.lookup(x.obj.dict.get(N('Height')))) };
      }
      if (st === 'Form') {
        const key = 'X' + (x.ref ? x.ref.toString() : name);
        return {
          subtype: 'Form', ref: x.ref, matrix: arrNums(ctx, x.obj.dict.get(N('Matrix'))),
          open() {
            if (cache.has(key)) return cache.get(key);
            cache.set(key, null); // protezione dalla ricorsione infinita
            const parsed = parseContentStream(streamBytes(x.obj));
            const r = ctx.lookup(x.obj.dict.get(N('Resources')));
            const v = { parsed, res: r instanceof PDFDict ? makeResources(ctx, r, cache) : res };
            cache.set(key, v);
            return v;
          },
        };
      }
      return null;
    },
  };
  return res;
}

/** Tutto ciò che serve per analizzare una pagina. */
export function loadPage(pdfDoc, pageIndex) {
  const page = pdfDoc.getPage(pageIndex);
  const ctx = pdfDoc.context;
  const bytes = pageContentBytes(page);
  const parsed = parseContentStream(bytes);
  const resDict = page.node.Resources();
  const res = makeResources(ctx, resDict || null);
  return { page, ctx, bytes, parsed, res };
}

/** Annota in ogni font i codici usati nella pagina (servono a capire quali glifi ci sono davvero). */
export function markSeenCodes(shows) {
  for (const s of shows) {
    const f = s.font;
    if (!f || !f.seenCodes) continue;
    for (const g of s.glyphs) f.seenCodes.add(g.code);
  }
}

/** Registra un font (riferimento) nelle risorse della pagina e ne restituisce il nome. */
export function addFontToPage(page, fontRef, tag = 'LgF') { return page.node.newFontDictionary(tag, fontRef).decodeText(); }
export function addXObjectToPage(page, ref, tag = 'LgIm') { return page.node.newXObject(tag, ref).decodeText(); }

/** Nome di risorsa font già presente nella pagina che punta a questo font (per riusare il font originale). */
export function fontResourceName(page, model) {
  const resDict = page.node.Resources();
  const d = resDict && page.doc.context.lookup(resDict.get(N('Font')));
  if (!(d instanceof PDFDict)) return null;
  for (const [k, v] of d.entries()) {
    if ((model.ref && v instanceof PDFRef && v === model.ref) || page.doc.context.lookup(v) === model.dict) return k.decodeText();
  }
  return null;
}

/** Il documento contiene firme digitali compilate? */
export function hasDigitalSignatures(pdfDoc) {
  try {
    const acro = pdfDoc.catalog.lookup(N('AcroForm'));
    if (!(acro instanceof PDFDict)) return false;
    const fields = acro.lookup(N('Fields'));
    if (!(fields instanceof PDFArray)) return false;
    const ctx = pdfDoc.context;
    const visit = (arr, depth) => {
      if (depth > 20) return false;
      for (let i = 0; i < arr.size(); i++) {
        const f = ctx.lookup(arr.get(i));
        if (!(f instanceof PDFDict)) continue;
        if (nameOf(f.get(N('FT'))) === 'Sig' && f.get(N('V'))) return true;
        const kids = ctx.lookup(f.get(N('Kids')));
        if (kids instanceof PDFArray && visit(kids, depth + 1)) return true;
      }
      return false;
    };
    return visit(fields, 0);
  } catch { return false; }
}

export { PDFName, PDFDict, PDFArray, PDFNumber, PDFRef, PDFString, PDFHexString, PDFStream };
