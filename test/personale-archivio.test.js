// Archivio personale lato renderer (features/personale/lib/archivio.js): modello dei dati, migrazione
// silenziosa dalla 0.2, firme di altre persone e registro, cancellazione GDPR, unione dei backup.
import { describe, it, expect } from 'vitest';
import { createArchivio, unisciIndici, normalizzaIndice, dataUrlToBytes, bytesToDataUrl } from '../src/renderer/features/personale/lib/archivio.js';
import { createMemoryBackend } from '../src/renderer/features/personale/lib/backend.js';
import { memoryStorage } from '../src/renderer/features/moduli/lib/store.js';
import { valorePerCampo, chiavePerCampo, datiDaContatto, datiDaProfilo, proponiCompilazione, nomeContatto } from '../src/renderer/features/personale/lib/campi.js';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

describe('migrazione dalla 0.2', () => {
  it('porta firme, sigle e profilo nell\'archivio e li toglie dal localStorage, in silenzio', async () => {
    const legacy = memoryStorage();
    legacy.setItem('leggio.moduli.firme.v1', JSON.stringify([
      { id: 'a', kind: 'signature', dataUrl: PNG, w: 30, h: 10, created: 1700000000000, label: '' },
      { id: 'b', kind: 'initials', dataUrl: PNG, w: 10, h: 10, created: 1700000000000 },
      { id: 'c', kind: 'signature', dataUrl: 'javascript:alert(1)' },
    ]));
    legacy.setItem('leggio.moduli.profilo.v1', JSON.stringify({ nome: 'Maria', cognome: 'Rossi', codiceFiscale: 'RSSMRA80A41H501X' }));
    legacy.setItem('leggio.moduli.pref.v1', JSON.stringify({ color: '#1d3f9a' }));
    const backend = createMemoryBackend();
    const a = createArchivio({ backend, legacyStorage: legacy });
    expect(await a.apri()).toBe(true);
    expect(a.firme()).toHaveLength(2);
    expect(a.firme({ tipo: 'sigla' })).toHaveLength(1);
    expect(a.firme({ tipo: 'firma' })[0]).toMatchObject({ proprietario: 'io', origine: '0.2', nome: 'La mia firma', w: 30 });
    expect(await a.immagine(a.firme({ tipo: 'firma' })[0].blob)).toBe(PNG);
    expect(a.profilo()).toMatchObject({ nome: 'Maria', codiceFiscale: 'RSSMRA80A41H501X' });
    expect(legacy.getItem('leggio.moduli.firme.v1')).toBe(null);
    expect(legacy.getItem('leggio.moduli.profilo.v1')).toBe(null);
    expect(legacy.getItem('leggio.moduli.pref.v1')).not.toBe(null); // le preferenze restano
    // riapertura: nessuna seconda migrazione
    const b = createArchivio({ backend, legacyStorage: legacy });
    await b.apri();
    expect(b.firme()).toHaveLength(2);
  });

  it('se il salvataggio fallisce non perde nulla: il localStorage resta e si riprova', async () => {
    const legacy = memoryStorage();
    legacy.setItem('leggio.moduli.profilo.v1', JSON.stringify({ nome: 'Ugo' }));
    const backend = createMemoryBackend();
    const salva = backend.salva; backend.salva = async () => { throw new Error('disco pieno'); };
    const a = createArchivio({ backend, legacyStorage: legacy });
    await a.apri();
    expect(legacy.getItem('leggio.moduli.profilo.v1')).not.toBe(null);
    backend.salva = salva;
    const b = createArchivio({ backend, legacyStorage: legacy });
    await b.apri();
    expect(b.profilo().nome).toBe('Ugo');
    expect(legacy.getItem('leggio.moduli.profilo.v1')).toBe(null);
  });
});

describe('password', () => {
  it('chiede la password, ripete se errata, si ferma se l\'utente lascia perdere', async () => {
    const backend = createMemoryBackend({ password: 'segreta-123' });
    const risposte = ['sbagliata', 'segreta-123']; const errori = [];
    const a = createArchivio({ backend, chiediPassword: async ({ errore }) => { errori.push(errore); return risposte.shift(); } });
    expect(await a.apri({ interattivo: false })).toBe(false);
    expect(await a.apri()).toBe(true);
    expect(errori).toEqual(['', 'Password errata.']);
    const b = createArchivio({ backend: createMemoryBackend({ password: 'x-12345678' }), chiediPassword: async () => null });
    expect(await b.apri()).toBe(false);
  });
});

describe('firme, timbri, registro', () => {
  it('nessun limite di 12, proprietario, firme altrui e registro', async () => {
    const backend = createMemoryBackend();
    const a = createArchivio({ backend });
    await a.apri();
    for (let i = 0; i < 30; i++) await a.aggiungiFirma({ nome: 'F' + i, immagine: PNG, w: 3, h: 1 });
    expect(a.firme({ tipo: 'firma' })).toHaveLength(30);
    const c = a.salvaContatto({ nome: 'Luca', cognome: 'Bianchi', gruppi: 'volontari, soci' });
    expect(c.gruppi).toEqual(['volontari', 'soci']);
    const f = await a.aggiungiFirma({ nome: 'Firma di Luca', proprietario: c.id, immagine: dataUrlToBytes(PNG) });
    expect(a.altrui(f)).toBe(true);
    expect(a.nomeProprietario(f)).toBe('Luca Bianchi');
    expect(a.firme({ proprietario: 'altri' })).toHaveLength(1);
    const r = a.registra({ firma: f, documento: 'domanda.pdf', pagine: '1' });
    expect(r).toMatchObject({ firmaNome: 'Firma di Luca', proprietarioNome: 'Luca Bianchi', documento: 'domanda.pdf' });
    expect(a.registro()).toHaveLength(1);
    // proprietario inesistente → «io»
    const g = await a.aggiungiFirma({ proprietario: 'c-inesistente', immagine: PNG });
    expect(g.proprietario).toBe('io');
    expect(await a.eliminaFirma(g.id)).toBe(true);
    expect(backend._blob.has(g.blob)).toBe(false);
    const t = await a.aggiungiTimbro({ nome: 'Ente', immagine: PNG, w: 5, h: 5 });
    const t2 = await a.aggiungiTimbro({ nome: 'Visto', tipo: 'testo', spec: { righe: ['VISTO'] } });
    expect(a.timbri().map((x) => x.nome).sort()).toEqual(['Ente', 'Visto']);
    expect(t2.blob).toBe(null);
    await a.eliminaTimbro(t.id);
    expect(a.timbri()).toHaveLength(1);
    await a.salvaOra();
    expect(backend.salvataggi).toBeGreaterThan(0);
  });
});

describe('GDPR', () => {
  it('esporta tutto di una persona e la cancella con firme e registro, anche dal backup', async () => {
    const backend = createMemoryBackend();
    const a = createArchivio({ backend });
    await a.apri();
    const c = a.salvaContatto({ nome: 'Anna', cognome: 'Neri', codiceFiscale: 'NRENNA80A41H501U' });
    const altro = a.salvaContatto({ nome: 'Piero' });
    const f = await a.aggiungiFirma({ nome: 'Firma Anna', proprietario: c.id, immagine: PNG });
    await a.aggiungiFirma({ nome: 'Firma Piero', proprietario: altro.id, immagine: PNG });
    a.registra({ firma: f, documento: 'verbale.pdf' });
    const dati = await a.datiPersona(c.id);
    expect(dati.contatto.codiceFiscale).toBe('NRENNA80A41H501U');
    expect(dati.firme[0].immagine).toBe(PNG);
    expect(dati.registro[0].documento).toBe('verbale.pdf');
    expect(a.inventario()).toMatchObject({ contatti: 2, firmeAltrui: 2, registro: 1 });
    const r = await a.eliminaContatto(c.id);
    expect(r).toEqual({ contatto: 'Anna Neri', firme: 1, registro: 1 });
    expect(a.contatto(c.id)).toBe(null);
    expect(a.firme({ proprietario: c.id })).toEqual([]);
    expect(a.registro()).toEqual([]);
    expect(backend._blob.has(f.blob)).toBe(false);
    expect(backend.ultimaPurga).toBe(true);
    expect(a.inventario()).toMatchObject({ contatti: 1, firmeAltrui: 1 });
  });
});

describe('unione dei backup', () => {
  it('per id vince la versione più recente; il profilo attuale ha la precedenza', () => {
    const a = { contatti: [{ id: 'c1', nome: 'Vecchio', modificato: '2026-01-01' }, { id: 'c2', nome: 'Solo qui' }], profilo: { nome: 'Io' } };
    const b = { contatti: [{ id: 'c1', nome: 'Nuovo', modificato: '2026-05-01' }, { id: 'c3', nome: 'Importato' }], profilo: { nome: 'Altro', email: 'x@y.it' }, registro: [{ id: 'r1', quando: '2026-01-01' }] };
    const u = unisciIndici(a, b);
    expect(u.contatti.map((c) => c.nome).sort()).toEqual(['Importato', 'Nuovo', 'Solo qui']);
    expect(u.profilo).toEqual({ nome: 'Io', email: 'x@y.it' });
    expect(u.registro).toHaveLength(1);
    expect(normalizzaIndice(null)).toMatchObject({ firme: [], contatti: [], profilo: {} });
  });
  it('applica un backup importato (unisci e sostituisci)', async () => {
    const a = createArchivio({ backend: createMemoryBackend() });
    await a.apri();
    a.salvaContatto({ id: 'c1', nome: 'Qui' });
    await a.applicaImportato({ contatti: [{ id: 'c9', nome: 'Là' }] }, 'unisci');
    expect(a.contatti()).toHaveLength(2);
    await a.applicaImportato({ contatti: [{ id: 'c9', nome: 'Là' }] }, 'sostituisci');
    expect(a.contatti().map((c) => c.nome)).toEqual(['Là']);
  });
  it('conversioni dataUrl ↔ byte', () => {
    expect(bytesToDataUrl(dataUrlToBytes(PNG))).toBe(PNG);
    expect(() => dataUrlToBytes('ciao')).toThrow(/non valida/);
  });
});

describe('campi per «Compila a nome di»', () => {
  const luca = { nome: 'Luca', cognome: 'Bianchi', codiceFiscale: 'BNCLCU80A01H501X', iban: 'IT60X0542811101000000123456', codiceSdi: 'ABC1234', pec: 'luca@pec.it', email: 'luca@example.it', ruolo: 'Volontario', ragioneSociale: 'Pro Loco' };
  it('riconosce i campi del modulo, compresi quelli nuovi', () => {
    const d = datiDaContatto(luca);
    expect(valorePerCampo('Nome_e_cognome', d)?.value).toBe('Luca Bianchi');
    expect(valorePerCampo('IBAN', d)?.value).toBe('IT60X0542811101000000123456');
    expect(valorePerCampo('codice_destinatario', d)?.value).toBe('ABC1234');
    expect(valorePerCampo('PEC', d)?.value).toBe('luca@pec.it');
    expect(valorePerCampo('email', d)?.value).toBe('luca@example.it');
    expect(valorePerCampo('in qualità di', d)?.value).toBe('Volontario');
    expect(valorePerCampo('Ragione sociale', d)?.value).toBe('Pro Loco');
    expect(valorePerCampo('data', d, '19/11/2026')?.value).toBe('19/11/2026');
    expect(valorePerCampo('importo', d)).toBe(null);
    expect(chiavePerCampo('Codice fiscale')).toBe('codiceFiscale');
    expect(datiDaProfilo({ nome: 'Io', cognome: 'Me', qualifica: 'Segretaria' })).toMatchObject({ nomeCompleto: 'Io Me', ruolo: 'Segretaria' });
  });
  it('le corrispondenze del modello vincono sul riconoscimento automatico', () => {
    const d = datiDaContatto(luca);
    const p = proponiCompilazione(['Nome', 'Campo1', 'cf', 'Note'], d, { corrispondenze: { Campo1: 'iban', Nome: '' }, oggi: '01/01/2026' });
    expect(p).toEqual([
      { campo: 'Campo1', key: 'iban', value: 'IT60X0542811101000000123456', origine: 'modello' },
      { campo: 'cf', key: 'codiceFiscale', value: 'BNCLCU80A01H501X', origine: 'automatico' },
    ]);
    expect(nomeContatto({ ragioneSociale: 'Comune di Prato' })).toBe('Comune di Prato');
    expect(nomeContatto({ nome: 'A', cognome: 'B', ragioneSociale: 'C' })).toBe('A B (C)');
  });
});
