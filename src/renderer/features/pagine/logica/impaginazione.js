// Ritaglio, ridimensionamento, più pagine per foglio, opuscolo, analisi dei pixel. Logica pura.
import {
  PDFDocument, PDFName, PDFArray, PDFDict, PDFNumber, PDFContentStream,
  pushGraphicsState, popGraphicsState, concatTransformationMatrix, degrees, rgb,
} from '@cantoo/pdf-lib';
import { ErroreUtente, validaIndici, aBlocchi } from './util.js';
import { materializzaEreditati } from './struttura.js';

const N = (s) => PDFName.of(s);
const rotDi = (page) => (((page.getRotation().angle || 0) % 360) + 360) % 360;

/** Riquadro visibile non ruotato [x1,y1,x2,y2] (CropBox ∩ MediaBox). */
export function riquadro(page) {
  const m = page.getMediaBox();
  const c = page.getCropBox();
  const x1 = Math.max(m.x, c.x), y1 = Math.max(m.y, c.y);
  const x2 = Math.min(m.x + m.width, c.x + c.width), y2 = Math.min(m.y + m.height, c.y + c.height);
  return x2 > x1 && y2 > y1 ? [x1, y1, x2, y2] : [m.x, m.y, m.x + m.width, m.y + m.height];
}

/**
 * Margini "come si vedono" (alto, destra, basso, sinistra) → variazioni del riquadro PDF
 * non ruotato, tenendo conto di /Rotate. → { x1, y1, x2, y2 } da sommare (x2,y2 negativi).
 */
export function marginiPdf(rot, { alto = 0, destra = 0, basso = 0, sinistra = 0 }) {
  switch (((rot % 360) + 360) % 360) {
    case 90: return { x1: alto, y1: sinistra, x2: -basso, y2: -destra };
    case 180: return { x1: destra, y1: alto, x2: -sinistra, y2: -basso };
    case 270: return { x1: basso, y1: destra, x2: -alto, y2: -sinistra };
    default: return { x1: sinistra, y1: basso, x2: -destra, y2: -alto };
  }
}

/**
 * Imposta il ritaglio (CropBox) sulle pagine.
 * spec: { rett:[x1,y1,x2,y2] } in coordinate PDF, oppure { margini:{alto,destra,basso,sinistra} } in punti
 * rispetto al riquadro attuale, oppure funzione (indice, page) → [x1,y1,x2,y2] | null.
 */
export function ritaglia(doc, indici, spec) {
  const pages = doc.getPages();
  let fatte = 0;
  for (const i of validaIndici(indici, pages.length)) {
    const p = pages[i];
    materializzaEreditati(p);
    const m = p.getMediaBox();
    let r;
    if (typeof spec === 'function') r = spec(i, p);
    else if (spec.rett) r = spec.rett;
    else if (spec.margini) {
      const [x1, y1, x2, y2] = riquadro(p);
      const d = marginiPdf(rotDi(p), spec.margini);
      r = [x1 + d.x1, y1 + d.y1, x2 + d.x2, y2 + d.y2];
    } else if (spec.ripristina) { p.node.delete(N('CropBox')); fatte++; continue; }
    if (!r) continue;
    let [a, b, c, d] = r;
    if (spec.margini && (c - a < 10 || d - b < 10)) throw new ErroreUtente(`Il ritaglio della pagina ${i + 1} sarebbe troppo piccolo: riduci i margini.`);
    [a, c] = [Math.min(a, c), Math.max(a, c)]; [b, d] = [Math.min(b, d), Math.max(b, d)];
    a = Math.max(a, m.x); b = Math.max(b, m.y); c = Math.min(c, m.x + m.width); d = Math.min(d, m.y + m.height);
    if (c - a < 10 || d - b < 10) throw new ErroreUtente(`Il ritaglio della pagina ${i + 1} sarebbe troppo piccolo: riduci i margini.`);
    p.setCropBox(a, b, c - a, d - b);
    fatte++;
  }
  return fatte;
}

/**
 * Analizza i pixel RGBA di una pagina resa su canvas.
 * → { vuota, inchiostro (frazione), limiti: {x0,y0,x1,y1} in pixel (origine in alto a sinistra) | null }
 * bordo: frazione dei lati ignorata (ombre dello scanner). soglia: 0..255 sotto cui un pixel conta.
 */
export function analizzaPixel(data, w, h, { soglia = 235, bordo = 0.02, sogliaVuota = 0.0012 } = {}) {
  const bx = Math.floor(w * bordo), by = Math.floor(h * bordo);
  let x0 = w, y0 = h, x1 = -1, y1 = -1, conta = 0;
  for (let y = by; y < h - by; y++) {
    let o = (y * w + bx) * 4;
    for (let x = bx; x < w - bx; x++, o += 4) {
      const a = data[o + 3];
      if (a < 16) continue; // trasparente = bianco
      const lum = (data[o] * 299 + data[o + 1] * 587 + data[o + 2] * 114) / 1000;
      if (lum < soglia) { conta++; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    }
  }
  const area = Math.max(1, (w - 2 * bx) * (h - 2 * by));
  const inchiostro = conta / area;
  return { vuota: inchiostro < sogliaVuota, inchiostro, limiti: x1 >= 0 ? { x0, y0, x1: x1 + 1, y1: y1 + 1 } : null };
}

function avvolgiContenuto(page, matrice) {
  const ctx = page.doc.context;
  page.node.normalize();
  const start = PDFContentStream.of(ctx.obj({}), [pushGraphicsState(), concatTransformationMatrix(...matrice)]);
  const end = PDFContentStream.of(ctx.obj({}), [popGraphicsState()]);
  page.node.wrapContentStreams(ctx.register(start), ctx.register(end));
}

function trasformaAnnotazioni(page, s, tx, ty) {
  const annots = page.node.Annots();
  if (!annots) return;
  const pt = (arr, soloScala = false) => {
    if (!(arr instanceof PDFArray)) return;
    for (let k = 0; k < arr.size(); k++) {
      const v = arr.lookup(k);
      if (!(v instanceof PDFNumber)) continue;
      const off = soloScala ? 0 : (k % 2 === 0 ? tx : ty);
      arr.set(k, PDFNumber.of(v.asNumber() * s + off));
    }
  };
  for (let i = 0; i < annots.size(); i++) {
    const a = annots.lookup(i);
    if (!(a instanceof PDFDict)) continue;
    for (const k of ['Rect', 'QuadPoints', 'Vertices', 'L', 'CL']) pt(a.lookup(N(k)));
    pt(a.lookup(N('RD')), true);
    const ink = a.lookup(N('InkList'));
    if (ink instanceof PDFArray) for (let k = 0; k < ink.size(); k++) pt(ink.lookup(k));
  }
}

/**
 * Ridimensiona le pagine al formato [W,H] (verticale). Il contenuto viene adattato (modo 'adatta')
 * o solo centrato ('centra'); annotazioni e campi seguono il contenuto.
 * orientamento: 'auto' (come la pagina) | 'verticale' | 'orizzontale'.
 */
export async function ridimensiona(doc, indici, [W, H], { modo = 'adatta', orientamento = 'auto', onProgress, signal } = {}) {
  if (!(W > 10 && H > 10 && W < 14400 && H < 14400)) throw new ErroreUtente('Formato non valido: usa misure tra 4 mm e 5 metri.');
  const pages = doc.getPages();
  const sel = validaIndici(indici, pages.length);
  await aBlocchi(sel.length, (k) => {
    const p = pages[sel[k]];
    materializzaEreditati(p);
    const rot = rotDi(p);
    const [bx, by, bx2, by2] = riquadro(p);
    const bw = bx2 - bx, bh = by2 - by;
    const visW = rot % 180 ? bh : bw, visH = rot % 180 ? bw : bh;
    let tw = Math.min(W, H), th = Math.max(W, H);
    const orizz = orientamento === 'orizzontale' || (orientamento === 'auto' && visW > visH);
    if (orizz) [tw, th] = [th, tw];
    const [TW, TH] = rot % 180 ? [th, tw] : [tw, th]; // in coordinate non ruotate
    const s = modo === 'adatta' ? Math.min(TW / bw, TH / bh) : 1;
    const tx = (TW - bw * s) / 2 - bx * s;
    const ty = (TH - bh * s) / 2 - by * s;
    avvolgiContenuto(p, [s, 0, 0, s, tx, ty]);
    trasformaAnnotazioni(p, s, tx, ty);
    p.setMediaBox(0, 0, TW, TH);
    for (const k of ['CropBox', 'BleedBox', 'TrimBox', 'ArtBox']) p.node.delete(N(k));
  }, { onProgress, signal });
}

/** Disposizione della griglia per N pagine per foglio → { col, righe, orizzontale } */
export function grigliaNup(n) {
  const t = { 2: [2, 1, true], 4: [2, 2, false], 6: [2, 3, false], 8: [2, 4, false], 9: [3, 3, false], 16: [4, 4, false] }[n];
  if (!t) throw new ErroreUtente('Scegli 2, 4, 6, 8, 9 o 16 pagine per foglio.');
  return { col: t[0], righe: t[1], orizzontale: t[2] };
}

/** Ordine delle pagine nell'opuscolo: fogli → { fronte:[sx,dx], retro:[sx,dx] } (null = bianca). */
export function ordineOpuscolo(n, { rilegatura = 'sinistra' } = {}) {
  if (n < 1) throw new ErroreUtente('Il documento non ha pagine.');
  const m = Math.ceil(n / 4) * 4;
  const v = (i) => (i < n ? i : null);
  const fogli = [];
  for (let s = 0; s < m / 4; s++) {
    let fronte = [v(m - 1 - 2 * s), v(2 * s)];
    let retro = [v(2 * s + 1), v(m - 2 - 2 * s)];
    if (rilegatura === 'destra') { fronte = fronte.reverse(); retro = retro.reverse(); }
    fogli.push({ fronte, retro });
  }
  return fogli;
}

/** Disegna una pagina incorporata dentro il riquadro (x,y,w,h) mantenendo le proporzioni e /Rotate. */
function disegnaAdattata(foglio, emb, rot, x, y, w, h) {
  const ew = emb.width, eh = emb.height;
  const vw = rot % 180 ? eh : ew, vh = rot % 180 ? ew : eh;
  const s = Math.min(w / vw, h / vh);
  const W = ew * s, H = eh * s;
  const ox = x + (w - vw * s) / 2, oy = y + (h - vh * s) / 2;
  const off = { 0: [0, 0], 90: [0, W], 180: [W, H], 270: [H, 0] }[rot];
  foglio.drawPage(emb, { x: ox + off[0], y: oy + off[1], xScale: s, yScale: s, rotate: degrees(-rot) });
}

async function incorpora(out, src, indici) {
  const pages = src.getPages();
  const bbs = indici.map((i) => { const [x1, y1, x2, y2] = riquadro(pages[i]); return { left: x1, bottom: y1, right: x2, top: y2 }; });
  return out.embedPages(indici.map((i) => pages[i]), bbs);
}

/** Più pagine per foglio. → nuovo PDFDocument. */
export async function nUp(src, { perFoglio = 2, formato = [595.28, 841.89], margine = 18, spazio = 8, bordo = false, indici, onProgress, signal } = {}) {
  const { col, righe, orizzontale } = grigliaNup(perFoglio);
  const sel = indici ? validaIndici(indici, src.getPageCount()) : [...Array(src.getPageCount()).keys()];
  const out = await PDFDocument.create();
  const [fw, fh] = orizzontale ? [Math.max(...formato), Math.min(...formato)] : [Math.min(...formato), Math.max(...formato)];
  const cw = (fw - 2 * margine - (col - 1) * spazio) / col;
  const ch = (fh - 2 * margine - (righe - 1) * spazio) / righe;
  if (cw < 20 || ch < 20) throw new ErroreUtente('Margini troppo grandi per questo formato.');
  const pages = src.getPages();
  const fogli = Math.ceil(sel.length / perFoglio);
  await aBlocchi(fogli, async (f) => {
    const gruppo = sel.slice(f * perFoglio, (f + 1) * perFoglio);
    const embs = await incorpora(out, src, gruppo);
    const foglio = out.addPage([fw, fh]);
    gruppo.forEach((pi, k) => {
      const c = k % col, r = Math.floor(k / col);
      const x = margine + c * (cw + spazio), y = fh - margine - (r + 1) * ch - r * spazio;
      disegnaAdattata(foglio, embs[k], rotDi(pages[pi]), x, y, cw, ch);
      if (bordo) foglio.drawRectangle({ x, y, width: cw, height: ch, borderColor: rgb(0.6, 0.6, 0.6), borderWidth: 0.6 });
    });
  }, { onProgress, signal, blocco: 10 });
  return out;
}

/** Opuscolo: fogli orizzontali con due pagine affiancate, da stampare fronte/retro sul lato corto. */
export async function opuscolo(src, { formato = [595.28, 841.89], rilegatura = 'sinistra', margine = 0, onProgress, signal } = {}) {
  const n = src.getPageCount();
  const fogli = ordineOpuscolo(n, { rilegatura });
  const out = await PDFDocument.create();
  const fw = Math.max(...formato), fh = Math.min(...formato);
  const pages = src.getPages();
  const lati = fogli.flatMap((f) => [f.fronte, f.retro]);
  await aBlocchi(lati.length, async (k) => {
    const coppia = lati[k];
    const foglio = out.addPage([fw, fh]);
    const usati = coppia.filter((x) => x != null);
    const embs = usati.length ? await incorpora(out, src, usati) : [];
    let e = 0;
    coppia.forEach((pi, lato) => {
      if (pi == null) return;
      disegnaAdattata(foglio, embs[e++], rotDi(pages[pi]), lato * fw / 2 + margine, margine, fw / 2 - 2 * margine, fh - 2 * margine);
    });
  }, { onProgress, signal, blocco: 10 });
  return out;
}
