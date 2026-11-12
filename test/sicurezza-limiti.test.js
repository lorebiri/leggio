// Casi limite: password del proprietario, file danneggiati, documenti senza testo, input strani.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PDFDocument, StandardFonts } from '@cantoo/pdf-lib';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { encryptBytes, openDecrypted } from '../src/renderer/features/sicurezza/logica/cifratura.js';
import { passwordRoles } from '../src/renderer/features/sicurezza/logica/proprietario.js';
import { rewriteWithPdfLib, probeWithPdfjs, rebuildFromPdfjs } from '../src/renderer/features/sicurezza/logica/ripara.js';
import { buildPageText, pageWords, wordsOutside, rangeRects } from '../src/renderer/features/sicurezza/logica/testo.js';
import { verifyRedaction } from '../src/renderer/features/sicurezza/logica/verifica.js';
import { analyze, sanitize } from '../src/renderer/features/sicurezza/logica/sanifica.js';
import { compressImages } from '../src/renderer/features/sicurezza/logica/comprimi.js';

const FONTS = fileURLToPath(new URL('../node_modules/pdfjs-dist/standard_fonts/', import.meta.url));
const prova = new Uint8Array(readFileSync(new URL('./fixtures/prova.pdf', import.meta.url)));
const PNG = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64'));

describe('password del proprietario', () => {
  for (const algorithm of ['AES-256', 'AES-128']) {
    it(`${algorithm}: distingue apertura, proprietario, errata`, async () => {
      const out = await encryptBytes(prova, { userPassword: 'utente', ownerPassword: 'padrone', algorithm, permissions: { stampa: 'none' } });
      expect(await passwordRoles(out, 'utente')).toEqual({ user: true, owner: false });
      expect(await passwordRoles(out, 'padrone')).toEqual({ user: false, owner: true });
      expect(await passwordRoles(out, 'boh')).toEqual({ user: false, owner: false });
    });
  }
  it('documento non cifrato: tutto consentito', async () => {
    expect(await passwordRoles(prova, '')).toEqual({ owner: true, user: true });
  });
});

describe('ripara', () => {
  it('ricostruisce un file con tabella xref e trailer rovinati', async () => {
    const s = Buffer.from(prova).toString('latin1');
    const cut = s.lastIndexOf('startxref');
    const broken = new Uint8Array(Buffer.concat([Buffer.from(prova).subarray(0, cut), Buffer.from('startxref\n999999\n%%EOF')]));
    const fixed = await rewriteWithPdfLib(broken);
    expect(fixed).not.toBeNull();
    const pr = await probeWithPdfjs(pdfjs, fixed, { standardFontDataUrl: FONTS });
    expect(pr).toMatchObject({ pages: 6, ok: 6 });
  });
  it('file troncato a metà: almeno non lancia eccezioni', async () => {
    const half = prova.subarray(0, Math.floor(prova.length / 2));
    await expect(rewriteWithPdfLib(half)).resolves.toBeDefined();
    const pr = await probeWithPdfjs(pdfjs, half);
    expect(typeof pr.pages).toBe('number');
    const junk = new Uint8Array(5000).fill(65);
    expect(await rewriteWithPdfLib(junk)).toBeNull();
    expect((await probeWithPdfjs(pdfjs, junk)).pages).toBe(0);
  });
  it('ricostruzione dalle pagine con rasterizzatore (finto) mantiene il testo ricercabile', async () => {
    const r = await rebuildFromPdfjs(pdfjs, prova, async (pdf, i) => ({ bytes: PNG, kind: 'png', view: (await pdf.getPage(i + 1)).view }), { getDocumentOptions: { standardFontDataUrl: FONTS } });
    expect(r.pages).toBe(6); expect(r.failed).toEqual([]);
    const t = pdfjs.getDocument({ data: r.bytes, standardFontDataUrl: FONTS }); const d = await t.promise;
    const txt = (await (await d.getPage(3)).getTextContent()).items.map((x) => x.str).join(' ');
    await t.destroy();
    expect(txt).toContain('Pagina'); expect(txt).toContain('formato');
  });
});

describe('testo e verifica: casi limite', () => {
  it('testo ruotato e pagina senza testo', async () => {
    const d = await PDFDocument.create(); const f = await d.embedFont(StandardFonts.Helvetica);
    const p = d.addPage([595, 842]);
    const { degrees } = await import('@cantoo/pdf-lib');
    p.drawText('VERTICALE RSSMRA85T10A562S', { x: 100, y: 100, size: 14, font: f, rotate: degrees(90) });
    d.addPage([595, 842]); // vuota
    const bytes = await d.save();
    const t = pdfjs.getDocument({ data: bytes.slice(), standardFontDataUrl: FONTS }); const doc = await t.promise;
    const tc = await (await doc.getPage(1)).getTextContent();
    const pt = buildPageText(tc.items);
    const k = pt.text.indexOf('RSSMRA');
    const rects = rangeRects(pt, k, k + 16);
    expect(rects[0][2] - rects[0][0]).toBeLessThan(30); // stretto in orizzontale
    expect(rects[0][3] - rects[0][1]).toBeGreaterThan(80); // lungo in verticale
    const words = pageWords(tc.items);
    expect(wordsOutside(words, rects).map((w) => w.text)).toEqual(['VERTICALE']);
    expect((await (await doc.getPage(2)).getTextContent()).items).toEqual([]);
    await t.destroy();
    const v = await verifyRedaction(pdfjs, bytes, new Map([[0, rects]]), [], { getDocumentOptions: { standardFontDataUrl: FONTS } });
    expect(v.ok).toBe(false); // nessuna redazione applicata: il testo è ancora lì
  });
  it('termini brevi o vuoti non generano falsi allarmi', async () => {
    const v = await verifyRedaction(pdfjs, prova, new Map(), ['', 'a', 'di'], { getDocumentOptions: { standardFontDataUrl: FONTS } });
    expect(v.ok).toBe(true);
  });
  it('verifica annullabile', async () => {
    const c = new AbortController(); c.abort();
    await expect(verifyRedaction(pdfjs, prova, new Map(), ['x'], { signal: c.signal, getDocumentOptions: { standardFontDataUrl: FONTS } })).rejects.toThrow();
  });
});

describe('documenti cifrati nelle altre funzioni', () => {
  it('sanifica e comprime anche un documento con sole restrizioni (password vuota)', async () => {
    const enc = await encryptBytes(prova, { permissions: { copia: false } });
    const { doc } = await openDecrypted(enc, '');
    const a = analyze(doc, enc);
    expect(a.metadati).toBeGreaterThan(0);
    sanitize(doc, {});
    const st = await compressImages(doc, { codec: { recompress: async () => null } });
    expect(st.images).toBe(0);
    const out = await doc.save();
    const t = pdfjs.getDocument({ data: out, standardFontDataUrl: FONTS }); const d = await t.promise;
    expect(d.numPages).toBe(6); await t.destroy();
  });
});
