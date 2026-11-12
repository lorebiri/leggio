import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { normalizza, interpretaRicerca, paginaDi, estratto, numeroIt, dataDaTesto, giorniTra, aggiungiGiorni } from '../src/renderer/features/archivio/lib/testo.js';
import { ibanValido, trovaIban, trovaDataFine, riconosciTipo, pivaValida, cfValido, trovaCigCup, trovaCodici, trovaImporto, datiDaTesto, datiDaFattura, eScansione, firmePdf, pulisciFornitore } from '../src/renderer/features/archivio/lib/estrai.js';
import { applica, haStato, descrivi, esportaJson, esportaCsv, importa, unisci, leggiCsv, conSegnatura, leggiElencoProtocolli, testoProtocollo, modificaDaEvento } from '../src/renderer/features/archivio/lib/stati.js';
import { segnaturaGenerica, normalizzaSegnatura, numeroConfrontabile } from '../src/renderer/features/archivio/lib/segnatura.js';
import { immaginiDisegnate, strisciaCandidata } from '../src/renderer/features/archivio/lib/striscia.js';
import { riepilogoOggi, scadenzaDurc, testoGiorni } from '../src/renderer/features/archivio/lib/scadenze.js';
import { Motore } from '../src/renderer/features/archivio/lib/motore.js';
import { prontaPerPagamento, indiciFornitori, pagamentoPrevisto, giorniSdi } from '../src/renderer/features/archivio/lib/pagamento.js';
import { aggiungiMesi } from '../src/renderer/features/archivio/lib/scadenze.js';
import { Blocchi, leggiBlocco, manifestoValido, DIM } from '../src/renderer/features/archivio/lib/blocchi.js';
import { registroCsv, registroXlsx, serialeExcel, zipSenzaCompressione } from '../src/renderer/features/archivio/lib/esporta.js';
import { parseFattura } from '../src/renderer/features/avanzati/lib/fattura.js';

const H1 = 'a'.repeat(64); const H2 = 'b'.repeat(64); const H3 = 'c'.repeat(64);

describe('testo', () => {
  it('normalizza senza cambiare la lunghezza', () => {
    for (const s of ['Perché È così', 'ÀÉÌÒÙ àèìòù çñ', 'FATTURA N. 12\fpag2', 'ﬁne İstanbul ß', '😀 emoji ok']) {
      expect(normalizza(s).length).toBe(s.length);
    }
    expect(normalizza('Perché È COSÌ')).toBe('perche e cosi');
    expect(normalizza('a\tb\nc\fd')).toBe('a b c d');
  });
  it('interpreta parole e frasi tra virgolette', () => {
    expect(interpretaRicerca('fattura "Alfa Strumenti" CIG')).toEqual([{ t: 'fattura' }, { t: 'alfa strumenti' }, { t: 'cig' }]);
    expect(interpretaRicerca('fatt fattura')).toEqual([{ t: 'fattura' }]);
    expect(interpretaRicerca('  ')).toEqual([]);
  });
  it('pagine ed estratti', () => {
    const t = 'prima pagina\fseconda pagina con CIG Z1234567AB\fterza';
    const i = t.indexOf('CIG');
    expect(paginaDi(t, i)).toBe(2);
    expect(paginaDi(t, 0)).toBe(1);
    const e = estratto(t, i, i + 3, 10);
    expect(e.trovato).toBe('CIG');
    expect(e.prima.startsWith('…')).toBe(true);
  });
  it('numeri e date all\'italiana', () => {
    expect(numeroIt('1.234,56')).toBe(1234.56);
    expect(numeroIt('€ 12.000')).toBe(12000);
    expect(numeroIt('1234.50')).toBe(1234.5);
    expect(numeroIt('abc')).toBe(null);
    expect(dataDaTesto('31/12/2026')).toBe('2026-12-31');
    expect(dataDaTesto('1.2.26')).toBe('2026-02-01');
    expect(dataDaTesto('31/02/2026')).toBe('');
    expect(giorniTra('2026-11-12', '2026-11-24')).toBe(12);
    expect(aggiungiGiorni('2026-07-27', 120)).toBe('2026-11-24');
  });
});

describe('estrazione dei dati chiave', () => {
  it('controlla P.IVA e codice fiscale', () => {
    expect(pivaValida('02118311006')).toBe(true); // CNR
    expect(pivaValida('02118311007')).toBe(false);
    expect(cfValido('RSSMRA70A01H501S')).toBe(true);
    expect(cfValido('RSSMRA70A01H501A')).toBe(false);
  });
  it('riconosce i tipi dal testo e dal nome', () => {
    expect(riconosciTipo('Durc On Line\nDOCUMENTO UNICO DI REGOLARITA\' CONTRIBUTIVA ... contratto')).toBe('durc');
    expect(riconosciTipo('Ditta X S.r.l.\nFATTURA N. 12/2026 del 01/02/2026')).toBe('fattura');
    expect(riconosciTipo('NOTA DI CREDITO N. 3 a storno della fattura n. 2')).toBe('nota-credito');
    expect(riconosciTipo('DETERMINA A CONTRARRE N. 12/2026')).toBe('ordine');
    expect(riconosciTipo('RICHIESTA DI RIMBORSO SPESE DI MISSIONE')).toBe('missione');
    expect(riconosciTipo('CONTRATTO DI FORNITURA E SERVIZI')).toBe('contratto');
    expect(riconosciTipo('', 'DURC_ditta_2026.pdf')).toBe('durc');
    expect(riconosciTipo('', 'scan001.pdf')).toBe('altro');
  });
  it('CIG, CUP, P.IVA del fornitore (non quella dell\'ente), importo', () => {
    const t = 'Alfa Strumenti S.r.l. P.IVA 00012345609\nSpett.le CNR C.F. 80054330586 P.IVA 02118311006\nCIG: Z34F05AF62 CUP B53C22001230006\nImponibile € 1.000,00\nTotale documento € 1.220,00';
    expect(trovaCigCup(t)).toEqual({ cig: ['Z34F05AF62'], cup: ['B53C22001230006'] });
    expect(trovaCodici(t).piva).toBe('00012345609');
    expect(trovaCodici('Spett.le CNR P.IVA 02118311006').piva).toBe('');
    expect(trovaImporto(t)).toBe(1220);
  });
  it('dati completi di una fattura in PDF', () => {
    const t = 'Beta Reagenti S.p.A.\nVia Roma 1 - Pisa\nP.IVA 00012424792\nFATTURA N. 681/2025 del 10/04/2025\nSpett.le Consiglio Nazionale delle Ricerche\nCIG: 91673AD096\nTotale documento € 4.867,73\nScadenza pagamento: 10/05/2025';
    const d = datiDaTesto(t, { nome: 'x.pdf' });
    expect(d).toMatchObject({ tipo: 'fattura', fornitore: 'Beta Reagenti', piva: '00012424792', numero: '681/2025', data: '2025-04-10', importo: 4867.73, scadenza: '2025-05-10', cig: ['91673AD096'] });
  });
  it('dati di un DURC', () => {
    const t = 'Durc On Line\nNumero Protocollo INPS_42702786\nData richiesta 27/07/2026\nScadenza validità 24/11/2026\nDenominazione/ragione sociale Alfa Strumenti S.r.l.\nCodice fiscale 00012345609';
    const d = datiDaTesto(t, { nome: 'durc.pdf' });
    expect(d).toMatchObject({ tipo: 'durc', piva: '00012345609', scadenza: '2026-11-24', numero: 'INPS_42702786' });
    expect(d.fornitore).toBe('Alfa Strumenti');
  });
  it('IBAN, tracciabilità, incarichi, MePA, data di fine', () => {
    expect(ibanValido('IT60X0542811101000000123456')).toBe(true);
    expect(ibanValido('IT61X0542811101000000123456')).toBe(false);
    expect(trovaIban('Pagare su IBAN IT60 X054 2811 1010 0000 0123 456 entro')).toEqual(['IT60X0542811101000000123456']);
    expect(riconosciTipo('DICHIARAZIONE SOSTITUTIVA - COMUNICAZIONE DEL CONTO CORRENTE DEDICATO ai sensi della L. 136/2010')).toBe('tracciabilita');
    expect(riconosciTipo('CONTRATTO DI FORNITURA ... Art. 4 - Tracciabilità dei flussi finanziari ai sensi della L. 136/2010')).toBe('contratto');
    expect(riconosciTipo('CONFERIMENTO DI INCARICO DI COLLABORAZIONE')).toBe('incarico');
    expect(riconosciTipo('MERCATO ELETTRONICO DELLA PUBBLICA AMMINISTRAZIONE DOCUMENTO DI STIPULA - TRATTATIVA DIRETTA N. 1234567')).toBe('ordine');
    expect(trovaDataFine('Durata: dal 01/02/2026 al 31/01/2027')).toBe('2027-01-31');
    expect(datiDaTesto('CONFERIMENTO DI INCARICO\nDurata: dal 01/02/2026 al 31/01/2027\nData 01/02/2026').dataFine).toBe('2027-01-31');
  });
  it('ripulisce i nomi dei fornitori', () => {
    expect(pulisciFornitore('sociale Alfa Strumenti')).toBe('Alfa Strumenti');
    expect(pulisciFornitore('E Arno Pulizie')).toBe('Arno Pulizie');
    expect(pulisciFornitore('richiesta. Beta')).toBe('Beta');
    expect(pulisciFornitore('a')).toBe('');
  });
  it('dati da una fattura elettronica XML', () => {
    const xml = `<?xml version="1.0"?><p:FatturaElettronica versione="FPA12" xmlns:p="x"><FatturaElettronicaHeader><CedentePrestatore><DatiAnagrafici><IdFiscaleIVA><IdPaese>IT</IdPaese><IdCodice>00012345609</IdCodice></IdFiscaleIVA><Anagrafica><Denominazione>Alfa S.r.l.</Denominazione></Anagrafica></DatiAnagrafici></CedentePrestatore></FatturaElettronicaHeader><FatturaElettronicaBody><DatiGenerali><DatiGeneraliDocumento><TipoDocumento>TD01</TipoDocumento><Data>2026-03-01</Data><Numero>FE7</Numero><ImportoTotaleDocumento>122.00</ImportoTotaleDocumento></DatiGeneraliDocumento><DatiOrdineAcquisto><IdDocumento>1</IdDocumento><CodiceCIG>Z34F05AF62</CodiceCIG></DatiOrdineAcquisto></DatiGenerali><DatiPagamento><DettaglioPagamento><ModalitaPagamento>MP05</ModalitaPagamento><DataScadenzaPagamento>2026-04-01</DataScadenzaPagamento></DettaglioPagamento></DatiPagamento></FatturaElettronicaBody></p:FatturaElettronica>`;
    const d = datiDaFattura(parseFattura(xml));
    expect(d).toMatchObject({ tipo: 'fattura', fornitore: 'Alfa S.r.l.', piva: '00012345609', numero: 'FE7', data: '2026-03-01', importo: 122, cig: ['Z34F05AF62'], scadenza: '2026-04-01' });
  });
  it('scansioni e firme PAdES', () => {
    expect(eScansione([0, 3, 10])).toBe(true);
    expect(eScansione([0, 500])).toBe(false);
    expect(eScansione([])).toBe(false);
    const b = new TextEncoder().encode('%PDF-1.7 1 0 obj <</Type/Sig/Name (Mario Rossi)/ByteRange [0 10 20 30]>> endobj 2 0 obj<</ByteRange[0 1 2 3]>>');
    expect(firmePdf(b)).toEqual(['Mario Rossi', 'Mario Rossi']);
    expect(firmePdf(new TextEncoder().encode('%PDF-1.4 niente'))).toEqual([]);
  });
});

describe('stati d\'ufficio', () => {
  it('imposta, toglie, numero di protocollo, etichette, nota', () => {
    let s = applica(null, { imposta: 'da-protocollare' }, 1);
    expect(haStato(s, 'da-protocollare')).toBe(true);
    s = applica(s, { numeroProtocollo: '0001234' }, 2);
    expect(s).toMatchObject({ protocollo: 'fatto', numeroProtocollo: '0001234' });
    expect(haStato(s, 'protocollato')).toBe(true);
    s = applica(s, { imposta: 'da-pagare', aggiungiEtichette: ['PNRR', 'pnrr', 'Gara 2026'], nota: 'chiedere al RUP' }, 3);
    expect(s.etichette).toEqual(['PNRR', 'Gara 2026']);
    expect(haStato(s, 'etichetta:pnrr')).toBe(true);
    expect(descrivi(s).map((c) => c.testo)).toEqual(['Protocollato (Titulus) n. 0001234', 'Da pagare', 'PNRR', 'Gara 2026']);
    s = applica(s, { imposta: 'pagato', togliEtichette: ['PNRR'] }, 4);
    expect(s.pagamento).toBe('fatto');
    expect(s.etichette).toEqual(['Gara 2026']);
    expect(applica(applica(null, { imposta: 'firmato' }), { togli: 'firmato' })).toBe(null);
    expect(haStato(null, 'senza-stato')).toBe(true);
    expect(() => applica(null, { imposta: 'inventato' })).toThrow();
  });
  it('esporta e reimporta (JSON e CSV) senza perdite', () => {
    const stati = new Map([[H1, applica(null, { imposta: 'da-pagare', aggiungiEtichette: ['a;b', 'c "d"'], nota: 'riga 1\nriga 2; con ; e "virgolette"' }, 10)], [H2, applica(null, { numeroProtocollo: '77', dataProtocollo: '2026-11-12' }, 20)]]);
    const nomi = { [H1]: [{ nome: 'f.pdf', percorso: '/x/f.pdf' }] };
    for (const testo of [esportaJson(stati, nomi), esportaCsv(stati, nomi)]) {
      const r = importa(testo);
      expect(r.voci.size).toBe(2);
      expect(r.voci.get(H1).pagamento).toBe('da');
      expect(r.voci.get(H1).nota).toBe('riga 1\nriga 2; con ; e "virgolette"');
      expect(r.voci.get(H2)).toMatchObject({ protocollo: 'fatto', numeroProtocollo: '77', dataProtocollo: '2026-11-12' });
    }
    expect(() => importa('{"a":1}')).toThrow(/non è un elenco/);
    expect(() => importa('nome;stato\nx;y')).toThrow(/impronta/);
  });
  it('unisce: vince il più recente, oppure sempre l\'importato', () => {
    const a = new Map([[H1, { pagamento: 'da', aggiornato: 10 }], [H2, { firma: 'da', aggiornato: 50 }]]);
    const b = new Map([[H1, { pagamento: 'fatto', aggiornato: 20 }], [H2, { firma: 'fatto', aggiornato: 40 }], [H3, { pubblicato: true, aggiornato: 1 }]]);
    const r = unisci(a, b, 'unisci');
    expect(r.stati.get(H1).pagamento).toBe('fatto');
    expect(r.stati.get(H2).firma).toBe('da');
    expect([r.nuovi, r.aggiornati, r.invariati]).toEqual([1, 1, 1]);
    expect(unisci(a, b, 'sostituisci').stati.get(H2).firma).toBe('fatto');
  });
  it('legge CSV con «,» e con a capo nelle celle', () => {
    expect(leggiCsv('a,b\n"x\ny",2\n')).toEqual([['a', 'b'], ['x\ny', '2']]);
  });
});

describe('protocollo (Titulus): Leggio non genera numeri, li legge o li riceve', () => {
  it('legge la segnatura stampata con il modello generico', () => {
    expect(segnaturaGenerica('Intestazione\nCNR-ICCOM - 0012345 - 12/11/2026\nOggetto: fornitura')).toMatchObject({ numero: '0012345', data: '2026-11-12', aoo: 'CNR-ICCOM' });
    expect(segnaturaGenerica('Consiglio Nazionale delle Ricerche\nProt. n. 0004567 del 03/10/2026')).toMatchObject({ numero: '0004567', data: '2026-10-03', aoo: '' });
    expect(segnaturaGenerica('ICCOM Protocollo n. 123/2026 del 1.2.2026')).toMatchObject({ numero: '123', aoo: 'ICCOM' });
    // non sono segnature: il protocollo INPS del DURC, il numero di fattura, una pagina
    expect(segnaturaGenerica('Durc On Line Numero Protocollo INPS_42702786 Data richiesta 27/07/2026')).toBe(null);
    expect(segnaturaGenerica('FATTURA N. 12/2026 del 01/02/2026')).toBe(null);
    expect(segnaturaGenerica('Pagina 1 - 12 - 12/11/2026')).toBe(null);
    expect(segnaturaGenerica('')).toBe(null);
  });
  it('forma della striscia di Titulus al CNR, con UOR', () => {
    expect(segnaturaGenerica('Prot. CNR n. 0123456 del 21/09/2026 - UOR: SI000099')).toMatchObject({ numero: '0123456', data: '2026-09-21', aoo: 'CNR', uor: 'SI000099' });
    expect(segnaturaGenerica('rumore OCR Prot. CNR n° 0123456 del 21/09/2026 UOR SI000099 ~')).toMatchObject({ numero: '0123456', uor: 'SI000099' });
    expect(segnaturaGenerica('Prot. CNR n. 0004552 del 14/11/2026 - UOR: S1000084')).toMatchObject({ uor: 'SI000084' }); // I letta come 1 dall'OCR
    expect(testoProtocollo(conSegnatura(null, { numero: '0123456', data: '2026-09-21', uor: 'SI000099' }))).toBe('Protocollato (Titulus) n. 0123456 del 21/09/2026, UOR SI000099 — letto dal documento');
  });
  it('trova la striscia candidata tra le immagini della pagina', () => {
    const view = [0, 0, 595, 842];
    expect(strisciaCandidata([{ bbox: [57, 737, 291, 800], w: 650, h: 173 }, { bbox: [0, 218, 17, 842], w: 69, h: 2493 }], view)).toMatchObject({ verticale: true, lato: 'sinistra', bbox: [0, 218, 17, 842] });
    expect(strisciaCandidata([{ bbox: [20, 0, 575, 20], w: 2000, h: 70 }], view)).toMatchObject({ verticale: false, lato: 'basso' });
    expect(strisciaCandidata([{ bbox: [0, 0, 595, 842] }], view)).toBe(null); // scansione a pagina intera
    expect(strisciaCandidata([{ bbox: [280, 218, 297, 842] }], view)).toBe(null); // lontana dai bordi
    const OPS = { save: 1, restore: 2, transform: 3, paintImageXObject: 4, paintFormXObjectBegin: 5, paintFormXObjectEnd: 6 };
    const imgs = immaginiDisegnate([1, 3, 4, 2], [null, [17, 0, 0, 624, 0, 218], ['img1', 69, 2493], null], OPS);
    expect(imgs).toEqual([{ bbox: [0, 218, 17, 842], w: 69, h: 2493 }]);
  });
  it('accetta la forma del servizio dell\'area avanzati', () => {
    expect(normalizzaSegnatura({ numero: 12, data: '12/11/2026', sigla: 'CNR-ICCOM' })).toMatchObject({ numero: '12', data: '2026-11-12', aoo: 'CNR-ICCOM' });
    expect(normalizzaSegnatura({ number: '0001', date: '2026-01-02T00:00' })).toMatchObject({ numero: '0001', data: '2026-01-02' });
    expect(normalizzaSegnatura(null)).toBe(null);
    expect(normalizzaSegnatura({ data: '1/1/2026' })).toBe(null);
    expect(numeroConfrontabile('0012345')).toBe('12345');
    expect(numeroConfrontabile('n. 12.345')).toBe('N12345');
  });
  it('la segnatura letta rende «Protocollato (Titulus) … letto dal documento»; il numero a mano vale di più', () => {
    const seg = { numero: '0012345', data: '2026-11-12', aoo: 'CNR-ICCOM' };
    const e = conSegnatura({ protocollo: 'da', pagamento: 'da' }, seg);
    expect(e).toMatchObject({ protocollo: 'fatto', numeroProtocollo: '0012345', origineProtocollo: 'documento', pagamento: 'da' });
    expect(testoProtocollo(e)).toBe('Protocollato (Titulus) n. 0012345 del 12/11/2026 — letto dal documento');
    expect(haStato(e, 'protocollato')).toBe(true);
    expect(conSegnatura({ protocollo: 'fatto', numeroProtocollo: '999' }, seg).numeroProtocollo).toBe('999');
    expect(conSegnatura(null, null)).toBe(null);
  });
  it('evento «archivio:stato» dell\'area avanzati: due forme, origine indicata', () => {
    const m1 = modificaDaEvento({ path: '/x/f.xml', modifica: { imposta: 'protocollato', numeroProtocollo: '0123456', dataProtocollo: '2026-10-01' }, origine: 'segnatura', ricevuto: false });
    expect(m1).toEqual({ imposta: 'protocollato', numeroProtocollo: '0123456', dataProtocollo: '2026-10-01', origineProtocollo: 'segnatura' });
    const m2 = modificaDaEvento({ path: '/x/f.pdf', stato: 'protocollato', numero: '0000077', data: '01/02/2026', uor: 'XX000001', origine: 'lettura' });
    expect(m2).toEqual({ imposta: 'protocollato', numeroProtocollo: '0000077', dataProtocollo: '2026-02-01', uorProtocollo: 'XX000001', origineProtocollo: 'documento' });
    expect(modificaDaEvento({ stato: 'inventato' })).toBe(null);
    expect(modificaDaEvento(null)).toBe(null);
    const s = applica({ protocollo: 'da', pagamento: 'da' }, m1, 5);
    expect(testoProtocollo(s)).toBe('Protocollato (Titulus) n. 0123456 del 01/10/2026 — letto dalla segnatura di Titulus');
    expect(s.pagamento).toBe('da');
    // un numero inserito poi a mano toglie l'origine
    expect(applica(s, { imposta: 'protocollato', numeroProtocollo: '9' }).origineProtocollo).toBeUndefined();
  });
  it('elenco «file → numero» incollato (tabulazioni, frecce, «;», colonne da Excel)', () => {
    const l = leggiElencoProtocolli('Fattura_Alfa_12.pdf\t0012345\t12/11/2026\nDURC Beta.pdf → 0012346\nordine 3.pdf;12347;13.11.2026\nsenza numero.pdf\t\nnota.pdf 0012348 14/11/2026\n');
    expect(l).toEqual([
      { nome: 'Fattura_Alfa_12.pdf', numero: '0012345', data: '2026-11-12' },
      { nome: 'DURC Beta.pdf', numero: '0012346', data: '' },
      { nome: 'ordine 3.pdf', numero: '12347', data: '2026-11-13' },
      { nome: 'nota.pdf', numero: '0012348', data: '2026-11-14' },
    ]);
  });
});

describe('pronta per il pagamento', () => {
  const P = '00012345609';
  const durc = (id, data, scadenza) => ({ id, nome: id, tipo: 'durc', piva: P, data, scadenza });
  const fatt = (x) => ({ id: 'f', nome: 'f', tipo: 'fattura', piva: P, iban: 'IT60X0542811101000000123456', scadenza: '2026-12-10', mtime: Date.parse('2026-11-01T10:00:00'), ...x });
  it('DURC valido alla data di pagamento prevista, non solo a oggi', () => {
    const ind = indiciFornitori([durc('d1', '2026-08-01', '2026-11-29')]);
    const p = prontaPerPagamento(fatt(), null, ind, { oggi: '2026-11-12' });
    expect(p.esito).toBe('rosso');
    expect(p.motivi[0].testo).toMatch(/scade il 29\/11\/2026, prima del pagamento previsto \(10\/12\/2026\)/);
    const ind2 = indiciFornitori([durc('d1', '2026-08-01', '2026-11-29'), durc('d2', '2026-11-01', '2027-03-01')]);
    expect(prontaPerPagamento(fatt(), null, ind2, { oggi: '2026-11-12' }).esito).toBe('verde');
    // durata impostabile per i DURC senza scadenza scritta
    expect(prontaPerPagamento(fatt(), null, indiciFornitori([durc('d3', '2026-09-01', '')], { durataDurc: 120 }), { oggi: '2026-11-12' }).esito).toBe('verde');
  });
  it('IBAN confrontato con la dichiarazione di tracciabilità, solo se c\'è', () => {
    const base = [durc('d2', '2026-11-01', '2027-03-01')];
    const t = (iban) => ({ id: 't', nome: 't', tipo: 'tracciabilita', piva: P, iban, data: '2026-01-01' });
    expect(prontaPerPagamento(fatt(), null, indiciFornitori([...base, t('IT60X0542811101000000123456')]), { oggi: '2026-11-12' }).esito).toBe('verde');
    const p = prontaPerPagamento(fatt(), null, indiciFornitori([...base, t('IT02L1234512345123456789012')]), { oggi: '2026-11-12' });
    expect(p.esito).toBe('rosso');
    expect(p.motivi.find((m) => m.livello === 'rosso').testo).toMatch(/non è quello dichiarato/);
  });
  it('30 giorni (PCC) dalla ricezione se manca la scadenza; pagata; non fattura', () => {
    const r = fatt({ scadenza: '' });
    expect(pagamentoPrevisto(r)).toMatchObject({ data: '2026-12-01', fonte: 'pcc' });
    const p = prontaPerPagamento(r, null, indiciFornitori([durc('d2', '2026-11-01', '2027-03-01')]), { oggi: '2026-11-28' });
    expect(p.giorniPcc).toBe(3);
    expect(p.esito).toBe('giallo');
    expect(p.motivi.some((m) => /stimata/.test(m.testo))).toBe(true);
    expect(prontaPerPagamento(r, { pagamento: 'fatto' }, indiciFornitori([]))).toMatchObject({ esito: 'pagata' });
    expect(prontaPerPagamento({ tipo: 'durc' }, null, indiciFornitori([]))).toBe(null);
    expect(giorniSdi({ tipo: 'fattura', contenuto: 'fattura', mtime: Date.parse('2026-11-01T10:00:00') }, '2026-11-12')).toMatchObject({ fine: '2026-11-16', giorni: 4, stimata: true });
    expect(giorniSdi({ tipo: 'fattura', contenuto: 'pdf', mtime: 1 })).toBe(null);
    expect(aggiungiMesi('2026-11-30', 3)).toBe('2027-02-28');
  });
});

describe('Oggi e scadenzario', () => {
  const recs = [
    { id: '1', nome: 'durc vecchio', tipo: 'durc', piva: '00012345609', fornitore: 'Alfa', data: '2026-01-01', scadenza: '2026-05-01', impronta: H1, aggiunto: 5 },
    { id: '2', nome: 'durc nuovo', tipo: 'durc', piva: '00012345609', fornitore: 'Alfa', data: '2026-10-01', scadenza: '', impronta: H2, aggiunto: 5 },
    { id: '3', nome: 'durc scaduto', tipo: 'durc', piva: '00012424792', fornitore: 'Beta', data: '2026-06-01', scadenza: '2026-11-01', impronta: H3, aggiunto: 50 },
    { id: '4', nome: 'fattura', tipo: 'fattura', fornitore: 'Gamma', importo: 100, scadenza: '2026-11-15', impronta: 'd'.repeat(64), aggiunto: 50 },
  ];
  const stati = new Map([['d'.repeat(64), { pagamento: 'da', protocollo: 'da' }]]);
  it('DURC: vale il più recente per fornitore; durata da impostazione', () => {
    const o = riepilogoOggi({ records: recs, stati, impostazioni: { durataDurc: 45, preavvisoDurc: 15 }, ultimaApertura: 10, oggi: '2026-11-12' });
    expect(o.durc.map((d) => d.nome)).toEqual(['durc scaduto', 'durc nuovo']);
    expect(o.durc[0]).toMatchObject({ scaduto: true, giorni: -11 });
    expect(o.durc[1]).toMatchObject({ calcolata: true, scadenza: '2026-11-15', giorni: 3 });
    expect(o.fatture[0]).toMatchObject({ nome: 'fattura', giorni: 3, vicina: true });
    expect(o.daProtocollare).toHaveLength(1);
    expect(o.nuovi.map((n) => n.id).sort()).toEqual(['3', '4']);
    // con la durata predefinita (120 giorni) il DURC nuovo non è in scadenza
    expect(riepilogoOggi({ records: recs, stati, oggi: '2026-11-12' }).durc.map((d) => d.nome)).toEqual(['durc scaduto']);
    expect(scadenzaDurc({ data: '2026-01-01' }, 120)).toEqual({ scadenza: '2026-05-01', calcolata: true });
    expect(testoGiorni(-3)).toBe('scaduto da 3 giorni');
    expect(testoGiorni(0)).toBe('scade oggi');
  });
  it('propone le fatture in scadenza dai dati della fattura, anche se non segnate', () => {
    const r = [
      { id: 'a', nome: 'a', tipo: 'fattura', scadenza: '2026-11-20', impronta: H1 },
      { id: 'b', nome: 'b', tipo: 'fattura', scadenza: '2026-11-01', impronta: H2 },
      { id: 'c', nome: 'c', tipo: 'fattura', scadenza: '2026-09-01', impronta: H3 }, // troppo vecchia
      { id: 'd', nome: 'd', tipo: 'fattura', scadenza: '2026-11-15', impronta: 'd'.repeat(64) }, // già «da pagare»
      { id: 'e', nome: 'e', tipo: 'fattura', scadenza: '2026-12-31', impronta: 'e'.repeat(64) }, // lontana
      { id: 'f', nome: 'f', tipo: 'fattura', scadenza: '2026-11-13', impronta: 'f'.repeat(64) }, // pagata
    ];
    const st = new Map([['d'.repeat(64), { pagamento: 'da' }], ['f'.repeat(64), { pagamento: 'fatto' }]]);
    const o = riepilogoOggi({ records: r, stati: st, oggi: '2026-11-12' });
    expect(o.inScadenza.map((x) => x.id)).toEqual(['b', 'a']);
    expect(o.inScadenza[0]).toMatchObject({ scaduto: true, giorni: -11 });
    expect(o.fatture.map((x) => x.id)).toEqual(['d']);
  });
  it('SdI, non protocollati, anomalie di protocollo, pubblicazioni', () => {
    const ora = Date.parse('2026-11-12T12:00:00');
    const r = [
      { id: 'x1', nome: 'IT1.xml', tipo: 'fattura', contenuto: 'fattura', mtime: Date.parse('2026-11-01T10:00:00'), aggiunto: ora - 2 * 86400000, impronta: 'a'.repeat(64) },
      { id: 'p1', nome: 'pec.eml', tipo: 'pec', aggiunto: ora - 5 * 86400000, impronta: 'b'.repeat(64) },
      { id: 'p2', nome: 'vecchio.pdf', tipo: 'pec', aggiunto: 10, impronta: 'c'.repeat(64) }, // arrivato prima dell'archivio
      { id: 'p3', nome: 'Elaborati/copia.pdf', rel: 'x/Elaborati/copia.pdf', tipo: 'fattura', aggiunto: ora - 9 * 86400000, impronta: 'd'.repeat(64) },
      { id: 'a1', nome: 'a1', tipo: 'ordine', segnatura: { numero: '0004200', data: '2026-10-01' }, impronta: 'e'.repeat(64), aggiunto: 10 },
      { id: 'a2', nome: 'a2', tipo: 'fattura', segnatura: { numero: '4200', data: '2026-10-02' }, impronta: 'f'.repeat(64), aggiunto: 10 },
      { id: 'a3', nome: 'a3-copia', rel: 'x/Elaborati/a3.pdf', tipo: 'fattura', segnatura: { numero: '4200', data: '2026-10-02' }, impronta: '1'.repeat(64), aggiunto: 10 },
      { id: 'i1', nome: 'incarico', tipo: 'incarico', data: '2026-09-01', dataFine: '2027-08-31', impronta: '2'.repeat(64), aggiunto: 10 },
    ];
    const st = new Map([['2'.repeat(64), { pubblicato: 'da' }]]);
    const o = riepilogoOggi({ records: r, stati: st, inizioArchivio: 100, oggi: '2026-11-12' });
    expect(o.sdi.map((x) => x.id)).toEqual(['x1']);
    expect(o.sdi[0]).toMatchObject({ fine: '2026-11-16', giorni: 4, stimata: true });
    expect(o.nonProtocollati.map((x) => x.id)).toEqual(['p1']);
    expect(o.anomalie).toHaveLength(1);
    expect(o.anomalie[0].documenti.map((d) => d.id).sort()).toEqual(['a1', 'a2']);
    expect(o.pubblicazioni[0]).toMatchObject({ id: 'i1', entro: '2026-12-01', finoAl: '2030-08-31' });
    // «Non serve» toglie dai non protocollati
    const o2 = riepilogoOggi({ records: r, stati: new Map([['b'.repeat(64), { protocollo: 'no' }]]), inizioArchivio: 100, oggi: '2026-11-12' });
    expect(o2.nonProtocollati).toHaveLength(0);
  });
  it('un documento con la segnatura letta non è più «da protocollare»', () => {
    const r = [{ ...recs[3], segnatura: { numero: '77', data: '2026-11-12' } }];
    expect(riepilogoOggi({ records: r, stati, oggi: '2026-11-12' }).daProtocollare).toHaveLength(0);
  });
  it('documenti archiviati esclusi; nessun «nuovo» alla prima apertura', () => {
    const o = riepilogoOggi({ records: recs, stati: new Map([[H3, { archiviato: true }]]), oggi: '2026-11-12' });
    expect(o.durc).toHaveLength(0);
    expect(o.nuovi).toHaveLength(0);
  });
});

describe('motore di ricerca', () => {
  const doc = (i, x) => ({ id: '/a/' + i, path: '/a/' + i, rel: String(i), cartella: 'c1', nome: `doc${i}.pdf`, ext: 'pdf', size: 1, mtime: 0, tipo: 'altro', testo: '', impronta: (String(i % 10)).repeat(64), ...x });
  function motore() {
    const m = new Motore();
    m.metti(doc(1, { tipo: 'fattura', fornitore: 'Alfa Strumenti', data: '2026-01-10', importo: 50, cig: ['Z34F05AF62'], testo: 'Fattura per reagenti\fpagina due con la Colonna cromatografica' }));
    m.metti(doc(2, { tipo: 'durc', fornitore: 'Beta Reagenti', data: '2026-05-01', testo: 'Documento unico di regolarità contributiva' }));
    m.metti(doc(3, { tipo: 'fattura', fornitore: 'Gamma', data: '2025-03-01', importo: 500, cup: ['B53C22001230006'], testo: 'Perché è così: fattura reagenti reagenti reagenti', cartella: 'c2' }));
    m.stati.set('3'.repeat(64), { pagamento: 'da', etichette: ['PNRR'], nota: 'verificare con il RUP' });
    return m;
  }
  it('cerca nel testo, ignora maiuscole e accenti, con pagina', () => {
    const m = motore();
    const r = m.cerca({ q: 'COLONNA cromatografica' });
    expect(r.totale).toBe(1);
    expect(r.righe[0]).toMatchObject({ id: '/a/1', pagina: 2 });
    expect(m.cerca({ q: 'perche e cosi' }).righe[0].id).toBe('/a/3');
    expect(m.cerca({ q: '"regolarita contributiva"' }).totale).toBe(1);
    expect(m.cerca({ q: 'reagenti' }).righe.map((x) => x.id)).toEqual(['/a/2', '/a/3', '/a/1']); // nel fornitore vale di più
    expect(m.cerca({ q: 'rup' }).righe.map((x) => x.id)).toEqual(['/a/3']); // nota d'ufficio
    expect(m.cerca({ q: 'z34f05af62' }).totale).toBe(1);
  });
  it('filtri e ordinamenti', () => {
    const m = motore();
    expect(m.cerca({ tipo: 'fattura' }).totale).toBe(2);
    expect(m.cerca({ fornitore: 'beta' }).totale).toBe(1);
    expect(m.cerca({ dal: '2026-01-01', al: '2026-02-01' }).totale).toBe(1);
    expect(m.cerca({ cigcup: 'B53C' }).righe[0].id).toBe('/a/3');
    expect(m.cerca({ stato: 'da-pagare' }).totale).toBe(1);
    expect(m.cerca({ stato: 'etichetta:pnrr' }).totale).toBe(1);
    expect(m.cerca({ stato: 'senza-stato' }).totale).toBe(2);
    expect(m.cerca({ cartella: 'c2' }).totale).toBe(1);
    expect(m.cerca({ ordine: 'importo-desc' }).righe.map((x) => x.id)).toEqual(['/a/3', '/a/1', '/a/2']);
    expect(m.cerca({ ordine: 'data-desc' }).righe.map((x) => x.id)).toEqual(['/a/2', '/a/1', '/a/3']);
    expect(m.cerca({}).righe[0].testo).toBeUndefined(); // il testo non va all'interfaccia
  });
  it('filtro e ordinamento per numero di protocollo (letto o inserito)', () => {
    const m = motore();
    m.metti(doc(4, { segnatura: { numero: '0012345', data: '2026-11-12', aoo: 'CNR-ICCOM' } }));
    m.stati.set('1'.repeat(64), { protocollo: 'fatto', numeroProtocollo: '0000077' });
    expect(m.cerca({ protocollo: '12345' }).righe.map((x) => x.id)).toEqual(['/a/4']);
    expect(m.cerca({ protocollo: '77' }).righe.map((x) => x.id)).toEqual(['/a/1']);
    expect(m.cerca({ q: '0012345' }).totale).toBe(1);
    expect(m.cerca({ stato: 'protocollato' }).totale).toBe(2);
    expect(m.cerca({ ordine: 'protocollo' }).righe.slice(0, 2).map((x) => x.id)).toEqual(['/a/1', '/a/4']);
    expect(m.riga('/a/4').chips[0].testo).toBe('Protocollato (Titulus) n. 0012345 del 12/11/2026 — letto dal documento');
  });
  it('pratica collegata: stesso protocollo, CIG o CUP, in ordine di data', () => {
    const m = new Motore();
    m.metti(doc(1, { tipo: 'ordine', data: '2026-01-10', cig: ['Z34F05AF62'] }));
    m.metti(doc(2, { tipo: 'fattura', data: '2026-03-01', cig: ['Z34F05AF62'], cup: ['B53C22001230006'] }));
    m.metti(doc(3, { tipo: 'durc', data: '2026-02-01', segnatura: { numero: '0004200', data: '2026-02-02' } }));
    m.metti(doc(4, { tipo: 'ordine', data: '2025-12-01', segnatura: { numero: '4200', data: '2025-12-02' } }));
    m.metti(doc(5, { tipo: 'altro', data: '2026-01-01' }));
    m.stati.set('2'.repeat(64), { protocollo: 'fatto', numeroProtocollo: '0004200' });
    const p = m.pratica('/a/2');
    expect(p.documenti.map((d) => d.id)).toEqual(['/a/4', '/a/1', '/a/3', '/a/2']);
    expect(p.documenti.find((d) => d.id === '/a/1').perche).toEqual(['CIG']);
    expect(p.documenti.find((d) => d.id === '/a/4').perche).toEqual(['protocollo']);
    expect(m.pratica('/a/5').documenti).toHaveLength(1);
  });
  it('fornitori raggruppati per P.IVA con il nome più frequente', () => {
    const m = new Motore();
    m.metti(doc(1, { fornitore: 'Delta Lab', piva: '00012345609' }));
    m.metti(doc(2, { fornitore: 'Delta Lab S.n.c.', piva: '00012345609' }));
    m.metti(doc(3, { fornitore: 'Delta Lab', piva: '00012345609' }));
    m.metti(doc(4, { fornitore: 'Spett.le Delta Lab', piva: '00012345609' }));
    m.metti(doc(5, { fornitore: 'Altro', piva: '' }));
    expect(m.conteggi().fornitori).toEqual([{ nome: 'Delta Lab', piva: '00012345609', n: 4 }, { nome: 'Altro', piva: '', n: 1 }]);
    expect(m.riga('/a/2').fornitore).toBe('Delta Lab');
    expect(m.riga('/a/2').fornitoreLetto).toBe('Delta Lab S.n.c.');
    expect(m.cerca({ fornitore: '00012345609' }).totale).toBe(4);
    expect(m.cerca({ fornitore: 'delta lab' }).totale).toBe(4);
  });
  it('estratti e conteggi', () => {
    const m = motore();
    const e = m.estratti(['/a/1'], 'colonna');
    expect(e['/a/1'][0]).toMatchObject({ pagina: 2, trovato: 'Colonna' });
    const c = m.conteggi();
    expect(c.tipi).toEqual({ fattura: 2, durc: 1 });
    expect(c.etichette).toEqual([{ nome: 'PNRR', n: 1 }]);
  });
  // limiti larghi: le misure vere sono nel benchmark (la CI e le macchine cariche sono lente)
  it('10.000 documenti: ricerca entro limiti ragionevoli', () => {
    const m = new Motore();
    const parole = ['fattura', 'reagente', 'colonna', 'manutenzione', 'durc', 'contratto', 'missione', 'roma', 'pisa', 'firenze', 'strumento', 'servizio'];
    for (let i = 0; i < 10000; i++) {
      let t = ''; for (let k = 0; k < 600; k++) t += parole[(i * 7 + k * 13) % parole.length] + ' ';
      m.metti(doc(i, { testo: t + ` numero${i}`, fornitore: 'Ditta ' + (i % 300), data: `2026-0${1 + (i % 9)}-1${i % 10}` }));
    }
    const t0 = performance.now();
    const r = m.cerca({ q: 'numero9876' });
    const ms1 = performance.now() - t0;
    expect(r.totale).toBe(1);
    const t1 = performance.now();
    const r2 = m.cerca({ q: 'manutenzione pisa', ordine: 'data-desc' });
    const ms2 = performance.now() - t1;
    expect(r2.totale).toBe(10000);
    expect(ms1).toBeLessThan(10000);
    expect(ms2).toBeLessThan(30000);
  }, 120000);
});

describe('indice a blocchi', () => {
  it('nuovi documenti nel blocco aperto, aggiornamenti e rimozioni riscrivono solo il loro blocco', () => {
    const b = new Blocchi();
    for (let i = 0; i < DIM + 10; i++) b.metti('d' + i);
    let p = b.prepara((id) => JSON.stringify({ id }));
    expect(p.scrivi).toHaveLength(2);
    expect(p.manifesto.blocchi.map((x) => x.n)).toEqual([DIM, 10]);
    b.conferma(p);
    expect(b.daScrivere).toBe(false);
    b.metti('d3'); // aggiornamento nel primo blocco
    p = b.prepara((id) => JSON.stringify({ id }));
    expect(p.scrivi).toHaveLength(1);
    expect(p.elimina).toHaveLength(1);
    b.conferma(p);
    for (let i = DIM; i < DIM + 10; i++) b.togli('d' + i);
    p = b.prepara((id) => JSON.stringify({ id }));
    expect(p.scrivi).toHaveLength(0);
    expect(p.manifesto.blocchi).toHaveLength(1);
    b.conferma(p);
    expect(b.blocchi.size).toBe(1);
  });
  it('una scrittura non riuscita lascia i blocchi da scrivere; cambi durante la scrittura non si perdono', () => {
    const b = new Blocchi();
    b.metti('a');
    const p = b.prepara((id) => JSON.stringify({ id }));
    b.metti('b'); // arriva durante la scrittura
    b.annulla(p);
    const p2 = b.prepara((id) => JSON.stringify({ id }));
    expect(p2.scrivi[0].testo.trim().split('\n')).toHaveLength(2);
    b.conferma(p2);
    expect(b.daScrivere).toBe(false);
  });
  it('ricarica dal manifesto e tollera righe rovinate', () => {
    const { docs, rovinate } = leggiBlocco('{"id":"x"}\n{rotto\n\n{"id":"y"}\n{"senza":1}\n');
    expect(docs.map((d) => d.id)).toEqual(['x', 'y']);
    expect(rovinate).toBe(2);
    expect(manifestoValido({ formato: 'altro' })).toBe(null);
    const m = manifestoValido({ formato: 'leggio-archivio-indice', blocchi: [{ file: 'b-k1-2.ndjson' }, { file: '../etc/passwd' }] });
    expect(m.blocchi).toHaveLength(1);
    const b = new Blocchi();
    b.carica({ seq: 5 }, [{ chiave: 'k1', file: 'b-k1-2.ndjson', ids: ['x', 'y'] }]);
    b.metti('z');
    const p = b.prepara((id) => JSON.stringify({ id }));
    expect(p.scrivi[0].file).toMatch(/^b-k1-/);
    expect(p.elimina).toEqual(['b-k1-2.ndjson']);
  });
});

describe('esportazione del registro', () => {
  const righe = [
    { tipo: 'fattura', data: '2026-03-01', numero: '12/2026', fornitore: 'Alfa; "Beta" S.r.l.', piva: '00012345609', importo: 1220.5, cig: ['Z34F05AF62'], cup: [], scadenza: '2026-04-01', stato: { pagamento: 'da', protocollo: 'fatto', numeroProtocollo: '0012345', dataProtocollo: '2026-11-12', origineProtocollo: 'documento' }, nome: 'f.pdf', path: '/x/f.pdf', impronta: H1, firme: 1, pagine: 2 },
    { tipo: 'durc', fornitore: '=SOMMA(1;2)', nome: 'd.pdf' },
  ];
  it('CSV per Excel italiano', () => {
    const csv = registroCsv(righe);
    expect(csv.startsWith('\uFEFFTipo;N. protocollo;Data protocollo;UOR;Origine protocollo;Data;')).toBe(true);
    expect(csv).toContain('Fattura;0012345;12/11/2026;;letto dal documento;01/03/2026;12/2026;"Alfa; ""Beta"" S.r.l.";00012345609;;1220,50;Z34F05AF62;');
    expect(csv).toContain(`"'=SOMMA(1;2)"`); // niente formule eseguite da Excel
  });
  it('XLSX valido (ZIP leggibile, fogli e stili)', () => {
    expect(serialeExcel('2026-03-01')).toBe(46082);
    const bytes = registroXlsx(righe);
    expect([...bytes.slice(0, 2)]).toEqual([0x50, 0x4b]);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'leggio-xlsx-'));
    const f = path.join(dir, 'r.xlsx');
    fs.writeFileSync(f, bytes);
    try {
      const out = execFileSync('unzip', ['-l', f], { encoding: 'utf8' });
      expect(out).toContain('xl/worksheets/sheet1.xml');
      const sheet = execFileSync('unzip', ['-p', f, 'xl/worksheets/sheet1.xml'], { encoding: 'utf8' });
      expect(sheet).toContain('<v>1220.5</v>');
      expect(sheet).toContain('Alfa; &quot;Beta&quot; S.r.l.');
      execFileSync('unzip', ['-t', f]);
    } catch (e) {
      if (e.code === 'ENOENT') return; // unzip non installato (Windows): il controllo della firma ZIP basta
      throw e;
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
  it('ZIP vuoto valido', () => {
    const z = zipSenzaCompressione([]);
    expect(z.length).toBe(22);
  });
});
