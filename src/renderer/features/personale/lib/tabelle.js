// Lettura di tabelle da file: CSV (separatore riconosciuto da solo) ed Excel .xlsx, senza dipendenze.
// L'xlsx è uno ZIP di file XML: lo si apre con DecompressionStream('deflate-raw') (Chromium/Electron e
// Node ≥ 18). Logica pura, niente DOM (l'XML si legge con espressioni regolari: i fogli sono regolari).
import { parseCSVRows } from '../../moduli/lib/formdata.js';

const MAX_FILE = 50 * 1024 * 1024;
const MAX_RIGHE = 100000;
const dec = new TextDecoder('utf-8');

// ------------------------------------------------------------------------------ ZIP
function u16(b, o) { return b[o] | (b[o + 1] << 8); }
function u32(b, o) { return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0; }

/** Indice di uno ZIP (directory centrale). → Map(nome → { metodo, compresso, offset, dimensione }) */
export function indiceZip(bytes) {
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (bytes[i] === 0x50 && bytes[i + 1] === 0x4b && bytes[i + 2] === 0x05 && bytes[i + 3] === 0x06) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Il file non è un archivio Excel valido (.xlsx).');
  const n = u16(bytes, eocd + 10);
  let p = u32(bytes, eocd + 16);
  const out = new Map();
  for (let k = 0; k < n; k++) {
    if (u32(bytes, p) !== 0x02014b50) throw new Error('File Excel danneggiato.');
    const metodo = u16(bytes, p + 10);
    const compresso = u32(bytes, p + 20);
    const dimensione = u32(bytes, p + 24);
    const ln = u16(bytes, p + 28); const le = u16(bytes, p + 30); const lc = u16(bytes, p + 32);
    const offset = u32(bytes, p + 42);
    const nome = dec.decode(bytes.subarray(p + 46, p + 46 + ln));
    out.set(nome, { metodo, compresso, offset, dimensione });
    p += 46 + ln + le + lc;
  }
  return out;
}
async function inflateRaw(data) {
  if (typeof DecompressionStream === 'undefined') throw new Error('Questo sistema non sa leggere i file Excel: salvalo come CSV.');
  const ds = new DecompressionStream('deflate-raw');
  const stream = new Blob([data]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
/** Contenuto di un file dello ZIP. → Uint8Array | null */
export async function leggiDaZip(bytes, indice, nome) {
  const e = indice.get(nome);
  if (!e) return null;
  if (u32(bytes, e.offset) !== 0x04034b50) throw new Error('File Excel danneggiato.');
  const start = e.offset + 30 + u16(bytes, e.offset + 26) + u16(bytes, e.offset + 28);
  const raw = bytes.subarray(start, start + e.compresso);
  if (e.metodo === 0) return raw;
  if (e.metodo === 8) return inflateRaw(raw);
  throw new Error('Il file Excel usa una compressione non supportata: salvalo di nuovo da Excel o come CSV.');
}

// ------------------------------------------------------------------------------ XML minimo
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
export function xmlTesto(s) {
  return String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') { const cp = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); try { return String.fromCodePoint(cp); } catch { return m; } }
    return ENT[e] ?? m;
  });
}
const attr = (tag, nome) => { const m = new RegExp(`\\s${nome}="([^"]*)"`).exec(tag); return m ? xmlTesto(m[1]) : null; };
/** Testo di un elemento <si>/<is> (anche rich text: più <t>). */
function testoRich(x) {
  let s = ''; const re = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>|<t\s*\/>/g; let m;
  // esclude il testo fonetico <rPh>
  const pulito = x.replace(/<rPh[\s\S]*?<\/rPh>/g, '');
  while ((m = re.exec(pulito))) s += m[1] ? xmlTesto(m[1]) : '';
  return s;
}
function colonna(ref) { let n = 0; for (const ch of ref) { const c = ch.charCodeAt(0); if (c < 65 || c > 90) break; n = n * 26 + (c - 64); } return n - 1; }

// formati numerici Excel che sono date
const DATE_BUILTIN = new Set([14, 15, 16, 17, 22, 27, 30, 36, 50, 57]);
const ORE_BUILTIN = new Set([18, 19, 20, 21, 45, 46, 47]);
function eFormatoData(code) {
  const c = String(code).replace(/"[^"]*"|\\.|\[[^\]]*\]/g, '');
  return /[dy]/i.test(c) || (/m/i.test(c) && !/[hs]/i.test(c) && /[d|y]/i.test(c));
}
/** Numero seriale di Excel → gg/mm/aaaa (sistema 1900). */
export function dataExcel(seriale, sistema1904 = false) {
  const giorni = Math.floor(seriale) + (sistema1904 ? 1462 : 0);
  const d = new Date(Date.UTC(1899, 11, 30) + giorni * 86400000);
  return `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`;
}
function numeroTesto(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v);
  // interi lunghi (codici, telefoni) senza notazione esponenziale
  if (Number.isInteger(n)) return Math.abs(n) >= 1e21 ? String(v) : BigInt(Math.round(n)).toString();
  return String(Math.round(n * 1e10) / 1e10).replace('.', ',');
}

/** Legge un .xlsx. → { fogli: [{ nome, righe: string[][] }] } */
export async function leggiXlsx(bytes) {
  if (bytes.length > MAX_FILE) throw new Error('Il file Excel è troppo grande (oltre 50 MB).');
  if (bytes[0] === 0xd0 && bytes[1] === 0xcf) throw new Error('Questo è un file Excel del vecchio formato (.xls): aprilo in Excel e salvalo come .xlsx oppure come CSV.');
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) throw new Error('Il file non è un file Excel (.xlsx) valido.');
  const idx = indiceZip(bytes);
  const txt = async (n) => { const b = await leggiDaZip(bytes, idx, n); return b ? dec.decode(b) : null; };
  const wb = await txt('xl/workbook.xml');
  if (!wb) throw new Error('Il file non contiene un foglio di calcolo Excel.');
  const rels = (await txt('xl/_rels/workbook.xml.rels')) || '';
  const relMap = new Map();
  for (const m of rels.matchAll(/<Relationship\b[^>]*>/g)) { const id = attr(m[0], 'Id'); const t = attr(m[0], 'Target'); if (id && t) relMap.set(id, t.replace(/^\/?(xl\/)?/, 'xl/')); }
  const sistema1904 = /date1904="(1|true)"/.test(wb);
  // stringhe condivise
  const sst = [];
  const ss = await txt('xl/sharedStrings.xml');
  if (ss) for (const m of ss.matchAll(/<si>([\s\S]*?)<\/si>|<si\/>/g)) sst.push(m[1] ? testoRich(m[1]) : '');
  // stili: quali indici sono date
  const dateStyle = new Set();
  const st = await txt('xl/styles.xml');
  if (st) {
    const custom = new Map();
    for (const m of st.matchAll(/<numFmt\b[^>]*>/g)) custom.set(Number(attr(m[0], 'numFmtId')), attr(m[0], 'formatCode') || '');
    const xfs = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(st);
    if (xfs) {
      let i = 0;
      for (const m of xfs[1].matchAll(/<xf\b[^>]*\/?>/g)) {
        const id = Number(attr(m[0], 'numFmtId') || 0);
        if (DATE_BUILTIN.has(id) || (custom.has(id) && eFormatoData(custom.get(id)))) dateStyle.add(i);
        else if (ORE_BUILTIN.has(id)) dateStyle.add(-1 - i);
        i++;
      }
    }
  }
  const fogli = [];
  for (const m of wb.matchAll(/<sheet\b[^>]*\/?>/g)) {
    const nome = attr(m[0], 'name') || 'Foglio';
    const rid = attr(m[0], 'r:id') || attr(m[0], 'id');
    const target = relMap.get(rid) || `xl/worksheets/sheet${fogli.length + 1}.xml`;
    const xml = await txt(target);
    if (!xml) continue;
    const righe = [];
    for (const r of xml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>|<row\b[^>]*\/>/g)) {
      if (righe.length >= MAX_RIGHE) break;
      const rn = Number(attr(r[0], 'r')) || righe.length + 1;
      const riga = [];
      let auto = 0;
      for (const c of (r[2] || '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const tag = '<c' + c[1] + '>';
        const ref = attr(tag, 'r');
        const ci = ref ? colonna(ref) : auto;
        auto = ci + 1;
        const t = attr(tag, 't') || 'n';
        const s = Number(attr(tag, 's') || 0);
        const body = c[2] || '';
        const vm = /<v>([\s\S]*?)<\/v>/.exec(body);
        const v = vm ? xmlTesto(vm[1]) : '';
        let out = '';
        if (t === 's') out = sst[Number(v)] ?? '';
        else if (t === 'inlineStr') { const im = /<is>([\s\S]*?)<\/is>/.exec(body); out = im ? testoRich(im[1]) : ''; }
        else if (t === 'str') out = v;
        else if (t === 'b') out = v === '1' ? 'VERO' : 'FALSO';
        else if (t === 'e') out = '';
        else if (t === 'd') { const d = /^(\d{4})-(\d{2})-(\d{2})/.exec(v); out = d ? `${d[3]}/${d[2]}/${d[1]}` : v; }
        else if (v !== '') out = dateStyle.has(s) ? dataExcel(Number(v), sistema1904) : numeroTesto(v);
        riga[ci] = out;
      }
      while (righe.length < rn - 1) righe.push([]);
      righe.push(Array.from(riga, (x) => x ?? ''));
    }
    fogli.push({ nome, righe });
  }
  return { fogli };
}

// ------------------------------------------------------------------------------ tabella unica
/**
 * Da righe grezze a tabella: la prima riga non vuota è l'intestazione; colonne senza nome → «Colonna N»;
 * nomi doppi resi unici. → { intestazioni: string[], righe: object[] (chiave = intestazione) }
 */
export function tabellaDaRighe(righe) {
  const piene = righe.filter((r) => Array.isArray(r) && r.some((c) => String(c ?? '').trim() !== ''));
  if (!piene.length) return { intestazioni: [], righe: [] };
  const [testa, ...corpo] = piene;
  const larghezza = Math.max(testa.length, ...corpo.map((r) => r.length));
  const visti = new Map();
  const intestazioni = Array.from({ length: larghezza }, (_, i) => {
    let n = String(testa[i] ?? '').replace(/\s+/g, ' ').trim() || `Colonna ${i + 1}`;
    const k = n.toLowerCase();
    if (visti.has(k)) { visti.set(k, visti.get(k) + 1); n = `${n} (${visti.get(k)})`; } else visti.set(k, 1);
    return n;
  });
  const out = corpo.slice(0, MAX_RIGHE).map((r) => Object.fromEntries(intestazioni.map((h, i) => [h, String(r[i] ?? '').trim()])));
  return { intestazioni, righe: out };
}

/** CSV (testo) → tabella. */
export function tabellaDaCsv(testo) { return tabellaDaRighe(parseCSVRows(String(testo || ''))); }

function testoDaByte(bytes) {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes);
  const s = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  // file salvati da Excel in Windows-1252: molti caratteri sostitutivi → si rilegge
  if ((s.match(/�/g) || []).length > 2) { try { return new TextDecoder('windows-1252').decode(bytes); } catch { /* */ } }
  return s;
}

/**
 * Tabella da un file scelto dall'utente ({ name, bytes }): CSV/TXT o XLSX. Per l'Excel si usa il primo
 * foglio con dati (o quello indicato). → { intestazioni, righe, fogli?: string[], foglio?: string }
 */
export async function tabellaDaFile({ name = '', bytes }, { foglio = null } = {}) {
  if (!bytes?.length) throw new Error('Il file è vuoto.');
  if (bytes.length > MAX_FILE) throw new Error('Il file è troppo grande (oltre 50 MB).');
  const ext = String(name).toLowerCase().split('.').pop();
  if (ext === 'xlsx' || ext === 'xlsm' || (bytes[0] === 0x50 && bytes[1] === 0x4b)) {
    const { fogli } = await leggiXlsx(bytes);
    const scelto = (foglio && fogli.find((f) => f.nome === foglio)) || fogli.find((f) => f.righe.some((r) => r.some((c) => c))) || fogli[0];
    if (!scelto) throw new Error('Il file Excel non contiene fogli.');
    return { ...tabellaDaRighe(scelto.righe), fogli: fogli.map((f) => f.nome), foglio: scelto.nome };
  }
  if (ext === 'xls') throw new Error('Questo è un file Excel del vecchio formato (.xls): aprilo in Excel e salvalo come .xlsx oppure come CSV.');
  if (ext === 'ods') throw new Error('I fogli di LibreOffice (.ods) non si leggono direttamente: salvalo come .xlsx oppure come CSV.');
  return tabellaDaCsv(testoDaByte(bytes));
}

/** Testo CSV (separatore «;», come lo apre Excel in italiano) da intestazioni e righe-oggetto. */
export function csvDaTabella(intestazioni, righe, sep = ';') {
    // le celle che Excel prenderebbe per formule («=…», «@…», «+A1») si proteggono con un apostrofo
  const formula = (s) => /^(=|@|[+-][^\d\s])/.test(s);
  const cella = (v) => { const s = v == null ? '' : String(v); return /["\r\n]/.test(s) || s.includes(sep) || /^\s|\s$/.test(s) || formula(s) ? '"' + (formula(s) ? "'" : '') + s.replace(/"/g, '""') + '"' : s; };
  return '﻿' + [intestazioni.map(cella).join(sep), ...righe.map((r) => intestazioni.map((h) => cella(r[h])).join(sep))].join('\r\n') + '\r\n';
}
