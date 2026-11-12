import { describe, it, expect } from 'vitest';
import { creaDoc, ricarica, etichette, PDFDocument } from './pagine-helpers.js';
import * as B from '../src/renderer/features/pagine/logica/segnalibri.js';
import * as I from '../src/renderer/features/pagine/logica/impaginazione.js';
import * as T from '../src/renderer/features/pagine/logica/timbri.js';
import * as C from '../src/renderer/features/pagine/logica/crea.js';
import * as D from '../src/renderer/features/pagine/logica/dividi.js';
import { orientamentoJpeg, tipoImmagine, testoWinAnsi, numeroRomano, sembraPdf } from '../src/renderer/features/pagine/logica/util.js';
import { PDFName } from '@cantoo/pdf-lib';

// PNG 2x1 rosso/blu
const PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAIAAAB7QOjdAAAAEElEQVR4nGP4z8DAwMDwHwAG/AL+OgVNTQAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));

describe('segnalibri', () => {
  it('legge, modifica e riscrive mantenendo struttura e pagine', async () => {
    const d = await creaDoc(4, { segnalibri: true });
    let alb = B.leggiSegnalibri(d);
    expect(alb.map((n) => [n.titolo, n.pagina])).toEqual([['Capitolo 1', 0], ['Capitolo 2', 2]]);
    expect(alb[0].figli[0]).toMatchObject({ titolo: 'Sezione 1.1', pagina: 1 });
    B.inserisciA(alb, [2], { titolo: 'Appendice è', pagina: 3, figli: [] });
    B.spostaNodo(alb, [0, 0], [1], 'dentro');
    alb[0].titolo = 'Primo'; alb[0].cambiato = false;
    B.scriviSegnalibri(d, alb);
    const r = await ricarica(d);
    const alb2 = B.leggiSegnalibri(r);
    expect(alb2.map((n) => n.titolo)).toEqual(['Primo', 'Capitolo 2', 'Appendice è']);
    expect(alb2[1].figli.map((n) => [n.titolo, n.pagina])).toEqual([['Sezione 1.1', 1]]);
    expect(alb2[2].pagina).toBe(3);
    expect(() => B.spostaNodo(alb2, [1], [1, 0], 'dentro')).toThrow(/sé stesso/);
    B.rimuoviA(alb2, [1]);
    B.scriviSegnalibri(r, alb2);
    expect(B.leggiSegnalibri(await ricarica(r)).length).toBe(2);
    B.scriviSegnalibri(r, []);
    expect(B.leggiSegnalibri(await ricarica(r))).toEqual([]);
  });

  it('etichette di pagina', async () => {
    const d = await creaDoc(8);
    B.scriviEtichette(d, [{ da: 0, stile: 'r', inizio: 1 }, { da: 3, stile: 'D', prefisso: 'A-', inizio: 1 }]);
    const r = await ricarica(d);
    const e = B.leggiEtichette(r);
    expect(e).toEqual([{ da: 0, stile: 'r', prefisso: '', inizio: 1 }, { da: 3, stile: 'D', prefisso: 'A-', inizio: 1 }]);
    expect([0, 1, 2, 3, 7].map((i) => B.etichettaPagina(e, i))).toEqual(['i', 'ii', 'iii', 'A-1', 'A-5']);
    expect(() => B.scriviEtichette(d, [{ da: 2, stile: 'D', inizio: 1 }])).toThrow(/pagina 1/);
    expect(() => B.scriviEtichette(d, [{ da: 0, stile: 'D', inizio: 0 }])).toThrow(/intero/);
    expect(numeroRomano(1994)).toBe('mcmxciv');
  });
});

describe('impaginazione', () => {
  it('margini visivi rispetto alla rotazione', () => {
    const m = { alto: 1, destra: 2, basso: 3, sinistra: 4 };
    expect(I.marginiPdf(0, m)).toEqual({ x1: 4, y1: 3, x2: -2, y2: -1 });
    expect(I.marginiPdf(90, m)).toEqual({ x1: 1, y1: 4, x2: -3, y2: -2 });
    expect(I.marginiPdf(180, m)).toEqual({ x1: 2, y1: 1, x2: -4, y2: -3 });
    expect(I.marginiPdf(270, m)).toEqual({ x1: 3, y1: 2, x2: -1, y2: -4 });
  });

  it('ritaglia con rettangolo, margini e ripristino; rifiuta ritagli troppo piccoli', async () => {
    const d = await creaDoc(3);
    I.ritaglia(d, [0], { rett: [100, 100, 300, 400] });
    I.ritaglia(d, [1], { margini: { alto: 10, destra: 10, basso: 10, sinistra: 10 } });
    let r = await ricarica(d);
    expect(r.getPage(0).getCropBox()).toEqual({ x: 100, y: 100, width: 200, height: 300 });
    expect(r.getPage(1).getCropBox()).toEqual({ x: 10, y: 10, width: 575, height: 822 });
    expect(() => I.ritaglia(r, [2], { margini: { alto: 500, basso: 500 } })).toThrow(/troppo piccolo/);
    I.ritaglia(r, [0], { ripristina: true });
    r = await ricarica(r);
    expect(r.getPage(0).getCropBox()).toEqual({ x: 0, y: 0, width: 595, height: 842 });
  });

  it('analisi pixel: pagina bianca e limiti del contenuto', () => {
    const w = 100, h = 100; const data = new Uint8ClampedArray(w * h * 4).fill(255);
    expect(I.analizzaPixel(data, w, h)).toMatchObject({ vuota: true, limiti: null });
    for (let y = 20; y < 40; y++) for (let x = 30; x < 70; x++) { const o = (y * w + x) * 4; data[o] = data[o + 1] = data[o + 2] = 0; }
    const a = I.analizzaPixel(data, w, h);
    expect(a.vuota).toBe(false);
    expect(a.limiti).toEqual({ x0: 30, y0: 20, x1: 70, y1: 40 });
    // un puntino isolato (polvere) non rende la pagina "non bianca"
    const d2 = new Uint8ClampedArray(w * h * 4).fill(255); d2[(50 * w + 50) * 4] = 0; d2[(50 * w + 50) * 4 + 1] = 0; d2[(50 * w + 50) * 4 + 2] = 0;
    expect(I.analizzaPixel(d2, w, h).vuota).toBe(true);
  });

  it('ridimensiona ad A4 adattando contenuto e annotazioni', async () => {
    const d = await creaDoc(2, { annot: true, dims: [612, 792] });
    d.getPage(1).setRotation({ type: 'degrees', angle: 90 });
    await I.ridimensiona(d, [0, 1], [595.28, 841.89]);
    const r = await ricarica(d);
    expect(r.getPage(0).getSize()).toEqual({ width: 595.28, height: 841.89 });
    expect(r.getPage(1).getSize().width).toBeCloseTo(595.28); // ruotata: resta verticale nel non ruotato
    const rect = r.getPage(0).node.Annots().lookup(0).lookup(PDFName.of('Rect')).asArray().map((n) => n.asNumber());
    const s = 595.28 / 612;
    expect(rect[0]).toBeCloseTo(100 * s, 1);
    await expect(I.ridimensiona(d, [0], [1, 1])).rejects.toThrow(/Formato/);
  });

  it('N-up, opuscolo e ordine dell\'opuscolo', async () => {
    expect(I.ordineOpuscolo(4)).toEqual([{ fronte: [3, 0], retro: [1, 2] }]);
    expect(I.ordineOpuscolo(5)[0]).toEqual({ fronte: [null, 0], retro: [1, null] });
    expect(I.ordineOpuscolo(1)).toEqual([{ fronte: [null, 0], retro: [null, null] }]);
    expect(() => I.grigliaNup(3)).toThrow();
    const d = await creaDoc(5);
    d.getPage(1).setRotation({ type: 'degrees', angle: 90 });
    const n = await I.nUp(d, { perFoglio: 4, bordo: true });
    expect(n.getPageCount()).toBe(2);
    const n2 = await I.nUp(d, { perFoglio: 2 });
    expect(n2.getPage(0).getSize().width).toBeGreaterThan(n2.getPage(0).getSize().height);
    const o = await I.opuscolo(d);
    expect(o.getPageCount()).toBe(4);
    await ricarica(o);
  });
});

describe('timbri', () => {
  it('numerazione con prima pagina esclusa, segnaposto e rimozione', async () => {
    const d = await creaDoc(4);
    d.getPage(2).setRotation({ type: 'degrees', angle: 90 });
    const r0 = await T.intestazioni(d, { testi: { basso: { centro: 'Pag. {n} di {N}' }, alto: { dx: '{file} {data}' } }, escludiPrima: true, file: 'prova.pdf', data: '12/11/2026' });
    expect(r0.pagine).toBe(3);
    let r = await ricarica(d);
    expect(T.elementiAggiunti(r)).toEqual({ Intestazione: 3 });
    expect(T.compila('Pag. {n} di {N}', { n: 2, N: 9 })).toBe('Pag. 2 di 9');
    await expect(T.intestazioni(r, { testi: {} })).rejects.toThrow(/almeno un testo/);
    await expect(T.intestazioni(await creaDoc(1), { testi: { basso: { centro: '{n}' } }, escludiPrima: true })).rejects.toThrow(/Nessuna pagina/);
    expect(T.rimuoviElementi(r)).toBe(3);
    r = await ricarica(r);
    expect(T.elementiAggiunti(r)).toEqual({});
    expect(etichette(r)[0]).toBe('Pagina 1');
  });

  it('Bates, filigrana sotto e sopra, sfondo', async () => {
    const d = await creaDoc(3);
    const b = await T.intestazioni(d, { testi: { basso: { dx: '{bates}' } }, bates: { prefisso: 'ALL.1-', cifre: 3, inizio: 7 } });
    expect(b.ultimoBates).toBe(9);
    expect(T.numeroBates({ prefisso: 'X', cifre: 4 }, 12)).toBe('X0012');
    await T.filigrana(d, { testo: 'COPIA', rotazione: 45, opacita: 0.2, sotto: true });
    await T.filigrana(d, { immagine: { bytes: PNG, tipo: 'png' }, indici: [0], posizione: 'alto-dx', scala: 0.2 });
    await T.sfondo(d, { colore: '#ffeecc', indici: [1] });
    await expect(T.filigrana(d, { testo: '   ' })).rejects.toThrow(/testo/);
    await expect(T.filigrana(d, { immagine: { bytes: new Uint8Array(10), tipo: 'png' } })).rejects.toThrow(/Immagine/);
    const r = await ricarica(d);
    expect(T.elementiAggiunti(r)).toEqual({ Bates: 3, Filigrana: 4, Sfondo: 1 });
    // la filigrana "sotto" è il primo flusso della pagina
    const c = r.getPage(2).node.Contents();
    expect(c.lookup(0).dict.get(PDFName.of('LeggioTimbro')).decodeText()).toBe('Filigrana');
    expect(T.rimuoviElementi(r, ['Filigrana'])).toBe(4);
    expect(T.elementiAggiunti(r)).toEqual({ Bates: 3, Sfondo: 1 });
  });
});

describe('creazione e unione', () => {
  it('riconosce immagini e orientamento EXIF', () => {
    expect(tipoImmagine(PNG)).toBe('png');
    expect(tipoImmagine(new Uint8Array(20))).toBe(null);
    // JPEG minimo con APP1 Exif, orientamento 6 (big endian)
    const exif = [0xff, 0xd8, 0xff, 0xe1, 0x00, 0x22, 0x45, 0x78, 0x69, 0x66, 0x00, 0x00, 0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08, 0x00, 0x01, 0x01, 0x12, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01, 0x00, 0x06, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xff, 0xd9];
    expect(orientamentoJpeg(Uint8Array.from(exif))).toBe(6);
    expect(orientamentoJpeg(PNG)).toBe(1);
    expect(testoWinAnsi('Perché → ok ✓ Ω')).toBe('Perché -> ok ? ?');
    expect(sembraPdf(new TextEncoder().encode('%PDF-1.7'))).toBe(true);
  });

  it('PDF da immagini, testo e vuoto', async () => {
    const d = await C.pdfDaImmagini([{ bytes: PNG, nome: 'a.png' }, { bytes: PNG, nome: 'b.png' }], { formato: 'A4' });
    expect(d.getPageCount()).toBe(2);
    expect(d.getPage(0).getSize().width).toBeGreaterThan(d.getPage(0).getSize().height); // immagine orizzontale
    const img = await C.pdfDaImmagini([{ bytes: PNG }], { formato: 'immagine', margine: 0 });
    expect(img.getPage(0).getSize()).toEqual({ width: 2, height: 1 });
    await expect(C.pdfDaImmagini([])).rejects.toThrow(/almeno/);
    await expect(C.pdfDaImmagini([{ bytes: new Uint8Array(30), nome: 'x.heic' }])).rejects.toThrow(/x.heic/);
    const lungo = Array.from({ length: 200 }, (_, i) => `Riga ${i} con testo, accenti àèìòù e una parola lunghissima${'x'.repeat(i % 3 ? 0 : 200)}`).join('\n');
    const t = await C.pdfDaTesto(lungo, { dimensione: 11 });
    expect(t.getPageCount()).toBeGreaterThan(3);
    expect((await C.pdfDaTesto('')).getPageCount()).toBe(1);
    expect((await C.pdfVuoto({ pagine: 3, orizzontale: true })).getPage(0).getSize().width).toBeCloseTo(841.89);
  });

  it('unisce PDF e immagini con un segnalibro per file e i segnalibri originali', async () => {
    const a = await creaDoc(3, { segnalibri: true, modulo: true });
    const b = await creaDoc(2, { modulo: true });
    const out = await C.unisci([
      { nome: 'determina.pdf', tipo: 'pdf', bytes: await a.save() },
      { nome: 'foto.png', tipo: 'immagine', bytes: PNG },
      { nome: 'durc.pdf', tipo: 'pdf', bytes: await b.save(), indici: [1] },
    ]);
    const r = await ricarica(out);
    expect(r.getPageCount()).toBe(5);
    const alb = B.leggiSegnalibri(r);
    expect(alb.map((n) => [n.titolo, n.pagina])).toEqual([['determina', 0], ['foto', 3], ['durc', 4]]);
    expect(alb[0].figli.map((n) => n.titolo)).toEqual(['Capitolo 1', 'Capitolo 2']);
    expect(r.getForm().getFields().map((f) => f.getName()).sort()).toEqual(['nome', 'ok', 'ok_2', 'scelta', 'scelta_2']);
    await expect(C.unisci([{ nome: 'rotto.pdf', tipo: 'pdf', bytes: new Uint8Array(5) }])).rejects.toThrow(/rotto.pdf/);
    await expect(C.unisci([])).rejects.toThrow(/almeno un file/);
  });
});

describe('divisione', () => {
  it('piani: ogni N, intervalli, separatori, segnalibri, nomi', async () => {
    expect(D.pianoOgni(5, 2)).toEqual([[0, 1], [2, 3], [4]]);
    expect(D.pianoOgni(1, 10)).toEqual([[0]]);
    expect(() => D.pianoOgni(5, 0)).toThrow();
    expect(D.pianoIntervalli(6, '1-2, 5-')).toEqual([[0, 1], [4, 5]]);
    expect(D.pianoSeparatori(7, [2, 3, 6])).toEqual([[0, 1], [4, 5]]);
    expect(() => D.pianoSeparatori(2, [0, 1])).toThrow(/bianche/);
    const d = await creaDoc(5, { segnalibri: true });
    expect(D.pianoSegnalibri(d)).toEqual([{ titolo: 'Capitolo 1', indici: [0, 1] }, { titolo: 'Capitolo 2', indici: [2, 3, 4] }]);
    await expect(async () => D.pianoSegnalibri(await creaDoc(2))).rejects.toThrow(/segnalibri/);
    expect(D.nomiParti('doc', [{ titolo: 'A/B' }, {}, { titolo: 'A/B' }])).toEqual(['doc_01_A B.pdf', 'doc_02.pdf', 'doc_03_A B.pdf']);
  });

  it('esegue il piano senza perdere i link e divide per dimensione', async () => {
    const d = await creaDoc(12, { segnalibri: true, modulo: true });
    const bytes = await d.save();
    const carica = () => PDFDocument.load(bytes);
    const scritti = [];
    await D.eseguiPiano(carica, D.pianoOgni(12, 5), ['a.pdf', 'b.pdf', 'c.pdf'], (n, b) => scritti.push([n, b.length]));
    expect(scritti.map((x) => x[0])).toEqual(['a.pdf', 'b.pdf', 'c.pdf']);
    const parti = await D.pianoDimensione(carica, 12, 60 * 1024);
    expect(parti.flatMap((p) => p.indici)).toEqual([...Array(12).keys()]);
    for (const p of parti) expect(p.bytes.length).toBeLessThanOrEqual(60 * 1024);
    await expect(D.pianoDimensione(carica, 12, 10)).rejects.toThrow(/almeno/);
  });
});
