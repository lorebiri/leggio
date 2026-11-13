// Font Unicode (Liberation Sans) incorporato una sola volta per documento: usato da «modifica» per il testo
// fuori da WinAnsi e da «commenti» per gli aspetti di caselle di testo e timbri. Niente DOM.
import * as PDFLib from '@cantoo/pdf-lib';

const UNICODE_MARK = 'LeggioUnicode';
/**
 * Incorpora il font Unicode (intero: il sottoinsieme di fontkit fallisce con questi TTF), ma riusa il file del
 * font se il documento ne contiene già uno messo da Leggio con lo stesso contenuto: senza questo ogni modifica
 * con caratteri non latini aggiungeva un'altra copia completa del font (~95 KB). Il file viene marcato con
 * /LeggioUnicode (variante:lunghezza) nel dizionario del flusso; larghezze e ToUnicode restano propri di ogni uso.
 */
export async function embedUnicodeFont(pdfDoc, bytes, key = 'U') {
  const f = await pdfDoc.embedFont(bytes, { subset: false });
  const emb = f.embedder;
  if (emb && typeof emb.embedFontStream === 'function') {
    const mark = `${key}:${bytes.length}`;
    const own = emb.embedFontStream.bind(emb);
    emb.embedFontStream = async (context) => {
      const found = findMarkedFontFile(context, mark);
      if (found) return found;
      const ref = await own(context);
      context.lookup(ref)?.dict?.set(PDFLib.PDFName.of(UNICODE_MARK), PDFLib.PDFString.of(mark));
      return ref;
    };
  }
  return f;
}
function findMarkedFontFile(context, mark) {
  for (const [ref, obj] of context.enumerateIndirectObjects()) {
    const v = obj?.dict?.get?.(PDFLib.PDFName.of(UNICODE_MARK));
    if (v && typeof v.decodeText === 'function' && v.decodeText() === mark) return ref;
  }
  return null;
}
