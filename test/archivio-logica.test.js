import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { normalizza, interpretaRicerca, paginaDi, estratto, numeroIt, dataDaTesto, giorniTra, aggiungiGiorni } from '../src/renderer/features/archivio/lib/testo.js';
import { riconosciTipo, pivaValida, cfValido, trovaCigCup, trovaCodici, trovaImporto, datiDaTesto, datiDaFattura, eScansione, firmePdf, pulisciFornitore } from '../src/renderer/features/archivio/lib/estrai.js';
import { applica, haStato, descrivi, esportaJson, esportaCsv, importa, unisci, leggiCsv } from '../src/renderer/features/archivio/lib/stati.js';
import { riepilogoOggi, scadenzaDurc, testoGiorni } from '../src/renderer/features/archivio/lib/scadenze.js';
import { Motore } from '../src/renderer/features/archivio/lib/motore.js';
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
    expect(descrivi(s).map((c) => c.testo)).toEqual(['Protocollato n. 0001234', 'Da pagare', 'PNRR', 'Gara 2026']);
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
  });
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
    { tipo: 'fattura', data: '2026-03-01', numero: '12/2026', fornitore: 'Alfa; "Beta" S.r.l.', piva: '00012345609', importo: 1220.5, cig: ['Z34F05AF62'], cup: [], scadenza: '2026-04-01', stato: { pagamento: 'da' }, nome: 'f.pdf', path: '/x/f.pdf', impronta: H1, firme: 1, pagine: 2 },
    { tipo: 'durc', fornitore: '=SOMMA(1;2)', nome: 'd.pdf' },
  ];
  it('CSV per Excel italiano', () => {
    const csv = registroCsv(righe);
    expect(csv.startsWith('﻿Tipo;Data;')).toBe(true);
    expect(csv).toContain('Fattura;01/03/2026;12/2026;"Alfa; ""Beta"" S.r.l.";00012345609;;1220,50;Z34F05AF62;');
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
