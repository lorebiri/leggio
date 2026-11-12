// Dichiarazione di conformità all'originale: il TESTO è quello fornito dall'ufficio (Leggio non lo inventa);
// qui si compongono i segnaposto e si impagina il riquadro con pdf-lib. Logica pura.
import { testoSicuro, dimensioniVisive, visivoAPagina } from './protocollo.js';

export const SEGNAPOSTO = [
  ['{nome}', 'nome e cognome di chi attesta'], ['{qualifica}', 'qualifica'], ['{data}', 'data'], ['{luogo}', 'luogo'],
  ['{pagine}', 'numero di pagine del documento'], ['{file}', 'nome del file'], ['{ente}', 'ente o ufficio'],
];

export function componi(testo, v) {
  return String(testo || '').replace(/\{(nome|qualifica|data|luogo|pagine|file|ente)\}/g, (_, k) => (v[k] != null && v[k] !== '' ? String(v[k]) : `{${k}}`));
}

/** Segnaposto rimasti senza valore (da segnalare prima di applicare). */
export function mancanti(testo) { return [...new Set((String(testo).match(/\{(nome|qualifica|data|luogo|pagine|file|ente)\}/g) || []))]; }

export function aCapo(font, size, testo, larghezza) {
  const righe = [];
  for (const par of testoSicuro(font, testo).split(/\r?\n/)) {
    let riga = '';
    for (const w of par.split(/\s+/).filter(Boolean)) {
      const prova = riga ? riga + ' ' + w : w;
      if (font.widthOfTextAtSize(prova, size) <= larghezza || !riga) riga = prova; else { righe.push(riga); riga = w; }
    }
    righe.push(riga);
  }
  return righe;
}

/**
 * o: { testo (già composto), firmatario, qualifica, luogoData, dove: 'pagina' | 'calce-ultima' | 'calce-prima', spazioFirma }
 * → { pagina (1-based), aggiunta (bool) }
 */
export async function applicaConformita(pdfDoc, PDFLib, o) {
  const reg = await pdfDoc.embedFont(PDFLib.StandardFonts.Helvetica);
  const bold = await pdfDoc.embedFont(PDFLib.StandardFonts.HelveticaBold);
  const ink = PDFLib.rgb(0.08, 0.08, 0.1);
  const pages = pdfDoc.getPages();
  if (!pages.length) throw new Error('Il documento non ha pagine.');
  const firmaRighe = [o.luogoData, o.firmatario, o.qualifica].filter((x) => x && String(x).trim());
  if (o.dove === 'pagina') {
    const ref = pages[pages.length - 1].getSize();
    const portrait = ref.width <= ref.height ? [ref.width, ref.height] : [595.28, 841.89];
    const p = pdfDoc.addPage(portrait);
    const M = 64; const W = p.getWidth() - 2 * M;
    let y = p.getHeight() - M;
    const size = 11.5;
    for (const r of aCapo(reg, size, o.testo, W)) { y -= size * 1.5; if (y < M + 120) break; p.drawText(r, { x: M, y, size, font: reg, color: ink }); }
    y -= 36;
    const xF = M + W / 2;
    for (const [i, r] of firmaRighe.entries()) { y -= 16; p.drawText(testoSicuro(i === 1 ? bold : reg, r), { x: xF, y, size: 11, font: i === 1 ? bold : reg, color: ink }); }
    if (o.spazioFirma) { y -= 40; p.drawLine({ start: { x: xF, y }, end: { x: xF + W / 2 - 10, y }, thickness: 0.8, color: ink }); p.drawText('Firma', { x: xF, y: y - 12, size: 8.5, font: reg, color: PDFLib.rgb(0.4, 0.4, 0.45) }); }
    return { pagina: pdfDoc.getPageCount(), aggiunta: true };
  }
  // in calce: riquadro nella parte bassa della pagina, con sfondo bianco
  const idx = o.dove === 'calce-prima' ? 0 : pages.length - 1;
  const p = pages[idx];
  const { w: PW } = dimensioniVisive(p);
  const M = 28; const W = PW - 2 * M; const size = 9; const pad = 7;
  const righe = aCapo(reg, size, o.testo, W - 2 * pad);
  const altezza = righe.length * size * 1.35 + firmaRighe.length * 12 + (o.spazioFirma ? 26 : 0) + pad * 2 + 6;
  const maxH = dimensioniVisive(p).h * 0.4;
  if (altezza > maxH) throw new Error('Il testo è troppo lungo per stare in calce alla pagina: scegli «Su una pagina aggiunta in fondo».');
  const rot = PDFLib.degrees(visivoAPagina(p, 0, 0).rot);
  const a = visivoAPagina(p, M, M);
  p.drawRectangle({ x: a.x, y: a.y, width: W, height: altezza, rotate: rot, color: PDFLib.rgb(1, 1, 1), opacity: 0.95, borderColor: ink, borderWidth: 0.6 });
  let v = M + altezza - pad;
  for (const r of righe) { v -= size * 1.35; const q = visivoAPagina(p, M + pad, v); p.drawText(r, { x: q.x, y: q.y, size, font: reg, color: ink, rotate: rot }); }
  v -= 6;
  for (const [i, r] of firmaRighe.entries()) { v -= 12; const q = visivoAPagina(p, M + W / 2, v); p.drawText(testoSicuro(i === 1 ? bold : reg, r), { x: q.x, y: q.y, size: 9, font: i === 1 ? bold : reg, color: ink, rotate: rot }); }
  if (o.spazioFirma) {
    const s0 = visivoAPagina(p, M + W / 2, v - 20); const s1 = visivoAPagina(p, M + W - pad, v - 20);
    p.drawLine({ start: { x: s0.x, y: s0.y }, end: { x: s1.x, y: s1.y }, thickness: 0.6, color: ink });
  }
  return { pagina: idx + 1, aggiunta: false };
}
