// Genera i PDF di prova dell'area «conversione» in test/fixtures/conv-*.pdf.
//   node test/conversione-fixtures.mjs              → fixture piccole (committate)
//   node test/conversione-fixtures.mjs --grande DIR → anche una scansione di 300 pagine in DIR (collaudo prestazioni)
// Per le scansioni serve pdftoppm (poppler) per trasformare le pagine in immagini.
import { PDFDocument, StandardFonts, rgb, degrees } from '@cantoo/pdf-lib';
import { writeFileSync, readFileSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const OUT = 'test/fixtures';
const args = process.argv.slice(2);

async function base() {
  const doc = await PDFDocument.create();
  return { doc, font: await doc.embedFont(StandardFonts.Helvetica), bold: await doc.embedFont(StandardFonts.HelveticaBold), it: await doc.embedFont(StandardFonts.HelveticaOblique) };
}

function wrap(text, font, size, width) {
  const words = text.split(' '); const lines = []; let cur = '';
  for (const w of words) { const t = cur ? cur + ' ' + w : w; if (font.widthOfTextAtSize(t, size) > width && cur) { lines.push(cur); cur = w; } else cur = t; }
  if (cur) lines.push(cur);
  return lines;
}

const PARA = [
  'Il presente contratto disciplina la fornitura di materiale di laboratorio da parte del fornitore all’Istituto, secondo le condizioni qui riportate.',
  'Il fornitore si impegna a consegnare la merce entro 30 giorni dalla data di firma del contratto, presso la sede di Sesto Fiorentino.',
  'Il pagamento avverrà mediante bonifico bancario entro 60 giorni dal ricevimento della fattura elettronica, previa verifica di conformità.',
  'Per ogni controversia è competente in via esclusiva il Foro di Firenze. Le parti dichiarano di aver letto e approvato ogni clausola.',
];

// documento "realistico": titolo, paragrafi, elenco, tabella, due colonne
async function documentoTesto(variante = 1) {
  const { doc, font, bold, it } = await base();
  doc.setTitle(variante === 1 ? 'Contratto di fornitura' : 'Contratto di fornitura (rev. 2)');
  let p = doc.addPage([595, 842]);
  p.drawText('Contratto di fornitura n. 2026/118', { x: 60, y: 770, size: 20, font: bold });
  p.drawText('Art. 1 – Oggetto', { x: 60, y: 730, size: 14, font: bold });
  let y = 706;
  const paras = [...PARA];
  if (variante === 2) {
    paras[1] = 'Il fornitore si impegna a consegnare la merce entro 45 giorni lavorativi dalla data di firma del contratto, presso la sede di Sesto Fiorentino.';
    paras.splice(3, 0, 'Eventuali ritardi nella consegna comportano una penale pari allo 0,5% dell’importo per ogni giorno di ritardo.');
  }
  for (const t of paras) {
    for (const line of wrap(t, font, 11, 475)) { p.drawText(line, { x: 60, y, size: 11, font }); y -= 15; }
    y -= 9;
  }
  p.drawText('Documenti allegati:', { x: 60, y, size: 11, font: it }); y -= 17;
  for (const t of ['• Capitolato tecnico', '• Offerta economica', '• DURC in corso di validità']) { p.drawText(t, { x: 72, y, size: 11, font }); y -= 15; }
  y -= 14;
  p.drawText('Art. 2 – Prezzi', { x: 60, y, size: 14, font: bold }); y -= 24;
  const rows = [['Articolo', 'Quantità', 'Prezzo unitario', 'Totale'], ['Provette 50 ml', '200', '0,45 €', '90,00 €'], ['Pipette tarate', '12', '18,90 €', '226,80 €'], ['Guanti nitrile', '1.000', '0,08 €', variante === 1 ? '80,00 €' : '85,00 €'], ['Totale', '', '', variante === 1 ? '396,80 €' : '401,80 €']];
  const xs = [60, 230, 330, 460];
  for (const r of rows) { r.forEach((c, k) => p.drawText(c, { x: xs[k], y, size: 11, font: r === rows[0] || r === rows[rows.length - 1] ? bold : font })); y -= 17; }
  // pagina 2: due colonne
  p = doc.addPage([595, 842]);
  p.drawText('Art. 3 – Condizioni generali', { x: 60, y: 770, size: 14, font: bold });
  const colText = 'Le condizioni generali si applicano a tutti gli ordini emessi dall’Istituto. Il fornitore garantisce che i prodotti sono conformi alle norme vigenti e privi di difetti. In caso di non conformità, l’Istituto può rifiutare la merce entro quindici giorni dalla consegna, dandone comunicazione scritta tramite posta elettronica certificata. Le spese di restituzione sono a carico del fornitore. ';
  const col = wrap(colText.repeat(3), font, 10.5, 220);
  const half = Math.ceil(col.length / 2);
  col.forEach((line, i) => p.drawText(line, { x: i < half ? 60 : 315, y: 740 - (i % half) * 14, size: 10.5, font }));
  return doc;
}

function rasterizza(pdfBytes, dpi = 150) {
  const dir = mkdtempSync(join(tmpdir(), 'leggio-conv-'));
  writeFileSync(join(dir, 'in.pdf'), pdfBytes);
  execFileSync('pdftoppm', ['-r', String(dpi), '-gray', '-jpeg', '-jpegopt', 'quality=80', join(dir, 'in.pdf'), join(dir, 'p')]);
  const files = readdirSync(dir).filter((f) => f.endsWith('.jpg')).sort();
  const out = files.map((f) => readFileSync(join(dir, f)));
  rmSync(dir, { recursive: true, force: true });
  return out;
}

async function scansione(jpgs, { ruota = 0 } = {}) {
  const doc = await PDFDocument.create();
  for (const j of jpgs) {
    const img = await doc.embedJpg(j);
    const p = doc.addPage([595, 842]);
    if (ruota) {
      // leggera inclinazione, come un foglio messo storto nello scanner
      p.drawImage(img, { x: 20, y: -10, width: 595, height: 842, rotate: degrees(ruota) });
    } else p.drawImage(img, { x: 0, y: 0, width: 595, height: 842 });
  }
  return doc.save();
}

const v1 = await documentoTesto(1);
const v2 = await documentoTesto(2);
const b1 = await v1.save(); const b2 = await v2.save();
writeFileSync(`${OUT}/conv-contratto-v1.pdf`, b1);
writeFileSync(`${OUT}/conv-contratto-v2.pdf`, b2);
const jpgs = rasterizza(b1, 150);
writeFileSync(`${OUT}/conv-scansione.pdf`, await scansione(jpgs));
writeFileSync(`${OUT}/conv-scansione-storta.pdf`, await scansione(jpgs.slice(0, 1), { ruota: 2 }));
// scansione della versione 2 (per il confronto tra scansioni)
writeFileSync(`${OUT}/conv-scansione-v2.pdf`, await scansione(rasterizza(b2, 150)));
console.log('fixture conversione create');

const gi = args.indexOf('--grande');
if (gi >= 0) {
  const dir = args[gi + 1] || OUT;
  const doc = await PDFDocument.create();
  const imgs = await Promise.all(jpgs.map((j) => doc.embedJpg(j)));
  for (let i = 0; i < 300; i++) doc.addPage([595, 842]).drawImage(imgs[i % imgs.length], { x: 0, y: 0, width: 595, height: 842 });
  writeFileSync(join(dir, 'conv-scansione-300.pdf'), await doc.save());
  console.log('scansione di 300 pagine creata in', dir);
}
