// Pianificazione della stampa (logica pura, testata in Node): quali pagine di quali file, in quanti
// lavori di stampa, con le pagine bianche che servono in fronte/retro perché ogni documento inizi su
// un foglio nuovo.

export const MAX_PAGES_PER_JOB = 200;

/** Preset di stampa predefinito (ricordato nelle impostazioni come 'printPreset'). */
export const DEFAULT_PRINT_PRESET = {
  printer: '',          // '' = scegli nella finestra di sistema
  copies: 1,
  duplex: 'simplex',    // simplex | longEdge | shortEdge
  color: true,
  quality: '150',
  annots: true,
  copyStamp: false,     // timbro «COPIA» solo sulla stampa
};

/** Normalizza un preset (valori validi, numeri limitati). */
export function normalizePreset(p = {}) {
  const out = { ...DEFAULT_PRINT_PRESET };
  for (const k of Object.keys(DEFAULT_PRINT_PRESET)) if (p && p[k] !== undefined) out[k] = p[k];
  out.copies = Math.max(1, Math.min(99, Math.floor(Number(out.copies) || 1)));
  if (!['simplex', 'longEdge', 'shortEdge'].includes(out.duplex)) out.duplex = 'simplex';
  if (!['96', '150', '300'].includes(String(out.quality))) out.quality = '150';
  out.quality = String(out.quality);
  out.color = out.color !== false;
  out.annots = out.annots !== false;
  out.copyStamp = !!out.copyStamp;
  out.printer = typeof out.printer === 'string' ? out.printer : '';
  return out;
}

/**
 * files: [{ pages: number[] }] (indici 0-based da stampare per ciascun file)
 * → [[{ file, page } | { blank: true }]] lavori di stampa. Un file non viene mai spezzato fra due
 * lavori se non supera da solo il limite; in fronte/retro ogni file con pagine dispari riceve una
 * pagina bianca in coda (così il successivo inizia su un foglio nuovo).
 */
export function planPrintJobs(files, { duplex = 'simplex', maxPagesPerJob = MAX_PAGES_PER_JOB } = {}) {
  const jobs = [];
  let cur = [];
  const flush = () => { if (cur.length) { jobs.push(cur); cur = []; } };
  const twoSided = duplex !== 'simplex';
  files.forEach((f, fi) => {
    const items = f.pages.map((p) => ({ file: fi, page: p }));
    if (twoSided && items.length % 2 === 1 && fi < files.length - 1) items.push({ blank: true });
    if (!items.length) return;
    if (cur.length && cur.length + items.length > maxPagesPerJob) flush();
    for (let i = 0; i < items.length; i += maxPagesPerJob) {
      const chunk = items.slice(i, i + maxPagesPerJob);
      if (cur.length + chunk.length > maxPagesPerJob) flush();
      cur.push(...chunk);
      if (cur.length >= maxPagesPerJob) flush();
    }
  });
  flush();
  return jobs;
}

/**
 * Pixel massimi di una pagina stampata alla qualità scelta (dpi): quanto serve per un foglio A3 a quella
 * risoluzione, mai oltre 36 milioni (un A0 a 300 dpi ne chiederebbe ~140 e il canvas resterebbe vuoto).
 */
export function printPixelBudget(quality) {
  const dpi = Math.max(72, Math.min(600, Number(quality) || 150));
  return Math.min(36e6, Math.round(11.7 * 16.5 * dpi * dpi));
}

/** Limiti sicuri di un canvas in Chromium (oltre, il canvas resta vuoto senza errori: fogli bianchi in stampa). */
export const CANVAS_MAX_SIDE = 16384;
export const CANVAS_MAX_PIXELS = 64e6;

/** Scala ridotta perché la pagina stia nei limiti (lato massimo e numero di pixel). */
export function fitScale(widthPt, heightPt, scale, { maxSide = CANVAS_MAX_SIDE, maxPixels = CANVAS_MAX_PIXELS } = {}) {
  const w = Math.max(1, widthPt), hgt = Math.max(1, heightPt);
  return Math.max(0.01, Math.min(scale, maxSide / w, maxSide / hgt, Math.sqrt(maxPixels / (w * hgt))));
}
