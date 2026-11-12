import { describe, it, expect } from 'vitest';
import * as PDFLib from '@cantoo/pdf-lib';
import fs from 'node:fs';
import { OPERAZIONI, tutteLeOperazioni, validaSequenza, eseguiSequenza, nomeUscita, SkipError, operazioneProteggi, destinazione } from '../src/renderer/features/avanzati/lib/batch-ops.js';
import { normalizzaData, visivoAPagina } from '../src/renderer/features/avanzati/lib/protocollo.js';

const fixture = new Uint8Array(fs.readFileSync(new URL('./fixtures/prova.pdf', import.meta.url)));
const protectFinto = async (b, o) => { const d = await PDFLib.PDFDocument.load(b); d.encrypt({ userPassword: o.userPassword, ownerPassword: 'x' }); return d.save(); };
const env = (extra = {}) => ({
  PDFLib, ops: tutteLeOperazioni([{ ...operazioneProteggi(protectFinto), esterna: true }, ...(extra.esterne || [])]), ctx: extra.ctx || {},
  openPdfLib: (b) => PDFLib.PDFDocument.load(b, { ignoreEncryption: true, updateMetadata: false }),
  savePdfLib: (d) => d.save({ useObjectStreams: true }),
});

describe('date e coordinate (nessun timbro di protocollo: lo appone solo Titulus)', () => {
  it('accetta date in vari formati e rifiuta quelle impossibili', () => {
    expect(normalizzaData('12.11.26')).toBe('12/11/2026');
    expect(normalizzaData('2026-11-12')).toBe('12/11/2026');
    expect(normalizzaData('31/02/2026')).toBeNull();
    expect(normalizzaData('ieri')).toBeNull();
  });
  it('converte le coordinate sulle pagine ruotate', async () => {
    const d = await PDFLib.PDFDocument.create();
    const p = d.addPage([600, 800]);
    p.setRotation(PDFLib.degrees(90));
    // in alto a destra della pagina "come appare" (larga 800, alta 600)
    const a = visivoAPagina(p, 780, 580);
    expect(a).toEqual({ x: 20, y: 780, rot: 90 });
  });
});

describe('azioni guidate', () => {
  it('valida la sequenza (Proteggi per ultima, password lunga)', () => {
    const ops = tutteLeOperazioni([{ ...operazioneProteggi(protectFinto), esterna: true }]);
    expect(validaSequenza([], ops)).toMatch(/almeno/);
    expect(validaSequenza([{ op: 'proteggi', params: { password: 'abcd' } }, { op: 'ruota', params: {} }], ops)).toMatch(/ultima/);
    expect(validaSequenza([{ op: 'proteggi', params: { password: 'ab' } }], ops)).toMatch(/4 caratteri/);
    expect(validaSequenza([{ op: 'inesistente' }], ops)).toMatch(/non è disponibile/);
    expect(validaSequenza([{ op: 'ruota', params: { angolo: '90' } }, { op: 'numeri', params: {} }], ops)).toBeNull();
  });

  it('esegue rotazione, numeri, filigrana, metadati e protezione', async () => {
    const passi = [
      { op: 'ruota', params: { angolo: '90', pagine: 'tutte' } },
      { op: 'numeri', params: { formato: 'Pagina {n} di {tot}', posizione: 'basso-centro', size: 10, inizio: 1 } },
      { op: 'filigrana', params: { testo: 'COPIA', opacita: 20, colore: '#b42318' } },
      { op: 'metadati', params: {} },
      { op: 'proteggi', params: { password: 'segreta1', stampa: true } },
    ];
    const ctx = { index: 2 };
    const out = await eseguiSequenza(fixture, passi, env({ ctx }));
    await expect(PDFLib.PDFDocument.load(out)).rejects.toThrow(/encrypt/i);
    const d = await PDFLib.PDFDocument.load(out, { password: 'segreta1' });
    expect(d.getPage(0).getRotation().angle).toBe(90);
    expect(d.getTitle()).toBeUndefined();
  });

  it('usa le operazioni registrate da altre aree', async () => {
    let chiamata = null;
    const esterne = [{ id: 'ocr', label: 'Riconosci testo (OCR)', runBytes: async (b, p) => { chiamata = p; return b; } }];
    const out = await eseguiSequenza(fixture, [{ op: 'ruota', params: { angolo: '180' } }, { op: 'ocr', params: { lingua: 'ita' } }], env({ esterne }));
    expect(chiamata).toEqual({ lingua: 'ita' });
    expect((await PDFLib.PDFDocument.load(out)).getPage(0).getRotation().angle).toBe(180);
  });

  it('salta con un messaggio chiaro i file non PDF o protetti', async () => {
    await expect(eseguiSequenza(new Uint8Array([1, 2, 3]), [{ op: 'ruota', params: {} }], env())).rejects.toBeInstanceOf(SkipError);
    const prot = await eseguiSequenza(fixture, [{ op: 'proteggi', params: { password: 'abcd1234' } }], env());
    await expect(eseguiSequenza(prot, [{ op: 'ruota', params: {} }], env())).rejects.toThrow(/protetto/);
  });

  it('passa ctx.signal e ctx.scriviFile alle operazioni, e l\'annullamento le ferma a metà', async () => {
    const scritti = [];
    const ctrl = new AbortController();
    const esterne = [
      { id: 'esporta-txt', label: 'Esporta testo', runBytes: async (b, _p, ctx) => { await ctx.scriviFile('documento.txt', new TextEncoder().encode('ciao')); expect(ctx.signal).toBe(ctrl.signal); return b; } },
      { id: 'lungo', label: 'OCR lungo', runBytes: (b, _p, ctx) => new Promise((res, rej) => { const t = setTimeout(() => res(b), 5000); ctx.signal.addEventListener('abort', () => { clearTimeout(t); rej(new DOMException('Annullato', 'AbortError')); }); }) },
    ];
    const ctx = { scriviFile: async (n, b) => { scritti.push([n, b.length]); } };
    const e = { ...env({ esterne, ctx }), signal: ctrl.signal };
    const t0 = Date.now();
    setTimeout(() => ctrl.abort(), 50);
    await expect(eseguiSequenza(fixture, [{ op: 'esporta-txt' }, { op: 'lungo' }, { op: 'ruota', params: {} }], e)).rejects.toThrow(/Annullato/);
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(scritti).toEqual([['documento.txt', 4]]);
  });

  it('destinazione: «Elaborati» con le sottocartelle, altra cartella, sostituzione', () => {
    expect(destinazione({ path: '/c/a/b/x.pdf', rel: 'a/b/x.pdf' }, { dest: 'sub', folder: '/c' })).toEqual({ folder: '/c', sub: 'Elaborati/a/b', overwrite: true });
    expect(destinazione({ path: '/d/x.pdf', rel: 'x.pdf' }, { dest: 'sub', folder: null })).toEqual({ folder: '/d', sub: 'Elaborati', overwrite: true });
    expect(destinazione({ path: '/c/x.pdf' }, { dest: 'other', destFolder: '/out' })).toEqual({ folder: '/out', sub: '', overwrite: false });
    expect(destinazione({ path: 'C:\\c\\x.pdf' }, { dest: 'overwrite' })).toEqual({ folder: 'C:\\c', sub: '', overwrite: true });
    expect(destinazione({ name: 'x.pdf' }, { dest: 'sub' })).toEqual({ folder: null, sub: '', overwrite: false });
  });

  it('nomi dei file di uscita', () => {
    expect(nomeUscita('a.pdf')).toBe('a.pdf');
    expect(nomeUscita('a.PDF', { modo: 'suffisso' })).toBe('a_elaborato.pdf');
    expect(OPERAZIONI.every((o) => o.label && o.fields)).toBe(true);
  });
});
