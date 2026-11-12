// Lettura della segnatura di Titulus da un PDF: prima nel testo della pagina 1, poi nella striscia-IMMAGINE verticale
// sul margine (com'è nei documenti protocollati del CNR), leggendo con l'OCR solo quella striscia, nei due versi.
// Il documento non viene mai modificato: si lavora su una copia dei byte.
import { segnatureTitulus, trovaStrisce, ripulisciOcr, MASCHERA_UOR_PREDEFINITA } from '../lib/titulus.js';
import { looksLikeP7m, openP7m } from '../lib/cades.js';
import { pageText } from '../lib/textsearch.js';
import { openPdfJs, pdfjs } from '../../../core/pdf.js';
import { destroyPdf } from '../native.js';
import { modelliTitulus } from './protocollo.js';

const SCALA = 7; // ~500 punti per pollice solo sulla striscia: lettere alte abbastanza per l'OCR
// caratteri possibili in una segnatura: maiuscole (AOO, UOR), «Prot», «n», «del», cifre e punteggiatura
const CARATTERI = 'ABCDEFGHIJKLMNOPQRSTUVWXYZrotndel0123456789./:- ';

export const KEY_MASCHERA_UOR = 'avanzati.titulus.mascheraUor';
function cerca(app, testo, origine) {
  const mascheraUor = String(app.settings.get(KEY_MASCHERA_UOR, MASCHERA_UOR_PREDEFINITA) || '').trim();
  try { return segnatureTitulus(testo, { modelli: modelliTitulus(app), origine, mascheraUor })[0] || null; }
  catch { return segnatureTitulus(testo, { origine, mascheraUor })[0] || null; }
}

/** Posizioni delle immagini disegnate sulla pagina (matrice corrente al momento del disegno). */
export async function immaginiDellaPagina(page) {
  const ops = await page.getOperatorList();
  const O = pdfjs.OPS; const out = [];
  let ctm = [1, 0, 0, 1, 0, 0]; const stack = [];
  const mul = (m, n) => [m[0] * n[0] + m[1] * n[2], m[0] * n[1] + m[1] * n[3], m[2] * n[0] + m[3] * n[2], m[2] * n[1] + m[3] * n[3], m[4] * n[0] + m[5] * n[2] + n[4], m[4] * n[1] + m[5] * n[3] + n[5]];
  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i]; const a = ops.argsArray[i];
    if (fn === O.save) stack.push(ctm);
    else if (fn === O.restore) ctm = stack.pop() || [1, 0, 0, 1, 0, 0];
    else if (fn === O.transform) ctm = mul(a, ctm);
    else if (fn === O.paintFormXObjectBegin && Array.isArray(a?.[0])) { stack.push(ctm); ctm = mul(a[0], ctm); }
    else if (fn === O.paintFormXObjectEnd) ctm = stack.pop() || ctm;
    else if (fn === O.paintImageXObject || fn === O.paintInlineImageXObject || fn === O.paintImageMaskXObject) out.push({ transform: ctm.slice() });
  }
  return out;
}

/** Ritaglia, rende bianco/nero (inchiostro rosso o scuro → nero), ruota di `gradi`. */
function preparaStriscia(src, [x, y, w, h], gradi) {
  const c = document.createElement('canvas');
  const r = ((gradi % 360) + 360) % 360;
  c.width = r % 180 ? h : w; c.height = r % 180 ? w : h;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  ctx.translate(c.width / 2, c.height / 2); ctx.rotate((r * Math.PI) / 180);
  ctx.drawImage(src, x, y, w, h, -w / 2, -h / 2, w, h);
  const img = ctx.getImageData(0, 0, c.width, c.height); const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const R = d[i]; const G = d[i + 1]; const B = d[i + 2];
    const inchiostro = (R - G > 50 && R - B > 50) || (R * 0.299 + G * 0.587 + B * 0.114) < 110;
    d[i] = d[i + 1] = d[i + 2] = inchiostro ? 0 : 255;
  }
  // togli le linee lunghe (bordi e cornici), che confondono l'OCR: righe o colonne quasi tutte nere
  const W = c.width; const H = c.height;
  for (let y = 0; y < H; y++) { let n = 0; for (let x = 0; x < W; x++) if (!d[(y * W + x) * 4]) n++; if (n > W * 0.6) for (let x = 0; x < W; x++) { const i = (y * W + x) * 4; d[i] = d[i + 1] = d[i + 2] = 255; } }
  for (let x = 0; x < W; x++) { let n = 0; for (let y = 0; y < H; y++) if (!d[(y * W + x) * 4]) n++; if (n > H * 0.6) for (let y = 0; y < H; y++) { const i = (y * W + x) * 4; d[i] = d[i + 1] = d[i + 2] = 255; } }
  ctx.putImageData(img, 0, 0);
  // margine bianco attorno: aiuta il riconoscimento di una sola riga
  const m = document.createElement('canvas'); m.width = c.width + 40; m.height = c.height + 40;
  const mc = m.getContext('2d'); mc.fillStyle = '#fff'; mc.fillRect(0, 0, m.width, m.height); mc.drawImage(c, 20, 20);
  return m;
}

/**
 * Segnatura di Titulus di un documento. input: byte di un PDF o di un .p7m (non vengono modificati).
 * → { aoo, numero, numeroIntero, data, uor, origine: 'testo'|'immagine', … } | null
 */
export async function leggiSegnaturaTitulus(app, input, { password, signal, ocr = true, debug = null } = {}) {
  let bytes = input instanceof Uint8Array ? input.slice() : null;
  if (!bytes) throw new Error('Servono i byte del documento.');
  if (looksLikeP7m(bytes)) { const r = await openP7m(bytes, { verify: false }); if (r.kind !== 'pdf') return null; bytes = r.content.slice(); }
  let pdf;
  try {
    ({ pdf } = await openPdfJs(bytes, { password }));
    const page = await pdf.getPage(1);
    // (a) testo
    const testo = pageText((await page.getTextContent()).items);
    const t = cerca(app, testo, 'testo');
    if (t) return t;
    if (!ocr || typeof app.services?.creaWorkerOcr !== 'function' || typeof document === 'undefined') return null;
    // (b) immagine stretta e alta vicino a un bordo
    const [vx1, vy1, vx2, vy2] = page.view;
    let strisce = trovaStrisce(await immaginiDellaPagina(page), { x: vx1, y: vy1, w: vx2 - vx1, h: vy2 - vy1 });
    if (debug) debug.strisce = strisce.map((x) => ({ rect: x.rect.map(Math.round), lato: x.lato })), debug.view = page.view;
    if (!strisce.length) strisce = [{ rect: [vx1, vy1, vx1 + 15 / 25.4 * 72, vy2], verticale: true, lato: 'sinistra', ripiego: true }];
    if (signal?.aborted) throw new DOMException('Annullato', 'AbortError');
    const viewport = page.getViewport({ scale: SCALA });
    // si rende solo il riquadro della striscia (non tutta la pagina): veloce e con poca memoria
    const rendiArea = async (rect) => {
      const [ax, ay] = viewport.convertToViewportPoint(rect[0], rect[1]);
      const [bx, by] = viewport.convertToViewportPoint(rect[2], rect[3]);
      const x = Math.max(0, Math.floor(Math.min(ax, bx)) - 6); const y = Math.max(0, Math.floor(Math.min(ay, by)) - 6);
      const w = Math.min(Math.ceil(Math.abs(bx - ax)) + 12, 1200); const hgt = Math.min(Math.ceil(Math.abs(by - ay)) + 12, 12000);
      const cv = document.createElement('canvas'); cv.width = w; cv.height = hgt;
      const cx = cv.getContext('2d'); cx.fillStyle = '#fff'; cx.fillRect(0, 0, w, hgt);
      await page.render({ canvasContext: cx, canvas: cv, viewport, transform: [1, 0, 0, 1, -x, -y], intent: 'print' }).promise;
      return cv;
    };
    const worker = await app.services.creaWorkerOcr(['eng']);
    try {
      try { await worker.setParameters({ tessedit_pageseg_mode: '7', tessedit_char_whitelist: CARATTERI }); } catch {}
      for (const s of strisce.slice(0, 3)) {
        // margine abbondante sul lato corto: la striscia può essere ritagliata o spostata rispetto all'immagine
        const [r0, r1, r2, r3] = s.rect; const corto = s.verticale ? r2 - r0 : r3 - r1; const pad = Math.max(10, corto * 0.8);
        const area = await rendiArea(s.verticale ? [r0 - pad, r1 - 4, r2 + pad, r3 + 4] : [r0 - 4, r1 - pad, r2 + 4, r3 + pad]);
        // la segnatura si legge dal basso verso l'alto: di solito serve una rotazione di 90° in senso orario; proviamo entrambi i versi
        for (const gradi of s.verticale ? [90, -90] : [0, 180]) {
          if (signal?.aborted) throw new DOMException('Annullato', 'AbortError');
          const img = preparaStriscia(area, [0, 0, area.width, area.height], gradi);
          const res = await worker.recognize(img);
          if (debug) (debug.testi ||= []).push({ gradi, testo: res?.data?.text || '', img: img.toDataURL() });
          const trovata = cerca(app, ripulisciOcr(res?.data?.text || ''), 'immagine');
          if (trovata) return { ...trovata, rotazione: gradi };
        }
      }
    } finally { try { await worker.terminate(); } catch {} }
    return null;
  } finally { destroyPdf(pdf); }
}
