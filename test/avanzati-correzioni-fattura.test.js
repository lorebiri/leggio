// Correzioni: fattura semplificata (FSM10), parser XML (CDATA, iso-8859-15), parametri MIME, data locale di ricezione SdI.
import { describe, it, expect, afterEach } from 'vitest';
import { parseFattura, fatturaHtml } from '../src/renderer/features/avanzati/lib/fattura.js';
import { parseXml } from '../src/renderer/features/avanzati/lib/xml.js';
import { headerParams } from '../src/renderer/features/avanzati/lib/mime.js';
import { dataLocaleDaMs } from '../src/renderer/features/avanzati/lib/controlli.js';

const semplificata = (header, beni) => `<?xml version="1.0" encoding="UTF-8"?>
<p:FatturaElettronicaSemplificata versione="FSM10" xmlns:p="http://ivaservizi.agenziaentrate.gov.it/docs/xsd/fatture/v1.0">
<FatturaElettronicaHeader><DatiTrasmissione><IdTrasmittente><IdPaese>IT</IdPaese><IdCodice>01234567890</IdCodice></IdTrasmittente><ProgressivoInvio>1</ProgressivoInvio><FormatoTrasmissione>FSM10</FormatoTrasmissione><CodiceDestinatario>0000000</CodiceDestinatario></DatiTrasmissione>
${header}</FatturaElettronicaHeader>
<FatturaElettronicaBody><DatiGenerali><DatiGeneraliDocumento><TipoDocumento>TD07</TipoDocumento><Divisa>EUR</Divisa><Data>2026-03-05</Data><Numero>12</Numero></DatiGeneraliDocumento></DatiGenerali>
${beni}</FatturaElettronicaBody></p:FatturaElettronicaSemplificata>`;

const CEDENTE = `<CedentePrestatore><IdFiscaleIVA><IdPaese>IT</IdPaese><IdCodice>01234567890</IdCodice></IdFiscaleIVA><Denominazione>Bar Centrale S.n.c.</Denominazione>
<Sede><Indirizzo>Via Roma</Indirizzo><NumeroCivico>1</NumeroCivico><CAP>50019</CAP><Comune>Sesto Fiorentino</Comune><Provincia>FI</Provincia><Nazione>IT</Nazione></Sede><RegimeFiscale>RF01</RegimeFiscale></CedentePrestatore>`;
const CLIENTE = `<CessionarioCommittente><IdentificativiFiscali><CodiceFiscale>80054330586</CodiceFiscale></IdentificativiFiscali>
<AltriDatiIdentificativi><Denominazione>CNR - ICCOM</Denominazione><Sede><Indirizzo>Via Madonna del Piano 10</Indirizzo><CAP>50019</CAP><Comune>Sesto Fiorentino</Comune><Provincia>FI</Provincia><Nazione>IT</Nazione></Sede></AltriDatiIdentificativi></CessionarioCommittente>`;
const BENI = `<DatiBeniServizi><Descrizione>Caffè</Descrizione><Importo>1.22</Importo><DatiIVA><Imposta>0.22</Imposta></DatiIVA></DatiBeniServizi>
<DatiBeniServizi><Descrizione>Acqua</Descrizione><Importo>1.10</Importo><DatiIVA><Imposta>0.10</Imposta></DatiIVA></DatiBeniServizi>`;

describe('fattura semplificata FSM10', () => {
  it('il totale è la somma degli importi (IVA già compresa), non importi + IVA', () => {
    const f = parseFattura(semplificata(CEDENTE + CLIENTE, BENI));
    const k = f.corpi[0].calcoli;
    expect(k.totale).toBe(2.32);
    expect(k.nettoAPagare).toBe(2.32);
    expect(k.imposta).toBe(0.32);
    expect(k.imponibile).toBe(2);
  });
  it('fornitore: denominazione, P.IVA e regime fiscale letti senza DatiAnagrafici', () => {
    const f = parseFattura(semplificata(CEDENTE + CLIENTE, BENI));
    expect(f.cedente).toMatchObject({ nome: 'Bar Centrale S.n.c.', partitaIva: 'IT01234567890', regimeFiscale: 'RF01' });
    expect(f.cedente.indirizzo).toContain('Sesto Fiorentino');
    expect(fatturaHtml(f)).toContain('Bar Centrale S.n.c.');
  });
  it('fornitore persona fisica (Nome e Cognome) e cliente con sede in AltriDatiIdentificativi', () => {
    const ced = CEDENTE.replace('<Denominazione>Bar Centrale S.n.c.</Denominazione>', '<Nome>Mario</Nome><Cognome>Rossi</Cognome>');
    const f = parseFattura(semplificata(ced + CLIENTE, BENI));
    expect(f.cedente.nome).toBe('Mario Rossi');
    expect(f.cessionario).toMatchObject({ nome: 'CNR - ICCOM', codiceFiscale: '80054330586' });
    expect(f.cessionario.indirizzo).toContain('Via Madonna del Piano 10');
  });
});

describe('parser XML', () => {
  it('il contenuto CDATA resta letterale (le entità non vengono sciolte)', () => {
    expect(parseXml('<a><![CDATA[A &amp; B &lt;x&gt;]]></a>').text).toBe('A &amp; B &lt;x&gt;');
    expect(parseXml('<a>A &amp; <![CDATA[&lt;]]> &lt;</a>').text).toBe('A & &lt; <');
  });
  it('iso-8859-15: il byte 0xA4 è l\'euro', () => {
    const enc = new TextEncoder();
    const b = new Uint8Array([...enc.encode('<?xml version="1.0" encoding="ISO-8859-15"?><a>'), 0xa4, ...enc.encode('</a>')]);
    expect(parseXml(b).text).toBe('€');
  });
});

describe('parametri MIME', () => {
  it('il «;» dentro le virgolette fa parte del nome', () => {
    expect(headerParams('attachment; filename="Fattura; marzo 2026.pdf"').params.filename).toBe('Fattura; marzo 2026.pdf');
    expect(headerParams('application/pdf; name="a;b.pdf"; charset=utf-8').params).toEqual({ name: 'a;b.pdf', charset: 'utf-8' });
  });
  it('RFC 2231: segmenti uniti prima di decodificare (carattere multibyte a cavallo)', () => {
    expect(headerParams("attachment; filename*0*=utf-8''Prova%E2%82; filename*1*=%AC.pdf").params.filename).toBe('Prova€.pdf');
    expect(headerParams("attachment; filename*0*=utf-8''Fattura%20n%C2%B0; filename*1*=%205%20%E2%82%AC.pdf").params.filename).toBe('Fattura n° 5 €.pdf');
    expect(headerParams('attachment; filename*0="parte "; filename*1="due.pdf"').params.filename).toBe('parte due.pdf');
  });
});

describe('data di ricezione stimata dal file', () => {
  const tz = process.env.TZ;
  afterEach(() => { if (tz == null) delete process.env.TZ; else process.env.TZ = tz; });
  it('usa il giorno locale, non quello UTC (00:30 del 5 marzo in Italia)', () => {
    process.env.TZ = 'Europe/Rome';
    const ms = Date.UTC(2026, 2, 4, 23, 30); // 5 marzo 00:30 ora italiana
    expect(dataLocaleDaMs(ms)).toBe('2026-03-05');
    expect(dataLocaleDaMs(0)).toBe('');
  });
});
