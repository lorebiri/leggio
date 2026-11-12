// Genera file di prova per verificare la compatibilità con altri lettori (Acrobat, Anteprima).
// Uso: node test/acrobat/genera.mjs <cartella-uscita>
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import * as PDFLib from '@cantoo/pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { createAnnot, addReply, setStatus } from '../../src/renderer/features/commenti/annots.js';
import { encryptBytes } from '../../src/renderer/features/sicurezza/logica/cifratura.js';
import { convertiPdfA, incorporaFontSans } from '../../src/renderer/features/conversione/lib/pdfa.js';

const out = process.argv[2] || 'leggio-out/acrobat';
mkdirSync(out, { recursive: true });
const base = readFileSync(new URL('../fixtures/prova.pdf', import.meta.url));
const load = async (b = base) => { const d = await PDFLib.PDFDocument.load(b); d.registerFontkit(fontkit); return d; };

// 1. commenti
{
  const d = await load();
  const k = await createAnnot(d, 0, { type: 'Highlight', quadPoints: [50, 762, 330, 762, 50, 740, 330, 740], color: [1, 0.85, 0], opacity: 0.5, text: 'Titolo da controllare' }, { author: 'Leggio' });
  await addReply(d, { key: k }, { author: 'Segreteria', text: 'Controllato, va bene.' });
  await setStatus(d, { key: k }, { author: 'Segreteria', state: 'Completed' });
  await createAnnot(d, 0, { type: 'Text', rect: [520, 700, 540, 720], text: 'Nota adesiva: firmare entro venerdì' }, { author: 'Leggio' });
  await createAnnot(d, 0, { type: 'FreeText', rect: [300, 600, 540, 640], text: 'Casella di testo con àèìòù €', color: [0.1, 0.1, 0.1], fontSize: 12 }, { author: 'Leggio' });
  await createAnnot(d, 0, { type: 'Square', rect: [45, 245, 255, 315], color: [0.8, 0, 0], width: 2 }, { author: 'Leggio' });
  await createAnnot(d, 0, { type: 'Ink', inkList: [[[60, 200], [100, 230], [140, 190], [180, 225]]], color: [0, 0.3, 0.8], width: 2 }, { author: 'Leggio' });
  await createAnnot(d, 1, { type: 'Line', line: [60, 300, 300, 320], color: [0, 0, 0], width: 2, lineEnding: ['None', 'OpenArrow'] }, { author: 'Leggio' });
  await createAnnot(d, 1, { type: 'StrikeOut', quadPoints: [50, 718, 400, 718, 50, 706, 400, 706], color: [1, 0, 0] }, { author: 'Leggio' });
  writeFileSync(`${out}/1-commenti.pdf`, await d.save());
}
// 2. password (apertura "leggio123", proprietario "admin456", stampa consentita, modifica vietata)
writeFileSync(`${out}/2-protetto.pdf`, await encryptBytes(base, { userPassword: 'leggio123', ownerPassword: 'admin456', permissions: { stampa: 'high', modifica: false, copia: false, commenti: false, moduli: true, assemblaggio: false } }));
// 3. PDF/A-2b
{
  const d = await load();
  const sf = (n) => new Uint8Array(readFileSync(new URL(`../../node_modules/pdfjs-dist/standard_fonts/LiberationSans-${n}.ttf`, import.meta.url)));
  incorporaFontSans(d, PDFLib, { regular: sf('Regular'), bold: sf('Bold'), italic: sf('Italic'), boldItalic: sf('BoldItalic') }, fontkit);
  convertiPdfA(d, PDFLib, { part: 2, lang: 'it-IT' });
  writeFileSync(`${out}/3-pdfa.pdf`, await d.save({ useObjectStreams: false }));
}
// 4. firma digitale PAdES visibile con ID autofirmato
{
  const require = createRequire(import.meta.url);
  const M = require('../../electron/features/moduli.cjs');
  const p12 = M.createSelfSignedId({ name: 'Prova Leggio', email: 'prova@example.it', organization: 'ICCOM-CNR', password: 'firma123', years: 1 });
  writeFileSync(`${out}/4-id-prova.p12`, Buffer.from(p12.bytes || p12));
  const r = await M.signPdf(base, Buffer.from(p12.bytes || p12), 'firma123', { visible: true, pageIndex: 0, rect: [350, 60, 560, 130], subFilter: 'cades', reason: 'Prova di compatibilità', location: 'Sesto Fiorentino' });
  writeFileSync(`${out}/4-firmato.pdf`, Buffer.from(r.bytes));
  const p7 = await M.signP7m(base, Buffer.from(p12.bytes || p12), 'firma123');
  writeFileSync(`${out}/5-busta.pdf.p7m`, Buffer.from(p7.bytes || p7));
}
console.log('file di prova in', out);
