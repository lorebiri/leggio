// Banco di prova di carico: genera PDF grandi e "estremi" con pdf-lib.
// Uso: node test/stress/genera.mjs [cartella] [--solo nome1,nome2] [--senza-300mb]
// Cartella predefinita: $LEGGIO_STRESS_DIR oppure ../leggio-out/robustezza/stress (fuori dal repo:
// i file arrivano a centinaia di MB e NON vanno committati). Cancellarli a fine prova.
import { PDFDocument, StandardFonts, rgb, PDFName, PDFString, PDFNumber, PDFArray, PDFDict, pushGraphicsState, popGraphicsState, concatTransformationMatrix, drawObject } from '@cantoo/pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { mkdirSync, writeFileSync, existsSync, readFileSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { homedir } from 'node:os';

const args = process.argv.slice(2);
const outDir = resolve(args.find((a) => !a.startsWith('--')) || process.env.LEGGIO_STRESS_DIR || join(homedir(), 'Developer/leggio-out/robustezza/stress'));
const only = (args.find((a) => a.startsWith('--solo=')) || '').slice(7).split(',').filter(Boolean);
const skip300 = args.includes('--senza-300mb');
mkdirSync(outDir, { recursive: true });

const MB = 1024 * 1024;
function rng(seed) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }
const LOREM = 'Il PDF è un formato pensato per conservare l\'aspetto dei documenti su qualunque computer. Questa riga serve a misurare testo, ricerca e rendering.';

async function save(name, doc, opts) {
  const t0 = performance.now();
  const bytes = await doc.save({ useObjectStreams: true, ...opts });
  const p = join(outDir, name);
  writeFileSync(p, bytes);
  console.log(`  ${name}: ${(bytes.length / MB).toFixed(1)} MB, ${doc.getPageCount()} pagine (salvato in ${Math.round(performance.now() - t0)} ms)`);
}

function textPages(doc, font, n, label) {
  for (let i = 1; i <= n; i++) {
    const p = doc.addPage([595, 842]);
    p.drawText(`${label} — pagina ${i} di ${n}`, { x: 50, y: 790, size: 16, font });
    for (let r = 0; r < 30; r++) p.drawText(`${r + 1}. ${LOREM.slice(0, 85)}`, { x: 50, y: 750 - r * 22, size: 10, font });
    p.drawRectangle({ x: 50, y: 60, width: 495 * (i / n), height: 8, color: rgb(0.06, 0.46, 0.43) });
  }
}

const GEN = {
  async 'pagine-1000.pdf'() {
    const d = await PDFDocument.create(); const f = await d.embedFont(StandardFonts.Helvetica);
    textPages(d, f, 1000, '1000 pagine'); await save('pagine-1000.pdf', d);
  },
  async 'pagine-5000.pdf'() {
    const d = await PDFDocument.create(); const f = await d.embedFont(StandardFonts.Helvetica);
    textPages(d, f, 5000, '5000 pagine'); await save('pagine-5000.pdf', d);
  },
  async 'immagini-300mb.pdf'() {
    if (skip300) return;
    // immagini RGB non compresse con rumore (non comprimibili): ~6 MB ciascuna, 50 pagine ≈ 300 MB
    const d = await PDFDocument.create(); const f = await d.embedFont(StandardFonts.Helvetica);
    const W = 1500, H = 1400; const r = rng(42);
    for (let i = 0; i < 50; i++) {
      const px = new Uint8Array(W * H * 3);
      // gradiente + rumore: visibile e non comprimibile
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const k = (y * W + x) * 3; const n = (r() * 60) | 0; px[k] = (x * 255 / W + n) & 255; px[k + 1] = (y * 255 / H + n) & 255; px[k + 2] = ((i * 5) + n) & 255; }
      const stream = d.context.stream(px, { Type: 'XObject', Subtype: 'Image', Width: W, Height: H, ColorSpace: 'DeviceRGB', BitsPerComponent: 8 });
      const ref = d.context.register(stream);
      const page = d.addPage([595, 842]);
      const name = page.node.newXObject('Im', ref);
      page.pushOperators(pushGraphicsState(), concatTransformationMatrix(535, 0, 0, 500, 30, 300), drawObject(name), popGraphicsState());
      page.drawText(`Immagine ${i + 1} di 50 (${W}×${H} px, ${(W * H * 3 / MB).toFixed(1)} MB)`, { x: 30, y: 260, size: 14, font: f });
    }
    await save('immagini-300mb.pdf', d, { useObjectStreams: false });
  },
  async 'pagine-giganti.pdf'() {
    const d = await PDFDocument.create(); const f = await d.embedFont(StandardFonts.Helvetica);
    const a0 = d.addPage([2384, 3370]); // A0 in punti
    a0.drawText('A0 (841 × 1189 mm)', { x: 100, y: 3200, size: 120, font: f });
    for (let k = 0; k < 400; k++) a0.drawCircle({ x: 200 + (k % 20) * 100, y: 300 + Math.floor(k / 20) * 140, size: 40, borderColor: rgb(0.1, 0.3, 0.6), borderWidth: 3 });
    const long = d.addPage([595, 14173]); // 5 metri (limite pratico PDF: 14400 pt)
    long.drawText('Pagina lunga 5 m', { x: 50, y: 14050, size: 40, font: f });
    for (let y = 100; y < 14000; y += 50) long.drawText(`${(y / 72 * 2.54).toFixed(0)} cm — ${LOREM.slice(0, 60)}`, { x: 40, y, size: 12, font: f });
    const wide = d.addPage([14173, 595]);
    wide.drawText('Pagina larga 5 m', { x: 50, y: 500, size: 60, font: f });
    await save('pagine-giganti.pdf', d);
  },
  async 'annotazioni-campi.pdf'() {
    const d = await PDFDocument.create(); const f = await d.embedFont(StandardFonts.Helvetica);
    const form = d.getForm();
    const PAGES = 50;
    for (let i = 0; i < PAGES; i++) {
      const p = d.addPage([595, 842]);
      p.drawText(`Pagina ${i + 1}: 100 annotazioni e 40 campi`, { x: 40, y: 810, size: 12, font: f });
      const annots = [];
      for (let k = 0; k < 100; k++) {
        const x = 30 + (k % 10) * 54, y = 600 + Math.floor(k / 10) * 18;
        annots.push(d.context.register(d.context.obj({ Type: 'Annot', Subtype: 'Text', Rect: [x, y, x + 14, y + 14], Contents: PDFString.of(`Nota ${i + 1}.${k + 1}`), T: PDFString.of('Prova'), C: [1, 0.8, 0], Name: 'Comment' })));
      }
      p.node.set(PDFName.of('Annots'), d.context.obj(annots));
      for (let k = 0; k < 40; k++) {
        const x = 30 + (k % 4) * 135, y = 80 + Math.floor(k / 4) * 48;
        if (k % 5 === 4) form.createCheckBox(`c${i}_${k}`).addToPage(p, { x, y, width: 16, height: 16 });
        else { const t = form.createTextField(`t${i}_${k}`); t.setText(`valore ${k}`); t.addToPage(p, { x, y, width: 120, height: 20, font: f }); }
      }
    }
    await save('annotazioni-campi.pdf', d);
  },
  async 'font-molti-glifi.pdf'() {
    const fontPath = ['/Library/Fonts/Arial Unicode.ttf', '/System/Library/Fonts/Supplemental/Arial Unicode.ttf', 'C:/Windows/Fonts/arialuni.ttf'].find((p) => existsSync(p));
    if (!fontPath) { console.log('  font-molti-glifi.pdf: saltato (nessun font Unicode grande disponibile)'); return; }
    const d = await PDFDocument.create(); d.registerFontkit(fontkit);
    const font = await d.embedFont(readFileSync(fontPath), { subset: false });
    const ranges = [[0x20, 0x7e], [0xa0, 0x24f], [0x370, 0x3ff], [0x400, 0x4ff], [0x590, 0x5ff], [0x600, 0x6ff], [0x2000, 0x22ff], [0x3040, 0x30ff], [0x4e00, 0x5fff]];
    const chars = [];
    for (const [a, b] of ranges) for (let c = a; c <= b; c++) if (font.embedder?.font?.hasGlyphForCodePoint?.(c) ?? true) chars.push(String.fromCodePoint(c));
    const perPage = 60 * 40; let page = null; let n = 0;
    for (let i = 0; i < chars.length; i += 60) {
      if (n % 40 === 0) page = d.addPage([595, 842]);
      try { page.drawText(chars.slice(i, i + 60).join(''), { x: 20, y: 810 - (n % 40) * 20, size: 8.5, font }); } catch { /* glifo assente */ }
      n++;
    }
    console.log(`  (${chars.length} caratteri distinti, ${Math.ceil(chars.length / perPage)} pagine, font intero non ridotto)`);
    await save('font-molti-glifi.pdf', d);
  },
  async 'segnalibri-profondi.pdf'() {
    const d = await PDFDocument.create(); const f = await d.embedFont(StandardFonts.Helvetica);
    textPages(d, f, 200, 'Segnalibri');
    const ctx = d.context; const pages = d.getPages();
    // catena profonda 300 livelli + 3000 voci piatte
    const mk = (title, pageIdx) => ctx.obj({ Title: PDFString.of(title), Dest: [pages[pageIdx].ref, PDFName.of('XYZ'), null, null, null] });
    const root = ctx.obj({ Type: 'Outlines' }); const rootRef = ctx.register(root);
    const topItems = [];
    // ramo profondo
    let parentRef = rootRef; let parent = null; const DEPTH = 300; const chainRefs = [];
    for (let k = 0; k < DEPTH; k++) {
      const it = mk(`Livello ${k + 1}`, k % pages.length); const ref = ctx.register(it);
      it.set(PDFName.of('Parent'), parentRef);
      if (parent) { parent.set(PDFName.of('First'), ref); parent.set(PDFName.of('Last'), ref); parent.set(PDFName.of('Count'), PDFNumber.of(-1)); }
      else topItems.push(ref);
      chainRefs.push(ref); parent = it; parentRef = ref;
    }
    for (let k = 0; k < 3000; k++) { const it = mk(`Voce ${k + 1}`, k % pages.length); it.set(PDFName.of('Parent'), rootRef); topItems.push(ctx.register(it)); }
    topItems.forEach((ref, i) => { const it = ctx.lookup(ref, PDFDict); if (i > 0) it.set(PDFName.of('Prev'), topItems[i - 1]); if (i < topItems.length - 1) it.set(PDFName.of('Next'), topItems[i + 1]); });
    root.set(PDFName.of('First'), topItems[0]); root.set(PDFName.of('Last'), topItems.at(-1)); root.set(PDFName.of('Count'), PDFNumber.of(topItems.length));
    d.catalog.set(PDFName.of('Outlines'), rootRef);
    void PDFArray;
    await save('segnalibri-profondi.pdf', d);
  },
};

console.log(`Genero in ${outDir}`);
const t0 = performance.now();
for (const [name, fn] of Object.entries(GEN)) {
  if (only.length && !only.includes(name)) continue;
  if (existsSync(join(outDir, name)) && !args.includes('--rigenera')) { console.log(`  ${name}: già presente (${(statSync(join(outDir, name)).size / MB).toFixed(1)} MB)`); continue; }
  try { await fn(); } catch (err) { console.error(`  ${name}: ERRORE`, err); process.exitCode = 1; }
}
console.log(`Fatto in ${((performance.now() - t0) / 1000).toFixed(1)} s`);
