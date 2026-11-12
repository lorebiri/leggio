// Verifica se una password è quella del proprietario (autorizzazioni) di un PDF cifrato.
// Usa le funzioni crittografiche del fork (non esportate dal pacchetto: import per percorso).
import { PDFDocument, PDFArray, PDFHexString, PDFString } from '@cantoo/pdf-lib';
import { CipherTransformFactory, PDF20, PDF17, encodeRevision6Password } from '../../../../../node_modules/@cantoo/pdf-lib/es/core/crypto.js';
import { N, lookupDict, num } from './pdfutil.js';

const bytesOf = (o) => (o instanceof PDFString || o instanceof PDFHexString ? o.asBytes() : new Uint8Array());
const latin1 = (s) => Uint8Array.from(String(s), (c) => c.charCodeAt(0) & 0xff);

/** → { owner: boolean, user: boolean } per la password data (entrambe false = errata). */
export async function passwordRoles(bytes, pw) {
  const probe = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  const ctx = probe.context;
  const enc = lookupDict(ctx, ctx.trailerInfo.Encrypt);
  if (!enc) return { owner: true, user: true };
  const R = num(ctx, enc.get(N('R'))); const V = num(ctx, enc.get(N('V')));
  const O = bytesOf(ctx.lookup(enc.get(N('O')))); const U = bytesOf(ctx.lookup(enc.get(N('U'))));
  if (V === 5) {
    const alg = R === 6 ? new PDF20() : new PDF17();
    const pb = R === 6 ? encodeRevision6Password(pw) : new TextEncoder().encode(pw).subarray(0, 127);
    return {
      user: alg.checkUserPassword(pb, U.subarray(32, 40), U.subarray(0, 32)),
      owner: pb.length > 0 && alg.checkOwnerPassword(pb, O.subarray(32, 40), U.subarray(0, 48), O.subarray(0, 32)),
    };
  }
  const idArr = ctx.lookup(ctx.trailerInfo.ID);
  const fileId = idArr instanceof PDFArray ? bytesOf(ctx.lookup(idArr.get(0))) : new Uint8Array();
  let f;
  try { f = new CipherTransformFactory(enc, fileId, pw); } catch { return { owner: false, user: false }; }
  const P = num(ctx, enc.get(N('P'))); const keyLen = V === 1 ? 40 : num(ctx, enc.get(N('Length')), 128);
  const encMeta = f.encryptMetadata;
  const O32 = O.subarray(0, 32); const U32 = U.subarray(0, 32); const pb = latin1(pw);
  const user = !!f.prepareKeyData(fileId, pb, O32, U32, P, R, keyLen, encMeta);
  const owner = !!f.prepareKeyData(fileId, f.decodeUserPassword(pb, O32, R, keyLen), O32, U32, P, R, keyLen, encMeta);
  return { owner, user };
}

export async function checkOwner(bytes, pw) { return (await passwordRoles(bytes, pw)).owner; }
