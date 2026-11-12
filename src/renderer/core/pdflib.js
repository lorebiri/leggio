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
  const opts = { updateMetadata: false };
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
  doc.registerFontkit(fontkit);
  return doc;
}
