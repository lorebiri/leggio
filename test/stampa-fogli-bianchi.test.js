// Bug segnalato: stampa di fogli bianchi e solo della prima pagina. Cause: #print-root dentro #app (nascosto
// dal CSS di stampa), «overflow: clip» su html/body, canvas oltre i limiti di Chromium per pagine grandi.
// Il collaudo completo nel motore di stampa vero è test/e2e/stampa.mjs (browser) e stampa-electron.cjs (app).
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { printPixelBudget } from '../src/renderer/core/printplan.js';
import { fitScale, CANVAS_MAX_SIDE } from '../src/renderer/core/printplan.js';

const css = fs.readFileSync(new URL('../src/renderer/styles/app.css', import.meta.url), 'utf8');
const printJs = fs.readFileSync(new URL('../src/renderer/core/print.js', import.meta.url), 'utf8');
const printCss = css.slice(css.indexOf('@media print'), css.indexOf('/* Movimento ridotto'));

describe('stampa: niente fogli bianchi', () => {
  it('l\'area di stampa viene spostata direttamente sotto <body>', () => {
    expect(printJs).toMatch(/root\.parentElement !== document\.body\) document\.body\.append\(root\)/);
  });
  it('in stampa html e body non ritagliano il contenuto (tutte le pagine, non solo la prima)', () => {
    expect(printCss).toMatch(/html, body[^{]*\{[^}]*overflow: visible !important/);
    expect(printCss).toMatch(/height: auto !important/);
    expect(printCss).toMatch(/\.print-page:last-child \{ break-after: auto/);
  });
  it('pagine grandi: risoluzione entro i limiti del canvas', () => {
    expect(printPixelBudget('300')).toBeLessThanOrEqual(36e6);
    expect(printPixelBudget('96')).toBeLessThan(printPixelBudget('300'));
    // A0 (2384×3370 pt) a 300 dpi chiederebbe ~140 milioni di pixel
    const s = fitScale(2384, 3370, 300 / 72, { maxPixels: printPixelBudget('300') });
    expect(2384 * s * 3370 * s).toBeLessThanOrEqual(36e6 + 1);
    // striscione lunghissimo: nessun lato oltre il massimo
    const t = fitScale(14400, 1200, 300 / 72);
    expect(14400 * t).toBeLessThanOrEqual(CANVAS_MAX_SIDE);
    // pagine normali: scala invariata
    expect(fitScale(595, 842, 150 / 72, { maxPixels: printPixelBudget('150') })).toBeCloseTo(150 / 72);
  });
});
