// File firmati CAdES (.p7m): estrazione del documento contenuto, firmatari, certificati,
// marca temporale e verifica d'integrità crittografica delle firme.
// Logica pura: funziona nel renderer, in un Worker e in Node (usa solo Uint8Array e crypto.subtle).
import { parseDer, content, whole, octets, oid, integerHex, str, time, Asn1Error } from './der.js';

export const MAX_P7M_BYTES = 400 * 1024 * 1024;

const OID = {
  signedData: '1.2.840.113549.1.7.2',
  data: '1.2.840.113549.1.7.1',
  contentType: '1.2.840.113549.1.9.3',
  messageDigest: '1.2.840.113549.1.9.4',
  signingTime: '1.2.840.113549.1.9.5',
  counterSignature: '1.2.840.113549.1.9.6',
  timeStampToken: '1.2.840.113549.1.9.16.2.14',
  tstInfo: '1.2.840.113549.1.9.16.1.4',
  qcStatements: '1.3.6.1.5.5.7.1.3',
  qcCompliance: '0.4.0.1862.1.1',
  keyUsage: '2.5.29.15',
};

const DIGESTS = {
  '1.3.14.3.2.26': 'SHA-1',
  '2.16.840.1.101.3.4.2.1': 'SHA-256',
  '2.16.840.1.101.3.4.2.2': 'SHA-384',
  '2.16.840.1.101.3.4.2.3': 'SHA-512',
};
const SIGALGS = {
  '1.2.840.113549.1.1.1': { kind: 'rsa' },
  '1.2.840.113549.1.1.5': { kind: 'rsa', hash: 'SHA-1' },
  '1.2.840.113549.1.1.11': { kind: 'rsa', hash: 'SHA-256' },
  '1.2.840.113549.1.1.12': { kind: 'rsa', hash: 'SHA-384' },
  '1.2.840.113549.1.1.13': { kind: 'rsa', hash: 'SHA-512' },
  '1.2.840.113549.1.1.10': { kind: 'pss' },
  '1.2.840.10045.2.1': { kind: 'ecdsa' },
  '1.2.840.10045.4.1': { kind: 'ecdsa', hash: 'SHA-1' },
  '1.2.840.10045.4.3.2': { kind: 'ecdsa', hash: 'SHA-256' },
  '1.2.840.10045.4.3.3': { kind: 'ecdsa', hash: 'SHA-384' },
  '1.2.840.10045.4.3.4': { kind: 'ecdsa', hash: 'SHA-512' },
};
const CURVES = { '1.2.840.10045.3.1.7': ['P-256', 32], '1.3.132.0.34': ['P-384', 48], '1.3.132.0.35': ['P-521', 66] };
const NAME_ATTRS = {
  '2.5.4.3': 'CN', '2.5.4.4': 'SN', '2.5.4.42': 'GN', '2.5.4.5': 'serialNumber', '2.5.4.6': 'C', '2.5.4.7': 'L',
  '2.5.4.8': 'ST', '2.5.4.10': 'O', '2.5.4.11': 'OU', '2.5.4.12': 'T', '2.5.4.46': 'dnQualifier',
  '2.5.4.97': 'organizationIdentifier', '1.2.840.113549.1.9.1': 'E',
};

const latin1 = new TextDecoder('latin1');

/** true se i byte sembrano un .p7m (DER o base64). */
export function looksLikeP7m(bytes) {
  if (!bytes || bytes.length < 16) return false;
  if (bytes[0] === 0x30) {
    // l'OID signedData compare entro i primi ~30 byte
    const head = bytes.subarray(0, 40);
    const want = [0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x07, 0x02];
    for (let i = 0; i <= head.length - want.length; i++) if (want.every((v, k) => head[i + k] === v)) return true;
    return false;
  }
  const s = latin1.decode(bytes.subarray(0, 64)).trim();
  return /^-----BEGIN/.test(s) || /^MI[A-Za-z0-9+/]/.test(s);
}

/** Decodifica un .p7m in base64 (con o senza intestazioni PEM) → Uint8Array, o null. */
export function maybeBase64(bytes) {
  if (bytes[0] === 0x30) return bytes;
  const head = latin1.decode(bytes.subarray(0, 64)).trim();
  if (!/^-----BEGIN/.test(head) && !/^MI[A-Za-z0-9+/]/.test(head)) return bytes;
  const text = latin1.decode(bytes).replace(/-----[^-]+-----/g, '').replace(/[^A-Za-z0-9+/=]/g, '');
  try { return base64ToBytes(text); } catch { return bytes; }
}

export function base64ToBytes(b64) {
  const clean = String(b64).replace(/[^A-Za-z0-9+/=_-]/g, '').replace(/-/g, '+').replace(/_/g, '/');
  if (typeof atob === 'function') {
    const bin = atob(clean);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  return new Uint8Array(Buffer.from(clean, 'base64'));
}

function child(n, i) { return n && n.children ? n.children[i] : undefined; }
function isCtx(n, tag) { return n && n.cls === 2 && n.tag === tag; }

/** Nome distinto → { CN, O, ..., text } */
export function parseName(b, n) {
  const out = {};
  const parts = [];
  for (const rdn of n.children || []) {
    for (const atv of rdn.children || []) {
      const k = NAME_ATTRS[oid(b, atv.children[0])] || oid(b, atv.children[0]);
      let v = '';
      try { v = str(b, atv.children[1]); } catch {}
      if (!(k in out)) out[k] = v;
      parts.push(`${k}=${v}`);
    }
  }
  out.text = parts.join(', ');
  return out;
}

/** Certificato X.509 → oggetto descrittivo (+ dati interni per la verifica). */
export function parseCertificate(b, n) {
  const tbs = child(n, 0);
  let i = 0;
  if (isCtx(child(tbs, 0), 0)) i = 1;
  const serial = integerHex(b, child(tbs, i));
  const issuer = parseName(b, child(tbs, i + 2));
  const validity = child(tbs, i + 3);
  const subject = parseName(b, child(tbs, i + 4));
  const spki = child(tbs, i + 5);
  const spkiAlg = oid(b, child(child(spki, 0), 0));
  const spkiParam = child(child(spki, 0), 1);
  const curve = spkiParam && spkiParam.tag === 6 ? oid(b, spkiParam) : null;
  let qualified = false; let nonRepudiation = null;
  for (let k = i + 6; k < tbs.children.length; k++) {
    const ext = tbs.children[k];
    if (!isCtx(ext, 3)) continue;
    for (const e of child(ext, 0)?.children || []) {
      const eid = oid(b, child(e, 0));
      const val = e.children[e.children.length - 1];
      try {
        if (eid === OID.qcStatements) qualified = latin1.decode(content(b, val)).includes(String.fromCharCode(0x04, 0x00, 0x8e, 0x46, 0x01, 0x01)) || containsOid(b, val, OID.qcCompliance);
        if (eid === OID.keyUsage) { const bs = parseDer(b, { offset: val.start + val.hdr, end: val.end }); const c = content(b, bs); nonRepudiation = c.length > 1 ? !!(c[1] & 0x40) : null; }
      } catch {}
    }
  }
  return {
    serial, issuer, subject,
    notBefore: time(b, child(validity, 0)), notAfter: time(b, child(validity, 1)),
    keyAlgorithm: SIGALGS[spkiAlg]?.kind === 'ecdsa' ? 'ECDSA' : SIGALGS[spkiAlg] ? 'RSA' : spkiAlg,
    qualified, nonRepudiation, selfSigned: issuer.text === subject.text,
    _spki: whole(b, spki), _spkiAlg: spkiAlg, _curve: curve, _der: whole(b, n),
    _tbs: whole(b, tbs), _sigAlg: oid(b, child(child(n, 1), 0)), _sig: bitString(b, child(n, 2)),
  };
}

function containsOid(b, n, target) {
  try {
    const inner = parseDer(b, { offset: n.start + n.hdr, end: n.end });
    let found = false;
    const walk = (x) => { if (found) return; if (x.tag === 6 && x.cls === 0 && oid(b, x) === target) found = true; (x.children || []).forEach(walk); };
    walk(inner); return found;
  } catch { return false; }
}

function bitString(b, n) { const c = content(b, n); return c.subarray(1); }

/** Descrizione leggibile del firmatario. */
export function personName(subject) {
  if (subject.GN || subject.SN) return [subject.GN, subject.SN].filter(Boolean).join(' ') || subject.CN || '';
  return subject.CN || subject.O || subject.text || 'Sconosciuto';
}
export function fiscalCode(subject) {
  const s = subject.serialNumber || subject.dnQualifier || '';
  const m = s.match(/([A-Z]{6}\d{2}[A-Z]\d{2}[A-Z]\d{3}[A-Z])/i) || s.match(/(\d{11})/);
  return m ? m[1].toUpperCase() : s;
}

/**
 * Analizza un .p7m. Restituisce:
 * { content: Uint8Array|null, detached, levels: [ { signers: [...] } ], kind, mime }
 * levels[0] è la busta più esterna; i .p7m annidati (firma su firma) producono più livelli.
 * opts.verify (default true): verifica crittografica delle firme.
 */
export async function openP7m(input, { verify = true, maxLevels = 8 } = {}) {
  if (!(input instanceof Uint8Array)) throw new Error('Dati non validi');
  if (input.length > MAX_P7M_BYTES) throw new Error('Il file è troppo grande per essere aperto.');
  let bytes = unwrapM7m(input) || maybeBase64(input);
  const levels = [];
  let detached = false;
  for (let level = 0; level < maxLevels; level++) {
    if (isTsd(bytes)) {
      const t = parseTsd(bytes);
      levels.push({ kind: 'tsd', signers: [], timestamps: t.timestamps, certificates: [] });
      if (!t.content) { detached = true; bytes = null; break; }
      bytes = maybeBase64(t.content);
      continue;
    }
    const parsed = parseSignedData(bytes);
    if (verify) for (const s of parsed.signers) await verifySigner(s, parsed);
    levels.push({ kind: 'p7m', signers: parsed.signers.map(publicSigner), certificates: parsed.certs.map(publicCert) });
    if (!parsed.content) { detached = true; bytes = null; break; }
    const inner = maybeBase64(parsed.content);
    bytes = inner;
    if (!looksLikeP7m(inner) && !isTsd(inner)) break;
  }
  const kind = bytes ? sniff(bytes) : null;
  return { content: bytes, detached, levels, kind };
}

/** Riepilogo dell'esito per il semaforo: 'valid' | 'warning' | 'invalid'. */
export function overallStatus(result) {
  const all = [];
  const walk = (s) => { all.push(s); s.counterSigners?.forEach(walk); };
  result.levels.forEach((l) => l.signers.forEach(walk));
  if (!all.length) return result.levels.some((l) => l.kind === 'tsd') ? 'warning' : 'invalid';
  if (all.some((s) => s.integrity === 'invalid')) return 'invalid';
  // verde solo con certificato qualificato (eIDAS): un certificato qualunque può essere stato creato da chiunque
  if (all.every((s) => s.integrity === 'valid' && s.certValidAtSigning !== false && s.certificate?.qualified)) return 'valid';
  return 'warning';
}

const TSD_OID = '1.2.840.113549.1.9.16.1.31';
function isTsd(bytes) {
  if (!bytes || bytes[0] !== 0x30) return false;
  const head = bytes.subarray(0, 32);
  const want = [0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x09, 0x10, 0x01, 0x1f];
  for (let i = 0; i < head.length - want.length; i++) if (want.every((v, k) => head[i + k] === v)) return true;
  return false;
}

/** TimeStampedData (RFC 5544, file .tsd): contenuto + marche temporali. */
function parseTsd(bytes) {
  const root = parseDer(bytes);
  if (oid(bytes, child(root, 0)) !== TSD_OID) throw new Error('File .tsd non valido');
  const tsd = child(child(root, 1), 0);
  let contentBytes = null; const timestamps = [];
  for (const c of tsd.children.slice(1)) {
    if (c.cls === 0 && c.tag === 4) contentBytes = octets(bytes, c);
    else if (c.cls === 0 && c.tag === 16 && c.children?.length && isCtx(c.children[0], 0)) {
      // Evidence: [0] TimeStampTokenEvidence ::= SEQUENCE OF TimeStampAndCRL
      for (const tsc of c.children[0].children || []) {
        try { timestamps.push(parseTimestamp(whole(bytes, child(tsc, 0)))); } catch {}
      }
    }
  }
  return { content: contentBytes, timestamps };
}

/** Busta .m7m (MIME con .p7m + marca .tsr): restituisce i byte del .p7m, o null se non è un .m7m. */
export function unwrapM7m(bytes) {
  const head = latin1.decode(bytes.subarray(0, 2048));
  if (!/Content-Type:\s*multipart\//i.test(head) && !/MIME-Version:/i.test(head)) return null;
  const text = latin1.decode(bytes);
  const bm = text.match(/boundary="?([^"\r\n;]+)"?/i);
  if (!bm) return null;
  const parts = text.split('--' + bm[1]);
  for (const part of parts) {
    const sep = part.search(/\r?\n\r?\n/);
    if (sep < 0) continue;
    const headers = part.slice(0, sep);
    if (!/pkcs7-mime|\.p7m/i.test(headers)) continue;
    let body = part.slice(sep).trim();
    if (/base64/i.test(headers)) return base64ToBytes(body);
    const out = new Uint8Array(body.length); for (let i = 0; i < body.length; i++) out[i] = body.charCodeAt(i) & 0xff; return out;
  }
  return null;
}

/** Riconosce il tipo del contenuto estratto. */
export function sniff(bytes) {
  const head = latin1.decode(bytes.subarray(0, 1024));
  const trimmed = head.replace(/^﻿|^\xEF\xBB\xBF/, '').trimStart();
  if (head.includes('%PDF-')) return 'pdf';
  if (/^<\?xml|^</.test(trimmed)) return /FatturaElettronica/i.test(latin1.decode(bytes.subarray(0, 8192))) ? 'fattura' : 'xml';
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) return 'zip';
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'jpg';
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return 'png';
  return 'other';
}

/** Nome del file contenuto: "fattura.xml.p7m" → "fattura.xml"; aggiunge l'estensione se manca. */
export function innerName(name, kind) {
  let n = String(name || 'documento').replace(/(\.p7m)+$/i, '').replace(/\.p7s$/i, '');
  const ext = { pdf: '.pdf', fattura: '.xml', xml: '.xml', zip: '.zip', jpg: '.jpg', png: '.png' }[kind];
  if (ext && !n.toLowerCase().endsWith(ext)) n += ext;
  return n;
}

function parseSignedData(bytes) {
  let root;
  try { root = parseDer(bytes); } catch (e) { throw new Error(e instanceof Asn1Error ? 'il file è incompleto o danneggiato, oppure non è un file firmato.' : 'il formato del file non è riconosciuto.'); }
  const b = bytes;
  if (!root.children || child(root, 0)?.tag !== 6 || oid(b, child(root, 0)) !== OID.signedData) throw new Error('il file non contiene una firma digitale CAdES (.p7m).');
  const sd = child(child(root, 1), 0);
  if (!sd?.children) throw new Error('la busta firmata è vuota o danneggiata.');
  let k = 0;
  k++; // version
  const digestAlgs = child(sd, k++);
  const encap = child(sd, k++);
  const eType = oid(b, child(encap, 0));
  let contentBytes = null;
  const eContent = child(encap, 1);
  if (eContent && isCtx(eContent, 0)) contentBytes = octets(b, child(eContent, 0));
  const certs = [];
  let signerSet = null;
  for (; k < sd.children.length; k++) {
    const n = sd.children[k];
    if (isCtx(n, 0)) { for (const c of n.children || []) { if (c.cls === 0 && c.tag === 16) { try { certs.push(parseCertificate(b, c)); } catch {} } } }
    else if (n.cls === 0 && n.tag === 17) signerSet = n;
  }
  void digestAlgs;
  const signers = (signerSet?.children || []).map((si) => parseSignerInfo(b, si, certs));
  if (!signers.length) throw new Error('nella busta non ci sono firme.');
  return { content: contentBytes, eType, certs, signers };
}

function parseSignerInfo(b, si, certs) {
  let k = 1; // dopo version
  const sid = child(si, k++);
  let cert = null;
  if (sid.cls === 0 && sid.tag === 16) {
    const issuer = parseName(b, child(sid, 0)).text;
    const serial = integerHex(b, child(sid, 1));
    cert = certs.find((c) => c.serial === serial && c.issuer.text === issuer) || certs.find((c) => c.serial === serial) || null;
  } else if (isCtx(sid, 0)) {
    cert = certs.length === 1 ? certs[0] : null;
  }
  const digestAlg = oid(b, child(child(si, k++), 0));
  let signedAttrs = null; let signedAttrsDer = null;
  if (isCtx(child(si, k), 0)) {
    signedAttrs = child(si, k++);
    const w = whole(b, signedAttrs);
    signedAttrsDer = new Uint8Array(w); signedAttrsDer[0] = 0x31; // [0] IMPLICIT → SET per la verifica
  }
  const sigAlgNode = child(si, k++);
  const sigAlg = oid(b, child(sigAlgNode, 0));
  const sigParams = child(sigAlgNode, 1);
  const signature = content(b, child(si, k++));
  const unsigned = isCtx(child(si, k), 1) ? child(si, k) : null;
  const s = { cert, digestAlg, sigAlg, signature, signedAttrsDer, signingTime: null, messageDigest: null, timestamp: null, counterSigners: [], pss: null };
  if (sigAlg === '1.2.840.113549.1.1.10' && sigParams) s.pss = parsePssParams(b, sigParams);
  for (const attr of signedAttrs?.children || []) {
    const t = oid(b, child(attr, 0));
    const v = child(child(attr, 1), 0);
    try {
      if (t === OID.signingTime) s.signingTime = time(b, v);
      if (t === OID.messageDigest) s.messageDigest = content(b, v);
    } catch {}
  }
  for (const attr of unsigned?.children || []) {
    const t = oid(b, child(attr, 0));
    for (const v of child(attr, 1)?.children || []) {
      try {
        if (t === OID.timeStampToken) s.timestamp = parseTimestamp(whole(b, v));
        if (t === OID.counterSignature) s.counterSigners.push(parseSignerInfo(b, v, certs));
      } catch {}
    }
  }
  return s;
}

function parsePssParams(b, n) {
  const out = { hash: 'SHA-1', saltLength: 20 };
  for (const c of n.children || []) {
    if (isCtx(c, 0)) out.hash = DIGESTS[oid(b, child(child(c, 0), 0))] || out.hash;
    if (isCtx(c, 2)) { const x = content(b, child(c, 0)); let v = 0; for (const y of x) v = v * 256 + y; out.saltLength = v; }
  }
  return out;
}

/** Marca temporale (token RFC 3161) → { time, tsa } */
function parseTimestamp(bytes) {
  const root = parseDer(bytes);
  const sd = child(child(root, 1), 0);
  const encap = child(sd, 2);
  const tst = octets(bytes, child(child(encap, 1), 0));
  const t = parseDer(tst);
  let genTime = null; let tsa = '';
  for (const c of t.children) { if (c.cls === 0 && c.tag === 0x18) { genTime = time(tst, c); break; } }
  const certs = child(sd, 3);
  if (isCtx(certs, 0)) { try { tsa = personName(parseCertificate(bytes, child(certs, 0)).subject); } catch {} }
  return { time: genTime, tsa };
}

async function digest(alg, data) {
  return new Uint8Array(await crypto.subtle.digest(alg, data));
}
function eq(a, b) { if (!a || !b || a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i]; return d === 0; }

async function verifySigner(s, parsed) {
  s.integrity = 'unknown'; s.integrityDetail = '';
  for (const cs of s.counterSigners) await verifyCounter(cs, s);
  const hash = DIGESTS[s.digestAlg];
  if (!hash) { s.integrity = 'unsupported'; s.integrityDetail = 'Algoritmo di impronta non supportato.'; return; }
  if (!parsed.content) { s.integrity = 'unsupported'; s.integrityDetail = 'Firma separata: il documento firmato non è incluso nel file.'; return; }
  if (!s.cert) { s.integrity = 'unsupported'; s.integrityDetail = 'Il certificato del firmatario non è incluso nel file.'; return; }
  try {
    if (s.signedAttrsDer) {
      const md = await digest(hash, parsed.content);
      if (!eq(md, s.messageDigest)) { s.integrity = 'invalid'; s.integrityDetail = 'Il documento è stato modificato dopo la firma (l\'impronta non corrisponde).'; return; }
      const ok = await verifySignature(s.cert, s.sigAlg, s.pss, hash, s.signedAttrsDer, s.signature);
      setResult(s, ok);
    } else {
      const ok = await verifySignature(s.cert, s.sigAlg, s.pss, hash, parsed.content, s.signature);
      setResult(s, ok);
    }
  } catch (err) { s.integrity = 'unsupported'; s.integrityDetail = 'Verifica non eseguibile: ' + (err?.message || err); }
}
async function verifyCounter(cs, parent) {
  // la controfirma firma il valore della firma "madre"
  const hash = DIGESTS[cs.digestAlg];
  cs.integrity = 'unsupported'; cs.integrityDetail = '';
  if (!hash || !cs.cert || !cs.signedAttrsDer) return;
  try {
    const md = await digest(hash, parent.signature);
    if (!eq(md, cs.messageDigest)) { cs.integrity = 'invalid'; cs.integrityDetail = 'La controfirma non corrisponde alla firma.'; return; }
    setResult(cs, await verifySignature(cs.cert, cs.sigAlg, cs.pss, hash, cs.signedAttrsDer, cs.signature));
  } catch (err) { cs.integrityDetail = String(err?.message || err); }
}
function setResult(s, ok) {
  s.integrity = ok ? 'valid' : 'invalid';
  s.integrityDetail = ok ? 'La firma è integra: il documento non è stato modificato dopo la firma.' : 'La firma non corrisponde al certificato: il file potrebbe essere stato alterato.';
}

/** Verifica una firma con la chiave pubblica del certificato (RSA PKCS#1 v1.5, RSA-PSS, ECDSA). */
export async function verifySignature(cert, sigAlg, pss, hash, data, signature) {
  const info = SIGALGS[sigAlg];
  if (!info) throw new Error('algoritmo di firma non supportato (' + sigAlg + ')');
  const h = info.hash || hash;
  if (info.kind === 'rsa') {
    const key = await crypto.subtle.importKey('spki', cert._spki, { name: 'RSASSA-PKCS1-v1_5', hash: h }, false, ['verify']);
    return crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, signature, data);
  }
  if (info.kind === 'pss') {
    const p = pss || { hash: 'SHA-1', saltLength: 20 };
    const key = await crypto.subtle.importKey('spki', rsaSpkiForPss(cert._spki), { name: 'RSA-PSS', hash: p.hash }, false, ['verify']);
    return crypto.subtle.verify({ name: 'RSA-PSS', saltLength: p.saltLength }, key, signature, data);
  }
  if (info.kind === 'ecdsa') {
    const c = CURVES[cert._curve];
    if (!c) throw new Error('curva ellittica non supportata');
    const key = await crypto.subtle.importKey('spki', cert._spki, { name: 'ECDSA', namedCurve: c[0] }, false, ['verify']);
    return crypto.subtle.verify({ name: 'ECDSA', hash: h }, key, ecdsaDerToRaw(signature, c[1]), data);
  }
  throw new Error('algoritmo non supportato');
}

// WebCrypto accetta per RSA-PSS anche SPKI con OID rsaEncryption: lo lasciamo invariato.
function rsaSpkiForPss(spki) { return spki; }

export function ecdsaDerToRaw(sig, size) {
  const n = parseDer(sig);
  const out = new Uint8Array(size * 2);
  [0, 1].forEach((i) => {
    let v = content(sig, n.children[i]);
    while (v.length > size && v[0] === 0) v = v.subarray(1);
    out.set(v, size * (i + 1) - v.length);
  });
  return out;
}

/** Verifica la firma del certificato con quella dell'emittente, se presente nella busta. */
async function certSignedBy(cert, issuer) {
  try { return await verifySignature(issuer, cert._sigAlg, null, 'SHA-256', cert._tbs, cert._sig); } catch { return null; }
}

function publicCert(c) {
  return { subject: c.subject, issuer: c.issuer, serial: c.serial, notBefore: c.notBefore, notAfter: c.notAfter, qualified: c.qualified, selfSigned: c.selfSigned, keyAlgorithm: c.keyAlgorithm, nonRepudiation: c.nonRepudiation, der: c._der };
}
function publicSigner(s) {
  const c = s.cert;
  const at = s.timestamp?.time || s.signingTime || null;
  let certValidAtSigning = null;
  if (c && at) certValidAtSigning = (!c.notBefore || at >= c.notBefore) && (!c.notAfter || at <= c.notAfter);
  return {
    name: c ? personName(c.subject) : 'Firmatario sconosciuto',
    fiscalCode: c ? fiscalCode(c.subject) : '',
    organization: c?.subject.O || '',
    email: c?.subject.E || '',
    issuer: c ? (c.issuer.O || c.issuer.CN || c.issuer.text) : '',
    certificate: c ? publicCert(c) : null,
    signingTime: s.signingTime, timestamp: s.timestamp,
    digestAlgorithm: DIGESTS[s.digestAlg] || s.digestAlg,
    integrity: s.integrity || 'unknown', integrityDetail: s.integrityDetail || '',
    certValidAtSigning,
    counterSigners: s.counterSigners.map(publicSigner),
  };
}

export { certSignedBy };
