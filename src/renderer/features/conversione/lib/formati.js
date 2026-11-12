// Scrittori di formati d'uscita (logica pura): CSV, Excel (.xlsx), PowerPoint (.pptx), OpenDocument (.odt), HTML.
import { zip } from './zip.js';

export const escXml = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
  // caratteri non ammessi in XML 1.0
  .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, '');

/**
 * Riconosce un numero scritto all'italiana (1.234,56 · -12 · 3,5% · € 1.234,56 · (1.234,56)).
 * → { value, kind: 'number'|'percent'|'currency', decimals } oppure null se non è un numero.
 */
export function numeroItaliano(raw) {
  let s = String(raw ?? '').trim();
  if (!s || s.length > 40) return null;
  let neg = false; let kind = 'number';
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1).trim(); }
  if (/^[€$£]|[€$£]$|\bEUR\b/i.test(s)) { kind = 'currency'; s = s.replace(/[€$£]|\bEUR\b/gi, '').trim(); }
  if (/%$/.test(s)) { kind = 'percent'; s = s.slice(0, -1).trim(); }
  if (/^[-−–]/.test(s)) { neg = !neg; s = s.slice(1).trim(); }
  if (/^\+/.test(s)) s = s.slice(1).trim();
  s = s.replace(/[\s  ']/g, (c) => (c === "'" ? '.' : '')); // 1 234,56 e 1'234,56
  let num;
  let decimals = 0;
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s) || /^\d+(,\d+)?$/.test(s)) {
    // italiano: punto per le migliaia, virgola per i decimali
    decimals = s.includes(',') ? s.split(',')[1].length : 0;
    num = Number(s.replace(/\./g, '').replace(',', '.'));
  } else if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s) || /^\d+\.\d+$/.test(s)) {
    // inglese: 1,234.56 oppure 12.5
    decimals = s.includes('.') ? s.split('.')[1].length : 0;
    num = Number(s.replace(/,/g, ''));
  } else return null;
  if (!Number.isFinite(num)) return null;
  // codici con zeri iniziali (CAP, codici articolo) restano testo
  if (/^0\d/.test(s.replace(/[.,].*$/, '')) && kind === 'number') return null;
  if (neg) num = -num;
  if (kind === 'percent') num /= 100;
  return { value: num, kind, decimals };
}

/** CSV con separatore (predefinito «;», come Excel in italiano) e BOM UTF-8. */
export function csv(rows, { sep = ';', bom = true } = {}) {
  const q = (v) => {
    const s = String(v ?? '');
    return /["\n\r]/.test(s) || s.includes(sep) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  return (bom ? '﻿' : '') + rows.map((r) => r.map(q).join(sep)).join('\r\n') + '\r\n';
}

/** Testo separato da tabulazioni (per incollare in Excel). */
export function tsv(rows) {
  return rows.map((r) => r.map((v) => String(v ?? '').replace(/[\t\r\n]+/g, ' ')).join('\t')).join('\n');
}

function colName(i) {
  let s = '';
  for (i += 1; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s;
  return s;
}

function sheetName(n, used) {
  let s = String(n || 'Foglio').replace(/[\\/?*[\]:]/g, ' ').trim().slice(0, 31) || 'Foglio';
  let k = 2; const base = s;
  while (used.has(s.toLowerCase())) s = (base.slice(0, 28) + ' ' + k++).slice(0, 31);
  used.add(s.toLowerCase());
  return s;
}

/**
 * Cartella di lavoro Excel. sheets: [{ name, rows: [[valore]], headerRows=1 }]
 * I numeri all'italiana diventano numeri veri (con formato migliaia/decimali, percentuali, euro).
 */
export function xlsx(sheets, { numeri = true } = {}) {
  const used = new Set();
  const files = [];
  const sh = sheets.length ? sheets : [{ name: 'Foglio1', rows: [] }];
  const names = sh.map((s) => sheetName(s.name, used));
  sh.forEach((s, si) => {
    const head = s.headerRows ?? 1;
    let maxC = 0;
    const rowsXml = s.rows.map((r, ri) => {
      maxC = Math.max(maxC, r.length);
      const cells = r.map((v, ci) => {
        const ref = colName(ci) + (ri + 1);
        if (v == null || v === '') return '';
        const n = numeri && ri >= head ? numeroItaliano(v) : null;
        if (typeof v === 'number' || n) {
          const val = typeof v === 'number' ? v : n.value;
          const style = typeof v === 'number' ? 0 : n.kind === 'percent' ? 3 : n.kind === 'currency' ? 4 : n.decimals > 0 ? 2 : 5;
          return `<c r="${ref}" s="${style}"><v>${val}</v></c>`;
        }
        return `<c r="${ref}" t="inlineStr"${ri < head ? ' s="1"' : ''}><is><t xml:space="preserve">${escXml(v)}</t></is></c>`;
      }).join('');
      return `<row r="${ri + 1}">${cells}</row>`;
    }).join('');
    const cols = maxC ? `<cols><col min="1" max="${maxC}" width="18" customWidth="1"/></cols>` : '';
    files.push({ name: `xl/worksheets/sheet${si + 1}.xml`, data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${cols}<sheetData>${rowsXml}</sheetData></worksheet>` });
  });
  const ct = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sh.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`;
  const rels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>';
  const wb = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names.map((n, i) => `<sheet name="${escXml(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`;
  const wbRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sh.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sh.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
  // stili: 0 normale · 1 grassetto (intestazioni) · 2 #.##0,00 · 3 0,00% · 4 euro · 5 #.##0
  const styles = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0.00\\ &quot;€&quot;"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="6"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="4" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="10" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';
  return zip([
    { name: '[Content_Types].xml', data: ct },
    { name: '_rels/.rels', data: rels },
    { name: 'xl/workbook.xml', data: wb },
    { name: 'xl/_rels/workbook.xml.rels', data: wbRels },
    { name: 'xl/styles.xml', data: styles },
    ...files,
  ]);
}

/**
 * Presentazione PowerPoint con un'immagine a tutta pagina per diapositiva.
 * slides: [{ data: Uint8Array, type: 'png'|'jpeg', wPt, hPt }]. La dimensione delle diapositive è quella della prima.
 */
export function pptx(slides, { title = 'Presentazione' } = {}) {
  if (!slides.length) throw new Error('Nessuna diapositiva');
  const EMU = 12700;
  const W = Math.round(slides[0].wPt * EMU); const H = Math.round(slides[0].hPt * EMU);
  const files = [];
  const ns = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
  slides.forEach((s, i) => {
    const n = i + 1; const ext = s.type === 'png' ? 'png' : 'jpeg';
    // adatta l'immagine alla diapositiva mantenendo le proporzioni
    const k = Math.min(W / (s.wPt * EMU), H / (s.hPt * EMU));
    const cw = Math.round(s.wPt * EMU * k); const chh = Math.round(s.hPt * EMU * k);
    const x = Math.round((W - cw) / 2); const y = Math.round((H - chh) / 2);
    files.push({ name: `ppt/media/image${n}.${ext}`, data: s.data });
    files.push({ name: `ppt/slides/slide${n}.xml`, data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<p:sld ${ns}><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/><p:pic><p:nvPicPr><p:cNvPr id="2" name="Pagina ${n}" descr="Pagina ${n}"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rId2"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${cw}" cy="${chh}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>` });
    files.push({ name: `ppt/slides/_rels/slide${n}.xml.rels`, data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image${n}.${ext}"/></Relationships>` });
  });
  const ct = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="jpeg" ContentType="image/jpeg"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/><Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/><Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>${slides.map((_, i) => `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join('')}</Types>`;
  const rels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>';
  const core = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${escXml(title)}</dc:title><dc:creator>Leggio</dc:creator></cp:coreProperties>`;
  const pres = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<p:presentation ${ns}><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst>${slides.map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 3}"/>`).join('')}</p:sldIdLst><p:sldSz cx="${W}" cy="${H}"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`;
  const presRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="theme/theme1.xml"/>${slides.map((_, i) => `<Relationship Id="rId${i + 3}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${i + 1}.xml"/>`).join('')}</Relationships>`;
  const emptyTree = '<p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld>';
  const master = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<p:sldMaster ${ns}>${emptyTree}<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst></p:sldMaster>`;
  const masterRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/></Relationships>';
  const layout = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<p:sldLayout ${ns} type="blank">${emptyTree}<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`;
  const layoutRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>';
  const clr = (n, v) => `<a:${n}><a:srgbClr val="${v}"/></a:${n}>`;
  const font = '<a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/>';
  const fill = '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>';
  const theme = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Leggio"><a:themeElements><a:clrScheme name="Leggio"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>${clr('dk2', '1F2937')}${clr('lt2', 'F3F4F6')}${clr('accent1', '0F766E')}${clr('accent2', 'C2410C')}${clr('accent3', '6D28D9')}${clr('accent4', 'B45309')}${clr('accent5', '0369A1')}${clr('accent6', '15803D')}${clr('hlink', '0563C1')}${clr('folHlink', '954F72')}</a:clrScheme><a:fontScheme name="Leggio"><a:majorFont>${font}</a:majorFont><a:minorFont>${font}</a:minorFont></a:fontScheme><a:fmtScheme name="Leggio"><a:fillStyleLst>${fill}${fill}${fill}</a:fillStyleLst><a:lnStyleLst><a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst>${fill}${fill}${fill}</a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>`;
  return zip([
    { name: '[Content_Types].xml', data: ct },
    { name: '_rels/.rels', data: rels },
    { name: 'docProps/core.xml', data: core },
    { name: 'ppt/presentation.xml', data: pres },
    { name: 'ppt/_rels/presentation.xml.rels', data: presRels },
    { name: 'ppt/slideMasters/slideMaster1.xml', data: master },
    { name: 'ppt/slideMasters/_rels/slideMaster1.xml.rels', data: masterRels },
    { name: 'ppt/slideLayouts/slideLayout1.xml', data: layout },
    { name: 'ppt/slideLayouts/_rels/slideLayout1.xml.rels', data: layoutRels },
    { name: 'ppt/theme/theme1.xml', data: theme },
    ...files,
  ]);
}

function runsXml(runs, fmt) {
  return (runs || []).map((r) => fmt(r)).join('');
}

/**
 * Documento OpenDocument (.odt) dai blocchi delle pagine. pages: [{ blocks, width, height }]
 */
export function odt(pages, { title = 'Documento' } = {}) {
  const span = (r) => {
    const t = escXml(r.text).replace(/\t/g, '<text:tab/>').replace(/ {2,}/g, (m) => ' <text:s text:c="' + (m.length - 1) + '"/>');
    const st = r.bold && r.italic ? 'TBI' : r.bold ? 'TB' : r.italic ? 'TI' : '';
    return st ? `<text:span text:style-name="${st}">${t}</text:span>` : t;
  };
  let body = '';
  pages.forEach((pg, pi) => {
    let first = true;
    for (const b of pg.blocks) {
      const brk = first && pi > 0;
      first = false;
      if (b.type === 'heading') body += `<text:h text:style-name="${brk ? 'HB' : 'H'}${Math.min(4, b.level)}" text:outline-level="${Math.min(4, b.level)}">${runsXml(b.runs, span) || escXml(b.text)}</text:h>`;
      else if (b.type === 'list') body += `<text:list text:style-name="${b.ordered ? 'LN' : 'LB'}"><text:list-item><text:p text:style-name="${brk ? 'PB' : 'P'}">${runsXml(b.runs, span) || escXml(b.text)}</text:p></text:list-item></text:list>`;
      else if (b.type === 'table') {
        const nc = Math.max(1, ...b.rows.map((r) => r.length));
        body += `${brk ? '<text:p text:style-name="PB"/>' : ''}<table:table table:style-name="Tab"><table:table-column table:number-columns-repeated="${nc}"/>${b.rows.map((r, ri) => `<table:table-row>${Array.from({ length: nc }, (_, c) => `<table:table-cell table:style-name="Cella" office:value-type="string"><text:p text:style-name="${ri === 0 ? 'TH' : 'P'}">${escXml(r[c] || '')}</text:p></table:table-cell>`).join('')}</table:table-row>`).join('')}</table:table>`;
      } else body += `<text:p text:style-name="${brk ? 'PB' : b.align === 'center' ? 'PC' : 'P'}">${runsXml(b.runs, span) || escXml(b.text)}</text:p>`;
    }
    if (!pg.blocks.length) body += `<text:p text:style-name="${pi > 0 ? 'PB' : 'P'}"/>`;
  });
  const w = (pages[0]?.width || 595) / 72 * 2.54; const h = (pages[0]?.height || 842) / 72 * 2.54;
  const heads = [1, 2, 3, 4].map((l) => {
    const size = [18, 15, 13, 12][l - 1];
    return `<style:style style:name="H${l}" style:family="paragraph" style:parent-style-name="Heading_20_${l}"><style:paragraph-properties fo:margin-top="0.3cm" fo:margin-bottom="0.15cm"/><style:text-properties fo:font-size="${size}pt" fo:font-weight="bold"/></style:style><style:style style:name="HB${l}" style:family="paragraph" style:parent-style-name="H${l}"><style:paragraph-properties fo:break-before="page"/></style:style>`;
  }).join('');
  const content = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" office:version="1.3"><office:automatic-styles>
<style:style style:name="P" style:family="paragraph"><style:paragraph-properties fo:margin-bottom="0.2cm"/></style:style>
<style:style style:name="PC" style:family="paragraph" style:parent-style-name="P"><style:paragraph-properties fo:text-align="center"/></style:style>
<style:style style:name="PB" style:family="paragraph" style:parent-style-name="P"><style:paragraph-properties fo:break-before="page"/></style:style>
<style:style style:name="TH" style:family="paragraph"><style:text-properties fo:font-weight="bold"/></style:style>
${heads}
<style:style style:name="TB" style:family="text"><style:text-properties fo:font-weight="bold"/></style:style>
<style:style style:name="TI" style:family="text"><style:text-properties fo:font-style="italic"/></style:style>
<style:style style:name="TBI" style:family="text"><style:text-properties fo:font-weight="bold" fo:font-style="italic"/></style:style>
<style:style style:name="Tab" style:family="table"><style:table-properties style:width="17cm" table:align="left"/></style:style>
<style:style style:name="Cella" style:family="table-cell"><style:table-cell-properties fo:padding="0.08cm" fo:border="0.5pt solid #808080"/></style:style>
<text:list-style style:name="LB"><text:list-level-style-bullet text:level="1" text:bullet-char="•"><style:list-level-properties text:list-level-position-and-space-mode="label-alignment"><style:list-level-label-alignment text:label-followed-by="listtab" fo:text-indent="-0.5cm" fo:margin-left="1cm"/></style:list-level-properties></text:list-level-style-bullet></text:list-style>
<text:list-style style:name="LN"><text:list-level-style-bullet text:level="1" text:bullet-char=" "><style:list-level-properties text:list-level-position-and-space-mode="label-alignment"><style:list-level-label-alignment text:label-followed-by="nothing" fo:margin-left="0.6cm"/></style:list-level-properties></text:list-level-style-bullet></text:list-style>
</office:automatic-styles><office:body><office:text>${body}</office:text></office:body></office:document-content>`;
  const styles = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-styles xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" office:version="1.3"><office:styles><style:default-style style:family="paragraph"><style:text-properties style:font-name="Liberation Sans" fo:font-family="'Liberation Sans', Arial, sans-serif" fo:font-size="11pt" fo:language="it" fo:country="IT"/></style:default-style></office:styles><office:automatic-styles><style:page-layout style:name="PL"><style:page-layout-properties fo:page-width="${w.toFixed(2)}cm" fo:page-height="${h.toFixed(2)}cm" fo:margin-top="2cm" fo:margin-bottom="2cm" fo:margin-left="2cm" fo:margin-right="2cm"/></style:page-layout></office:automatic-styles><office:master-styles><style:master-page style:name="Standard" style:page-layout-name="PL"/></office:master-styles></office:document-styles>`;
  const meta = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-meta xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:meta="urn:oasis:names:tc:opendocument:xmlns:meta:1.0" xmlns:dc="http://purl.org/dc/elements/1.1/" office:version="1.3"><office:meta><dc:title>${escXml(title)}</dc:title><meta:generator>Leggio</meta:generator></office:meta></office:document-meta>`;
  const manifest = `<?xml version="1.0" encoding="UTF-8"?>
<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.3"><manifest:file-entry manifest:full-path="/" manifest:media-type="application/vnd.oasis.opendocument.text"/><manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/><manifest:file-entry manifest:full-path="styles.xml" manifest:media-type="text/xml"/><manifest:file-entry manifest:full-path="meta.xml" manifest:media-type="text/xml"/></manifest:manifest>`;
  return zip([
    { name: 'mimetype', data: 'application/vnd.oasis.opendocument.text' },
    { name: 'content.xml', data: content },
    { name: 'styles.xml', data: styles },
    { name: 'meta.xml', data: meta },
    { name: 'META-INF/manifest.xml', data: manifest },
  ]);
}

const escHtml = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** Pagina HTML autonoma (stili inclusi) dai blocchi. pages: [{ blocks, image? (data URL) }] */
export function html(pages, { title = 'Documento', lang = 'it' } = {}) {
  const run = (r) => {
    let t = escHtml(r.text).replace(/\t/g, ' ');
    if (r.italic) t = `<em>${t}</em>`;
    if (r.bold) t = `<strong>${t}</strong>`;
    return t;
  };
  const inline = (b) => (b.runs?.length ? b.runs.map(run).join('') : escHtml(b.text));
  let body = '';
  pages.forEach((pg, i) => {
    body += `<section class="pagina" id="pagina-${i + 1}" aria-label="Pagina ${i + 1}">\n`;
    if (pg.image) body += `<img class="immagine-pagina" src="${pg.image}" alt="Pagina ${i + 1}">\n`;
    let list = null;
    const closeList = () => { if (list) { body += `</${list}>\n`; list = null; } };
    for (const b of pg.blocks) {
      if (b.type === 'list') {
        const tag = b.ordered ? 'ol' : 'ul';
        if (list !== tag) { closeList(); body += `<${tag}${b.ordered ? ' class="numerato"' : ''}>\n`; list = tag; }
        body += `<li>${inline(b)}</li>\n`;
        continue;
      }
      closeList();
      if (b.type === 'heading') body += `<h${Math.min(6, b.level + 1)}${b.align === 'center' ? ' class="centro"' : ''}>${inline(b)}</h${Math.min(6, b.level + 1)}>\n`;
      else if (b.type === 'table') body += `<table>\n${b.rows.map((r, ri) => `<tr>${r.map((c) => (ri === 0 ? `<th>${escHtml(c)}</th>` : `<td>${escHtml(c)}</td>`)).join('')}</tr>`).join('\n')}\n</table>\n`;
      else body += `<p${b.align === 'center' ? ' class="centro"' : ''}>${inline(b)}</p>\n`;
    }
    closeList();
    body += '</section>\n';
  });
  return `<!doctype html>
<html lang="${escHtml(lang)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="Leggio">
<title>${escHtml(title)}</title>
<style>
body { font: 16px/1.55 system-ui, -apple-system, "Segoe UI", sans-serif; max-width: 52em; margin: 2em auto; padding: 0 1em; color: #1c1e22; }
.pagina { padding-bottom: 1.5em; margin-bottom: 1.5em; border-bottom: 1px solid #ddd; }
.immagine-pagina { max-width: 100%; border: 1px solid #ddd; }
.centro { text-align: center; }
table { border-collapse: collapse; margin: 1em 0; }
th, td { border: 1px solid #bbb; padding: .3em .6em; text-align: left; vertical-align: top; }
ol.numerato { list-style: none; padding-left: 1.2em; }
</style>
</head>
<body>
<h1>${escHtml(title)}</h1>
${body}</body>
</html>
`;
}
