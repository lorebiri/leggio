// Esportazione/importazione dei dati di un modulo: JSON, CSV, FDF, XFDF.
// Logica pura (nessun DOM): i dati sono un oggetto { nomeCampo: valore }, dove valore è
// una stringa, un booleano (caselle) o un array di stringhe (elenchi a scelta multipla).

const MAX_INPUT = 20 * 1024 * 1024; // oltre 20 MB non è un file di dati di modulo

function guard(text) {
  if (typeof text !== 'string') throw new Error('Il file non contiene testo leggibile.');
  if (text.length > MAX_INPUT) throw new Error('Il file è troppo grande per essere un file di dati del modulo.');
  return text.replace(/^﻿/, '');
}

function normValue(v) {
  if (v == null) return '';
  if (typeof v === 'boolean') return v;
  if (Array.isArray(v)) return v.map((x) => String(x ?? ''));
  return String(v);
}

function clean(data) {
  const out = {};
  for (const [k, v] of Object.entries(data || {})) if (k) out[k] = normValue(v);
  return out;
}

// ---------------- JSON ----------------
export function toJSON(data, meta = {}) {
  return JSON.stringify({ formato: 'leggio-dati-modulo', versione: 1, ...meta, campi: clean(data) }, null, 2);
}
export function parseJSON(text) {
  let o;
  const src = guard(text);
  try { o = JSON.parse(src); } catch (e) { throw new Error('Il file JSON non è valido: ' + e.message); }
  if (!o || typeof o !== 'object' || Array.isArray(o)) throw new Error('Il file JSON non contiene un elenco di campi.');
  const pick = o.campi && typeof o.campi === 'object' && !Array.isArray(o.campi) ? o.campi : o.fields && typeof o.fields === 'object' && !Array.isArray(o.fields) ? o.fields : o;
  const out = {};
  for (const [k, v] of Object.entries(pick)) {
    if (pick === o && ['formato', 'versione', 'documento'].includes(k)) continue;
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) continue; // valori annidati non supportati
    out[k] = normValue(v);
  }
  return out;
}

// ---------------- CSV ----------------
// Formato: prima riga nomi dei campi, righe seguenti valori (come Acrobat "Esporta dati").
// Separatore riconosciuto automaticamente (virgola, punto e virgola — comune in Italia — o tabulazione).
function csvCell(v, sep) {
  const s = typeof v === 'boolean' ? (v ? 'Sì' : 'No') : Array.isArray(v) ? v.join('|') : String(v);
  return /["\r\n]/.test(s) || s.includes(sep) || /^\s|\s$/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
export function toCSV(data, sep = ';') {
  const d = clean(data);
  const keys = Object.keys(d);
  return keys.map((k) => csvCell(k, sep)).join(sep) + '\r\n' + keys.map((k) => csvCell(d[k], sep)).join(sep) + '\r\n';
}
export function parseCSVRows(text) {
  const s = guard(text);
  const firstLine = s.split(/\r?\n/, 1)[0] || '';
  const count = (ch) => firstLine.split(ch).length - 1;
  const sep = count(';') > count(',') ? ';' : count('\t') > count(',') ? '\t' : ',';
  const rows = []; let row = []; let cell = ''; let q = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += c;
    } else if (c === '"' && cell === '') q = true;
    else if (c === sep) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c !== ''));
}
/** CSV → dati. rowIndex sceglie quale riga di valori usare (0 = la prima dopo l'intestazione). */
export function parseCSV(text, rowIndex = 0) {
  const rows = parseCSVRows(text);
  if (rows.length < 2) throw new Error('Il file CSV deve avere una riga con i nomi dei campi e almeno una riga di valori.');
  const head = rows[0]; const vals = rows[1 + rowIndex];
  if (!vals) throw new Error(`Il file CSV non ha la riga ${rowIndex + 1}.`);
  const out = {};
  head.forEach((k, i) => { const key = k.trim(); if (key) out[key] = vals[i] ?? ''; });
  return out;
}

// ---------------- FDF ----------------
function pdfStr(s) {
  // stringa letterale PDF; se non ASCII usa UTF-16BE con BOM in esadecimale
  if (/^[\x20-\x7e]*$/.test(s)) return '(' + s.replace(/[\\()]/g, (c) => '\\' + c) + ')';
  let hex = 'FEFF';
  for (const ch of s) {
    const cp = ch.codePointAt(0);
    if (cp > 0xffff) { const v = cp - 0x10000; hex += (0xd800 + (v >> 10)).toString(16).padStart(4, '0') + (0xdc00 + (v & 0x3ff)).toString(16).padStart(4, '0'); }
    else hex += cp.toString(16).padStart(4, '0');
  }
  return '<' + hex.toUpperCase() + '>';
}

export function toFDF(data, pdfFileName) {
  const d = clean(data);
  const fields = Object.entries(d).map(([k, v]) => {
    let val;
    if (typeof v === 'boolean') val = v ? '/Yes' : '/Off';
    else if (Array.isArray(v)) val = '[' + v.map(pdfStr).join(' ') + ']';
    else val = pdfStr(v);
    return `<< /T ${pdfStr(k)} /V ${val} >>`;
  });
  return `%FDF-1.2\n%\xe2\xe3\xcf\xd3\n1 0 obj\n<< /FDF << /Fields [\n${fields.join('\n')}\n]${pdfFileName ? ` /F ${pdfStr(pdfFileName)}` : ''} >> >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n`;
}

function decodeBytes(b) {
  if (b.charCodeAt(0) === 0xfe && b.charCodeAt(1) === 0xff) {
    let s = '';
    for (let k = 2; k + 1 < b.length; k += 2) s += String.fromCharCode((b.charCodeAt(k) << 8) | b.charCodeAt(k + 1));
    return s;
  }
  if (/[\xc0-\xf4][\x80-\xbf]/.test(b)) { try { return decodeURIComponent(escape(b)); } catch {} }
  return b;
}

// Mini-lettore della sintassi PDF sufficiente per i file FDF.
function fdfReader(src) {
  let i = 0;
  const DELIM = /[\s/()<>[\]{}%]/;
  const ws = () => { while (i < src.length) { const c = src[i]; if (c === '%') { while (i < src.length && src[i] !== '\n' && src[i] !== '\r') i++; } else if (/\s/.test(c)) i++; else break; } };
  function literal() {
    i++; let depth = 1; let out = '';
    while (i < src.length && depth > 0) {
      const c = src[i++];
      if (c === '\\') {
        const n = src[i++];
        const map = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', '(': '(', ')': ')', '\\': '\\' };
        if (n in map) out += map[n];
        else if (/[0-7]/.test(n)) { let o = n; while (o.length < 3 && /[0-7]/.test(src[i])) o += src[i++]; out += String.fromCharCode(parseInt(o, 8) & 0xff); }
        else if (n === '\r') { if (src[i] === '\n') i++; }
        else if (n !== '\n' && n !== undefined) out += n;
      } else if (c === '(') { depth++; out += c; }
      else if (c === ')') { depth--; if (depth) out += c; }
      else out += c;
    }
    return decodeBytes(out);
  }
  function hex() {
    i++; let hx = '';
    while (i < src.length && src[i] !== '>') { if (/[0-9a-fA-F]/.test(src[i])) hx += src[i]; i++; }
    i++;
    if (hx.length % 2) hx += '0';
    let bytes = '';
    for (let k = 0; k < hx.length; k += 2) bytes += String.fromCharCode(parseInt(hx.slice(k, k + 2), 16));
    return decodeBytes(bytes);
  }
  function value(depth = 0) {
    if (depth > 64) throw new Error('Il file FDF è annidato in modo anomalo.');
    ws();
    const c = src[i];
    if (c === undefined) return undefined;
    if (c === '(') return { s: literal() };
    if (c === '<' && src[i + 1] === '<') {
      i += 2; const d = {};
      for (;;) {
        ws();
        if (i >= src.length) break;
        if (src[i] === '>' && src[i + 1] === '>') { i += 2; break; }
        const k = value(depth + 1);
        if (k === undefined) break;
        if (k.n === undefined) continue;
        d[k.n] = value(depth + 1);
      }
      return { d };
    }
    if (c === '<') return { s: hex() };
    if (c === '[') {
      i++; const a = [];
      for (;;) { ws(); if (i >= src.length) break; if (src[i] === ']') { i++; break; } const v = value(depth + 1); if (v === undefined) break; a.push(v); }
      return { a };
    }
    if (c === '/') {
      i++; let n = '';
      while (i < src.length && !DELIM.test(src[i])) n += src[i++];
      return { n: n.replace(/#([0-9a-fA-F]{2})/g, (_, x) => String.fromCharCode(parseInt(x, 16))) };
    }
    let w = '';
    while (i < src.length && !DELIM.test(src[i])) w += src[i++];
    if (!w) { i++; return { k: '' }; }
    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(w)) return { num: parseFloat(w) };
    return { k: w };
  }
  return { value, seek(p) { i = p; } };
}

export function parseFDF(text) {
  const src = guard(text);
  const at = src.indexOf('/Fields');
  if (!src.trimStart().startsWith('%FDF') && at < 0) throw new Error('Il file non è un FDF valido (manca l\'intestazione %FDF).');
  if (at < 0) return {};
  const r = fdfReader(src); r.seek(at + 7);
  const arr = r.value();
  if (!arr || !arr.a) throw new Error('Il file FDF non contiene un elenco di campi leggibile.');
  const out = {};
  const walk = (list, prefix, depth) => {
    if (depth > 32) return;
    for (const f of list) {
      if (!f || !f.d) continue;
      const name = f.d.T?.s ?? '';
      const full = prefix ? (name ? prefix + '.' + name : prefix) : name;
      if (f.d.Kids?.a) walk(f.d.Kids.a, full, depth + 1);
      const v = f.d.V;
      if (v === undefined || !full) continue;
      if (v.s !== undefined) out[full] = v.s;
      else if (v.n !== undefined) out[full] = v.n === 'Off' ? false : v.n === 'Yes' ? true : v.n;
      else if (v.a) out[full] = v.a.map((x) => x.s ?? x.n ?? '');
      else if (v.num !== undefined) out[full] = String(v.num);
    }
  };
  walk(arr.a, '', 0);
  return out;
}

// ---------------- XFDF ----------------
function xmlEsc(s) { return String(s).replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c])); }
function xmlUnesc(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|lt|gt|amp|quot|apos);/gi, (_, e) => {
    if (e[0] === '#') { const cp = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); try { return String.fromCodePoint(cp); } catch { return ''; } }
    return { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" }[e.toLowerCase()];
  });
}

export function toXFDF(data, pdfFileName) {
  const d = clean(data);
  const fields = Object.entries(d).map(([k, v]) => {
    const vals = typeof v === 'boolean' ? [v ? 'Yes' : 'Off'] : Array.isArray(v) ? v : [v];
    return `    <field name="${xmlEsc(k)}">${vals.map((x) => `<value>${xmlEsc(x)}</value>`).join('')}</field>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<xfdf xmlns="http://ns.adobe.com/xfdf/" xml:space="preserve">\n  <fields>\n${fields.join('\n')}\n  </fields>\n${pdfFileName ? `  <f href="${xmlEsc(pdfFileName)}"/>\n` : ''}</xfdf>\n`;
}

export function parseXFDF(text) {
  const src = guard(text);
  if (!/<xfdf[\s>]/i.test(src)) throw new Error('Il file non è un XFDF valido (manca l\'elemento <xfdf>).');
  const out = {};
  const stack = [];
  const re = /<(\/?)(field|value)\b([^>]*?)(\/?)>/gi;
  let m; let valueStart = -1;
  const parentName = () => stack.map((s) => s.name).filter(Boolean).join('.');
  while ((m = re.exec(src))) {
    const [, close, tag, attrs, selfClose] = m;
    const t = tag.toLowerCase();
    if (t === 'field') {
      if (close) {
        const f = stack.pop();
        if (f && f.values.length) { const p = parentName(); out[p ? p + '.' + f.name : f.name] = f.values.length > 1 ? f.values : f.values[0]; }
      } else if (!selfClose) {
        const nm = /name\s*=\s*"([^"]*)"|name\s*=\s*'([^']*)'/.exec(attrs);
        stack.push({ name: xmlUnesc(nm ? nm[1] ?? nm[2] : ''), values: [] });
        if (stack.length > 64) throw new Error('Il file XFDF è annidato in modo anomalo.');
      }
    } else if (t === 'value') {
      if (!close && !selfClose) valueStart = re.lastIndex;
      else if (close && valueStart >= 0) {
        let raw = src.slice(valueStart, m.index);
        const cd = /^\s*<!\[CDATA\[([\s\S]*)\]\]>\s*$/.exec(raw);
        raw = cd ? cd[1] : xmlUnesc(raw.replace(/<[^>]+>/g, ''));
        stack[stack.length - 1]?.values.push(raw);
        valueStart = -1;
      } else if (selfClose) stack[stack.length - 1]?.values.push('');
    }
  }
  return out;
}

/** Riconosce il formato dal nome o dal contenuto. */
export function detectFormat(fileName = '', text = '') {
  const ext = (String(fileName).match(/\.([a-z0-9]+)$/i)?.[1] || '').toLowerCase();
  if (['json', 'csv', 'fdf', 'xfdf'].includes(ext)) return ext;
  if (ext === 'txt' || ext === 'tsv') return 'csv';
  const s = String(text).replace(/^﻿/, '').trimStart();
  if (s.startsWith('%FDF')) return 'fdf';
  if (s.startsWith('<')) return 'xfdf';
  if (s.startsWith('{')) return 'json';
  return 'csv';
}

export function parseAny(text, fileName) {
  const f = detectFormat(fileName, text);
  return { format: f, data: { json: parseJSON, csv: parseCSV, fdf: parseFDF, xfdf: parseXFDF }[f](text) };
}

export function serialize(format, data, pdfFileName) {
  switch (format) {
    case 'json': return toJSON(data, pdfFileName ? { documento: pdfFileName } : {});
    case 'csv': return toCSV(data);
    case 'fdf': return toFDF(data, pdfFileName);
    case 'xfdf': return toXFDF(data, pdfFileName);
    default: throw new Error('Formato non supportato: ' + format);
  }
}

/** Testo → byte. FDF in Latin-1 (le stringhe non ASCII sono già in esadecimale), il resto in UTF-8. */
export function textToBytes(s, format) {
  if (format === 'fdf') { const b = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 0xff; return b; }
  return new TextEncoder().encode(s);
}
/** Byte di un file → testo: UTF-8 se valido, altrimenti Latin-1 (FDF binari). */
export function bytesToText(bytes) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { let s = ''; for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192)); return s; }
}
