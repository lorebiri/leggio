// Riparazione di PDF danneggiati (troncati, tabella xref o trailer mancanti) quando pdf.js
// non riesce ad aprirli: pdf-lib legge gli oggetti in sequenza e ricostruisce un file valido.
// Il risultato può essere incompleto (pagine o immagini mancanti): l'utente viene avvisato.
import { PDFDocument } from '@cantoo/pdf-lib';

/** → { bytes, pages } oppure null se non c'è nulla da recuperare. Non lancia mai. */
export async function repairPdf(bytes, { maxBytes = 512 * 1024 * 1024 } = {}) {
  if (!bytes?.length || bytes.length > maxBytes) return null;
  try {
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, throwOnInvalidObject: false, updateMetadata: false });
    if (doc.isEncrypted) return null;
    const pages = doc.getPageCount();
    if (!pages) return null;
    const out = await doc.save({ useObjectStreams: false });
    return { bytes: out, pages };
  } catch { return null; }
}
