import { describe, it, expect } from 'vitest';
import { payloadLimit, planSends, minSends, BASE64_OVERHEAD } from '../src/renderer/features/sicurezza/logica/pec.js';

describe('Prepara per PEC: calcoli', () => {
  it('limite utile degli allegati tiene conto della codifica base64', () => {
    const l = payloadLimit(30);
    expect(l).toBeLessThan(30e6 / 1.33);
    expect(l * BASE64_OVERHEAD).toBeLessThanOrEqual(30e6);
    expect(payloadLimit(0)).toBe(0);
    expect(payloadLimit('abc')).toBe(0);
  });
  it('divide in invii con il minimo numero di messaggi e segnala i file troppo grandi', () => {
    const MB = 1e6;
    const sizes = [9 * MB, 8 * MB, 5 * MB, 4 * MB, 3 * MB, 2 * MB, 25 * MB];
    const { sends, tooBig } = planSends(sizes, 15 * MB);
    expect(tooBig).toEqual([6]);
    expect(sends.length).toBe(minSends(31 * MB, 15 * MB) /* 3 */);
    for (const s of sends) expect(s.reduce((t, i) => t + sizes[i], 0)).toBeLessThanOrEqual(15 * MB);
    expect(sends.flat().sort()).toEqual([0, 1, 2, 3, 4, 5]);
  });
  it('casi limite', () => {
    expect(planSends([], 10)).toEqual({ sends: [], tooBig: [] });
    expect(planSends([10, 10], 10).sends.length).toBe(2);
    expect(planSends([1, 1, 1], 0).tooBig).toEqual([0, 1, 2]);
  });
});

describe('cifratura in blocco con chiave riusata', () => {
  it('più file con la stessa password: veloci, apribili, identificativi diversi', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const { encryptBytes, forgetReusedKeys, openDecrypted } = await import('../src/renderer/features/sicurezza/logica/cifratura.js');
    const FONTS = fileURLToPath(new URL('../node_modules/pdfjs-dist/standard_fonts/', import.meta.url)).replace(/\\/g, '/');
    const prova = new Uint8Array(readFileSync(new URL('./fixtures/prova.pdf', import.meta.url)));
    const opts = { reuseKey: true, userPassword: 'lotto2026', permissions: { copia: false } };
    const a = await encryptBytes(prova, opts);
    const b = await encryptBytes(prova, opts);
    // chiave riusata (niente misure di tempo: inaffidabili sotto carico): voci /O e /U identiche
    const voce = (x, k) => Buffer.from(x).toString('latin1').match(new RegExp(`/${k}\\s*<([0-9A-Fa-f]+)>`))?.[1];
    expect(voce(a, 'O')).toBeTruthy();
    expect(voce(a, 'O')).toBe(voce(b, 'O'));
    expect(voce(a, 'U')).toBe(voce(b, 'U'));
    for (const x of [a, b]) {
      const t = pdfjs.getDocument({ data: new Uint8Array(x), password: 'lotto2026', standardFontDataUrl: FONTS }); const d = await t.promise;
      expect((await d.getMetadata()).info.Title).toBe('Documento di prova');
      await t.destroy();
      expect((await openDecrypted(x, 'lotto2026')).doc.getPageCount()).toBe(6);
    }
    const id = (x) => Buffer.from(x).toString('latin1').match(/\/ID\s*\[\s*<([0-9A-Fa-f]+)>/)?.[1];
    expect(id(a)).not.toBe(id(b));
    forgetReusedKeys();
  });
});
