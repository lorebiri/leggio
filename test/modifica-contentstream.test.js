import { describe, it, expect } from 'vitest';
import { parseContentStream, rewriteContentStream, serializeOperand, fmtNum, latin1 } from '../src/renderer/features/modifica/contentstream.js';
import { parseCMap, makeFontModel, glyphNameToUnicode, winAnsiCode, guessFamily } from '../src/renderer/features/modifica/fontmodel.js';
import { interpret, mul, inv, apply } from '../src/renderer/features/modifica/interpreter.js';
import { removeGlyphs, replaceGlyphRange, placeImage, T } from '../src/renderer/features/modifica/rewrite.js';

const B = (s) => Uint8Array.from([...s].map((c) => c.charCodeAt(0) & 255));
const str = (u8) => latin1(u8);

describe('tokenizer', () => {
  it('riconosce operatori e operandi di base', () => {
    const p = parseContentStream(B('q 1 0 0 1 10 20 cm BT /F1 12 Tf (Ciao) Tj ET Q'));
    expect(p.ops.map((o) => o.op)).toEqual(['q', 'cm', 'BT', 'Tf', 'Tj', 'ET', 'Q']);
    expect(p.ops[1].operands.map((o) => o.v)).toEqual([1, 0, 0, 1, 10, 20]);
    expect(p.ops[3].operands[0]).toEqual({ t: 'name', v: 'F1' });
    expect(str(p.ops[4].operands[0].b)).toBe('Ciao');
  });
  it('gestisce parentesi annidate ed escape nelle stringhe', () => {
    const p = parseContentStream(B('(a(b)c\\)d\\\\e\\(f\\101\\0533\\nx\\\ny) Tj'));
    expect(p.ops).toHaveLength(1);
    expect(str(p.ops[0].operands[0].b)).toBe('a(b)c)d\\e(fA+3\nxy');
  });
  it('stringhe esadecimali, anche dispari e con spazi', () => {
    const p = parseContentStream(B('<48 65 6C6C 6F> Tj <414> Tj'));
    expect(str(p.ops[0].operands[0].b)).toBe('Hello');
    expect([...p.ops[1].operands[0].b]).toEqual([0x41, 0x40]);
  });
  it('array TJ con crenatura e numeri strani', () => {
    const p = parseContentStream(B('[(A) -120 (W) .5 (a) -.25 (y) 4.] TJ'));
    const arr = p.ops[0].operands[0];
    expect(arr.t).toBe('arr');
    expect(arr.v.filter((o) => o.t === 'num').map((o) => o.v)).toEqual([-120, 0.5, -0.25, 4]);
  });
  it('nomi con #xx, dizionari e commenti', () => {
    const p = parseContentStream(B('/P <</MCID 3 /Alt (x)>> BDC % commento ) ( [\n/A#20B gs EMC'));
    expect(p.ops.map((o) => o.op)).toEqual(['BDC', 'gs', 'EMC']);
    expect(p.ops[0].operands[1].v.MCID.v).toBe(3);
    expect(p.ops[1].operands[0].v).toBe('A B');
  });
  it('immagine in linea con EI dentro i dati binari non viene spezzata', () => {
    const data = [0x45, 0x49, 0x20, 0x00, 0xff, 0x45, 0x49, 0x0a, 0x80, 0x81, 0x82, 0x83];
    const pre = B('q 10 0 0 10 0 0 cm BI /W 4 /H 3 /BPC 8 /CS /G ID ');
    const post = B('\nEI Q BT /F1 9 Tf (dopo) Tj ET');
    const all = new Uint8Array(pre.length + data.length + post.length);
    all.set(pre); all.set(data, pre.length); all.set(post, pre.length + data.length);
    const p = parseContentStream(all);
    expect(p.ops.map((o) => o.op)).toEqual(['q', 'cm', 'BI', 'Q', 'BT', 'Tf', 'Tj', 'ET']);
    expect([...p.ops[2].data]).toEqual(data);
    // riscrittura di un altro operatore: i byte dell'immagine restano identici
    const out = rewriteContentStream(p, new Map([[6, '(ciao) Tj']]));
    expect(out.subarray(pre.length, pre.length + data.length)).toEqual(Uint8Array.from(data));
  });
  it('immagine in linea compressa: EI trovato con euristica', () => {
    const bin = [1, 2, 0xc8, 0x45, 0x49, 0x99, 3];
    const pre = B('BI /W 10 /H 10 /BPC 8 /CS /RGB /F /Fl ID ');
    const post = B(' EI\n0 0 m 10 10 l S');
    const all = new Uint8Array(pre.length + bin.length + post.length);
    all.set(pre); all.set(bin, pre.length); all.set(post, pre.length + bin.length);
    const p = parseContentStream(all);
    expect(p.ops.map((o) => o.op)).toEqual(['BI', 'm', 'l', 'S']);
    expect([...p.ops[0].data]).toEqual(bin);
  });
  it('riscrittura senza sostituzioni = byte identici', () => {
    const src = B('%PDF-ish\nq 1 0 0 1 0 0 cm\r\nBT /F1 12 Tf [(a) 10 (b)] TJ ET Q  ');
    const p = parseContentStream(src);
    expect(rewriteContentStream(p, new Map())).toEqual(src);
  });
  it('fuzzing: input casuali non lanciano e non vanno in ciclo', () => {
    let seed = 12345;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32);
    const alphabet = B('()<>[]{}/%\\ \n\r\t0123456789.-+abcdefTJBIEIDqQ#');
    for (let k = 0; k < 400; k++) {
      const len = Math.floor(rnd() * 400);
      const a = new Uint8Array(len);
      for (let i = 0; i < len; i++) a[i] = rnd() < 0.7 ? alphabet[Math.floor(rnd() * alphabet.length)] : Math.floor(rnd() * 256);
      const p = parseContentStream(a);
      expect(rewriteContentStream(p, new Map())).toEqual(a);
      // anche l'interprete non deve lanciare
      interpret(p, { font: () => null, xobject: () => null });
    }
  });
  it('stringhe e array non chiusi', () => {
    expect(() => parseContentStream(B('(non chiusa Tj'))).not.toThrow();
    const p = parseContentStream(B('[(a) (b) TJ ET'));
    expect(p.ops.map((o) => o.op)).toEqual(['TJ', 'ET']);
  });
  it('content stream enorme si analizza in fretta', () => {
    const line = 'BT /F1 10 Tf 1 0 0 1 72 700 Tm [(Riga) -250 (di) -250 (prova)] TJ ET\n';
    const big = B(line.repeat(20000)); // 100.000 operatori
    const t0 = Date.now();
    const p = parseContentStream(big);
    expect(p.ops.length).toBe(100000);
    expect(Date.now() - t0).toBeLessThan(4000);
  });
});

describe('serializzazione', () => {
  it('numeri compatti', () => {
    expect(fmtNum(1)).toBe('1'); expect(fmtNum(-0.00001)).toBe('0'); expect(fmtNum(2.50001)).toBe('2.5'); expect(fmtNum(1e7)).toBe('10000000');
  });
  it('operandi', () => {
    expect(serializeOperand({ t: 'name', v: 'A B' })).toBe('/A#20B');
    expect(serializeOperand({ t: 'str', b: B('()') })).toBe('<2829>');
  });
});

describe('font', () => {
  it('ToUnicode con bfchar e bfrange', () => {
    const cm = parseCMap('1 begincodespacerange <0000> <FFFF> endcodespacerange 2 beginbfchar <0003> <0020> <0011> <00660069> endbfchar 1 beginbfrange <0024> <0026> <0041> endbfrange 1 beginbfrange <0030> <0031> [<00E8> <00E0>] endbfrange');
    expect(cm.map.get(3)).toBe(' ');
    expect(cm.map.get(0x11)).toBe('fi');
    expect(cm.map.get(0x25)).toBe('B');
    expect(cm.map.get(0x31)).toBe('à');
  });
  it('nomi di glifo', () => {
    expect(glyphNameToUnicode('egrave')).toBe('è');
    expect(glyphNameToUnicode('uni20AC')).toBe('€');
    expect(glyphNameToUnicode('a.sc')).toBe('a');
    expect(winAnsiCode('€')).toBe(0x80);
    expect(winAnsiCode('Ł')).toBe(-1);
  });
  it('font semplice con Differences e larghezze', () => {
    const f = makeFontModel({ subtype: 'Type1', baseFont: 'ABCDEF+Garamond-Bold', embedded: true, firstChar: 65, widths: [600, 700], encoding: { base: 'WinAnsiEncoding', differences: new Map([[66, 'eacute']]) }, seenCodes: new Set([65, 66]) });
    const g = f.decode(B('AB'));
    expect(g.map((x) => x.u)).toEqual(['A', 'é']);
    expect(g.map((x) => x.w)).toEqual([600, 700]);
    expect(f.bold).toBe(true); expect(f.family).toBe('Times');
    expect([...f.encode('éA')]).toEqual([66, 65]);
    expect(f.encode('C')).toBeNull(); // glifo non presente nel sottoinsieme
  });
  it('font Type0 Identity-H con ToUnicode', () => {
    const f = makeFontModel({ subtype: 'Type0', baseFont: 'XYZ+Calibri', embedded: true, cmapName: 'Identity-H', descendant: { w: [3, [226], 68, 70, 500], dw: 1000 }, toUnicode: 'beginbfchar <0003> <0020> <0044> <0061> <0045> <0062> endbfchar' });
    const g = f.decode(Uint8Array.from([0, 3, 0, 0x44, 0, 0x45, 0, 0x99]));
    expect(g.map((x) => x.w)).toEqual([226, 500, 500, 1000]);
    expect(g.map((x) => x.u)).toEqual([' ', 'a', 'b', null]);
    expect([...f.encode('ab a')]).toEqual([0, 0x44, 0, 0x45, 0, 3, 0, 0x44]);
    expect(f.encode('c')).toBeNull();
    expect(f.family).toBe('Helvetica');
  });
  it('famiglie', () => {
    expect(guessFamily('TimesNewRomanPSMT')).toBe('Times');
    expect(guessFamily('ABCDEF+CMR10')).toBe('Times');
    expect(guessFamily('CourierNewPSMT')).toBe('Courier');
    expect(guessFamily('ArialMT')).toBe('Helvetica');
  });
});

const helv = makeFontModel({ subtype: 'Type1', baseFont: 'Helvetica', firstChar: 32, widths: Array.from({ length: 95 }, () => 500) });
const resF = { font: () => helv, xobject: (n) => (n === 'Im1' ? { subtype: 'Image' } : null) };

describe('interprete e riscrittura', () => {
  it('posizione dei glifi con Tm, Tc, Tw, Tz e crenatura', () => {
    const p = parseContentStream(B('BT /F1 10 Tf 2 Tc 100 Tz 1 0 0 1 100 200 Tm [(ab) -1000 ( c)] TJ ET'));
    const r = interpret(p, resF);
    const g = r.shows[0].glyphs;
    expect(g.map((x) => x.o[0])).toEqual([100, 107, 124, 131]);
    expect(g[0].o[1]).toBe(200);
  });
  it('rimozione di glifi lascia invariata la posizione degli altri', () => {
    const src = 'BT /F1 10 Tf 1 Tc 3 Tw 50 50 Td [(Ciao) -200 (mondo bello)] TJ (dopo) Tj ET';
    const p = parseContentStream(B(src));
    const r = interpret(p, resF);
    const show = r.shows[0];
    const before = r.shows[1].glyphs.map((g) => g.o);
    const keepPos = show.glyphs.filter((g) => g.u !== 'm' && g.u !== 'o').map((g) => g.o);
    const rep = removeGlyphs(show, p.ops[show.opIndex], (g) => g.u === 'm' || g.u === 'o');
    const out = rewriteContentStream(p, new Map([[show.opIndex, rep]]));
    const p2 = parseContentStream(out);
    const r2 = interpret(p2, resF);
    const kept = r2.shows[0].glyphs.map((g) => g.o);
    kept.forEach((o, i) => { expect(o[0]).toBeCloseTo(keepPos[i][0], 3); expect(o[1]).toBeCloseTo(keepPos[i][1], 3); });
    r2.shows[1].glyphs.forEach((g, i) => expect(g.o[0]).toBeCloseTo(before[i][0], 3));
    expect(r2.shows[0].glyphs.map((g) => g.u).join('')).toBe('Ciand bell');
  });
  it("gli operatori ' e \" conservano a capo, Tw e Tc", () => {
    const src = 'BT /F1 10 Tf 12 TL 0 700 Td (riga1) Tj 5 1 (riga2) " (riga3) \' ET';
    const p = parseContentStream(B(src));
    const r = interpret(p, resF);
    const ref = r.shows.map((s) => s.glyphs.map((g) => g.o));
    const reps = new Map();
    reps.set(r.shows[1].opIndex, removeGlyphs(r.shows[1], p.ops[r.shows[1].opIndex], (g) => g.u === '2'));
    const p2 = parseContentStream(rewriteContentStream(p, reps));
    const r2 = interpret(p2, resF);
    expect(r2.shows[2].glyphs.map((g) => g.o)).toEqual(ref[2]);
    expect(r2.shows[1].tc).toBe(1);
  });
  it('sostituzione in loco di una parola', () => {
    const p = parseContentStream(B('BT /F1 10 Tf 0 0 Td [(La data: 1) 20 (0/05)] TJ ET'));
    const r = interpret(p, resF);
    const s = r.shows[0];
    const txt = s.glyphs.map((g) => g.u).join('');
    const i = txt.indexOf('10/05');
    const rep = replaceGlyphRange(s, p.ops[s.opIndex], i, i + 4, B('12/06'));
    const r2 = interpret(parseContentStream(rewriteContentStream(p, new Map([[s.opIndex, rep]]))), resF);
    expect(r2.shows[0].glyphs.map((g) => g.u).join('')).toBe('La data: 12/06');
  });
  it('immagini: posizione e riposizionamento', () => {
    const p = parseContentStream(B('q 100 0 0 50 10 20 cm /Im1 Do Q'));
    const r = interpret(p, resF);
    expect(r.images[0].rect).toEqual([10, 20, 110, 70]);
    const img = r.images[0];
    const target = mul(img.ctm, T.translate(5, 5));
    const rep = placeImage(img.ctm, target, 'Im1');
    const r2 = interpret(parseContentStream(rewriteContentStream(p, new Map([[img.opIndex, rep]]))), resF);
    expect(r2.images[0].rect.map((v) => Math.round(v * 1000) / 1000)).toEqual([15, 25, 115, 75]);
  });
  it('matrici', () => {
    const m = [2, 0.5, -1, 3, 10, 20];
    const i = inv(m);
    const [x, y] = apply(m, 3, 4);
    const [a, b] = apply(i, x, y);
    expect(a).toBeCloseTo(3); expect(b).toBeCloseTo(4);
  });
});
