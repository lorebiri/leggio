import { describe, it, expect } from 'vitest';
import * as PDFLib from '@cantoo/pdf-lib';
import { makeFontModel } from '../src/renderer/features/modifica/fontmodel.js';
import { compareOutside, containsText } from '../src/renderer/features/modifica/verify.js';
import { hasDigitalSignatures } from '../src/renderer/features/modifica/pdfpage.js';
import { analyze } from '../src/renderer/features/modifica/operations.js';
import { groupTextItems } from '../src/renderer/features/modifica/blocks.js';

const it0 = (str, x, y, w, fs = 10) => ({ str, transform: [fs, 0, 0, fs, x, y], width: w, height: fs, fontName: 'f1' });

describe('font Type3', () => {
  it('larghezze con FontMatrix, niente codifica inversa', () => {
    const f = makeFontModel({ subtype: 'Type3', firstChar: 65, widths: [500, 1000], fontMatrix: [0.002, 0, 0, 0.002, 0, 0], encoding: { base: null, differences: new Map([[65, 'A'], [66, 'B']]) } });
    expect(f.decode(Uint8Array.from([65, 66])).map((g) => g.w)).toEqual([1000, 2000]);
    expect(f.encode('A')).toBeNull();
  });
});

describe('verifica', () => {
  const before = [it0('Riga uno intatta', 50, 700, 90), it0('Blocco da cambiare', 50, 680, 100), it0('Riga tre', 50, 660, 50)];
  it('accetta modifiche solo dentro la zona', () => {
    const after = [it0('Riga uno intatta', 50, 700, 90), it0('Nuovo', 50, 680, 40), it0('Riga tre', 50, 660, 50)];
    expect(compareOutside(before, after, [[50, 677, 150, 690]]).ok).toBe(true);
  });
  it('rileva testo sparito fuori dalla zona', () => {
    const after = [it0('Riga uno', 50, 700, 50), it0('Nuovo', 50, 680, 40), it0('Riga tre', 50, 660, 50)];
    const r = compareOutside(before, after, [[50, 677, 150, 690]]);
    expect(r.ok).toBe(false);
    expect(r.missing).toContain('i');
  });
  it('insensibile a come pdf.js divide gli item', () => {
    const after = [it0('Riga uno', 50, 700, 45), it0(' intatta', 95, 700, 45), it0('Riga tre', 50, 660, 50)];
    expect(compareOutside(before, after, [[50, 677, 150, 690]]).ok).toBe(true);
  });
  it('testo atteso', () => {
    expect(containsText([it0('Il  RUP è', 0, 0, 10), it0('Maria', 0, 0, 10)], 'RUP è Maria')).toBe(true);
  });
});

describe('blocchi: tabelle e colonne', () => {
  it('le celle separate da spazi lunghi non si uniscono alla riga', () => {
    const items = [it0('Voce di spesa', 50, 700, 70), { ...it0(' ', 120, 700, 200) }, it0('1.250,00', 330, 700, 40)];
    const blocks = groupTextItems(items);
    expect(blocks.map((b) => b.text)).toEqual(['Voce di spesa', '1.250,00']);
  });
  it('due colonne restano due blocchi', () => {
    const items = [];
    for (let i = 0; i < 4; i++) { items.push(it0('colonna sinistra riga ' + i, 50, 700 - i * 12, 120)); items.push(it0('colonna destra riga ' + i, 320, 700 - i * 12, 120)); }
    const blocks = groupTextItems(items);
    expect(blocks).toHaveLength(2);
    expect(blocks[0].lines).toHaveLength(4);
  });
});

describe('documenti firmati e protetti', () => {
  it('riconosce un campo firma compilato', async () => {
    const d = await PDFLib.PDFDocument.create();
    d.addPage();
    const ctx = d.context;
    const sigV = ctx.register(ctx.obj({ Type: 'Sig', Filter: 'Adobe.PPKLite' }));
    const field = ctx.register(ctx.obj({ FT: 'Sig', T: PDFLib.PDFString.of('Firma1'), V: sigV }));
    d.catalog.set(PDFLib.PDFName.of('AcroForm'), ctx.obj({ Fields: [field], SigFlags: 3 }));
    expect(hasDigitalSignatures(await PDFLib.PDFDocument.load(await d.save()))).toBe(true);
    const plain = await PDFLib.PDFDocument.create(); plain.addPage();
    expect(hasDigitalSignatures(plain)).toBe(false);
  });
  it('documento cifrato aperto senza password: l\'analisi fallisce invece di leggere byte cifrati', async () => {
    const d = await PDFLib.PDFDocument.create();
    d.addPage().drawText('Segreto', { x: 50, y: 700 });
    d.encrypt({ userPassword: '', ownerPassword: 'x', permissions: { modifying: false } });
    const l = await PDFLib.PDFDocument.load(await d.save(), { ignoreEncryption: true });
    expect(l.isEncrypted).toBe(true);
    expect(() => analyze(l, 0)).toThrow();
  });
});
