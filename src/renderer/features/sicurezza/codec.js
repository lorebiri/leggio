// Parti che usano il browser (canvas): ricompressione delle immagini e rendering delle pagine oscurate.

/** Rettangolo PDF → [x, y, w, h] nella viewport (pdf.js 6 non ha più convertToViewportRectangle). */
export function viewportRect(vp, r) {
  const [x1, y1] = vp.convertToViewportPoint(r[0], r[1]);
  const [x2, y2] = vp.convertToViewportPoint(r[2], r[3]);
  return [Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1)];
}

const hasOffscreen = typeof OffscreenCanvas !== 'undefined';
function makeCanvas(w, h) {
  if (hasOffscreen) return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas'); c.width = w; c.height = h; return c;
}
async function toJpeg(canvas, quality) {
  if (canvas.convertToBlob) return new Uint8Array(await (await canvas.convertToBlob({ type: 'image/jpeg', quality })).arrayBuffer());
  return new Promise((res) => canvas.toBlob(async (b) => res(b ? new Uint8Array(await b.arrayBuffer()) : null), 'image/jpeg', quality));
}

/** Codec per compressImages: decodifica (JPEG dal browser, pixel grezzi), ridimensiona, ricodifica JPEG. */
export const browserCodec = {
  async recompress(job) {
    const { kind, width, height, components, targetWidth: tw, targetHeight: th, quality, gray } = job;
    const opts = { imageOrientation: 'none', colorSpaceConversion: 'none', premultiplyAlpha: 'none' };
    if (tw !== width || th !== height) Object.assign(opts, { resizeWidth: tw, resizeHeight: th, resizeQuality: 'high' });
    let bitmap;
    if (kind === 'jpeg') {
      bitmap = await createImageBitmap(new Blob([job.bytes], { type: 'image/jpeg' }), opts);
    } else {
      const px = job.pixels; const rgba = new Uint8ClampedArray(width * height * 4);
      for (let i = 0, j = 0; i < width * height; i++, j += components) {
        const o = i * 4;
        if (components === 1) { rgba[o] = rgba[o + 1] = rgba[o + 2] = px[j]; } else { rgba[o] = px[j]; rgba[o + 1] = px[j + 1]; rgba[o + 2] = px[j + 2]; }
        rgba[o + 3] = 255;
      }
      bitmap = await createImageBitmap(new ImageData(rgba, width, height), opts);
    }
    try {
      if (bitmap.width !== tw || bitmap.height !== th) return null; // ridimensionamento non riuscito: meglio non toccare
      const c = makeCanvas(tw, th);
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, tw, th);
      if (gray) ctx.filter = 'grayscale(1)';
      ctx.drawImage(bitmap, 0, 0);
      return await toJpeg(c, quality);
    } finally { bitmap.close?.(); }
  },
};

/**
 * Rende una pagina a ~300 dpi, senza rotazione e senza annotazioni, con i riquadri di oscuramento.
 * → { bytes (JPEG), kind: 'jpeg', view: [x1,y1,x2,y2] }
 */
export async function renderRedactedPage(pdfjs, pdf, pageIndex, rects, { dpi = 300, color = '#000000', label = '', maxPixels = 36e6, quality = 0.8, signal } = {}) {
  const page = await pdf.getPage(pageIndex + 1);
  try {
    const base = page.getViewport({ scale: 1, rotation: 0 });
    let scale = dpi / 72;
    const px = base.width * base.height * scale * scale;
    if (px > maxPixels) scale *= Math.sqrt(maxPixels / px);
    const vp = page.getViewport({ scale, rotation: 0 });
    const w = Math.ceil(vp.width); const h = Math.ceil(vp.height);
    const canvas = makeCanvas(w, h);
    const ctx = canvas.getContext('2d', { alpha: false });
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, h);
    // intent 'print': niente requestAnimationFrame, così il lavoro prosegue anche a finestra ridotta a icona
    const task = page.render({ canvasContext: ctx, canvas, viewport: vp, intent: 'print', annotationMode: pdfjs.AnnotationMode.DISABLE, background: '#ffffff' });
    const onAbort = () => task.cancel();
    signal?.addEventListener('abort', onAbort);
    try { await task.promise; } catch (e) { if (signal?.aborted) throw new DOMException('Annullato', 'AbortError'); throw e; }
    finally { signal?.removeEventListener('abort', onAbort); }
    ctx.fillStyle = color;
    const boxes = rects.map((r) => viewportRect(vp, r));
    for (const [x, y, bw, bh] of boxes) ctx.fillRect(Math.floor(x), Math.floor(y), Math.ceil(bw) + 1, Math.ceil(bh) + 1);
    if (label) {
      ctx.fillStyle = contrast(color); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      for (const [x, y, bw, bh] of boxes) {
        if (bw < 12 || bh < 6) continue;
        let size = Math.min(bh * 0.62, 14 * scale);
        ctx.font = `bold ${size}px Helvetica, Arial, sans-serif`;
        const tw = ctx.measureText(label).width;
        if (tw > bw * 0.92) { size *= (bw * 0.92) / tw; ctx.font = `bold ${size}px Helvetica, Arial, sans-serif`; }
        if (size < 4) continue;
        ctx.save(); ctx.beginPath(); ctx.rect(x, y, bw, bh); ctx.clip();
        ctx.fillText(label, x + bw / 2, y + bh / 2); ctx.restore();
      }
    }
    const img = await encodePage(canvas, ctx, w, h, quality);
    canvas.width = canvas.height = 1; // libera subito la memoria
    return { ...img, view: page.view.slice() };
  } finally { page.cleanup(); }
}

function contrast(hex) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || '');
  if (!m) return '#ffffff';
  const [r, g, b] = m.slice(1).map((x) => parseInt(x, 16));
  return 0.299 * r + 0.587 * g + 0.114 * b > 140 ? '#000000' : '#ffffff';
}

/** Misura delle larghezze dei caratteri con il canvas (per posizionare con precisione i riquadri). */
const widthCache = new Map(); let mctx = null;
export function measureChars(str, family) {
  mctx ||= makeCanvas(8, 8).getContext('2d');
  const fam = /^(serif|sans-serif|monospace)$/.test(family) ? family : `${family}, sans-serif`;
  let cache = widthCache.get(fam);
  if (!cache) { cache = new Map(); widthCache.set(fam, cache); mctx.font = `100px ${fam}`; }
  if (mctx.font.indexOf(fam.split(',')[0]) < 0) mctx.font = `100px ${fam}`;
  const out = [];
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    let w = cache.get(ch);
    if (w == null) { mctx.font = `100px ${fam}`; w = mctx.measureText(ch).width || 50; cache.set(ch, w); }
    out.push(w);
  }
  return out;
}

async function deflate(u8) {
  if (typeof CompressionStream === 'undefined') return null;
  return new Uint8Array(await new Response(new Blob([u8]).stream().pipeThrough(new CompressionStream('deflate'))).arrayBuffer());
}

/**
 * Sceglie la codifica più leggera senza perdere leggibilità:
 *  - pagina senza colori e con pochi mezzitoni (testo, tabelle, timbri neri): scala di grigi a 16 livelli,
 *    compressione senza perdita (Flate): il testo resta netto e il file è 3-4 volte più leggero del JPEG;
 *  - altrimenti (foto, scansioni a colori o con sfondi): JPEG.
 * La sicurezza non cambia: in ogni caso la pagina è un'immagine già oscurata.
 */
export async function encodePage(canvas, ctx, w, h, quality = 0.8) {
  const data = ctx.getImageData(0, 0, w, h).data;
  const n = w * h;
  let colored = 0; let mid = 0; let samples = 0;
  for (let i = 0; i < n; i += 13) {
    const o = i * 4; const r = data[o]; const g = data[o + 1]; const b = data[o + 2];
    samples++;
    if (Math.max(Math.abs(r - g), Math.abs(g - b), Math.abs(r - b)) > 28) colored++;
    const y = (r * 77 + g * 150 + b * 29) >> 8;
    if (y > 40 && y < 215) mid++;
  }
  if (colored / samples < 0.002 && mid / samples < 0.12) {
    const rowBytes = (w + 1) >> 1;
    const g4 = new Uint8Array(rowBytes * h);
    for (let yy = 0; yy < h; yy++) {
      for (let x = 0; x < w; x++) {
        const o = (yy * w + x) * 4;
        const v = ((data[o] * 77 + data[o + 1] * 150 + data[o + 2] * 29) >> 8) >> 4;
        g4[yy * rowBytes + (x >> 1)] |= x & 1 ? v : v << 4;
      }
    }
    const z = await deflate(g4);
    if (z) return { bytes: z, kind: 'gray4', width: w, height: h };
  }
  const bytes = await toJpeg(canvas, quality);
  if (!bytes) throw new Error('Impossibile creare l\'immagine della pagina (memoria insufficiente?)');
  return { bytes, kind: 'jpeg' };
}
