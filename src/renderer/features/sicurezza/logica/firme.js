// Riconoscimento delle firme autografe inserite come immagine (operatori di pdf.js). Senza DOM.
import { itemGeometry, spanRect } from './testo.js';
import { signatureCandidates, FIRMA_ETICHETTE } from './preset.js';
import { mulMatrix } from './flusso.js';

/** Riquadri delle immagini che sembrano firme autografe (vedi signatureCandidates). */
export async function findSignatures(page, tc, OPS) {
  const labels = [];
  for (const it of tc.items) if (it.str && FIRMA_ETICHETTE.test(it.str)) { const g = itemGeometry(it); labels.push(spanRect(g, 0, g.width)); }
  if (!labels.length) return [];
  let ol;
  try { ol = await page.getOperatorList(); } catch { return []; }
  const paint = new Set([OPS.paintImageXObject, OPS.paintInlineImageXObject, OPS.paintJpegXObject, OPS.paintImageXObjectRepeat].filter((x) => x != null));
  const images = []; const stack = []; let ctm = [1, 0, 0, 1, 0, 0];
  for (let k = 0; k < ol.fnArray.length; k++) {
    const fn = ol.fnArray[k];
    if (fn === OPS.save) stack.push(ctm);
    else if (fn === OPS.restore) ctm = stack.pop() || [1, 0, 0, 1, 0, 0];
    else if (fn === OPS.transform) ctm = mulMatrix(ol.argsArray[k], ctm);
    else if (paint.has(fn)) {
      const pts = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([x, y]) => [ctm[0] * x + ctm[2] * y + ctm[4], ctm[1] * x + ctm[3] * y + ctm[5]]);
      const xs = pts.map((p) => p[0]); const ys = pts.map((p) => p[1]);
      images.push({ rect: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] });
    }
  }
  const [vx1, vy1, vx2, vy2] = page.view;
  return signatureCandidates(images, labels, vx2 - vx1, vy2 - vy1);
}

