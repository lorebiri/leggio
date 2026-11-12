import { describe, it, expect, beforeAll } from 'vitest';
import forge from 'node-forge';
import { openP7m, looksLikeP7m, innerName, overallStatus, sniff } from '../src/renderer/features/avanzati/lib/cades.js';
import { parseDer, octets } from '../src/renderer/features/avanzati/lib/der.js';

let keys, cert;
const PDF = new TextEncoder().encode('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');

const QC = forge.asn1.toDer(forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SEQUENCE, true, [forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SEQUENCE, true, [forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.OID, false, forge.asn1.oidToDer('0.4.0.1862.1.1').getBytes())])])).getBytes();
function makeCert(cn, serialNumber, qualified = true) {
  const c = forge.pki.createCertificate();
  c.publicKey = keys.publicKey;
  c.serialNumber = '0a1b2c';
  c.validity.notBefore = new Date(Date.UTC(2020, 0, 1));
  c.validity.notAfter = new Date(Date.UTC(2035, 0, 1));
  const attrs = [{ name: 'commonName', value: cn }, { name: 'countryName', value: 'IT' }, { name: 'organizationName', value: 'CNR' }, { type: '2.5.4.5', value: serialNumber }];
  c.setSubject(attrs);
  if (qualified) c.setExtensions([{ id: '1.3.6.1.5.5.7.1.3', value: QC }]);
  c.setIssuer([{ name: 'commonName', value: 'Certificatore di prova' }, { name: 'organizationName', value: 'Prova S.p.A.' }]);
  c.sign(keys.privateKey, forge.md.sha256.create());
  return c;
}

function sign(bytes, { signingTime = new Date(Date.UTC(2026, 10, 10, 9, 30)) } = {}) {
  const p7 = forge.pkcs7.createSignedData();
  p7.content = forge.util.createBuffer(Buffer.from(bytes).toString('binary'));
  p7.addCertificate(cert);
  p7.addSigner({
    key: keys.privateKey, certificate: cert, digestAlgorithm: forge.pki.oids.sha256,
    authenticatedAttributes: [
      { type: forge.pki.oids.contentType, value: forge.pki.oids.data },
      { type: forge.pki.oids.messageDigest },
      { type: forge.pki.oids.signingTime, value: signingTime },
    ],
  });
  p7.sign();
  return new Uint8Array(Buffer.from(forge.asn1.toDer(p7.toAsn1()).getBytes(), 'binary'));
}

beforeAll(() => {
  keys = forge.pki.rsa.generateKeyPair({ bits: 1024, e: 0x10001 });
  cert = makeCert('MARIO ROSSI', 'TINIT-RSSMRA70A01H501U');
}, 30000);

describe('CAdES / .p7m', () => {
  it('riconosce ed estrae un PDF firmato, verificando la firma', async () => {
    const p7m = sign(PDF);
    expect(looksLikeP7m(p7m)).toBe(true);
    const r = await openP7m(p7m);
    expect(r.kind).toBe('pdf');
    expect(Buffer.from(r.content).toString()).toBe(Buffer.from(PDF).toString());
    expect(r.levels).toHaveLength(1);
    const s = r.levels[0].signers[0];
    expect(s.name).toBe('MARIO ROSSI');
    expect(s.fiscalCode).toBe('RSSMRA70A01H501U');
    expect(s.organization).toBe('CNR');
    expect(s.issuer).toBe('Prova S.p.A.');
    expect(s.integrity).toBe('valid');
    expect(s.certValidAtSigning).toBe(true);
    expect(s.signingTime.toISOString()).toBe('2026-11-10T09:30:00.000Z');
    expect(s.certificate.qualified).toBe(true);
    expect(overallStatus(r)).toBe('valid');
  });

  it('un certificato non qualificato dà esito «da controllare», non verde', async () => {
    const saved = cert; cert = makeCert('PINCO PALLINO', 'X', false);
    try {
      const r = await openP7m(sign(PDF));
      expect(r.levels[0].signers[0].integrity).toBe('valid');
      expect(r.levels[0].signers[0].certificate.qualified).toBe(false);
      expect(overallStatus(r)).toBe('warning');
    } finally { cert = saved; }
  });

  it('riconosce il certificato autofirmato', async () => {
    const saved = cert; cert = makeCert('PINCO PALLINO', 'X', false);
    cert.setIssuer(cert.subject.attributes); cert.sign(keys.privateKey, forge.md.sha256.create());
    try {
      const r = await openP7m(sign(PDF));
      expect(r.levels[0].signers[0].certificate.selfSigned).toBe(true);
      expect(r.levels[0].signers[0].integrity).toBe('valid');
    } finally { cert = saved; }
  });

  it('segnala come non valido un file alterato di un byte', async () => {
    const p7m = sign(PDF);
    const i = Buffer.from(p7m).indexOf('obj');
    p7m[i] = 'x'.charCodeAt(0);
    const r = await openP7m(p7m);
    expect(r.levels[0].signers[0].integrity).toBe('invalid');
    expect(r.levels[0].signers[0].integrityDetail).toMatch(/modificato dopo la firma/);
    expect(overallStatus(r)).toBe('invalid');
  });

  it('gestisce le buste annidate (.p7m.p7m)', async () => {
    const inner = sign(PDF);
    const outer = sign(inner);
    const r = await openP7m(outer);
    expect(r.levels).toHaveLength(2);
    expect(r.kind).toBe('pdf');
    expect(r.levels.every((l) => l.signers[0].integrity === 'valid')).toBe(true);
  });

  it('accetta i .p7m codificati in base64 (anche con intestazioni PEM)', async () => {
    const p7m = sign(PDF);
    const b64 = Buffer.from(p7m).toString('base64').replace(/(.{64})/g, '$1\n');
    const r1 = await openP7m(new Uint8Array(Buffer.from(b64)));
    expect(r1.kind).toBe('pdf');
    const pem = `-----BEGIN PKCS7-----\n${b64}\n-----END PKCS7-----\n`;
    const r2 = await openP7m(new Uint8Array(Buffer.from(pem)));
    expect(r2.levels[0].signers[0].integrity).toBe('valid');
  });

  it('riconosce una fattura XML firmata', async () => {
    const xml = new TextEncoder().encode('<?xml version="1.0"?><p:FatturaElettronica xmlns:p="x" versione="FPR12"></p:FatturaElettronica>');
    const r = await openP7m(sign(xml));
    expect(r.kind).toBe('fattura');
    expect(innerName('IT01234567890_abc12.xml.p7m', r.kind)).toBe('IT01234567890_abc12.xml');
    expect(innerName('contratto.pdf.p7m.p7m', 'pdf')).toBe('contratto.pdf');
    expect(innerName('offerta.p7m', 'pdf')).toBe('offerta.pdf');
  });

  it('non va in crash su file troncati o casuali', async () => {
    const p7m = sign(PDF);
    await expect(openP7m(p7m.subarray(0, 200))).rejects.toThrow(/firmata|firma|troncati/i);
    const junk = new Uint8Array(5000).map((_, i) => (i * 7919) & 0xff);
    await expect(openP7m(junk)).rejects.toThrow();
    await expect(openP7m(new Uint8Array([0x30, 0x80, 0x30, 0x80]))).rejects.toThrow();
  });

  it('il lettore BER gestisce lunghezze indefinite e stringhe costruite', () => {
    // SEQUENCE(indef) { OCTET STRING costruita (indef) { "ab", "cd" } }
    const b = new Uint8Array([0x30, 0x80, 0x24, 0x80, 0x04, 0x02, 0x61, 0x62, 0x04, 0x02, 0x63, 0x64, 0, 0, 0, 0]);
    const n = parseDer(b);
    expect(n.end).toBe(b.length);
    expect(Buffer.from(octets(b, n.children[0])).toString()).toBe('abcd');
  });

  it('sniff riconosce i tipi', () => {
    expect(sniff(PDF)).toBe('pdf');
    expect(sniff(new Uint8Array([0x50, 0x4b, 3, 4]))).toBe('zip');
  });
});
