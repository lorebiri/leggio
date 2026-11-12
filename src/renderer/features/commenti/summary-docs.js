// Area «commenti» — riepilogo dei commenti come documento Word (.docx) o PDF, ordinato per pagina.
// Nessun DOM: collaudabile in node.
import { Document, Packer, Paragraph, TextRun, HeadingLevel } from 'docx';
import { PDFDocument, StandardFonts, rgb } from '@cantoo/pdf-lib';
import { STATE_LABELS } from './annots.js';
import { wrapText, fmtDate, hexToRgb } from './geom.js';
import { safeText } from './appearance.js';

const stText = (t) => (t.status ? STATE_LABELS[t.status] || t.status : '');

/** → Uint8Array del .docx */
export async function summaryDocx(threads, { docName = '' } = {}) {
  const children = [
    new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun('Riepilogo commenti')] }),
    new Paragraph({ children: [new TextRun({ text: `${docName} · ${threads.length} commenti · ${fmtDate(new Date())}`, color: '555555' })] }),
  ];
  let page = -1, n = 0;
  for (const t of threads) {
    if (t.pageIndex !== page) { page = t.pageIndex; children.push(new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun(`Pagina ${page + 1}`)] })); }
    n++;
    const st = stText(t);
    children.push(new Paragraph({ spacing: { before: 160 }, children: [
      new TextRun({ text: `${n}. ${t.label}`, bold: true }),
      new TextRun({ text: ` — ${t.author || 'Senza autore'}${t.dateText ? ', ' + t.dateText : ''}`, color: '555555' }),
      ...(st ? [new TextRun({ text: `  [${st}]`, bold: true, color: '0C5F58' })] : []),
    ] }));
    if (t.text) for (const l of t.text.split(/\r?\n/)) children.push(new Paragraph({ indent: { left: 360 }, children: [new TextRun(l)] }));
    for (const r of t.allReplies) {
      children.push(new Paragraph({ indent: { left: 720 }, children: [new TextRun({ text: `${r.author || 'Risposta'}${r.dateText ? ' (' + r.dateText + ')' : ''}: `, italics: true, color: '555555' }), new TextRun(r.text)] }));
    }
  }
  if (!threads.length) children.push(new Paragraph('Nessun commento.'));
  const doc = new Document({ creator: 'Leggio', title: `Riepilogo commenti — ${docName}`, sections: [{ children }] });
  return new Uint8Array(await Packer.toArrayBuffer(doc));
}

/** → Uint8Array del PDF di riepilogo (A4, testo selezionabile). */
export async function summaryPdf(threads, { docName = '' } = {}) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const W = 595, H = 842, M = 50, maxW = W - 2 * M;
  let page = pdf.addPage([W, H]); let y = H - M;
  const ensure = (h) => { if (y - h < M) { page = pdf.addPage([W, H]); y = H - M; } };
  const write = (str, { f = font, size = 10.5, color = rgb(0.1, 0.1, 0.12), indent = 0, gap = 1.35 } = {}) => {
    const s = safeText(f, str);
    for (const line of wrapText(s, maxW - indent, (x) => f.widthOfTextAtSize(x, size))) {
      ensure(size * gap);
      page.drawText(line, { x: M + indent, y: y - size, size, font: f, color });
      y -= size * gap;
    }
  };
  write('Riepilogo commenti', { f: bold, size: 20 });
  write(`${docName} · ${threads.length} commenti · ${fmtDate(new Date())}`, { color: rgb(0.35, 0.35, 0.38) });
  y -= 8;
  let pg = -1, n = 0;
  for (const t of threads) {
    if (t.pageIndex !== pg) { pg = t.pageIndex; y -= 10; ensure(30); write(`Pagina ${pg + 1}`, { f: bold, size: 14, color: rgb(0.06, 0.46, 0.43) }); y -= 2; }
    n++;
    y -= 4; ensure(28);
    const [r, g, b] = hexToRgb(t.color || '#999999');
    page.drawCircle({ x: M + 4, y: y - 6, size: 4, color: rgb(r, g, b), borderColor: rgb(0.5, 0.5, 0.5), borderWidth: 0.3 });
    const st = stText(t);
    write(`${n}. ${t.label} — ${t.author || 'Senza autore'}${t.dateText ? ', ' + t.dateText : ''}${st ? '  [' + st + ']' : ''}`, { f: bold, size: 10.5, indent: 14 });
    if (t.text) write(t.text, { indent: 14 });
    for (const rep of t.allReplies) write(`${rep.author || 'Risposta'}${rep.dateText ? ' (' + rep.dateText + ')' : ''}: ${rep.text}`, { indent: 32, size: 10, color: rgb(0.3, 0.3, 0.33) });
  }
  if (!threads.length) write('Nessun commento.');
  pdf.setTitle(`Riepilogo commenti — ${docName}`); pdf.setCreator('Leggio');
  return pdf.save();
}
