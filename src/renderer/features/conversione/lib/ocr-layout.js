// Logica pura per l'OCR: posizionamento del testo invisibile parola per parola,
// conversione dell'immagine in BMP a toni di grigio (veloce da leggere per Tesseract).

export function invertiMatrice(m) {
  const [a, b, c, d, e, f] = m;
  const det = a * d - b * c;
  if (!det) throw new Error('Matrice non invertibile');
  return [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det];
}

export function applicaMatrice(m, x, y) {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

/** Elimina caratteri di controllo e normalizza (legature comprese) il testo riconosciuto. */
export function pulisciTesto(s) {
  return String(s || '').normalize('NFC').replace(/[\u0000-\u001f\u007f​-‍﻿]/g, '').replace(/\s+/g, ' ').trim();
}

/**
 * Estrae le righe da un risultato di Tesseract (data.blocks → paragraphs → lines → words).
 * → [{ bbox, baseline, words:[{ text, bbox, confidence }] }]
 */
export function righeDaRisultato(data) {
  const out = [];
  for (const block of data?.blocks || []) {
    for (const para of block.paragraphs || []) {
      for (const line of para.lines || []) {
        const words = (line.words || []).map((w) => ({ text: pulisciTesto(w.text), bbox: w.bbox, confidence: w.confidence })).filter((w) => w.text && w.bbox);
        if (words.length) out.push({ bbox: line.bbox, baseline: line.baseline, words });
      }
    }
  }
  return out;
}

/**
 * Calcola, per ogni parola, matrice di testo, corpo e compressione orizzontale nello spazio PDF.
 * lines: da righeDaRisultato (coordinate in pixel dell'immagine).
 * imgToPdf: matrice da pixel immagine a punti PDF (inversa della viewport usata per il rendering).
 * widthOf(text, size) → larghezza naturale in punti con il font scelto.
 * minConfidence: parole con confidenza inferiore vengono scartate (0 = tieni tutto).
 * → [{ text, tm:[a,b,c,d,e,f], size, tz }]
 */
export function disponiParole(lines, imgToPdf, widthOf, { minConfidence = 0 } = {}) {
  const out = [];
  for (const line of lines) {
    const lb = line.bbox;
    const H = Math.max(1, lb.y1 - lb.y0);
    const bl = line.baseline;
    const hasBaseline = bl && Number.isFinite(bl.y0) && Number.isFinite(bl.y1) && bl.x1 !== bl.x0 && bl.has_baseline !== false;
    const baselineAt = (x) => {
      if (!hasBaseline) return null;
      const t = (x - bl.x0) / (bl.x1 - bl.x0);
      return bl.y0 + t * (bl.y1 - bl.y0);
    };
    for (const w of line.words) {
      if (minConfidence && w.confidence < minConfidence) continue;
      const b = w.bbox;
      const cx = (b.x0 + b.x1) / 2;
      let by = baselineAt(cx);
      // linea di base implausibile (fuori dalla riga): stima dal riquadro
      if (by == null || by < lb.y0 + H * 0.4 || by > lb.y1 + H * 0.1) by = lb.y1 - H * 0.2;
      let sizePx = (by - lb.y0) / 0.78;
      sizePx = Math.min(Math.max(sizePx, H * 0.6), H * 1.3);
      const p0 = applicaMatrice(imgToPdf, b.x0, by);
      const p1 = applicaMatrice(imgToPdf, b.x1, by);
      const pu = applicaMatrice(imgToPdf, b.x0, by - sizePx);
      const ux = p1[0] - p0[0]; const uy = p1[1] - p0[1];
      const vx = pu[0] - p0[0]; const vy = pu[1] - p0[1];
      const wPt = Math.hypot(ux, uy); const size = Math.hypot(vx, vy);
      if (!(wPt > 0.1) || !(size > 0.5)) continue;
      const natural = widthOf(w.text, size);
      const tz = natural > 0 ? Math.min(1000, Math.max(5, (wPt / natural) * 100)) : 100;
      out.push({ text: w.text, tm: [ux / wPt, uy / wPt, vx / size, vy / size, p0[0], p0[1]], size, tz });
    }
  }
  return out;
}

/** Conta i caratteri non spaziatori di un getTextContent di pdf.js. */
export function caratteriTesto(textContent) {
  let n = 0;
  for (const it of textContent?.items || []) if (typeof it.str === 'string') n += it.str.replace(/\s/g, '').length;
  return n;
}

/**
 * Codifica RGBA (ImageData) in PGM binario (P5) a toni di grigio: niente compressione, quindi
 * velocissimo, e letto nativamente da Leptonica/Tesseract. (Il BMP no: tesseract.js lo ricodifica
 * in JavaScript con un costo enorme sulle pagine grandi.)
 */
export function pgmGrigio(rgba, width, height) {
  const head = new TextEncoder().encode(`P5\n${width} ${height}\n255\n`);
  const buf = new Uint8Array(head.length + width * height);
  buf.set(head, 0);
  let o = head.length;
  for (let i = 0, n = width * height * 4; i < n; i += 4) {
    let g = (rgba[i] * 77 + rgba[i + 1] * 150 + rgba[i + 2] * 29) >> 8;
    const a = rgba[i + 3];
    if (a < 255) g = ((g * a + 255 * (255 - a)) / 255) | 0; // trasparente → bianco
    buf[o++] = g;
  }
  return buf;
}

/** Stima del tempo rimanente, in testo leggibile. */
export function stimaTempo(msTrascorsi, fatte, totali) {
  if (!fatte || fatte >= totali) return '';
  const resto = (msTrascorsi / fatte) * (totali - fatte) / 1000;
  if (resto < 60) return `circa ${Math.max(1, Math.round(resto / 5) * 5)} secondi`;
  const min = Math.round(resto / 60);
  return min === 1 ? 'circa 1 minuto' : `circa ${min} minuti`;
}
