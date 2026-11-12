import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import * as PDFLib from '@cantoo/pdf-lib';
import { controllaAccessibilita } from '../src/renderer/features/conversione/lib/accessibilita.js';
import { dividiFrasi, statisticheTesto, minutiLettura, formatoPagina } from '../src/renderer/features/conversione/lib/frasi.js';

describe('frasi', () => {
  const w = (s) => s.split(' ');
  it('divide sui punti ma non sulle abbreviazioni e sui numeri', () => {
    const f = dividiFrasi(w('Ai sensi dell’art. 5 del contratto il prezzo è 1.234,56 euro. Il pagamento avviene a 30 giorni. Il dott. Rossi firma! Bene?'));
    expect(f.map((x) => x.text)).toEqual(['Ai sensi dell’art. 5 del contratto il prezzo è 1.234,56 euro.', 'Il pagamento avviene a 30 giorni.', 'Il dott. Rossi firma!', 'Bene?']);
  });
  it('spezza le frasi troppo lunghe e gestisce testo vuoto', () => {
    expect(dividiFrasi([])).toEqual([]);
    const lunga = Array.from({ length: 130 }, (_, i) => 'parola' + i);
    expect(dividiFrasi(lunga).length).toBe(3);
  });
  it('statistiche', () => {
    const s = statisticheTesto('Perché è così? Costa 1.234,56 €.\nFine.');
    expect(s.parole).toBe(6);
    expect(s.frasi).toBe(3);
    expect(minutiLettura(460)).toBe(2);
    expect(minutiLettura(0)).toBe(0);
    expect(formatoPagina(595, 842)).toBe('A4');
    expect(formatoPagina(842, 595)).toBe('A4 orizzontale');
    expect(formatoPagina(300, 300)).toBe('106 × 106 mm');
  });
});

describe('controllo accessibilità', () => {
  it('documento semplice: niente tag né lingua, titolo presente', async () => {
    const doc = await PDFLib.PDFDocument.load(readFileSync('test/fixtures/conv-contratto-v1.pdf'));
    const r = controllaAccessibilita(doc, PDFLib, { pagine: 2, pagineSenzaTesto: [] });
    const by = Object.fromEntries(r.map((x) => [x.id, x]));
    expect(by.tag.ok).toBe(false); expect(by.tag.correzione).toBe('tag');
    expect(by.titolo.ok).toBe(true);
    expect(by.lingua.ok).toBe(false); expect(by.lingua.correzione).toBe('lingua');
    expect(by.testo.ok).toBe(true);
  });
  it('documento con tag, figura senza alt, lingua e titolo', async () => {
    const doc = await PDFLib.PDFDocument.create();
    doc.addPage(); doc.setTitle('Relazione');
    const ctx = doc.context; const N = PDFLib.PDFName.of;
    const fig = ctx.obj({ S: 'Figure' }); const fig2 = ctx.obj({ S: 'Figure', Alt: PDFLib.PDFString.of('Logo') });
    const root = ctx.obj({ Type: 'StructTreeRoot', K: ctx.obj({ S: 'Document', K: ctx.obj([ctx.obj({ S: 'H1' }), fig, fig2]) }) });
    doc.catalog.set(N('StructTreeRoot'), ctx.register(root));
    doc.catalog.set(N('MarkInfo'), ctx.obj({ Marked: true }));
    doc.catalog.set(N('Lang'), PDFLib.PDFString.of('it-IT'));
    const r = controllaAccessibilita(doc, PDFLib, { pagine: 1, pagineSenzaTesto: [0] });
    const by = Object.fromEntries(r.map((x) => [x.id, x]));
    expect(by.tag.ok).toBe(true);
    expect(by.alt.ok).toBe(false); expect(by.alt.titolo).toContain('1 di 2');
    expect(by.lingua.ok).toBe(true);
    expect(by.testo.ok).toBe(false); expect(by.testo.correzione).toBe('ocr');
  });
});
