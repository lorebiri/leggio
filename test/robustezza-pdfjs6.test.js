// Compatibilità con pdf.js 6: niente PDFDocumentProxy.destroy() né convertToViewportRectangle.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { rectToCss } from '../src/renderer/core/geometry.js';

const require = createRequire(import.meta.url);
pdfjs.GlobalWorkerOptions.workerSrc = (await import('node:url')).pathToFileURL(require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs')).href;
const bytes = () => new Uint8Array(readFileSync('test/fixtures/prova.pdf'));

describe('pdf.js 6', () => {
  it('il documento si libera con loadingTask.destroy() (PDFDocumentProxy.destroy non esiste più)', async () => {
    const task = pdfjs.getDocument({ data: bytes(), isEvalSupported: false, verbosity: 0 });
    const pdf = await task.promise;
    expect(pdf.numPages).toBe(6);
    expect(pdf.destroy).toBeUndefined();
    expect(typeof pdf.loadingTask.destroy).toBe('function');
    await pdf.loadingTask.destroy();
    expect(task.destroyed).toBe(true);
    let failed = false;
    try { await pdf.getPage(1); } catch { failed = true; }
    expect(failed).toBe(true);
  });
  it('il buffer passato a getDocument viene staccato: il nucleo deve passare una copia', async () => {
    const b = bytes();
    const task = pdfjs.getDocument({ data: b.slice(), verbosity: 0 });
    await task.promise;
    expect(b.length).toBeGreaterThan(0); // l'originale resta utilizzabile
    await task.destroy();
  });
  it('rectToCss converte un rettangolo PDF con zoom e rotazione', async () => {
    const task = pdfjs.getDocument({ data: bytes(), verbosity: 0 });
    const pdf = await task.promise;
    const page = await pdf.getPage(1);
    expect(page.getViewport({ scale: 1 }).convertToViewportRectangle).toBeUndefined();
    const vp = page.getViewport({ scale: 2 });
    // pagina 595×842: il rettangolo (50,250)-(250,310) → left 100, top (842-310)*2
    expect(rectToCss(vp, [50, 250, 250, 310])).toEqual({ left: 100, top: (842 - 310) * 2, width: 400, height: 120 });
    const r = rectToCss(page.getViewport({ scale: 1, rotation: 90 }), [50, 250, 250, 310]);
    expect(r.width).toBeCloseTo(60); expect(r.height).toBeCloseTo(200);
    expect(r.left).toBeCloseTo(250); expect(r.top).toBeCloseTo(50);
    await task.destroy();
  });
});
