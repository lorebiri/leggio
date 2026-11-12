// Lettura della striscia di segnatura (immagine) con un OCR mirato: solo il riquadro della striscia
// sulla pagina 1, raddrizzato. Prima si prova il servizio dell'area avanzati
// (app.services.segnaturaTitulus, modello configurabile); se non c'è o non trova nulla, il ripiego:
// disegno del solo riquadro con pdf.js + Tesseract (app.services.creaWorkerOcr dell'area conversione).
// Leggere non modifica nulla: il file (anche firmato) resta identico.
import { openPdfJs, destroyPdf } from '../../core/pdf.js';
import { segnaturaGenerica, normalizzaSegnatura } from './lib/segnatura.js';

export class LettoreSegnature {
  constructor(app) { this.app = app; this.tess = null; }

  get disponibile() {
    const sv = this.app.services || {};
    return typeof sv.segnaturaTitulus === 'function' || typeof sv.creaWorkerOcr === 'function';
  }

  /** → { numero, data, aoo, uor, testo, fonte } oppure null */
  async leggi(bytes, striscia) {
    const sv = this.app.services || {};
    if (typeof sv.segnaturaTitulus === 'function') {
      try {
        const r = normalizzaSegnatura(await sv.segnaturaTitulus({ bytes, pagina: 1, area: striscia.bbox, verticale: striscia.verticale, lato: striscia.lato }));
        if (r) return { ...r, fonte: 'striscia (modello)' };
      } catch (e) { this.app.log?.('warn', 'archivio: segnaturaTitulus non riuscita', { e: e?.message }); }
    }
    if (typeof sv.creaWorkerOcr !== 'function') return null;
    const immagini = await this.#ritaglia(bytes, striscia);
    this.ultimeImmagini = immagini; // diagnostica
    this.tess ??= await sv.creaWorkerOcr(['ita', 'eng']);
    // la striscia è UNA riga di testo: modalità «riga singola» (7), poi «automatica» (3); il predefinito di
    // tesseract.js (blocco, 6) su una riga lunga e sottile spesso non trova nulla
    for (const psm of ['7', '3']) {
      try { await this.tess.setParameters({ tessedit_pageseg_mode: psm }); } catch { /* versioni vecchie */ }
      for (const im of immagini) {
        const { data } = await this.tess.recognize(im);
        this.ultimoTesto = String(data?.text || '').replace(/\s+/g, ' ').slice(0, 300); // diagnostica
        const r = segnaturaGenerica(this.ultimoTesto);
        if (r) return { ...r, fonte: 'striscia (OCR)' };
      }
    }
    return null;
  }

  /** Disegna solo il riquadro della striscia (risoluzione circa quella dell'immagine originale) e lo raddrizza. */
  async #ritaglia(bytes, striscia) {
    const { pdf } = await openPdfJs(bytes);
    try {
      const page = await pdf.getPage(1);
      const [x0, y0, x1, y1] = striscia.bbox;
      const lungoPt = striscia.verticale ? y1 - y0 : x1 - x0;
      const lungoPx = Math.max(...(striscia.px || []).filter(Number.isFinite), 0) || lungoPt * 4;
      const scale = Math.max(2, Math.min(6, lungoPx / lungoPt));
      const vp = page.getViewport({ scale });
      const pad = 2;
      const pts = [vp.convertToViewportPoint(x0 - pad, y0 - pad), vp.convertToViewportPoint(x1 + pad, y1 + pad)];
      const rx = Math.max(0, Math.floor(Math.min(pts[0][0], pts[1][0]))); const ry = Math.max(0, Math.floor(Math.min(pts[0][1], pts[1][1])));
      const rw = Math.min(Math.ceil(Math.abs(pts[1][0] - pts[0][0])), 4000); const rh = Math.min(Math.ceil(Math.abs(pts[1][1] - pts[0][1])), 6000);
      const c = document.createElement('canvas'); c.width = rw; c.height = rh;
      const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, rw, rh);
      await page.render({ canvasContext: ctx, canvas: c, viewport: vp, transform: [1, 0, 0, 1, -rx, -ry] }).promise; // con le annotazioni: la striscia può essere un timbro (annotazione)
      page.cleanup();
      if (!striscia.verticale) return [ruota(c, 0)];
      // testo verticale: prima dall'alto in basso (la striscia di Titulus vista al CNR), poi dal basso in alto
      return [ruota(c, -90), ruota(c, 90)];
    } finally { destroyPdf(pdf); }
  }

  async chiudi() { try { await this.tess?.terminate(); } catch { /* */ } this.tess = null; }
}

/** Ruota di ±90° su fondo bianco con un margine (senza margine Tesseract non trova la riga). */
function ruota(src, gradi, margine = 20) {
  const dritta = gradi % 180 === 0;
  const c = document.createElement('canvas'); c.width = (dritta ? src.width : src.height) + 2 * margine; c.height = (dritta ? src.height : src.width) + 2 * margine;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  ctx.translate(c.width / 2, c.height / 2); ctx.rotate((gradi * Math.PI) / 180);
  ctx.drawImage(src, -src.width / 2, -src.height / 2);
  return c;
}
