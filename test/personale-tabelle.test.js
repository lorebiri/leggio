// Lettura di tabelle (features/personale/lib/tabelle.js): CSV con separatori diversi, virgolette, BOM e Windows-1252;
// Excel .xlsx sia «store» (come lo scrive Leggio) sia compresso deflate (come lo scrive Excel), con stringhe condivise,
// rich text, celle saltate, date e numeri lunghi; vecchio .xls con un messaggio chiaro.
import { describe, it, expect } from 'vitest';
import { deflateRawSync } from 'node:zlib';
import { tabellaDaFile, tabellaDaCsv, tabellaDaRighe, dataExcel, csvDaTabella, leggiXlsx } from '../src/renderer/features/personale/lib/tabelle.js';
import { xlsx } from '../src/renderer/features/conversione/lib/formati.js';

const enc = (s) => new TextEncoder().encode(s);

describe('CSV', () => {
  it('riconosce «;», «,» e tabulazione', async () => {
    for (const sep of [';', ',', '\t']) {
      const t = await tabellaDaFile({ name: 'a.csv', bytes: enc(['Nome', 'Cognome', 'Città'].join(sep) + '\r\n' + ['Mario', 'Rossi', 'Prato'].join(sep) + '\r\n') });
      expect(t.intestazioni).toEqual(['Nome', 'Cognome', 'Città']);
      expect(t.righe).toEqual([{ Nome: 'Mario', Cognome: 'Rossi', 'Città': 'Prato' }]);
    }
  });
  it('virgolette con separatori, a capo e virgolette doppie dentro', () => {
    const t = tabellaDaCsv('Nome;Note\n"Rossi; Mario";"riga 1\nriga 2 ""citata"""\n');
    expect(t.righe).toEqual([{ Nome: 'Rossi; Mario', Note: 'riga 1\nriga 2 "citata"' }]);
  });
  it('BOM UTF-8 e UTF-16', async () => {
    const t = await tabellaDaFile({ name: 'a.csv', bytes: enc('﻿Nome;Città\nNiccolò;Forlì\n') });
    expect(t.intestazioni).toEqual(['Nome', 'Città']);
    expect(t.righe[0]).toEqual({ Nome: 'Niccolò', 'Città': 'Forlì' });
    const u16 = new Uint8Array([0xff, 0xfe, ...Buffer.from('Nome;Città\nAndrè;Forlì\n', 'utf16le')]);
    expect((await tabellaDaFile({ name: 'a.csv', bytes: u16 })).righe[0]).toEqual({ Nome: 'Andrè', 'Città': 'Forlì' });
  });
  it('Windows-1252 (Excel italiano), anche con un solo carattere accentato', async () => {
    const bytes = new Uint8Array([...Buffer.from('Nome;Citt'), 0xe0, ...Buffer.from('\nMario;Roma\n')]);
    const t = await tabellaDaFile({ name: 'a.csv', bytes });
    expect(t.intestazioni).toEqual(['Nome', 'Città']);
    const euro = new Uint8Array([...Buffer.from('Voce;Importo\nCaff'), 0xe8, ...Buffer.from(';'), 0x80, ...Buffer.from(' 1\n')]);
    expect((await tabellaDaFile({ name: 'b.csv', bytes: euro })).righe[0]).toEqual({ Voce: 'Caffè', Importo: '€ 1' });
  });
  it('intestazioni mancanti o doppie, righe vuote, righe più lunghe', () => {
    const t = tabellaDaRighe([[], ['Nome', '', 'Nome'], ['a', 'b', 'c', 'd'], ['', '', '']]);
    expect(t.intestazioni).toEqual(['Nome', 'Colonna 2', 'Nome (2)', 'Colonna 4']);
    expect(t.righe).toEqual([{ Nome: 'a', 'Colonna 2': 'b', 'Nome (2)': 'c', 'Colonna 4': 'd' }]);
  });
  it('file vuoto, .xls vecchio e .ods: messaggi chiari', async () => {
    await expect(tabellaDaFile({ name: 'a.csv', bytes: new Uint8Array() })).rejects.toThrow(/vuoto/);
    const ole = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0, 0]);
    await expect(tabellaDaFile({ name: 'vecchio.xls', bytes: ole })).rejects.toThrow(/vecchio formato \(\.xls\).*\.xlsx/);
    await expect(tabellaDaFile({ name: 'rinominato.xlsx', bytes: ole })).rejects.toThrow(/vecchio formato/);
    await expect(tabellaDaFile({ name: 'foglio.ods', bytes: enc('x') })).rejects.toThrow(/LibreOffice/);
  });
  it('csvDaTabella: «;», BOM, virgolette quando servono, formule disinnescate', () => {
    const s = csvDaTabella(['A', 'B'], [{ A: 'x;y', B: '=SOMMA(1)' }, { A: 'riga\n2', B: '-5' }]);
    expect(s).toBe('﻿A;B\r\n"x;y";"\'=SOMMA(1)"\r\n"riga\n2";-5\r\n');
  });
});

// ------------------------------------------------------------------ ZIP compresso costruito a mano (come Excel)
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (b) => { let c = 0xffffffff; for (const x of b) c = CRC[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function zipDeflate(files) {
  const locali = []; const centrali = []; let off = 0;
  for (const { name, data } of files) {
    const raw = enc(data); const comp = deflateRawSync(raw); const nome = enc(name); const crc = crc32(raw);
    const h = Buffer.alloc(30); h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(8, 8); h.writeUInt32LE(crc, 14); h.writeUInt32LE(comp.length, 18); h.writeUInt32LE(raw.length, 22); h.writeUInt16LE(nome.length, 26);
    locali.push(h, nome, comp);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(8, 10); c.writeUInt32LE(crc, 16); c.writeUInt32LE(comp.length, 20); c.writeUInt32LE(raw.length, 24); c.writeUInt16LE(nome.length, 28); c.writeUInt32LE(off, 42);
    centrali.push(c, nome);
    off += 30 + nome.length + comp.length;
  }
  const cd = Buffer.concat(centrali);
  const e = Buffer.alloc(22); e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(files.length, 8); e.writeUInt16LE(files.length, 10); e.writeUInt32LE(cd.length, 12); e.writeUInt32LE(off, 16);
  return new Uint8Array(Buffer.concat([...locali, cd, e]));
}

describe('Excel .xlsx', () => {
  it('legge un file «store» scritto da Leggio (conversione/lib/formati.js)', async () => {
    const bytes = xlsx([{ name: 'Rubrica', rows: [['Nome', 'Cognome', 'Codice fiscale', 'Telefono'], ['Mario', 'Rossi', 'RSSMRA85T10A562S', '3331234567'], ['Anna', 'Bianchi', '', '']] }], { numeri: false });
    const t = await tabellaDaFile({ name: 'rubrica.xlsx', bytes });
    expect(t.foglio).toBe('Rubrica');
    expect(t.intestazioni).toEqual(['Nome', 'Cognome', 'Codice fiscale', 'Telefono']);
    expect(t.righe).toEqual([{ Nome: 'Mario', Cognome: 'Rossi', 'Codice fiscale': 'RSSMRA85T10A562S', Telefono: '3331234567' }, { Nome: 'Anna', Cognome: 'Bianchi', 'Codice fiscale': '', Telefono: '' }]);
  });
  it('legge un file compresso (deflate) con stringhe condivise, rich text, celle saltate, date e numeri lunghi', async () => {
    const wb = '<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Vuoto" sheetId="1" r:id="rId1"/><sheet name="Contatti &amp; enti" sheetId="2" r:id="rId2"/></sheets></workbook>';
    const rels = '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="worksheet" Target="/xl/worksheets/sheet2.xml"/><Relationship Id="rId3" Type="styles" Target="styles.xml"/></Relationships>';
    const sst = '<?xml version="1.0"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="6" uniqueCount="6">'
      + '<si><t>Nome</t></si><si><t>Data di nascita</t></si><si><t>P.IVA</t></si>'
      + '<si><r><rPr><b/></rPr><t>Nicc</t></r><r><t xml:space="preserve">olò </t></r><r><t>Bianchi</t></r><rPh sb="0" eb="1"><t>FONETICO</t></rPh></si>'
      + '<si><t>Città</t></si><si><t>A &amp; B &lt;srl&gt;</t></si></sst>';
    const styles = '<?xml version="1.0"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="165" formatCode="dd/mm/yyyy;@"/></numFmts><cellXfs count="4"><xf numFmtId="0"/><xf numFmtId="14" applyNumberFormat="1"/><xf numFmtId="165" applyNumberFormat="1"/><xf numFmtId="1"/></cellXfs></styleSheet>';
    const s1 = '<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData/></worksheet>';
    const s2 = '<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>'
      + '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c><c r="E1" t="s"><v>4</v></c></row>'
      + '<row r="2"><c r="A2" t="s"><v>3</v></c><c r="B2" s="1"><v>31391</v></c><c r="C2" s="3"><v>1114601006</v></c><c r="E2" t="inlineStr"><is><t>Forlì</t></is></c></row>'
      + '<row r="4"><c r="A4" t="s"><v>5</v></c><c r="B4" s="2"><v>45961</v></c><c r="C4" t="str"><v>01114601006</v></c><c r="D4"><v>3.5</v></c><c r="E4" t="b"><v>1</v></c></row>'
      + '</sheetData></worksheet>';
    const bytes = zipDeflate([
      { name: '[Content_Types].xml', data: '<?xml version="1.0"?><Types/>' },
      { name: 'xl/workbook.xml', data: wb }, { name: 'xl/_rels/workbook.xml.rels', data: rels }, { name: 'xl/sharedStrings.xml', data: sst },
      { name: 'xl/styles.xml', data: styles }, { name: 'xl/worksheets/sheet1.xml', data: s1 }, { name: 'xl/worksheets/sheet2.xml', data: s2 },
    ]);
    const t = await tabellaDaFile({ name: 'contatti.xlsx', bytes });
    expect(t.fogli).toEqual(['Vuoto', 'Contatti & enti']);
    expect(t.foglio).toBe('Contatti & enti'); // il primo foglio con dati
    expect(t.intestazioni).toEqual(['Nome', 'Data di nascita', 'P.IVA', 'Colonna 4', 'Città']);
    expect(t.righe).toEqual([
      { Nome: 'Niccolò Bianchi', 'Data di nascita': '10/12/1985', 'P.IVA': '1114601006', 'Colonna 4': '', 'Città': 'Forlì' },
      { Nome: 'A & B <srl>', 'Data di nascita': '31/10/2025', 'P.IVA': '01114601006', 'Colonna 4': '3,5', 'Città': 'VERO' },
    ]);
    const { fogli } = await leggiXlsx(bytes);
    expect(fogli[1].righe[2]).toEqual([]); // la riga 3 saltata nel file resta vuota
    const scelto = await tabellaDaFile({ name: 'contatti.xlsx', bytes }, { foglio: 'Vuoto' });
    expect(scelto).toMatchObject({ foglio: 'Vuoto', righe: [] });
  });
  it('numeri seriali di Excel → gg/mm/aaaa (anche sistema 1904)', () => {
    expect(dataExcel(31391)).toBe('10/12/1985');
    expect(dataExcel(45961)).toBe('31/10/2025');
    expect(dataExcel(29929, true)).toBe('10/12/1985');
  });
  it('ZIP danneggiato: messaggio chiaro', async () => {
    await expect(tabellaDaFile({ name: 'rotto.xlsx', bytes: new Uint8Array([0x50, 0x4b, 3, 4, 0, 0]) })).rejects.toThrow(/Excel/);
  });
});
