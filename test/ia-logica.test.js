import { describe, it, expect } from 'vitest';
import { valuta, servono, mancanti, spazioSufficiente, formatoGB, AVVERTENZA } from '../src/renderer/features/ia/lib/requisiti.js';
import { daIndicizzare, fondiRisultati, indicizzabile } from '../src/renderer/features/ia/lib/archivio.js';

const GB = 1024 ** 3;
const stato = (x = {}) => ({
  piattaformaSupportata: true, piattaforma: 'win32-x64',
  ram: { totale: 16 * GB, libera: 9 * GB }, cpu: { avx2: true, arch: 'x64' }, discoLibero: 50 * GB,
  motore: { installato: false, byte: 25e6 },
  modelli: { principale: { installato: false, byte: 3.1e9 }, leggero: { installato: true, byte: 1.3e9 }, embedding: { installato: false, byte: 1.2e8 } },
  ...x,
});

describe('assistente IA: requisiti del PC', () => {
  it('16 GB: modello principale; 8 GB con poca RAM libera: leggero; 4 GB: no', () => {
    expect(valuta(stato())).toMatchObject({ adatto: true, consigliato: 'principale' });
    expect(valuta(stato({ ram: { totale: 7.8 * GB, libera: 3 * GB } }))).toMatchObject({ adatto: true, consigliato: 'leggero' });
    expect(valuta(stato({ ram: { totale: 7.8 * GB, libera: 5.5 * GB } })).consigliato).toBe('principale');
    expect(valuta(stato({ ram: { totale: 7 * GB, libera: 5 * GB } }))).toMatchObject({ adatto: true, consigliato: 'leggero' });
    expect(valuta(stato({ ram: { totale: 7 * GB, libera: 5 * GB } })).avvisi[0]).toMatch(/modello leggero/);
    expect(valuta(stato({ ram: { totale: 4 * GB, libera: 1 * GB } }))).toMatchObject({ adatto: false });
  });

  it('senza AVX2 o su sistemi non supportati l\'assistente non si attiva', () => {
    expect(valuta(stato({ cpu: { avx2: false, arch: 'x64' } })).bloccante).toMatch(/AVX2/);
    expect(valuta(stato({ cpu: { avx2: null, arch: 'arm64' }, piattaforma: 'darwin-arm64' })).adatto).toBe(true);
    expect(valuta(stato({ piattaformaSupportata: false })).adatto).toBe(false);
  });

  it('cosa manca da scaricare e se c\'è spazio', () => {
    expect(servono('domande', 'leggero')).toEqual(['motore', 'leggero', 'embedding']);
    expect(servono('archivio')).toEqual(['motore', 'embedding']);
    const m = mancanti(stato(), servono('domande', 'principale'));
    expect(m.componenti).toEqual(['motore', 'principale', 'embedding']);
    expect(m.byte).toBe(25e6 + 3.1e9 + 1.2e8);
    expect(mancanti(stato(), ['leggero']).componenti).toEqual([]);
    expect(spazioSufficiente(stato(), m.byte)).toBe(true);
    expect(spazioSufficiente(stato({ discoLibero: 2 * GB }), m.byte)).toBe(false);
    expect(formatoGB(3.1e9)).toBe('2,9 GB');
    expect(AVVERTENZA).toMatch(/aiuto da verificare/);
  });
});

describe('assistente IA: ricerca per significato nell\'archivio', () => {
  const r = (id, impronta, x = {}) => ({ id, impronta, nome: id + '.pdf', pagine: 2, ...x });

  it('indicizza solo i documenti nuovi con testo e toglie quelli spariti', () => {
    const righe = [r('a', 'i1'), r('b', 'i2'), r('copia-di-a', 'i1'), r('scan', 'i3', { scansione: true }), r('prot', 'i4', { protetto: true }), r('vuoto', 'i5', { pagine: 0 }), r('senza', '')];
    const d = daIndicizzare(righe, ['i2', 'vecchia']);
    expect(d.nuovi.map((x) => x.id)).toEqual(['a']);
    expect(d.vecchi).toEqual(['vecchia']);
    expect(d.totale).toBe(2);
    expect(indicizzabile(r('x', 'i9', { errore: 'danneggiato' }))).toBe(false);
  });

  it('unisce significato e parole; con codici e numeri le parole pesano di più', () => {
    const per = new Map([['i1', r('a', 'i1')], ['i2', r('b', 'i2')], ['i3', r('c', 'i3')]]);
    const sem = [{ impronta: 'i1', pagina: 3, testo: 'posti letto per senzatetto', punteggio: 0.8 }, { impronta: 'i2', pagina: 1, testo: 'altro', punteggio: 0.5 }];
    const par = [{ impronta: 'i3', pagina: 7, id: 'c' }, { impronta: 'i2', pagina: 2, id: 'b' }];
    const a = fondiRisultati('accoglienza invernale', sem, par, per);
    // trovato in tutti e due i modi: primo; poi il migliore per significato, poi quello solo per parole
    expect(a.map((x) => x.riga.id)).toEqual(['b', 'a', 'c']);
    expect(a[0]).toMatchObject({ perSignificato: true, perParole: true, pagina: 1 });
    expect(a[1]).toMatchObject({ pagina: 3, perSignificato: true, perParole: false, estratto: 'posti letto per senzatetto' });
    const b = fondiRisultati('CIG B8A11ABCA1', sem, par, per);
    expect(b.map((x) => x.riga.id)).toEqual(['b', 'c', 'a']);
    expect(b[0]).toMatchObject({ pagina: 2, perParole: true }); // con un codice conta la pagina dove compare
    // documenti non più nell'archivio vengono saltati
    expect(fondiRisultati('x', [{ impronta: 'sparito', pagina: 1 }], [], per)).toEqual([]);
  });
});
