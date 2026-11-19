import { describe, it, expect } from 'vitest';
import {
  passaggi, pagineDaTesto, parole, bm25, ordina, fondi, coseni, scegliContesto, messaggiDomanda,
  leggiRisposta, daEvidenziare, stimaToken, testoConPagine, haCodici, MAX_TOKEN_INTERO, verificaPagina,
} from '../src/renderer/features/ia/lib/passaggi.js';

const lungo = (n) => Array.from({ length: n }, (_, i) => `parola${i}`).join(' ');

describe('assistente IA: passaggi e ricerca', () => {
  it('divide le pagine in passaggi con la pagina giusta, senza tagliare le parole', () => {
    const pz = passaggi([{ n: 1, testo: lungo(300) }, { n: 2, testo: '  ' }, { n: 3, testo: 'breve testo' }]);
    expect(pz.length).toBeGreaterThan(3);
    expect(pz.every((p) => p.testo.length <= 600)).toBe(true);
    expect(pz.at(-1)).toMatchObject({ pagina: 3, testo: 'breve testo' });
    expect(pz.some((p) => p.pagina === 2)).toBe(false);
    for (const p of pz.filter((x) => x.pagina === 1)) expect(p.testo).toMatch(/^\S.*\S$/);
    // le parole non vengono spezzate (ogni pezzo è una sequenza di parole intere)
    for (const p of pz.filter((x) => x.pagina === 1)) expect(p.testo.split(' ').every((w) => /^parola\d+$/.test(w) || w === '')).toBe(true);
  });

  it('legge le pagine dal testo dell\'archivio (separate da \\f)', () => {
    expect(pagineDaTesto('uno\fdue\f')).toEqual([{ n: 1, testo: 'uno' }, { n: 2, testo: 'due' }, { n: 3, testo: '' }]);
  });

  it('parole: minuscole, senza accenti e senza parole vuote', () => {
    expect(parole('Qual è l\'IMPORTO dell\'affidamento? CIG B8A11ABCA1')).toEqual(['importo', 'dell', 'affidamento', 'cig', 'b8a11abca1']);
  });

  it('BM25 mette prima il passaggio con le parole della domanda', () => {
    const pz = [{ testo: 'il servizio di pulizia degli uffici' }, { testo: 'il responsabile del procedimento è Anna Bianchi' }, { testo: 'importo di euro 12.500' }];
    expect(ordina(bm25(pz, 'Chi è il responsabile del procedimento?'))[0]).toBe(1);
    expect(ordina(bm25(pz, 'importo'))[0]).toBe(2);
  });

  it('fusione dei ranghi e coseno', () => {
    expect(fondi([[2, 0, 1], [2, 1, 0]])[0]).toBe(2);
    const c = coseni([[1, 0], [0, 1], [0.7, 0.7]], [1, 0]);
    expect(c[0]).toBeCloseTo(1); expect(c[1]).toBeCloseTo(0); expect(c[2]).toBeCloseTo(Math.SQRT1_2, 2);
    expect(haCodici('CIG B8A11ABCA1')).toBe(true);
    expect(haCodici('posti letto per i senzatetto')).toBe(false);
  });

  it('documento corto: va intero; lungo: solo i passaggi pertinenti, in ordine di pagina', () => {
    const corto = [{ n: 1, testo: 'Il RUP è Anna Bianchi.' }, { n: 2, testo: 'Importo 100 euro.' }];
    const c = scegliContesto(corto, 'chi è il rup');
    expect(c.modo).toBe('intero');
    expect(c.testo).toBe(testoConPagine(corto));
    expect(c.pagine).toEqual([1, 2]);

    const pagine = Array.from({ length: 30 }, (_, i) => ({ n: i + 1, testo: lungo(400) }));
    pagine[21].testo += ' Il responsabile unico del procedimento è la dottoressa Elena Masini.';
    expect(stimaToken(testoConPagine(pagine))).toBeGreaterThan(MAX_TOKEN_INTERO);
    const r = scegliContesto(pagine, 'Chi è il responsabile del procedimento?');
    expect(r.modo).toBe('passaggi');
    expect(r.pagine).toContain(22);
    expect(r.testo).toMatch(/=== Pagina 22 ===[\s\S]*Elena Masini/);
    expect(stimaToken(r.testo)).toBeLessThan(2000);
  });

  it('con i vettori la ricerca per significato contribuisce alla scelta', () => {
    const pagine = Array.from({ length: 30 }, (_, i) => ({ n: i + 1, testo: lungo(400) }));
    const pz = passaggi(pagine);
    const vettori = pz.map((p) => (p.pagina === 9 ? [1, 0] : [0, 1]));
    const r = scegliContesto(pagine, 'domanda senza parole in comune', { pz, vettori, vettoreDomanda: [1, 0] });
    expect(r.pagine).toContain(9);
  });

  it('messaggi: il documento sta prima della domanda (cache del prompt)', () => {
    const m = messaggiDomanda('=== Pagina 1 ===\nTesto', 'Chi firma?');
    expect(m[0].role).toBe('system');
    expect(m[1].content.indexOf('Testo')).toBeLessThan(m[1].content.indexOf('Chi firma?'));
  });

  it('legge la risposta, riconosce «non presente» e verifica la pagina', () => {
    expect(leggiRisposta('{"risposta": "Ing. Flavio Tagliapietra", "pagina": 5}', { pagineValide: [4, 5] }))
      .toEqual({ trovata: true, risposta: 'Ing. Flavio Tagliapietra', pagina: 5, paginaVerificata: true });
    expect(leggiRisposta('```json\n{"risposta":"7.900,84","pagina":"4"}\n```', { pagineValide: [1] })).toMatchObject({ trovata: true, pagina: 4, paginaVerificata: false });
    expect(leggiRisposta('{"risposta": "non presente", "pagina": null}')).toMatchObject({ trovata: false, risposta: '', pagina: null });
    expect(leggiRisposta('Non è indicato nel documento.')).toMatchObject({ trovata: false });
    expect(leggiRisposta('')).toMatchObject({ trovata: false });
  });

  it('trova cosa evidenziare nella pagina citata', () => {
    const pag = 'Si affida all\'arch. Gisella Lanciaprima il servizio per euro 7.900,84 oltre IVA.';
    expect(daEvidenziare('euro 7.900,84', pag)).toBe('euro 7.900,84');
    expect(daEvidenziare('7.900,84 euro IVA esclusa', pag)).toBe('7.900,84');
    expect(daEvidenziare('arch. Gisella Lanciaprima (professionista)', pag)).toBe('arch. Gisella Lanciaprima');
    expect(daEvidenziare('qualcosa che non c\'è', pag)).toBe('');
  });
});

describe('assistente IA: verifica della pagina citata', () => {
  const pagine = [{ n: 1, testo: 'Oggetto: affidamento.' }, { n: 5, testo: 'Il responsabile unico del progetto è l\'Ing. Flavio Tagliapietra.' }, { n: 6, testo: 'Firma: la dirigente.' }, { n: 9, testo: 'Copia: Ing. Flavio Tagliapietra' }];
  it('pagina giusta: confermata con il testo da evidenziare', () => {
    expect(verificaPagina('Ing. Flavio Tagliapietra', 5, pagine)).toEqual({ pagina: 5, evidenzia: 'Ing. Flavio Tagliapietra', verificata: true, corretta: false });
  });
  it('pagina sbagliata: si sceglie la più vicina che contiene davvero la risposta', () => {
    expect(verificaPagina('Ing. Flavio Tagliapietra', 6, pagine)).toMatchObject({ pagina: 5, verificata: true, corretta: true });
    expect(verificaPagina('Ing. Flavio Tagliapietra', 8, pagine)).toMatchObject({ pagina: 9, corretta: true });
    expect(verificaPagina('Ing. Flavio Tagliapietra', null, pagine)).toMatchObject({ pagina: 5, corretta: true });
    // solo tra le pagine lette dal modello
    expect(verificaPagina('Ing. Flavio Tagliapietra', 6, pagine, [6, 9])).toMatchObject({ pagina: 9 });
  });
  it('risposta che non si ritrova nel testo: pagina da controllare', () => {
    expect(verificaPagina('Mario Rossi', 6, pagine)).toEqual({ pagina: 6, evidenzia: '', verificata: false, corretta: false });
  });
});
