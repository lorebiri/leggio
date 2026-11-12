import { describe, it, expect } from 'vitest';
import { segnaturaTitulus, segnatureTitulus, compilaModelli, valutaNome, nomePulito, dichiaraPdfA, valutaPerTitulus, trovaStrisce, ripulisciOcr, correggiSecondoMaschera } from '../src/renderer/features/avanzati/lib/titulus.js';
import { righeTimbro } from '../src/renderer/features/avanzati/lib/protocollo.js';
import { OPERAZIONI } from '../src/renderer/features/avanzati/lib/batch-ops.js';
import * as protocollo from '../src/renderer/features/avanzati/lib/protocollo.js';

describe('segnatura di Titulus', () => {
  it('formato del CNR: «Prot. CNR n. 0123456 del 01/10/2026 - UOR: XX000001»', () => {
    expect(segnaturaTitulus('Prot. CNR n. 0123456 del 01/10/2026 - UOR: XX000001')).toEqual(expect.objectContaining({ aoo: 'CNR', numero: '0123456', numeroIntero: 123456, data: '2026-10-01', uor: 'XX000001', origine: 'testo' }));
    expect(segnaturaTitulus('Prot. CNR n. 0123456 del 01/10/2026', { origine: 'immagine' })).toMatchObject({ uor: '', origine: 'immagine' });
  });
  it('formato del CNR spezzato su più righe e con spazi doppi', () => {
    expect(segnaturaTitulus('Prot. CNR\nn. 0123456\ndel 01/10/2026 -\nUOR:  XX000001')).toMatchObject({ numero: '0123456', uor: 'XX000001' });
  });
  it('formati generici con AOO prima, zeri iniziali, numero/anno, punti, trattino, maiuscole', () => {
    expect(segnaturaTitulus('Spett.le ditta\nCNR-ICCOM Prot. n. 0012345 del 12/11/2026\nOggetto: affidamento')).toMatchObject({ aoo: 'CNR-ICCOM', numero: '0012345', numeroIntero: 12345, data: '2026-11-12' });
    expect(segnaturaTitulus('Protocollo n° 4567/2026 del 03.02.2026')).toMatchObject({ numero: '4567', anno: '2026', data: '2026-02-03', aoo: '' });
    expect(segnaturaTitulus('AOO ICCOM - PROT. 0004567 - 12/11/2026 - Tit. III Cl. 2')).toMatchObject({ aoo: 'AOO ICCOM', numero: '0004567', data: '2026-11-12', classifica: 'III Cl. 2' });
    expect(segnaturaTitulus('prot. nr. 00099 in data 1/2/26')).toMatchObject({ numeroIntero: 99, data: '2026-02-01' });
    expect(segnaturaTitulus('12/11/2026 - Prot. n. 0000077')).toMatchObject({ numeroIntero: 77, data: '2026-11-12' });
  });
  it('classificazione e fascicolo dopo la segnatura', () => {
    expect(segnaturaTitulus('ICCOM-CNR\nProt. n.\n0012345\ndel\n12/11/2026\nClassificazione: III/2\nFascicolo n. 2026-III/2.15')).toMatchObject({ aoo: 'ICCOM-CNR', numero: '0012345', classifica: 'III/2', fascicolo: '2026-III/2.15' });
  });
  it('ignora date impossibili, testo senza segnatura e doppioni', () => {
    expect(segnaturaTitulus('Prot. n. 12 del 31/02/2026')).toBeNull();
    expect(segnaturaTitulus('Il protocollo d\'intesa del 2026')).toBeNull();
    expect(segnatureTitulus('Prot. n. 0012 del 01/01/2026 … Prot. n. 12 del 01/01/2026 … Prot. n. 13 del 02/01/2026').map((x) => x.numeroIntero)).toEqual([12, 13]);
  });
  it('modelli configurabili (con i gruppi obbligatori)', () => {
    const modelli = [String.raw`Reg\. (?<numero>\d+) dd\. (?<data>\d{2}/\d{2}/\d{4})`];
    expect(segnaturaTitulus('Reg. 55 dd. 10/10/2026', { modelli })).toMatchObject({ numero: '55', data: '2026-10-10' });
    expect(() => compilaModelli(['(?<numero>\\d+)'])).toThrow(/gruppi/);
    expect(() => compilaModelli(['(?<numero>[)(?<data>x)'])).toThrow(/non è valido/);
  });
  it('testo letto dall\'OCR con errori tipici', () => {
    expect(segnaturaTitulus(ripulisciOcr('Pr0t. CNR n, 01234O6 del 01/10/2026 - UOR: XX000001'))).toMatchObject({ numero: '0123406', data: '2026-10-01' });
  });
  it('corregge la UOR letta dall\'OCR secondo la maschera', () => {
    expect(correggiSecondoMaschera('X1000001', 'AA999999')).toBe('XI000001');
    expect(correggiSecondoMaschera('XXOOO0O1', 'AA999999')).toBe('XX000001');
    expect(correggiSecondoMaschera('X100001', 'AA999999')).toBe('X100001'); // lunghezza diversa: invariato
    expect(segnaturaTitulus('Prot. CNR n. 0123456 del 01/10/2026 - UOR: X1000001', { origine: 'immagine', mascheraUor: 'AA999999' }).uor).toBe('XI000001');
    expect(segnaturaTitulus('Prot. CNR n. 0123456 del 01/10/2026 - UOR: X1000001').uor).toBe('X1000001'); // nel testo non si corregge
  });
  it('trova la striscia verticale sul margine sinistro (immagine stretta e alta)', () => {
    const pagina = { x: 0, y: 0, w: 595, h: 842 };
    const striscia = { transform: [23, 0, 0, 830, 8, 6] }; // 23 × 830 pt a 8 pt dal bordo
    const foto = { transform: [300, 0, 0, 200, 100, 400] };
    const lontana = { transform: [23, 0, 0, 830, 300, 6] };
    const ruotata = { transform: [0, 830, -23, 0, 31, 6] }; // stessa striscia disegnata ruotata
    const r = trovaStrisce([foto, lontana, striscia, ruotata], pagina);
    expect(r).toHaveLength(2);
    expect(r[0]).toMatchObject({ verticale: true, lato: 'sinistra' });
    expect(r[0].rect.map(Math.round)).toEqual([8, 6, 31, 836]);
  });
});

describe('prepara per Titulus', () => {
  it('nomi', () => {
    expect(valutaNome('scan0001.pdf').ok).toBe(false);
    expect(valutaNome('Determina 12-2026 affidamento.pdf').ok).toBe(true);
    expect(valutaNome('fattura#3?.pdf').motivi).toContain('contiene caratteri speciali');
    expect(nomePulito('Offerta économica #3.pdf.p7m')).toBe('Offerta_economica_3.pdf.p7m');
  });
  it('PDF/A dai metadati XMP', () => {
    expect(dichiaraPdfA('<pdfaid:part>2</pdfaid:part>')).toBe(2);
    expect(dichiaraPdfA('pdfaid:part="3"')).toBe(3);
    expect(dichiaraPdfA('<x/>')).toBe(0);
  });
  it('valutazione: protetto, firma non valida, non PDF/A, grande, nome', () => {
    const a = valutaPerTitulus({ nome: 'scan01.pdf', dimensione: 40 * 1048576, tipo: 'pdf', leggibile: true, protetto: false, pdfa: 0 });
    expect(a.problemi).toEqual([]);
    expect(a.azioni).toEqual({ pdfa: true, riduci: true, rinomina: true });
    const b = valutaPerTitulus({ nome: 'contratto.pdf.p7m', dimensione: 1000, tipo: 'p7m', esitoFirma: 'invalid' });
    expect(b.problemi.join()).toMatch(/NON è valida/);
    expect(b.azioni.pdfa).toBe(false);
    expect(valutaPerTitulus({ nome: 'x.pdf', tipo: 'pdf', protetto: true, dimensione: 1 }).problemi.join()).toMatch(/password/);
    expect(valutaPerTitulus({ nome: 'firmato.pdf', tipo: 'pdf', firmato: true, dimensione: 50 * 1048576 }).azioni).toEqual({ pdfa: false, riduci: false, rinomina: false });
  });
});

describe('niente numerazione di protocollo in Leggio', () => {
  it('nessun contatore e nessuna operazione di protocollo nelle Azioni guidate', () => {
    expect(protocollo.contatoreCorrente).toBeUndefined();
    expect(protocollo.avanzaContatore).toBeUndefined();
    expect(OPERAZIONI.find((o) => o.id === 'protocollo')).toBeUndefined();
  });
  it('la segnatura su copia riporta il numero com\'è e la dicitura di copia', () => {
    expect(righeTimbro({ ente: 'ICCOM-CNR', numero: '0012345', data: '12/11/2026', copia: true }).map((r) => r.testo)).toEqual(['ICCOM-CNR', 'Prot. n. 0012345 del 12/11/2026', 'Copia di lavoro — originale in Titulus']);
  });
});

describe('segnatura su copia di lavoro «come Titulus»', async () => {
  const PDFLib = await import('@cantoo/pdf-lib');
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const { applicaStriscia, testoStriscia } = await import('../src/renderer/features/avanzati/lib/protocollo.js');
  it('scrive la striscia verticale e la segnatura si rilegge dal testo', async () => {
    expect(testoStriscia({ aoo: 'CNR', numero: '0123456', data: '01/10/2026', uor: 'XX000001' })).toBe('Prot. CNR n. 0123456 del 01/10/2026 - UOR: XX000001');
    const d = await PDFLib.PDFDocument.create(); d.addPage([595, 842]);
    await applicaStriscia(d, PDFLib, { aoo: 'CNR', numero: '0123456', data: '01/10/2026', uor: 'XX000001', copia: true });
    const pdf = await pdfjs.getDocument({ data: await d.save(), isEvalSupported: false }).promise;
    const items = (await (await pdf.getPage(1)).getTextContent()).items;
    const testo = items.map((i) => i.str).join(' ');
    expect(segnaturaTitulus(testo)).toMatchObject({ aoo: 'CNR', numero: '0123456', uor: 'XX000001', data: '2026-10-01' });
    // verticale: la matrice del testo è ruotata di 90°
    expect(Math.round(items[0].transform[1])).toBeGreaterThan(0);
    expect(items[0].transform[4]).toBeLessThan(40);
    await pdf.loadingTask.destroy();
  });
});
