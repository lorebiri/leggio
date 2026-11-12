// Prova di robustezza su PDF reali (facoltativa): LEGGIO_REAL_PDFS=/cartella/con/pdf npx vitest run test/modifica-reali
// Per ogni pagina: analisi, riscrittura identica, modifica di alcuni blocchi e verifica che il resto del testo non cambi.
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import * as PDFLib from '@cantoo/pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { groupTextItems } from '../src/renderer/features/modifica/blocks.js';
import { analyze, editBlock, findInPage, replaceMatches, editorText } from '../src/renderer/features/modifica/operations.js';
import { compareOutside } from '../src/renderer/features/modifica/verify.js';
import { rewriteContentStream } from '../src/renderer/features/modifica/contentstream.js';

const require = createRequire(import.meta.url);
pdfjs.GlobalWorkerOptions.workerSrc = (await import('node:url')).pathToFileURL(require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs')).href;
const LIB = (n) => readFileSync(require.resolve('pdfjs-dist/standard_fonts/' + n));
const env = { loadUnicodeFont: async ({ bold, italic }) => LIB(`LiberationSans-${bold && italic ? 'BoldItalic' : bold ? 'Bold' : italic ? 'Italic' : 'Regular'}.ttf`) };
const DIR = process.env.LEGGIO_REAL_PDFS;
const MAX_PAGES = +(process.env.LEGGIO_REAL_MAXPAGES || 6);

async function textContent(bytes, i) {
  const task = pdfjs.getDocument({ data: bytes.slice(), disableFontFace: true, isEvalSupported: false, verbosity: 0, cMapUrl: require.resolve('pdfjs-dist/package.json').replace('package.json', 'cmaps/'), cMapPacked: true });
  try { const pdf = await task.promise; return await (await pdf.getPage(i + 1)).getTextContent(); } finally { task.destroy(); }
}
async function open(bytes) { const d = await PDFLib.PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false }); d.registerFontkit(fontkit); return d; }

describe.skipIf(!DIR)('PDF reali', () => {
  const files = DIR ? readdirSync(DIR).filter((f) => f.toLowerCase().endsWith('.pdf')) : [];
  for (const f of files) {
    it(f, async () => {
      const bytes = new Uint8Array(readFileSync(join(DIR, f)));
      const doc = await open(bytes);
      const n = Math.min(doc.getPageCount(), MAX_PAGES);
      const stats = { pages: n, blocks: 0, inplace: 0, rewrite: 0, cover: 0, verifyFail: 0, ms: 0, ops: 0, replace: 0 };
      for (let i = 0; i < n; i++) {
        const t0 = Date.now();
        const A = analyze(doc, i);
        stats.ms += Date.now() - t0; stats.ops += A.parsed.ops.length;
        expect(rewriteContentStream(A.parsed, new Map())).toEqual(A.bytes);
        const tc = await textContent(bytes, i);
        const blocks = groupTextItems(tc.items, tc.styles).filter((b) => b.text.trim().length > 3);
        const pick = blocks.filter((_, k) => k % Math.max(1, Math.floor(blocks.length / 4)) === 0).slice(0, 4);
        for (const b of pick) {
          stats.blocks++;
          // 1) correzione di una parola (in loco se possibile)  2) riscrittura completa
          for (const variant of [(t) => t.replace(/[A-Za-zÀ-ÿ]{4,}/, (w) => w.slice(0, -1) + (w.endsWith('a') ? 'o' : 'a')), (t) => 'Testo riscritto da Leggio per la prova.']) {
            const initial = editorText(A, b).text;
            const nt = variant(initial);
            if (nt === initial) continue;
            const d = await open(bytes);
            const r = await editBlock(d, i, b, nt, {}, env, { oldText: initial });
            stats[r.method]++;
            const out = await d.save({ useObjectStreams: true });
            const tc2 = await textContent(out, i);
            const cmp = compareOutside(tc.items, tc2.items, [b.rect, r.extent]);
            if (!cmp.ok) { stats.verifyFail++; console.warn(`[${f}] p.${i + 1} blocco «${b.text.slice(0, 40)}» ${r.method}: manca «${cmp.missing}» compare «${cmp.added}»`); }
          }
        }
        // trova e sostituisci di una parola comune
        const m = findInPage(A, ' di ').slice(0, 3);
        if (m.length) {
          const d = await open(bytes);
          const r = await replaceMatches(d, i, m, ' da ', env);
          stats.replace += r.results.length;
          const out = await d.save();
          await textContent(out, i); // deve riaprirsi
        }
      }
      console.log(f, JSON.stringify(stats));
    }, 240000);
  }
});
