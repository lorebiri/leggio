// Preparazione delle foto/scansioni per i PDF: orientamento EXIF, HEIC (via macOS), rotazione, ritaglio dei margini
// bianchi, ricompressione in JPEG a una risoluzione adatta all'A4.
import { riquadroContenuto, ritaglioUtile } from '../lib/missione.js';
import { imageType } from '../lib/images.js';
import { isDesktop, call } from '../native.js';

export const ESTENSIONI_IMMAGINI = ['jpg', 'jpeg', 'png', 'heic', 'heif', 'webp', 'bmp', 'gif', 'tif', 'tiff'];
const MAX_LATO = 2480; // ~300 dpi su A4: abbastanza per leggere gli scontrini

/** → { bytes (JPEG), w, h, ritagliata } */
export async function preparaImmagine(app, bytes, name, { rot = 0, ritaglia = true, qualita = 0.82 } = {}) {
  let src = bytes;
  if (/\.(heic|heif)$/i.test(name) || (bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70 && /heic|heix|mif1|msf1/.test(new TextDecoder('latin1').decode(bytes.subarray(8, 12))))) {
    if (!isDesktop()) throw new Error('Le foto HEIC si aprono solo nell\'app desktop (su macOS).');
    src = await call(app, 'heic-to-jpeg', { name, bytes });
  }
  if (/\.tiff?$/i.test(name)) throw new Error('Il formato TIFF non è supportato: salva la scansione in PDF, JPEG o PNG.');
  let bmp;
  try { bmp = await createImageBitmap(new Blob([src]), { imageOrientation: 'from-image' }); }
  catch { throw new Error('Immagine danneggiata o in un formato non supportato.'); }
  const scala = Math.min(1, MAX_LATO / Math.max(bmp.width, bmp.height));
  let w = Math.round(bmp.width * scala); let h = Math.round(bmp.height * scala);
  const r = ((rot % 360) + 360) % 360;
  let c = document.createElement('canvas');
  c.width = r % 180 ? h : w; c.height = r % 180 ? w : h;
  let ctx = c.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  ctx.translate(c.width / 2, c.height / 2); ctx.rotate((r * Math.PI) / 180); ctx.drawImage(bmp, -w / 2, -h / 2, w, h);
  bmp.close?.();
  let ritagliata = false;
  if (ritaglia) {
    const img = ctx.getImageData(0, 0, c.width, c.height);
    const box = riquadroContenuto(img);
    if (ritaglioUtile(box, c.width, c.height)) {
      const c2 = document.createElement('canvas'); c2.width = box.w; c2.height = box.h;
      c2.getContext('2d').drawImage(c, box.x, box.y, box.w, box.h, 0, 0, box.w, box.h);
      c = c2; ritagliata = true;
    }
  }
  const blob = await new Promise((res) => c.toBlob(res, 'image/jpeg', qualita));
  const out = new Uint8Array(await blob.arrayBuffer());
  return { bytes: out, w: c.width, h: c.height, ritagliata };
}

export function isImmagine(name, bytes) {
  return ESTENSIONI_IMMAGINI.includes(String(name).toLowerCase().split('.').pop()) || (bytes && !!imageType(bytes));
}

/** Aggiunge un'immagine preparata come pagina A4 (verticale o orizzontale secondo la foto). */
export async function aggiungiPaginaImmagine(pdfDoc, PDFLib, jpg, { margine = 18 } = {}) {
  const img = await pdfDoc.embedJpg(jpg);
  const A4 = [595.28, 841.89];
  const [PW, PH] = img.width > img.height ? [A4[1], A4[0]] : A4;
  const p = pdfDoc.addPage([PW, PH]);
  const s = Math.min((PW - 2 * margine) / img.width, (PH - 2 * margine) / img.height);
  p.drawImage(img, { x: (PW - img.width * s) / 2, y: (PH - img.height * s) / 2, width: img.width * s, height: img.height * s });
  return p;
}

/** Immagine → PDF di una pagina (per fascicoli e rendicontazione). */
export async function immagineComePdf(app, bytes, name, opts = {}) {
  const { PDFLib } = app.lib;
  const prep = await preparaImmagine(app, bytes, name, opts);
  const d = await PDFLib.PDFDocument.create();
  await aggiungiPaginaImmagine(d, PDFLib, prep.bytes);
  return d.save();
}
