// Correzioni dalla revisione dell'area moduli: valori delle caselle con nomi non ASCII in FDF/XFDF.
import { describe, it, expect } from 'vitest';
import * as PDFLib from '@cantoo/pdf-lib';
import { writeValues, readValues } from '../src/renderer/features/moduli/formtools.js';
import { parseFDF, toFDF, toXFDF, parseXFDF, serialize } from '../src/renderer/features/moduli/lib/formdata.js';

const { PDFDocument, PDFName } = PDFLib;

/** Modulo con una casella il cui valore «attivo» è /Sì (come la crea Acrobat in italiano). */
async function moduloSi() {
  const d = await PDFDocument.create(); const p = d.addPage(); const f = d.getForm();
  const cb = f.createCheckBox('c'); cb.addToPage(p, { x: 50, y: 50, width: 20, height: 20 });
  const w = cb.acroField.getWidgets()[0];
  for (const ap of [w.getAppearances().normal, w.getAppearances().down]) {
    if (!ap) continue;
    const yes = ap.get(PDFName.of('Yes')); ap.delete(PDFName.of('Yes')); ap.set(PDFName.of('Sì'), yes);
  }
  return { d, cb };
}

describe('FDF/XFDF con caselle dal valore non ASCII', () => {
  it('i nomi UTF-8 (/S#C3#AC) si leggono come «Sì» e la casella viene spuntata', async () => {
    const data = parseFDF('%FDF-1.2\n1 0 obj << /FDF << /Fields [ << /T (c) /V /S#C3#AC >> << /T (l) /V /S#EC >> ] >> >> endobj trailer << /Root 1 0 R >> %%EOF');
    expect(data).toEqual({ c: 'Sì', l: 'Sì' });
    const { d, cb } = await moduloSi();
    expect(writeValues(PDFLib, d, { c: data.c })).toMatchObject({ set: 1, failed: [] });
    expect(cb.isChecked()).toBe(true);
  });
  it('un valore sconosciuto non viene contato come applicato', async () => {
    const { d, cb } = await moduloSi();
    cb.check();
    expect(writeValues(PDFLib, d, { c: 'Forse' })).toMatchObject({ set: 0, failed: ['c'] });
    expect(cb.isChecked()).toBe(true);
    expect(writeValues(PDFLib, d, { c: 'No' })).toMatchObject({ set: 1 });
    expect(cb.isChecked()).toBe(false);
  });
  it('l\'esportazione usa il valore attivo vero del campo, non /Yes', async () => {
    const { d, cb } = await moduloSi();
    cb.check();
    const { values, onValues } = readValues(PDFLib, d);
    expect(values).toEqual({ c: true });
    const fdf = toFDF(values, null, onValues);
    expect(fdf).toContain('<< /T (c) /V /S#EC >>');
    expect(serialize('xfdf', values, null, onValues)).toContain('<field name="c"><value>Sì</value></field>');
    // giro completo: ciò che si esporta si reimporta sullo stesso modulo
    cb.uncheck();
    expect(writeValues(PDFLib, d, parseFDF(fdf)).set).toBe(1);
    expect(cb.isChecked()).toBe(true);
    cb.uncheck();
    expect(writeValues(PDFLib, d, parseXFDF(toXFDF(values, null, onValues))).set).toBe(1);
    expect(cb.isChecked()).toBe(true);
    // senza informazioni sul campo resta /Yes
    expect(toFDF({ x: true })).toContain('/V /Yes');
  });
});
