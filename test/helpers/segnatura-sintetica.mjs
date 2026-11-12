// SOLO PER I TEST: costruisce PDF finti con una segnatura nel formato di Titulus, per verificare che Leggio
// sappia LEGGERLA. L'app non contiene nulla che apponga segnature: a ICCOM-CNR la mette solo Titulus.
import { testoSicuro, visivoAPagina, dimensioniVisive, oggi } from '../../src/renderer/features/avanzati/lib/protocollo.js';

/** «Prot. CNR n. 0123456 del 01/10/2026 - UOR: XX000001» (valori inventati nei test). */
export function testoStriscia({ aoo = 'CNR', numero, data, uor } = {}) {
  return `Prot. ${String(aoo || 'CNR').trim()} n. ${String(numero || '').trim()} del ${data || oggi()}${uor ? ` - UOR: ${String(uor).trim()}` : ''}`;
}

/** Striscia verticale rossa sul margine sinistro della prima pagina, come testo (non immagine). */
export async function applicaStrisciaFinta(pdfDoc, PDFLib, o) {
  const font = await pdfDoc.embedFont(PDFLib.StandardFonts.Helvetica);
  const size = o.size || 9;
  const testo = testoSicuro(font, testoStriscia(o));
  const p = pdfDoc.getPages()[0];
  const { h: PH } = dimensioniVisive(p);
  const v0 = Math.max(12, (PH - font.widthOfTextAtSize(testo, size)) / 2);
  const a = visivoAPagina(p, 22, v0);
  p.drawText(testo, { x: a.x, y: a.y, size, font, color: PDFLib.rgb(0.8, 0.07, 0.07), rotate: PDFLib.degrees(a.rot + 90) });
  return 1;
}
