import { describe, it, expect } from 'vitest';
import { toJSON, parseJSON, toCSV, parseCSV, toFDF, parseFDF, toXFDF, parseXFDF, parseAny, detectFormat, serialize, textToBytes, bytesToText } from '../src/renderer/features/moduli/lib/formdata.js';
import { detectFields, slugName, textItemsFromPdfjs } from '../src/renderer/features/moduli/lib/detect.js';

const DATA = { nome: 'Maria Rossi', 'indirizzo.via': 'Via Roma, 1 "interno"', accetto: true, newsletter: false, lingue: ['it', 'en'], note: 'riga 1\nriga 2', città: 'Forlì € (FC)' };

describe('dati modulo: andata e ritorno', () => {
  for (const fmt of ['json', 'csv', 'fdf', 'xfdf']) {
    it(fmt, () => {
      const s = serialize(fmt, DATA, 'modulo.pdf');
      const back = bytesToText(textToBytes(s, fmt));
      const { format, data } = parseAny(back, 'x.' + fmt);
      expect(format).toBe(fmt);
      expect(data.nome).toBe('Maria Rossi');
      expect(data['indirizzo.via']).toBe('Via Roma, 1 "interno"');
      expect(data.città).toBe('Forlì € (FC)');
      expect(data.note).toBe('riga 1\nriga 2');
      if (fmt === 'csv') { expect(data.accetto).toBe('Sì'); expect(data.lingue).toBe('it|en'); }
      else if (fmt === 'xfdf') { expect(data.accetto).toBe('Yes'); expect(data.newsletter).toBe('Off'); expect(data.lingue).toEqual(['it', 'en']); }
      else { expect(data.accetto).toBe(true); expect(data.newsletter).toBe(false); expect(data.lingue).toEqual(['it', 'en']); }
    });
  }
});

describe('dati modulo: casi limite', () => {
  it('JSON non valido o non oggetto', () => {
    expect(() => parseJSON('{rotto')).toThrow(/non è valido/);
    expect(() => parseJSON('[1,2]')).toThrow(/elenco di campi/);
    expect(() => parseJSON(null)).toThrow(/testo/);
  });
  it('JSON piatto e con valori annidati ignorati', () => {
    expect(parseJSON('{"a":1,"b":{"x":1},"c":null}')).toEqual({ a: '1', c: '' });
  });
  it('CSV con punto e virgola, BOM, virgolette e più righe', () => {
    const t = '﻿nome;"cognome; doppio";eta\r\nAnna;"De ""Luca""";40\r\nPaolo;Bianchi;33\r\n';
    expect(parseCSV(t)).toEqual({ nome: 'Anna', 'cognome; doppio': 'De "Luca"', eta: '40' });
    expect(parseCSV(t, 1).nome).toBe('Paolo');
    expect(() => parseCSV(t, 5)).toThrow(/riga 6/);
    expect(() => parseCSV('solo intestazione')).toThrow(/almeno una riga/);
  });
  it('CSV con virgola e celle mancanti', () => {
    expect(parseCSV('a,b,c\n1')).toEqual({ a: '1', b: '', c: '' });
    expect(toCSV({ a: ' x' })).toContain('" x"');
  });
  it('FDF con nomi gerarchici, ottale ed esadecimale', () => {
    const f = '%FDF-1.2\n1 0 obj << /FDF << /Fields [ << /T (persona) /Kids [ << /T (nome) /V (Gi\\340) >> << /T (eta) /V 42 >> ] >> << /T <FEFF00E8> /V /Scelta1 >> ] >> >> endobj trailer << /Root 1 0 R >> %%EOF';
    expect(parseFDF(f)).toEqual({ 'persona.nome': 'Già', 'persona.eta': '42', 'è': 'Scelta1' });
  });
  it('FDF malformati non bloccano', () => {
    expect(() => parseFDF('ciao')).toThrow(/FDF valido/);
    expect(parseFDF('%FDF-1.2\n')).toEqual({});
    expect(parseFDF('%FDF-1.2 /Fields [ << /T (a) /V (b) ')).toEqual({ a: 'b' });
    expect(() => parseFDF('%FDF /Fields ' + '['.repeat(200))).toThrow(/annidato/);
  });
  it('XFDF annidato, CDATA, entità', () => {
    const x = '<?xml version="1.0"?><xfdf><fields><field name="p"><field name="n"><value>A &amp; B</value></field></field><field name="c"><value><![CDATA[<x>]]></value></field><field name="e"><value/></field></fields></xfdf>';
    expect(parseXFDF(x)).toEqual({ 'p.n': 'A & B', c: '<x>', e: '' });
    expect(() => parseXFDF('<html/>')).toThrow(/XFDF/);
  });
  it('riconoscimento del formato', () => {
    expect(detectFormat('a.FDF')).toBe('fdf');
    expect(detectFormat('', '%FDF-1.2')).toBe('fdf');
    expect(detectFormat('', '<xfdf>')).toBe('xfdf');
    expect(detectFormat('', ' {"a":1}')).toBe('json');
    expect(detectFormat('dati.txt')).toBe('csv');
  });
  it('file troppo grande rifiutato', () => {
    expect(() => parseJSON('x'.repeat(21 * 1024 * 1024))).toThrow(/troppo grande/);
  });
  it('molti campi (5000) in tempi brevi', () => {
    const big = {}; for (let i = 0; i < 5000; i++) big['campo_' + i] = 'valore ' + i;
    const t0 = Date.now();
    for (const f of ['json', 'csv', 'fdf', 'xfdf']) expect(Object.keys(parseAny(serialize(f, big), 'x.' + f).data)).toHaveLength(5000);
    expect(Date.now() - t0).toBeLessThan(3000);
  });
  it('toJSON e toFDF producono testo atteso', () => {
    expect(JSON.parse(toJSON({ a: 'b' })).campi).toEqual({ a: 'b' });
    expect(toFDF({ a: 'b' })).toMatch(/^%FDF-1\.2/);
    expect(toXFDF({ a: 'b' })).toContain('<field name="a"><value>b</value></field>');
  });
});

describe('riconoscimento automatico dei campi', () => {
  const page = { width: 595, height: 842 };
  const it6 = (str, x, y, h = 10) => ({ str, x, y, w: str.length * h * 0.5, h });
  it('trattini bassi con etichetta nella stessa stringa', () => {
    const f = detectFields([it6('Nome: ____________', 50, 700)], page);
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ type: 'text', name: 'nome' });
    expect(f[0].rect[0]).toBeGreaterThan(50 + 5 * 5 - 1);
  });
  it('etichetta separata, firma, data, email, caselle', () => {
    const items = [it6('Data:', 50, 600), it6('Firma', 300, 600), it6('__________', 340, 600), it6('E-mail:', 50, 560), it6('☐ Accetto il trattamento', 50, 520), it6('[ ] Newsletter', 50, 500)];
    const f = detectFields(items, page);
    const byName = Object.fromEntries(f.map((x) => [x.name, x]));
    expect(byName.data).toMatchObject({ type: 'text', format: 'date' });
    expect(byName.firma).toMatchObject({ type: 'signature' });
    expect(byName.email).toMatchObject({ format: 'email' });
    expect(f.filter((x) => x.type === 'checkbox').map((x) => x.name)).toEqual(['accetto_il_trattamento', 'newsletter']);
  });
  it('non propone campi sopra quelli esistenti e nomi unici', () => {
    const items = [it6('Nome: __________', 50, 700), it6('Nome: __________', 50, 650)];
    const f = detectFields(items, page);
    expect(f.map((x) => x.name)).toEqual(['nome', 'nome_2']);
    const f2 = detectFields(items, page, { existing: [f[0].rect] });
    expect(f2).toHaveLength(1);
  });
  it('righe disegnate accanto a etichetta', () => {
    const f = detectFields([it6('Cognome', 50, 400)], page, { segments: [{ x1: 100, x2: 300, y: 398 }] });
    expect(f[0]).toMatchObject({ name: 'cognome', type: 'text' });
  });
  it('input sporchi ignorati, limite di campi rispettato', () => {
    expect(detectFields(null, page)).toEqual([]);
    expect(detectFields([{ str: 'x' }, { str: 5 }, null, { str: '___', x: NaN, y: 1, w: 1, h: 1 }], page)).toEqual([]);
    const many = Array.from({ length: 2000 }, (_, i) => it6('Campo: ______', 50 + (i % 5) * 100, 800 - Math.floor(i / 5) * 2, 1.5));
    expect(detectFields(many, page, { maxFields: 50 }).length).toBeLessThanOrEqual(50);
  });
  it('slugName e conversione da pdf.js', () => {
    expect(slugName('Città di nascita:')).toBe('citta_di_nascita');
    expect(slugName('***')).toBe('campo');
    expect(textItemsFromPdfjs({ items: [{ str: 'Ciao', transform: [12, 0, 0, 12, 10, 20], width: 30 }, { str: ' ', transform: [1, 0, 0, 1, 0, 0] }, { str: 'ruotato', transform: [0, 12, -12, 0, 0, 0] }] }))
      .toEqual([{ str: 'Ciao', x: 10, y: 20, w: 30, h: 12 }]);
    expect(textItemsFromPdfjs(undefined)).toEqual([]);
  });
});
