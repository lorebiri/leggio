// Firma digitale lato main (electron/features/moduli.cjs): ID autofirmato, PAdES incrementale, CAdES .p7m, verifica.
import { describe, it, expect, beforeAll } from 'vitest';
import { createRequire } from 'node:module';
import { readFileSync, mkdtempSync, writeFileSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PDFDocument, StandardFonts } from '@cantoo/pdf-lib';

const require = createRequire(import.meta.url);
const M = require('../electron/features/moduli.cjs');
const forge = require('node-forge');

const fixture = readFileSync(new URL('./fixtures/prova.pdf', import.meta.url));
let P12; const PW = 'segreta123';

/** .p12 con date arbitrarie (per provare certificati scaduti). */
function makeP12({ notBefore, notAfter, pw = PW, cn = 'Prova Scaduta' }) {
  const keys = forge.pki.rsa.generateKeyPair({ bits: 1024, e: 0x10001 });
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey; cert.serialNumber = '0a1b';
  cert.validity.notBefore = notBefore; cert.validity.notAfter = notAfter;
  const a = [{ shortName: 'CN', value: cn }];
  cert.setSubject(a); cert.setIssuer(a); cert.sign(keys.privateKey, forge.md.sha256.create());
  return Buffer.from(forge.asn1.toDer(forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], pw, { algorithm: '3des' })).getBytes(), 'binary');
}

beforeAll(() => {
  P12 = M.createSelfSignedId({ name: 'Maria Rossì', email: 'maria@example.it', organization: 'ICCOM-CNR', password: PW, years: 3 });
}, 30000);

describe('ID digitale autofirmato', () => {
  it('si riapre e descrive il titolare', () => {
    const d = M.describeP12(P12, PW);
    expect(d.subject).toBe('Maria Rossì');
    expect(d.organization).toBe('ICCOM-CNR');
    expect(d.selfSigned).toBe(true);
    expect(d.expired).toBe(false);
  });
  it('argomenti non validi → messaggi chiari', () => {
    expect(() => M.createSelfSignedId({ name: '', password: 'abcdef' })).toThrow(/Manca: nome/);
    expect(() => M.createSelfSignedId({ name: 'A', password: '123' })).toThrow(/almeno 6/);
    expect(() => M.createSelfSignedId({ name: 'A', password: 'abcdef', email: 'non-email' })).toThrow(/email/);
    expect(() => M.createSelfSignedId({ name: 'A', password: 'abcdef', years: 100 })).toThrow(/validità/);
    expect(() => M.createSelfSignedId({ name: 'x'.repeat(5000), password: 'abcdef' })).toThrow(/troppo lungo/);
  });
});

describe('errori del .p12', () => {
  it('password errata', () => { expect(() => M.loadP12(P12, 'sbagliata')).toThrow(/Password dell'ID digitale errata/); });
  it('file non valido', () => { expect(() => M.loadP12(Buffer.from('ciao mondo'), PW)).toThrow(/non è un ID digitale valido/); });
  it('file vuoto, tipo errato, troppo grande', () => {
    expect(() => M.loadP12(new Uint8Array(0), PW)).toThrow(/vuoto/);
    expect(() => M.loadP12('stringa', PW)).toThrow(/tipo errato/);
    expect(() => M.loadP12(new Uint8Array(2 * 1024 * 1024), PW)).toThrow(/troppo grande/);
  });
  it('certificato scaduto rifiutato alla firma', async () => {
    const old = makeP12({ notBefore: new Date('2015-01-01'), notAfter: new Date('2016-01-01') });
    await expect(M.signPdf(fixture, old, PW)).rejects.toThrow(/scaduto il 01\/01\/2016/);
    await expect(M.signP7m(Buffer.from('x'), old, PW)).rejects.toThrow(/scaduto/);
  }, 20000);
});

describe('firma PAdES incrementale', () => {
  it('firma invisibile: originale intatto, firma valida', async () => {
    const r = await M.signPdf(fixture, P12, PW, { reason: 'Approvazione', location: 'Sesto Fiorentino' });
    const out = Buffer.from(r.bytes);
    expect(out.subarray(0, fixture.length).equals(fixture)).toBe(true);
    const v = await M.verifyPdf(out);
    expect(v.signatures).toHaveLength(1);
    const s = v.signatures[0];
    expect(s).toMatchObject({ integrity: true, signatureValid: true, coversWholeDocument: true, reason: 'Approvazione', location: 'Sesto Fiorentino' });
    expect(s.signer.subject).toBe('Maria Rossì');
    expect(s.verdict.title).toBe('Firma valida, documento non modificato dopo la firma');
    expect(s.verdict.level).toBe('warn'); // autofirmato
    expect(v.summary.level).toBe('warn');
    // il risultato si riapre con pdf-lib e mantiene il modulo
    const doc = await PDFDocument.load(out);
    expect(doc.getPageCount()).toBe(6);
    expect(doc.getForm().getFields().map((f) => f.getName())).toEqual(expect.arrayContaining(['nome', 'accetto', 'Firma1']));
  }, 20000);

  it('firma visibile CAdES su PDF con tabella xref classica, con immagine', async () => {
    const d = await PDFDocument.create(); const p = d.addPage([595, 842]);
    p.drawText('Contratto', { x: 50, y: 780, size: 20, font: await d.embedFont(StandardFonts.Helvetica) });
    const classic = Buffer.from(await d.save({ useObjectStreams: false }));
    expect(M.lastStartXref(classic).kind).toBe('table');
    // PNG 1x1 rosso
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64');
    const r = await M.signPdf(classic, P12, PW, { visible: true, pageIndex: 0, rect: [350, 60, 560, 130], subFilter: 'cades', reason: 'Per accettazione – àèìòù €', imagePng: png });
    const v = await M.verifyPdf(r.bytes);
    expect(v.signatures[0]).toMatchObject({ integrity: true, signatureValid: true, subFilter: 'ETSI.CAdES.detached', visible: true, page: 0, reason: 'Per accettazione – àèìòù €' });
    expect(v.signatures[0].signingTime).toBeTruthy();
  }, 20000);

  it('seconda firma: la prima resta valida e viene riconosciuta', async () => {
    const r1 = await M.signPdf(fixture, P12, PW, { reason: 'Prima' });
    const r2 = await M.signPdf(r1.bytes, P12, PW, { reason: 'Seconda', visible: true, rect: [50, 50, 250, 110], pageIndex: 1 });
    expect(r2.fieldName).toBe('Firma2');
    expect(Buffer.from(r2.bytes).subarray(0, r1.bytes.length).equals(Buffer.from(r1.bytes))).toBe(true);
    const v = await M.verifyPdf(r2.bytes);
    expect(v.signatures.map((s) => s.reason)).toEqual(['Prima', 'Seconda']);
    expect(v.signatures.every((s) => s.integrity && s.signatureValid)).toBe(true);
    expect(v.signatures[0].coversWholeDocument).toBe(false);
    expect(v.signatures[0].verdict.title).toMatch(/aggiunte altre firme/);
    expect(v.signatures[1].coversWholeDocument).toBe(true);
  }, 30000);

  it('modifica dopo la firma e alterazione dei byte firmati', async () => {
    const r = await M.signPdf(fixture, P12, PW);
    // aggiunta in coda (es. un commento salvato in modo incrementale)
    const appended = Buffer.concat([Buffer.from(r.bytes), Buffer.from('\n% modifica successiva\n1 0 obj\n<< >>\nendobj\n')]);
    const v1 = await M.verifyPdf(appended);
    expect(v1.signatures[0]).toMatchObject({ integrity: true, coversWholeDocument: false, modifiedAfterLastSignature: true });
    expect(v1.signatures[0].verdict.title).toMatch(/modificato dopo la firma/);
    // alterazione di un byte dentro l'area firmata
    const t = Buffer.from(r.bytes); const i = t.indexOf('Pagina 1'); t[i + 7] = 0x39; // "Pagina 9"
    const v2 = await M.verifyPdf(t);
    expect(v2.signatures[0].integrity).toBe(false);
    expect(v2.signatures[0].verdict.level).toBe('bad');
    expect(v2.summary.text).toMatch(/NON è valida/);
  }, 20000);

  it('PDF protetto, non PDF, PDF rotto: errori chiari', async () => {
    await expect(M.signPdf(Buffer.from('non sono un pdf'), P12, PW)).rejects.toThrow(/non è un PDF/);
    await expect(M.signPdf(Buffer.from('%PDF-1.7\nrotto rotto'), P12, PW)).rejects.toThrow(/danneggiato|struttura/);
    await expect(M.signPdf(fixture, P12, PW, { visible: true, rect: [0, 'a', 1, 2] })).rejects.toThrow(/Riquadro/);
    await expect(M.signPdf(fixture, P12, PW, { reason: 'x'.repeat(10000) })).rejects.toThrow(/troppo lungo/);
  }, 20000);

  it('PDF senza firme e firme malformate non bloccano la verifica', async () => {
    expect((await M.verifyPdf(fixture)).summary.level).toBe('none');
    const fake = Buffer.concat([fixture, Buffer.from('\n1 0 obj << /ByteRange [0 10 999999 5] /Contents <00> >> endobj\n/ByteRange [a b c]\n')]);
    const v = await M.verifyPdf(fake);
    expect(v.signatures).toHaveLength(1);
    expect(v.signatures[0].verdict.level).toBe('bad');
  });

  it('PDF grande (1200 pagine) firmato in tempi ragionevoli', async () => {
    const d = await PDFDocument.create(); const f = await d.embedFont(StandardFonts.Helvetica);
    for (let i = 0; i < 1200; i++) d.addPage([595, 842]).drawText('Pagina ' + (i + 1), { x: 50, y: 800, size: 12, font: f });
    const big = Buffer.from(await d.save());
    const t0 = Date.now();
    const r = await M.signPdf(big, P12, PW, { visible: true, pageIndex: 1199, rect: [300, 50, 550, 120] });
    expect(Date.now() - t0).toBeLessThan(20000);
    const v = await M.verifyPdf(r.bytes);
    expect(v.signatures[0]).toMatchObject({ integrity: true, signatureValid: true, page: 1199 });
  }, 60000);
});

describe('CAdES .p7m', () => {
  it('busta valida e contenuto estratto identico', async () => {
    const data = Buffer.from('Determina n. 42 — contenuto di prova');
    const { bytes } = await M.signP7m(data, P12, PW);
    const v = M.verifyP7m(bytes);
    expect(v.layers[0]).toMatchObject({ integrity: true, signatureValid: true });
    expect(v.layers[0].signer.subject).toBe('Maria Rossì');
    expect(Buffer.from(v.content).equals(data)).toBe(true);
    // .p7m in Base64
    const b64 = Buffer.from(Buffer.from(bytes).toString('base64'));
    expect(M.verifyP7m(b64).layers[0].signatureValid).toBe(true);
    // doppia busta (.p7m.p7m)
    const twice = (await M.signP7m(bytes, P12, PW)).bytes;
    const v2 = M.verifyP7m(twice);
    expect(v2.layers).toHaveLength(2);
    expect(Buffer.from(v2.content).equals(data)).toBe(true);
  });
  it('busta alterata → non valida; spazzatura → problema leggibile', async () => {
    const { bytes } = await M.signP7m(Buffer.from('abcdefghij'.repeat(20)), P12, PW);
    const t = Buffer.from(bytes); const i = t.indexOf('abcdefghij'); t[i] = 0x5a;
    expect(M.verifyP7m(t).layers[0].integrity).toBe(false);
    const g = M.verifyP7m(Buffer.from([0x30, 0x03, 0x01, 0x02, 0x03]));
    expect(g.layers[0].problems.length).toBeGreaterThan(0);
  });
});

describe('firma in blocco', () => {
  it('una password per più file, mai sovrascritti, errori per file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'leggio-firma-'));
    const a = join(dir, 'a.pdf'); const b = join(dir, 'b.pdf'); const c = join(dir, 'rotto.pdf');
    writeFileSync(a, fixture); writeFileSync(b, fixture); writeFileSync(c, '%PDF-1.4 rotto');
    writeFileSync(join(dir, 'a_firmato.pdf'), 'esistente');
    const res = await M.signFiles([a, b, c], P12, PW, { reason: 'In blocco' });
    expect(res.map((r) => r.ok)).toEqual([true, true, false]);
    expect(res[0].output.endsWith('a_firmato (2).pdf')).toBe(true);
    expect(readFileSync(join(dir, 'a_firmato.pdf'), 'utf8')).toBe('esistente');
    expect(readFileSync(a).equals(fixture)).toBe(true);
    expect((await M.verifyPdf(readFileSync(res[1].output))).signatures[0].signatureValid).toBe(true);
    const p7 = await M.signFiles([a], P12, PW, { format: 'p7m' });
    expect(p7[0].output.endsWith('a.pdf.p7m')).toBe(true);
    expect(existsSync(p7[0].output)).toBe(true);
    expect(readdirSync(dir).some((f) => f.endsWith('.leggio-tmp'))).toBe(false);
    await expect(M.signFiles([a], P12, 'errata')).rejects.toThrow(/Password/);
    rmSync(dir, { recursive: true, force: true });
  }, 60000);
});

describe('utilità', () => {
  it('stringhe e date PDF', () => {
    expect(M.decodePdfString('(Ciao \\(mondo\\) \\341)')).toBe('Ciao (mondo) á');
    expect(M.decodePdfString('<FEFF00E8>')).toBe('è');
    expect(M.parsePdfDate("D:20261112103000+01'00'")).toBe('2026-11-12T09:30:00.000Z');
    expect(M.parsePdfDate('boh')).toBe(null);
  });
});
