import { describe, it, expect } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { numeroItaliano, csv, tsv, xlsx, pptx, odt, html, escXml } from '../src/renderer/features/conversione/lib/formati.js';
import { zip, crc32 } from '../src/renderer/features/conversione/lib/zip.js';

describe('numeri all’italiana', () => {
  it.each([
    ['1.234,56', 1234.56, 'number'], ['1234,5', 1234.5, 'number'], ['12', 12, 'number'], ['-7', -7, 'number'],
    ['1.000', 1000, 'number'], ['3,5%', 0.035, 'percent'], ['€ 1.234,56', 1234.56, 'currency'], ['90,00 €', 90, 'currency'],
    ['(1.234,56)', -1234.56, 'number'], ['1 234,56', 1234.56, 'number'], ['1,234.56', 1234.56, 'number'], ['12.5', 12.5, 'number'],
  ])('%s → %s', (s, v, kind) => {
    const r = numeroItaliano(s);
    expect(r).not.toBeNull();
    expect(r.value).toBeCloseTo(v, 9);
    expect(r.kind).toBe(kind);
  });
  it.each(['', 'abc', '31/10/2026', '00123', 'CIG 12345', '1.23.4', 'IT60X0542811101000000123456'])('«%s» resta testo', (s) => {
    expect(numeroItaliano(s)).toBeNull();
  });
});

describe('CSV e TSV', () => {
  it('separatore punto e virgola, virgolette quando servono, BOM', () => {
    const s = csv([['Nome', 'Nota'], ['Rossi; Mario', 'disse "ciao"'], ['Bianchi', 'riga\nnuova']]);
    expect(s.startsWith('﻿')).toBe(true);
    expect(s).toContain('"Rossi; Mario";"disse ""ciao"""');
    expect(s).toContain('"riga\nnuova"');
  });
  it('TSV senza tabulazioni interne', () => {
    expect(tsv([['a\tb', 'c'], ['1', '2']])).toBe('a b\tc\n1\t2');
  });
});

describe('ZIP', () => {
  it('CRC32 noto', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });
  it('archivio leggibile con nomi accentati', () => {
    const z = zip([{ name: 'a.txt', data: 'ciao' }, { name: 'perché/è.xml', data: '<x/>' }]);
    const u = unzipSync(z);
    expect(strFromU8(u['a.txt'])).toBe('ciao');
    expect(strFromU8(u['perché/è.xml'])).toBe('<x/>');
  });
});

describe('Excel', () => {
  it('numeri veri, intestazione in grassetto, caratteri speciali', () => {
    const z = unzipSync(xlsx([{ name: 'Pagina 1', rows: [['Articolo', 'Totale'], ['Provette <50 ml> & co', '1.234,56 €'], ['Sconto', '10%'], ['Codice', '00123']] }]));
    const sheet = strFromU8(z['xl/worksheets/sheet1.xml']);
    expect(sheet).toContain('<c r="B2" s="4"><v>1234.56</v></c>');
    expect(sheet).toContain('<c r="B3" s="3"><v>0.1</v></c>');
    expect(sheet).toContain('Provette &lt;50 ml&gt; &amp; co');
    expect(sheet).toContain('<c r="B4" t="inlineStr"><is><t xml:space="preserve">00123</t>');
    expect(sheet).toContain('<c r="A1" t="inlineStr" s="1">');
    expect(strFromU8(z['xl/workbook.xml'])).toContain('name="Pagina 1"');
  });
  it('nomi di foglio non validi o duplicati vengono corretti', () => {
    const z = unzipSync(xlsx([{ name: 'a/b', rows: [] }, { name: 'a/b', rows: [] }]));
    const wb = strFromU8(z['xl/workbook.xml']);
    expect(wb).toContain('name="a b"');
    expect(wb).toContain('name="a b 2"');
  });
});

describe('PowerPoint e OpenDocument', () => {
  it('pptx con una diapositiva per pagina', () => {
    const img = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
    const z = unzipSync(pptx([{ data: img, type: 'jpeg', wPt: 842, hPt: 595 }, { data: img, type: 'jpeg', wPt: 595, hPt: 842 }]));
    expect(Object.keys(z)).toContain('ppt/slides/slide2.xml');
    expect(strFromU8(z['ppt/presentation.xml'])).toContain(`cx="${842 * 12700}"`);
  });
  it('odt: mimetype per primo, titoli, elenchi, tabelle, interruzioni di pagina', () => {
    const bytes = odt([
      { blocks: [{ type: 'heading', level: 1, text: 'Titolo', runs: [{ text: 'Titolo', bold: true }] }, { type: 'list', ordered: false, text: 'voce', runs: [{ text: 'voce' }] }] },
      { blocks: [{ type: 'table', rows: [['A', 'B'], ['1', '2']] }, { type: 'paragraph', text: 'Perché è così', runs: [{ text: 'Perché ', bold: false }, { text: 'è così', italic: true }] }] },
    ]);
    expect(strFromU8(bytes.slice(30, 38))).toBe('mimetype');
    const c = strFromU8(unzipSync(bytes)['content.xml']);
    expect(c).toContain('<text:h text:style-name="H1"');
    expect(c).toContain('<text:list text:style-name="LB">');
    expect(c).toContain('<table:table ');
    expect(c).toContain('text:style-name="PB"');
    expect(c).toContain('<text:span text:style-name="TI">è così</text:span>');
  });
});

describe('HTML', () => {
  it('struttura semantica ed escape', () => {
    const s = html([{ blocks: [{ type: 'heading', level: 1, text: 'A & B' }, { type: 'list', ordered: false, text: 'x' }, { type: 'list', ordered: false, text: 'y' }, { type: 'paragraph', text: '<script>' }] }], { title: 'Prova' });
    expect(s).toContain('<h2>A &amp; B</h2>');
    expect(s).toMatch(/<ul>\n<li>x<\/li>\n<li>y<\/li>\n<\/ul>/);
    expect(s).toContain('<p>&lt;script&gt;</p>');
    expect(s).toContain('<html lang="it">');
  });
  it('escXml toglie i caratteri di controllo', () => {
    expect(escXml('a\u0001b')).toBe('ab');
  });
});
