import { describe, it, expect } from 'vitest';
import { leggiRegistro, nuovoRegistro, daFare, segna, finito, riepilogo, percorsoUscita, chiaveFile } from '../src/renderer/features/conversione/lib/registro.js';

const f = (rel, size = 100, mtimeMs = 1000) => ({ rel, size, mtimeMs });
describe('registro per riprendere un lavoro interrotto', () => {
  it('salta i file finiti e non cambiati, rifà quelli cambiati o falliti', () => {
    const r = nuovoRegistro();
    segna(r, f('a.pdf'), 'fatto', { pagine: 3, ms: 3000 });
    segna(r, f('b.pdf'), 'gia-testo');
    segna(r, f('c.pdf'), 'errore', { motivo: 'danneggiato' });
    segna(r, f('d.pdf'), 'fatto');
    const elenco = [f('a.pdf'), f('b.pdf'), f('c.pdf'), f('d.pdf', 200), f('e.pdf')];
    const { fare, fatti } = daFare(elenco, r);
    expect(fatti.map((x) => x.rel)).toEqual(['a.pdf', 'b.pdf']);
    expect(fare.map((x) => x.rel)).toEqual(['c.pdf', 'd.pdf', 'e.pdf']);
    expect(finito(r, f('a.pdf', 100, 1000.4))).toBe(true);
    expect(riepilogo(r)).toMatchObject({ fatto: 2, 'gia-testo': 1, errore: 1, pagine: 3 });
  });
  it('registro illeggibile o di altra versione → nuovo', () => {
    expect(leggiRegistro('{rotto').voci).toEqual({});
    expect(leggiRegistro(JSON.stringify({ versione: 99, voci: { x: 1 } })).voci).toEqual({});
    const r = nuovoRegistro(); segna(r, f('x.pdf'), 'fatto');
    expect(leggiRegistro(new TextEncoder().encode(JSON.stringify(r))).voci['x.pdf'].chiave).toBe(chiaveFile(f('x.pdf')));
  });
  it('percorso di uscita senza uscire dalla cartella', () => {
    expect(percorsoUscita('/out/', 'sotto/a.pdf')).toBe('/out/sotto/a.pdf');
    expect(percorsoUscita('/out', '../../etc/x.pdf')).toBe('/out/etc/x.pdf');
    expect(percorsoUscita('C:\\out', 'a\\b.pdf', '\\')).toBe('C:\\out\\a\\b.pdf');
  });
});
