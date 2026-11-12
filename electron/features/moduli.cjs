// Area «moduli» — lato processo principale: firma digitale (PAdES nel PDF e CAdES .p7m), creazione di un
// ID digitale autofirmato, verifica delle firme. Tutto locale, nessuna rete.
//
// Principi di robustezza:
//  - la firma PDF è un AGGIORNAMENTO INCREMENTALE: i byte originali restano identici in testa al file
//    (le firme già presenti restano valide) e si controlla che sia così prima di restituire il risultato;
//  - il risultato viene sempre riaperto e la nuova firma verificata prima di proporlo all'utente;
//  - il file originale su disco non viene mai toccato: si restituiscono byte o si scrive una copia nuova;
//  - argomenti IPC validati (tipi e dimensioni), errori tradotti in messaggi chiari in italiano.
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const forge = require('node-forge');
const PDFLib = require('@cantoo/pdf-lib');
const { SignPdf } = require('@signpdf/signpdf');
const { Signer } = require('@signpdf/utils');

const { asn1 } = forge;
const MAX_PDF = 1536 * 1024 * 1024;      // 1,5 GB
const MAX_P12 = 1024 * 1024;             // un .p12 reale pesa pochi KB
const MAX_STR = 2000;
const SIG_BYTES = 16384;                 // spazio riservato alla firma (byte DER) → 32768 cifre esadecimali
const BR_PLACEHOLDER = '**********';

// ======================================================================================
// Errori leggibili
// ======================================================================================
class UserError extends Error { constructor(msg, code) { super(msg); this.name = 'UserError'; this.code = code || 'utente'; } }

function toBuffer(v, what, max) {
  let b;
  if (Buffer.isBuffer(v)) b = v;
  else if (v instanceof Uint8Array) b = Buffer.from(v.buffer, v.byteOffset, v.byteLength);
  else if (v instanceof ArrayBuffer) b = Buffer.from(v);
  else throw new UserError(`Dati non validi: ${what} mancante o di tipo errato.`, 'argomenti');
  if (!b.length) throw new UserError(`Il file ${what} è vuoto.`, 'argomenti');
  if (max && b.length > max) throw new UserError(`Il file ${what} è troppo grande (${Math.round(b.length / 1048576)} MB).`, 'argomenti');
  return b;
}
function str(v, what, { max = MAX_STR, required = false } = {}) {
  if (v == null || v === '') { if (required) throw new UserError(`Manca: ${what}.`, 'argomenti'); return ''; }
  if (typeof v !== 'string') throw new UserError(`Dati non validi: ${what} deve essere un testo.`, 'argomenti');
  if (v.length > max) throw new UserError(`Il testo «${what}» è troppo lungo (massimo ${max} caratteri).`, 'argomenti');
  return v;
}
function num(v, what, { min = -Infinity, max = Infinity, def } = {}) {
  if (v == null && def !== undefined) return def;
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) throw new UserError(`Dati non validi: ${what}.`, 'argomenti');
  return v;
}

// ======================================================================================
// ID digitale (.p12)
// ======================================================================================
function fmtDate(d) { return d ? new Date(d).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—'; }

/** Apre un .p12/.pfx. → { keyPem, privateKey (KeyObject), certs: [X509Certificate], signer: X509Certificate, signerDer, chainDer[] } */
function loadP12(p12Bytes, password) {
  const buf = toBuffer(p12Bytes, '.p12', MAX_P12);
  const pw = str(password ?? '', 'password', { max: 1024 });
  let p12Asn1;
  if (buf[0] !== 0x30) throw new UserError('Il file scelto non è un ID digitale valido (.p12 o .pfx). Controlla di aver scelto il file giusto.', 'p12-non-valido');
  try { p12Asn1 = asn1.fromDer(forge.util.createBuffer(buf.toString('binary')), { strict: false }); }
  catch { throw new UserError('Il file scelto non è un ID digitale valido (.p12 o .pfx). Controlla di aver scelto il file giusto.', 'p12-non-valido'); }
  let p12;
  try { p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, false, pw); }
  catch (e) {
    const m = String(e && e.message || e);
    if (/MAC could not be verified|Invalid password|password/i.test(m)) throw new UserError('Password dell\'ID digitale errata. Riprova facendo attenzione a maiuscole e minuscole.', 'password-errata');
    if (/Unsupported|not supported|OID/i.test(m)) throw new UserError('Questo ID digitale usa una cifratura non supportata. Esportalo di nuovo dal programma di origine scegliendo la cifratura «3DES» o «AES-256».', 'p12-non-supportato');
    if (/Too few bytes|Unparsed|not a valid|asn\.?1|Invalid|unknown|Cannot read/i.test(m)) throw new UserError('Il file scelto non è un ID digitale valido (.p12 o .pfx). Controlla di aver scelto il file giusto.', 'p12-non-valido');
    throw new UserError('Impossibile leggere l\'ID digitale: il file è danneggiato o la password è errata.', 'p12-non-valido');
  }
  // chiave privata: pkcs8ShroudedKeyBag o keyBag; se forge non sa decodificarla (es. curve ellittiche) si prova il PKCS#8 grezzo
  let keyObj = null;
  for (const type of [forge.pki.oids.pkcs8ShroudedKeyBag, forge.pki.oids.keyBag]) {
    const bags = (p12.getBags({ bagType: type })[type]) || [];
    for (const bag of bags) {
      try {
        if (bag.key) { keyObj = crypto.createPrivateKey(forge.pki.privateKeyToPem(bag.key)); break; }
        if (bag.asn1) { keyObj = crypto.createPrivateKey({ key: Buffer.from(asn1.toDer(bag.asn1).getBytes(), 'binary'), format: 'der', type: 'pkcs8' }); break; }
      } catch {}
    }
    if (keyObj) break;
  }
  if (!keyObj) throw new UserError('L\'ID digitale non contiene una chiave privata utilizzabile (forse contiene solo il certificato pubblico).', 'p12-senza-chiave');
  const certBags = p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] || [];
  const certs = [];
  for (const bag of certBags) {
    try {
      const der = bag.cert ? Buffer.from(asn1.toDer(forge.pki.certificateToAsn1(bag.cert)).getBytes(), 'binary') : Buffer.from(asn1.toDer(bag.asn1).getBytes(), 'binary');
      certs.push({ der, x509: new crypto.X509Certificate(der) });
    } catch {}
  }
  if (!certs.length) throw new UserError('L\'ID digitale non contiene un certificato.', 'p12-senza-certificato');
  const pub = crypto.createPublicKey(keyObj).export({ type: 'spki', format: 'der' });
  const mine = certs.find((c) => c.x509.publicKey.export({ type: 'spki', format: 'der' }).equals(pub));
  if (!mine) throw new UserError('Nell\'ID digitale il certificato non corrisponde alla chiave privata.', 'p12-incoerente');
  const kt = keyObj.asymmetricKeyType;
  if (!['rsa', 'ec'].includes(kt)) throw new UserError(`Tipo di chiave non supportato (${kt}). Sono supportate chiavi RSA ed ECDSA.`, 'p12-non-supportato');
  return { privateKey: keyObj, keyType: kt, signer: mine.x509, signerDer: mine.der, chainDer: certs.filter((c) => c !== mine).map((c) => c.der) };
}

function certInfo(x509, at = new Date()) {
  const nb = new Date(x509.validFrom); const na = new Date(x509.validTo);
  const selfSigned = (() => { try { return x509.subject === x509.issuer && x509.verify(x509.publicKey); } catch { return false; } })();
  return {
    subject: dnField(x509.subject, 'CN') || x509.subject.split('\n')[0] || '—',
    organization: dnField(x509.subject, 'O'), email: dnField(x509.subject, 'emailAddress') || (x509.subjectAltName || '').replace(/^email:/, ''),
    issuer: dnField(x509.issuer, 'CN') || dnField(x509.issuer, 'O') || '—', issuerOrg: dnField(x509.issuer, 'O'),
    fiscalCode: (dnField(x509.subject, 'serialNumber') || '').replace(/^(TINIT-|IT:)/, ''),
    notBefore: nb.toISOString(), notAfter: na.toISOString(), selfSigned,
    expired: at > na, notYetValid: at < nb, serial: x509.serialNumber,
    qualified: /QC|qualif/i.test(x509.toString()) || false,
  };
}
function dnField(dn, key) {
  const m = new RegExp('(?:^|\\n)' + key + '=([^\\n]*)').exec(dn || '');
  return m ? m[1].trim() : '';
}

/** Descrive un .p12 senza firmare (per mostrare titolare e scadenza prima della firma). */
function describeP12(p12Bytes, password) {
  const id = loadP12(p12Bytes, password);
  return certInfo(id.signer);
}

/** Crea un ID digitale autofirmato (.p12). */
function createSelfSignedId(opts = {}) {
  const name = str(opts.name, 'nome', { max: 200, required: true }).trim();
  const email = str(opts.email, 'email', { max: 200 }).trim();
  const org = str(opts.organization, 'organizzazione', { max: 200 }).trim();
  const unit = str(opts.unit, 'unità', { max: 200 }).trim();
  const country = str(opts.country || 'IT', 'paese', { max: 2 }).toUpperCase();
  const password = str(opts.password, 'password', { max: 1024, required: true });
  const years = num(opts.years, 'anni di validità', { min: 1, max: 30, def: 5 });
  if (password.length < 6) throw new UserError('Scegli una password di almeno 6 caratteri per proteggere l\'ID digitale.', 'argomenti');
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new UserError('L\'indirizzo email non sembra valido.', 'argomenti');
  if (country && !/^[A-Z]{2}$/.test(country)) throw new UserError('Il paese va indicato con due lettere (es. IT).', 'argomenti');
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const fkey = forge.pki.privateKeyFromPem(privateKey.export({ type: 'pkcs1', format: 'pem' }));
  const fpub = forge.pki.publicKeyFromPem(publicKey.export({ type: 'spki', format: 'pem' }));
  const cert = forge.pki.createCertificate();
  cert.publicKey = fpub;
  cert.serialNumber = '01' + crypto.randomBytes(15).toString('hex');
  const now = new Date();
  cert.validity.notBefore = new Date(now.getTime() - 60 * 1000);
  cert.validity.notAfter = new Date(now); cert.validity.notAfter.setFullYear(now.getFullYear() + years);
  const attrs = [{ shortName: 'CN', value: name }];
  if (unit) attrs.push({ shortName: 'OU', value: unit });
  if (org) attrs.push({ shortName: 'O', value: org });
  if (country) attrs.push({ shortName: 'C', value: country });
  if (email) attrs.push({ name: 'emailAddress', value: email });
  cert.setSubject(attrs); cert.setIssuer(attrs);
  const exts = [
    { name: 'basicConstraints', cA: false },
    { name: 'keyUsage', digitalSignature: true, nonRepudiation: true, keyEncipherment: true },
    { name: 'extKeyUsage', emailProtection: true, clientAuth: true },
    { name: 'subjectKeyIdentifier' },
  ];
  if (email) exts.push({ name: 'subjectAltName', altNames: [{ type: 1, value: email }] });
  cert.setExtensions(exts);
  // stringhe UTF-8 (nomi con accenti)
  cert.subject.attributes.forEach((a) => { a.valueTagClass = asn1.Type.UTF8; });
  cert.issuer.attributes.forEach((a) => { a.valueTagClass = asn1.Type.UTF8; });
  cert.sign(fkey, forge.md.sha256.create());
  const p12Asn1 = forge.pkcs12.toPkcs12Asn1(fkey, [cert], password, { algorithm: '3des', friendlyName: name, generateLocalKeyId: true });
  const der = Buffer.from(asn1.toDer(p12Asn1).getBytes(), 'binary');
  // verifica: il file si riapre con la stessa password
  loadP12(der, password);
  return der;
}

// ======================================================================================
// CMS (PKCS#7 / CAdES) costruito a mano con primitive ASN.1: niente limiti di forge sugli attributi
// ======================================================================================
const OID = {
  data: '1.2.840.113549.1.7.1', signedData: '1.2.840.113549.1.7.2',
  contentType: '1.2.840.113549.1.9.3', messageDigest: '1.2.840.113549.1.9.4', signingTime: '1.2.840.113549.1.9.5',
  signingCertV2: '1.2.840.113549.1.9.16.2.47', signingCert: '1.2.840.113549.1.9.16.2.12',
  sha1: '1.3.14.3.2.26', sha256: '2.16.840.1.101.3.4.2.1', sha384: '2.16.840.1.101.3.4.2.2', sha512: '2.16.840.1.101.3.4.2.3',
  rsa: '1.2.840.113549.1.1.1', sha256rsa: '1.2.840.113549.1.1.11', sha1rsa: '1.2.840.113549.1.1.5', sha384rsa: '1.2.840.113549.1.1.12', sha512rsa: '1.2.840.113549.1.1.13', rsapss: '1.2.840.113549.1.1.10',
  ecdsa256: '1.2.840.10045.4.3.2', ecdsa384: '1.2.840.10045.4.3.3', ecdsa512: '1.2.840.10045.4.3.4', ecPublicKey: '1.2.840.10045.2.1', ecdsa1: '1.2.840.10045.4.1',
};
const HASH_BY_OID = { [OID.sha1]: 'sha1', [OID.sha256]: 'sha256', [OID.sha384]: 'sha384', [OID.sha512]: 'sha512',
  [OID.sha256rsa]: 'sha256', [OID.sha1rsa]: 'sha1', [OID.sha384rsa]: 'sha384', [OID.sha512rsa]: 'sha512', [OID.ecdsa256]: 'sha256', [OID.ecdsa384]: 'sha384', [OID.ecdsa512]: 'sha512', [OID.ecdsa1]: 'sha1' };

const A = {
  seq: (v) => asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, v),
  set: (v) => asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SET, true, v),
  oid: (o) => asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OID, false, asn1.oidToDer(o).getBytes()),
  int: (n) => asn1.create(asn1.Class.UNIVERSAL, asn1.Type.INTEGER, false, asn1.integerToDer(n).getBytes()),
  octet: (bin) => asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OCTETSTRING, false, bin),
  nul: () => asn1.create(asn1.Class.UNIVERSAL, asn1.Type.NULL, false, ''),
  ctx: (n, v, constructed = true) => asn1.create(asn1.Class.CONTEXT_SPECIFIC, n, constructed, v),
  utc: (d) => (d.getUTCFullYear() >= 1950 && d.getUTCFullYear() < 2050
    ? asn1.create(asn1.Class.UNIVERSAL, asn1.Type.UTCTIME, false, asn1.dateToUtcTime(d))
    : asn1.create(asn1.Class.UNIVERSAL, asn1.Type.GENERALIZEDTIME, false, asn1.dateToGeneralizedTime(d))),
  der: (node) => Buffer.from(asn1.toDer(node).getBytes(), 'binary'),
  fromDer: (buf, strict = true) => asn1.fromDer(forge.util.createBuffer(Buffer.from(buf).toString('binary')), { strict, parseAllBytes: strict, decodeBitStrings: false }),
  bin: (buf) => Buffer.from(buf).toString('binary'),
};

/** issuer e numero di serie presi tali e quali dal certificato DER. */
function issuerAndSerial(certDer) {
  const c = A.fromDer(certDer);
  const tbs = c.value[0];
  const i = tbs.value[0].tagClass === asn1.Class.CONTEXT_SPECIFIC ? 1 : 0;
  return { serial: tbs.value[i], issuer: tbs.value[i + 2] };
}

/**
 * Crea un SignedData CMS.
 * @param {{ hash?:Buffer, content?:Buffer, attached:boolean, id, cades:boolean, signingTime?:Date }} o
 */
function buildCms(o) {
  const { id } = o;
  const digest = o.hash || crypto.createHash('sha256').update(o.content).digest();
  const attrs = [
    A.seq([A.oid(OID.contentType), A.set([A.oid(OID.data)])]),
    A.seq([A.oid(OID.messageDigest), A.set([A.octet(A.bin(digest))])]),
    // ESS signing-certificate-v2: lega il certificato alla firma (richiesto da CAdES/PAdES)
    A.seq([A.oid(OID.signingCertV2), A.set([A.seq([A.seq([A.seq([A.octet(A.bin(crypto.createHash('sha256').update(id.signerDer).digest()))])])])])]),
  ];
  if (!o.noSigningTime) attrs.push(A.seq([A.oid(OID.signingTime), A.set([A.utc(o.signingTime || new Date())])]));
  // DER: gli elementi di un SET OF vanno ordinati per codifica
  const encoded = attrs.map((a) => ({ a, d: A.der(a) })).sort((x, y) => Buffer.compare(x.d, y.d));
  const signedAttrsSet = A.set(encoded.map((e) => e.a));
  const toSign = A.der(signedAttrsSet); // con tag SET (0x31), come richiesto dalla RFC 5652
  const signature = crypto.sign('sha256', toSign, id.keyType === 'ec' ? { key: id.privateKey, dsaEncoding: 'der' } : id.privateKey);
  const signedAttrs = A.ctx(0, encoded.map((e) => e.a));
  const { serial, issuer } = issuerAndSerial(id.signerDer);
  const sigAlg = id.keyType === 'ec' ? A.seq([A.oid(OID.ecdsa256)]) : A.seq([A.oid(OID.rsa), A.nul()]);
  const signerInfo = A.seq([A.int(1), A.seq([issuer, serial]), A.seq([A.oid(OID.sha256), A.nul()]), signedAttrs, sigAlg, A.octet(A.bin(signature))]);
  const encap = o.attached ? A.seq([A.oid(OID.data), A.ctx(0, [A.octet(A.bin(o.content))])]) : A.seq([A.oid(OID.data)]);
  const certs = [id.signerDer, ...id.chainDer].map((d) => A.fromDer(d));
  const sd = A.seq([A.int(1), A.set([A.seq([A.oid(OID.sha256), A.nul()])]), encap, A.ctx(0, certs), A.set([signerInfo])]);
  return A.der(A.seq([A.oid(OID.signedData), A.ctx(0, [sd])]));
}

/** Signer per @signpdf/signpdf: CMS staccato sull'intervallo di byte. */
class LeggioSigner extends Signer {
  constructor(id, { cades }) { super(); this.id = id; this.cades = cades; }
  async sign(pdfBuffer, signingTime) {
    const hash = crypto.createHash('sha256').update(pdfBuffer).digest();
    // PAdES (ETSI.CAdES.detached): l'ora di firma sta nel dizionario /M, non negli attributi firmati
    return buildCms({ hash, attached: false, id: this.id, noSigningTime: this.cades, signingTime });
  }
}

// ======================================================================================
// Aggiornamento incrementale con il segnaposto della firma
// ======================================================================================
const { PDFName, PDFDict, PDFArray, PDFRef, PDFString, PDFHexString, PDFNumber, PDFInvalidObject, PDFDocument, StandardFonts } = PDFLib;

function lastStartXref(buf) {
  const tail = buf.subarray(Math.max(0, buf.length - 4096)).toString('latin1');
  const m = /startxref\s+(\d+)\s+%%EOF[\s\S]*$/.exec(tail) || /startxref\s+(\d+)/g.exec(tail);
  if (!m) return null;
  const off = parseInt(m[1], 10);
  if (!(off > 0 && off < buf.length)) return null;
  const at = buf.subarray(off, off + 64).toString('latin1');
  if (/^\s*xref/.test(at)) return { offset: off, kind: 'table' };
  if (/^\s*\d+\s+\d+\s+obj/.test(at)) return { offset: off, kind: 'stream' };
  return null;
}

function pdfText(s) { return /^[\x20-\x7e]*$/.test(s) ? PDFString.of(s) : PDFHexString.fromText(s); }

function objBytes(obj) { const b = new Uint8Array(obj.sizeInBytes()); obj.copyBytesInto(b, 0); return Buffer.from(b); }

/** Testo per un font standard (WinAnsi): i caratteri non rappresentabili diventano «?». */
function safeEncode(font, text) {
  let out = '';
  for (const ch of String(text)) { try { font.encodeText(ch); out += ch; } catch { out += '?'; } }
  return out;
}

function wrap(font, text, size, maxW) {
  const words = String(text).split(/\s+/).filter(Boolean); const lines = []; let cur = '';
  for (const w of words) {
    const t = cur ? cur + ' ' + w : w;
    if (font.widthOfTextAtSize(t, size) <= maxW || !cur) cur = t; else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  return lines;
}

/** Contenuto dell'aspetto visibile: immagine della firma (facoltativa) a sinistra, testo a destra. */
async function buildAppearance(pdfDoc, w, h, info) {
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const ops = [];
  const res = { Font: {}, XObject: {} };
  res.Font.F1 = font.ref; res.Font.F2 = bold.ref;
  let textX = 4;
  if (info.imagePng) {
    try {
      const img = await pdfDoc.embedPng(info.imagePng);
      const maxW = info.text === false ? w - 8 : w * 0.45; const maxH = h - 8;
      const s = Math.min(maxW / img.width, maxH / img.height);
      const iw = img.width * s; const ih = img.height * s;
      res.XObject.Im1 = img.ref;
      ops.push(`q ${iw.toFixed(2)} 0 0 ${ih.toFixed(2)} ${(4 + (maxW - iw) / 2).toFixed(2)} ${((h - ih) / 2).toFixed(2)} cm /Im1 Do Q`);
      textX = 8 + maxW;
    } catch { /* immagine non valida: solo testo */ }
  }
  if (info.text !== false) {
    const lines = [
      { t: 'Firmato digitalmente da', f: font, k: 'F1', r: 0.75 },
      { t: info.name || '—', f: bold, k: 'F2', r: 1.1 },
      { t: 'Data: ' + info.dateText, f: font, k: 'F1', r: 0.8 },
    ];
    if (info.reason) lines.push({ t: 'Motivo: ' + info.reason, f: font, k: 'F1', r: 0.8 });
    if (info.location) lines.push({ t: 'Luogo: ' + info.location, f: font, k: 'F1', r: 0.8 });
    const availW = w - textX - 4;
    // dimensione che fa stare tutto nel riquadro
    let size = Math.min(14, h / 4);
    for (; size > 3; size -= 0.25) {
      const all = lines.flatMap((l) => wrap(l.f, safeEncode(l.f, l.t), size * l.r, availW).map(() => size * l.r * 1.22));
      const widest = Math.max(...lines.map((l) => Math.max(...wrap(l.f, safeEncode(l.f, l.t), size * l.r, availW).map((x) => l.f.widthOfTextAtSize(x, size * l.r)))));
      if (all.reduce((a, b) => a + b, 0) <= h - 6 && widest <= availW + 0.5) break;
    }
    let y = h - 3;
    ops.push('BT 0.1 0.1 0.12 rg');
    for (const l of lines) {
      const fs2 = size * l.r;
      for (const part of wrap(l.f, safeEncode(l.f, l.t), fs2, availW)) {
        y -= fs2 * 1.1;
        const hex = l.f.encodeText(part).toString();
        ops.push(`/${l.k} ${fs2.toFixed(2)} Tf 1 0 0 1 ${textX.toFixed(2)} ${y.toFixed(2)} Tm ${hex} Tj`);
        y -= fs2 * 0.12;
      }
    }
    ops.push('ET');
  }
  // bordo sottile
  ops.push(`q 0.06 0.46 0.43 RG 0.6 w 0.3 0.3 ${(w - 0.6).toFixed(2)} ${(h - 0.6).toFixed(2)} re S Q`);
  const stream = pdfDoc.context.flateStream(ops.join('\n'), {
    Type: 'XObject', Subtype: 'Form', BBox: [0, 0, w, h],
    Resources: { Font: res.Font, ...(res.XObject.Im1 ? { XObject: res.XObject } : {}) },
  });
  return pdfDoc.context.register(stream);
}

function pdfDateString(d) {
  const p = (n, l = 2) => String(n).padStart(l, '0');
  const off = -d.getTimezoneOffset(); const s = off >= 0 ? '+' : '-'; const a = Math.abs(off);
  return `D:${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}${s}${p(Math.floor(a / 60))}'${p(a % 60)}'`;
}

/**
 * Aggiunge (in coda al file, senza toccare i byte esistenti) campo firma, widget e dizionario /Sig con segnaposto.
 * opts: { visible, pageIndex, rect:[x1,y1,x2,y2], name, reason, location, contactInfo, subFilter, signingTime, imagePng, fieldName }
 */
async function addPlaceholderIncremental(original, opts) {
  let base = original;
  let pdfDoc;
  try { pdfDoc = await PDFDocument.load(base, { updateMetadata: false, ignoreEncryption: true, throwOnInvalidObject: false }); }
  catch { throw new UserError('Il PDF è danneggiato e non può essere firmato. Prova prima a ripararlo o a salvarne una copia.', 'pdf-non-valido'); }
  if (pdfDoc.isEncrypted || pdfDoc.context.trailerInfo.Encrypt) throw new UserError('Il PDF è protetto da password o da restrizioni: togli prima la protezione (Proteggi → Rimuovi protezione), poi firma.', 'pdf-protetto');
  try { pdfDoc.getPages(); if (!(pdfDoc.context.trailerInfo.Root instanceof PDFRef)) throw new Error('radice'); }
  catch { throw new UserError('Il PDF è danneggiato (struttura interna non leggibile) e non può essere firmato.', 'pdf-non-valido'); }
  let sx = lastStartXref(base);
  if (!sx) {
    // tabella dei riferimenti danneggiata: si normalizza, ma solo se non ci sono firme da preservare
    if (base.includes('/ByteRange')) throw new UserError('Il PDF è già firmato ma la sua struttura interna è danneggiata: non è possibile aggiungere una firma senza invalidare quelle esistenti.', 'pdf-non-valido');
    base = Buffer.from(await pdfDoc.save({ useObjectStreams: false }));
    pdfDoc = await PDFDocument.load(base, { updateMetadata: false });
    sx = lastStartXref(base);
    if (!sx) throw new UserError('Il PDF ha una struttura interna non riconosciuta e non può essere firmato.', 'pdf-non-valido');
  }
  const ctx = pdfDoc.context;
  const origLargest = ctx.largestObjectNumber;
  let pages;
  try { pages = pdfDoc.getPages(); if (!(ctx.trailerInfo.Root instanceof PDFRef)) throw new Error('radice'); }
  catch { throw new UserError('Il PDF è danneggiato (struttura interna non leggibile) e non può essere firmato.', 'pdf-non-valido'); }
  if (!pages.length) throw new UserError('Il PDF non ha pagine.', 'pdf-non-valido');
  const pageIndex = Math.min(Math.max(0, opts.pageIndex | 0), pages.length - 1);
  const page = pages[pageIndex];
  const now = opts.signingTime || new Date();
  const rect = opts.visible && opts.rect ? opts.rect.map(Number) : [0, 0, 0, 0];
  const [x1, y1, x2, y2] = [Math.min(rect[0], rect[2]), Math.min(rect[1], rect[3]), Math.max(rect[0], rect[2]), Math.max(rect[1], rect[3])];
  const w = x2 - x1; const h = y2 - y1;

  // nome del campo univoco
  const catalog = pdfDoc.catalog;
  let acroRef = catalog.get(PDFName.of('AcroForm'));
  let acro = acroRef instanceof PDFRef ? ctx.lookup(acroRef, PDFDict) : acroRef instanceof PDFDict ? acroRef : undefined;
  const existingNames = new Set();
  const fieldsObj = acro ? acro.get(PDFName.of('Fields')) : undefined;
  const fieldsArr = fieldsObj instanceof PDFRef ? ctx.lookupMaybe(fieldsObj, PDFArray) : fieldsObj instanceof PDFArray ? fieldsObj : undefined;
  if (fieldsArr) for (let i = 0; i < fieldsArr.size(); i++) { try { const d = ctx.lookup(fieldsArr.get(i)); const t = d && d.get && d.get(PDFName.of('T')); if (t && t.decodeText) existingNames.add(t.decodeText()); } catch {} }
  let fieldName = opts.fieldName || 'Firma1'; let k = 1;
  while (existingNames.has(fieldName)) fieldName = 'Firma' + (++k);

  const byteRange = PDFArray.withContext(ctx);
  byteRange.push(PDFNumber.of(0));
  for (let i = 0; i < 3; i++) byteRange.push(PDFName.of(BR_PLACEHOLDER));
  const sigDict = ctx.obj({
    Type: 'Sig', Filter: 'Adobe.PPKLite', SubFilter: opts.subFilter === 'cades' ? 'ETSI.CAdES.detached' : 'adbe.pkcs7.detached',
    ByteRange: byteRange,
    Contents: PDFHexString.of('0'.repeat(SIG_BYTES * 2)),
    M: PDFString.of(pdfDateString(now)),
    ...(opts.name ? { Name: pdfText(opts.name) } : {}),
    ...(opts.reason ? { Reason: pdfText(opts.reason) } : {}),
    ...(opts.location ? { Location: pdfText(opts.location) } : {}),
    ...(opts.contactInfo ? { ContactInfo: pdfText(opts.contactInfo) } : {}),
    Prop_Build: { Filter: { Name: 'Adobe.PPKLite' }, App: { Name: 'Leggio' } },
  });
  const sigRef = ctx.register(PDFInvalidObject.of(objBytes(sigDict)));

  const widget = ctx.obj({ Type: 'Annot', Subtype: 'Widget', FT: 'Sig', Rect: [x1, y1, x2, y2], V: sigRef, T: pdfText(fieldName), F: opts.visible ? 4 : 132, P: page.ref });
  if (opts.visible && w > 2 && h > 2) {
    const ap = await buildAppearance(pdfDoc, w, h, { name: opts.name, reason: opts.reason, location: opts.location, imagePng: opts.imagePng, text: opts.showText !== false, dateText: now.toLocaleString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) });
    widget.set(PDFName.of('AP'), ctx.obj({ N: ap }));
  } else {
    widget.set(PDFName.of('AP'), ctx.obj({ N: ctx.register(ctx.formXObject([], { BBox: [0, 0, 0, 0], Resources: {} })) }));
  }
  const widgetRef = ctx.register(widget);

  // oggetti esistenti da riscrivere (versioni nuove in coda)
  const touched = new Map();
  const annots = page.node.get(PDFName.of('Annots'));
  if (annots instanceof PDFRef) { const arr = ctx.lookup(annots, PDFArray); arr.push(widgetRef); touched.set(annots, arr); }
  else { const arr = annots instanceof PDFArray ? annots : ctx.obj([]); arr.push(widgetRef); page.node.set(PDFName.of('Annots'), arr); touched.set(page.ref, page.node); }
  if (!acro) { acro = ctx.obj({ Fields: [] }); acroRef = ctx.register(acro); catalog.set(PDFName.of('AcroForm'), acroRef); touched.set(ctx.trailerInfo.Root, catalog); }
  else if (acroRef instanceof PDFRef) touched.set(acroRef, acro);
  else touched.set(ctx.trailerInfo.Root, catalog);
  const flags = acro.get(PDFName.of('SigFlags'));
  acro.set(PDFName.of('SigFlags'), PDFNumber.of(((flags instanceof PDFNumber ? flags.asNumber() : 0) | 3)));
  const f2 = acro.get(PDFName.of('Fields'));
  if (f2 instanceof PDFRef) { const arr = ctx.lookup(f2, PDFArray); arr.push(widgetRef); touched.set(f2, arr); }
  else if (f2 instanceof PDFArray) f2.push(widgetRef);
  else acro.set(PDFName.of('Fields'), ctx.obj([widgetRef]));
  // gli oggetti dei font/immagini vanno creati prima della scrittura
  if (typeof pdfDoc.flush === 'function') await pdfDoc.flush();

  // scrittura dell'aggiornamento
  const chunks = []; let pos = base.length;
  const sep = base[base.length - 1] === 0x0a || base[base.length - 1] === 0x0d ? '' : '\n';
  const push = (b) => { chunks.push(b); pos += b.length; };
  push(Buffer.from(sep, 'latin1'));
  const offsets = [];
  const writeObj = (ref, obj) => {
    offsets.push({ num: ref.objectNumber, gen: ref.generationNumber, off: pos });
    push(Buffer.from(`${ref.objectNumber} ${ref.generationNumber} obj\n`, 'latin1'));
    push(objBytes(obj));
    push(Buffer.from('\nendobj\n', 'latin1'));
  };
  for (const [ref, obj] of touched) writeObj(ref, obj);
  for (const [ref, obj] of ctx.enumerateIndirectObjects()) if (ref.objectNumber > origLargest) writeObj(ref, obj);
  offsets.sort((a, b) => a.num - b.num);
  const size = Math.max(ctx.largestObjectNumber + 1, ...offsets.map((o) => o.num + 1));
  const tr = ctx.trailerInfo;
  const trailerParts = [`/Size ${size}`, `/Root ${tr.Root.objectNumber} ${tr.Root.generationNumber} R`, `/Prev ${sx.offset}`];
  if (tr.Info instanceof PDFRef) trailerParts.push(`/Info ${tr.Info.objectNumber} ${tr.Info.generationNumber} R`);
  if (tr.ID) trailerParts.push(`/ID ${tr.ID.toString()}`);
  const xrefStart = pos;
  if (sx.kind === 'table') {
    let x = 'xref\n';
    for (const o of offsets) x += `${o.num} 1\n${String(o.off).padStart(10, '0')} ${String(o.gen).padStart(5, '0')} n\r\n`;
    x += `trailer\n<< ${trailerParts.join(' ')} >>\nstartxref\n${xrefStart}\n%%EOF\n`;
    push(Buffer.from(x, 'latin1'));
  } else {
    // flusso dei riferimenti incrociati (come l'originale)
    const xnum = size;
    const all = [...offsets, { num: xnum, gen: 0, off: xrefStart }];
    const rows = Buffer.alloc(all.length * 7);
    all.forEach((o, i) => { rows[i * 7] = 1; rows.writeUInt32BE(o.off, i * 7 + 1); rows.writeUInt16BE(o.gen, i * 7 + 5); });
    const index = all.map((o) => `${o.num} 1`).join(' ');
    const head = `${xnum} 0 obj\n<< /Type /XRef /W [1 4 2] /Index [${index}] ${trailerParts.join(' ').replace(`/Size ${size}`, `/Size ${xnum + 1}`)} /Length ${rows.length} >>\nstream\n`;
    push(Buffer.from(head, 'latin1')); push(rows); push(Buffer.from(`\nendstream\nendobj\nstartxref\n${xrefStart}\n%%EOF\n`, 'latin1'));
  }
  return { bytes: Buffer.concat([base, ...chunks]), fieldName, normalized: base !== original };
}

/** Firma un PDF (PAdES). → { bytes, fieldName, signer: certInfo, verification } */
async function signPdf(pdfBytes, p12Bytes, password, opts = {}) {
  const pdf = toBuffer(pdfBytes, 'PDF', MAX_PDF);
  if (pdf.subarray(0, 1024).indexOf('%PDF') < 0) throw new UserError('Il file non è un PDF.', 'pdf-non-valido');
  const id = loadP12(p12Bytes, password);
  const now = new Date();
  const info = certInfo(id.signer, now);
  if (info.expired) throw new UserError(`Il certificato di ${info.subject} è scaduto il ${fmtDate(info.notAfter)}: con un certificato scaduto la firma non sarebbe valida. Usa un certificato in corso di validità.`, 'certificato-scaduto');
  if (info.notYetValid) throw new UserError(`Il certificato di ${info.subject} sarà valido solo dal ${fmtDate(info.notBefore)}. Controlla la data del computer.`, 'certificato-non-ancora-valido');
  const o = {
    visible: !!opts.visible,
    pageIndex: num(opts.pageIndex, 'pagina', { min: 0, max: 1e6, def: 0 }),
    rect: opts.visible ? (Array.isArray(opts.rect) && opts.rect.length === 4 && opts.rect.every((v) => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) < 1e6) ? opts.rect : (() => { throw new UserError('Riquadro della firma non valido.', 'argomenti'); })()) : null,
    name: str(opts.name, 'nome', { max: 300 }) || info.subject,
    reason: str(opts.reason, 'motivo', { max: 500 }),
    location: str(opts.location, 'luogo', { max: 300 }),
    contactInfo: str(opts.contactInfo, 'contatto', { max: 300 }),
    subFilter: opts.subFilter === 'cades' ? 'cades' : 'pkcs7',
    imagePng: opts.imagePng ? toBuffer(opts.imagePng, 'immagine della firma', 8 * 1024 * 1024) : null,
    showText: opts.showText !== false,
    signingTime: now,
  };
  const { bytes: withPlaceholder, fieldName, normalized } = await addPlaceholderIncremental(pdf, o);
  let signed;
  try { signed = await new SignPdf().sign(withPlaceholder, new LeggioSigner(id, { cades: o.subFilter === 'cades' }), now); }
  catch (e) {
    if (/exceeds placeholder/i.test(e.message)) throw new UserError('La catena del certificato è troppo lunga per lo spazio riservato alla firma.', 'firma-troppo-grande');
    throw e;
  }
  // controlli di sicurezza prima di proporre il risultato
  if (!normalized && !signed.subarray(0, pdf.length).equals(pdf)) throw new Error('Controllo interno fallito: i byte originali sono cambiati. Firma annullata.');
  const report = await verifyPdf(signed);
  const mine = report.signatures.find((s) => s.fieldName === fieldName) || report.signatures[report.signatures.length - 1];
  if (!mine || !mine.integrity || !mine.signatureValid || !mine.coversWholeDocument) throw new Error('Controllo interno fallito: la firma appena creata non risulta valida. Il documento non è stato modificato.');
  try { await PDFDocument.load(signed, { updateMetadata: false, ignoreEncryption: true }); }
  catch { throw new Error('Controllo interno fallito: il PDF firmato non si riapre. Il documento non è stato modificato.'); }
  return { bytes: new Uint8Array(signed.buffer, signed.byteOffset, signed.length), fieldName, signer: info, verification: mine, normalized };
}

/** Firma CAdES: busta .p7m con il file dentro. */
function signP7m(fileBytes, p12Bytes, password) {
  const content = toBuffer(fileBytes, 'da firmare', 512 * 1024 * 1024);
  const id = loadP12(p12Bytes, password);
  const info = certInfo(id.signer);
  if (info.expired) throw new UserError(`Il certificato di ${info.subject} è scaduto il ${fmtDate(info.notAfter)}.`, 'certificato-scaduto');
  if (info.notYetValid) throw new UserError(`Il certificato di ${info.subject} non è ancora valido.`, 'certificato-non-ancora-valido');
  const der = buildCms({ content, attached: true, id });
  const v = verifyCms(der, null);
  if (!v.integrity || !v.signatureValid) throw new Error('Controllo interno fallito: la busta .p7m creata non risulta valida.');
  return { bytes: new Uint8Array(der.buffer, der.byteOffset, der.length), signer: info };
}

// ======================================================================================
// Verifica
// ======================================================================================
function nodeHex(n) { return Buffer.from(n.value, 'binary'); }

/**
 * Verifica un CMS. detachedChunks: array di Buffer (contenuto firmato) o null se il contenuto è dentro.
 * → { integrity, signatureValid, signer: certInfo|null, signingTime, digestAlgorithm, content?, problems[] }
 */
function verifyCms(cmsDer, detachedChunks) {
  const out = { integrity: false, signatureValid: false, signer: null, signingTime: null, digestAlgorithm: null, problems: [], chain: [] };
  let root;
  try { root = A.fromDer(cmsDer, false); } catch { out.problems.push('La firma è illeggibile (dati CMS non validi).'); return out; }
  try {
    if (asn1.derToOid(root.value[0].value) !== OID.signedData) { out.problems.push('Il contenuto della firma non è di tipo SignedData.'); return out; }
    const sd = root.value[1].value[0];
    const parts = sd.value;
    const encap = parts[2];
    let idx = 3; let certNodes = [];
    if (parts[idx] && parts[idx].tagClass === asn1.Class.CONTEXT_SPECIFIC && parts[idx].type === 0) { certNodes = parts[idx].value; idx++; }
    if (parts[idx] && parts[idx].tagClass === asn1.Class.CONTEXT_SPECIFIC && parts[idx].type === 1) idx++;
    const signerInfos = parts[idx];
    const si = signerInfos && signerInfos.value && signerInfos.value[0];
    if (!si) { out.problems.push('Nella firma non ci sono informazioni sul firmatario.'); return out; }
    const certs = [];
    for (const c of certNodes) { try { const der = A.der(c); certs.push({ der, x509: new crypto.X509Certificate(der) }); } catch {} }
    // contenuto
    let chunks = detachedChunks;
    if (!chunks) {
      const eci = encap.value[1];
      if (!eci) { out.problems.push('La busta non contiene il documento firmato (firma staccata senza file).'); return out; }
      let octs = eci.value[0];
      const collect = (n) => (n.constructed ? n.value.flatMap(collect) : [nodeHex(n)]);
      const content = Buffer.concat(collect(octs));
      out.content = content; chunks = [content];
    }
    const sv = si.value;
    const sid = sv[1];
    const digestAlg = asn1.derToOid(sv[2].value[0].value);
    const hashName = HASH_BY_OID[digestAlg];
    out.digestAlgorithm = hashName || digestAlg;
    if (!hashName) { out.problems.push('Algoritmo di impronta non supportato.'); return out; }
    if (hashName === 'sha1') out.problems.push('La firma usa SHA-1, un algoritmo ormai debole.');
    let k = 3; let signedAttrs = null;
    if (sv[k].tagClass === asn1.Class.CONTEXT_SPECIFIC && sv[k].type === 0) { signedAttrs = sv[k]; k++; }
    const sigAlgOid = asn1.derToOid(sv[k].value[0].value);
    const signature = nodeHex(sv[k + 1]);
    const h = crypto.createHash(hashName); for (const c of chunks) h.update(c); const digest = h.digest();
    // firmatario: per issuer+serial o per subjectKeyIdentifier
    let signerCert = null;
    if (sid.tagClass === asn1.Class.UNIVERSAL) {
      const want = A.der(sid.value[1]).toString('hex');
      signerCert = certs.find((c) => { try { return A.der(issuerAndSerial(c.der).serial).toString('hex') === want; } catch { return false; } });
    } else {
      const ski = nodeHex(sid).toString('hex').toUpperCase();
      signerCert = certs.find((c) => { try { return (c.x509.toString().includes(ski)); } catch { return false; } });
    }
    if (!signerCert && certs.length === 1) signerCert = certs[0];
    let dataToVerify;
    if (signedAttrs) {
      let md = null;
      for (const at of signedAttrs.value) {
        const t = asn1.derToOid(at.value[0].value);
        const v = at.value[1].value[0];
        if (t === OID.messageDigest) md = nodeHex(v);
        if (t === OID.signingTime) { try { out.signingTime = (v.type === asn1.Type.UTCTIME ? asn1.utcTimeToDate(v.value) : asn1.generalizedTimeToDate(v.value)).toISOString(); } catch {} }
      }
      out.integrity = !!md && md.equals(digest);
      if (!md) out.problems.push('Nella firma manca l\'impronta del documento.');
      const setNode = asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SET, true, signedAttrs.value);
      // la codifica originale va preservata: si ricostruisce dal DER grezzo cambiando solo il tag
      const raw = A.der(signedAttrs); raw[0] = 0x31; dataToVerify = raw;
      void setNode;
    } else {
      out.integrity = true; // senza attributi la verifica della firma copre direttamente il contenuto
      dataToVerify = Buffer.concat(chunks);
    }
    if (!signerCert) { out.problems.push('Il certificato del firmatario non è incluso nella firma.'); return out; }
    out.signer = certInfo(signerCert.x509, out.signingTime ? new Date(out.signingTime) : new Date());
    out.signer.expiredNow = new Date() > new Date(out.signer.notAfter);
    try {
      const key = signerCert.x509.publicKey;
      const hashForSig = HASH_BY_OID[sigAlgOid] || hashName;
      if (sigAlgOid === OID.rsapss) out.signatureValid = crypto.verify(hashName, dataToVerify, { key, padding: crypto.constants.RSA_PKCS1_PSS_PADDING, saltLength: crypto.constants.RSA_PSS_SALTLEN_AUTO }, signature);
      else out.signatureValid = crypto.verify(hashForSig, dataToVerify, key.asymmetricKeyType === 'ec' ? { key, dsaEncoding: 'der' } : key, signature);
    } catch (e) { out.problems.push('Impossibile controllare la firma matematica: ' + (e.message || e)); }
    // catena: emittente presente nella firma?
    let cur = signerCert; const seen = new Set();
    while (cur && !seen.has(cur.der.toString('hex'))) {
      seen.add(cur.der.toString('hex'));
      out.chain.push(dnField(cur.x509.subject, 'CN') || cur.x509.subject);
      const issuer = certs.find((c) => c !== cur && (() => { try { return cur.x509.checkIssued(c.x509) && cur.x509.verify(c.x509.publicKey); } catch { return false; } })());
      cur = issuer;
    }
  } catch (e) {
    out.problems.push('Struttura della firma non riconosciuta: ' + (e.message || e));
  }
  return out;
}

function decodePdfString(s) {
  if (s == null) return '';
  if (s.startsWith('<')) {
    const hx = s.slice(1, -1).replace(/[^0-9a-fA-F]/g, '');
    const b = Buffer.from(hx.length % 2 ? hx + '0' : hx, 'hex');
    if (b[0] === 0xfe && b[1] === 0xff) { let r = ''; for (let i = 2; i + 1 < b.length; i += 2) r += String.fromCharCode((b[i] << 8) | b[i + 1]); return r; }
    return b.toString('latin1');
  }
  let out = ''; const t = s.slice(1, -1);
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (c !== '\\') { out += c; continue; }
    const n = t[++i];
    const map = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', '(': '(', ')': ')', '\\': '\\' };
    if (n in map) out += map[n];
    else if (/[0-7]/.test(n)) { let o = n; while (o.length < 3 && /[0-7]/.test(t[i + 1])) o += t[++i]; out += String.fromCharCode(parseInt(o, 8) & 0xff); }
  }
  if (out.charCodeAt(0) === 0xfe && out.charCodeAt(1) === 0xff) { let r = ''; for (let i = 2; i + 1 < out.length; i += 2) r += String.fromCharCode((out.charCodeAt(i) << 8) | out.charCodeAt(i + 1)); return r; }
  return out;
}
function dictEntry(dict, key) {
  const re = new RegExp('/' + key + '\\s*(\\((?:\\\\.|[^\\\\)])*\\)|<[0-9A-Fa-f\\s]*>|/[^\\s/<>()\\[\\]]+)');
  const m = re.exec(dict); if (!m) return '';
  return m[1].startsWith('/') ? m[1].slice(1) : decodePdfString(m[1]);
}
function parsePdfDate(s) {
  const m = /D:(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?([Zz+-])?(\d{2})?'?(\d{2})?/.exec(s || '');
  if (!m) return null;
  const [, Y, Mo = '01', D = '01', h = '00', mi = '00', se = '00', tz, th = '00', tm = '00'] = m;
  let t = Date.UTC(+Y, +Mo - 1, +D, +h, +mi, +se);
  if (tz === '+' || tz === '-') t -= (tz === '+' ? 1 : -1) * ((+th) * 60 + (+tm)) * 60000;
  const d = new Date(t); return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Verifica tutte le firme di un PDF. */
async function verifyPdf(pdfBytes) {
  const pdf = toBuffer(pdfBytes, 'PDF', MAX_PDF);
  const sigs = [];
  // nomi dei campi e pagine (best effort con pdf-lib)
  const fieldByObj = new Map();
  if (pdf.length < 400 * 1024 * 1024) {
    try {
      const doc = await PDFDocument.load(pdf, { updateMetadata: false, ignoreEncryption: true, throwOnInvalidObject: false });
      const pageRefs = doc.getPages().map((p) => p.ref.toString());
      for (const [ref, obj] of doc.context.enumerateIndirectObjects()) {
        if (!(obj instanceof PDFDict)) continue;
        const v = obj.get(PDFName.of('V'));
        if (!(v instanceof PDFRef)) continue;
        let ft = obj.get(PDFName.of('FT')); let node = obj; let name = '';
        for (let d = 0; d < 10 && node; d++) {
          const t = node.get(PDFName.of('T')); if (t && t.decodeText) name = name ? t.decodeText() + '.' + name : t.decodeText();
          if (!ft) ft = node.get(PDFName.of('FT'));
          const p = node.get(PDFName.of('Parent')); node = p instanceof PDFRef ? doc.context.lookupMaybe(p, PDFDict) : null;
        }
        if (!ft || ft.toString() !== '/Sig') continue;
        const pRef = obj.get(PDFName.of('P'));
        let page = pRef ? pageRefs.indexOf(pRef.toString()) : -1;
        if (page < 0) doc.getPages().forEach((pg, i) => { const an = pg.node.lookupMaybe(PDFName.of('Annots'), PDFArray); if (an && an.asArray().some((r) => r.toString() === ref.toString())) page = i; });
        const rect = obj.lookupMaybe(PDFName.of('Rect'), PDFArray);
        const r = rect ? rect.asArray().map((n) => (n.asNumber ? n.asNumber() : 0)) : null;
        fieldByObj.set(v.objectNumber, { name, page, visible: !!r && Math.abs(r[2] - r[0]) > 1 && Math.abs(r[3] - r[1]) > 1, rect: r });
      }
    } catch { /* il file può essere malformato: si prosegue con la sola scansione dei byte */ }
  }
  let from = 0; let guard = 0;
  while (guard++ < 500) {
    const at = pdf.indexOf('/ByteRange', from);
    if (at < 0) break;
    from = at + 10;
    const lb = pdf.indexOf('[', at); const rb = pdf.indexOf(']', lb);
    if (lb < 0 || rb < 0 || rb - lb > 200) continue;
    const br = pdf.subarray(lb + 1, rb).toString('latin1').trim().split(/\s+/).map(Number);
    if (br.length !== 4 || br.some((n) => !Number.isInteger(n) || n < 0)) continue;
    const [a, b, c, d] = br;
    const entry = { fieldName: '', page: -1, visible: false, byteRange: br, problems: [] };
    // dizionario: dall'inizio dell'oggetto alla fine
    const objStart = pdf.lastIndexOf(' obj', at); const objEnd = pdf.indexOf('endobj', at);
    const head = pdf.subarray(Math.max(0, objStart - 20), objStart + 4).toString('latin1');
    const numM = /(\d+)\s+(\d+)\s+obj$/.exec(head);
    const dict = objEnd > 0 && objEnd - at < 200000 ? Buffer.concat([pdf.subarray(Math.max(0, objStart), b), pdf.subarray(Math.min(c, objEnd), objEnd)]).toString('latin1') : '';
    entry.name = dictEntry(dict, 'Name'); entry.reason = dictEntry(dict, 'Reason'); entry.location = dictEntry(dict, 'Location');
    entry.contactInfo = dictEntry(dict, 'ContactInfo'); entry.subFilter = dictEntry(dict, 'SubFilter'); entry.dateM = parsePdfDate(dictEntry(dict, 'M'));
    if (numM && fieldByObj.has(+numM[1])) Object.assign(entry, { fieldName: fieldByObj.get(+numM[1]).name, page: fieldByObj.get(+numM[1]).page, visible: fieldByObj.get(+numM[1]).visible });
    if (a !== 0 || b <= 0 || c <= b || c + d > pdf.length || pdf[b] !== 0x3c || pdf[c - 1] !== 0x3e) {
      entry.problems.push('L\'intervallo dei byte firmati non è coerente con il file: il documento è stato alterato o è danneggiato.');
      Object.assign(entry, { integrity: false, signatureValid: false, coversWholeDocument: false });
      sigs.push(entry); continue;
    }
    entry.coversWholeDocument = c + d === pdf.length || (c + d === pdf.length - 1 && /[\r\n]/.test(String.fromCharCode(pdf[pdf.length - 1])));
    entry.revisionLength = c + d;
    const hex = pdf.subarray(b + 1, c - 1).toString('latin1').replace(/[^0-9a-fA-F]/g, '');
    const cms = Buffer.from(hex.length % 2 ? hex + '0' : hex, 'hex');
    const v = verifyCms(cms, [pdf.subarray(a, a + b), pdf.subarray(c, c + d)]);
    delete v.content;
    Object.assign(entry, v, { problems: [...entry.problems, ...v.problems] });
    if (!entry.name && v.signer) entry.name = v.signer.subject;
    entry.signingTime = v.signingTime || entry.dateM;
    sigs.push(entry);
  }
  // modifiche successive: cosa c'è dopo ogni firma?
  sigs.sort((x, y) => x.revisionLength - y.revisionLength);
  sigs.forEach((s, i) => {
    if (s.coversWholeDocument || !s.revisionLength) return;
    const laterSigs = sigs.slice(i + 1).filter((t) => t.integrity);
    s.laterSignatures = laterSigs.length;
    const lastSigned = laterSigs.length ? laterSigs[laterSigs.length - 1].revisionLength : s.revisionLength;
    s.modifiedAfterLastSignature = lastSigned < pdf.length - 2;
  });
  for (const s of sigs) s.verdict = verdict(s);
  return { signatures: sigs, fileSize: pdf.length, summary: summary(sigs) };
}

/** Verdetto in italiano semplice: { level: 'ok'|'warn'|'bad', title, detail[] } */
function verdict(s) {
  const det = [];
  if (!s.integrity || !s.signatureValid) {
    return { level: 'bad', title: 'Firma NON valida: il documento è stato alterato dopo la firma o la firma è danneggiata', detail: s.problems.length ? s.problems : ['L\'impronta del documento non corrisponde a quella firmata.'] };
  }
  let level = 'ok';
  let title = s.coversWholeDocument ? 'Firma valida, documento non modificato dopo la firma' : '';
  if (!s.coversWholeDocument) {
    if (s.laterSignatures && !s.modifiedAfterLastSignature) { title = 'Firma valida; dopo questa firma sono state aggiunte altre firme'; }
    else { level = 'warn'; title = 'Firma valida, ma il documento è stato modificato dopo la firma'; det.push('La parte firmata è integra. Le modifiche successive (commenti, campi compilati o altro) non sono coperte da questa firma: confronta con la versione firmata.'); }
  }
  const c = s.signer;
  if (c) {
    if (c.selfSigned) { level = level === 'ok' ? 'warn' : level; det.push('Certificato autofirmato: l\'identità del firmatario non è garantita da un ente certificatore.'); }
    else det.push(`Certificato rilasciato da ${c.issuerOrg || c.issuer}. L'appartenenza all'elenco dei certificatori di fiducia e la revoca non si possono controllare senza rete.`);
    if (c.expired) { level = 'warn'; det.push(`Il certificato era scaduto al momento della firma (scadenza ${fmtDate(c.notAfter)}).`); }
    else if (c.notYetValid) { level = 'warn'; det.push('Il certificato non era ancora valido al momento della firma.'); }
    else if (c.expiredNow) det.push(`Il certificato era valido al momento della firma; oggi è scaduto (${fmtDate(c.notAfter)}).`);
  }
  for (const p of s.problems) if (!det.includes(p)) { det.push(p); if (/SHA-1/.test(p)) level = 'warn'; }
  return { level, title, detail: det };
}
function summary(sigs) {
  if (!sigs.length) return { level: 'none', text: 'Il documento non contiene firme digitali.' };
  const bad = sigs.filter((s) => s.verdict.level === 'bad').length;
  const warn = sigs.filter((s) => s.verdict.level === 'warn').length;
  const n = sigs.length;
  if (bad) return { level: 'bad', text: bad === n ? (n === 1 ? 'La firma NON è valida.' : 'Nessuna firma è valida.') : `${bad} firme su ${n} NON sono valide.` };
  if (warn) return { level: 'warn', text: n === 1 ? 'Firma integra, con avvertenze.' : `Tutte le ${n} firme sono integre, con avvertenze.` };
  return { level: 'ok', text: n === 1 ? 'Firmato: la firma è valida.' : `Firmato: tutte le ${n} firme sono valide.` };
}

/** Verifica una busta .p7m (anche annidata più volte, es. .pdf.p7m.p7m). → { ...esito, content, innerName } */
function verifyP7m(bytes) {
  let buf = toBuffer(bytes, '.p7m', MAX_PDF);
  // alcuni .p7m sono in Base64 (PEM o puro)
  const head = buf.subarray(0, 64).toString('latin1');
  if (!/^\x30/.test(head)) {
    const txt = buf.toString('latin1').replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
    if (/^[A-Za-z0-9+/=]+$/.test(txt)) buf = Buffer.from(txt, 'base64');
  }
  const layers = [];
  let cur = buf;
  for (let i = 0; i < 5; i++) {
    const v = verifyCms(cur, null);
    v.verdict = verdict({ ...v, coversWholeDocument: true, problems: v.problems });
    layers.push(v);
    if (!v.content || v.content[0] !== 0x30) break;
    try { A.fromDer(v.content, false); if (asn1.derToOid(A.fromDer(v.content, false).value[0].value) !== OID.signedData) break; } catch { break; }
    cur = v.content;
  }
  const last = layers[layers.length - 1];
  return { layers: layers.map((l) => { const c = { ...l }; delete c.content; return c; }), content: last.content ? new Uint8Array(last.content) : null };
}

// ======================================================================================
// Firma in blocco
// ======================================================================================
function uniquePath(p) {
  if (!fs.existsSync(p)) return p;
  const dir = path.dirname(p); const ext = path.extname(p); const base = path.basename(p, ext);
  for (let i = 2; i < 1000; i++) { const q = path.join(dir, `${base} (${i})${ext}`); if (!fs.existsSync(q)) return q; }
  throw new UserError('Troppi file con lo stesso nome nella cartella.', 'file');
}

/** Firma più file (percorsi scelti dal dialogo del processo principale). Non sovrascrive mai. */
async function signFiles(paths, p12Bytes, password, opts = {}, onProgress = () => {}) {
  const id = loadP12(p12Bytes, password); // password controllata una volta sola
  void id;
  const results = [];
  for (let i = 0; i < paths.length; i++) {
    const p = paths[i];
    onProgress({ index: i, total: paths.length, name: path.basename(p) });
    try {
      const st = fs.statSync(p);
      if (!st.isFile()) throw new UserError('Non è un file.', 'file');
      if (st.size > MAX_PDF) throw new UserError('File troppo grande.', 'file');
      const data = fs.readFileSync(p);
      let outPath; let out;
      const isPdf = data.subarray(0, 1024).indexOf('%PDF') >= 0;
      if (opts.format === 'p7m' || !isPdf) {
        out = signP7m(data, p12Bytes, password).bytes;
        outPath = uniquePath(p + '.p7m');
      } else {
        out = (await signPdf(data, p12Bytes, password, { ...opts, visible: false })).bytes;
        outPath = uniquePath(path.join(path.dirname(p), path.basename(p, path.extname(p)) + '_firmato.pdf'));
      }
      const tmp = outPath + '.leggio-tmp';
      fs.writeFileSync(tmp, Buffer.from(out));
      fs.renameSync(tmp, outPath);
      results.push({ name: path.basename(p), ok: true, output: outPath });
    } catch (e) {
      const msg = e instanceof UserError ? e.message : e && e.code === 'ENOENT' ? 'Il file non esiste più (spostato o eliminato?).' : e && (e.code === 'EACCES' || e.code === 'EPERM') ? 'Permessi insufficienti per leggere il file o scrivere nella sua cartella.' : 'Errore imprevisto: ' + (e.message || e);
      results.push({ name: path.basename(p), ok: false, error: msg });
    }
  }
  return results;
}

// ======================================================================================
// Registrazione IPC
// ======================================================================================
function safe(fn) {
  return async (_e, ...args) => {
    try { return { ok: true, result: await fn(...args) }; }
    catch (e) {
      if (!(e instanceof UserError)) console.error('[moduli]', e);
      return { ok: false, error: e && e.message ? e.message : String(e), code: e instanceof UserError ? e.code : 'interno' };
    }
  };
}
function obj(v, what) { if (v == null || typeof v !== 'object' || Array.isArray(v)) throw new UserError(`Dati non validi: ${what}.`, 'argomenti'); return v; }

function register({ ipcMain, dialog, getWindow }) {
  ipcMain.handle('feat:moduli:sign', safe(async (a) => {
    obj(a, 'richiesta di firma');
    const r = await signPdf(a.pdf, a.p12, a.password, obj(a.options || {}, 'opzioni'));
    return r;
  }));
  ipcMain.handle('feat:moduli:describe-id', safe(async (a) => { obj(a, 'richiesta'); return describeP12(a.p12, a.password); }));
  ipcMain.handle('feat:moduli:create-id', safe(async (a) => createSelfSignedId(obj(a, 'dati dell\'ID'))));
  ipcMain.handle('feat:moduli:verify', safe(async (a) => { obj(a, 'richiesta'); return verifyPdf(a.pdf); }));
  ipcMain.handle('feat:moduli:verify-p7m', safe(async (a) => { obj(a, 'richiesta'); return verifyP7m(a.data); }));
  ipcMain.handle('feat:moduli:sign-p7m', safe(async (a) => { obj(a, 'richiesta'); return signP7m(a.data, a.p12, a.password); }));
  ipcMain.handle('feat:moduli:sign-batch', safe(async (a) => {
    obj(a, 'richiesta');
    loadP12(a.p12, a.password); // errori di password prima di scegliere i file
    const win = getWindow && getWindow();
    const res = await dialog.showOpenDialog(win, {
      title: 'Scegli i file da firmare', properties: ['openFile', 'multiSelections'],
      filters: a.format === 'p7m' ? [{ name: 'Tutti i file', extensions: ['*'] }] : [{ name: 'Documenti PDF', extensions: ['pdf'] }],
    });
    if (res.canceled || !res.filePaths.length) return { cancelled: true, results: [] };
    if (res.filePaths.length > 500) throw new UserError('Scegli al massimo 500 file per volta.', 'argomenti');
    const opts = obj(a.options || {}, 'opzioni');
    const results = await signFiles(res.filePaths, a.p12, a.password, { ...opts, format: a.format === 'p7m' ? 'p7m' : 'pdf' },
      (p) => { try { win && win.webContents.send('feat:moduli:progress', p); } catch {} });
    return { cancelled: false, results };
  }));
}

module.exports = {
  register, UserError,
  loadP12, describeP12, createSelfSignedId, signPdf, signP7m, verifyPdf, verifyP7m, verifyCms, buildCms,
  addPlaceholderIncremental, signFiles, certInfo, verdict, lastStartXref, decodePdfString, parsePdfDate,
};
