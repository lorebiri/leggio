// openPdfLib decifra davvero i file cifrati con sole restrizioni (password utente vuota).
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { PDFDocument, StandardFonts, degrees } from '@cantoo/pdf-lib';
import { openPdfLib } from '../src/renderer/core/pdflib.js';

const require = createRequire(import.meta.url);
pdfjs.GlobalWorkerOptions.workerSrc = (await import('node:url')).pathToFileURL(require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs')).href;

async function make(userPassword) {
  const d = await PDFDocument.create(); const f = await d.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < 2; i++) d.addPage([300, 300]).drawText('Pagina ' + (i + 1), { x: 20, y: 250, size: 18, font: f });
  d.encrypt({ userPassword, ownerPassword: 'proprietario', permissions: { modifying: false } });
  return d.save();
}
async function read(bytes, password) {
  const t = pdfjs.getDocument({ data: bytes.slice(), password, verbosity: 0 });
  const pdf = await t.promise;
  const out = [];
  for (let i = 1; i <= pdf.numPages; i++) { const p = await pdf.getPage(i); const tc = await p.getTextContent(); out.push({ rotate: p.rotate, text: tc.items.map((x) => x.str).join('') }); }
  await t.destroy();
  return out;
}

describe('openPdfLib e cifratura', () => {
  it('solo password del proprietario: si ruota una pagina e il file si riapre pulito', async () => {
    const enc = await make('');
    const doc = await openPdfLib(enc);
    expect(doc.isEncrypted).toBe(false);
    doc.getPage(0).setRotation(degrees(90));
    doc.addPage([300, 300]).drawText('Nuova', { x: 20, y: 250, size: 18, font: await doc.embedFont(StandardFonts.Helvetica) });
    const out = await doc.save({ useObjectStreams: true });
    const pages = await read(out); // senza password: il risultato è in chiaro e coerente
    expect(pages.map((p) => p.rotate)).toEqual([90, 0, 0]);
    expect(pages.map((p) => p.text)).toEqual(['Pagina 1', 'Pagina 2', 'Nuova']);
  });
  it('password di apertura nota: decifra', async () => {
    const enc = await make('utente');
    const doc = await openPdfLib(enc, 'utente');
    doc.getPage(1).setRotation(degrees(180));
    const pages = await read(await doc.save());
    expect(pages[1].rotate).toBe(180);
    expect(pages[0].text).toBe('Pagina 1');
  });
  it('modifiche ripetute (anche dopo una riprotezione al salvataggio): nessun /Encrypt incoerente', async () => {
    for (const pw of ['', 'utente']) {
      let bytes = await make(pw);
      for (let k = 0; k < 3; k++) {
        const doc = await openPdfLib(bytes, pw || undefined);
        doc.getPage(k % 2).setRotation(degrees(90 * (k + 1)));
        bytes = await doc.save({ useObjectStreams: true });
        if (k === 1) { // come il save hook dell'area sicurezza: si cifra di nuovo
          const again = await openPdfLib(bytes, pw || undefined);
          again.encrypt({ userPassword: pw, ownerPassword: 'proprietario' });
          bytes = await again.save();
        }
      }
      const pages = await read(bytes, pw || undefined);
      expect(pages.map((p) => p.text)).toEqual(['Pagina 1', 'Pagina 2']);
      expect(pages[0].rotate).toBe(270);
    }
  });
  it('password di apertura mancante: errore chiaro, nessun file misto', async () => {
    const enc = await make('utente');
    await expect(openPdfLib(enc)).rejects.toThrow(/protetto|cifrato|password/i);
  });
  it('file non cifrato: invariato', async () => {
    const d = await PDFDocument.create(); d.addPage();
    const doc = await openPdfLib(await d.save());
    expect(doc.getPageCount()).toBe(1);
  });
});
