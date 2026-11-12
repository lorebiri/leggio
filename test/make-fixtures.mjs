// Genera PDF di prova in test/fixtures (multi-pagina, con modulo, con segnalibri).
import { PDFDocument, StandardFonts, rgb } from '@cantoo/pdf-lib';
import { writeFileSync } from 'node:fs';
const doc = await PDFDocument.create();
const font = await doc.embedFont(StandardFonts.Helvetica);
const bold = await doc.embedFont(StandardFonts.HelveticaBold);
for (let i = 1; i <= 6; i++) {
  const p = doc.addPage([595, 842]);
  p.drawText(`Pagina ${i} — Documento di prova Leggio`, { x: 50, y: 780, size: 20, font: bold });
  const lorem = 'Il PDF è un formato pensato per conservare l\'aspetto dei documenti. Questa riga serve a provare selezione, ricerca, evidenziazione e OCR.';
  for (let r = 0; r < 18; r++) p.drawText(`${r + 1}. ${lorem.slice(0, 80)}`, { x: 50, y: 740 - r * 22, size: 11, font });
  p.drawRectangle({ x: 50, y: 250, width: 200, height: 60, color: rgb(0.06, 0.46, 0.43) });
}
const form = doc.getForm();
const p1 = doc.getPage(0);
const name = form.createTextField('nome'); name.addToPage(p1, { x: 300, y: 250, width: 220, height: 24 });
const ok = form.createCheckBox('accetto'); ok.addToPage(p1, { x: 300, y: 215, width: 18, height: 18 });
doc.setTitle('Documento di prova'); doc.setAuthor('Leggio');
writeFileSync('test/fixtures/prova.pdf', await doc.save());
const two = await PDFDocument.create();
for (let i = 1; i <= 2; i++) two.addPage([595, 842]).drawText(`Secondo file, pagina ${i}`, { x: 50, y: 780, size: 20, font: await two.embedFont(StandardFonts.Helvetica) });
writeFileSync('test/fixtures/secondo.pdf', await two.save());
console.log('fixture create');
