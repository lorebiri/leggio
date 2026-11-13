import { describe, it, expect } from 'vitest';
import { parseFattura } from '../src/renderer/features/avanzati/lib/fattura.js';
import { regole, validaRegole, controlliFattura, dataRicezioneDaMetadati, riconosciOrdine, abbinaFatturaOrdini, bolloContratto, controlliContratto, trovaF24, datiPerUgov } from '../src/renderer/features/avanzati/lib/controlli.js';
import { classificaGiustificativo, nomeGiustificativo } from '../src/renderer/features/avanzati/lib/missione.js';
import { modelloPredefinito, leggiModello, valutaLista, doppioUtilizzo } from '../src/renderer/features/avanzati/lib/checklist.js';
import { FATTURA_FPA12 } from './avanzati-fattura.test.js';

// fattura sintetica: un corpo modificabile
const fattura = ({ tipo = 'TD01', cig = '<CodiceCIG>Z1A2B3C4D5</CodiceCIG>', cup = '<CodiceCUP>B12C34000560001</CodiceCUP>', esig = 'I', ritenuta = '', natura = '', bollo = '', collegata = '', paese = 'IT', imponibile = '1000.00', imposta = '220.00', totale = '1220.00' } = {}) => parseFattura(`<?xml version="1.0"?><p:FatturaElettronica versione="FPA12" xmlns:p="x"><FatturaElettronicaHeader>
<CedentePrestatore><DatiAnagrafici><IdFiscaleIVA><IdPaese>${paese}</IdPaese><IdCodice>02118311006</IdCodice></IdFiscaleIVA><Anagrafica><Denominazione>Vetreria Prova Spa</Denominazione></Anagrafica></DatiAnagrafici></CedentePrestatore>
<CessionarioCommittente><DatiAnagrafici><CodiceFiscale>80054330586</CodiceFiscale><Anagrafica><Denominazione>CNR</Denominazione></Anagrafica></DatiAnagrafici></CessionarioCommittente></FatturaElettronicaHeader>
<FatturaElettronicaBody><DatiGenerali><DatiGeneraliDocumento><TipoDocumento>${tipo}</TipoDocumento><Divisa>EUR</Divisa><Data>2026-11-02</Data><Numero>919/2026</Numero>${ritenuta}${bollo}<ImportoTotaleDocumento>${totale}</ImportoTotaleDocumento><Causale>Vetreria da laboratorio</Causale></DatiGeneraliDocumento>
<DatiOrdineAcquisto><IdDocumento>ORD-55</IdDocumento>${cup}${cig}</DatiOrdineAcquisto>${collegata}</DatiGenerali>
<DatiBeniServizi><DettaglioLinee><NumeroLinea>1</NumeroLinea><Descrizione>Beute</Descrizione><PrezzoTotale>${imponibile}</PrezzoTotale><AliquotaIVA>${natura ? '0.00' : '22.00'}</AliquotaIVA>${natura ? `<Natura>${natura}</Natura>` : ''}</DettaglioLinee>
<DatiRiepilogo><AliquotaIVA>${natura ? '0.00' : '22.00'}</AliquotaIVA>${natura ? `<Natura>${natura}</Natura>` : ''}<ImponibileImporto>${imponibile}</ImponibileImporto><Imposta>${imposta}</Imposta><EsigibilitaIVA>${esig}</EsigibilitaIVA></DatiRiepilogo></DatiBeniServizi>
<DatiPagamento><CondizioniPagamento>TP02</CondizioniPagamento><DettaglioPagamento><ModalitaPagamento>MP05</ModalitaPagamento><DataScadenzaPagamento>2026-12-02</DataScadenzaPagamento><ImportoPagamento>1000.00</ImportoPagamento><IBAN>IT60X0542811101000000123456</IBAN></DettaglioPagamento></DatiPagamento>
</FatturaElettronicaBody></p:FatturaElettronica>`);
const ids = (av) => av.map((a) => a.id);
const oggi = new Date(2026, 10, 12);

describe('regole aggiornabili', () => {
  it('ogni regola ha fonte e data; un aggiornamento cambia solo le voci date', () => {
    const r = regole();
    for (const k of ['sdi', 'cigCup', 'splitPayment', 'bolloFatture', 'bolloContratti', 'pagamentiTracciabili']) { expect(r[k].fonte).toBeTruthy(); expect(r[k].aggiornato).toMatch(/^\d{4}-\d{2}-\d{2}$/); }
    const r2 = regole({ versione: '2027-01-01', bolloFatture: { soglia: 100, aggiornato: '2027-01-01' } });
    expect(r2.bolloFatture).toMatchObject({ soglia: 100, importo: 2 });
    expect(r2.versione).toBe('2027-01-01');
    expect(validaRegole({ bolloContratti: { fasce: [{ fino: 1 }] } })).toMatch(/non è valida/);
    expect(validaRegole({ sdi: { giorniEsito: 15 } })).toBeNull();
  });
});

describe('controlli FatturaPA', () => {
  it('fattura in regola e senza data di ricezione: nessun avviso (niente richieste ripetute)', () => {
    expect(ids(controlliFattura(fattura(), { oggi }))).toEqual([]);
  });
  it('giorni rimasti dalla consegna SdI (15)', () => {
    const a = controlliFattura(fattura(), { oggi, dataRicezione: '2026-11-03' });
    expect(a[0]).toMatchObject({ id: 'sdi-giorni', livello: 'info' });
    expect(a[0].testo).toBe('Restano 6 giorni per accettare o rifiutare (fino al 18/11/2026).');
    expect(controlliFattura(fattura(), { oggi, dataRicezione: '2026-10-30' })[0]).toMatchObject({ livello: 'avviso' });
    expect(controlliFattura(fattura(), { oggi, dataRicezione: '2026-10-20' })[0].id).toBe('sdi-scaduto');
    expect(controlliFattura(fattura(), { oggi, dataRicezione: '2026-06-01' })).toEqual([]); // scaduto da mesi: silenzio
    const stima = controlliFattura(fattura(), { oggi, dataRicezione: '2026-11-03', fonteRicezione: 'stima' })[0];
    expect(stima.testo).toMatch(/Data stimata dal file/);
    expect(stima.azione).toMatchObject({ tipo: 'data-ricezione', etichetta: 'Correggi la data' });
    expect(dataRicezioneDaMetadati('<ns:DataOraRicezione>2026-11-03T10:22:00</ns:DataOraRicezione>')).toBe('2026-11-03');
  });
  it('CIG e CUP mancanti come cause di rifiuto ammesse, con la fonte', () => {
    const a = controlliFattura(fattura({ cig: '', cup: '' }), { oggi, dataRicezione: '2026-11-11' });
    const cig = a.find((x) => x.id === 'cig-mancante');
    expect(cig.testo).toMatch(/tra le cause di rifiuto ammesse/);
    expect(cig.aiuto).toMatch(/DL 66\/2014.*DM 132\/2020/);
    expect(a.find((x) => x.id === 'cup-mancante')).toBeUndefined(); // CUP non dovuto: nessun avviso
    expect(controlliFattura(fattura({ cup: '' }), { oggi, cupDovuto: true }).find((x) => x.id === 'cup-mancante').testo).toMatch(/che questo acquisto richiede/);
    expect(ids(controlliFattura(fattura({ cig: '<CodiceCIG>Z1A2</CodiceCIG>' }), { oggi }))).toContain('cig-formato');
  });
  it('nota di credito senza fattura collegata', () => {
    expect(ids(controlliFattura(fattura({ tipo: 'TD04' }), { oggi }))).toContain('nc-senza-fattura');
    expect(ids(controlliFattura(fattura({ tipo: 'TD04', collegata: '<DatiFattureCollegate><IdDocumento>800/2026</IdDocumento><Data>2026-10-01</Data></DatiFattureCollegate>' }), { oggi }))).not.toContain('nc-senza-fattura');
  });
  it('scissione dei pagamenti insieme a una ritenuta; fornitore estero con split', () => {
    const rit = '<DatiRitenuta><TipoRitenuta>RT01</TipoRitenuta><ImportoRitenuta>200.00</ImportoRitenuta><AliquotaRitenuta>20.00</AliquotaRitenuta><CausalePagamento>A</CausalePagamento></DatiRitenuta>';
    expect(ids(controlliFattura(fattura({ esig: 'S', ritenuta: rit }), { oggi }))).toContain('split-ritenuta');
    expect(ids(controlliFattura(fattura({ esig: 'S' }), { oggi }))).not.toContain('split-ritenuta');
    expect(ids(controlliFattura(fattura({ esig: 'S', paese: 'DE' }), { oggi }))).toContain('split-estero');
  });
  it('bollo mancante sulle fatture esenti sopra 77,47 €', () => {
    const esente = { natura: 'N4', imposta: '0.00', totale: '1000.00' };
    expect(ids(controlliFattura(fattura(esente), { oggi }))).toContain('bollo-mancante');
    expect(ids(controlliFattura(fattura({ ...esente, bollo: '<DatiBollo><BolloVirtuale>SI</BolloVirtuale><ImportoBollo>2.00</ImportoBollo></DatiBollo>', totale: '1002.00' }), { oggi }))).not.toContain('bollo-mancante');
    expect(ids(controlliFattura(fattura({ ...esente, imponibile: '50.00', totale: '50.00' }), { oggi }))).not.toContain('bollo-mancante');
    // la soglia viene dal file di regole
    expect(ids(controlliFattura(fattura(esente), { oggi, regole: regole({ bolloFatture: { soglia: 5000 } }) }))).not.toContain('bollo-mancante');
  });
  it('la fattura di prova del progetto (due documenti) dà avvisi per il documento giusto', () => {
    const a = controlliFattura(parseFattura(FATTURA_FPA12), { oggi });
    expect(a.find((x) => x.id === 'cig-mancante').testo).toMatch(/documento 2: n\. 7/);
  });
  it('IBAN diverso da quello delle fatture precedenti dello stesso fornitore', () => {
    const noti = [{ iban: 'IT02 L123 4512 3451 2345 6789 012', numero: '800' }];
    const a = controlliFattura(fattura(), { oggi, ibanNoti: noti });
    expect(a.find((x) => x.id === 'iban-cambiato').testo).toMatch(/IBAN diverso.*IT02…9012/);
    expect(ids(controlliFattura(fattura(), { oggi, ibanNoti: [{ iban: 'IT60X0542811101000000123456' }] }))).not.toContain('iban-cambiato');
    expect(ids(controlliFattura(fattura(), { oggi, ibanNoti: [] }))).not.toContain('iban-cambiato');
  });
});

describe('ordini e determine (anche MePA) e abbinamento', () => {
  const oda = 'MePA AcquistinretePA — Ordine diretto di acquisto. Numero ordine: 7654321. Fornitore: Vetreria Prova Spa P.IVA 02118311006. CIG Z1A2B3C4D5. Totale ordine (IVA esclusa) € 900,00';
  const td = 'Trattativa diretta n. 4455667 su MePA. Operatore economico: Vetreria Prova Spa, P.IVA 02118311006. CIG Z9F8E7D6C5. Importo di aggiudicazione € 12.500,00';
  const det = 'Determina a contrarre n. 123/2026 per l\'affidamento diretto. CIG Z1A2B3C4D5. Importo complessivo € 1.000,00';
  it('riconosce ODA, trattativa diretta e determina', () => {
    expect(riconosciOrdine(oda)).toMatchObject({ tipo: 'Ordine diretto MePA (ODA)', numero: '7654321', cig: ['Z1A2B3C4D5'], importo: 900, piva: ['02118311006'], fornitore: 'Vetreria Prova Spa' });
    expect(riconosciOrdine(td)).toMatchObject({ tipo: 'Trattativa diretta MePA', numero: '4455667', importo: 12500 });
    expect(riconosciOrdine(det)).toMatchObject({ tipo: 'Determina', numero: '123/2026', importo: 1000 });
    expect(riconosciOrdine('Lettera di saluti')).toBeNull();
  });
  it('abbina per CIG, numero d\'ordine e P.IVA; avvisa se la fattura supera l\'ordinato', () => {
    const f = fattura();
    const ordini = [{ id: 'a', nome: 'ODA 7654321', ...riconosciOrdine(oda) }, { id: 'b', nome: 'TD 4455667', ...riconosciOrdine(td) }];
    const r = abbinaFatturaOrdini(f, ordini);
    expect(r.abbinati[0].ordine.id).toBe('a');
    expect(r.abbinati[0].motivi).toEqual(['stesso CIG', 'stessa P.IVA']);
    expect(r.avvisi[0]).toMatchObject({ id: 'supera-ordine', azione: { tipo: 'apri', valore: 'a' } });
    expect(r.avvisi[0].testo).toMatch(/1\.000,00 €.*900,00 €/);
    const perNumero = abbinaFatturaOrdini(f, [{ id: 'c', nome: 'Ordine', numero: 'ORD-55', cig: [], importo: 2000, piva: [] }]);
    expect(perNumero.abbinati[0].motivi).toEqual(['numero d\'ordine citato in fattura']);
    expect(perNumero.avvisi).toEqual([]);
    expect(abbinaFatturaOrdini(f, []).avvisi[0].id).toBe('ordine-non-trovato');
  });
});

describe('bollo sui contratti (All. I.4) e ricevuta F24 1573', () => {
  it('fasce della tabella', () => {
    expect(bolloContratto(39999).importo).toBe(0);
    expect(bolloContratto(40000).importo).toBe(40);
    expect(bolloContratto(149999).importo).toBe(40);
    expect(bolloContratto(150000).importo).toBe(120);
    expect(bolloContratto(3e6).importo).toBe(250);
    expect(bolloContratto(3e7).importo).toBe(1000);
  });
  it('avviso solo per i contratti; F24 cercata tra i documenti della pratica', () => {
    const contratto = 'CONTRATTO di fornitura. Importo massimo del contratto € 120.000,00 comprensivo di opzioni.';
    const a = controlliContratto(contratto, {});
    expect(a[0]).toMatchObject({ id: 'bollo-contratto', livello: 'avviso' });
    expect(a[0].testo).toBe('Contratto da 120.000,00 €: bollo di 40,00 € a carico dell\'appaltatore. Manca la ricevuta F24 con codice 1573.');
    const conF24 = controlliContratto(contratto, { testiPratica: ['Modello F24 ELIDE — codice tributo 1573 — importo 40,00'] });
    expect(conF24[0]).toMatchObject({ livello: 'info' });
    expect(controlliContratto('CONTRATTO. Importo del contratto € 10.000,00', {})).toEqual([]);
    expect(controlliContratto('Fattura n. 3', {})).toEqual([]);
    expect(controlliContratto('Contratto di servizio', {})[0].id).toBe('bollo-importo');
    expect(trovaF24(['F24 codice 1574'])).toBe(-1);
  });
});

describe('dati per U-GOV', () => {
  it('dalla FatturaPA, nell\'ordine della maschera', () => {
    const d = datiPerUgov({ fattura: fattura({ esig: 'S' }) });
    expect(d.map((x) => x.chiave)).toEqual(['soggetto', 'piva', 'tipo', 'numero', 'data', 'descrizione', 'imponibile', 'iva', 'totale', 'esigibilita', 'cig', 'cup', 'ordine', 'scadenza', 'iban']);
    expect(Object.fromEntries(d.map((x) => [x.chiave, x.valore]))).toMatchObject({ soggetto: 'Vetreria Prova Spa', piva: 'IT02118311006', numero: '919/2026', imponibile: '1000,00', esigibilita: 'Scissione dei pagamenti (S)', ordine: 'ORD-55' });
  });
});

describe('giustificativi per U-Web', () => {
  it('tipo di spesa, importo, data e tipo di allegato proposto', () => {
    const c = classificaGiustificativo('Ristorante Da Mario — 12/11/2026 — Coperto 2,00 — Totale EUR 34,50 — Pagamento con carta VISA');
    expect(c).toMatchObject({ tipoSpesa: 'pasto', importo: 34.5, data: '2026-11-12', pagamento: 'tracciabile', contantiDaSegnalare: false });
    expect(c.tipoAllegato).toMatch(/con indicazione del tipo pagamento/);
    expect(nomeGiustificativo(c, 3)).toBe('03_2026-11-12_pasto_34,50EUR.pdf');
  });
  it('spesa probabilmente pagata in contanti: avviso (L. 207/2024)', () => {
    const c = classificaGiustificativo('HOTEL Bellavista notte 11/11/2026 Totale € 120,00 Contanti Resto 0,00');
    expect(c).toMatchObject({ tipoSpesa: 'albergo', pagamento: 'contanti', contantiDaSegnalare: true });
    expect(classificaGiustificativo('Biglietto Trenitalia Totale 45,90 contanti')).toMatchObject({ tipoSpesa: 'treno', contantiDaSegnalare: false });
    expect(classificaGiustificativo('Scontrino 10/10/2026 totale 3,00')).toMatchObject({ pagamento: 'non indicato' });
  });
});

describe('liste di controllo (spente di default, modificabili)', () => {
  const doc = (nome, testo) => ({ nome, testo });
  it('acquisto: presente / non trovato', () => {
    const r = valutaLista(modelloPredefinito('acquisto'), [doc('determina.pdf', 'Determina a contrarre n. 12'), doc('durc.pdf', 'DURC regolarità contributiva'), doc('ordine.pdf', 'Ordine diretto CIG Z1A2B3C4D5')]);
    const m = Object.fromEntries(r.map((x) => [x.voce.testo, x.stato]));
    expect(m['Determina a contrarre']).toBe('presente');
    expect(m.DURC).toBe('presente');
    expect(m.CIG).toBe('presente');
    expect(m['Certificato di regolare esecuzione']).toBe('non trovato');
    expect(r[0].voce.fonte).toBe('RACF CNR art. 32');
  });
  it('PNRR: CUP su ogni documento, dicitura, doppio utilizzo della stessa fattura', () => {
    const r = valutaLista(modelloPredefinito('pnrr'), [doc('a.pdf', 'CUP B12C34000560001 Finanziato dall\'Unione europea – NextGenerationEU'), doc('b.pdf', 'fattura senza codice')]);
    expect(r[0]).toMatchObject({ stato: 'non trovato', mancanti: ['b.pdf'] });
    expect(r[1].stato).toBe('presente');
    expect(doppioUtilizzo([{ progetto: 'P1', piva: 'IT02118311006', numero: '919/2026', data: '2026-11-02' }, { progetto: 'P2', piva: '02118311006', numero: '919/2026', data: '2026-11-02' }, { progetto: 'P1', piva: '1', numero: '2' }])).toEqual([{ chiave: '02118311006|919/2026|2026-11-02', progetti: ['P1', 'P2'] }]);
  });
  it('modello scritto dall\'ufficio', () => {
    const m = leggiModello('# commento\nVerbale di consegna | verbale di consegna, DDT | prassi\n\nFoto del bene | foto');
    expect(m.voci.map((v) => v.testo)).toEqual(['Verbale di consegna', 'Foto del bene']);
    expect(valutaLista(m, [doc('ddt_12.pdf', 'Documento di trasporto DDT n. 12')])[0].stato).toBe('presente');
  });
});
