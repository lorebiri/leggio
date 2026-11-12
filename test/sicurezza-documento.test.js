import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PDFDocument, StandardFonts, PDFName, PDFString, PDFRawStream, PDFRef } from '@cantoo/pdf-lib';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { encryptBytes, openDecrypted, PasswordError, encryptDoc } from '../src/renderer/features/sicurezza/logica/cifratura.js';
import { encryptionInfo, countSignatures, removeUnreachable } from '../src/renderer/features/sicurezza/logica/pdfutil.js';
import { analyze, sanitize, countRevisions } from '../src/renderer/features/sicurezza/logica/sanifica.js';
import { readProperties, writeProperties } from '../src/renderer/features/sicurezza/logica/metadati.js';
import { listAttachments, addAttachment, removeAttachment, readAttachment } from '../src/renderer/features/sicurezza/logica/allegati.js';
import { compressImages, cleanupStructure, classifyImage, unpredictPng, searchUnderLimit, imageUsage } from '../src/renderer/features/sicurezza/logica/comprimi.js';

// pdf.js vuole la barra finale «/» anche su Windows
const FONTS = fileURLToPath(new URL('../node_modules/pdfjs-dist/standard_fonts/', import.meta.url)).replace(/\\/g, '/');
const prova = new Uint8Array(readFileSync(new URL('./fixtures/prova.pdf', import.meta.url)));
const keys = (x) => (x instanceof Map ? [...x.keys()] : Object.keys(x || {}));
const open = (data, password) => pdfjs.getDocument({ data: new Uint8Array(data), password, isEvalSupported: false, standardFontDataUrl: FONTS });
async function firstText(data, password) {
  const t = open(data, password); const d = await t.promise;
  const tc = await (await d.getPage(1)).getTextContent();
  const meta = await d.getMetadata(); const n = d.numPages; const perms = await d.getPermissions();
  await t.destroy();
  return { text: tc.items.map((i) => i.str).join(' '), title: meta.info.Title, n, perms };
}

describe('protezione con password', () => {
  for (const algorithm of ['AES-256', 'AES-128']) {
    it(`${algorithm}: si riapre con la password, metadati leggibili, permessi applicati`, async () => {
      const out = await encryptBytes(prova, { userPassword: 'Apri-Subito 7', ownerPassword: 'padrone!', algorithm, permissions: { stampa: 'low', copia: false, modifica: false, commenti: true, moduli: true, assemblaggio: false } });
      const r = await firstText(out, 'Apri-Subito 7');
      expect(r.n).toBe(6);
      expect(r.text).toContain('Pagina 1');
      expect(r.title).toBe('Documento di prova'); // stringhe cifrate correttamente (difetto del fork corretto)
      expect([...r.perms]).not.toContain(16); // copia non consentita
      await expect(open(out, 'sbagliata').promise).rejects.toThrow();
      await expect(open(out).promise).rejects.toThrow();
      // decifratura con password di apertura e del proprietario
      for (const pw of ['Apri-Subito 7', 'padrone!']) {
        const { doc, info } = await openDecrypted(out, pw);
        expect(info.algorithm).toBe(algorithm);
        expect(doc.getTitle()).toBe('Documento di prova');
        const plain = await doc.save();
        expect((await firstText(plain)).title).toBe('Documento di prova');
      }
      await expect(openDecrypted(out, 'no')).rejects.toBeInstanceOf(PasswordError);
    });
  }
  it('solo restrizioni (senza password di apertura): si apre senza password, owner casuale generata', async () => {
    const out = await encryptBytes(prova, { permissions: { stampa: 'none', copia: false } });
    expect(out.ownerPassword.length).toBeGreaterThanOrEqual(24);
    const r = await firstText(out);
    expect(r.text).toContain('Pagina 1');
    expect([...r.perms]).not.toContain(4);
    const { doc } = await openDecrypted(out, '');
    expect(doc.getPageCount()).toBe(6);
  });
  it('casi limite: già cifrato, password uguali, nessuna protezione', async () => {
    const out = await encryptBytes(prova, { userPassword: 'a' });
    await expect(encryptBytes(out, { userPassword: 'b' })).rejects.toThrow(/già cifrato/);
    const d = await PDFDocument.load(prova);
    expect(() => encryptDoc(d, { userPassword: 'x', ownerPassword: 'x', permissions: { stampa: 'none' } })).toThrow(/diversa/);
    expect(() => encryptDoc(d, {})).toThrow(/almeno/);
    await expect(openDecrypted(new Uint8Array([1, 2, 3]), '')).rejects.toThrow(/PDF valido/);
    // password con caratteri accentati ed emoji
    const u = await encryptBytes(prova, { userPassword: 'perché ☕ città' });
    expect((await firstText(u, 'perché ☕ città')).n).toBe(6);
  });
  it('documento non cifrato: openDecrypted restituisce info null', async () => {
    const { info } = await openDecrypted(prova, '');
    expect(info).toBeNull();
  });
});

async function docWithEverything() {
  const doc = await PDFDocument.load(prova);
  const ctx = doc.context;
  doc.setAuthor('Mario Rossi'); doc.setKeywords(['interno']);
  doc.addJavaScript('saluto', 'app.alert("ciao")');
  doc.catalog.set(PDFName.of('OpenAction'), ctx.obj({ S: 'JavaScript', JS: PDFString.of('app.alert(1)') }));
  await doc.attach(new TextEncoder().encode('<fattura/>'), 'fattura.xml', { mimeType: 'application/xml', description: 'XML' });
  const p = doc.getPage(0);
  const note = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Text', Rect: [10, 10, 30, 30], Contents: PDFString.of('commento riservato') }));
  const link = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Link', Rect: [50, 50, 150, 70], A: { S: 'URI', URI: PDFString.of('https://www.cnr.it') } }));
  const annots = p.node.Annots(); annots.push(note); annots.push(link);
  // livello nascosto con testo segreto
  const ocg = ctx.register(ctx.obj({ Type: 'OCG', Name: PDFString.of('Bozza') }));
  doc.catalog.set(PDFName.of('OCProperties'), ctx.obj({ OCGs: [ocg], D: { OFF: [ocg], Order: [ocg] } }));
  const res = p.node.Resources();
  res.set(PDFName.of('Properties'), ctx.obj({ oc1: ocg }));
  const font = await doc.embedFont(StandardFonts.Helvetica);
  p.drawText('testo nel livello', { x: 300, y: 100, size: 10, font });
  const helvName = [...res.lookup(PDFName.of('Font')).keys()].pop().decodeText();
  const cs = ctx.flateStream(`/OC /oc1 BDC BT /${helvName} 12 Tf 50 120 Td (SEGRETO NASCOSTO) Tj ET EMC`);
  p.node.addContentStream(ctx.register(cs));
  doc.getPage(0).node.set(PDFName.of('PieceInfo'), ctx.obj({ App: { Private: PDFString.of('x') } }));
  return new Uint8Array(await doc.save({ useObjectStreams: false }));
}

describe('sanifica', () => {
  it('trova e toglie metadati, JavaScript, allegati, commenti, livelli nascosti; i link restano', async () => {
    const src = await docWithEverything();
    const before = await firstText(src);
    // pdf.js non mostra il livello spento ma il testo è estraibile dal contenuto
    const d0 = await PDFDocument.load(src);
    const a = analyze(d0, src);
    expect(a.metadati).toBeGreaterThan(0); expect(a.javascript).toBeGreaterThanOrEqual(2);
    expect(a.allegati).toBe(1); expect(a.commenti).toBe(1); expect(a.livelliNascosti).toBe(1); expect(a.datiPrivati).toBe(1);
    const r = sanitize(d0, {});
    expect(r.allegati).toBe(1); expect(r.commenti).toBe(1); expect(r.livelliNascosti).toBe(1);
    const out = await d0.save();
    const d1 = await PDFDocument.load(out, { updateMetadata: false });
    const a1 = analyze(d1, out);
    expect({ ...a1, versioni: 0 }).toEqual({ metadati: 0, javascript: 0, allegati: 0, commenti: 0, campiNascosti: 0, livelliNascosti: 0, datiPrivati: 0, xfa: 0, versioni: 0 });
    const raw = Buffer.from(out).toString('latin1');
    expect(raw).not.toContain('Mario Rossi'); expect(raw).not.toContain('fattura');
    const t = open(out); const pd = await t.promise; const pg = await pd.getPage(1);
    const anns = await pg.getAnnotations();
    expect(anns.some((x) => x.url === 'https://www.cnr.it/' || x.url === 'https://www.cnr.it')).toBe(true);
    expect(anns.some((x) => x.subtype === 'Text')).toBe(false);
    const ops = await pg.getOperatorList();
    const txt = (await pg.getTextContent({ includeMarkedContent: false })).items.map((x) => x.str).join(' ');
    expect(txt).not.toContain('SEGRETO');
    expect(txt).toContain('Pagina 1');
    expect(ops.fnArray.length).toBeGreaterThan(10);
    await t.destroy();
    expect(before.text).toContain('Pagina 1');
  });
  it('conta le revisioni incrementali', async () => {
    const d = await PDFDocument.load(prova, { forIncrementalUpdate: true });
    d.setTitle('nuovo');
    const inc = await d.save();
    expect(countRevisions(prova)).toBe(1);
    expect(countRevisions(inc)).toBe(2);
  });
});

describe('proprietà e vista iniziale', () => {
  it('scrive e rilegge proprietà, layout, zoom, XMP coerente', async () => {
    const d = await PDFDocument.load(prova);
    const v = { ...readProperties(d) };
    expect(v.title).toBe('Documento di prova');
    Object.assign(v, { title: 'Determina n. 12/2026', author: 'ICCOM-CNR', subject: 'Affidamento', keywords: 'determina, 2026', pageLayout: 'TwoPageRight', pageMode: 'UseOutlines', openPage: 2, openZoom: 'fitWidth', displayDocTitle: true, creationDate: '2026-01-15T09:30', writeXmp: true });
    writeProperties(d, v);
    const out = await d.save();
    const back = readProperties(await PDFDocument.load(out, { updateMetadata: false }));
    expect(back).toMatchObject({ title: 'Determina n. 12/2026', author: 'ICCOM-CNR', subject: 'Affidamento', pageLayout: 'TwoPageRight', pageMode: 'UseOutlines', openPage: 2, openZoom: 'fitWidth', displayDocTitle: true, creationDate: '2026-01-15T09:30', hasXmp: true });
    const t = open(out); const pd = await t.promise; const m = await pd.getMetadata();
    expect(m.info.Title).toBe('Determina n. 12/2026');
    expect(m.metadata.get('dc:title')).toBe('Determina n. 12/2026');
    expect(await pd.getPageLayout()).toBe('TwoPageRight');
    await t.destroy();
  });
  it('zoom percentuale e campi vuoti', async () => {
    const d = await PDFDocument.load(prova);
    writeProperties(d, { ...readProperties(d), author: '', openZoom: '125', openPage: 1 });
    const back = readProperties(await PDFDocument.load(await d.save(), { updateMetadata: false }));
    expect(back.author).toBe(''); expect(back.openZoom).toBe('125');
  });
});

describe('allegati', () => {
  it('aggiunge, elenca, legge e toglie', async () => {
    const d = await PDFDocument.load(prova);
    await addAttachment(d, new TextEncoder().encode('ciao'), 'nota.txt', { description: 'prova' });
    await addAttachment(d, new TextEncoder().encode('bis'), 'nota.txt');
    const d2 = await PDFDocument.load(await d.save());
    const list = listAttachments(d2);
    expect(list.map((x) => x.name).sort()).toEqual(['nota (2).txt', 'nota.txt']);
    expect(new TextDecoder().decode(readAttachment(d2, 'doc:nota.txt'))).toBe('ciao');
    expect(removeAttachment(d2, 'doc:nota.txt')).toBe(true);
    const d3 = await PDFDocument.load(await d2.save());
    expect(listAttachments(d3).map((x) => x.name)).toEqual(['nota (2).txt']);
    const t = open(await d3.save()); const att = await (await t.promise).getAttachments(); await t.destroy();
    expect(keys(att)).toEqual(['nota (2).txt']);
  });
});

/** PDF con un'immagine RGB grande non compressa, una CMYK, testo, link e campo. */
async function docWithImages() {
  const doc = await PDFDocument.load(prova);
  const ctx = doc.context;
  const w = 1200; const h = 900; const px = new Uint8Array(w * h * 3);
  let seed = 12345; for (let i = 0; i < px.length; i++) { seed = (seed * 1103515245 + 12345) >>> 0; px[i] = seed >>> 24; }
  const img = ctx.register(ctx.flateStream(px, { Type: 'XObject', Subtype: 'Image', Width: w, Height: h, ColorSpace: 'DeviceRGB', BitsPerComponent: 8 }));
  const cmyk = new Uint8Array(200 * 200 * 4); for (let i = 0; i < cmyk.length; i++) cmyk[i] = (i * 7) % 256;
  const img2 = ctx.register(ctx.flateStream(cmyk, { Type: 'XObject', Subtype: 'Image', Width: 200, Height: 200, ColorSpace: 'DeviceCMYK', BitsPerComponent: 8 }));
  const p = doc.getPage(1);
  const n1 = p.node.newXObject('ImG', img); const n2 = p.node.newXObject('ImC', img2);
  // disegnata a 4 pollici di larghezza → 300 dpi
  p.node.addContentStream(ctx.register(ctx.flateStream(`q 288 0 0 216 50 300 cm /${n1.decodeText()} Do Q q 100 0 0 100 400 300 cm /${n2.decodeText()} Do Q`)));
  const link = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Link', Rect: [50, 50, 150, 70], A: { S: 'URI', URI: PDFString.of('https://www.cnr.it') } }));
  p.node.Annots()?.push(link) ?? p.node.set(PDFName.of('Annots'), ctx.obj([link]));
  return new Uint8Array(await doc.save());
}

describe('riduci dimensioni file', () => {
  it('ricomprime solo le immagini gestibili, ai DPI richiesti, preservando testo, link e moduli', async () => {
    const src = await docWithImages();
    const d = await PDFDocument.load(src);
    const usage = imageUsage(d);
    expect([...usage.values()].map((u) => Math.round(u.w)).sort((a, b) => a - b)).toEqual([100, 288]);
    const jobs = [];
    const codec = { async recompress(job) { jobs.push(job); return new Uint8Array(5000).fill(1); } };
    const stats = await compressImages(d, { dpi: 150, quality: 0.7, codec });
    expect(stats.changed).toBe(1);
    expect(stats.skipped['spazio colore DeviceCMYK']).toBe(1);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ kind: 'raw', width: 1200, height: 900, targetWidth: 600, targetHeight: 450, components: 3 });
    expect(jobs[0].pixels.length).toBe(1200 * 900 * 3);
    cleanupStructure(d, { removeMetadata: false });
    const out = await d.save({ useObjectStreams: true });
    expect(out.length).toBeLessThan(src.length / 2);
    const t = open(out); const pd = await t.promise;
    const p2 = await pd.getPage(2);
    expect((await p2.getTextContent()).items.map((x) => x.str).join(' ')).toContain('Pagina 2');
    expect((await p2.getAnnotations()).some((a) => a.subtype === 'Link')).toBe(true);
    const fields = await pd.getFieldObjects();
    expect(keys(fields)).toEqual(expect.arrayContaining(['nome', 'accetto']));
    await t.destroy();
  });
  it('non sostituisce se il risultato non è più piccolo, e si può annullare', async () => {
    const d = await PDFDocument.load(await docWithImages());
    const big = { async recompress(job) { return new Uint8Array(job.pixels.length + 10); } };
    expect((await compressImages(d, { codec: big })).changed).toBe(0);
    const ctrl = new AbortController(); ctrl.abort();
    await expect(compressImages(d, { codec: big, signal: ctrl.signal })).rejects.toThrow(/Annullato/);
    const fails = { async recompress() { throw new Error('decodifica'); } };
    expect((await compressImages(d, { codec: fails })).skipped['non decodificabile']).toBe(1);
  });
  it('classifica le immagini strane come intatte', async () => {
    const d = await PDFDocument.create(); const ctx = d.context;
    const mk = (dict, data = new Uint8Array(10)) => PDFRawStream.of(ctx.obj({ Type: 'XObject', Subtype: 'Image', Width: 100, Height: 100, BitsPerComponent: 8, ColorSpace: 'DeviceRGB', ...dict }), data);
    expect(classifyImage(ctx, mk({ Filter: 'JBIG2Decode', ColorSpace: 'DeviceGray', BitsPerComponent: 1 })).ok).toBe(false);
    expect(classifyImage(ctx, mk({ Filter: 'CCITTFaxDecode', BitsPerComponent: 1 })).ok).toBe(false);
    expect(classifyImage(ctx, mk({ Filter: 'JPXDecode' })).reason).toMatch(/JPX/);
    expect(classifyImage(ctx, mk({ BitsPerComponent: 16 })).reason).toMatch(/8 bit/);
    expect(classifyImage(ctx, mk({ ImageMask: true })).ok).toBe(false);
    expect(classifyImage(ctx, mk({ Decode: [1, 0, 1, 0, 1, 0] })).ok).toBe(false);
    expect(classifyImage(ctx, mk({ ColorSpace: ['Indexed', 'DeviceRGB', 1, PDFString.of('abcdef')] })).ok).toBe(false);
    // JPEG CMYK dichiarato RGB: SOF con 4 componenti
    const sof = Uint8Array.from([0xff, 0xd8, 0xff, 0xc0, 0, 17, 8, 0, 100, 0, 100, 4, 1, 0x11, 0, 2, 0x11, 0, 3, 0x11, 0, 4, 0x11, 0]);
    expect(classifyImage(ctx, mk({ Filter: 'DCTDecode' }, sof)).ok).toBe(false);
    const sof3 = Uint8Array.from([0xff, 0xd8, 0xff, 0xc0, 0, 17, 8, 0, 100, 0, 100, 3, 1, 0x11, 0, 2, 0x11, 0, 3, 0x11, 0]);
    expect(classifyImage(ctx, mk({ Filter: 'DCTDecode' }, sof3))).toMatchObject({ ok: true, kind: 'jpeg', components: 3 });
  });
  it('predittore PNG', () => {
    // 2 righe, 3 pixel grigi: filtro Sub e Up
    const data = Uint8Array.from([1, 10, 5, 5, 2, 1, 1, 1]);
    expect([...unpredictPng(data, { colors: 1, columns: 3 })]).toEqual([10, 15, 20, 11, 16, 21]);
  });
  it('riduci sotto N MB: sceglie la qualità migliore che sta sotto il limite', async () => {
    const steps = [1, 2, 3, 4, 5, 6, 7, 8, 9];
    const sizes = [900, 800, 700, 600, 500, 400, 300, 200, 100];
    const calls = [];
    const attempt = async (s, i) => { calls.push(i); return { size: sizes[i], bytes: new Uint8Array(1) }; };
    const r = await searchUnderLimit(steps, 450, attempt);
    expect(r).toMatchObject({ index: 5, reached: true });
    expect(calls.length).toBeLessThanOrEqual(5);
    expect((await searchUnderLimit(steps, 50, attempt)).reached).toBe(false);
    expect((await searchUnderLimit(steps, 1000, attempt)).index).toBe(0);
  });
});

describe('firme e pulizia', () => {
  it('riconosce un documento firmato', async () => {
    const d = await PDFDocument.load(prova);
    expect(countSignatures(d)).toBe(0);
    d.context.register(d.context.obj({ Type: 'Sig', ByteRange: [0, 10, 20, 30], Contents: PDFString.of('x') }));
    expect(countSignatures(d)).toBe(1);
    expect(removeUnreachable(d)).toBeGreaterThanOrEqual(1); // la firma non collegata è un oggetto orfano
    expect(countSignatures(d)).toBe(0);
  });
});
