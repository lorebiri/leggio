// Correzioni dalla revisione dell'area sicurezza: oscuramento con aree disegnate, cifratura AES-128, parole chiave.
import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { PDFDocument, StandardFonts } from '@cantoo/pdf-lib';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { pageWords, wordsOutside, buildPageText, rangeRects } from '../src/renderer/features/sicurezza/logica/testo.js';

// pdf.js vuole la barra finale «/» anche su Windows
const FONTS = fileURLToPath(new URL('../node_modules/pdfjs-dist/standard_fonts/', import.meta.url)).replace(/\\/g, '/');

async function textOf(bytes) {
  const t = pdfjs.getDocument({ data: bytes.slice(), standardFontDataUrl: FONTS });
  const d = await t.promise;
  const tc = await (await d.getPage(1)).getTextContent();
  await t.destroy();
  return tc;
}

describe('oscuramento: area disegnata sopra una parola con posizione stimata male', () => {
  it('la parola coperta non resta nel livello di testo invisibile', async () => {
    const d = await PDFDocument.create(); const p = d.addPage([595, 842]); const f = await d.embedFont(StandardFonts.Helvetica);
    const prefix = 'i'.repeat(57) + ' '; const secret = 'ROSSI';
    p.drawText(prefix + secret + ' ' + 'W'.repeat(23), { x: 50, y: 700, size: 12, font: f });
    p.drawText('Riga successiva intatta', { x: 50, y: 680, size: 12, font: f });
    // riquadro disegnato dall'utente sopra la posizione REALE di «ROSSI»
    const x0 = 50 + f.widthOfTextAtSize(prefix, 12); const x1 = x0 + f.widthOfTextAtSize(secret, 12);
    const tc = await textOf(await d.save());
    const words = pageWords(tc.items, tc.styles);
    const keep = wordsOutside(words, [[x0 - 1, 697, x1 + 1, 710]]).map((w) => w.text);
    expect(keep).not.toContain(secret);
    expect(keep).toEqual(expect.arrayContaining(['Riga', 'successiva', 'intatta'])); // la riga vicina resta
  });

  it('le aree trovate con la ricerca tolgono solo le parole trovate', async () => {
    const d = await PDFDocument.create(); const p = d.addPage([595, 842]); const f = await d.embedFont(StandardFonts.Helvetica);
    p.drawText('Codice fiscale: RSSMRA85T10A562S residente a Pisa', { x: 50, y: 700, size: 12, font: f });
    const tc = await textOf(await d.save());
    const pt = buildPageText(tc.items);
    const k = pt.text.indexOf('RSSMRA');
    const keep = wordsOutside(pageWords(tc.items), rangeRects(pt, k, k + 16)).map((w) => w.text);
    expect(keep).toEqual(['Codice', 'fiscale:', 'residente', 'a', 'Pisa']);
  });
});

describe('cifratura AES-128 con password non Latin-1', () => {
  it('rifiuta «€», cirillico e accenti scomposti con un messaggio in italiano che suggerisce AES-256', async () => {
    const { encryptBytes, openDecrypted, passwordAlgorithmProblem } = await import('../src/renderer/features/sicurezza/logica/cifratura.js');
    const d = await PDFDocument.create(); d.addPage(); const plain = await d.save();
    for (const pw of ['pass€word', 'пароль123', 'éte12']) {
      await expect(encryptBytes(plain, { userPassword: pw, algorithm: 'AES-128' })).rejects.toThrow(/AES-256/);
      expect(passwordAlgorithmProblem(pw, 'AES-128')).toMatch(/^La password di apertura contiene caratteri/);
      expect(passwordAlgorithmProblem(pw, 'AES-256')).toBe(null);
    }
    // le lettere accentate Latin-1 restano accettate, e AES-256 accetta tutto
    const ok = await encryptBytes(plain, { userPassword: 'àèìòù12', algorithm: 'AES-128' });
    await expect(openDecrypted(ok.bytes ?? ok, 'àèìòù12')).resolves.toBeTruthy();
    await expect(encryptBytes(plain, { userPassword: 'пароль123', algorithm: 'AES-256' })).resolves.toBeTruthy();
  });
});

describe('parole chiave nelle proprietà', () => {
  it('le virgole restano anche nel dizionario Info', async () => {
    const { readProperties, writeProperties } = await import('../src/renderer/features/sicurezza/logica/metadati.js');
    const d = await PDFDocument.create(); d.addPage();
    writeProperties(d, { ...readProperties(d), keywords: 'privacy, firma digitale' });
    const back = await PDFDocument.load(await d.save(), { updateMetadata: false });
    expect(back.getKeywords()).toBe('privacy, firma digitale');
    expect(readProperties(back).keywords).toBe('privacy, firma digitale');
  });
});
