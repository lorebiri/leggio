import { describe, it, expect } from 'vitest';
import { pgmGrigio, disponiParole, righeDaRisultato, invertiMatrice, applicaMatrice, caratteriTesto, stimaTempo, pulisciTesto } from '../src/renderer/features/conversione/lib/ocr-layout.js';

describe('immagine per Tesseract', () => {
  it('PGM binario con intestazione e grigi corretti (trasparente → bianco)', () => {
    const rgba = new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 255, 255, 0, 0, 255, 10, 10, 10, 0]);
    const b = pgmGrigio(rgba, 2, 2);
    const head = 'P5\n2 2\n255\n';
    expect(new TextDecoder().decode(b.slice(0, head.length))).toBe(head);
    expect([...b.slice(head.length)]).toEqual([0, 255, 76, 255]);
  });
});

describe('matrici', () => {
  it('inversa', () => {
    const m = [2, 0, 0, -2, 10, 800];
    const inv = invertiMatrice(m);
    const [x, y] = applicaMatrice(m, 3, 4);
    const [a, b] = applicaMatrice(inv, x, y);
    expect(a).toBeCloseTo(3); expect(b).toBeCloseTo(4);
    expect(() => invertiMatrice([0, 0, 0, 0, 0, 0])).toThrow();
  });
});

describe('testo invisibile parola per parola', () => {
  const data = { blocks: [{ paragraphs: [{ lines: [{ bbox: { x0: 100, y0: 100, x1: 500, y1: 140 }, baseline: { x0: 100, y0: 132, x1: 500, y1: 132 }, words: [
    { text: 'Fattura', bbox: { x0: 100, y0: 100, x1: 250, y1: 140 }, confidence: 95 },
    { text: 'n.​12', bbox: { x0: 270, y0: 102, x1: 330, y1: 132 }, confidence: 40 },
  ] }] }] }] };
  it('estrae le righe e pulisce il testo', () => {
    const r = righeDaRisultato(data);
    expect(r).toHaveLength(1);
    expect(r[0].words.map((w) => w.text)).toEqual(['Fattura', 'n.12']);
    expect(righeDaRisultato({})).toEqual([]);
    expect(pulisciTesto(' a\u0000b  c ')).toBe('ab c');
  });
  it('posiziona e comprime le parole nel loro riquadro (pagina a 300 dpi, A4)', () => {
    const scale = 300 / 72;
    const vt = [scale, 0, 0, -scale, 0, 842 * scale]; // viewport: pdf → pixel
    const out = disponiParole(righeDaRisultato(data), invertiMatrice(vt), (t, size) => t.length * size * 0.5);
    expect(out).toHaveLength(2);
    const w = out[0];
    expect(w.tm[0]).toBeCloseTo(1); expect(w.tm[3]).toBeCloseTo(1); // orizzontale, verso l'alto
    expect(w.tm[4]).toBeCloseTo(100 / scale); // x in punti
    expect(w.tm[5]).toBeCloseTo(842 - 132 / scale); // linea di base in punti dal basso
    // larghezza naturale × tz/100 = larghezza del riquadro
    expect(7 * w.size * 0.5 * w.tz / 100).toBeCloseTo(150 / scale, 1);
    expect(w.size).toBeGreaterThan(5); expect(w.size).toBeLessThan(12);
  });
  it('pagina ruotata: la direzione del testo segue la rotazione', () => {
    const vt = [0, 1, 1, 0, 0, 0]; // rotazione di 90° (scala 1)
    const out = disponiParole(righeDaRisultato(data), invertiMatrice(vt), (t, s) => t.length * s * 0.5);
    expect(Math.abs(out[0].tm[0])).toBeCloseTo(0); expect(Math.abs(out[0].tm[1])).toBeCloseTo(1);
  });
  it('scarta le parole poco sicure se richiesto', () => {
    const out = disponiParole(righeDaRisultato(data), [1, 0, 0, 1, 0, 0], (t, s) => t.length * s * 0.5, { minConfidence: 50 });
    expect(out.map((w) => w.text)).toEqual(['Fattura']);
  });
});

describe('utilità', () => {
  it('conta i caratteri del testo di pdf.js', () => {
    expect(caratteriTesto({ items: [{ str: 'ab c' }, { str: ' ' }, {}] })).toBe(3);
    expect(caratteriTesto(null)).toBe(0);
  });
  it('stima del tempo leggibile', () => {
    expect(stimaTempo(10000, 1, 10)).toBe('circa 1 minuto'.replace('1 minuto', '2 minuti'));
    expect(stimaTempo(2000, 1, 10)).toBe('circa 20 secondi');
    expect(stimaTempo(1000, 10, 10)).toBe('');
    expect(stimaTempo(1000, 9, 10)).toBe('pochi secondi');
  });
});
