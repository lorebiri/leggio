// Validatori dei dati italiani (features/personale/lib/validatori.js): esiti come avvisi, mai blocchi.
import { describe, it, expect } from 'vitest';
import {
  validaCodiceFiscale, carattereControlloCf, deomocodizza, dataNascitaDaCf, validaPartitaIva, validaIban, validaCodiceSdi,
  validaEmail, validaPec, validaCap, avvisiContatto, normalizzaCodici,
} from '../src/renderer/features/personale/lib/validatori.js';

describe('codice fiscale', () => {
  it('riconosce un codice valido (anche minuscolo e con spazi) e ne ricava i dati', () => {
    expect(validaCodiceFiscale('RSSMRA85T10A562S')).toMatchObject({ valido: true, omocodico: false, sesso: 'M', giorno: 10, mese: 12, anno2: 85, comune: 'A562' });
    expect(validaCodiceFiscale(' rssmra 85t10 a562s ')).toMatchObject({ valido: true, normalizzato: 'RSSMRA85T10A562S' });
    expect(carattereControlloCf('RSSMRA85T10A562')).toBe('S');
  });
  it('accetta le omocodie (lettere al posto delle cifre)', () => {
    const r = validaCodiceFiscale('RSSMRA85T10A56NH');
    expect(r).toMatchObject({ valido: true, omocodico: true, comune: 'A562', giorno: 10 });
    expect(deomocodizza('RSSMRA85T10A56NH')).toBe('RSSMRA85T10A562H');
  });
  it('segnala carattere di controllo errato, lunghezza e forma sbagliate, giorno impossibile', () => {
    expect(validaCodiceFiscale('RSSMRA85T10A562T')).toMatchObject({ valido: false, avviso: expect.stringMatching(/ultimo carattere/) });
    expect(validaCodiceFiscale('RSSMRA85T10A562').avviso).toMatch(/16 caratteri \(qui 15\)/);
    expect(validaCodiceFiscale('1SSMRA85T10A562S').avviso).toMatch(/forma giusta/);
    // 31 febbraio (mese B), con il carattere di controllo giusto
    const cf = 'RSSMRA85B31A562'; const pieno = cf + carattereControlloCf(cf);
    expect(validaCodiceFiscale(pieno)).toMatchObject({ valido: false, avviso: expect.stringMatching(/giorno/) });
  });
  it('donne: giorno + 40', () => {
    const cf = 'BNCLCU90A41H501'; const r = validaCodiceFiscale(cf + carattereControlloCf(cf));
    expect(r).toMatchObject({ valido: true, sesso: 'F', giorno: 1, mese: 1 });
  });
  it('codice fiscale numerico (enti e società) = controllo della partita IVA', () => {
    expect(validaCodiceFiscale('80054330586')).toMatchObject({ valido: true, tipo: 'numerico' });
    expect(validaCodiceFiscale('80054330587')).toMatchObject({ valido: false, tipo: 'numerico', avviso: expect.stringMatching(/numerico/) });
  });
  it('vuoto = valido (nessun avviso)', () => {
    expect(validaCodiceFiscale('')).toEqual({ valido: true, vuoto: true, normalizzato: '' });
    expect(validaCodiceFiscale(null).vuoto).toBe(true);
  });
  it('data di nascita dal codice fiscale, con il secolo giusto', () => {
    expect(dataNascitaDaCf('RSSMRA85T10A562S', new Date(2026, 0, 1))).toBe('10/12/1985');
    expect(dataNascitaDaCf('RSSMRA85T10A56NH', new Date(2026, 0, 1))).toBe('10/12/1985');
    const cf = 'RSSMRA05A01H501'; expect(dataNascitaDaCf(cf + carattereControlloCf(cf), new Date(2026, 0, 1))).toBe('01/01/2005');
    expect(dataNascitaDaCf('RSSMRA85T10A562T')).toBe('');
    expect(dataNascitaDaCf('80054330586')).toBe('');
  });
});

describe('partita IVA', () => {
  it('valida 11 cifre con il controllo di Luhn, anche con IT davanti', () => {
    expect(validaPartitaIva('01114601006')).toEqual({ valido: true, normalizzato: '01114601006' });
    expect(validaPartitaIva('IT 01114601006')).toEqual({ valido: true, normalizzato: '01114601006' });
    expect(validaPartitaIva('01114601007').avviso).toMatch(/ultima cifra/);
    expect(validaPartitaIva('0111460100').avviso).toMatch(/11 cifre \(qui 10\)/);
    expect(validaPartitaIva('00000000000').valido).toBe(false);
  });
  it('estera: accettata con un avviso', () => {
    expect(validaPartitaIva('DE123456789')).toMatchObject({ valido: true, estera: true, avviso: expect.stringMatching(/estera/) });
  });
});

describe('IBAN', () => {
  it('controlla lunghezza, cifre di controllo e forma italiana; restituisce il formato a gruppi', () => {
    expect(validaIban('IT60X0542811101000000123456')).toMatchObject({ valido: true, paese: 'IT', formattato: 'IT60 X054 2811 1010 0000 0123 456' });
    expect(validaIban('it60 x054 2811 1010 0000 0123 456').valido).toBe(true);
    expect(validaIban('IT60X0542811101000000123457').avviso).toMatch(/controllo/);
    expect(validaIban('IT60X054281110100000012345').avviso).toMatch(/27 caratteri/);
    expect(validaIban('123').valido).toBe(false);
    expect(validaIban('DE89370400440532013000').valido).toBe(true);
  });
});

describe('codice destinatario SDI', () => {
  it('7 caratteri (privati), 6 (PA), 0000000 (PEC), XXXXXXX (estero)', () => {
    expect(validaCodiceSdi('m5uxcr1')).toMatchObject({ valido: true, normalizzato: 'M5UXCR1', tipo: 'privato' });
    expect(validaCodiceSdi('UFABCD')).toMatchObject({ valido: true, tipo: 'pa' });
    expect(validaCodiceSdi('0000000')).toMatchObject({ valido: true, tipo: 'pec', nota: expect.stringMatching(/PEC/) });
    expect(validaCodiceSdi('XXXXXXX')).toMatchObject({ valido: true, tipo: 'estero' });
    expect(validaCodiceSdi('AB12').valido).toBe(false);
    expect(validaCodiceSdi('ABC-1234').valido).toBe(false);
  });
});

describe('email, PEC e CAP', () => {
  it('email', () => {
    expect(validaEmail('Mario.Rossi@Example.COM')).toEqual({ valido: true, normalizzato: 'mario.rossi@example.com' });
    expect(validaEmail('mario@').valido).toBe(false);
    expect(validaEmail('mario rossi@example.com').valido).toBe(false);
    expect(validaEmail('a@b').valido).toBe(false);
  });
  it('PEC: valida se il dominio sembra una PEC, altrimenti avviso di controllo', () => {
    expect(validaPec('studio@pec.it')).toEqual({ valido: true, normalizzato: 'studio@pec.it' });
    expect(validaPec('ufficio@legalmail.it').avviso).toBeUndefined();
    expect(validaPec('comune.prato@postacert.toscana.it').avviso).toBeUndefined();
    expect(validaPec('mario@gmail.com')).toMatchObject({ valido: true, dubbio: true });
    expect(validaPec('speck@gmail.com').dubbio).toBe(true); // «pec» nel nome, non nel dominio
    expect(validaPec('non valida').avviso).toMatch(/PEC/);
  });
  it('CAP a 5 cifre', () => {
    expect(validaCap('59100').valido).toBe(true);
    expect(validaCap('5910').valido).toBe(false);
  });
});

describe('contatto intero', () => {
  it('avvisiContatto elenca solo i campi con un problema', () => {
    expect(avvisiContatto({ nome: 'Mario', codiceFiscale: 'RSSMRA85T10A562S', email: 'm@example.com', cap: '59100' })).toEqual({});
    const a = avvisiContatto({ nome: 'Mario', codiceFiscale: 'RSSMRA85T10A562T', partitaIva: '123', iban: 'IT00', codiceSdi: 'X', email: 'x', pec: 'p@gmail.com', cap: '1' });
    expect(Object.keys(a).sort()).toEqual(['cap', 'codiceFiscale', 'codiceSdi', 'email', 'iban', 'partitaIva', 'pec']);
    expect(avvisiContatto({ telefono: '1' }).nome).toMatch(/Manca un nome/);
    expect(avvisiContatto({ ragioneSociale: 'Alfa' }).nome).toBeUndefined();
    expect(avvisiContatto({ nome: 'Hans', cap: 'D-10115', nazione: 'Germania' }).cap).toBeUndefined(); // CAP estero: niente avviso
  });
  it('normalizzaCodici: maiuscole e niente spazi nei codici, provincia in maiuscolo, il resto com\'era', () => {
    expect(normalizzaCodici({ nome: ' Mario ', codiceFiscale: 'rssmra 85t10a562s', partitaIva: 'IT01114601006', iban: 'it60 x054 2811 1010 0000 0123 456', codiceSdi: 'm5uxcr1', provincia: 'po' }))
      .toEqual({ nome: ' Mario ', codiceFiscale: 'RSSMRA85T10A562S', partitaIva: '01114601006', iban: 'IT60X0542811101000000123456', codiceSdi: 'M5UXCR1', provincia: 'PO' });
    expect(normalizzaCodici({ provincia: 'Firenze' }).provincia).toBe('Firenze');
  });
});
