// Rubrica (features/personale/lib/rubrica.js e vcard.js): ricerca, gruppi, duplicati e unione, importazione con
// corrispondenza delle colonne, vCard difficili, esportazione CSV, contatti dalle fatture elettroniche.
import { describe, it, expect } from 'vitest';
import {
  normalizzaTesto, cercaContatti, confrontaContatti, SENZA_GRUPPO, chiaveFiscale, trovaDuplicati, calcolaUnione, applicaUnione,
  completaContatto, destinazioneColonna, mappaColonne, righeAContatti, pianificaImport, esportaCsv, INTESTAZIONI_CSV,
  contattoDaFattura, trovaEsistente, salvaDaFattura, normalizzaData, leggiVcard,
} from '../src/renderer/features/personale/lib/rubrica.js';
import { createArchivio } from '../src/renderer/features/personale/lib/archivio.js';
import { createMemoryBackend } from '../src/renderer/features/personale/lib/backend.js';
import { tabellaDaCsv, tabellaDaFile } from '../src/renderer/features/personale/lib/tabelle.js';
import { parseFattura } from '../src/renderer/features/avanzati/lib/fattura.js';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
let n = 0;
const C = (o) => ({ id: 'c' + (++n), gruppi: [], creato: '2026-01-01T00:00:00.000Z', modificato: '2026-01-01T00:00:00.000Z', ...o });
async function nuovoArchivio() { const a = createArchivio({ backend: createMemoryBackend() }); await a.apri(); return a; }

describe('ricerca e ordinamento', () => {
  const rubrica = [
    C({ nome: 'Niccolò', cognome: 'Bianchi', citta: 'Firenze', gruppi: ['colleghi'], telefono: '055 123 4567' }),
    C({ nome: 'Mario', cognome: 'Rossi', codiceFiscale: 'RSSMRA85T10A562S', email: 'mario.rossi@example.com', gruppi: ['clienti'] }),
    C({ ragioneSociale: 'Àlfa Forniture S.r.l.', partitaIva: '01114601006', pec: 'alfa@pec.it', gruppi: ['fornitori'] }),
    C({ nome: 'Anna', cognome: 'Ávila', note: 'Referente del progetto Leggio' }),
    C({ nome: 'Zeno', cognome: 'bianchi' }),
  ];
  it('normalizza minuscole e accenti', () => {
    expect(normalizzaTesto('  Niccolò  ÀLFA ')).toBe('niccolo alfa');
  });
  it('ordina per cognome e nome / ragione sociale, all\'italiana', () => {
    const ord = cercaContatti(rubrica, '').map((c) => c.cognome || c.ragioneSociale);
    expect(ord).toEqual(['Àlfa Forniture S.r.l.', 'Ávila', 'Bianchi', 'bianchi', 'Rossi']);
    expect(confrontaContatti(rubrica[0], rubrica[4])).toBeLessThan(0); // Bianchi Niccolò prima di bianchi Zeno
  });
  it('cerca senza accenti su nome, CF, P.IVA (anche con IT), email, PEC, telefono, città, gruppi, note', () => {
    const nomi = (q, o) => cercaContatti(rubrica, q, o).map((c) => c.nome || c.ragioneSociale);
    expect(nomi('niccolo')).toEqual(['Niccolò']);
    expect(nomi('rssmra85')).toEqual(['Mario']);
    expect(nomi('IT01114601006')).toEqual(['Àlfa Forniture S.r.l.']);
    expect(nomi('alfa@pec')).toEqual(['Àlfa Forniture S.r.l.']);
    expect(nomi('0551234567')).toEqual(['Niccolò']);
    expect(nomi('firenze')).toEqual(['Niccolò']);
    expect(nomi('fornitori')).toEqual(['Àlfa Forniture S.r.l.']);
    expect(nomi('progetto leggio')).toEqual(['Anna']);
    expect(nomi('bianchi zeno')).toEqual(['Zeno']);
    expect(nomi('nessuno')).toEqual([]);
  });
  it('filtra per gruppo e per «senza gruppo»', () => {
    expect(cercaContatti(rubrica, '', { gruppo: 'clienti' }).map((c) => c.nome)).toEqual(['Mario']);
    expect(cercaContatti(rubrica, '', { gruppo: SENZA_GRUPPO }).map((c) => c.nome)).toEqual(['Anna', 'Zeno']);
    expect(cercaContatti(rubrica, 'mario', { gruppo: 'colleghi' })).toEqual([]);
  });
  it('vede subito i contatti modificati (stesso array, oggetto sostituito)', () => {
    const lista = [C({ nome: 'Uno', cognome: 'A' }), C({ nome: 'Due', cognome: 'B' })];
    expect(cercaContatti(lista, 'nuovo')).toEqual([]);
    lista[1] = { ...lista[1], note: 'nuovo' };
    expect(cercaContatti(lista, 'nuovo').map((c) => c.nome)).toEqual(['Due']);
    lista.push(C({ nome: 'Tre', cognome: 'C' }));
    expect(cercaContatti(lista, '')).toHaveLength(3);
  });
  it('con 5000 contatti funziona (i tempi si misurano a parte)', () => {
    const molti = Array.from({ length: 5000 }, (_, i) => C({ nome: 'Nome' + i, cognome: 'Cognome' + (i % 97), email: `p${i}@example.com`, gruppi: [i % 3 ? 'a' : 'b'] }));
    expect(cercaContatti(molti, 'p4999@')).toHaveLength(1);
    expect(cercaContatti(molti, '', { gruppo: 'b' })).toHaveLength(1667);
  });
});

describe('duplicati e unione', () => {
  it('chiave fiscale: maiuscole, senza spazi e senza IT davanti alla P.IVA', () => {
    expect(chiaveFiscale('it 011 146 010 06')).toBe('01114601006');
    expect(chiaveFiscale('rssmra85t10a562s')).toBe('RSSMRA85T10A562S');
    expect(chiaveFiscale('123')).toBe('');
  });
  it('trova i doppioni per CF, P.IVA (anche CF numerico = P.IVA), email/PEC e nome compatibile, con il motivo', () => {
    const a = C({ nome: 'Mario', cognome: 'Rossi', codiceFiscale: 'RSSMRA85T10A562S', modificato: '2026-03-01' });
    const b = C({ nome: 'M.', cognome: 'Rossi', codiceFiscale: 'rssmra85t10a562s', modificato: '2026-04-01' });
    const c = C({ ragioneSociale: 'Alfa S.r.l.', partitaIva: 'IT01114601006' });
    const d = C({ ragioneSociale: 'ALFA srl', codiceFiscale: '01114601006' });
    const e = C({ nome: 'Lucia', cognome: 'Verdi', email: 'Lucia@Example.com' });
    const f = C({ nome: 'L.', cognome: 'Verdi', pec: 'lucia@example.com' });
    const g = C({ nome: 'Paolo', cognome: 'Neri', dataNascita: '01/01/1970' });
    const h = C({ nome: 'neri', cognome: 'paolo' }); // nome e cognome invertiti: compatibile
    const i = C({ nome: 'Paolo', cognome: 'Neri', dataNascita: '02/02/1980' }); // omonimo con altra data: NON doppio
    const j = C({ nome: 'Solo', cognome: 'Uno' });
    const gruppi = trovaDuplicati([a, b, c, d, e, f, g, h, i, j]);
    expect(gruppi).toHaveLength(4);
    const di = (x) => gruppi.find((gr) => gr.contatti.includes(x));
    expect(di(a).contatti).toEqual([b, a]); // il più recente per primo
    expect(di(a).motivi).toContain('stesso codice fiscale');
    expect(di(c).contatti).toHaveLength(2);
    expect(di(e).motivi).toContain('stessa PEC');
    expect(di(g).contatti).toHaveLength(2);
    expect(di(g).contatti).not.toContain(i);
    expect(di(g).motivi).toEqual(['stesso nome e cognome']);
    expect(di(j)).toBeUndefined();
  });
  it('non unisce omonimi con codici fiscali diversi', () => {
    const x = C({ nome: 'Mario', cognome: 'Rossi', codiceFiscale: 'RSSMRA85T10A562S' });
    const y = C({ nome: 'Mario', cognome: 'Rossi', codiceFiscale: 'RSSMRA80A01H501U' });
    expect(trovaDuplicati([x, y])).toEqual([]);
  });
  it('calcola l\'unione: campi combinati, il più recente vince, conflitti proposti, gruppi uniti, note concatenate', () => {
    const vecchio = C({ nome: 'Mario', cognome: 'Rossi', telefono: '055 1', citta: 'Prato', gruppi: ['clienti'], note: 'Prima nota', creato: '2020-01-01', modificato: '2025-01-01' });
    const nuovo = C({ nome: 'Mario', cognome: 'Rossi', telefono: '333 2', email: 'm@example.com', gruppi: ['colleghi'], note: 'Seconda nota', modificato: '2026-01-01' });
    const u = calcolaUnione([vecchio, nuovo]);
    expect(u.tieni).toBe(nuovo.id);
    expect(u.elimina).toEqual([vecchio.id]);
    expect(u.risultato).toMatchObject({ telefono: '333 2', email: 'm@example.com', citta: 'Prato', gruppi: ['colleghi', 'clienti'], note: 'Seconda nota\n\nPrima nota', creato: '2020-01-01' });
    expect(u.conflitti).toEqual([{ campo: 'telefono', etichetta: 'Telefono', scelto: '333 2', valori: [{ valore: '333 2', id: nuovo.id, nome: 'Mario Rossi' }, { valore: '055 1', id: vecchio.id, nome: 'Mario Rossi' }] }]);
    expect(calcolaUnione([vecchio, nuovo], { scelte: { telefono: '055 1' }, tieni: vecchio.id }).risultato).toMatchObject({ id: vecchio.id, telefono: '055 1' });
    // stessi valori scritti diversamente non sono conflitti
    expect(calcolaUnione([C({ partitaIva: 'IT01114601006', email: 'A@B.it' }), C({ partitaIva: '01114601006', email: 'a@b.it' })]).conflitti).toEqual([]);
    expect(() => calcolaUnione([vecchio])).toThrow(/almeno due/);
  });
  it('applica l\'unione all\'archivio: firme e registro passano al contatto che resta', async () => {
    const a = await nuovoArchivio();
    const [x, y] = a.salvaContatti([{ nome: 'Mario', cognome: 'Rossi', codiceFiscale: 'RSSMRA85T10A562S', telefono: '1' }, { nome: 'Mario', cognome: 'Rossi', codiceFiscale: 'RSSMRA85T10A562S', email: 'm@example.com' }]);
    const f = await a.aggiungiFirma({ nome: 'Firma di Mario', proprietario: x.id, immagine: PNG });
    a.registra({ firma: f, documento: 'contratto.pdf' });
    const gruppo = trovaDuplicati(a.contatti())[0];
    const u = calcolaUnione(gruppo.contatti, { tieni: y.id });
    const r = await applicaUnione(a, u);
    expect(r).toMatchObject({ eliminati: [x.id], firmeSpostate: 1, registroSpostato: 1 });
    expect(a.contatti()).toHaveLength(1);
    expect(a.contatto(y.id)).toMatchObject({ telefono: '1', email: 'm@example.com' });
    expect(a.firma(f.id).proprietario).toBe(y.id);
    expect(a.registro({ proprietario: y.id })).toHaveLength(1);
    expect(await a.immagine(f.blob)).toBe(PNG); // l'immagine della firma NON è stata cancellata
  });
  it('completa un contatto solo nei campi vuoti', () => {
    const r = completaContatto(C({ nome: 'A', email: 'a@x.it', gruppi: ['g1'] }), { nome: 'B', telefono: '123', gruppi: ['g1', 'g2'] });
    expect(r.contatto).toMatchObject({ nome: 'A', telefono: '123', gruppi: ['g1', 'g2'] });
    expect(r.campi).toEqual(['telefono']);
    expect(r.gruppi).toEqual(['g2']);
  });
});

describe('importazione: corrispondenza delle colonne', () => {
  it('riconosce intestazioni italiane e inglesi', () => {
    const casi = {
      Nome: 'nome', 'First name': 'nome', Cognome: 'cognome', 'Last Name': 'cognome', 'Codice fiscale': 'codiceFiscale', 'C.F.': 'codiceFiscale',
      'P.IVA': 'partitaIva', 'Partita IVA': 'partitaIva', 'E-mail': 'email', 'Indirizzo e-mail': 'email', PEC: 'pec', 'Email PEC': 'pec', Cellulare: 'telefono',
      Telefono: 'telefono', IBAN: 'iban', 'Codice SDI': 'codiceSdi', 'Codice destinatario': 'codiceSdi', Indirizzo: 'indirizzo', Via: 'indirizzo',
      CAP: 'cap', Comune: 'citta', 'Città': 'citta', Provincia: 'provincia', 'Prov.': 'provincia', Gruppo: 'gruppi', Gruppi: 'gruppi', Ruolo: 'ruolo',
      Note: 'note', 'Data di nascita': 'dataNascita', 'Ragione sociale': 'ragioneSociale', Denominazione: 'ragioneSociale', Nominativo: 'nominativo',
      'Luogo di nascita': 'luogoNascita', 'Ragione sociale / ente': 'ragioneSociale', 'Città / comune': 'citta', 'Codice destinatario SDI': 'codiceSdi',
      'Numero di telefono (ufficio)': 'telefono', 'Colonna 7': '',
    };
    for (const [h, k] of Object.entries(casi)) expect([h, destinazioneColonna(h)]).toEqual([h, k]);
  });
  it('«Nominativo» va in Nome solo se non ci sono colonne nome/cognome; un campo non si assegna due volte', () => {
    expect(mappaColonne(['Nominativo', 'Email'])).toEqual({ Nominativo: 'nome', Email: 'email' });
    expect(mappaColonne(['Nominativo', 'Nome', 'Cognome'])).toEqual({ Nominativo: '', Nome: 'nome', Cognome: 'cognome' });
    expect(mappaColonne(['Email', 'E-mail 2'])).toEqual({ Email: 'email', 'E-mail 2': '' });
    expect(mappaColonne(['Via', 'Civico', 'Telefono', 'Cellulare'])).toEqual({ Via: 'indirizzo', Civico: 'indirizzo', Telefono: 'telefono', Cellulare: 'telefono' });
  });
  it('trasforma le righe in contatti normalizzati, con gruppo e avvisi', () => {
    const t = tabellaDaCsv('Cognome;Nome;C.F.;Via;Civico;Cellulare;Telefono;Gruppo;Data di nascita;Email\n' +
      'Rossi;Mario;rssmra85t10a562s;Via Roma;10;333 1;055 2;clienti, vip;1985-12-10;mario@example.com\n' +
      ';;;;;;;;;\n' +
      'Verdi;Lucia;XXX;;;;;;10.1.80;lucia@pec.it\n');
    const voci = righeAContatti(t.righe, mappaColonne(t.intestazioni), { gruppo: 'importati' });
    expect(voci).toHaveLength(2);
    expect(voci[0].contatto).toMatchObject({ cognome: 'Rossi', codiceFiscale: 'RSSMRA85T10A562S', indirizzo: 'Via Roma 10', telefono: '333 1 / 055 2', gruppi: ['clienti', 'vip', 'importati'], dataNascita: '10/12/1985' });
    expect(voci[0].avvisi).toEqual({});
    expect(voci[1].riga).toBe(2); // le righe del tutto vuote non contano
    expect(voci[1].contatto).toMatchObject({ pec: 'lucia@pec.it', dataNascita: '10/01/1980' });
    expect(voci[1].contatto.email).toBeUndefined(); // un indirizzo PEC finisce nel campo PEC
    expect(voci[1].avvisi.codiceFiscale).toMatch(/16 caratteri/);
  });
  it('normalizza le date comuni', () => {
    expect(normalizzaData('1985-12-10')).toBe('10/12/1985');
    expect(normalizzaData('1/2/1990')).toBe('01/02/1990');
    expect(normalizzaData('primavera')).toBe('primavera');
  });
  it('riconosce i doppioni con la rubrica e nel file: salta, aggiorna i campi vuoti, aggiungi comunque', () => {
    const esistenti = [C({ nome: 'Mario', cognome: 'Rossi', partitaIva: '01114601006' }), C({ nome: 'Lucia', email: 'lucia@example.com', telefono: '1' })];
    const voci = [
      { riga: 1, contatto: { nome: 'Mario', cognome: 'Rossi', partitaIva: '01114601006', telefono: '333', gruppi: ['nuovi'] } },
      { riga: 2, contatto: { nome: 'Lucia', email: 'LUCIA@example.com', telefono: '2', gruppi: [] } },
      { riga: 3, contatto: { nome: 'Nuovo', codiceFiscale: 'RSSMRA85T10A562S', gruppi: [] } },
      { riga: 4, contatto: { nome: 'Nuovo', codiceFiscale: 'RSSMRA85T10A562S', email: 'nuovo@example.com', gruppi: [] } },
      { riga: 5, contatto: { nome: 'Errato', codiceFiscale: 'RSSMRA85T10A562T', gruppi: [] } },
    ];
    const salta = pianificaImport(voci, esistenti, { duplicati: 'salta' });
    expect(salta).toMatchObject({ aggiunti: 2, saltati: 3, aggiornati: 0 });
    const agg = pianificaImport(voci, esistenti, { duplicati: 'aggiorna' });
    expect(agg).toMatchObject({ aggiunti: 2, aggiornati: 1, invariati: 1, saltati: 0 });
    expect(agg.daSalvare.find((c) => c.id === esistenti[0].id)).toMatchObject({ telefono: '333', gruppi: ['nuovi'] });
    expect(agg.daSalvare.find((c) => c.nome === 'Nuovo')).toMatchObject({ email: 'nuovo@example.com' }); // riga 4 completa la riga 3
    expect(agg.avvisi).toEqual([{ riga: 5, nome: 'Errato', avvisi: { codiceFiscale: expect.stringMatching(/ultimo carattere/) } }]);
    const tutti = pianificaImport(voci, esistenti, { duplicati: 'aggiungi' });
    expect(tutti).toMatchObject({ aggiunti: 5, saltati: 0 });
    expect(tutti.daSalvare.every((c) => !c.id)).toBe(true);
  });
});

describe('vCard', () => {
  it('legge 3.0 e 4.0: più schede, righe piegate, escape, ORG, TITLE, TEL, ADR, NOTE, BDAY, CATEGORIES, PEC', () => {
    const vcf = [
      'BEGIN:VCARD', 'VERSION:3.0', 'N:Rossi;Mario;;Dott.;', 'FN:Dott. Mario Rossi', 'ORG:Comune di Prato;Ufficio tributi', 'TITLE:Funzionario',
      'EMAIL;TYPE=INTERNET,WORK:mario.rossi@comune.prato.it', 'EMAIL;TYPE=INTERNET:mario@pec.comune.prato.it', 'item1.TEL;TYPE=CELL:+39 333 1234567', 'TEL;TYPE=WORK,VOICE:0574 1',
      'ADR;TYPE=WORK:;;Piazza del Comune\\, 2;Prato;PO;59100;Italia', 'NOTE:Riga uno\\nRiga due con \\; punto e virgola e una riga mol',
      ' to lunga piegata', 'BDAY:1985-12-10', 'CATEGORIES:Colleghi,Comune\\, Prato', 'PHOTO;ENCODING=b;TYPE=JPEG:/9j/4AAQSkZJRg==', 'END:VCARD',
      'BEGIN:VCARD', 'VERSION:4.0', 'FN:Alfa S.r.l.', 'ORG:Alfa S.r.l.', 'EMAIL;TYPE=pec:alfa@legalmail.it', 'EMAIL;PREF=1:info@alfa.it', 'TEL;VALUE=uri;TYPE=work:tel:+39-055-111', 'BDAY:--1210', 'END:VCARD',
      'BEGIN:VCARD', 'VERSION:3.0', 'X-VUOTO:niente', 'END:VCARD',
    ].join('\r\n');
    const r = leggiVcard(vcf);
    expect(r.schede).toBe(3);
    expect(r.scartate).toBe(1);
    const [m, a] = r.contatti;
    expect(m).toMatchObject({
      cognome: 'Rossi', nome: 'Mario', ragioneSociale: 'Comune di Prato - Ufficio tributi', ruolo: 'Funzionario', email: 'mario.rossi@comune.prato.it',
      pec: 'mario@pec.comune.prato.it', telefono: '+39 333 1234567 / 0574 1', indirizzo: 'Piazza del Comune, 2', citta: 'Prato', provincia: 'PO', cap: '59100',
      note: 'Riga uno\nRiga due con ; punto e virgola e una riga molto lunga piegata', dataNascita: '10/12/1985', gruppi: ['Colleghi', 'Comune, Prato'],
    });
    expect(m.nazione).toBeUndefined();
    expect(a).toMatchObject({ ragioneSociale: 'Alfa S.r.l.', pec: 'alfa@legalmail.it', email: 'info@alfa.it', telefono: '+39-055-111', dataNascita: '10/12' });
    expect(a.nome).toBeUndefined(); // FN uguale a ORG: niente nome di persona
  });
  it('legge 2.1 con QUOTED-PRINTABLE spezzato, CHARSET e tipi senza nome', () => {
    const bytes = new Uint8Array([
      ...Buffer.from('BEGIN:VCARD\r\nVERSION:2.1\r\nN;CHARSET=UTF-8;ENCODING=QUOTED-PRINTABLE:Bianch=C3=AC;Niccol=C3=B2\r\n'),
      ...Buffer.from('NOTE;ENCODING=QUOTED-PRINTABLE;CHARSET=UTF-8:Prima riga=0D=0ASeconda riga lunga che continua =\r\nsulla riga dopo\r\n'),
      ...Buffer.from('TEL;CELL;PREF:3331112222\r\nTEL;HOME:055000\r\nEMAIL;INTERNET:n@example.com\r\n'),
      ...Buffer.from('ADR;HOME;CHARSET=ISO-8859-1:;;Via Libert'), 0xe0, ...Buffer.from(' 1;Forl'), 0xec, ...Buffer.from(';FC;47121;\r\n'),
      ...Buffer.from('END:VCARD\r\n'),
    ]);
    const [c] = leggiVcard(bytes).contatti;
    expect(c).toMatchObject({ cognome: 'Bianchì', nome: 'Niccolò', telefono: '3331112222 / 055000', email: 'n@example.com', indirizzo: 'Via Libertà 1', citta: 'Forlì', provincia: 'FC', cap: '47121' });
    expect(c.note).toBe('Prima riga\r\nSeconda riga lunga che continua sulla riga dopo');
  });
  it('spiega quando il file non è una vCard', () => {
    expect(() => leggiVcard('Nome;Cognome\nMario;Rossi')).toThrow(/BEGIN:VCARD/);
  });
});

describe('esportazione CSV', () => {
  it('scrive intestazioni italiane leggibili e si reimporta uguale', async () => {
    const contatti = [
      C({ nome: 'Mario', cognome: 'Rossi', codiceFiscale: 'RSSMRA85T10A562S', note: 'Riga 1\nRiga 2; con "virgolette"', gruppi: ['clienti', 'vip'] }),
      C({ ragioneSociale: '=Alfa S.r.l.', partitaIva: '01114601006' }),
    ];
    const csv = esportaCsv(contatti);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv.split('\r\n')[0]).toBe('﻿' + INTESTAZIONI_CSV.join(';'));
    expect(csv).toContain('"\'=Alfa S.r.l."'); // niente formule in Excel
    const t = await tabellaDaFile({ name: 'rubrica.csv', bytes: new TextEncoder().encode(csv) });
    const mappa = mappaColonne(t.intestazioni);
    expect(Object.values(mappa).filter(Boolean)).toHaveLength(INTESTAZIONI_CSV.length);
    const voci = righeAContatti(t.righe, mappa);
    expect(voci[0].contatto).toMatchObject({ nome: 'Mario', codiceFiscale: 'RSSMRA85T10A562S', note: 'Riga 1\nRiga 2; con "virgolette"', gruppi: ['clienti', 'vip'] });
  });
});

describe('contatti dalle fatture elettroniche', () => {
  const XML = `<?xml version="1.0" encoding="UTF-8"?>
<p:FatturaElettronica versione="FPR12" xmlns:p="http://ivaservizi.agenziaentrate.gov.it/docs/xsd/fatture/v1.2">
<FatturaElettronicaHeader>
 <DatiTrasmissione><IdTrasmittente><IdPaese>IT</IdPaese><IdCodice>01114601006</IdCodice></IdTrasmittente><ProgressivoInvio>1</ProgressivoInvio><FormatoTrasmissione>FPR12</FormatoTrasmissione><CodiceDestinatario>M5UXCR1</CodiceDestinatario><PECDestinatario>studio@pec.example.it</PECDestinatario></DatiTrasmissione>
 <CedentePrestatore><DatiAnagrafici><IdFiscaleIVA><IdPaese>IT</IdPaese><IdCodice>01114601006</IdCodice></IdFiscaleIVA><CodiceFiscale>01114601006</CodiceFiscale><Anagrafica><Denominazione>Forniture &amp; Laboratorio S.r.l.</Denominazione></Anagrafica><RegimeFiscale>RF01</RegimeFiscale></DatiAnagrafici>
  <Sede><Indirizzo>Via Roma</Indirizzo><NumeroCivico>10</NumeroCivico><CAP>50019</CAP><Comune>Sesto Fiorentino</Comune><Provincia>FI</Provincia><Nazione>IT</Nazione></Sede>
  <Contatti><Telefono>055 999</Telefono><Email>info@forniture.example.it</Email></Contatti></CedentePrestatore>
 <CessionarioCommittente><DatiAnagrafici><CodiceFiscale>RSSMRA85T10A562S</CodiceFiscale><Anagrafica><Nome>Mario</Nome><Cognome>Rossi</Cognome></Anagrafica></DatiAnagrafici>
  <Sede><Indirizzo>Piazza Duomo 1</Indirizzo><CAP>59100</CAP><Comune>Prato</Comune><Provincia>PO</Provincia><Nazione>IT</Nazione></Sede></CessionarioCommittente>
</FatturaElettronicaHeader>
<FatturaElettronicaBody>
 <DatiGenerali><DatiGeneraliDocumento><TipoDocumento>TD01</TipoDocumento><Divisa>EUR</Divisa><Data>2026-10-31</Data><Numero>12</Numero><ImportoTotaleDocumento>122.00</ImportoTotaleDocumento></DatiGeneraliDocumento></DatiGenerali>
 <DatiBeniServizi><DettaglioLinee><NumeroLinea>1</NumeroLinea><Descrizione>Reagenti</Descrizione><PrezzoUnitario>100.00</PrezzoUnitario><PrezzoTotale>100.00</PrezzoTotale><AliquotaIVA>22.00</AliquotaIVA></DettaglioLinee>
  <DatiRiepilogo><AliquotaIVA>22.00</AliquotaIVA><ImponibileImporto>100.00</ImponibileImporto><Imposta>22.00</Imposta></DatiRiepilogo></DatiBeniServizi>
 <DatiPagamento><CondizioniPagamento>TP02</CondizioniPagamento><DettaglioPagamento><ModalitaPagamento>MP05</ModalitaPagamento><ImportoPagamento>122.00</ImportoPagamento><IBAN>IT60X0542811101000000123456</IBAN></DettaglioPagamento></DatiPagamento>
</FatturaElettronicaBody>
</p:FatturaElettronica>`;
  const f = parseFattura(XML);
  it('fornitore: ragione sociale, P.IVA senza IT, sede campo per campo, contatti, IBAN, gruppo fornitori', () => {
    expect(contattoDaFattura(f.cedente, 'cedente', f)).toEqual({
      ragioneSociale: 'Forniture & Laboratorio S.r.l.', partitaIva: '01114601006', codiceFiscale: '01114601006', indirizzo: 'Via Roma 10', cap: '50019',
      citta: 'Sesto Fiorentino', provincia: 'FI', telefono: '055 999', email: 'info@forniture.example.it', iban: 'IT60X0542811101000000123456',
      gruppi: ['fornitori'], origine: 'fattura',
    });
  });
  it('cliente: nome e cognome, codice destinatario e PEC dai dati di trasmissione, gruppo clienti', () => {
    expect(contattoDaFattura(f.cessionario, 'cessionario', f)).toMatchObject({ nome: 'Mario', cognome: 'Rossi', codiceFiscale: 'RSSMRA85T10A562S', codiceSdi: 'M5UXCR1', pec: 'studio@pec.example.it', citta: 'Prato', gruppi: ['clienti'] });
    // senza la fattura intera (o con codice 0000000) niente codice destinatario
    expect(contattoDaFattura(f.cessionario, 'cessionario').codiceSdi).toBeUndefined();
    expect(contattoDaFattura(f.cessionario, 'cessionario', { trasmissione: { codiceDestinatario: '0000000' } }).codiceSdi).toBeUndefined();
  });
  it('funziona anche con l\'indirizzo già composto (dati di versioni precedenti) e con P.IVA estere', () => {
    const c = contattoDaFattura({ nome: 'Beta GmbH', partitaIva: 'DE123456789', indirizzo: 'Hauptstr. 1, 10115 Berlin, DE' }, 'cedente');
    expect(c).toMatchObject({ ragioneSociale: 'Beta GmbH', partitaIva: 'DE123456789', indirizzo: 'Hauptstr. 1', cap: '10115', citta: 'Berlin', nazione: 'DE' });
    expect(contattoDaFattura(null)).toBe(null);
  });
  it('trova chi è già in rubrica (P.IVA o CF, anche incrociati) e non crea doppioni', async () => {
    const a = await nuovoArchivio();
    a.salvaContatto({ ragioneSociale: 'Forniture', codiceFiscale: 'IT01114601006', gruppi: ['vari'] });
    const ced = contattoDaFattura(f.cedente, 'cedente', f);
    expect(trovaEsistente(a, ced)?.ragioneSociale).toBe('Forniture');
    expect(trovaEsistente(a, { partitaIva: '' })).toBe(null);
    const r1 = salvaDaFattura(a, ced);
    expect(r1.stato).toBe('aggiornato');
    expect(r1.campi).toContain('iban');
    expect(a.contatti()).toHaveLength(1);
    expect(a.contatti()[0]).toMatchObject({ ragioneSociale: 'Forniture', gruppi: ['vari', 'fornitori'] });
    expect(salvaDaFattura(a, ced).stato).toBe('presente');
    const r3 = salvaDaFattura(a, contattoDaFattura(f.cessionario, 'cessionario', f));
    expect(r3.stato).toBe('aggiunto');
    expect(a.contatti()).toHaveLength(2);
  });
});
