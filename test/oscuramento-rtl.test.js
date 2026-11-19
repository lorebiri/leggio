// Oscuramento di testo da destra a sinistra (ebraico, arabo).
// pdf.js restituisce questi elementi in ORDINE LOGICO con dir:'rtl': il primo carattere della stringa è il più a
// destra sulla pagina (verificato con pdf.js 6 su un PDF con glifi ebraici disegnati uno per uno a posizioni note).
// Prima della correzione le parole erano collocate come se fossero scritte da sinistra: coprendo il nome (a destra)
// restava nel testo il nome stesso, e «Cerca e oscura» copriva il punto sbagliato della riga.
import { describe, it, expect } from 'vitest';
import { pageWords, wordsOutside, buildPageText, rangeRects } from '../src/renderer/features/sicurezza/logica/testo.js';

// riga: «שם: ישראלי ת.ז. 123456789 כתובת רחוב הרצל 10 תל אביב», larga 300 pt da x=100 a x=400
const STR = 'שם: ישראלי ת.ז. 123456789 כתובת רחוב הרצל 10 תל אביב';
const riga = (dir) => ({ str: STR, dir, transform: [10, 0, 0, 10, 100, 700], width: 300, height: 10, fontName: 'f', hasEOL: false });

describe('oscuramento di testo da destra a sinistra', () => {
  it('le parole sono collocate da destra: la prima parola logica sta al bordo destro', () => {
    const w = pageWords([riga('rtl')], {});
    expect(w[0].text).toBe('שם:');
    expect(w[0].rect[2]).toBeCloseTo(400, 0); // termina al bordo destro dell'elemento
    expect(w[w.length - 1].rect[0]).toBeCloseTo(100, 0); // l'ultima parola logica comincia a sinistra
    // i numeri restano un blocco unico, a sinistra del nome
    const num = w.find((x) => x.text === '123456789');
    expect(num.rect[2]).toBeLessThan(w[1].rect[0]);
  });

  it('coprendo il nome a destra, nome e numero non restano nel testo; l\'indirizzo a sinistra sì', () => {
    const words = pageWords([riga('rtl')], {});
    const area = [300, 695, 402, 712]; // estremità destra della riga: «שם: ישראלי ת.ז. 123456789»
    const tenute = wordsOutside(words, [area]).map((x) => x.text);
    for (const segreto of ['שם:', 'ישראלי', 'ת.ז.', '123456789']) expect(tenute).not.toContain(segreto);
    expect(tenute).toContain('אביב');
    expect(tenute).toContain('תל');
  });

  it('«Cerca e oscura»: il riquadro della parola trovata è a destra, dove la parola è davvero', () => {
    const pt = buildPageText([riga('rtl')], {});
    const k = pt.text.indexOf('ישראלי');
    const [r] = rangeRects(pt, k, k + 'ישראלי'.length);
    expect(r[0]).toBeGreaterThan(300);
    expect(r[2]).toBeLessThanOrEqual(400 + 5);
  });

  it('il testo da sinistra a destra non cambia', () => {
    const w = pageWords([riga('ltr')], {});
    expect(w[0].rect[0]).toBeCloseTo(100, 0);
    const pt = buildPageText([riga('ltr')], {});
    const [r] = rangeRects(pt, 0, 3);
    expect(r[0]).toBeLessThan(100);
  });
});
