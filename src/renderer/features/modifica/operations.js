// Operazioni di modifica ad alto livello su un PDFDocument di pdf-lib (niente DOM, testabili in Node):
// modifica di un blocco di testo, aggiunta di testo, sostituzione di occorrenze, immagini.
import * as PDFLib from '@cantoo/pdf-lib';
import { rewriteContentStream, fmtNum, toHex, concatStreams } from './contentstream.js';
import { interpret, effectiveFontSize, showAngle, mul, apply } from './interpreter.js';
import { removeGlyphs, replaceGlyphRange, placeImage } from './rewrite.js';
import { loadPage, markSeenCodes, setPageContent, addFontToPage, addXObjectToPage, fontResourceName } from './pdfpage.js';
import { toLocal, fromLocal, wrapText, diffRange } from './blocks.js';
import { winAnsiCode } from './fontmodel.js';

const { StandardFonts } = PDFLib;
const enc = new TextEncoder();

/** Analizza una pagina: content stream, glifi, immagini. */
export function analyze(pdfDoc, pageIndex) {
  const L = loadPage(pdfDoc, pageIndex);
  const r = interpret(L.parsed, L.res);
  markSeenCodes(r.shows);
  return { ...L, r, pageIndex };
}

// ------------------------------------------------------------------ glifi e testo

/** Glifi (di tutte le operazioni di testo) il cui centro cade nel box locale del blocco. */
export function glyphsInBlock(A, block, tolerance = 0.2) {
  const fs = block.fontSize || 10;
  const [x0, y0, x1, y1] = block.box;
  const tx = tolerance * fs, ty = 0.12 * fs;
  const out = [];
  A.r.shows.forEach((s, si) => {
    if (!s.glyphs.length) return;
    const ang = showAngle(s);
    if (Math.abs((((ang - block.angle) % 360) + 540) % 360 - 180) > 2) return; // orientamento diverso
    const efs = effectiveFontSize(s);
    s.glyphs.forEach((g, gi) => {
      const [lx, ly] = toLocal(block.angle, g.p[0], g.p[1]);
      if (lx >= x0 - tx && lx <= x1 + tx && ly >= y0 - ty && ly <= y1 + ty) out.push(entry(A, s, si, g, gi, efs, block.angle));
    });
  });
  return out;
}
function entry(A, s, si, g, gi, efs, angle) {
  const [ox, oy] = toLocal(angle, g.o[0], g.o[1]);
  const [ex] = toLocal(angle, g.e[0], g.e[1]);
  return { s, si, g, gi, efs, lx: ox, ly: oy, rx: ex };
}

/**
 * Testo (in ordine di lettura) di un insieme di glifi. refs[i] è il glifo del carattere i (null = separatore inserito).
 * complete = tutti i glifi hanno un Unicode noto.
 */
export function glyphText(entries, { joinParagraph = true } = {}) {
  const sorted = [...entries].sort((a, b) => b.ly - a.ly || a.lx - b.lx);
  const lines = [];
  for (const e of sorted) {
    const ln = lines.find((l) => Math.abs(l.base - e.ly) < 0.45 * Math.max(l.fs, e.efs));
    if (ln) { ln.items.push(e); ln.fs = Math.max(ln.fs, e.efs); } else lines.push({ base: e.ly, fs: e.efs, items: [e] });
  }
  lines.sort((a, b) => b.base - a.base);
  let complete = true;
  const built = lines.map((ln) => {
    ln.items.sort((a, b) => a.lx - b.lx || a.si - b.si || a.gi - b.gi);
    let text = ''; const refs = [];
    let prev = null;
    for (const e of ln.items) {
      const u = e.g.u;
      if (u == null) complete = false;
      if (prev) {
        const gap = e.lx - prev.rx;
        const prevSpace = /\s$/.test(prev.g.u || '');
        const curSpace = /^\s/.test(u || '');
        if (gap > 0.18 * e.efs && !prevSpace && !curSpace) { text += ' '; refs.push(null); }
      }
      const ch = u == null ? '�' : u;
      for (let k = 0; k < ch.length; k++) { text += ch[k]; refs.push(k === 0 ? e : null); }
      // caratteri multipli (legature) mappati al primo
      prev = e;
    }
    const left = ln.items[0]?.lx ?? 0, right = ln.items.length ? Math.max(...ln.items.map((x) => x.rx)) : 0;
    return { text, refs, left, right, base: ln.base, fs: ln.fs };
  });
  // unione delle righe
  let text = ''; const refs = [];
  if (joinParagraph && built.length) {
    const width = Math.max(...built.map((l) => l.right)) - Math.min(...built.map((l) => l.left));
    built.forEach((l, i) => {
      if (i === 0) { text = l.text; refs.push(...l.refs); return; }
      const prev = built[i - 1];
      const full = prev.right - prev.left > 0.75 * width;
      if (full && /[A-Za-zÀ-ÿ]-$/.test(text) && /^[a-zà-ÿ]/.test(l.text)) { text = text.slice(0, -1); refs.pop(); }
      else { text += full ? ' ' : '\n'; refs.push(null); }
      text += l.text; refs.push(...l.refs);
    });
  } else {
    built.forEach((l, i) => { if (i) { text += '\n'; refs.push(null); } text += l.text; refs.push(...l.refs); });
  }
  return { text, refs, complete, lines: built };
}

// ------------------------------------------------------------------ font per scrivere

const STD = {
  Helvetica: ['Helvetica', 'HelveticaBold', 'HelveticaOblique', 'HelveticaBoldOblique'],
  Times: ['TimesRoman', 'TimesRomanBold', 'TimesRomanItalic', 'TimesRomanBoldItalic'],
  Courier: ['Courier', 'CourierBold', 'CourierOblique', 'CourierBoldOblique'],
};
const stdKey = (family, bold, italic) => (STD[family] || STD.Helvetica)[(bold ? 1 : 0) + (italic ? 2 : 0)];
export const isWinAnsi = (text) => [...text].every((ch) => ch === '\n' || winAnsiCode(ch) >= 0);

/**
 * Sceglie il font con cui scrivere. want: { font:'original'|'Helvetica'|'Times'|'Courier', bold, italic }.
 * env.loadUnicodeFont({bold, italic}) → Promise<Uint8Array> per i caratteri fuori da WinAnsi.
 * Ritorna { name, kind:'original'|'standard'|'unicode', encode(str)→hex, width(str,size), singleByte, missing:[] }
 */
export async function chooseWriterFont(pdfDoc, page, want, text, env = {}, origModel = null, cache = new Map()) {
  const plain = text.replace(/\n/g, '');
  if (want.font === 'original' && origModel && origModel.supported && !origModel.vertical && origModel.subtype !== 'Type3') {
    const resName = fontResourceName(page, origModel);
    const bytes = origModel.encode(plain);
    if (resName && bytes) {
      const codesOf = (s) => { const b = origModel.encode(s) || new Uint8Array(0); const out = []; for (let i = 0; i < b.length; i += origModel.codeBytes) out.push(origModel.codeBytes === 2 ? b[i] * 256 + b[i + 1] : b[i]); return out; };
      return {
        name: resName, kind: 'original', singleByte: origModel.codeBytes === 1, missing: [],
        encode: (s) => '<' + toHex(origModel.encode(s) || new Uint8Array(0)) + '>',
        width: (s, size) => codesOf(s).reduce((t, c) => t + origModel.widthOfCode(c), 0) / 1000 * size,
      };
    }
  }
  const family = want.font === 'original' ? (origModel?.family || 'Helvetica') : (STD[want.font] ? want.font : 'Helvetica');
  const bold = want.bold ?? origModel?.bold ?? false;
  const italic = want.italic ?? origModel?.italic ?? false;
  if (isWinAnsi(plain)) {
    const key = stdKey(family, bold, italic);
    let f = cache.get(key);
    if (!f) { f = await pdfDoc.embedFont(StandardFonts[key]); cache.set(key, f); }
    const name = addFontToPage(page, f.ref);
    return { name, kind: 'standard', singleByte: true, missing: [], encode: (s) => f.encodeText(s).toString(), width: (s, size) => f.widthOfTextAtSize(s, size) };
  }
  if (!env.loadUnicodeFont) throw new Error('Il testo contiene caratteri speciali che richiedono un font aggiuntivo non disponibile.');
  const key = 'U' + (bold ? 'b' : '') + (italic ? 'i' : '');
  let f = cache.get(key);
  if (!f) {
    const bytes = await env.loadUnicodeFont({ bold, italic });
    f = await pdfDoc.embedFont(bytes, { subset: false }); // il sottoinsieme di fontkit fallisce con questi TTF
    cache.set(key, f);
  }
  const missing = [];
  try {
    const fk = f.embedder?.font;
    if (fk?.hasGlyphForCodePoint) for (const ch of new Set(plain)) if (!fk.hasGlyphForCodePoint(ch.codePointAt(0))) missing.push(ch);
  } catch { /* */ }
  const name = addFontToPage(page, f.ref);
  return { name, kind: 'unicode', singleByte: false, missing, encode: (s) => f.encodeText(s).toString(), width: (s, size) => f.widthOfTextAtSize(s, size) };
}

// ------------------------------------------------------------------ costruzione del contenuto

const rgbOps = (c) => `${fmtNum(c[0])} ${fmtNum(c[1])} ${fmtNum(c[2])} rg`;

/** Operatori di testo. lines: [{ text, x, y }] in coordinate locali (ruotate di angle). */
export function textOps({ font, size, color = [0, 0, 0], angle = 0, lines, justifyWidth = 0, underline = false }) {
  const r = (angle * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
  let out = `q BT ${rgbOps(color)} /${font.name} ${fmtNum(size)} Tf\n`;
  const deco = [];
  lines.forEach((ln, i) => {
    if (!ln.text) return;
    const [x, y] = fromLocal(angle, ln.x, ln.y);
    let tw = 0;
    if (justifyWidth && font.singleByte && !ln.last) {
      const spaces = (ln.text.match(/ /g) || []).length;
      const w = font.width(ln.text, size);
      if (spaces && justifyWidth > w) tw = (justifyWidth - w) / spaces;
    }
    out += `${fmtNum(tw)} Tw ${fmtNum(c)} ${fmtNum(s)} ${fmtNum(-s)} ${fmtNum(c)} ${fmtNum(x)} ${fmtNum(y)} Tm ${font.encode(ln.text)} Tj\n`;
    if (underline) deco.push([ln.x, ln.y - size * 0.12, ln.x + font.width(ln.text, size) + tw * (ln.text.match(/ /g) || []).length]);
  });
  out += 'ET';
  for (const [ax, ay, bx] of deco) {
    const [p0x, p0y] = fromLocal(angle, ax, ay), [p1x, p1y] = fromLocal(angle, bx, ay);
    out += ` ${rgbOps(color).toUpperCase()} ${fmtNum(size * 0.06)} w ${fmtNum(p0x)} ${fmtNum(p0y)} m ${fmtNum(p1x)} ${fmtNum(p1y)} l S`;
  }
  return out + ' Q\n';
}

/** Rettangolo pieno (quad in spazio pagina) per il ripiego "copertura". */
export function coverOps(quad, color = [1, 1, 1]) {
  return `q ${rgbOps(color)} ${fmtNum(quad[0][0])} ${fmtNum(quad[0][1])} m ${quad.slice(1).map((p) => `${fmtNum(p[0])} ${fmtNum(p[1])} l`).join(' ')} h f Q\n`;
}

/** Contenuto finale: originale (eventualmente riscritto) + aggiunte, con lo stato grafico ripristinato. */
export function composeContent(A, replacements, extra) {
  const base = replacements && replacements.size ? rewriteContentStream(A.parsed, replacements) : A.bytes;
  if (!extra) return base;
  const r = A.r;
  const needWrap = r.unbalanced || r.finalDepth > 0 || !r.endCtmIdentity;
  if (!needWrap) return concatStreams([base, enc.encode(extra)]);
  const k = (r.excessQ || 0) + 1;
  const pre = enc.encode('q\n'.repeat(k));
  const post = enc.encode('Q\n'.repeat(1 + (r.finalDepth || 0)) + extra);
  return concatStreams([pre, base, post]);
}

// ------------------------------------------------------------------ modifica di un blocco

/**
 * Sostituisce il testo di un blocco.
 * block: da groupTextItems (box locale, angle, lines, fontSize, lineHeight, align)
 * style: { font:'original'|'Helvetica'|'Times'|'Courier', size, color:[r,g,b], bold, italic, align, keepFormat }
 * opts: { mode:'auto'|'cover', bgColor:[r,g,b], oldText (testo mostrato nell'editor) }
 * → { method:'inplace'|'rewrite'|'cover', fontKind, warnings:[] }
 */
export async function editBlock(pdfDoc, pageIndex, block, newText, style = {}, env = {}, opts = {}) {
  const A = analyze(pdfDoc, pageIndex);
  const warnings = [];
  const entries = glyphsInBlock(A, block);
  const mode = opts.mode || 'auto';
  const cache = new Map();
  newText = String(newText ?? '').replace(/\r\n?/g, '\n');

  // 1) correzione "in loco" di un tratto di una sola riga: stesso font, stessa posizione, nient'altro si muove
  const styleChanged = (style.font && style.font !== 'original') || style.size || style.color || style.bold != null || style.italic != null || style.align || style.underline;
  if (mode === 'auto' && !styleChanged && style.keepFormat !== false && entries.length) {
    const gt = glyphText(entries);
    const old = opts.oldText ?? gt.text;
    if (gt.complete && old === gt.text) {
      const r = tryInPlace(A, gt, newText, block);
      if (r) { setPageContent(A.page, rewriteContentStream(A.parsed, r.replacements)); return { method: 'inplace', fontKind: 'original', warnings }; }
    }
  }

  // 2) rimozione dei glifi del blocco
  const remove = new Map(); // showIndex → Set(glyphIndex)
  for (const e of entries) { if (!remove.has(e.si)) remove.set(e.si, new Set()); remove.get(e.si).add(e.gi); }
  let method = mode === 'cover' ? 'cover' : 'rewrite';
  const replacements = new Map();
  if (method === 'rewrite') {
    for (const [si, set] of remove) {
      const s = A.r.shows[si];
      if (s.inForm || !s.font || !s.font.supported) { method = 'cover'; break; }
      const rep = removeGlyphs(s, A.parsed.ops[s.opIndex], (g, gi) => set.has(gi));
      if (rep === null) { method = 'cover'; break; }
      if (rep !== undefined) replacements.set(s.opIndex, rep);
    }
    if (!entries.length) method = 'cover';
  }
  if (method === 'cover') replacements.clear();

  // 3) aspetto del testo originale
  const dom = dominant(entries);
  const origModel = dom?.s.font || null;
  const blockSize = block.fontSize || dom?.efs || 12;
  const size = style.size || blockSize;
  const color = style.color || dom?.s.color || [0, 0, 0];
  const want = { font: style.font || 'original', bold: style.bold, italic: style.italic };
  let extra = '';
  if (method === 'cover') extra += coverOps(expandQuad(block, 0.06 * blockSize), opts.bgColor || [1, 1, 1]);

  let fontKind = null;
  if (newText.trim()) {
    const font = await chooseWriterFont(pdfDoc, A.page, want, newText, env, origModel, cache);
    fontKind = font.kind;
    if (font.missing.length) warnings.push('Alcuni caratteri non sono disponibili nel font: ' + font.missing.join(' '));
    const lh = (block.lineHeight || blockSize * 1.2) * (size / blockSize);
    const width = block.box[2] - block.box[0];
    const single = (block.lines?.length || 1) === 1;
    const align = style.align || block.align || 'left';
    const firstBase = block.lines?.[0]?.base ?? (block.box[3] - size * 0.82);
    const lines = [];
    for (const para of newText.split('\n')) {
      const wr = single ? [para] : wrapText(para, width, (t) => font.width(t, size));
      wr.forEach((t, k) => lines.push({ text: t, last: k === wr.length - 1 }));
    }
    lines.forEach((ln, i) => {
      const w = font.width(ln.text, size);
      let x = block.box[0];
      if (align === 'center') x = block.box[0] + (width - w) / 2;
      else if (align === 'right') x = block.box[2] - w;
      ln.x = x; ln.y = firstBase - i * lh;
    });
    extra += textOps({ font, size, color, angle: block.angle, lines, justifyWidth: align === 'justify' ? width : 0, underline: style.underline });
    if (!single && lines.length > (block.lines?.length || 1)) warnings.push('Il nuovo testo è più lungo dell\'originale e occupa più righe: controlla che non si sovrapponga al testo sottostante.');
  }
  setPageContent(A.page, composeContent(A, replacements, extra));
  return { method, fontKind, warnings };
}

function dominant(entries) {
  const count = new Map();
  for (const e of entries) if (e.g.u && e.g.u.trim()) count.set(e.si, (count.get(e.si) || 0) + 1);
  let best = null, n = -1;
  for (const e of entries) { const c = count.get(e.si) || 0; if (c > n) { n = c; best = e; } }
  return best;
}

function expandQuad(block, m) {
  const [x0, y0, x1, y1] = block.box;
  const b = [x0 - m, y0 - m, x1 + m, y1 + m];
  return [fromLocal(block.angle, b[0], b[1]), fromLocal(block.angle, b[2], b[1]), fromLocal(block.angle, b[2], b[3]), fromLocal(block.angle, b[0], b[3])];
}

/**
 * Prova a riscrivere solo il tratto cambiato con lo stesso font.
 * Condizioni: tratto su una sola riga, dentro un solo operatore, caratteri disponibili nel font,
 * nessun altro testo indipendente da spostare sulla stessa riga, nessuno sbordo dal blocco.
 */
export function tryInPlace(A, gt, newText, block) {
  const d = diffRange(gt.text, newText);
  if (d.start === gt.text.length && d.oldEnd === gt.text.length && d.start === newText.length) return null; // identici
  const mid = newText.slice(d.start, d.newEnd);
  if (mid.includes('\n')) return null;
  const region = gt.refs.slice(d.start, d.oldEnd);
  let anchor = null, insertAfter = true;
  if (!region.length) {
    anchor = gt.refs[d.start - 1] || null;
    if (!anchor) { anchor = gt.refs[d.start] || null; insertAfter = false; }
    if (!anchor) return null;
  } else if (region.some((r) => !r)) {
    // separatori: ammessi solo se il carattere originale è uno spazio reale mappato a un glifo (non inserito)
    return null;
  }
  const items = region.length ? region : [anchor];
  const si = items[0].si;
  if (items.some((e) => e.si !== si)) return null;
  for (let k = 1; k < items.length; k++) if (items[k].gi !== items[k - 1].gi + 1) return null;
  const s = A.r.shows[si];
  if (s.inForm || !s.font || !s.font.supported || s.font.vertical || s.font.subtype === 'Type3') return null;
  const midBytes = mid ? s.font.encode(mid) : new Uint8Array(0);
  if (!midBytes) return null;
  // larghezza: nuovo meno vecchio (in unità di pagina)
  const efs = items[0].efs;
  const codeW = (b) => { let w = 0; const step = s.font.codeBytes || 1; for (let i = 0; i < b.length; i += step) w += s.font.widthOfCode(step === 2 ? b[i] * 256 + b[i + 1] : b[i]); return w / 1000; };
  const oldW = region.reduce((t, e) => t + (e.g.w || 0) / 1000, 0);
  const delta = (codeW(midBytes) - oldW) * efs;
  // altro testo sulla stessa riga dopo l'operatore, che non scorrerebbe
  const lastOfShow = s.glyphs[s.glyphs.length - 1];
  const [endX] = toLocal(block.angle, lastOfShow.e[0], lastOfShow.e[1]);
  const lineY = items[0].ly;
  const others = A.r.shows.some((o, oi) => oi !== si && o.glyphs.some((g) => { const [gx, gy] = toLocal(block.angle, g.o[0], g.o[1]); return Math.abs(gy - lineY) < 0.4 * efs && gx >= endX - 0.1 * efs && gx < endX + 4 * efs + Math.max(0, delta); }));
  if (others && Math.abs(delta) > 0.15 * efs) return null;
  if ((block.lines?.length || 1) > 1 && endX + delta > block.box[2] + 0.4 * efs) return null;
  let from, to, bytes;
  const glyphBytes = (g) => { const el = s.elements[g.el]; return el.b.subarray(g.offset, g.offset + g.len); };
  if (region.length) { from = items[0].gi; to = items[items.length - 1].gi; bytes = midBytes; }
  else {
    from = to = anchor.gi;
    const gb = glyphBytes(anchor.g);
    bytes = new Uint8Array(gb.length + midBytes.length);
    if (insertAfter) { bytes.set(gb); bytes.set(midBytes, gb.length); } else { bytes.set(midBytes); bytes.set(gb, midBytes.length); }
  }
  if (!bytes.length) {
    // cancellazione pura: si toglie il tratto lasciando scorrere il resto dell'operatore
    const rep = replaceGlyphRange(s, A.parsed.ops[s.opIndex], from, to, new Uint8Array(0));
    if (!rep) return null;
    return { replacements: new Map([[s.opIndex, rep]]), delta };
  }
  const rep = replaceGlyphRange(s, A.parsed.ops[s.opIndex], from, to, bytes);
  if (!rep) return null;
  return { replacements: new Map([[s.opIndex, rep]]), delta };
}

// ------------------------------------------------------------------ aggiunta di testo

/**
 * Aggiunge un blocco di testo come contenuto della pagina.
 * at: { x, y } punto in alto a sinistra in spazio pagina; width (0 = nessun a capo automatico)
 * style: { font:'Helvetica'|'Times'|'Courier', size, color, bold, italic, align, underline, lineHeight }
 */
export async function addText(pdfDoc, pageIndex, at, text, style = {}, env = {}) {
  const A = analyze(pdfDoc, pageIndex);
  const size = style.size || 12;
  const font = await chooseWriterFont(pdfDoc, A.page, { font: style.font || 'Helvetica', bold: !!style.bold, italic: !!style.italic }, text, env, null);
  const angle = style.angle || 0;
  const [lx, ly] = toLocal(angle, at.x, at.y);
  const width = at.width || 0;
  const wrapped = width ? wrapText(text, width, (s) => font.width(s, size)) : String(text).split('\n');
  const lh = size * (style.lineHeight || 1.2);
  const boxW = width || Math.max(...wrapped.map((t) => font.width(t, size)));
  const lines = wrapped.map((t, i) => {
    const w = font.width(t, size);
    let x = lx;
    if (style.align === 'center') x = lx + (boxW - w) / 2; else if (style.align === 'right') x = lx + boxW - w;
    return { text: t, x, y: ly - size * 0.82 - i * lh };
  });
  const ops = textOps({ font, size, color: style.color || [0, 0, 0], angle, lines, underline: style.underline });
  setPageContent(A.page, composeContent(A, null, ops));
  return { fontKind: font.kind, warnings: font.missing.length ? ['Alcuni caratteri non sono disponibili nel font: ' + font.missing.join(' ')] : [], lines: lines.length, height: lines.length * lh, width: boxW };
}

// ------------------------------------------------------------------ trova e sostituisci

/** Testo ricercabile della pagina (righe in ordine di lettura) con mappa ai glifi. */
export function pageSearchText(A) {
  const entries = [];
  A.r.shows.forEach((s, si) => {
    if (!s.glyphs.length || s.tr === 3 && false) return;
    const efs = effectiveFontSize(s);
    const ang = Math.round(showAngle(s));
    s.glyphs.forEach((g, gi) => entries.push({ ...entry(A, s, si, g, gi, efs, ang), ang }));
  });
  // raggruppa per orientamento
  const byAng = new Map();
  for (const e of entries) { if (!byAng.has(e.ang)) byAng.set(e.ang, []); byAng.get(e.ang).push(e); }
  let text = ''; const refs = []; let complete = true;
  for (const list of byAng.values()) {
    const gt = glyphText(list, { joinParagraph: false });
    if (!gt.complete) complete = false;
    if (text) { text += '\n'; refs.push(null); }
    text += gt.text; refs.push(...gt.refs);
  }
  return { text, refs, complete };
}

const normCase = (s, cs) => (cs ? s : s.toLocaleLowerCase('it'));
function isWordChar(ch) { return !!ch && /[\p{L}\p{N}_]/u.test(ch); }

/** Occorrenze di query nel testo di una pagina. → [{ start, end, refs, text, context, rect }] */
export function findInPage(A, query, { caseSensitive = false, wholeWord = false } = {}, pst = pageSearchText(A)) {
  if (!query) return [];
  const hay = normCase(pst.text.replace(/ /g, ' '), caseSensitive);
  const q = normCase(query.replace(/ /g, ' '), caseSensitive);
  const out = [];
  let i = 0;
  while ((i = hay.indexOf(q, i)) >= 0) {
    const end = i + q.length;
    if (!wholeWord || (!isWordChar(pst.text[i - 1]) && !isWordChar(pst.text[end]))) {
      const refs = pst.refs.slice(i, end);
      const gl = refs.filter(Boolean);
      if (gl.length) {
        const pts = gl.flatMap((e) => [e.g.o, e.g.e, e.g.top]);
        const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
        out.push({
          start: i, end, refs, text: pst.text.slice(i, end),
          context: pst.text.slice(Math.max(0, i - 30), Math.min(pst.text.length, end + 30)).replace(/\n/g, ' '),
          before: pst.text.slice(Math.max(0, i - 30), i).replace(/\n/g, ' '), after: pst.text.slice(end, end + 30).replace(/\n/g, ' '),
          rect: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)],
        });
      }
    }
    i = end > i ? end : i + 1;
  }
  return out;
}

/**
 * Sostituisce delle occorrenze (calcolate su questa stessa versione della pagina) con `replacement`.
 * Metodo preferito: in loco nello stesso font. Ripiego: glifi tolti + nuovo testo sovrapposto.
 * → { results: [{ method:'inplace'|'overlay'|'cover', warning? }] }
 */
export async function replaceMatches(pdfDoc, pageIndex, matchRanges, replacement, env = {}, opts = {}) {
  const A = analyze(pdfDoc, pageIndex);
  const pst = pageSearchText(A);
  const replacements = new Map();
  let extra = '';
  const results = [];
  const cache = new Map();
  // ogni operatore si può riscrivere una sola volta per passata: occorrenze nello stesso operatore → raggruppate
  const usedOps = new Set();
  const sorted = [...matchRanges].sort((a, b) => b.start - a.start);
  for (const m of sorted) {
    const refs = pst.refs.slice(m.start, m.end);
    if (pst.text.slice(m.start, m.end).toLocaleLowerCase('it') !== String(m.text).toLocaleLowerCase('it')) { results.push({ method: 'skipped', warning: 'Il testo è cambiato: ripeti la ricerca.' }); continue; }
    const gl = refs.filter(Boolean);
    if (!gl.length) { results.push({ method: 'skipped' }); continue; }
    const s = gl[0].s;
    const sameOp = gl.every((e) => e.si === gl[0].si) && refs.every(Boolean);
    const consecutive = gl.every((e, k) => k === 0 || e.gi === gl[k - 1].gi + 1);
    const ownerOp = s.opIndex;
    if (opts.mode !== 'overlay' && sameOp && consecutive && !s.inForm && s.font?.supported && !s.font.vertical && s.font.subtype !== 'Type3' && !usedOps.has(ownerOp)) {
      const bytes = replacement ? s.font.encode(replacement) : new Uint8Array(0);
      if (bytes) {
        // tutte le occorrenze nello stesso operatore vanno fatte insieme
        const same = sorted.filter((mm) => { const r = pst.refs.slice(mm.start, mm.end).filter(Boolean); return r.length && r.every((e) => e.si === gl[0].si); });
        const rep = replaceManyInShow(s, A.parsed.ops[ownerOp], same.map((mm) => pst.refs.slice(mm.start, mm.end).filter(Boolean)), bytes);
        if (rep) {
          replacements.set(ownerOp, rep); usedOps.add(ownerOp);
          for (const mm of same) { results.push({ method: 'inplace', start: mm.start }); mm._done = true; }
          continue;
        }
      }
    }
    if (m._done) continue;
    // ripiego: togliere i glifi e scrivere il testo nuovo sopra
    const byShow = new Map();
    for (const e of gl) { if (!byShow.has(e.si)) byShow.set(e.si, new Set()); byShow.get(e.si).add(e.gi); }
    let cover = false;
    for (const [si, set] of byShow) {
      const sh = A.r.shows[si];
      if (usedOps.has(sh.opIndex) || sh.inForm || !sh.font?.supported) { cover = true; break; }
    }
    const reps = new Map();
    if (!cover) {
      for (const [si, set] of byShow) {
        const sh = A.r.shows[si];
        const rep = removeGlyphs(sh, A.parsed.ops[sh.opIndex], (g, gi) => set.has(gi));
        if (rep === null) { cover = true; break; }
        if (rep !== undefined) reps.set(sh.opIndex, rep);
      }
    }
    const first = gl[0];
    const angle = showAngle(first.s);
    const efs = first.efs;
    if (cover) {
      const pts = gl.flatMap((e) => [e.g.o, e.g.e, e.g.top]).map((p) => toLocal(angle, p[0], p[1]));
      const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
      const mg = 0.08 * efs;
      const box = [Math.min(...xs) - mg, Math.min(...ys) - 0.22 * efs, Math.max(...xs) + mg, Math.max(...ys) + mg];
      extra += coverOps(expandQuad({ box, angle }, 0), opts.bgColor || [1, 1, 1]);
    } else for (const [k, v] of reps) { replacements.set(k, v); usedOps.add(k); }
    if (replacement) {
      const font = await chooseWriterFont(pdfDoc, A.page, { font: 'original' }, replacement, env, first.s.font, cache);
      const [ox, oy] = toLocal(angle, first.g.o[0], first.g.o[1]);
      extra += textOps({ font, size: efs, color: first.s.color, angle, lines: [{ text: replacement, x: ox, y: oy }] });
    }
    results.push({ method: cover ? 'cover' : 'overlay', start: m.start, warning: 'Il testo che segue sulla stessa riga non viene spostato.' });
  }
  setPageContent(A.page, composeContent(A, replacements, extra || null));
  return { results };
}

/** Più sostituzioni nello stesso operatore (gruppi di glifi consecutivi, ordinati). */
function replaceManyInShow(show, opRec, groups, bytes) {
  const sorted = groups.map((g) => [g[0].gi, g[g.length - 1].gi]).sort((a, b) => a[0] - b[0]);
  for (let k = 1; k < sorted.length; k++) if (sorted[k][0] <= sorted[k - 1][1]) return null;
  // si costruisce un nuovo "show" virtuale applicando le sostituzioni da destra a sinistra sui byte degli elementi
  // via replaceGlyphRange ripetuto non è possibile (cambia gli indici): si fa in un passaggio solo.
  const starts = new Map(sorted.map(([a, b]) => [a, b]));
  const inRange = (gi) => sorted.some(([a, b]) => gi >= a && gi <= b);
  const out = [];
  const byEl = new Map();
  show.glyphs.forEach((g, i) => { if (!byEl.has(g.el)) byEl.set(g.el, []); byEl.get(g.el).push([g, i]); });
  show.elements.forEach((el, ei) => {
    if (!el) return;
    if (el.t === 'num') { out.push(fmtNum(el.v)); return; }
    if (el.t !== 'str' && el.t !== 'hex') return;
    let run = [];
    for (const [g, gi] of byEl.get(ei) || []) {
      if (starts.has(gi)) { for (const b of bytes) run.push(b); continue; }
      if (inRange(gi)) continue;
      for (let k = 0; k < g.len; k++) run.push(el.b[g.offset + k]);
    }
    if (run.length) out.push('<' + toHex(Uint8Array.from(run)) + '>');
  });
  let prefix = '';
  if (show.op === "'") prefix = 'T* ';
  if (show.op === '"') { const a = opRec.operands; prefix = `${fmtNum(a[0]?.v || 0)} Tw ${fmtNum(a[1]?.v || 0)} Tc T* `; }
  return prefix + '[' + out.join(' ') + '] TJ';
}

// ------------------------------------------------------------------ immagini

/** Immagini della pagina (quelle dentro Form XObject sono segnalate come non modificabili). */
export function listImages(A) { return A.r.images.map((im, i) => ({ ...im, index: i, editable: !im.inForm })); }

/** Ridisegna un'immagine con una nuova matrice (unità → pagina) ed eventuale ritaglio. */
export function transformImage(pdfDoc, pageIndex, opIndex, target, { clipQuad, newName } = {}) {
  const A = analyze(pdfDoc, pageIndex);
  const img = A.r.images.find((i) => i.opIndex === opIndex && !i.inForm);
  if (!img) throw new Error('Immagine non trovata: la pagina è cambiata, riprova.');
  const rep = placeImage(img.ctm, target, newName || img.name, clipQuad);
  if (!rep) throw new Error('Questa immagine ha una trasformazione non valida e non si può modificare.');
  setPageContent(A.page, rewriteContentStream(A.parsed, new Map([[opIndex, rep]])));
}

export function deleteImage(pdfDoc, pageIndex, opIndex) {
  const A = analyze(pdfDoc, pageIndex);
  const img = A.r.images.find((i) => i.opIndex === opIndex && !i.inForm);
  if (!img) throw new Error('Immagine non trovata: la pagina è cambiata, riprova.');
  setPageContent(A.page, rewriteContentStream(A.parsed, new Map([[opIndex, '']])));
}

/** Incorpora un'immagine PNG/JPEG e restituisce { ref, width, height }. */
export async function embedImage(pdfDoc, bytes) {
  const isPng = bytes[0] === 0x89 && bytes[1] === 0x50;
  const isJpg = bytes[0] === 0xff && bytes[1] === 0xd8;
  if (!isPng && !isJpg) throw new Error('Formato immagine non supportato: usa un file PNG o JPEG.');
  const img = isPng ? await pdfDoc.embedPng(bytes) : await pdfDoc.embedJpg(bytes);
  return { img, ref: img.ref, width: img.width, height: img.height };
}

/** Sostituisce l'immagine mantenendo il riquadro (adattata con le sue proporzioni). */
export async function replaceImage(pdfDoc, pageIndex, opIndex, bytes) {
  const A = analyze(pdfDoc, pageIndex);
  const imgOp = A.r.images.find((i) => i.opIndex === opIndex && !i.inForm);
  if (!imgOp) throw new Error('Immagine non trovata: la pagina è cambiata, riprova.');
  const { ref, width, height } = await embedImage(pdfDoc, bytes);
  const name = addXObjectToPage(A.page, ref);
  // riquadro attuale: lati della CTM
  const c = imgOp.ctm;
  const wv = Math.hypot(c[0], c[1]), hv = Math.hypot(c[2], c[3]);
  const k = Math.min(wv / width, hv / height);
  const nw = width * k, nh = height * k;
  // stessa orientazione, centrata nel vecchio riquadro
  const ux = [c[0] / wv, c[1] / wv], uy = [c[2] / hv, c[3] / hv];
  const center = apply(c, 0.5, 0.5);
  const target = [ux[0] * nw, ux[1] * nw, uy[0] * nh, uy[1] * nh, center[0] - (ux[0] * nw + uy[0] * nh) / 2, center[1] - (ux[1] * nw + uy[1] * nh) / 2];
  const rep = placeImage(c, target, name);
  setPageContent(A.page, rewriteContentStream(A.parsed, new Map([[opIndex, rep]])));
}

/** Aggiunge un'immagine nel rettangolo [x, y, w, h] (spazio pagina, angolo in basso a sinistra), con rotazione facoltativa. */
export async function addImage(pdfDoc, pageIndex, bytes, rect, rotation = 0) {
  const A = analyze(pdfDoc, pageIndex);
  const { ref } = await embedImage(pdfDoc, bytes);
  const name = addXObjectToPage(A.page, ref);
  const [x, y, w, h] = rect;
  let m = [w, 0, 0, h, x, y];
  if (rotation) {
    const r = (rotation * Math.PI) / 180, cs = Math.cos(r), sn = Math.sin(r);
    const cx = x + w / 2, cy = y + h / 2;
    m = mul(m, [cs, sn, -sn, cs, cx - cs * cx + sn * cy, cy - sn * cx - cs * cy]);
  }
  setPageContent(A.page, composeContent(A, null, `q ${m.map(fmtNum).join(' ')} cm /${name} Do Q\n`));
}

// ------------------------------------------------------------------ forme

/** Forme come contenuto: { kind:'line'|'rect'|'ellipse', x1,y1,x2,y2, stroke:[r,g,b]|null, fill:[r,g,b]|null, width } */
export function addShape(pdfDoc, pageIndex, sh) {
  const A = analyze(pdfDoc, pageIndex);
  let ops = 'q ';
  if (sh.stroke) ops += `${rgbOps(sh.stroke).toUpperCase()} ${fmtNum(sh.width || 1)} w `;
  if (sh.fill) ops += rgbOps(sh.fill) + ' ';
  const x = Math.min(sh.x1, sh.x2), y = Math.min(sh.y1, sh.y2), w = Math.abs(sh.x2 - sh.x1), h = Math.abs(sh.y2 - sh.y1);
  if (sh.kind === 'line') ops += `1 J ${fmtNum(sh.x1)} ${fmtNum(sh.y1)} m ${fmtNum(sh.x2)} ${fmtNum(sh.y2)} l S`;
  else {
    if (sh.kind === 'rect') ops += `${fmtNum(x)} ${fmtNum(y)} ${fmtNum(w)} ${fmtNum(h)} re `;
    else {
      const k = 0.5523, cx = x + w / 2, cy = y + h / 2, rx = w / 2, ry = h / 2;
      const P = (a, b) => `${fmtNum(a)} ${fmtNum(b)}`;
      ops += `${P(cx + rx, cy)} m ${P(cx + rx, cy + k * ry)} ${P(cx + k * rx, cy + ry)} ${P(cx, cy + ry)} c ${P(cx - k * rx, cy + ry)} ${P(cx - rx, cy + k * ry)} ${P(cx - rx, cy)} c ${P(cx - rx, cy - k * ry)} ${P(cx - k * rx, cy - ry)} ${P(cx, cy - ry)} c ${P(cx + k * rx, cy - ry)} ${P(cx + rx, cy - k * ry)} ${P(cx + rx, cy)} c h `;
    }
    ops += sh.fill && sh.stroke ? 'B' : sh.fill ? 'f' : 'S';
  }
  ops += ' Q\n';
  setPageContent(A.page, composeContent(A, null, ops));
}
