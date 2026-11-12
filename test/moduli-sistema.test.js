// «Firmatario di sistema»: archivio di Windows (simulato) e portachiavi di macOS (portachiavi TEMPORANEO di prova).
// Regole: non si tocca mai il portachiavi di login né l'archivio dell'utente. La parte macOS reale gira solo con
// LEGGIO_TEST_KEYCHAIN=1 su un Mac: crea un portachiavi in una cartella temporanea e lo cancella alla fine,
// controllando che l'elenco dei portachiavi dell'utente non cambi.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createRequire } from 'node:module';
import { readFileSync, mkdtempSync, writeFileSync, rmSync, existsSync, readdirSync, utimesSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import crypto from 'node:crypto';

const require = createRequire(import.meta.url);
const M = require('../electron/features/moduli.cjs');
const forge = require('node-forge');
const fixture = readFileSync(new URL('./fixtures/prova.pdf', import.meta.url));
const PW = 'segreta123';

/** Certificato con chiave e uso della chiave a scelta (RSA o EC) e un .p12 da cui leggere la chiave. */
function makeCert({ cn = 'Mario Bianchi', ku = { digitalSignature: true, nonRepudiation: true }, ec = false, serialNumber } = {}) {
  const kp = ec ? crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' }) : crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  // il certificato lo firma una CA RSA di prova (forge firma solo con RSA)
  const ca = forge.pki.rsa.generateKeyPair(1024);
  const cert = forge.pki.createCertificate();
  cert.publicKey = forge.pki.publicKeyFromPem(kp.publicKey.export({ type: 'spki', format: 'pem' }));
  cert.serialNumber = '1a2b3c';
  cert.validity.notBefore = new Date(Date.now() - 86400000); cert.validity.notAfter = new Date(Date.now() + 365 * 86400000);
  const subj = [{ shortName: 'CN', value: cn }, { shortName: 'O', value: 'Ente di prova' }];
  if (serialNumber) subj.push({ name: 'serialNumber', value: serialNumber });
  cert.setSubject(subj); cert.setIssuer([{ shortName: 'CN', value: 'CA di prova' }]);
  cert.setExtensions([{ name: 'keyUsage', ...ku }, { name: 'subjectKeyIdentifier' }]);
  cert.sign(ca.privateKey, forge.md.sha256.create());
  const der = Buffer.from(forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes(), 'binary');
  return { der, key: kp.privateKey };
}

/** PowerShell finto: risponde ai due script come farebbe Windows, firmando con chiavi in memoria. */
function fakePowerShell(store, { failSign } = {}) {
  const calls = [];
  const fn = async (script, input) => {
    calls.push({ script, input });
    if (script === M.PS_LIST) return { code: 0, stdout: Buffer.from('﻿' + JSON.stringify(store.map((s) => ({ thumb: s.thumb, der: s.der.toString('base64') })))), stderr: '' };
    if (script === M.PS_SIGN) {
      if (failSign) return { code: 1, stdout: Buffer.alloc(0), stderr: failSign };
      const req = JSON.parse(input);
      const s = store.find((x) => x.thumb === req.thumb);
      const sigs = req.items.map((b) => {
        const data = Buffer.from(b, 'base64');
        return (s.key.asymmetricKeyType === 'ec' ? crypto.sign('sha256', data, { key: s.key, dsaEncoding: 'ieee-p1363' }) : crypto.sign('sha256', data, s.key)).toString('base64');
      });
      return { code: 0, stdout: Buffer.from(JSON.stringify(sigs.length === 1 ? sigs[0] : sigs)), stderr: '' };
    }
    return { code: 1, stdout: Buffer.alloc(0), stderr: 'script sconosciuto' };
  };
  fn.calls = calls;
  return fn;
}

describe('estensioni dei certificati', () => {
  it('uso della chiave, identificativo, certificati non di firma esclusi', () => {
    const a = makeCert({ ku: { digitalSignature: false, nonRepudiation: true } });
    const e = M.certExtensions(a.der);
    expect(e.keyUsage).toMatchObject({ nonRepudiation: true, digitalSignature: false });
    expect(e.ski).toMatch(/^[0-9A-F]{40}$/);
    expect(M.certExtensions(Buffer.from('rotto')).keyUsage).toBe(null);
  });
  it('conversione firma ECDSA P1363 → DER', () => {
    const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
    for (let i = 0; i < 20; i++) {
      const d = crypto.randomBytes(40);
      const p = crypto.sign('sha256', d, { key: privateKey, dsaEncoding: 'ieee-p1363' });
      expect(crypto.verify('sha256', d, publicKey, M.p1363ToDer(p))).toBe(true);
    }
  });
});

describe('Windows (archivio simulato)', () => {
  const sig = makeCert({ cn: 'Mario Bianchi', serialNumber: 'TINIT-BNCMRA80A01G702X' });
  const auth = makeCert({ cn: 'Mario Bianchi (autenticazione)', ku: { digitalSignature: false, keyEncipherment: true } });
  const store = [
    { thumb: crypto.createHash('sha1').update(sig.der).digest('hex').toUpperCase(), der: sig.der, key: sig.key },
    { thumb: crypto.createHash('sha1').update(auth.der).digest('hex').toUpperCase(), der: auth.der, key: auth.key },
  ];
  it('elenca solo i certificati di firma, con CF ed emittente', async () => {
    const ps = fakePowerShell(store);
    const r = await M.listSystemIds({ platform: 'win32', runPowerShell: ps });
    expect(r.supported).toBe(true);
    expect(r.ids).toHaveLength(1);
    expect(r.hidden).toBe(1);
    expect(r.ids[0]).toMatchObject({ subject: 'Mario Bianchi', fiscalCode: 'BNCMRA80A01G702X', issuer: 'CA di prova', nonRepudiation: true });
    expect(r.ids[0].id).toBe('win:' + store[0].thumb);
  });
  it('PAdES, CAdES .p7m e firma in blocco con UNA sola chiamata di firma (un PIN)', async () => {
    const ps = fakePowerShell(store);
    const signer = await M.resolveSigner({ type: 'system', id: 'win:' + store[0].thumb }, { platform: 'win32', runPowerShell: ps });
    const r = await M.signPdfWith(fixture, signer, { visible: true, rect: [300, 50, 550, 120], subFilter: 'cades', reason: 'Prova Windows' });
    const v = await M.verifyPdf(r.bytes);
    expect(v.signatures[0]).toMatchObject({ integrity: true, signatureValid: true, subFilter: 'ETSI.CAdES.detached' });
    expect(v.signatures[0].signer.fiscalCode).toBe('BNCMRA80A01G702X');
    const p7 = await M.signP7mWith(Buffer.from('ciao'), signer);
    expect(M.verifyP7m(p7.bytes).layers[0].signatureValid).toBe(true);
    // in blocco
    const dir = mkdtempSync(join(tmpdir(), 'leggio-win-'));
    const files = [1, 2, 3].map((i) => { const f = join(dir, `doc${i}.pdf`); writeFileSync(f, fixture); return f; });
    const before = ps.calls.filter((c) => c.script === M.PS_SIGN).length;
    const res = await M.signFilesWith(files, signer, { reason: 'blocco' });
    expect(res.every((x) => x.ok)).toBe(true);
    expect(ps.calls.filter((c) => c.script === M.PS_SIGN).length - before).toBe(1);
    expect(readdirSync(dir).filter((f) => /leggio-(tmp|prep)/.test(f))).toEqual([]);
    for (const x of res) expect((await M.verifyPdf(readFileSync(x.output))).signatures[0].signatureValid).toBe(true);
    const p7res = await M.signFilesWith(files.slice(0, 2), signer, { format: 'p7m' });
    expect(p7res.every((x) => x.ok && x.output.endsWith('.pdf.p7m'))).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  }, 60000);
  it('chiave EC', async () => {
    // forge non sa creare certificati EC: si usa openssl, se c'è
    let ecc;
    try {
      const d = mkdtempSync(join(tmpdir(), 'leggio-ec-'));
      execFileSync('openssl', ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:P-256', '-nodes', '-keyout', join(d, 'k.pem'), '-out', join(d, 'c.der'), '-outform', 'DER', '-days', '30', '-subj', '/CN=Chiave EC', '-addext', 'keyUsage=digitalSignature,nonRepudiation'], { stdio: 'ignore' });
      ecc = { der: readFileSync(join(d, 'c.der')), key: crypto.createPrivateKey(readFileSync(join(d, 'k.pem'))) };
      rmSync(d, { recursive: true, force: true });
    } catch { return; }
    const st = [{ thumb: crypto.createHash('sha1').update(ecc.der).digest('hex').toUpperCase(), der: ecc.der, key: ecc.key }];
    const signer = await M.resolveSigner({ type: 'system', id: 'win:' + st[0].thumb }, { platform: 'win32', runPowerShell: fakePowerShell(st) });
    expect(signer.keyType).toBe('ec');
    const r = await M.signPdfWith(fixture, signer, {});
    expect((await M.verifyPdf(r.bytes)).signatures[0].signatureValid).toBe(true);
  }, 30000);
  it('errori: PIN annullato, carta assente, certificato sparito, id non valido', async () => {
    const id = 'win:' + store[0].thumb;
    const s1 = await M.resolveSigner({ type: 'system', id }, { platform: 'win32', runPowerShell: fakePowerShell(store, { failSign: 'The operation was canceled by the user.' }) });
    await expect(M.signPdfWith(fixture, s1, {})).rejects.toThrow(/annullata/);
    const s2 = await M.resolveSigner({ type: 'system', id }, { platform: 'win32', runPowerShell: fakePowerShell(store, { failSign: 'Keyset does not exist' }) });
    await expect(M.signPdfWith(fixture, s2, {})).rejects.toThrow(/smart card/);
    await expect(M.resolveSigner({ type: 'system', id }, { platform: 'win32', runPowerShell: fakePowerShell([]) })).rejects.toThrow(/non è più disponibile/);
    await expect(M.resolveSigner({ type: 'system', id: 'win:xyz' }, { platform: 'win32' })).rejects.toThrow(/non valido/);
    await expect(M.resolveSigner({ type: 'system', id: 'mac:' + store[0].thumb }, { platform: 'win32' })).rejects.toThrow(/non appartiene/);
    const bad = async () => ({ code: 0, stdout: Buffer.from('non json'), stderr: '' });
    await expect(M.listSystemIds({ platform: 'win32', runPowerShell: bad })).rejects.toThrow(/inattesa/);
    expect((await M.listSystemIds({ platform: 'linux' })).supported).toBe(false);
  }, 30000);
  it('script PowerShell passati codificati, senza interpolare dati', () => {
    const a = M.psArgs(M.PS_SIGN);
    expect(a).toContain('-NonInteractive');
    expect(Buffer.from(a[a.length - 1], 'base64').toString('utf16le')).toBe(M.PS_SIGN);
    expect(M.PS_SIGN).not.toMatch(/Export|Remove-Item|Import-|\.Delete\(|Set-/);
    expect(M.PS_LIST).not.toMatch(/Export|Remove-Item|Import-|Set-/);
  });
});

describe('macOS: parsing dell\'uscita di «security»', () => {
  it('find-identity e find-certificate', () => {
    const out = 'Policy: X.509 Basic\n  Matching identities\n  1) 06342EA0780284ABE862257DAAD23188CF00AB77 "Prova Portachiavi" (CSSMERR_TP_NOT_TRUSTED)\n  2) 1111111111111111111111111111111111111111 "Altro"\n     2 identities found\n\n  Valid identities only\n  1) 1111111111111111111111111111111111111111 "Altro"\n';
    expect(M.parseFindIdentity(out)).toEqual([{ sha1: '06342EA0780284ABE862257DAAD23188CF00AB77', label: 'Prova Portachiavi', status: 'CSSMERR_TP_NOT_TRUSTED' }, { sha1: '1111111111111111111111111111111111111111', label: 'Altro', status: '' }]);
    const c = makeCert();
    const pem = c.der.toString('base64').replace(/.{64}/g, '$&\n');
    const m = M.parseFindCertificate(`SHA-256 hash: AA\nSHA-1 hash: 06342EA0780284ABE862257DAAD23188CF00AB77\n-----BEGIN CERTIFICATE-----\n${pem}\n-----END CERTIFICATE-----\n`);
    expect(m.get('06342EA0780284ABE862257DAAD23188CF00AB77').equals(c.der)).toBe(true);
  });
});

// ---------------- portachiavi temporaneo reale (solo su richiesta) ----------------
const runMac = process.platform === 'darwin' && process.env.LEGGIO_TEST_KEYCHAIN === '1' && existsSync('/usr/bin/security');
describe.skipIf(!runMac)('macOS: portachiavi temporaneo di prova', () => {
  let dir; let kc; let listBefore;
  const sec = (...a) => execFileSync('/usr/bin/security', a, { encoding: 'utf8' });
  beforeAll(() => {
    listBefore = sec('list-keychains', '-d', 'user');
    dir = mkdtempSync(join(tmpdir(), 'leggio-kc-'));
    kc = join(dir, 'leggio-prova.keychain-db');
    sec('create-keychain', '-p', 'prova-kc', kc);
    sec('unlock-keychain', '-p', 'prova-kc', kc);
    const p12 = M.createSelfSignedId({ name: 'Prova Portachiavi', email: 'p@e.it', organization: 'Test', password: PW });
    writeFileSync(join(dir, 'id.p12'), p12);
    sec('import', join(dir, 'id.p12'), '-k', kc, '-P', PW, '-T', '/usr/bin/security');
    try { sec('set-key-partition-list', '-S', 'apple-tool:,apple:', '-s', '-k', 'prova-kc', kc); } catch {}
    rmSync(join(dir, 'id.p12'));
  }, 60000);
  afterAll(() => {
    try { sec('delete-keychain', kc); } catch {}
    rmSync(dir, { recursive: true, force: true });
    // l'elenco dei portachiavi dell'utente non deve essere cambiato
    expect(sec('list-keychains', '-d', 'user')).toBe(listBefore);
  });
  it('elenca l\'identità del portachiavi di prova', async () => {
    const r = await M.listSystemIds({ platform: 'darwin', keychain: kc });
    expect(r.ids).toHaveLength(1);
    expect(r.ids[0]).toMatchObject({ subject: 'Prova Portachiavi', selfSigned: true });
    expect(sec('list-keychains', '-d', 'user')).toBe(listBefore);
  }, 30000);
  it('firma PAdES, CAdES .p7m e in blocco con «security cms», verificate', async () => {
    const { ids } = await M.listSystemIds({ platform: 'darwin', keychain: kc });
    const signer = await M.resolveSigner({ type: 'system', id: ids[0].id }, { platform: 'darwin', keychain: kc });
    expect(signer.kind).toBe('cms');
    const r = await M.signPdfWith(fixture, signer, { visible: true, rect: [300, 50, 550, 120], reason: 'Portachiavi', subFilter: 'cades' });
    const v = await M.verifyPdf(r.bytes);
    expect(v.signatures[0]).toMatchObject({ integrity: true, signatureValid: true, coversWholeDocument: true, subFilter: 'adbe.pkcs7.detached' });
    expect(Buffer.from(r.bytes).subarray(0, fixture.length).equals(fixture)).toBe(true);
    writeFileSync(join(dir, 'firmato-portachiavi.pdf'), r.bytes);
    const p7 = await M.signP7mWith(fixture, signer);
    const vp = M.verifyP7m(p7.bytes);
    expect(vp.layers[0]).toMatchObject({ integrity: true, signatureValid: true });
    expect(Buffer.from(vp.content).equals(fixture)).toBe(true);
    writeFileSync(join(dir, 'firmato.pdf.p7m'), p7.bytes);
    const f1 = join(dir, 'a.pdf'); writeFileSync(f1, fixture);
    const res = await M.signFilesWith([f1], signer, {});
    expect(res[0].ok).toBe(true);
    // verifica indipendente, se gli strumenti ci sono
    try { expect(execFileSync('pdfsig', [join(dir, 'firmato-portachiavi.pdf')], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })).toMatch(/Signature is Valid/); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    try { execFileSync('openssl', ['cms', '-verify', '-noverify', '-inform', 'DER', '-in', join(dir, 'firmato.pdf.p7m'), '-out', join(dir, 'estratto.pdf')], { stdio: 'ignore' }); expect(readFileSync(join(dir, 'estratto.pdf')).equals(fixture)).toBe(true); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  }, 60000);
});

describe('ripiego: programma di firma installato', () => {
  it('osserva la cartella e segnala il file firmato (copia .p7m o PDF riscritto)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'leggio-ext-'));
    const f = join(dir, 'Determina 42.pdf'); writeFileSync(f, fixture);
    writeFileSync(join(dir, 'altro.pdf.p7m'), 'non c\'entra');
    const got = new Promise((resolve) => {
      M.startExternalSigning({ filePath: f, app: { path: '/bin/true' }, timeoutMs: 20000, onResult: resolve,
        launcher: () => setTimeout(() => writeFileSync(join(dir, 'Determina 42.pdf.p7m'), Buffer.from('busta firmata')), 300) });
    });
    const r = await got;
    expect(r.name).toBe('Determina 42.pdf.p7m');
    // PDF riscritto sul posto con una firma
    const f2 = join(dir, 'Contratto.pdf'); writeFileSync(f2, fixture); utimesSync(f2, new Date(Date.now() - 10000), new Date(Date.now() - 10000));
    const r2 = await new Promise((resolve) => {
      M.startExternalSigning({ filePath: f2, app: { path: '/bin/true' }, timeoutMs: 20000, onResult: resolve,
        launcher: () => setTimeout(() => writeFileSync(f2, Buffer.concat([fixture, Buffer.from('\n/ByteRange [0 1 2 3]\n')])), 300) });
    });
    expect(r2.name).toBe('Contratto.pdf');
    // annullamento e scadenza
    const t = M.startExternalSigning({ filePath: f, app: {}, launcher: () => {}, onResult: () => {}, timeoutMs: 60000 });
    expect(M.stopExternalSigning(t)).toBe(true);
    expect(M.stopExternalSigning(t)).toBe(false);
    const r3 = await new Promise((resolve) => M.startExternalSigning({ filePath: f, app: {}, launcher: () => {}, onResult: resolve, timeoutMs: 500 }));
    expect(r3.timeout).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  }, 30000);
  it('rilevamento programmi: non fallisce su sistemi senza programmi', () => {
    expect(Array.isArray(M.detectSigningApps('linux'))).toBe(true);
    expect(Array.isArray(M.detectSigningApps())).toBe(true);
  });
});
