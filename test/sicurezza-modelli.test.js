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

describe('modelli che non si sovrappongono (terzo giro della segreteria)', () => {
  const trova = (t, models) => findMatches(t, buildMatchers({ models })).map((h) => `${h.matcher}: ${h.text}`);
  const INCARICO = [
    'DETERMINA DI AFFIDAMENTO INCARICO PROFESSIONALE',
    'Il sottoscritto Mario Rossi, nato a Pisa (PI) il 10/12/1985, codice fiscale RSSMRA85T10A562S,',
    'residente in Via Verdi 3, 56124 Pisa, tel. 050 315 2111, cellulare 333 123 4567 / +39 347 9876543,',
    'email mario.rossi@example.it, IBAN IT60 X054 2811 1010 0000 0123 456.',
    'Ente: ICCOM-CNR, C.F. 80054330586 – P.IVA 02118311006, Via Moruzzi 1, Pisa.',
    'Ditta: Alfa Srl, Partita IVA 12345678903, con sede in Piazza dei Miracoli 12/B 56126 Pisa (PI).',
    'Prot. n. 0012345 del 01/02/2026, CIG Z9F8E7D6C5. Fattura n. 0503152111 del 3 marzo 2026.',
  ].join('\n');
  it('con «Partita IVA» non spuntata le P.IVA restano visibili (nessun telefono falso)', () => {
    const r = trova(INCARICO, ['cf', 'iban', 'email', 'tel']);
    expect(r).toEqual([
      'Codice fiscale: RSSMRA85T10A562S',
      'Numero di telefono: 050 315 2111',
      'Numero di telefono: 333 123 4567',
      'Numero di telefono: +39 347 9876543',
      'Indirizzo email: mario.rossi@example.it',
      'IBAN: IT60 X054 2811 1010 0000 0123 456',
    ]);
    expect(r.join(' ')).not.toMatch(/12345678903|02118311006|80054330586|0012345|0503152111/);
  });
  it('con «Partita IVA» spuntata si trovano le P.IVA, come P.IVA', () => {
    const r = trova(INCARICO, ['piva', 'tel']);
    expect(r).toContain('Partita IVA: 12345678903');
    expect(r).toContain('Partita IVA: 02118311006');
    expect(r.filter((x) => x.startsWith('Numero di telefono'))).toHaveLength(3);
  });
  it('indirizzi e date di nascita (modelli facoltativi)', () => {
    const r = trova(INCARICO, ['indirizzo', 'nascita']);
    expect(r).toContain('Luogo e data di nascita: Pisa (PI) il 10/12/1985');
    expect(r).toContain('Indirizzo (via e numero, CAP e comune): Via Verdi 3, 56124 Pisa');
    expect(r).toContain('Indirizzo (via e numero, CAP e comune): Piazza dei Miracoli 12/B 56126 Pisa (PI)');
    expect(r).toContain('Indirizzo (via e numero, CAP e comune): Via Moruzzi 1');
    expect(trova('Data di nascita: 05/06/1970. Nata a San Giuliano Terme il 3 marzo 1990.', ['nascita']))
      .toEqual(['Luogo e data di nascita: 05/06/1970', 'Luogo e data di nascita: San Giuliano Terme il 3 marzo 1990']);
    // le date dei documenti non sono date di nascita
    expect(trova('Determina del 01/02/2026, scadenza 31/12/2026.', ['nascita'])).toEqual([]);
    expect(trova('Totale 12345 Euro', ['indirizzo'])).toEqual([]);
  });
  it('telefono: date, importi e numeri di protocollo non sono telefoni', () => {
    expect(trova('il 01/02/2026 alle 10', ['tel'])).toEqual([]);
    expect(trova('Prot. n. 0012345678', ['tel'])).toEqual([]);
    expect(trova('chiamare lo 055 2345678 o lo 0039 06 12345678', ['tel'])).toHaveLength(2);
  });
});
