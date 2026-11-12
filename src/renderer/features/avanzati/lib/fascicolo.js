// Fascicolo con indice: unisce più PDF, aggiunge una o più pagine indice con voci cliccabili, i segnalibri
// (un segnalibro per documento) e, a scelta, l'etichetta «Allegato n. k» e la numerazione delle pagine.
// Logica pura su pdf-lib (riceve PDFLib). Usata anche dal «Pacchetto per la rendicontazione».
import { testoSicuro, visivoAPagina, dimensioniVisive } from './protocollo.js';
import { aCapo } from './conformita.js';

const A4 = [595.28, 841.89];
const RIGHE_PER_PAGINA = 30;

/** Quante pagine servono per l'indice. */
export function pagineIndice(n, conTitolo = true) { return Math.max(1, Math.ceil((n + (conTitolo ? 4 : 0)) / RIGHE_PER_PAGINA)); }

/**
 * docs: [{ titolo, bytes, password? }]
 * o: { titolo, sottotitolo, indice (bool), segnalibri (bool), etichetta: 'Allegato' | '' , numeriPagina (bool), signal, onProgress }
 * → { pdfDoc, voci: [{ titolo, pagina, pagine }], saltati: [{ titolo, motivo }] }
 */
export async function creaFascicolo(PDFLib, docs, o = {}) {
  const { PDFDocument, PDFName, PDFNumber, PDFString, PDFHexString, StandardFonts, rgb } = PDFLib;
  const out = await PDFDocument.create();
  const reg = await out.embedFont(StandardFonts.Helvetica);
  const bold = await out.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(0.1, 0.11, 0.13); const muted = rgb(0.4, 0.43, 0.47); const accent = rgb(0.06, 0.46, 0.43);
  // 1) carica i documenti (quelli illeggibili vengono saltati, non fermano il fascicolo)
  const caricati = []; const saltati = [];
  for (const [i, d] of docs.entries()) {
    if (o.signal?.aborted) throw new DOMException('Annullato', 'AbortError');
    o.onProgress?.(i / docs.length * 0.5, `Lettura di ${d.titolo}`);
    try {
      const src = await PDFDocument.load(d.bytes, { password: d.password || undefined, ignoreEncryption: !d.password, updateMetadata: false });
      if (src.isEncrypted && !d.password) throw new Error('è protetto da password');
      if (!src.getPageCount()) throw new Error('non ha pagine');
      caricati.push({ ...d, src });
    } catch (e) { saltati.push({ titolo: d.titolo, motivo: /encrypt|password|protetto/i.test(e?.message || '') ? 'protetto da password' : (e?.message?.startsWith('non ') ? e.message : 'non è un PDF leggibile') }); }
  }
  if (!caricati.length) throw new Error('Nessuno dei documenti è leggibile.');
  const nIndice = o.indice === false ? 0 : pagineIndice(caricati.length, true);
  const indexPages = [];
  for (let k = 0; k < nIndice; k++) indexPages.push(out.addPage(A4));
  // 2) copia le pagine
  const voci = [];
  for (const [i, d] of caricati.entries()) {
    if (o.signal?.aborted) throw new DOMException('Annullato', 'AbortError');
    o.onProgress?.(0.5 + i / caricati.length * 0.45, `Unione di ${d.titolo}`);
    const pages = await out.copyPages(d.src, d.src.getPageIndices());
    const first = out.getPageCount();
    pages.forEach((p) => out.addPage(p));
    voci.push({ titolo: d.titolo, pagina: first + 1, pagine: pages.length, ref: pages[0].ref, n: i + 1, pageObj: pages[0] });
  }
  // 3) etichetta «Allegato n. k» sulla prima pagina di ogni documento
  if (o.etichetta) {
    for (const v of voci) {
      const p = v.pageObj; const { w: PW, h: PH } = dimensioniVisive(p);
      const t = testoSicuro(bold, `${o.etichetta} n. ${v.n}`); const size = 10; const w = bold.widthOfTextAtSize(t, size) + 12;
      const a = visivoAPagina(p, PW - w - 14, PH - 30);
      p.drawRectangle({ x: a.x, y: a.y, width: w, height: 18, rotate: PDFLib.degrees(a.rot), color: rgb(1, 1, 1), borderColor: accent, borderWidth: 1 });
      const q = visivoAPagina(p, PW - w - 8, PH - 25);
      p.drawText(t, { x: q.x, y: q.y, size, font: bold, color: accent, rotate: PDFLib.degrees(a.rot) });
    }
  }
  // 4) pagine indice con collegamenti
  if (nIndice) {
    let pi = 0; let page = indexPages[0]; let y = A4[1] - 64;
    const M = 56; const W = A4[0] - 2 * M;
    const newPage = () => { pi++; page = indexPages[pi]; y = A4[1] - 64; };
    page.drawText(testoSicuro(bold, o.titolo || 'Fascicolo'), { x: M, y, size: 18, font: bold, color: ink }); y -= 22;
    if (o.sottotitolo) { for (const r of aCapo(reg, 10.5, o.sottotitolo, W).slice(0, 2)) { page.drawText(r, { x: M, y, size: 10.5, font: reg, color: muted }); y -= 14; } }
    y -= 10;
    page.drawText('Indice dei documenti', { x: M, y, size: 12, font: bold, color: accent }); y -= 8;
    page.drawLine({ start: { x: M, y }, end: { x: M + W, y }, thickness: 1, color: accent }); y -= 6;
    const ctx = out.context;
    for (const v of voci) {
      if (y < 70) newPage();
      y -= 20;
      const num = `${v.n}.`; const pag = `pag. ${v.pagina}`;
      const maxTitolo = W - 70 - reg.widthOfTextAtSize(pag, 10.5);
      let titolo = testoSicuro(reg, v.titolo);
      while (reg.widthOfTextAtSize(titolo, 10.5) > maxTitolo && titolo.length > 4) titolo = titolo.slice(0, -2);
      if (titolo !== testoSicuro(reg, v.titolo)) titolo = titolo.replace(/.$/, '…');
      page.drawText(num, { x: M, y, size: 10.5, font: bold, color: ink });
      page.drawText(titolo, { x: M + 26, y, size: 10.5, font: reg, color: ink });
      page.drawText(pag, { x: M + W - reg.widthOfTextAtSize(pag, 10.5), y, size: 10.5, font: reg, color: muted });
      page.drawText(`${v.pagine} ${v.pagine === 1 ? 'pagina' : 'pagine'}`, { x: M + 26, y: y - 10, size: 7.5, font: reg, color: muted });
      // voce cliccabile → prima pagina del documento
      const link = ctx.obj({ Type: 'Annot', Subtype: 'Link', Rect: [M, y - 12, M + W, y + 13], Border: [0, 0, 0], Dest: [v.ref, PDFName.of('XYZ'), PDFLib.PDFNull, PDFLib.PDFNull, PDFLib.PDFNull] });
      const annots = page.node.lookup(PDFName.of('Annots'));
      if (annots) annots.push(ctx.register(link)); else page.node.set(PDFName.of('Annots'), ctx.obj([ctx.register(link)]));
    }
    indexPages.forEach((p, k) => p.drawText(`Indice — pagina ${k + 1} di ${nIndice}`, { x: M, y: 30, size: 8, font: reg, color: muted }));
  }
  // 5) segnalibri
  if (o.segnalibri !== false) {
    const ctx = out.context;
    const outlinesRef = ctx.nextRef();
    const items = [];
    if (nIndice) items.push({ title: 'Indice', ref: indexPages[0].ref });
    for (const v of voci) items.push({ title: `${v.n}. ${v.titolo}`, ref: v.ref });
    const refs = items.map(() => ctx.nextRef());
    items.forEach((it, i) => {
      ctx.assign(refs[i], ctx.obj({
        Title: PDFHexString.fromText(it.title.slice(0, 200)), Parent: outlinesRef,
        ...(i > 0 ? { Prev: refs[i - 1] } : {}), ...(i < items.length - 1 ? { Next: refs[i + 1] } : {}),
        Dest: [it.ref, PDFName.of('XYZ'), PDFLib.PDFNull, PDFLib.PDFNull, PDFLib.PDFNull],
      }));
    });
    ctx.assign(outlinesRef, ctx.obj({ Type: 'Outlines', First: refs[0], Last: refs[refs.length - 1], Count: PDFNumber.of(items.length) }));
    out.catalog.set(PDFName.of('Outlines'), outlinesRef);
    out.catalog.set(PDFName.of('PageMode'), PDFName.of('UseOutlines'));
  }
  // 6) numeri di pagina
  if (o.numeriPagina) {
    const tot = out.getPageCount();
    out.getPages().forEach((p, i) => {
      const t = `Pagina ${i + 1} di ${tot}`; const { w: PW } = dimensioniVisive(p);
      const a = visivoAPagina(p, (PW - reg.widthOfTextAtSize(t, 8.5)) / 2, 14);
      p.drawText(t, { x: a.x, y: a.y, size: 8.5, font: reg, color: muted, rotate: PDFLib.degrees(a.rot) });
    });
  }
  out.setTitle(o.titolo || 'Fascicolo', { showInWindowTitleBar: true });
  out.setLanguage('it-IT');
  out.setCreator('Leggio');
  void PDFString;
  o.onProgress?.(1, 'Fatto');
  return { pdfDoc: out, voci: voci.map(({ titolo, pagina, pagine, n }) => ({ titolo, pagina, pagine, n })), saltati };
}
