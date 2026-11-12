// Creazione di PDF da immagini, testo o pagine vuote; unione di file misti. Logica pura.
import { PDFDocument, StandardFonts, degrees } from '@cantoo/pdf-lib';
import { ErroreUtente, FORMATI, mmToPt, aBlocchi, testoWinAnsi, tipoImmagine, orientamentoJpeg, cedi } from './util.js';
import { copiaPagineEsterne, caricaPdf } from './struttura.js';
import { leggiSegnalibri, scriviSegnalibri, rimappa } from './segnalibri.js';

/**
 * Aggiunge un'immagine come pagina. img: { bytes, nome, tipo? ('jpg'|'png'), orientamento? (EXIF 1..8) }
 * opts: { formato: 'A4'|'Letter'|'immagine'|[w,h], margine (mm), orientamento: 'auto'|'verticale'|'orizzontale' }
 */
export async function paginaDaImmagine(doc, img, { formato = 'A4', margine = 10, orientamento = 'auto' } = {}) {
  const tipo = img.tipo || tipoImmagine(img.bytes);
  if (tipo !== 'jpg' && tipo !== 'png') throw new ErroreUtente(`«${img.nome || 'immagine'}» non è un JPG o PNG leggibile.`);
  let emb;
  try { emb = tipo === 'png' ? await doc.embedPng(img.bytes) : await doc.embedJpg(img.bytes); }
  catch { throw new ErroreUtente(`«${img.nome || 'immagine'}» è danneggiata o in un formato non supportato.`); }
  const o = tipo === 'jpg' ? (img.orientamento ?? orientamentoJpeg(img.bytes)) : 1;
  // EXIF 5-8: lati scambiati; rotazione (antioraria per pdf-lib) e specchio
  const ruotaGradi = { 3: 180, 4: 180, 5: 90, 6: 270, 7: 270, 8: 90 }[o] || 0;
  const specchio = [2, 4, 5, 7].includes(o);
  const iw = emb.width, ih = emb.height;
  const vw = o >= 5 ? ih : iw, vh = o >= 5 ? iw : ih; // dimensioni come si vede
  let pw, ph;
  const m = mmToPt(Math.max(0, Math.min(60, margine || 0)));
  if (formato === 'immagine') {
    // 1 pixel = 1 punto, ma entro limiti ragionevoli (max ~A2), più i margini
    const s = Math.min(1, 1684 / Math.max(vw, vh));
    pw = vw * s + 2 * m; ph = vh * s + 2 * m;
  } else {
    const f = Array.isArray(formato) ? formato : FORMATI[formato] || FORMATI.A4;
    pw = Math.min(...f); ph = Math.max(...f);
    if (orientamento === 'orizzontale' || (orientamento === 'auto' && vw > vh)) [pw, ph] = [ph, pw];
  }
  const page = doc.addPage([pw, ph]);
  const s = Math.min((pw - 2 * m) / vw, (ph - 2 * m) / vh);
  const dw = vw * s, dh = vh * s;
  const x0 = (pw - dw) / 2, y0 = (ph - dh) / 2;
  const W = iw * s, H = ih * s; // dimensioni disegnate prima della rotazione
  let x = x0, y = y0;
  if (ruotaGradi === 90) x = x0 + dw; // rotazione antioraria di 90 attorno all'origine
  if (ruotaGradi === 180) { x = x0 + dw; y = y0 + dh; }
  if (ruotaGradi === 270) y = y0 + dh;
  if (specchio) {
    // specchio orizzontale applicato prima della rotazione: larghezza negativa
    const opt = { width: -W, height: H, rotate: degrees(ruotaGradi) };
    const a = (ruotaGradi * Math.PI) / 180;
    page.drawImage(emb, { ...opt, x: x + W * Math.cos(a), y: y + W * Math.sin(a) });
  } else page.drawImage(emb, { x, y, width: W, height: H, rotate: degrees(ruotaGradi) });
  return page;
}

/** PDF da immagini (una per pagina). */
export async function pdfDaImmagini(immagini, opts = {}) {
  if (!immagini?.length) throw new ErroreUtente('Scegli almeno un\'immagine.');
  const doc = await PDFDocument.create();
  await aBlocchi(immagini.length, (i) => paginaDaImmagine(doc, immagini[i], opts), { onProgress: opts.onProgress, signal: opts.signal, blocco: 2 });
  doc.setTitle(opts.titolo || 'Immagini');
  doc.setCreator('Leggio');
  return doc;
}

/** Va a capo in base alla larghezza: → righe. */
export function spezzaRighe(testo, font, size, larghezza) {
  const out = [];
  for (const par of String(testo).replace(/\r\n?/g, '\n').split('\n')) {
    const riga = testoWinAnsi(par);
    if (!riga.trim()) { out.push(''); continue; }
    let cur = '';
    for (const parola of riga.split(/(\s+)/)) {
      const prova = cur + parola;
      if (font.widthOfTextAtSize(prova, size) <= larghezza) { cur = prova; continue; }
      if (cur.trim()) out.push(cur.trimEnd());
      cur = parola.trimStart();
      // parola più lunga della riga: spezzata a caratteri
      while (font.widthOfTextAtSize(cur, size) > larghezza && cur.length > 1) {
        let k = cur.length - 1;
        while (k > 1 && font.widthOfTextAtSize(cur.slice(0, k), size) > larghezza) k--;
        out.push(cur.slice(0, k)); cur = cur.slice(k);
      }
    }
    out.push(cur.trimEnd());
  }
  return out;
}

const FONT_TESTO = { helvetica: StandardFonts.Helvetica, times: StandardFonts.TimesRoman, courier: StandardFonts.Courier };

/** PDF da testo semplice con impaginazione automatica. */
export async function pdfDaTesto(testo, { formato = 'A4', font = 'helvetica', dimensione = 11, margine = 20, titolo = 'Testo', numeri = true, onProgress, signal } = {}) {
  const doc = await PDFDocument.create();
  const f = await doc.embedFont(FONT_TESTO[font] || FONT_TESTO.helvetica);
  const [pw, ph] = Array.isArray(formato) ? formato : FORMATI[formato] || FORMATI.A4;
  const size = Math.max(6, Math.min(36, Number(dimensione) || 11));
  const m = mmToPt(Math.max(5, Math.min(50, margine)));
  const inter = size * 1.35;
  const righe = spezzaRighe(testo ?? '', f, size, pw - 2 * m);
  const perPagina = Math.max(1, Math.floor((ph - 2 * m - (numeri ? inter : 0)) / inter));
  const nPag = Math.max(1, Math.ceil(righe.length / perPagina));
  await aBlocchi(nPag, (k) => {
    const page = doc.addPage([pw, ph]);
    righe.slice(k * perPagina, (k + 1) * perPagina).forEach((r, j) => { if (r) page.drawText(r, { x: m, y: ph - m - size - j * inter, size, font: f }); });
    if (numeri && nPag > 1) { const t = `${k + 1} / ${nPag}`; page.drawText(t, { x: (pw - f.widthOfTextAtSize(t, 9)) / 2, y: m / 2, size: 9, font: f }); }
  }, { onProgress, signal, blocco: 20 });
  doc.setTitle(titolo); doc.setCreator('Leggio');
  return doc;
}

export async function pdfVuoto({ formato = 'A4', pagine = 1, orizzontale = false } = {}) {
  const doc = await PDFDocument.create();
  let [w, h] = Array.isArray(formato) ? formato : FORMATI[formato] || FORMATI.A4;
  if (orizzontale) [w, h] = [h, w];
  const n = Math.max(1, Math.min(1000, Math.floor(pagine || 1)));
  for (let i = 0; i < n; i++) doc.addPage([w, h]);
  doc.setCreator('Leggio');
  return doc;
}

/**
 * Unisce file misti (PDF e immagini) in un nuovo documento.
 * voci: [{ nome, tipo:'pdf'|'immagine', bytes?, doc? (PDFDocument già caricato), indici? (0-based), orientamento? }]
 * opts: { segnalibri (uno per file), segnalibriOriginali, formatoImmagini, margineImmagini, onProgress, signal }
 */
export async function unisci(voci, opts = {}) {
  if (!voci?.length) throw new ErroreUtente('Aggiungi almeno un file da unire.');
  const out = await PDFDocument.create();
  const albero = [];
  let fatte = 0;
  const totale = voci.length;
  for (const v of voci) {
    if (opts.signal?.aborted) { const e = new Error('Operazione annullata'); e.name = 'AbortError'; throw e; }
    const inizio = out.getPageCount();
    let figli = [];
    if (v.tipo === 'immagine') {
      await paginaDaImmagine(out, { bytes: v.bytes, nome: v.nome, orientamento: v.orientamento }, { formato: opts.formatoImmagini || 'A4', margine: opts.margineImmagini ?? 10 });
    } else {
      const src = v.doc || await caricaPdf(v.bytes, { nome: v.nome, password: v.password });
      const n = src.getPageCount();
      const indici = v.indici?.length ? v.indici : [...Array(n).keys()];
      const pos = new Map(indici.map((p, k) => [p, k]));
      if (opts.segnalibriOriginali !== false) {
        try { figli = rimappa(leggiSegnalibri(src), (p) => (pos.has(p) ? inizio + pos.get(p) : null)); } catch { figli = []; }
      }
      const copiate = await copiaPagineEsterne(out, src, indici);
      for (const p of copiate) out.addPage(p);
    }
    if (opts.segnalibri !== false) albero.push({ titolo: v.titolo || v.nome?.replace(/\.[a-z0-9]{2,5}$/i, '') || `File ${albero.length + 1}`, pagina: inizio, aperto: false, figli, cambiato: true });
    else albero.push(...figli);
    fatte++; opts.onProgress?.(fatte / totale, v.nome);
    await cedi();
  }
  if (albero.length) scriviSegnalibri(out, albero);
  out.setCreator('Leggio');
  if (opts.titolo) out.setTitle(opts.titolo);
  return out;
}
