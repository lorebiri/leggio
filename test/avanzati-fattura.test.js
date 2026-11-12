import { describe, it, expect } from 'vitest';
import { parseFattura, fatturaHtml, isFattura, allegatoBytes, allegatoNome, nomeProposto, euro } from '../src/renderer/features/avanzati/lib/fattura.js';
import { parseXml, txt } from '../src/renderer/features/avanzati/lib/xml.js';

export const FATTURA_FPA12 = `<?xml version="1.0" encoding="UTF-8"?>
<?xml-stylesheet type="text/xsl" href="fatturapa.xsl"?>
<p:FatturaElettronica versione="FPA12" xmlns:ds="http://www.w3.org/2000/09/xmldsig#" xmlns:p="http://ivaservizi.agenziaentrate.gov.it/docs/xsd/fatture/v1.2">
<FatturaElettronicaHeader>
 <DatiTrasmissione><IdTrasmittente><IdPaese>IT</IdPaese><IdCodice>01234567890</IdCodice></IdTrasmittente><ProgressivoInvio>00001</ProgressivoInvio><FormatoTrasmissione>FPA12</FormatoTrasmissione><CodiceDestinatario>ABC123</CodiceDestinatario></DatiTrasmissione>
 <CedentePrestatore><DatiAnagrafici><IdFiscaleIVA><IdPaese>IT</IdPaese><IdCodice>01234567890</IdCodice></IdFiscaleIVA><Anagrafica><Denominazione>Forniture Scientifiche &amp; Laboratorio S.r.l.</Denominazione></Anagrafica><RegimeFiscale>RF01</RegimeFiscale></DatiAnagrafici>
  <Sede><Indirizzo>Via Roma</Indirizzo><NumeroCivico>10</NumeroCivico><CAP>50019</CAP><Comune>Sesto Fiorentino</Comune><Provincia>FI</Provincia><Nazione>IT</Nazione></Sede></CedentePrestatore>
 <CessionarioCommittente><DatiAnagrafici><CodiceFiscale>80054330586</CodiceFiscale><Anagrafica><Denominazione>CNR - ICCOM</Denominazione></Anagrafica></DatiAnagrafici>
  <Sede><Indirizzo>Via Madonna del Piano 10</Indirizzo><CAP>50019</CAP><Comune>Sesto Fiorentino</Comune><Provincia>FI</Provincia><Nazione>IT</Nazione></Sede></CessionarioCommittente>
</FatturaElettronicaHeader>
<FatturaElettronicaBody>
 <DatiGenerali><DatiGeneraliDocumento><TipoDocumento>TD01</TipoDocumento><Divisa>EUR</Divisa><Data>2026-10-31</Data><Numero>123/A</Numero><ImportoTotaleDocumento>1220.00</ImportoTotaleDocumento><Causale>Fornitura reagenti</Causale></DatiGeneraliDocumento>
  <DatiOrdineAcquisto><IdDocumento>ORD-55</IdDocumento><CodiceCUP>B12C34000560001</CodiceCUP><CodiceCIG>Z1A2B3C4D5</CodiceCIG></DatiOrdineAcquisto></DatiGenerali>
 <DatiBeniServizi>
  <DettaglioLinee><NumeroLinea>1</NumeroLinea><Descrizione>Acetonitrile HPLC 2,5 L</Descrizione><Quantita>4.00</Quantita><UnitaMisura>pz</UnitaMisura><PrezzoUnitario>150.00</PrezzoUnitario><PrezzoTotale>600.00</PrezzoTotale><AliquotaIVA>22.00</AliquotaIVA></DettaglioLinee>
  <DettaglioLinee><NumeroLinea>2</NumeroLinea><Descrizione>Colonna C18</Descrizione><Quantita>1.00</Quantita><PrezzoUnitario>400.00</PrezzoUnitario><PrezzoTotale>400.00</PrezzoTotale><AliquotaIVA>22.00</AliquotaIVA></DettaglioLinee>
  <DatiRiepilogo><AliquotaIVA>22.00</AliquotaIVA><ImponibileImporto>1000.00</ImponibileImporto><Imposta>220.00</Imposta><EsigibilitaIVA>S</EsigibilitaIVA><RiferimentoNormativo>Scissione dei pagamenti art. 17-ter</RiferimentoNormativo></DatiRiepilogo>
 </DatiBeniServizi>
 <DatiPagamento><CondizioniPagamento>TP02</CondizioniPagamento><DettaglioPagamento><ModalitaPagamento>MP05</ModalitaPagamento><DataScadenzaPagamento>2026-11-30</DataScadenzaPagamento><ImportoPagamento>1000.00</ImportoPagamento><IstitutoFinanziario>Banca di Prova</IstitutoFinanziario><IBAN>IT60X0542811101000000123456</IBAN></DettaglioPagamento></DatiPagamento>
 <Allegati><NomeAttachment>ddt.txt</NomeAttachment><FormatoAttachment>TXT</FormatoAttachment><DescrizioneAttachment>Documento di trasporto</DescrizioneAttachment><Attachment>Q2lhbyBtb25kbw==</Attachment></Allegati>
</FatturaElettronicaBody>
<FatturaElettronicaBody>
 <DatiGenerali><DatiGeneraliDocumento><TipoDocumento>TD04</TipoDocumento><Divisa>EUR</Divisa><Data>2026-11-02</Data><Numero>7</Numero><ImportoTotaleDocumento>100.00</ImportoTotaleDocumento></DatiGeneraliDocumento></DatiGenerali>
 <DatiBeniServizi>
  <DettaglioLinee><NumeroLinea>1</NumeroLinea><Descrizione>Reso</Descrizione><PrezzoUnitario>50.00</PrezzoUnitario><PrezzoTotale>50.00</PrezzoTotale><AliquotaIVA>22.00</AliquotaIVA></DettaglioLinee>
  <DatiRiepilogo><AliquotaIVA>22.00</AliquotaIVA><ImponibileImporto>50.00</ImponibileImporto><Imposta>11.00</Imposta><EsigibilitaIVA>I</EsigibilitaIVA></DatiRiepilogo>
 </DatiBeniServizi>
</FatturaElettronicaBody>
</p:FatturaElettronica>`;

describe('XML', () => {
  it('gestisce namespace, entità, CDATA, commenti e DOCTYPE senza espanderlo', () => {
    const r = parseXml('<?xml version="1.0"?><!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]><a:x xmlns:a="u"><!-- c --><b k="1 &amp; 2">t &lt; &#65;&#x42;</b><c><![CDATA[<raw>]]></c><d/>&e;</a:x>');
    expect(r.name).toBe('x');
    expect(r.children[0].attrs.k).toBe('1 & 2');
    expect(txt(r, 'b')).toBe('t < AB');
    expect(txt(r, 'c')).toBe('<raw>');
    expect(r.text).toContain('&e;'); // entità esterna NON espansa
  });
  it('segnala i file troncati con un messaggio chiaro', () => {
    expect(() => parseXml('<a><b>ciao</b>')).toThrow(/non chiuso/);
    expect(() => parseXml('<a></b>')).toThrow(/inattesa/);
  });
  it('decodifica ISO-8859-1 dichiarato', () => {
    const bytes = new Uint8Array([...Buffer.from('<?xml version="1.0" encoding="ISO-8859-1"?><a>'), 0xe8, ...Buffer.from('</a>')]);
    expect(txt(parseXml(bytes))).toBe('è');
  });
});

describe('FatturaPA', () => {
  const f = parseFattura(FATTURA_FPA12);
  it('legge testata, parti e più corpi', () => {
    expect(isFattura(new TextEncoder().encode(FATTURA_FPA12))).toBe(true);
    expect(f.versione).toBe('FPA12');
    expect(f.cedente.nome).toBe('Forniture Scientifiche & Laboratorio S.r.l.');
    expect(f.cedente.partitaIva).toBe('IT01234567890');
    expect(f.cedente.indirizzo).toBe('Via Roma 10, 50019 Sesto Fiorentino (FI)');
    expect(f.cessionario.codiceFiscale).toBe('80054330586');
    expect(f.corpi).toHaveLength(2);
  });
  it('estrae CIG, CUP, scissione dei pagamenti, IBAN e calcola il netto', () => {
    const c = f.corpi[0];
    expect(c.cig).toEqual(['Z1A2B3C4D5']);
    expect(c.cup).toEqual(['B12C34000560001']);
    expect(c.calcoli.split).toBe(true);
    expect(c.calcoli.nettoAPagare).toBe(1000);
    expect(c.pagamenti[0].dettagli[0].iban).toBe('IT60X0542811101000000123456');
    expect(c.avvisi.filter((a) => a.livello !== 'info')).toEqual([]);
  });
  it('segnala CIG mancante e totali che non tornano', () => {
    const c = f.corpi[1];
    expect(c.avvisi.map((a) => a.testo).join(' ')).toMatch(/CIG non indicato/);
    expect(c.avvisi.map((a) => a.testo).join(' ')).toMatch(/non corrisponde a imponibile \+ IVA/);
  });
  it('estrae gli allegati incorporati', () => {
    const a = f.corpi[0].allegati[0];
    expect(Buffer.from(allegatoBytes(a)).toString()).toBe('Ciao mondo');
    expect(allegatoNome(a)).toBe('ddt.txt');
    expect(allegatoNome({ nome: '../../etc/x', formato: 'PDF' })).toBe('.._.._etc_x.pdf');
  });
  it('produce un HTML con i dati principali, senza iniettare markup', () => {
    const html = fatturaHtml(f);
    expect(html).toContain('CIG Z1A2B3C4D5');
    expect(html).toContain('IT60 X054 2811 1010 0000 0123 456');
    expect(html).toContain('Forniture Scientifiche &amp; Laboratorio');
    expect(html).toContain('Nota di credito');
    expect(euro(1234.5)).toMatch(/1\.234,50/);
    expect(nomeProposto(f)).toBe('Fattura_Forniture_Scientifiche_Laboratorio_n123-A_2026-10-31.pdf');
    const evil = parseFattura(FATTURA_FPA12.replace('Fornitura reagenti', '&lt;script&gt;alert(1)&lt;/script&gt;'));
    expect(fatturaHtml(evil)).not.toContain('<script>');
  });
  it('rifiuta XML che non sono fatture', () => {
    expect(() => parseFattura('<a/>')).toThrow(/non è una fattura/);
  });
  it('legge la fattura semplificata', () => {
    const s = parseFattura(`<FatturaElettronicaSemplificata versione="FSM10"><FatturaElettronicaHeader><DatiTrasmissione><FormatoTrasmissione>FSM10</FormatoTrasmissione></DatiTrasmissione><CedentePrestatore><IdFiscaleIVA><IdPaese>IT</IdPaese><IdCodice>1</IdCodice></IdFiscaleIVA><Denominazione>Bar</Denominazione></CedentePrestatore></FatturaElettronicaHeader><FatturaElettronicaBody><DatiGenerali><DatiGeneraliDocumento><TipoDocumento>TD07</TipoDocumento><Divisa>EUR</Divisa><Data>2026-01-01</Data><Numero>1</Numero></DatiGeneraliDocumento></DatiGenerali><DatiBeniServizi><Descrizione>Caffè</Descrizione><Importo>1.22</Importo><DatiIVA><Imposta>0.22</Imposta></DatiIVA></DatiBeniServizi></FatturaElettronicaBody></FatturaElettronicaSemplificata>`);
    expect(s.corpi[0].linee[0].descrizione).toBe('Caffè');
    expect(fatturaHtml(s)).toContain('Fattura semplificata');
  });
});
