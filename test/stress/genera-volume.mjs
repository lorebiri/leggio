// Profilo di volume: 200 PDF «da ufficio» di dimensioni varie (1–40 pagine, testo, alcuni con immagini).
// Uso: node test/stress/genera-volume.mjs [cartella]  (predefinita: leggio-out/robustezza/stress/volume)
import { PDFDocument, StandardFonts, rgb } from '@cantoo/pdf-lib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
const dir = resolve(process.argv[2] || join(homedir(), 'Developer/leggio-out/robustezza/stress/volume'));
mkdirSync(dir, { recursive: true });
let s = 7; const r = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
let tot = 0;
for (let i = 1; i <= 200; i++) {
  const d = await PDFDocument.create(); const f = await d.embedFont(StandardFonts.Helvetica);
  const n = 1 + Math.floor(r() * 40);
  for (let p = 0; p < n; p++) {
    const pg = d.addPage([595, 842]);
    pg.drawText(`Pratica ${i} — pagina ${p + 1} di ${n}`, { x: 50, y: 790, size: 16, font: f });
    for (let k = 0; k < 25; k++) pg.drawText(`Riga ${k + 1}: determina, impegno di spesa, CIG ${String(i * 1000 + k).padStart(8, '0')}`, { x: 50, y: 750 - k * 24, size: 10, font: f });
    if (i % 10 === 0 && p === 0) { // una «scansione» ogni 10 file
      const W = 600, H = 800; const px = new Uint8Array(W * H * 3); for (let k = 0; k < px.length; k++) px[k] = 200 + Math.floor(r() * 55);
      const ref = d.context.register(d.context.stream(px, { Type: 'XObject', Subtype: 'Image', Width: W, Height: H, ColorSpace: 'DeviceRGB', BitsPerComponent: 8 }));
      const name = pg.node.newXObject('Im', ref);
      const { pushGraphicsState, popGraphicsState, concatTransformationMatrix, drawObject } = await import('@cantoo/pdf-lib');
      pg.pushOperators(pushGraphicsState(), concatTransformationMatrix(300, 0, 0, 400, 250, 100), drawObject(name), popGraphicsState());
    }
    pg.drawRectangle({ x: 50, y: 60, width: 495, height: 6, color: rgb(0.06, 0.46, 0.43) });
  }
  const b = await d.save();
  tot += b.length;
  writeFileSync(join(dir, `pratica-${String(i).padStart(3, '0')}.pdf`), b);
}
console.log(`200 PDF in ${dir}, ${(tot / 1048576).toFixed(1)} MB in tutto`);
