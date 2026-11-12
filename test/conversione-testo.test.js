import { describe, it, expect } from 'vitest';
import { ricostruisciPagina, costruisciSegmenti, ordineLettura, rilevaTabelle, stileDaNomeFont, normalizzaItems, blocchiInTesto } from '../src/renderer/features/conversione/lib/testo.js';

// riga di testo come un unico frammento (larghezza ≈ 0,5 em per carattere)
const L = (str, x, y, size = 10, extra = {}) => ({ str, x, y, w: str.length * size * 0.5, size, bold: false, italic: false, ...extra });

describe('stile dal nome del font', () => {
  it('riconosce grassetto e corsivo', () => {
    expect(stileDaNomeFont('ABCDEF+Arial-BoldMT')).toEqual({ bold: true, italic: false });
    expect(stileDaNomeFont('Times-Italic')).toEqual({ bold: false, italic: true });
    expect(stileDaNomeFont('Calibri,BoldItalic')).toEqual({ bold: true, italic: true });
    expect(stileDaNomeFont('Helvetica')).toEqual({ bold: false, italic: false });
  });
});

describe('normalizzazione degli item pdf.js', () => {
  it('porta le coordinate dall’origine in basso a quella in alto', () => {
    const vt = [1, 0, 0, -1, 0, 800]; // viewport scala 1 di una pagina alta 800
    const out = normalizzaItems([{ str: 'Ciao', transform: [12, 0, 0, 12, 50, 700], width: 24, fontName: 'f1' }, { str: '  ', transform: [12, 0, 0, 12, 80, 700], width: 5 }], vt, { f1: { name: 'Arial-Bold' } });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ str: 'Ciao', x: 50, y: 100, size: 12, bold: true });
  });
  it('ignora item non validi senza errori', () => {
    expect(normalizzaItems([null, {}, { str: 'x' }], [1, 0, 0, -1, 0, 100])).toEqual([]);
    expect(normalizzaItems(undefined, [1, 0, 0, -1, 0, 100])).toEqual([]);
  });
});

describe('ricostruzione dei paragrafi', () => {
  it('pagina vuota → nessun blocco', () => {
    expect(ricostruisciPagina([], { width: 600 })).toEqual([]);
    expect(ricostruisciPagina([L('   ', 10, 10)], { width: 600 })).toEqual([]);
  });

  it('unisce righe consecutive e separa i paragrafi con lo spazio verticale', () => {
    const f = [
      L('Questa è la prima riga del primo paragrafo che continua', 50, 100),
      L('sulla seconda riga e finisce qui con un punto.', 50, 112),
      L('Secondo paragrafo dopo uno spazio più grande del solito', 50, 140),
      L('che continua anche lui.', 50, 152),
    ];
    const b = ricostruisciPagina(f, { width: 600 });
    expect(b.map((x) => x.type)).toEqual(['paragraph', 'paragraph']);
    expect(b[0].text).toBe('Questa è la prima riga del primo paragrafo che continua sulla seconda riga e finisce qui con un punto.');
  });

  it('ricompone le parole spezzate dal trattino a fine riga', () => {
    const f = [L('La documenta-', 50, 100), L('zione è completa.', 50, 112)];
    expect(ricostruisciPagina(f, { width: 600 })[0].text).toBe('La documentazione è completa.');
  });

  it('riconosce titoli dalla dimensione del font', () => {
    const f = [
      L('Relazione annuale', 50, 60, 20),
      L('Introduzione', 50, 100, 14),
      L('Testo normale del documento che occupa una riga intera.', 50, 125),
      L('Altra riga di testo normale del documento qualsiasi.', 50, 137),
    ];
    const b = ricostruisciPagina(f, { width: 600 });
    expect(b[0]).toMatchObject({ type: 'heading', level: 1, text: 'Relazione annuale' });
    expect(b[1]).toMatchObject({ type: 'heading', level: 2, text: 'Introduzione' });
    expect(b[2].type).toBe('paragraph');
  });

  it('riconosce elenchi puntati e numerati', () => {
    const f = [
      L('Ecco l’elenco:', 50, 100),
      L('• primo elemento', 60, 112),
      L('• secondo elemento', 60, 124),
      L('1. passo uno', 60, 136),
      L('2. passo due', 60, 148),
    ];
    const b = ricostruisciPagina(f, { width: 600 });
    const lists = b.filter((x) => x.type === 'list');
    expect(lists).toHaveLength(4);
    expect(lists[0]).toMatchObject({ ordered: false, text: 'primo elemento' });
    expect(lists[2]).toMatchObject({ ordered: true, text: '1. passo uno' });
  });

  it('grassetto e corsivo diventano run separati', () => {
    const f = [
      { str: 'Testo ', x: 50, y: 100, w: 30, size: 10, bold: false, italic: false },
      { str: 'importante', x: 80, y: 100, w: 50, size: 10, bold: true, italic: false },
      { str: ' e ', x: 130, y: 100, w: 15, size: 10, bold: false, italic: false },
      { str: 'corsivo', x: 145, y: 100, w: 35, size: 10, bold: false, italic: true },
    ];
    const [p] = ricostruisciPagina(f, { width: 600 });
    expect(p.runs).toEqual([
      { text: 'Testo ', bold: false, italic: false },
      { text: 'importante', bold: true, italic: false },
      { text: ' e ', bold: false, italic: false },
      { text: 'corsivo', bold: false, italic: true },
    ]);
  });

  it('caratteri accentati e simboli restano intatti', () => {
    const s = 'Perché è così? Costo: 1.234,56 € — «citazione» ½ ∑ ✓';
    const [p] = ricostruisciPagina([L(s, 50, 100)], { width: 600 });
    expect(p.text).toBe(s);
  });
});

describe('colonne e ordine di lettura', () => {
  const colonne = () => {
    const f = [];
    for (let i = 0; i < 6; i++) {
      f.push(L(`Sinistra riga ${i} con un testo abbastanza lungo qui`, 40, 200 + i * 12));
      f.push(L(`Destra riga ${i} con un testo abbastanza lungo qui`, 320, 200 + i * 12));
    }
    return f;
  };

  it('legge prima tutta la colonna sinistra, poi la destra', () => {
    const txt = blocchiInTesto(ricostruisciPagina(colonne(), { width: 600 }));
    expect(txt.indexOf('Sinistra riga 5')).toBeLessThan(txt.indexOf('Destra riga 0'));
    expect(txt.indexOf('Sinistra riga 0')).toBeLessThan(txt.indexOf('Sinistra riga 5'));
  });

  it('un titolo a tutta larghezza viene prima delle colonne', () => {
    const f = [L('Titolo che attraversa tutta la pagina da sinistra a destra ok ok ok ok ok ok ok ok ok ok ok', 40, 150, 10), ...colonne()];
    const txt = blocchiInTesto(ricostruisciPagina(f, { width: 600 }));
    expect(txt.indexOf('Titolo')).toBe(0);
    expect(txt.indexOf('Sinistra riga 5')).toBeLessThan(txt.indexOf('Destra riga 0'));
  });

  it('due colonne di testo non vengono scambiate per una tabella', () => {
    const segs = costruisciSegmenti(colonne());
    expect(rilevaTabelle(segs, { pageWidth: 600 })).toHaveLength(0);
    expect(ordineLettura(segs).length).toBeGreaterThanOrEqual(2);
  });
});

describe('tabelle', () => {
  it('rileva una tabella a tre colonne con celle corte', () => {
    const f = [
      L('Nome', 50, 100), L('Quantità', 200, 100), L('Prezzo', 350, 100),
      L('Mele', 50, 114), L('3', 200, 114), L('1,20 €', 350, 114),
      L('Pere', 50, 128), L('12', 200, 128), L('2,50 €', 350, 128),
    ];
    const b = ricostruisciPagina(f, { width: 600 });
    const t = b.find((x) => x.type === 'table');
    expect(t).toBeTruthy();
    expect(t.rows).toEqual([['Nome', 'Quantità', 'Prezzo'], ['Mele', '3', '1,20 €'], ['Pere', '12', '2,50 €']]);
  });

  it('celle vuote restano vuote nella colonna giusta', () => {
    const f = [
      L('A', 50, 100), L('B', 200, 100), L('C', 350, 100),
      L('a1', 50, 114), L('c1', 350, 114),
      L('a2', 50, 128), L('b2', 200, 128), L('c2', 350, 128),
    ];
    const t = ricostruisciPagina(f, { width: 600 }).find((x) => x.type === 'table');
    expect(t.rows[1]).toEqual(['a1', '', 'c1']);
  });
});
