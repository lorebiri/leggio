// Apertura con pdf-lib (@cantoo, con supporto cifratura). Modulo senza DOM: testato in Node.
import * as PDFLib from '@cantoo/pdf-lib';
import fontkit from '@pdf-lib/fontkit';

/**
 * Apre i byte con pdf-lib DECIFRANDOLI se il file è cifrato.
 * - password nota (password di apertura): la si usa;
 * - file cifrato con sole restrizioni (password utente vuota): si decifra con '' — prima si apriva
 *   con ignoreEncryption e le modifiche producevano file misti (oggetti nuovi in chiaro, vecchi cifrati);
 * - il salvataggio produce un file in chiaro: la cifratura va rimessa da un save hook (area sicurezza).
 */
export async function openPdfLib(bytes, password) {
  // parseSpeed alto: nel browser i valori predefiniti di pdf-lib cedono il controllo troppo spesso (≈10× più lento)
  const opts = { updateMetadata: false, parseSpeed: 1500 };
  let doc;
  try {
    doc = await PDFLib.PDFDocument.load(bytes, { ...opts, password: password ?? '' });
  } catch (err) {
    if (/password|decrypt|encrypt/i.test(String(err?.message))) {
      const e = new Error('Il documento è protetto e non può essere decifrato con la password indicata: riaprilo inserendo la password di apertura.');
      e.name = 'PasswordException'; e.cause = err;
      throw e;
    }
    throw err;
  }
  if (doc.isEncrypted) {
    // decifratura non riuscita in silenzio: meglio fermarsi che produrre un file corrotto
    throw Object.assign(new Error('Il documento è cifrato con un metodo che Leggio non sa decifrare per modificarlo.'), { name: 'PasswordException' });
  }
  if (doc.context.isDecrypted) dropStaleEncryption(doc);
  doc.registerFontkit(fontkit);
  return doc;
}

/**
 * Dopo la decifratura pdf-lib tiene come oggetti normali il vecchio dizionario /Encrypt e i vecchi
 * xref stream (con /Encrypt dentro): salvati, rendono il file «misto» e alla riapertura successiva
 * pdf-lib lo crede ancora cifrato («NEEDS PASSWORD» / «Password incorrect»). Li togliamo.
 */
function dropStaleEncryption(doc) {
  const { PDFName, PDFDict } = PDFLib;
  const ctx = doc.context;
  const K = (k) => PDFName.of(k);
  const drop = [];
  for (const [ref, obj] of ctx.enumerateIndirectObjects()) {
    const dict = obj instanceof PDFDict ? obj : obj?.dict instanceof PDFDict ? obj.dict : null;
    if (!dict) continue;
    const type = dict.get(K('Type'))?.toString();
    const isXref = type === '/XRef' || (dict.has(K('Size')) && dict.has(K('Root')));
    const isEncryptDict = dict.has(K('Filter')) && dict.has(K('O')) && dict.has(K('U')) && (dict.has(K('V')) || dict.has(K('R')));
    if (isXref || isEncryptDict) drop.push(ref);
  }
  for (const ref of drop) ctx.delete(ref);
  delete ctx.trailerInfo.Encrypt;
}
