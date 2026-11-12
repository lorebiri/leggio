// Intestazioni/piè di pagina, numerazione, numerazione progressiva (Bates), filigrana, sfondo.
// Ogni elemento aggiunto da Leggio è scritto in un flusso di contenuto marcato (/LeggioTimbro),
// così può essere rimosso in seguito senza toccare il resto della pagina.
import { PDFName, PDFArray, PDFRef, PDFDict, StandardFonts, degrees, rgb } from '@cantoo/pdf-lib';
import { ErroreUtente, validaIndici, aBlocchi, testoWinAnsi, mmToPt } from './util.js';
import { riquadro } from './impaginazione.js';

const N = (s) => PDFName.of(s);
const rotDi = (page) => (((page.getRotation().angle || 0) % 360) + 360) % 360;

export const FONT = {
  helvetica: ['Helvetica', StandardFonts.Helvetica], 'helvetica-b': ['Helvetica grassetto', StandardFonts.HelveticaBold],
  times: ['Times', StandardFonts.TimesRoman], 'times-b': ['Times grassetto', StandardFonts.TimesRomanBold],
  courier: ['Courier', StandardFonts.Courier],
};

export const MODELLI_NUMERO = [
  ['Pag. {n} di {N}', 'Pag. 1 di 10'],
  ['Pagina {n} di {N}', 'Pagina 1 di 10'],
  ['{n}/{N}', '1/10'],
  ['{n}', '1'],
  ['- {n} -', '- 1 -'],
];

/** Riferimento visivo della pagina: coordinate "come si vede" (origine in basso a sinistra). */
export function cornice(page) {
  const [x1, y1, x2, y2] = riquadro(page);
  const cw = x2 - x1, ch = y2 - y1;
  const rot = rotDi(page);
  const w = rot % 180 ? ch : cw, h = rot % 180 ? cw : ch;
  const punto = (vx, vy) => {
    switch (rot) {
      case 90: return [x1 + cw - vy, y1 + vx];
      case 180: return [x1 + cw - vx, y1 + ch - vy];
      case 270: return [x1 + vy, y1 + ch - vx];
      default: return [x1 + vx, y1 + vy];
    }
  };
  return { w, h, rot, punto, angolo: (a) => a + rot };
}

function rgbDaHex(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return rgb(0, 0, 0);
  const n = parseInt(m[1], 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

/** Sostituisce i segnaposto: {n} {N} {data} {file} {bates}. */
export function compila(modello, v) {
  return String(modello || '').replace(/\{(n|N|data|file|bates|pagina|totale)\}/g, (_, k) => ({ n: v.n, pagina: v.n, N: v.N, totale: v.N, data: v.data, file: v.file, bates: v.bates }[k] ?? ''));
}

export function numeroBates({ prefisso = '', cifre = 6, suffisso = '' }, numero) {
  return `${prefisso}${String(numero).padStart(Math.max(1, Math.min(12, cifre)), '0')}${suffisso}`;
}

function marca(page, tipo, sotto = false) {
  const cs = page.contentStream;
  if (!cs) return;
  cs.dict.set(N('LeggioTimbro'), N(tipo));
  if (sotto) {
    const contents = page.node.Contents();
    if (contents instanceof PDFArray) {
      const idx = contents.indexOf(page.contentStreamRef);
      if (idx !== undefined && idx > 0) { contents.remove(idx); contents.insert(0, page.contentStreamRef); }
    }
  }
  // un eventuale secondo timbro sulla stessa pagina userà un nuovo flusso
  page.contentStream = undefined; page.contentStreamRef = undefined;
}

/** Disegna testo in coordinate visive con ancoraggio orizzontale (0 sx, 0.5 centro, 1 dx). */
function testoVisivo(page, cor, str, { vx, vy, size, font, color, opacity, ancora = 0, angolo = 0, centraVert = false }) {
  const tw = font.widthOfTextAtSize(str, size);
  const th = centraVert ? font.heightAtSize(size, { descender: false }) : 0;
  const a = (angolo * Math.PI) / 180;
  const dx = -tw * ancora, dy = -th / 2;
  const ox = vx + dx * Math.cos(a) - dy * Math.sin(a);
  const oy = vy + dx * Math.sin(a) + dy * Math.cos(a);
  const [x, y] = cor.punto(ox, oy);
  page.drawText(str, { x, y, size, font, color, opacity, rotate: degrees(cor.angolo(angolo)) });
}

/**
 * Intestazione e piè di pagina (e numerazione Bates).
 * opts: { testi:{ alto:{sx,centro,dx}, basso:{sx,centro,dx} }, font, dimensione, colore, margini:{alto,basso,lati} (mm),
 *         indici, escludiPrima, inizio (numero della prima pagina numerata), totale ('documento'|'intervallo'),
 *         data, file, bates:{prefisso,cifre,inizio,suffisso} }
 */
export async function intestazioni(doc, opts) {
  const pages = doc.getPages();
  let sel = validaIndici(opts.indici ?? [...pages.keys()], pages.length);
  if (opts.escludiPrima) sel = sel.filter((i) => i !== 0);
  if (!sel.length) throw new ErroreUtente('Nessuna pagina da numerare: controlla l\'intervallo (la prima pagina è esclusa).');
  const testi = opts.testi || {};
  const slots = [];
  for (const riga of ['alto', 'basso']) for (const [col, anc] of [['sx', 0], ['centro', 0.5], ['dx', 1]]) {
    const t = testi[riga]?.[col];
    if (t && String(t).trim()) slots.push({ riga, anc, t: String(t) });
  }
  if (!slots.length) throw new ErroreUtente('Scrivi almeno un testo (per esempio «Pag. {n} di {N}»).');
  const size = Math.max(4, Math.min(72, Number(opts.dimensione) || 10));
  if (opts.bates && !(Number.isInteger(opts.bates.inizio) && opts.bates.inizio >= 0)) throw new ErroreUtente('Il numero iniziale deve essere un intero positivo.');
  const font = await doc.embedFont((FONT[opts.font] || FONT.helvetica)[1]);
  const color = rgbDaHex(opts.colore || '#000000');
  const mAlto = mmToPt(opts.margini?.alto ?? 12), mBasso = mmToPt(opts.margini?.basso ?? 12), mLati = mmToPt(opts.margini?.lati ?? 15);
  const inizio = Number.isInteger(opts.inizio) ? opts.inizio : 1;
  const totale = opts.totale === 'documento' ? pages.length : sel.length + inizio - 1;
  await aBlocchi(sel.length, (k) => {
    const page = pages[sel[k]];
    const cor = cornice(page);
    const v = {
      n: inizio + k, N: totale, data: opts.data || '', file: opts.file || '',
      bates: opts.bates ? numeroBates(opts.bates, opts.bates.inizio + k) : '',
    };
    for (const s of slots) {
      const str = testoWinAnsi(compila(s.t, v));
      if (!str) continue;
      const vx = s.anc === 0 ? mLati : s.anc === 1 ? cor.w - mLati : cor.w / 2;
      const vy = s.riga === 'alto' ? cor.h - mAlto - size * 0.75 : mBasso;
      testoVisivo(page, cor, str, { vx, vy, size, font, color, ancora: s.anc });
    }
    marca(page, opts.bates ? 'Bates' : 'Intestazione');
  }, { onProgress: opts.onProgress, signal: opts.signal, blocco: 50 });
  return { ultimoBates: opts.bates ? opts.bates.inizio + sel.length - 1 : null, pagine: sel.length };
}

const POS9 = { 'alto-sx': [0, 1], alto: [0.5, 1], 'alto-dx': [1, 1], sx: [0, 0.5], centro: [0.5, 0.5], dx: [1, 0.5], 'basso-sx': [0, 0], basso: [0.5, 0], 'basso-dx': [1, 0] };
export const POSIZIONI = Object.keys(POS9);

/**
 * Filigrana di testo o immagine.
 * opts: { testo | immagine:{bytes,tipo:'png'|'jpg'}, font, dimensione ('auto' | pt), scala (frazione larghezza per immagini),
 *         colore, opacita (0..1), rotazione (gradi, antiorari come si vede), posizione (POSIZIONI), sotto, indici }
 */
export async function filigrana(doc, opts) {
  const pages = doc.getPages();
  const sel = validaIndici(opts.indici ?? [...pages.keys()], pages.length);
  const opacity = Math.max(0.02, Math.min(1, opts.opacita ?? 0.3));
  const ang = Number(opts.rotazione) || 0;
  const [px, py] = POS9[opts.posizione || 'centro'] || POS9.centro;
  let font, img, str;
  if (opts.immagine) {
    try { img = opts.immagine.tipo === 'png' ? await doc.embedPng(opts.immagine.bytes) : await doc.embedJpg(opts.immagine.bytes); }
    catch { throw new ErroreUtente('Immagine non leggibile: usa un file PNG o JPG.'); }
  } else {
    str = testoWinAnsi(opts.testo || '').trim();
    if (!str) throw new ErroreUtente('Scrivi il testo della filigrana (per esempio COPIA).');
    font = await doc.embedFont((FONT[opts.font] || FONT['helvetica-b'])[1]);
  }
  const color = rgbDaHex(opts.colore || '#c0392b');
  const a = (ang * Math.PI) / 180;
  await aBlocchi(sel.length, (k) => {
    const page = pages[sel[k]];
    const cor = cornice(page);
    const margine = Math.min(cor.w, cor.h) * 0.06;
    if (img) {
      const sc = Math.max(0.05, Math.min(1, opts.scala ?? 0.5));
      const w = cor.w * sc, h = (img.height / img.width) * w;
      // estensione ruotata, per tenere l'immagine dentro la pagina
      const ew = Math.abs(w * Math.cos(a)) + Math.abs(h * Math.sin(a)), eh = Math.abs(w * Math.sin(a)) + Math.abs(h * Math.cos(a));
      const cx = margine + ew / 2 + (cor.w - 2 * margine - ew) * px, cy = margine + eh / 2 + (cor.h - 2 * margine - eh) * py;
      const ox = cx - (w / 2) * Math.cos(a) + (h / 2) * Math.sin(a), oy = cy - (w / 2) * Math.sin(a) - (h / 2) * Math.cos(a);
      const [x, y] = cor.punto(ox, oy);
      page.drawImage(img, { x, y, width: w, height: h, opacity, rotate: degrees(cor.angolo(ang)) });
    } else {
      let size = Number(opts.dimensione);
      if (!(size > 0)) { // automatica: il testo occupa circa il 70% della diagonale (o della larghezza)
        const lung = ang % 180 ? Math.min(Math.hypot(cor.w, cor.h), Math.abs(cor.h / Math.sin(a)) || Infinity, Math.abs(cor.w / Math.cos(a)) || Infinity) : cor.w;
        size = Math.max(8, Math.min(220, (lung * 0.7) / Math.max(1, font.widthOfTextAtSize(str, 1))));
      }
      const tw = font.widthOfTextAtSize(str, size), th = font.heightAtSize(size, { descender: false });
      const ew = Math.abs(tw * Math.cos(a)) + Math.abs(th * Math.sin(a)), eh = Math.abs(tw * Math.sin(a)) + Math.abs(th * Math.cos(a));
      const cx = margine + ew / 2 + Math.max(0, cor.w - 2 * margine - ew) * px, cy = margine + eh / 2 + Math.max(0, cor.h - 2 * margine - eh) * py;
      testoVisivo(page, cor, str, { vx: cx, vy: cy, size, font, color, opacity, ancora: 0.5, angolo: ang, centraVert: true });
    }
    marca(page, 'Filigrana', !!opts.sotto);
  }, { onProgress: opts.onProgress, signal: opts.signal, blocco: 50 });
}

/** Sfondo: colore pieno o immagine adattata alla pagina, sempre sotto il contenuto. */
export async function sfondo(doc, opts) {
  const pages = doc.getPages();
  const sel = validaIndici(opts.indici ?? [...pages.keys()], pages.length);
  let img;
  if (opts.immagine) {
    try { img = opts.immagine.tipo === 'png' ? await doc.embedPng(opts.immagine.bytes) : await doc.embedJpg(opts.immagine.bytes); }
    catch { throw new ErroreUtente('Immagine non leggibile: usa un file PNG o JPG.'); }
  }
  const color = rgbDaHex(opts.colore || '#fff8e1');
  const opacity = Math.max(0.02, Math.min(1, opts.opacita ?? 1));
  await aBlocchi(sel.length, (k) => {
    const page = pages[sel[k]];
    const [x1, y1, x2, y2] = riquadro(page);
    if (img) {
      const cor = cornice(page);
      const s = Math.max(cor.w / img.width, cor.h / img.height);
      const w = img.width * s, h = img.height * s;
      const [x, y] = cor.punto((cor.w - w) / 2, (cor.h - h) / 2);
      page.drawImage(img, { x, y, width: w, height: h, opacity, rotate: degrees(cor.angolo(0)) });
    } else page.drawRectangle({ x: x1, y: y1, width: x2 - x1, height: y2 - y1, color, opacity });
    marca(page, 'Sfondo', true);
  }, { onProgress: opts.onProgress, signal: opts.signal, blocco: 50 });
}

/** Elenco dei tipi di elementi aggiunti da Leggio presenti nel documento → { Intestazione: n, ... } */
export function elementiAggiunti(doc) {
  const conta = {};
  for (const p of doc.getPages()) {
    const c = p.node.Contents();
    if (!(c instanceof PDFArray)) continue;
    for (let i = 0; i < c.size(); i++) {
      const s = c.lookup(i);
      const t = s?.dict?.get(N('LeggioTimbro'));
      if (t) { const k = t.decodeText(); conta[k] = (conta[k] || 0) + 1; }
    }
  }
  return conta;
}

/** Rimuove gli elementi aggiunti da Leggio (tipi: array di nomi; vuoto = tutti). → numero rimossi */
export function rimuoviElementi(doc, tipi = []) {
  let n = 0;
  for (const p of doc.getPages()) {
    const c = p.node.Contents();
    if (!(c instanceof PDFArray)) continue;
    for (let i = c.size() - 1; i >= 0; i--) {
      const r = c.get(i); const s = c.lookup(i);
      const t = s?.dict?.get(N('LeggioTimbro'));
      if (t && (!tipi.length || tipi.includes(t.decodeText()))) { c.remove(i); if (r instanceof PDFRef) doc.context.delete(r); n++; }
    }
  }
  return n;
}
void PDFDict;
