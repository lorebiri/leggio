import { describe, it, expect } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { writeFileSync } from 'node:fs';
import { creaDocx } from '../src/renderer/features/conversione/lib/docx.js';

describe('esportazione Word', () => {
  it('titoli, paragrafi con stili, elenchi, tabelle, interruzioni di pagina, immagine', async () => {
    const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));
    const b = await creaDocx([
      { width: 595, height: 842, blocks: [
        { type: 'heading', level: 1, text: 'Titolo', runs: [{ text: 'Titolo', bold: true }] },
        { type: 'paragraph', text: 'Perché è così', runs: [{ text: 'Perché ' }, { text: 'è così', italic: true }] },
        { type: 'list', ordered: false, text: 'voce', runs: [{ text: 'voce' }] },
        { type: 'table', rows: [['A', 'B'], ['1,00 €', '2']] }] },
      { width: 595, height: 842, blocks: [], image: { data: png, type: 'png', wPx: 1, hPx: 1 } },
    ], { title: 'Prova' });
    if (process.env.LEGGIO_DOCX_OUT) writeFileSync(process.env.LEGGIO_DOCX_OUT, b);
    const z = unzipSync(b);
    const xml = strFromU8(z['word/document.xml']);
    expect(xml).toContain('w:val="Heading1"');
    expect(xml).toContain('<w:i/>');
    expect(xml).toContain('Perché ');
    expect(xml).toContain('<w:tbl>');
    expect(xml).toContain('<w:pageBreakBefore/>');
    expect(xml).toContain('<w:numPr>');
    expect(Object.keys(z).some((k) => k.startsWith('word/media/'))).toBe(true);
  });
  it('documento senza pagine non esplode', async () => {
    const b = await creaDocx([]);
    expect(b.length).toBeGreaterThan(1000);
  });
});
