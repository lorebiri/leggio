// Esportazione dei risultati della ricerca: CSV per Excel in italiano («;», virgola decimale) e
// cartella di lavoro Excel (.xlsx) scritta a mano (ZIP senza compressione + SpreadsheetML),
// senza librerie aggiuntive. Logica pura.
import { TIPO_LABEL } from './estrai.js';
import { descrivi } from './stati.js';

/** Colonne del registro (utile per controlli e rendicontazione). */
export const COLONNE_REGISTRO = [
  { id: 'tipo', titolo: 'Tipo', val: (r) => TIPO_LABEL[r.tipo] || r.tipo || '' },
  { id: 'protocollo', titolo: 'N. protocollo', val: (r) => (r.stato?.protocollo === 'fatto' ? r.stato.numeroProtocollo || '' : '') },
  { id: 'data_protocollo', titolo: 'Data protocollo', tipo: 'data', val: (r) => (r.stato?.protocollo === 'fatto' ? r.stato.dataProtocollo || '' : '') },
  { id: 'uor', titolo: 'UOR', val: (r) => (r.stato?.protocollo === 'fatto' ? r.stato.uorProtocollo || '' : '') },
  { id: 'origine_protocollo', titolo: 'Origine protocollo', val: (r) => (r.stato?.protocollo !== 'fatto' ? '' : r.stato.origineProtocollo === 'documento' ? 'letto dal documento' : r.stato.origineProtocollo === 'segnatura' ? 'segnatura su copia' : 'inserito a mano') },
  { id: 'data', titolo: 'Data', tipo: 'data', val: (r) => r.data || '' },
  { id: 'numero', titolo: 'Numero', val: (r) => r.numero || '' },
  { id: 'fornitore', titolo: 'Fornitore', val: (r) => r.fornitore || '' },
  { id: 'piva', titolo: 'P.IVA', val: (r) => r.piva || '' },
  { id: 'cf', titolo: 'Codice fiscale', val: (r) => r.cf || '' },
  { id: 'importo', titolo: 'Importo (€)', tipo: 'euro', val: (r) => (r.importo == null ? null : r.importo) },
  { id: 'cig', titolo: 'CIG', val: (r) => (r.cig || []).join(' ') },
  { id: 'cup', titolo: 'CUP', val: (r) => (r.cup || []).join(' ') },
  { id: 'scadenza', titolo: 'Scadenza', tipo: 'data', val: (r) => r.scadenza || '' },
  { id: 'stato', titolo: 'Stato', val: (r) => descrivi(r.stato).filter((c) => c.tipo !== 'etichetta').map((c) => c.testo).join(', ') },
  { id: 'etichette', titolo: 'Etichette', val: (r) => (r.stato?.etichette || []).join(', ') },
  { id: 'nota', titolo: 'Nota', val: (r) => r.stato?.nota || '' },
  { id: 'firme', titolo: 'Firme', tipo: 'numero', val: (r) => r.firme || 0 },
  { id: 'pagine', titolo: 'Pagine', tipo: 'numero', val: (r) => r.pagine ?? null },
  { id: 'nome', titolo: 'Nome del file', val: (r) => r.nome || '' },
  { id: 'percorso', titolo: 'Percorso', val: (r) => r.path || r.rel || '' },
  { id: 'impronta', titolo: 'Impronta (SHA-256)', val: (r) => r.impronta || '' },
];

const dataIt = (iso) => { const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[3]}/${m[2]}/${m[1]}` : ''; };
const cellaCsv = (s) => { s = String(s ?? ''); return /[;"\r\n]/.test(s) || /^[=+\-@\t]/.test(s) ? `"${(/^[=+\-@\t]/.test(s) ? "'" : '') + s.replace(/"/g, '""')}"` : s; };

/** CSV per Excel italiano. */
export function registroCsv(righe, colonne = COLONNE_REGISTRO) {
  const out = [colonne.map((c) => cellaCsv(c.titolo)).join(';')];
  for (const r of righe) {
    out.push(colonne.map((c) => {
      const v = c.val(r);
      if (c.tipo === 'data') return dataIt(v);
      if (c.tipo === 'euro') return v == null ? '' : v.toFixed(2).replace('.', ',');
      if (c.tipo === 'numero') return v == null ? '' : String(v);
      return cellaCsv(v);
    }).join(';'));
  }
  return '﻿' + out.join('\r\n') + '\r\n';
}

// ---------------- XLSX ----------------

const xmlEsc = (s) => String(s ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function colonna(n) { let s = ''; n++; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; }
/** Data ISO → numero di serie di Excel (sistema 1900). */
export function serialeExcel(iso) {
  const t = Date.parse(String(iso).slice(0, 10) + 'T00:00:00Z');
  return Number.isFinite(t) ? t / 86400000 + 25569 : null;
}

function foglio(righe, colonne) {
  const rows = [];
  rows.push(`<row r="1">${colonne.map((c, i) => `<c r="${colonna(i)}1" t="inlineStr" s="1"><is><t>${xmlEsc(c.titolo)}</t></is></c>`).join('')}</row>`);
  righe.forEach((r, k) => {
    const n = k + 2;
    const cells = colonne.map((c, i) => {
      const ref = `${colonna(i)}${n}`; const v = c.val(r);
      if (v == null || v === '') return '';
      if (c.tipo === 'data') { const s = serialeExcel(v); return s == null ? '' : `<c r="${ref}" s="2"><v>${s}</v></c>`; }
      if (c.tipo === 'euro') return `<c r="${ref}" s="3"><v>${Number(v)}</v></c>`;
      if (c.tipo === 'numero') return `<c r="${ref}"><v>${Number(v)}</v></c>`;
      return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xmlEsc(String(v).slice(0, 32000))}</t></is></c>`;
    }).join('');
    rows.push(`<row r="${n}">${cells}</row>`);
  });
  const larghezze = colonne.map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.tipo === 'data' ? 12 : c.tipo === 'euro' ? 14 : ['fornitore', 'nome', 'percorso', 'nota'].includes(c.id) ? 36 : c.id === 'origine_protocollo' ? 20 : c.id === 'impronta' ? 30 : 16}" customWidth="1"/>`).join('');
  const ultima = `${colonna(colonne.length - 1)}${righe.length + 1}`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${larghezze}</cols><sheetData>${rows.join('')}</sheetData><autoFilter ref="A1:${ultima}"/></worksheet>`;
}

const STILI = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="2"><numFmt numFmtId="164" formatCode="dd/mm/yyyy"/><numFmt numFmtId="165" formatCode="#,##0.00"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

/** Cartella di lavoro Excel con un foglio «Registro». → Uint8Array */
export function registroXlsx(righe, colonne = COLONNE_REGISTRO, { titolo = 'Registro' } = {}) {
  const nomeFoglio = xmlEsc(String(titolo).replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || 'Registro');
  const files = [
    ['[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`],
    ['_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`],
    ['docProps/core.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${nomeFoglio}</dc:title><dc:creator>Leggio</dc:creator></cp:coreProperties>`],
    ['xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${nomeFoglio}" sheetId="1" r:id="rId1"/></sheets><definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">'${nomeFoglio.replace(/'/g, "''")}'!$A$1:$${colonna(colonne.length - 1)}$${righe.length + 1}</definedName></definedNames></workbook>`],
    ['xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`],
    ['xl/styles.xml', STILI],
    ['xl/worksheets/sheet1.xml', foglio(righe, colonne)],
  ];
  return zipSenzaCompressione(files.map(([n, t]) => [n, new TextEncoder().encode(t)]));
}

// ---------------- ZIP (solo «stored») ----------------
let CRC;
function crc32(b) {
  if (!CRC) { CRC = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; CRC[n] = c >>> 0; } }
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** files: [[nome, Uint8Array]] → Uint8Array dell'archivio ZIP */
export function zipSenzaCompressione(files) {
  const enc = new TextEncoder();
  const parti = []; const centrale = []; let off = 0;
  const d = new Date(); const dosT = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1); const dosD = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  for (const [nome, dati] of files) {
    const n = enc.encode(nome); const crc = crc32(dati);
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true);
    h.setUint16(10, dosT, true); h.setUint16(12, dosD, true); h.setUint32(14, crc, true); h.setUint32(18, dati.length, true); h.setUint32(22, dati.length, true);
    h.setUint16(26, n.length, true); h.setUint16(28, 0, true);
    parti.push(new Uint8Array(h.buffer), n, dati);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, 0, true);
    c.setUint16(12, dosT, true); c.setUint16(14, dosD, true); c.setUint32(16, crc, true); c.setUint32(20, dati.length, true); c.setUint32(24, dati.length, true);
    c.setUint16(28, n.length, true); c.setUint32(42, off, true);
    centrale.push(new Uint8Array(c.buffer), n);
    off += 30 + n.length + dati.length;
  }
  const lenC = centrale.reduce((s, x) => s + x.length, 0);
  const e = new DataView(new ArrayBuffer(22));
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, lenC, true); e.setUint32(16, off, true);
  const tutte = [...parti, ...centrale, new Uint8Array(e.buffer)];
  const out = new Uint8Array(tutte.reduce((s, x) => s + x.length, 0));
  let p = 0; for (const x of tutte) { out.set(x, p); p += x.length; }
  return out;
}
