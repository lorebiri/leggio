// Riconoscimento dei PDF firmati (avviso centralizzato in applyEdit).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { isSignedPdf } from '../src/renderer/core/signature.js';

const enc = (s) => new TextEncoder().encode(s);

describe('isSignedPdf', () => {
  it('firma presente: dizionario con /ByteRange [ … ]', () => {
    expect(isSignedPdf(enc('%PDF-1.7\n5 0 obj\n<< /Type /Sig /Filter /Adobe.PPKLite /ByteRange [0 840 960 240] /Contents <3082> >>\nendobj\n'))).toBe(true);
    expect(isSignedPdf(enc('<< /ByteRange\n  [ 0 1 2 3 ] >>'))).toBe(true);
  });
  it('campo firma vuoto o PDF normale: non firmato', () => {
    expect(isSignedPdf(enc('%PDF-1.7\n<< /FT /Sig /T (Firma1) /Rect [0 0 100 40] >>'))).toBe(false);
    expect(isSignedPdf(new Uint8Array(readFileSync('test/fixtures/prova.pdf')))).toBe(false);
    expect(isSignedPdf(new Uint8Array())).toBe(false);
    expect(isSignedPdf(enc('testo che parla di /ByteRange senza array'))).toBe(false);
  });
  it('è veloce anche su file grandi (scansione a byte)', () => {
    const big = new Uint8Array(50 * 1024 * 1024).fill(0x2f); // pieno di «/» (caso peggiore)
    const t = performance.now();
    expect(isSignedPdf(big)).toBe(false);
    expect(performance.now() - t).toBeLessThan(3000);
  });
});
