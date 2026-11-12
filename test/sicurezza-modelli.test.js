import { describe, it, expect } from 'vitest';
import { codiceFiscaleValido, ibanValido, partitaIvaValida, luhnValido, buildMatchers, findMatches } from '../src/renderer/features/sicurezza/logica/modelli.js';
import { parseOps, xobjectPlacements, placedSize, hiddenRanges, cutRanges } from '../src/renderer/features/sicurezza/logica/flusso.js';
import { passwordStrength, fromPValue, toLibPermissions, hasRestrictions, TUTTI_PERMESSI } from '../src/renderer/features/sicurezza/logica/cifratura.js';

const testo = (s) => findMatches(s, buildMatchers({ models: ['cf', 'iban', 'piva', 'email', 'tel', 'targa', 'carta'] })).map((h) => [h.matcher, h.text]);

describe('modelli italiani', () => {
  it('verifica le somme di controllo', () => {
    expect(codiceFiscaleValido('RSSMRA85T10A562S')).toBe(true);
    expect(codiceFiscaleValido('RSSMRA85T10A562T')).toBe(false);
    expect(codiceFiscaleValido('rssmra85t10a562s')).toBe(true);
    expect(ibanValido('IT60 X054 2811 1010 0000 0123 456')).toBe(true);
    expect(ibanValido('IT61X0542811101000000123456')).toBe(false);
    expect(ibanValido('DE89370400440532013000')).toBe(true);
    expect(partitaIvaValida('12345678903')).toBe(true);
    expect(partitaIvaValida('12345678901')).toBe(false);
    expect(partitaIvaValida('00000000000')).toBe(false);
    expect(luhnValido('4111 1111 1111 1111')).toBe(true);
    expect(luhnValido('4111 1111 1111 1112')).toBe(false);
  });
  it('trova i dati in un testo misto, scarta i falsi positivi', () => {
    const r = testo('CF RSSMRA85T10A562S, falso RSSMRA85T10A562T; IBAN IT60 X054 2811 1010 0000 0123 456; P.IVA 12345678903 e 12345678901; scrivi a mario.rossi@cnr.it o chiama 333 123 4567 / 050 3152 111; targa AB 123 CD; carta 4111 1111 1111 1111.');
    const labels = r.map((x) => x[0] + ':' + x[1]);
    expect(labels).toContain('Codice fiscale:RSSMRA85T10A562S');
    expect(labels).not.toContain('Codice fiscale:RSSMRA85T10A562T');
    expect(labels).toContain('IBAN:IT60 X054 2811 1010 0000 0123 456');
    expect(labels).toContain('Partita IVA:12345678903');
    expect(labels.some((l) => l.includes('12345678901'))).toBe(false);
    expect(labels).toContain('Indirizzo email:mario.rossi@cnr.it');
    expect(labels).toContain('Numero di telefono:333 123 4567');
    expect(labels).toContain('Numero di telefono:050 3152 111');
    expect(labels).toContain('Targa:AB 123 CD');
    expect(labels).toContain('Numero di carta di pagamento:4111 1111 1111 1111');
  });
  it('parole, parola intera, maiuscole, regex', () => {
    const m = buildMatchers({ terms: ['Rossi'], wholeWord: true });
    expect(findMatches('Rossi, Rossini e ROSSI', m).map((h) => h.text)).toEqual(['Rossi', 'ROSSI']);
    expect(findMatches('Rossi e ROSSI', buildMatchers({ terms: ['Rossi'], caseSensitive: true })).length).toBe(1);
    expect(() => buildMatchers({ regex: '([' })).toThrow(/non è valida/);
    expect(() => buildMatchers({ regex: 'a*' })).toThrow(/vuoto/);
    expect(findMatches('prot. 123/2026 e 45/2025', buildMatchers({ regex: '\\d+/\\d{4}' })).length).toBe(2);
    expect(findMatches('', buildMatchers({ models: ['cf'] }))).toEqual([]);
  });
});

describe('flussi di contenuto', () => {
  const enc = (s) => new TextEncoder().encode(s);
  it('trova posizione e dimensione delle immagini', () => {
    const ops = parseOps(enc('q 200 0 0 100 50 60 cm /Im1 Do Q q 0.5 0 0 0.5 0 0 cm q 100 0 0 100 0 0 cm /Im2 Do Q Q BT (a\\)b) Tj ET'));
    const pl = xobjectPlacements(ops);
    expect(pl.map((p) => p.name)).toEqual(['Im1', 'Im2']);
    expect(placedSize(pl[0].ctm)).toEqual({ w: 200, h: 100 });
    expect(placedSize(pl[1].ctm)).toEqual({ w: 50, h: 50 });
  });
  it('toglie il contenuto dei livelli nascosti', () => {
    const src = 'BT (visibile) Tj ET /OC /oc1 BDC BT (segreto) Tj ET /P BMC (x) Tj EMC EMC /OC /oc2 BDC (ok) Tj EMC q /ImSegreta Do Q';
    const b = enc(src);
    const ops = parseOps(b);
    const ranges = hiddenRanges(ops, { isHiddenProp: (n) => n === 'oc1', isHiddenXObject: (n) => n === 'ImSegreta' });
    const out = new TextDecoder().decode(cutRanges(b, ranges));
    expect(out).toContain('visibile'); expect(out).toContain('(ok)');
    expect(out).not.toContain('segreto'); expect(out).not.toContain('ImSegreta');
  });
  it('non si blocca su dati malformati', () => {
    const junk = new Uint8Array(20000); for (let i = 0; i < junk.length; i++) junk[i] = (i * 7919) % 256;
    expect(() => parseOps(junk)).not.toThrow();
    expect(() => parseOps(enc('<< /A [ (unbalanced BI ID xx'))).not.toThrow();
    expect(parseOps(enc('BI /W 1 /H 1 /CS /G /BPC 8 ID \x00 EI q Q')).map((o) => o.op)).toEqual(['BI', 'q', 'Q']);
  });
});

describe('password e permessi', () => {
  it('robustezza', () => {
    expect(passwordStrength('').score).toBe(0);
    expect(passwordStrength('123456').score).toBeLessThanOrEqual(1);
    expect(passwordStrength('password2024').score).toBeLessThanOrEqual(1);
    expect(passwordStrength('Tr3no-Lento-Pisa!').score).toBeGreaterThanOrEqual(3);
    expect(passwordStrength('cavallo batteria graffetta corretta').score).toBe(4);
  });
  it('conversione permessi', () => {
    const p = { stampa: 'low', modifica: false, copia: false, commenti: true, moduli: true, assemblaggio: false };
    expect(toLibPermissions(p).printing).toBe('lowResolution');
    expect(fromPValue(-3100)).toEqual(p);
    expect(hasRestrictions(TUTTI_PERMESSI)).toBe(false);
    expect(hasRestrictions(p)).toBe(true);
  });
});
