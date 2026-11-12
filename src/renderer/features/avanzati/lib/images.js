// PDF da immagini (JPEG/PNG) con pdf-lib. Logica pura.
export function imageType(bytes) {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpg';
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'png';
  return null;
}

const A4 = [595.28, 841.89];

/**
 * images: [{ bytes, name }]  opts: { formato: 'A4' | 'immagine', margine (pt), dpi (per «immagine») }
 * → { pdfDoc, aggiunte, scartate: [{name, motivo}] }
 */
export async function pdfDaImmagini(PDFLib, images, { formato = 'A4', margine = 0, dpi = 200, signal, onProgress } = {}) {
  const doc = await PDFLib.PDFDocument.create();
  const scartate = []; let aggiunte = 0;
  for (const [i, im] of images.entries()) {
    if (signal?.aborted) throw new DOMException('Annullato', 'AbortError');
    onProgress?.(i, images.length, im.name);
    const t = imageType(im.bytes);
    if (!t) { scartate.push({ name: im.name, motivo: 'formato non supportato (usa JPEG o PNG)' }); continue; }
    let img;
    try { img = t === 'jpg' ? await doc.embedJpg(im.bytes) : await doc.embedPng(im.bytes); }
    catch { scartate.push({ name: im.name, motivo: 'immagine danneggiata' }); continue; }
    if (formato === 'immagine') {
      const w = (img.width / dpi) * 72; const h = (img.height / dpi) * 72;
      const p = doc.addPage([w, h]);
      p.drawImage(img, { x: 0, y: 0, width: w, height: h });
    } else {
      const landscape = img.width > img.height;
      const [PW, PH] = landscape ? [A4[1], A4[0]] : A4;
      const p = doc.addPage([PW, PH]);
      const s = Math.min((PW - 2 * margine) / img.width, (PH - 2 * margine) / img.height);
      const w = img.width * s; const h = img.height * s;
      p.drawImage(img, { x: (PW - w) / 2, y: (PH - h) / 2, width: w, height: h });
    }
    aggiunte++;
  }
  return { pdfDoc: doc, aggiunte, scartate };
}
