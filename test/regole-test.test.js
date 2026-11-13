// Controlla che i test rispettino le regole per girare anche su Windows (vedi docs/ARCHITETTURA.md).
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const cartella = fileURLToPath(new URL('.', import.meta.url)); // valido anche su Windows
const file = readdirSync(cartella).filter((f) => /\.test\.js$/.test(f) && f !== 'regole-test.test.js');

describe('regole per i test multipiattaforma', () => {
  it('percorso dei font di pdf.js sempre con «/» finale (Windows)', () => {
    const sbagliati = file.filter((f) => /fileURLToPath\(new URL\('\.\.\/node_modules\/pdfjs-dist\/standard_fonts\/', import\.meta\.url\)\)(?!\.replace)/.test(readFileSync(join(cartella, f), 'utf8')));
    expect(sbagliati).toEqual([]);
  });
  it('worker di pdf.js sempre come URL file:// (Windows)', () => {
    const sbagliati = file.filter((f) => /workerSrc = require\.resolve\(/.test(readFileSync(join(cartella, f), 'utf8')));
    expect(sbagliati).toEqual([]);
  });
});
