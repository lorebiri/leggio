// Esportazione Word (.docx) dai blocchi strutturati delle pagine (logica pura, libreria docx).
import { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, Table, TableRow, TableCell, WidthType, ImageRun, BorderStyle } from 'docx';

function runsDocx(b, extra = {}) {
  const runs = b.runs?.length ? b.runs : [{ text: b.text }];
  return runs.map((r) => new TextRun({ text: String(r.text).replace(/\t/g, ' '), bold: !!r.bold || undefined, italics: !!r.italic || undefined, ...extra }));
}

/** Byte .docx dalle pagine strutturate. pages: [{ blocks, width, height, image? }] */
export async function creaDocx(pages, { title = 'Documento' } = {}) {
  const children = [];
  const first = pages[0] || { width: 595, height: 842 };
  const pageWpx = (first.width - 2 * 56.7) / 72 * 96; // larghezza utile (margini 2 cm) in pixel a 96 dpi
  pages.forEach((pg, pi) => {
    let brk = pi > 0;
    const pb = () => { const v = brk; brk = false; return v; };
    for (const b of pg.blocks) {
      if (b.type === 'heading') {
        const level = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4][Math.min(4, b.level) - 1];
        children.push(new Paragraph({ heading: level, children: runsDocx(b), pageBreakBefore: pb(), alignment: b.align === 'center' ? AlignmentType.CENTER : undefined }));
      } else if (b.type === 'list') {
        children.push(b.ordered
          ? new Paragraph({ children: runsDocx(b), indent: { left: 567, hanging: 283 }, pageBreakBefore: pb() })
          : new Paragraph({ children: runsDocx(b), bullet: { level: 0 }, pageBreakBefore: pb() }));
      } else if (b.type === 'table') {
        if (brk) children.push(new Paragraph({ children: [], pageBreakBefore: pb() }));
        const nc = Math.max(1, ...b.rows.map((r) => r.length));
        const border = { style: BorderStyle.SINGLE, size: 4, color: '999999' };
        children.push(new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: b.rows.map((r, ri) => new TableRow({
            tableHeader: ri === 0,
            children: Array.from({ length: nc }, (_, c) => new TableCell({
              borders: { top: border, bottom: border, left: border, right: border },
              children: [new Paragraph({ children: [new TextRun({ text: r[c] || '', bold: ri === 0 || undefined })] })],
            })),
          })),
        }));
        children.push(new Paragraph({ children: [] }));
      } else {
        children.push(new Paragraph({ children: runsDocx(b), pageBreakBefore: pb(), alignment: b.align === 'center' ? AlignmentType.CENTER : undefined, spacing: { after: 120 } }));
      }
    }
    if (pg.image) {
      const w = Math.min(pageWpx, pg.image.wPx); const h = w * pg.image.hPx / pg.image.wPx;
      children.push(new Paragraph({ pageBreakBefore: pb(), children: [new ImageRun({ type: pg.image.type === 'png' ? 'png' : 'jpg', data: pg.image.data, transformation: { width: Math.round(w), height: Math.round(h) }, altText: { title: `Pagina ${pi + 1}`, description: `Immagine della pagina ${pi + 1}`, name: `pagina${pi + 1}` } })] }));
    }
    if (!pg.blocks.length && !pg.image && brk) children.push(new Paragraph({ children: [], pageBreakBefore: true }));
  });
  const doc = new Document({
    creator: 'Leggio', title, description: 'Convertito da PDF con Leggio',
    styles: { default: { document: { run: { font: 'Calibri', size: 22, language: { value: 'it-IT' } } } } },
    sections: [{ properties: { page: { size: { width: Math.round(first.width * 20), height: Math.round(first.height * 20) }, margin: { top: 1134, bottom: 1134, left: 1134, right: 1134 } } }, children }],
  });
  return new Uint8Array(await Packer.toArrayBuffer(doc));
}

