import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import * as PDFLib from '@cantoo/pdf-lib';
import { estraiTesto, testoDaContenuto } from '../src/renderer/features/conversione/lib/estrai-testo.js';

const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
globalThis.pdfjsWorker = await import('pdfjs-dist/legacy/build/pdf.worker.mjs');

describe('testo da getTextContent', () => {
  it('righe, spazi e caratteri nulli', () => {
    expect(testoDaContenuto({ items: [{ str: 'Ciao', hasEOL: false }, { str: 'mondo', hasEOL: true }, { str: 'riga\u0000  due', hasEOL: true }, {}] })).toBe('Ciao mondo\nriga due');
    expect(testoDaContenuto(null)).toBe('');
  });
});

describe('estrazione del testo per l’indicizzazione', () => {
  it('testo per pagina, metadati, nessuna scansione', async () => {
    const r = await estraiTesto(pdfjs, readFileSync('test/fixtures/conv-contratto-v1.pdf'));
    expect(r.numPagine).toBe(2);
    expect(r.pagine[0].testo).toContain('Contratto di fornitura n. 2026/118');
    expect(r.pagine[0].testo).toContain('Sesto Fiorentino');
    expect(r.pagine[0].senzaTesto).toBe(false);
    expect(r.info.titolo).toBe('Contratto di fornitura');
    expect(r.scansione).toBe(false);
  });
  it('scansione riconosciuta (anche con il controllo delle immagini)', async () => {
    const b = readFileSync('test/fixtures/conv-scansione.pdf');
    const r = await estraiTesto(pdfjs, b, { controllaImmagini: true });
    expect(r.scansione).toBe(true);
    expect(r.pagine.every((p) => p.scansione)).toBe(true);
  });
  it('pagina bianca: senza testo ma non scansione se si controllano le immagini', async () => {
    const d = await PDFLib.PDFDocument.create(); d.addPage();
    const r = await estraiTesto(pdfjs, await d.save(), { controllaImmagini: true });
    expect(r.pagine[0]).toMatchObject({ senzaTesto: true, scansione: false });
  });
  it('file danneggiato e protetto → errore con codice', async () => {
    await expect(estraiTesto(pdfjs, new TextEncoder().encode('%PDF-1.7 rotto'))).rejects.toMatchObject({ codice: 'danneggiato' });
    const d = await PDFLib.PDFDocument.create(); d.addPage().drawText('segreto');
    d.encrypt({ userPassword: 'abcd', ownerPassword: 'xyz123' });
    const enc = await d.save();
    await expect(estraiTesto(pdfjs, enc)).rejects.toMatchObject({ codice: 'password' });
    const ok = await estraiTesto(pdfjs, enc, { password: 'abcd' });
    expect(ok.pagine[0].testo).toContain('segreto');
  });
  it('limite di pagine', async () => {
    const r = await estraiTesto(pdfjs, readFileSync('test/fixtures/conv-contratto-v1.pdf'), { maxPagine: 1 });
    expect(r.pagine).toHaveLength(1); expect(r.numPagine).toBe(2);
  });
});
