// Pratica di missione e altri raccoglitori: ritaglio dei margini bianchi, pagine da immagini, pagina di riepilogo,
// divisione in parti sotto una soglia. Logica pura (pdf-lib passato come parametro; pixel come {data,width,height}).
import { aCapo } from './conformita.js';
import { testoSicuro } from './protocollo.js';
import { oggiLocale } from './controlli.js';

/**
 * Riquadro del contenuto (pixel non bianchi) di un'immagine RGBA. Tollera polvere e bordi scuri sottili.
 * → { x, y, w, h } in pixel, oppure null se l'immagine è vuota.
 */
export function riquadroContenuto({ data, width, height }, { soglia = 225, margine = 0.015, minFrac = 0.004 } = {}) {
  const step = Math.max(1, Math.floor(Math.max(width, height) / 900));
  const scuro = (i) => { const r = data[i]; const g = data[i + 1]; const b = data[i + 2]; return (r * 0.299 + g * 0.587 + b * 0.114) < soglia; };
  const rows = new Uint32Array(height); const cols = new Uint32Array(width);
  for (let y = 0; y < height; y += step) for (let x = 0; x < width; x += step) if (scuro((y * width + x) * 4)) { rows[y]++; cols[x]++; }
  const minR = Math.max(1, (width / step) * minFrac); const minC = Math.max(1, (height / step) * minFrac);
  let top = 0; while (top < height && rows[top] < minR) top++;
  if (top >= height) return null;
  let bottom = height - 1; while (bottom > top && rows[bottom] < minR) bottom--;
  let left = 0; while (left < width && cols[left] < minC) left++;
  let right = width - 1; while (right > left && cols[right] < minC) right--;
  const mx = Math.round(width * margine); const my = Math.round(height * margine);
  const x = Math.max(0, left - mx); const y = Math.max(0, top - my);
  return { x, y, w: Math.min(width, right + mx + 1) - x, h: Math.min(height, bottom + my + 1) - y };
}

/** Il ritaglio vale la pena? (evita ritagli inutili o sospetti, es. foto senza bordo) */
export function ritaglioUtile(r, width, height) {
  if (!r) return false;
  const area = (r.w * r.h) / (width * height);
  return area < 0.92 && area > 0.04;
}

/** Nome del file della pratica. */
export function nomeMissione(cognome, dataIso) {
  const c = String(cognome || 'COGNOME').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z']+/g, '').replace(/'/g, '').toUpperCase() || 'COGNOME';
  const d = /^\d{4}-\d{2}-\d{2}$/.test(dataIso || '') ? dataIso : oggiLocale();
  return `Missione_${c}_${d}.pdf`;
}

/** Pagina di riepilogo all'inizio. voci: [{ titolo, pagina, pagine, nota }] (pagina = indice 0-based della prima pagina, prima di inserire il riepilogo) */
export async function aggiungiRiepilogo(pdfDoc, PDFLib, voci, { titolo = 'Riepilogo dei giustificativi', righe = [] } = {}) {
  const reg = await pdfDoc.embedFont(PDFLib.StandardFonts.Helvetica);
  const bold = await pdfDoc.embedFont(PDFLib.StandardFonts.HelveticaBold);
  const p = pdfDoc.insertPage(0, [595.28, 841.89]);
  const M = 56; let y = 841.89 - 64; const ink = PDFLib.rgb(0.1, 0.11, 0.13); const muted = PDFLib.rgb(0.4, 0.43, 0.47);
  p.drawText(testoSicuro(bold, titolo), { x: M, y, size: 17, font: bold, color: ink }); y -= 22;
  for (const r of righe.filter(Boolean)) { for (const l of aCapo(reg, 10.5, r, 595 - 2 * M)) { p.drawText(l, { x: M, y, size: 10.5, font: reg, color: muted }); y -= 14; } }
  y -= 12;
  p.drawText('N.', { x: M, y, size: 9.5, font: bold, color: muted }); p.drawText('Giustificativo', { x: M + 30, y, size: 9.5, font: bold, color: muted }); p.drawText('Pagina', { x: 595 - M - 40, y, size: 9.5, font: bold, color: muted });
  y -= 6; p.drawLine({ start: { x: M, y }, end: { x: 595 - M, y }, thickness: 0.8, color: muted });
  for (const [i, v] of voci.entries()) {
    y -= 17; if (y < 60) break;
    let t = testoSicuro(reg, v.titolo + (v.nota ? ` (${v.nota})` : ''));
    while (reg.widthOfTextAtSize(t, 10) > 595 - 2 * M - 80 && t.length > 4) t = t.slice(0, -2);
    p.drawText(String(i + 1), { x: M, y, size: 10, font: reg, color: ink });
    p.drawText(t, { x: M + 30, y, size: 10, font: reg, color: ink });
    p.drawText(String(v.pagina + 2), { x: 595 - M - 40, y, size: 10, font: reg, color: ink }); // pagina 0-based prima del riepilogo: +1 per contare da 1, +1 per il riepilogo in testa
  }
  return p;
}

/**
 * Divide un PDF in parti sotto maxBytes (pagine consecutive). Ogni parte riceve «parte k di N» in alto.
 * → [{ bytes, da, a }]  (pagine 1-based). Una pagina più grande della soglia resta da sola (segnalata con troppoGrande).
 */
export async function dividiPerDimensione(PDFLib, bytes, maxBytes, { etichetta = true, signal } = {}) {
  const src = await PDFLib.PDFDocument.load(bytes, { updateMetadata: false });
  const n = src.getPageCount();
  const build = async (from, to) => {
    const d = await PDFLib.PDFDocument.create();
    (await d.copyPages(src, Array.from({ length: to - from }, (_, i) => from + i))).forEach((p) => d.addPage(p));
    return d;
  };
  const parti = []; let i = 0;
  while (i < n) {
    if (signal?.aborted) throw new DOMException('Annullato', 'AbortError');
    // ricerca della parte più lunga che sta sotto la soglia (crescita e poi bisezione)
    let lo = i + 1; let hi = i + 1; let best = null;
    let d = await build(i, lo); let b = await d.save({ useObjectStreams: true });
    if (b.length > maxBytes) { parti.push({ doc: d, da: i + 1, a: i + 1, troppoGrande: true }); i += 1; continue; }
    best = { doc: d, to: lo };
    while (hi < n) {
      hi = Math.min(n, lo + Math.max(1, lo - i));
      d = await build(i, hi); b = await d.save({ useObjectStreams: true });
      if (b.length <= maxBytes) { best = { doc: d, to: hi }; lo = hi; if (hi === n) break; } else break;
    }
    let a = best.to; let z = hi;
    while (z - a > 1) { const mid = (a + z) >> 1; const dm = await build(i, mid); const bm = await dm.save({ useObjectStreams: true }); if (bm.length <= maxBytes) { best = { doc: dm, to: mid }; a = mid; } else z = mid; }
    parti.push({ doc: best.doc, da: i + 1, a: best.to });
    i = best.to;
  }
  const N = parti.length; const out = [];
  for (const [k, p] of parti.entries()) {
    if (etichetta && N > 1) {
      const f = await p.doc.embedFont(PDFLib.StandardFonts.HelveticaBold);
      const pg = p.doc.getPage(0); const { width, height } = pg.getSize();
      const t = `Parte ${k + 1} di ${N}`;
      pg.drawText(t, { x: width - f.widthOfTextAtSize(t, 10) - 20, y: height - 18, size: 10, font: f, color: PDFLib.rgb(0.7, 0.14, 0.09) });
    }
    out.push({ bytes: await p.doc.save({ useObjectStreams: true }), da: p.da, a: p.a, troppoGrande: !!p.troppoGrande });
  }
  return out;
}

// ---------------------------------------------------------------- giustificativi per U-Web
const TIPI_SPESA = [
  ['albergo', /\b(hotel|albergo|b\s?&\s?b|bed and breakfast|pernottament|soggiorno|ostello|residence|camera n)/i],
  ['pasto', /\b(ristorante|trattoria|pizzeria|osteria|bar\b|caffetteria|pranzo|cena|coperto|menu|men[uù] del giorno|tavolo|self.?service)/i],
  ['taxi', /\b(taxi|radiotaxi|ncc|noleggio con conducente|uber)/i],
  ['noleggio', /\b(autonoleggio|noleggio auto|car rental|hertz|avis|europcar|sixt)/i],
  ['treno', /\b(trenitalia|italo|\bfrecc|treno|biglietto ferroviario|ntv)/i],
  ['aereo', /\b(volo|boarding|carta d['’]imbarco|ita airways|ryanair|easyjet|aeroporto)/i],
  ['trasporto locale', /\b(metropolitana|autobus|bus|atac|atm|tram)\b/i],
  ['carburante', /\b(carburante|benzina|gasolio|diesel|rifornimento)/i],
  ['parcheggio', /\b(parcheggio|parking|sosta)/i],
  ['convegno', /\b(iscrizione|registration fee|quota di partecipazione|convegno|conference)/i],
];

/**
 * Classifica un giustificativo di missione dal testo (OCR). Leggio PROPONE: la persona conferma in U-Web.
 * → { tipoSpesa, data (ISO|null), importo (number|null), pagamento: 'tracciabile'|'contanti'|'non indicato', tipoAllegato, contantiDaSegnalare }
 */
export function classificaGiustificativo(testo, { regolePagamenti = { spese: ['albergo', 'pasto', 'taxi', 'noleggio'] } } = {}) {
  const t = String(testo || '').replace(/\s+/g, ' ');
  const tipoSpesa = (TIPI_SPESA.find(([, re]) => re.test(t)) || ['altro'])[0];
  let pagamento = 'non indicato';
  if (/\b(carta|bancomat|pos\b|visa|mastercard|maestro|amex|american express|contactless|pagobancomat|apple pay|google pay|satispay|carta di credito|carta di debito|bonifico)/i.test(t)) pagamento = 'tracciabile';
  else if (/\b(contanti|contante|cash|resto\b|pagato in contanti)/i.test(t)) pagamento = 'contanti';
  const tot = t.match(/(?:totale|importo|tot\.?|da pagare|pagato|amount|total)\s*(?:euro|eur|€)?\s*:?\s*(?:euro|eur|€)?\s*(\d{1,5}[.,]\d{2})/i) || t.match(/(?:€|eur)\s*(\d{1,5}[.,]\d{2})/i);
  const importo = tot ? Number(tot[1].replace(',', '.')) : null;
  const m = t.match(/\b(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})\b/);
  let data = null;
  if (m) { let y = +m[3]; if (y < 100) y += 2000; const dt = new Date(Date.UTC(y, +m[2] - 1, +m[1])); if (dt.getUTCDate() === +m[1] && dt.getUTCMonth() === +m[2] - 1) data = dt.toISOString().slice(0, 10); }
  const tipoAllegato = pagamento === 'tracciabile' ? 'Giustificativo di spesa con indicazione del tipo pagamento'
    : 'Giustificativo di spesa senza indicazione del tipo pagamento (serve anche l\'«Attestazione del tipo di pagamento»)';
  const contantiDaSegnalare = pagamento === 'contanti' && regolePagamenti.spese.includes(tipoSpesa);
  return { tipoSpesa, data, importo, pagamento, tipoAllegato, contantiDaSegnalare };
}

/** Nome del file per un giustificativo: aaaa-mm-gg_tipo_importo.pdf (con numero progressivo per distinguere). */
export function nomeGiustificativo(c, n) {
  const imp = c.importo != null ? '_' + c.importo.toFixed(2).replace('.', ',') + 'EUR' : '';
  return `${String(n).padStart(2, '0')}_${c.data || 'senza-data'}_${c.tipoSpesa.replace(/\s+/g, '-')}${imp}.pdf`;
}
