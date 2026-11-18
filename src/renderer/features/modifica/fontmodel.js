// Modello dei font PDF per il riscrittore: suddivisione dei codici, larghezze, Unicode e codifica
// inversa (Unicode → codici) per riscrivere testo con lo stesso font. Puro: niente DOM, niente pdf-lib.

// ------------------------------------------------------------------ nomi di glifo → Unicode
// Latin-1 0xA1..0xFF in ordine (0xAD = hyphen morbido).
const LATIN1_NAMES = ('exclamdown cent sterling currency yen brokenbar section dieresis copyright ordfeminine guillemotleft logicalnot hyphen registered macron degree plusminus twosuperior threesuperior acute mu paragraph periodcentered cedilla onesuperior ordmasculine guillemotright onequarter onehalf threequarters questiondown ' +
  'Agrave Aacute Acircumflex Atilde Adieresis Aring AE Ccedilla Egrave Eacute Ecircumflex Edieresis Igrave Iacute Icircumflex Idieresis Eth Ntilde Ograve Oacute Ocircumflex Otilde Odieresis multiply Oslash Ugrave Uacute Ucircumflex Udieresis Yacute Thorn germandbls ' +
  'agrave aacute acircumflex atilde adieresis aring ae ccedilla egrave eacute ecircumflex edieresis igrave iacute icircumflex idieresis eth ntilde ograve oacute ocircumflex otilde odieresis divide oslash ugrave uacute ucircumflex udieresis yacute thorn ydieresis').split(' ');
const ASCII_NAMES = ('space exclam quotedbl numbersign dollar percent ampersand quotesingle parenleft parenright asterisk plus comma hyphen period slash zero one two three four five six seven eight nine colon semicolon less equal greater question at ' +
  'A B C D E F G H I J K L M N O P Q R S T U V W X Y Z bracketleft backslash bracketright asciicircum underscore grave a b c d e f g h i j k l m n o p q r s t u v w x y z braceleft bar braceright asciitilde').split(' ');
// WinAnsi 0x80..0x9F
const WIN_HIGH = ['Euro', null, 'quotesinglbase', 'florin', 'quotedblbase', 'ellipsis', 'dagger', 'daggerdbl', 'circumflex', 'perthousand', 'Scaron', 'guilsinglleft', 'OE', null, 'Zcaron', null,
  null, 'quoteleft', 'quoteright', 'quotedblleft', 'quotedblright', 'bullet', 'endash', 'emdash', 'tilde', 'trademark', 'scaron', 'guilsinglright', 'oe', null, 'zcaron', 'Ydieresis'];
const WIN_HIGH_U = [0x20AC, 0, 0x201A, 0x0192, 0x201E, 0x2026, 0x2020, 0x2021, 0x02C6, 0x2030, 0x0160, 0x2039, 0x0152, 0, 0x017D, 0,
  0, 0x2018, 0x2019, 0x201C, 0x201D, 0x2022, 0x2013, 0x2014, 0x02DC, 0x2122, 0x0161, 0x203A, 0x0153, 0, 0x017E, 0x0178];

export const GLYPH_UNICODE = new Map();
ASCII_NAMES.forEach((nm, i) => GLYPH_UNICODE.set(nm, String.fromCharCode(32 + i)));
LATIN1_NAMES.forEach((nm, i) => { if (!GLYPH_UNICODE.has(nm)) GLYPH_UNICODE.set(nm, String.fromCharCode(0xA1 + i)); });
WIN_HIGH.forEach((nm, i) => { if (nm) GLYPH_UNICODE.set(nm, String.fromCharCode(WIN_HIGH_U[i])); });
for (const [nm, u] of Object.entries({
  fi: 'ﬁ', fl: 'ﬂ', ff: 'ﬀ', ffi: 'ﬃ', ffl: 'ﬄ', dotlessi: 'ı', Lslash: 'Ł', lslash: 'ł', ring: '˚', caron: 'ˇ', ogonek: '˛', hungarumlaut: '˝',
  breve: '˘', dotaccent: '˙', minus: '−', fraction: '⁄', quoteright: '’', quoteleft: '‘', nbspace: ' ', sfthyphen: '­', middot: '·',
  Zdotaccent: 'Ż', zdotaccent: 'ż', Cacute: 'Ć', cacute: 'ć', Nacute: 'Ń', nacute: 'ń', Sacute: 'Ś', sacute: 'ś', Zacute: 'Ź', zacute: 'ź',
  Ccaron: 'Č', ccaron: 'č', Rcaron: 'Ř', rcaron: 'ř', Ecaron: 'Ě', ecaron: 'ě', Gbreve: 'Ğ', gbreve: 'ğ', Idotaccent: 'İ', Scedilla: 'Ş', scedilla: 'ş',
  space_uni00A0: ' ', periodcentered: '·', bullet: '•', copyright: '©', registered: '®', trademark: '™', Delta: '∆', Omega: 'Ω', mu: 'µ', pi: 'π',
  lessequal: '≤', greaterequal: '≥', notequal: '≠', infinity: '∞', approxequal: '≈', summation: '∑', product: '∏', radical: '√', integral: '∫', partialdiff: '∂', lozenge: '◊', apple: '',
})) GLYPH_UNICODE.set(nm, u);

export function glyphNameToUnicode(name) {
  if (!name) return null;
  const u = GLYPH_UNICODE.get(name);
  if (u) return u;
  let m = /^uni([0-9A-Fa-f]{4,})$/.exec(name);
  if (m && m[1].length % 4 === 0) {
    let s = '';
    for (let i = 0; i < m[1].length; i += 4) s += String.fromCharCode(parseInt(m[1].slice(i, i + 4), 16));
    return s;
  }
  m = /^u([0-9A-Fa-f]{4,6})$/.exec(name);
  if (m) { const cp = parseInt(m[1], 16); if (cp <= 0x10FFFF) return String.fromCodePoint(cp); }
  const dot = name.indexOf('.');
  if (dot > 0) return glyphNameToUnicode(name.slice(0, dot)); // es. "a.sc"
  const us = name.indexOf('_');
  if (us > 0) { const parts = name.split('_').map(glyphNameToUnicode); if (parts.every(Boolean)) return parts.join(''); }
  return null;
}

// ------------------------------------------------------------------ codifiche di base (codice → nome)
function buildWinAnsi() {
  const t = new Array(256).fill(null);
  ASCII_NAMES.forEach((nm, i) => (t[32 + i] = nm));
  WIN_HIGH.forEach((nm, i) => (t[0x80 + i] = nm));
  t[0xA0] = 'space';
  LATIN1_NAMES.forEach((nm, i) => (t[0xA1 + i] = nm));
  return t;
}
function buildStandard() {
  const t = new Array(256).fill(null);
  ASCII_NAMES.forEach((nm, i) => (t[32 + i] = nm));
  t[0x27] = 'quoteright'; t[0x60] = 'quoteleft';
  Object.assign(t, { 0xA1: 'exclamdown', 0xA2: 'cent', 0xA3: 'sterling', 0xA4: 'fraction', 0xA5: 'yen', 0xA6: 'florin', 0xA7: 'section', 0xA8: 'currency', 0xA9: 'quotesingle', 0xAA: 'quotedblleft', 0xAB: 'guillemotleft', 0xAC: 'guilsinglleft', 0xAD: 'guilsinglright', 0xAE: 'fi', 0xAF: 'fl',
    0xB1: 'endash', 0xB2: 'dagger', 0xB3: 'daggerdbl', 0xB4: 'periodcentered', 0xB6: 'paragraph', 0xB7: 'bullet', 0xB8: 'quotesinglbase', 0xB9: 'quotedblbase', 0xBA: 'quotedblright', 0xBB: 'guillemotright', 0xBC: 'ellipsis', 0xBD: 'perthousand', 0xBF: 'questiondown',
    0xC1: 'grave', 0xC2: 'acute', 0xC3: 'circumflex', 0xC4: 'tilde', 0xC5: 'macron', 0xC6: 'breve', 0xC7: 'dotaccent', 0xC8: 'dieresis', 0xCA: 'ring', 0xCB: 'cedilla', 0xCD: 'hungarumlaut', 0xCE: 'ogonek', 0xCF: 'caron', 0xD0: 'emdash',
    0xE1: 'AE', 0xE3: 'ordfeminine', 0xE8: 'Lslash', 0xE9: 'Oslash', 0xEA: 'OE', 0xEB: 'ordmasculine', 0xF1: 'ae', 0xF5: 'dotlessi', 0xF8: 'lslash', 0xF9: 'oslash', 0xFA: 'oe', 0xFB: 'germandbls' });
  return t;
}
const MAC_HIGH = 'ÄÅÇÉÑÖÜáàâäãåçéèêëíìîïñóòôöõúùûü†°¢£§•¶ß®©™´¨≠ÆØ∞±≤≥¥µ∂∑∏π∫ªºΩæø¿¡¬√ƒ≈∆«»… ÀÃÕŒœ–—“”‘’÷◊ÿŸ⁄€‹›ﬁﬂ‡·‚„‰ÂÊÁËÈÍÎÏÌÓÔÒÚÛÙıˆ˜¯˘˙˚¸˝˛ˇ';
const UNICODE_TO_NAME = new Map();
for (const [nm, u] of GLYPH_UNICODE) if (!UNICODE_TO_NAME.has(u)) UNICODE_TO_NAME.set(u, nm);
function buildMacRoman() {
  const t = new Array(256).fill(null);
  ASCII_NAMES.forEach((nm, i) => (t[32 + i] = nm));
  [...MAC_HIGH].forEach((ch, i) => (t[0x80 + i] = UNICODE_TO_NAME.get(ch) || null));
  return t;
}
export const ENCODINGS = { WinAnsiEncoding: buildWinAnsi(), StandardEncoding: buildStandard(), MacRomanEncoding: buildMacRoman() };

/** Unicode → codice WinAnsi (o -1). */
export function winAnsiCode(ch) {
  const c = ch.charCodeAt(0);
  if (ch.length !== 1 || c < 32) return -1; // caratteri di controllo (anche '\0', che nella tabella è uno «0» = vuoto)
  if ((c >= 32 && c < 127) || (c >= 0xA0 && c <= 0xFF)) return c;
  const i = WIN_HIGH_U.indexOf(c);
  return i > 0 || (i === 0 && c === 0x20AC) ? 0x80 + i : -1;
}

// ------------------------------------------------------------------ CMap (ToUnicode e CMap di codifica)

function hexToBytesStr(h) { return h.replace(/[^0-9a-fA-F]/g, ''); }
function hexToInt(h) { return h.length ? parseInt(h, 16) : 0; }
function utf16beHex(h) {
  h = hexToBytesStr(h);
  if (h.length % 4 === 2) h = '00' + h;
  const units = [];
  for (let i = 0; i + 4 <= h.length; i += 4) units.push(parseInt(h.slice(i, i + 4), 16));
  return String.fromCharCode(...units);
}

/**
 * Analizza un CMap (testo). Ritorna { codespace:[{bytes,lo,hi}], map: Map<code, string>, cidMap: Map<code,cid>, cidRanges:[], name }.
 * Supporta bfchar, bfrange (anche con array), cidchar, cidrange, codespacerange, usecmap (solo il nome).
 * Limita le dimensioni per evitare blocchi su CMap enormi o maligni.
 */
export function parseCMap(text) {
  const res = { codespace: [], map: new Map(), cidMap: new Map(), cidRanges: [], usecmap: null, vertical: false };
  if (!text) return res;
  const LIMIT = 200000;
  let count = 0;
  const um = /\/([^\s/]+)\s+usecmap/.exec(text); if (um) res.usecmap = um[1];
  if (/\/WMode\s+1/.test(text)) res.vertical = true;
  const sec = (name, fn) => {
    const re = new RegExp('begin' + name + '([\\s\\S]*?)end' + name, 'g');
    let m;
    while ((m = re.exec(text)) && count < LIMIT) fn(m[1]);
  };
  sec('codespacerange', (body) => {
    const re = /<([0-9a-fA-F\s]*)>\s*<([0-9a-fA-F\s]*)>/g; let m;
    while ((m = re.exec(body))) { const a = hexToBytesStr(m[1]); res.codespace.push({ bytes: Math.max(1, Math.ceil(a.length / 2)), lo: hexToInt(a), hi: hexToInt(hexToBytesStr(m[2])) }); }
  });
  sec('bfchar', (body) => {
    const re = /<([0-9a-fA-F\s]*)>\s*(?:<([0-9a-fA-F\s]*)>|\/(\S+))/g; let m;
    while ((m = re.exec(body)) && count++ < LIMIT) {
      const code = hexToInt(hexToBytesStr(m[1]));
      const u = m[2] != null ? utf16beHex(m[2]) : glyphNameToUnicode(m[3]);
      if (u != null) res.map.set(code, u);
    }
  });
  sec('bfrange', (body) => {
    const re = /<([0-9a-fA-F\s]*)>\s*<([0-9a-fA-F\s]*)>\s*(?:<([0-9a-fA-F\s]*)>|\[([^\]]*)\])/g; let m;
    while ((m = re.exec(body)) && count < LIMIT) {
      const lo = hexToInt(hexToBytesStr(m[1])), hi = hexToInt(hexToBytesStr(m[2]));
      if (hi < lo || hi - lo > 65535) continue;
      if (m[3] != null) {
        const base = utf16beHex(m[3]);
        if (!base.length) continue;
        const last = base.charCodeAt(base.length - 1);
        for (let c = lo; c <= hi && count++ < LIMIT; c++) res.map.set(c, base.slice(0, -1) + String.fromCharCode((last + (c - lo)) & 0xFFFF));
      } else {
        const items = [...m[4].matchAll(/<([0-9a-fA-F\s]*)>/g)].map((x) => utf16beHex(x[1]));
        for (let c = lo; c <= hi && c - lo < items.length && count++ < LIMIT; c++) res.map.set(c, items[c - lo]);
      }
    }
  });
  sec('cidchar', (body) => {
    const re = /<([0-9a-fA-F\s]*)>\s*(\d+)/g; let m;
    while ((m = re.exec(body)) && count++ < LIMIT) res.cidMap.set(hexToInt(hexToBytesStr(m[1])), +m[2]);
  });
  sec('cidrange', (body) => {
    const re = /<([0-9a-fA-F\s]*)>\s*<([0-9a-fA-F\s]*)>\s*(\d+)/g; let m;
    while ((m = re.exec(body)) && count++ < LIMIT) {
      const a = hexToBytesStr(m[1]);
      res.cidRanges.push({ lo: hexToInt(a), hi: hexToInt(hexToBytesStr(m[2])), cid: +m[3], bytes: Math.ceil(a.length / 2) });
    }
  });
  return res;
}

// ------------------------------------------------------------------ modello di font

/**
 * Crea il modello di un font a partire da una descrizione semplice (vedi pdfpage.js → describeFont).
 * desc: { subtype:'Type1'|'TrueType'|'Type3'|'Type0'|'MMType1', baseFont, embedded, firstChar, widths:[], missingWidth,
 *         encoding:{ base:'WinAnsiEncoding'|..., differences: Map<code,name> } | null, toUnicode: string|null,
 *         cmapName: 'Identity-H'|..., cmapText, descendant:{ w:[], dw }, fontMatrix:[6], flags, stdWidth(ch)→number|null }
 * Ritorna { kind, decode(bytes) → glyph[], encode(text) → Uint8Array|null, widthOfCode(code), supported, reason, vertical, ... }
 * glyph: { code, len, offset, w (in 1/1000 di unità testo), u (Unicode o null), space (applica Tw) }
 */
export function makeFontModel(desc) {
  const d = { widths: [], firstChar: 0, missingWidth: 0, ...desc };
  const model = { name: d.baseFont || '', subtype: d.subtype, embedded: !!d.embedded, supported: true, reason: '', vertical: false, desc: d };
  const toUni = d.toUnicode ? parseCMap(d.toUnicode).map : new Map();
  model.hasToUnicode = toUni.size > 0;
  const bold = /bold|black|heavy|semibold|demi/i.test(d.baseFont || '') || (d.fontWeight >= 600);
  const italic = /italic|oblique|-it\b|,it/i.test(d.baseFont || '') || (d.flags & 64) !== 0;
  model.bold = bold; model.italic = italic;
  model.family = guessFamily(d.baseFont || '', d.flags);

  if (d.subtype === 'Type0') {
    const cmapName = d.cmapName || '';
    let cmap = null;
    if (/^Identity-[HV]$/.test(cmapName)) { if (cmapName.endsWith('V')) model.vertical = true; }
    else if (d.cmapText) { cmap = parseCMap(d.cmapText); if (cmap.vertical) model.vertical = true; if (!cmap.codespace.length) cmap = null; }
    else { model.supported = false; model.reason = 'CMap ' + cmapName + ' non gestita'; }
    // larghezze CID
    const cidW = new Map();
    const W = d.descendant?.w || [];
    for (let i = 0; i < W.length && i < 200000;) {
      const a = W[i];
      if (Array.isArray(W[i + 1])) { W[i + 1].forEach((w, k) => cidW.set(a + k, w)); i += 2; }
      else { const b = W[i + 1], w = W[i + 2]; if (typeof b === 'number' && typeof w === 'number' && b - a < 65536) for (let c = a; c <= b; c++) cidW.set(c, w); i += 3; }
    }
    const dw = d.descendant?.dw ?? 1000;
    const codeToCid = (code, len) => {
      if (!cmap) return code;
      if (cmap.cidMap.has(code)) return cmap.cidMap.get(code);
      for (const r of cmap.cidRanges) if (r.bytes === len && code >= r.lo && code <= r.hi) return r.cid + (code - r.lo);
      return 0;
    };
    const codeLen = (bytes, i) => {
      if (!cmap) return 2;
      for (let len = 1; len <= 4; len++) {
        if (i + len > bytes.length) break;
        let v = 0; for (let k = 0; k < len; k++) v = v * 256 + bytes[i + k];
        if (cmap.codespace.some((cs) => cs.bytes === len && v >= cs.lo && v <= cs.hi)) return len;
      }
      return 1;
    };
    model.widthOfCode = (code, len = 2) => { const w = cidW.get(codeToCid(code, len)); return w ?? dw; };
    model.decode = (bytes) => {
      const out = [];
      for (let i = 0; i < bytes.length;) {
        let len = codeLen(bytes, i);
        if (i + len > bytes.length) len = bytes.length - i;
        let code = 0; for (let k = 0; k < len; k++) code = code * 256 + bytes[i + k];
        out.push({ code, len, offset: i, w: model.widthOfCode(code, len), u: toUni.get(code) ?? null, space: len === 1 && code === 32 });
        i += len;
      }
      return out;
    };
    const inv = new Map();
    for (const [code, u] of toUni) if (u.length && !inv.has(u)) inv.set(u, code);
    model.codeBytes = cmap ? null : 2;
    model.encode = (text) => {
      if (cmap || model.vertical) return null; // codifica inversa solo per Identity-H
      const out = [];
      for (const ch of text) {
        const code = inv.get(ch);
        if (code == null || code > 0xFFFF) return null;
        out.push(code >> 8, code & 255);
      }
      return Uint8Array.from(out);
    };
    model.encodable = (ch) => !cmap && !model.vertical && inv.has(ch);
    return model;
  }

  // font semplici (1 byte per codice)
  const isType3 = d.subtype === 'Type3';
  const fm = isType3 ? (d.fontMatrix || [0.001, 0, 0, 0.001, 0, 0]) : null;
  const scaleW = isType3 ? (fm[0] || 0.001) * 1000 : 1;
  if (isType3) { model.reason = 'font Type3'; }
  const names = new Array(256).fill(null);
  const symbolic = d.flags != null ? (d.flags & 4) !== 0 && (d.flags & 32) === 0 : false;
  const baseName = d.encoding?.base || (symbolic || isType3 ? null : (d.embedded && d.subtype !== 'Type1' ? 'WinAnsiEncoding' : 'StandardEncoding'));
  const isStd14 = STD14.test(d.baseFont || '') && !d.embedded;
  const base = ENCODINGS[baseName] || (isStd14 && !/Symbol|Dingbats/i.test(d.baseFont) ? ENCODINGS.StandardEncoding : null);
  if (base) for (let i = 0; i < 256; i++) names[i] = base[i];
  if (d.encoding?.differences) for (const [c, nm] of d.encoding.differences) if (c >= 0 && c < 256) names[c] = nm;
  const uniOf = (code) => {
    if (toUni.has(code)) return toUni.get(code);
    const nm = names[code];
    if (nm) return glyphNameToUnicode(nm);
    if (!symbolic && !isType3 && code >= 32 && code < 127) return String.fromCharCode(code);
    return null;
  };
  const widthOfCode = (code) => {
    const i = code - (d.firstChar || 0);
    if (d.widths && i >= 0 && i < d.widths.length && d.widths[i] != null) return d.widths[i] * scaleW;
    if (d.stdWidth) { const u = uniOf(code); const w = u ? d.stdWidth(u, names[code]) : null; if (w != null) return w; }
    return (d.missingWidth || 0) * scaleW;
  };
  model.widthOfCode = widthOfCode;
  model.decode = (bytes) => {
    const out = new Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) { const c = bytes[i]; out[i] = { code: c, len: 1, offset: i, w: widthOfCode(c), u: uniOf(c), space: c === 32 }; }
    return out;
  };
  // codifica inversa: Unicode → codice. Per font incorporati (spesso sottoinsiemi) solo codici con glifo certo.
  const inv = new Map();
  const usable = (code) => {
    if (isType3) return false;
    if (!d.embedded) return true; // font non incorporato: il lettore usa un font completo
    if (toUni.has(code)) return widthOfCode(code) > 0 || (d.seenCodes && d.seenCodes.has(code));
    return !!(d.seenCodes && d.seenCodes.has(code));
  };
  let invReady = false;
  const ensureInv = () => {
    if (invReady) return;
    invReady = true;
    for (let c = 0; c < 256; c++) {
      const u = uniOf(c);
      if (u && u.length === 1 && !inv.has(u) && usable(c)) inv.set(u, c);
    }
  };
  model.resetEncoding = () => { invReady = false; inv.clear(); };
  // lo spazio è indispensabile per scrivere frasi: se manca, niente codifica inversa
  model.encode = (text) => {
    if (isType3) return null;
    ensureInv();
    const out = [];
    for (const ch of text) {
      let code = inv.get(ch);
      if (code == null && ch === ' ') code = inv.get(' ');
      if (code == null) return null;
      out.push(code);
    }
    return Uint8Array.from(out);
  };
  model.encodable = (ch) => { ensureInv(); return inv.has(ch); };
  model.codeBytes = 1;
  return model;
}

const STD14 = /^(Times-(Roman|Bold|Italic|BoldItalic)|Helvetica(-Bold|-Oblique|-BoldOblique)?|Courier(-Bold|-Oblique|-BoldOblique)?|Symbol|ZapfDingbats)$/;

/** Famiglia standard più vicina: 'Helvetica' | 'Times' | 'Courier'. */
export function guessFamily(baseFont = '', flags = 0) {
  const n = baseFont.replace(/^[A-Z]{6}\+/, '');
  if (/courier|mono|consol|menlo|typewriter|cmtt|lucidaconsole|inconsolata|code/i.test(n)) return 'Courier';
  if (/times|roman|serif(?!.*sans)|georgia|garamond|cambria|book|minion|palatino|cmr|cmbx|cmti|lmroman|nimbusrom|liberationserif|baskerville|caslon|century|didot|bodoni|constantia/i.test(n) && !/sans/i.test(n)) return 'Times';
  if ((flags & 1) !== 0) return 'Courier';
  if ((flags & 2) !== 0 && !/sans|arial|helvet|verdana|tahoma|calibri|segoe/i.test(n)) return 'Times';
  return 'Helvetica';
}
