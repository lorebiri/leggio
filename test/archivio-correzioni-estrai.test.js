// Correzioni: importi in formato inglese, protezione dalle formule nel CSV degli stati.
import { describe, it, expect } from 'vitest';
import { trovaImporto } from '../src/renderer/features/archivio/lib/estrai.js';
import { esportaCsv, importa, applica } from '../src/renderer/features/archivio/lib/stati.js';

describe('trovaImporto', () => {
  it('importi in formato inglese: niente numeri presi a metà', () => {
    expect(trovaImporto('Invoice. Totale documento EUR 1,234.56')).toBe(1234.56);
    expect(trovaImporto('Totale fattura 12,345.00 €')).toBe(12345);
    expect(trovaImporto('Totale documento € 1.234,56')).toBe(1234.56);
    expect(trovaImporto('Totale documento 1234.56')).toBe(1234.56);
    expect(trovaImporto('Totale documento 99,90 euro.')).toBe(99.9);
  });
});

describe('esportaCsv degli stati', () => {
  const H = 'a'.repeat(64);
  it('note e nomi che iniziano con = + - @ non diventano formule, e si reimportano uguali', () => {
    const stati = new Map([[H, applica(null, { imposta: 'da-pagare', nota: '=HYPERLINK("http://x";"y")' }, 10)]]);
    const csv = esportaCsv(stati, { [H]: [{ nome: '+cmd.pdf', percorso: '@x/+cmd.pdf' }] });
    const riga = csv.split(/\r?\n/)[1];
    expect(riga).toContain(`"'+cmd.pdf"`);
    expect(riga).toContain(`"'@x/+cmd.pdf"`);
    expect(riga).toContain(`"'=HYPERLINK(""http://x"";""y"")"`);
    expect(importa(csv).voci.get(H).nota).toBe('=HYPERLINK("http://x";"y")');
  });
});
