// Oscuramento dei documenti d'identità: modelli (CIE, carta cartacea, patente), MRZ, filigrana, metadati.
// Il rendering della pagina (canvas) qui non serve: si controlla che testo e immagine originali spariscano.
import { describe, it, expect } from 'vitest';
import { PDFDocument, StandardFonts, PDFStream, PDFName, rgb } from '@cantoo/pdf-lib';
import { fileURLToPath } from 'node:url';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { zoneDocumento, campiDelLato, testoFiligrana, layoutFiligrana, MODELLI_DOCUMENTO, CAMPI_DOCUMENTO, dataItaliana } from '../src/renderer/features/sicurezza/logica/documenti-identita.js';
import { buildMatchers, findMatches } from '../src/renderer/features/sicurezza/logica/modelli.js';
import { buildPageText, pageWords, wordsOutside, intersects } from '../src/renderer/features/sicurezza/logica/testo.js';
import { redactPage, embedTextFont, finalizeRedaction } from '../src/renderer/features/sicurezza/logica/redazione.js';
import { verifyRedaction } from '../src/renderer/features/sicurezza/logica/verifica.js';
import { sanitize } from '../src/renderer/features/sicurezza/logica/sanifica.js';
import { streamBytes } from '../src/renderer/features/sicurezza/logica/pdfutil.js';

const FONTS = fileURLToPath(new URL('../node_modules/pdfjs-dist/standard_fonts/', import.meta.url)).replace(/\\/g, '/');
const PNG = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64'));
// JPEG 8×8 con il commento «FOTO-ORIGINALE» (pdf-lib incorpora i JPEG così come sono): se l'originale
// restasse nel file, quei byte si troverebbero ancora
const FOTO = Uint8Array.from(Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD//gAQRk9UTy1PUklHSU5BTEX/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAAIAAgDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDjKKKK8w9k/9k=', 'base64'));

async function testo(bytes, i = 0) {
  const t = pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false, standardFontDataUrl: FONTS });
  const d = await t.promise; const p = await d.getPage(i + 1); const tc = await p.getTextContent();
  const out = { items: tc.items, view: p.view, text: tc.items.map((x) => x.str).join(' ') };
  await t.destroy(); return out;
}

// Scansione A4 con il retro di una CIE (85,6×54 mm = 243×153 pt) in alto a sinistra e il testo dell'OCR.
const CARD = [60, 600, 60 + 243, 600 + 153];
async function scansioneCie() {
  const d = await PDFDocument.create();
  const p = d.addPage([595, 842]);
  const f = await d.embedFont(StandardFonts.Courier);
  const img = await d.embedPng(PNG);
  p.drawImage(img, { x: CARD[0], y: CARD[1], width: 243, height: 153 }); // la tessera scansionata
  const [x0, , , y1] = CARD; const H = 153;
  // testo come lo metterebbe un OCR, nelle posizioni del retro della CIE
  p.drawText('Codice fiscale RSSMRA85T10A562S', { x: x0 + 6, y: y1 - 0.14 * H, size: 7, font: f });
  p.drawText('Via Roma 12 56124 Pisa (PI)', { x: x0 + 6, y: y1 - 0.40 * H, size: 7, font: f });
  p.drawText('IDITACA00000AA4<<<<<<<<<<<<<<<', { x: x0 + 6, y: y1 - 0.70 * H, size: 8, font: f });
  p.drawText('8512105M3101011ITA<<<<<<<<<<<0', { x: x0 + 6, y: y1 - 0.80 * H, size: 8, font: f });
  p.drawText('ROSSI<<MARIO<<<<<<<<<<<<<<<<<<', { x: x0 + 6, y: y1 - 0.90 * H, size: 8, font: f });
  p.drawText('Dichiarazione allegata alla domanda', { x: 60, y: 400, size: 12, font: f });
  d.setTitle('Scansione CIE di Mario Rossi'); d.setAuthor('Mario Rossi'); d.setCreator('Scanner XYZ'); d.setProducer('Scanner XYZ');
  return new Uint8Array(await d.save());
}

describe('modelli dei documenti d\'identità', () => {
  it('tutti i modelli hanno zone dentro la tessera e i campi previsti', () => {
    expect(MODELLI_DOCUMENTO.map((m) => m.id)).toEqual(['cie', 'cartacea', 'patente']);
    for (const m of MODELLI_DOCUMENTO) for (const [, zone] of Object.entries(m.lati)) for (const [campo, rr] of Object.entries(zone)) {
      expect(CAMPI_DOCUMENTO.some((c) => c.id === campo)).toBe(true);
      for (const r of rr) { expect(r[0]).toBeGreaterThanOrEqual(0); expect(r[3]).toBeLessThanOrEqual(1); expect(r[2]).toBeGreaterThan(r[0]); expect(r[3]).toBeGreaterThan(r[1]); }
    }
    expect(campiDelLato('cie', 'retro').map((c) => c.id)).toEqual(expect.arrayContaining(['mrz', 'cf', 'indirizzo', 'numero']));
    expect(campiDelLato('cie', 'fronte').map((c) => c.id)).toEqual(expect.arrayContaining(['numero', 'foto', 'firma']));
    expect(campiDelLato('patente', 'fronte').map((c) => c.id)).toEqual(expect.arrayContaining(['numero', 'foto', 'firma']));
    expect(campiDelLato('cartacea', 'interno').map((c) => c.id)).toEqual(expect.arrayContaining(['numero', 'foto', 'firma', 'indirizzo']));
  });

  it('le zone stanno nel riquadro disegnato, anche con la tessera ruotata', () => {
    const z = zoneDocumento('cie', 'retro', ['mrz'], CARD);
    expect(z).toHaveLength(1);
    const [a, b, c, d] = z[0].rect;
    expect(a).toBeLessThanOrEqual(CARD[0]); expect(c).toBeGreaterThanOrEqual(CARD[2] - 0.01);
    expect(b).toBeLessThan(CARD[1] + 5); // MRZ in basso
    expect(d).toBeLessThan(CARD[1] + 0.4 * 153 + 5);
    // ruotata di 90°: la MRZ (in basso sulla tessera dritta) finisce a sinistra
    const rot = zoneDocumento('cie', 'retro', ['mrz'], [0, 0, 153, 243], { orientamento: 90 });
    expect(rot[0].rect[0]).toBeLessThan(1);
    expect(rot[0].rect[2]).toBeLessThan(0.45 * 153);
    expect(() => zoneDocumento('cie', 'interno', ['mrz'], CARD)).toThrow(/Lato/);
  });

  it('modelli di ricerca: MRZ e numeri di documento', () => {
    const t = 'IDITACA00000AA4<<<<<<<<<<<<<<< 8512105M3101011ITA<<<<<<<<<<<0 ROSSI<<MARIO<<<<<< testo normale CA12345AB AX 1234567';
    const hits = findMatches(t, buildMatchers({ models: ['mrz', 'docid'] })).map((h) => h.text);
    expect(hits).toEqual(['IDITACA00000AA4<<<<<<<<<<<<<<<', '8512105M3101011ITA<<<<<<<<<<<0', 'ROSSI<<MARIO<<<<<<', 'CA12345AB', 'AX 1234567']);
    expect(findMatches('Nessun dato <<qui>> e A<B', buildMatchers({ models: ['mrz'] }))).toEqual([]);
  });

  it('testo della filigrana e disposizione su tutta la pagina', () => {
    expect(testoFiligrana({ destinatario: '  Comune di Pisa ', finalita: 'per pratica TARI', data: '18/11/2026' })).toBe('Copia per uso esclusivo di Comune di Pisa – per pratica TARI – 18/11/2026');
    expect(testoFiligrana({ destinatario: '' })).toBe('');
    expect(dataItaliana(new Date(2026, 0, 5))).toBe('05/01/2026');
    const l = layoutFiligrana(1240, 1754, 'Copia per uso esclusivo di Comune di Pisa');
    expect(l.angolo).toBeLessThan(0);
    // le righe coprono tutta la diagonale
    expect(l.righe[0].y).toBeLessThanOrEqual(-l.diag / 2 + 1);
    expect(l.righe[l.righe.length - 1].y).toBeGreaterThanOrEqual(l.diag / 2 - l.dimensione * 6.5);
  });
});

describe('oscuramento vero di una CIE scansionata', () => {
  it('testo e immagine sotto le zone spariscono dal file, i metadati personali pure', async () => {
    const src = await scansioneCie();
    const zone = zoneDocumento('cie', 'retro', ['cf', 'indirizzo', 'mrz'], CARD);
    const rects = zone.map((z) => z.rect);
    const before = await testo(src);
    // le zone del modello coprono davvero i dati scritti (CF, indirizzo, MRZ)
    for (const s of ['RSSMRA85T10A562S', 'Roma', 'IDITACA00000AA4', 'ROSSI<<MARIO']) {
      const it = before.items.find((x) => x.str.includes(s));
      expect(it, s).toBeTruthy();
      const [, , , , e, f] = it.transform;
      expect(rects.some((r) => intersects([e, f, e + it.width, f + 6], r))).toBe(true);
    }
    const pdfDoc = await PDFDocument.load(src, { updateMetadata: false });
    const font = await embedTextFont(pdfDoc);
    const keep = wordsOutside(pageWords(before.items), rects);
    // l'immagine della pagina (in produzione: il rendering con le aree nere e la filigrana) SOSTITUISCE il contenuto
    await redactPage(pdfDoc, 0, { image: { bytes: PNG, kind: 'png' }, view: before.view, rects, keepWords: keep, font });
    sanitize(pdfDoc, {});
    await finalizeRedaction(pdfDoc);
    const out = await pdfDoc.save({ useObjectStreams: true });
    const after = await testo(out);
    for (const s of ['RSSMRA85T10A562S', 'Roma', '56124', 'IDITACA', 'ROSSI<<MARIO', '8512105M']) expect(after.text).not.toContain(s);
    expect(after.text).toContain('Dichiarazione allegata'); // fuori dalle zone: resta ricercabile
    const v = await verifyRedaction(pdfjs, out, new Map([[0, rects]]), ['RSSMRA85T10A562S', 'IDITACA00000AA4'], { getDocumentOptions: { standardFontDataUrl: FONTS } });
    expect(v.ok).toBe(true);
    // nessun flusso contiene ancora i dati o l'immagine originale
    const again = await PDFDocument.load(out, { updateMetadata: false });
    for (const [, obj] of again.context.enumerateIndirectObjects()) {
      if (!(obj instanceof PDFStream)) continue;
      const b = streamBytes(obj); if (!b) continue;
      const s = Buffer.from(b).toString('latin1');
      expect(s.includes('RSSMRA') || s.includes('IDITACA') || s.includes('FOTO-ORIGINALE')).toBe(false);
    }
    // metadati: niente titolo, autore, programma
    expect(again.getTitle()).toBeUndefined();
    expect(again.getAuthor()).toBeUndefined();
    expect(again.getCreator()).toBeUndefined();
    expect(again.getProducer()).toBeUndefined();
    expect(Buffer.from(out).toString('latin1')).not.toMatch(/Mario Rossi|Scanner XYZ/);
    expect(again.catalog.get(PDFName.of('Metadata'))).toBeUndefined();
  });

  it('l\'immagine originale (foto) sotto le zone viene eliminata, non solo coperta', async () => {
    const d = await PDFDocument.create();
    const p = d.addPage([595, 842]);
    const img = await d.embedJpg(FOTO);
    p.drawImage(img, { x: CARD[0], y: CARD[1], width: 243, height: 153 });
    p.drawRectangle({ x: 10, y: 10, width: 5, height: 5, color: rgb(0, 0, 0) });
    const src = new Uint8Array(await d.save());
    expect(Buffer.from(src).toString('latin1')).toContain('FOTO-ORIGINALE');
    const pdfDoc = await PDFDocument.load(src, { updateMetadata: false });
    const font = await embedTextFont(pdfDoc);
    const rects = zoneDocumento('cie', 'fronte', ['foto', 'firma', 'numero'], CARD).map((z) => z.rect);
    await redactPage(pdfDoc, 0, { image: { bytes: PNG, kind: 'png' }, view: [0, 0, 595, 842], rects, keepWords: [], font });
    await finalizeRedaction(pdfDoc);
    const out = await pdfDoc.save();
    expect(Buffer.from(out).toString('latin1')).not.toContain('FOTO-ORIGINALE');
  });
});
