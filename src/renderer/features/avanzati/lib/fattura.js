// Fattura elettronica FatturaPA (FPA12, FPR12, semplificata FSM10): lettura del modello dati,
// controlli di coerenza e impaginazione HTML (layout proprio di Leggio, non copia del foglio di stile ministeriale).
import { parseXml, el, els, at, txt, findAll } from './xml.js';
import { base64ToBytes } from './cades.js';

export const TIPI_DOCUMENTO = {
  TD01: 'Fattura', TD02: 'Acconto/anticipo su fattura', TD03: 'Acconto/anticipo su parcella', TD04: 'Nota di credito',
  TD05: 'Nota di debito', TD06: 'Parcella', TD07: 'Fattura semplificata', TD08: 'Nota di credito semplificata',
  TD09: 'Nota di debito semplificata', TD16: 'Integrazione fattura reverse charge interno',
  TD17: 'Integrazione/autofattura per acquisto servizi dall\'estero', TD18: 'Integrazione per acquisto di beni intracomunitari',
  TD19: 'Integrazione/autofattura per acquisto di beni (art. 17 c. 2 DPR 633/72)', TD20: 'Autofattura per regolarizzazione e integrazione',
  TD21: 'Autofattura per splafonamento', TD22: 'Estrazione beni da deposito IVA', TD23: 'Estrazione beni da deposito IVA con versamento dell\'IVA',
  TD24: 'Fattura differita (art. 21 c. 4 lett. a)', TD25: 'Fattura differita (art. 21 c. 4 terzo periodo lett. b)',
  TD26: 'Cessione di beni ammortizzabili e passaggi interni', TD27: 'Fattura per autoconsumo o cessioni gratuite senza rivalsa',
  TD28: 'Acquisti da San Marino con IVA', TD29: 'Comunicazione per omessa o irregolare fatturazione',
};
export const MODALITA_PAGAMENTO = {
  MP01: 'Contanti', MP02: 'Assegno', MP03: 'Assegno circolare', MP04: 'Contanti presso Tesoreria', MP05: 'Bonifico',
  MP06: 'Vaglia cambiario', MP07: 'Bollettino bancario', MP08: 'Carta di pagamento', MP09: 'RID', MP10: 'RID utenze',
  MP11: 'RID veloce', MP12: 'RIBA', MP13: 'MAV', MP14: 'Quietanza erario', MP15: 'Giroconto su conti di contabilità speciale',
  MP16: 'Domiciliazione bancaria', MP17: 'Domiciliazione postale', MP18: 'Bollettino di c/c postale', MP19: 'SEPA Direct Debit',
  MP20: 'SEPA Direct Debit CORE', MP21: 'SEPA Direct Debit B2B', MP22: 'Trattenuta su somme già riscosse', MP23: 'PagoPA',
};
export const CONDIZIONI_PAGAMENTO = { TP01: 'Pagamento a rate', TP02: 'Pagamento completo', TP03: 'Anticipo' };
export const ESIGIBILITA = { I: 'IVA a esigibilità immediata', D: 'IVA a esigibilità differita', S: 'Scissione dei pagamenti (split payment)' };
export const TIPI_RITENUTA = { RT01: 'Ritenuta persone fisiche', RT02: 'Ritenuta persone giuridiche', RT03: 'Contributo INPS', RT04: 'Contributo ENASARCO', RT05: 'Contributo ENPAM', RT06: 'Altro contributo previdenziale' };
export const REGIMI = {
  RF01: 'Ordinario', RF02: 'Contribuenti minimi', RF04: 'Agricoltura e attività connesse e pesca', RF05: 'Vendita sali e tabacchi',
  RF06: 'Commercio fiammiferi', RF07: 'Editoria', RF08: 'Gestione servizi telefonia pubblica', RF09: 'Rivendita documenti di trasporto pubblico e di sosta',
  RF10: 'Intrattenimenti, giochi e altre attività', RF11: 'Agenzie viaggi e turismo', RF12: 'Agriturismo', RF13: 'Vendite a domicilio',
  RF14: 'Rivendita beni usati, oggetti d\'arte, d\'antiquariato o da collezione', RF15: 'Agenzie di vendite all\'asta di oggetti d\'arte, antiquariato o da collezione',
  RF16: 'IVA per cassa P.A.', RF17: 'IVA per cassa', RF18: 'Altro', RF19: 'Forfettario',
};
export function naturaLabel(code) {
  if (!code) return '';
  const map = {
    N1: 'Escluse ex art. 15', N2: 'Non soggette', 'N2.1': 'Non soggette (artt. da 7 a 7-septies)', 'N2.2': 'Non soggette (altri casi)',
    N3: 'Non imponibili', 'N3.1': 'Non imponibili - esportazioni', 'N3.2': 'Non imponibili - cessioni intracomunitarie', 'N3.3': 'Non imponibili - cessioni verso San Marino',
    'N3.4': 'Non imponibili - operazioni assimilate alle esportazioni', 'N3.5': 'Non imponibili - a seguito di dichiarazioni d\'intento', 'N3.6': 'Non imponibili - altre operazioni',
    N4: 'Esenti', N5: 'Regime del margine / IVA non esposta in fattura', N7: 'IVA assolta in altro Stato UE',
  };
  if (map[code]) return map[code];
  if (/^N6/.test(code)) return 'Inversione contabile (reverse charge)';
  return code;
}

const num = (s) => { if (s == null || s === '') return null; const v = Number(String(s).trim()); return Number.isFinite(v) ? v : null; };

function anagrafica(node) {
  if (!node) return null;
  const da = el(node, 'DatiAnagrafici');
  const an = el(da, 'Anagrafica');
  const sede = el(node, 'Sede');
  const piva = el(da, 'IdFiscaleIVA');
  const nome = txt(an, 'Denominazione') || [txt(an, 'Titolo'), txt(an, 'Nome'), txt(an, 'Cognome')].filter(Boolean).join(' ');
  const rea = el(node, 'IscrizioneREA');
  const contatti = el(node, 'Contatti');
  return {
    nome,
    partitaIva: piva ? `${txt(piva, 'IdPaese')}${txt(piva, 'IdCodice')}` : '',
    codiceFiscale: txt(da, 'CodiceFiscale'),
    regimeFiscale: txt(da, 'RegimeFiscale'),
    indirizzo: sede ? [[txt(sede, 'Indirizzo'), txt(sede, 'NumeroCivico')].filter(Boolean).join(' '), [txt(sede, 'CAP'), txt(sede, 'Comune'), txt(sede, 'Provincia') && `(${txt(sede, 'Provincia')})`].filter(Boolean).join(' '), txt(sede, 'Nazione') !== 'IT' ? txt(sede, 'Nazione') : ''].filter(Boolean).join(', ') : '',
    rea: rea ? [txt(rea, 'Ufficio'), txt(rea, 'NumeroREA')].filter(Boolean).join(' ') : '',
    telefono: txt(contatti, 'Telefono'), email: txt(contatti, 'Email'), pec: '',
  };
}

function riferimenti(dg, tag) {
  return els(dg, tag).map((x) => ({
    tipo: tag, idDocumento: txt(x, 'IdDocumento'), data: txt(x, 'Data'), numItem: txt(x, 'NumItem'),
    commessa: txt(x, 'CodiceCommessaConvenzione'), cup: txt(x, 'CodiceCUP'), cig: txt(x, 'CodiceCIG'),
    linee: els(x, 'RiferimentoNumeroLinea').map((l) => l.text.trim()),
  }));
}

/**
 * Legge una FatturaPA da byte o stringa XML.
 * → { versione, trasmissione, cedente, cessionario, terzo, corpi: [ ... ], semplificata }
 */
export function parseFattura(input) {
  const root = parseXml(input);
  if (!/^FatturaElettronica(Semplificata)?$/.test(root.name)) throw new Error('Il file XML non è una fattura elettronica (FatturaPA).');
  const semplificata = root.name === 'FatturaElettronicaSemplificata';
  const header = el(root, 'FatturaElettronicaHeader');
  const dt = el(header, 'DatiTrasmissione');
  const out = {
    versione: root.attrs.versione || txt(dt, 'FormatoTrasmissione'),
    semplificata,
    trasmissione: {
      idTrasmittente: `${txt(dt, 'IdTrasmittente/IdPaese')}${txt(dt, 'IdTrasmittente/IdCodice')}`,
      progressivo: txt(dt, 'ProgressivoInvio'), formato: txt(dt, 'FormatoTrasmissione'),
      codiceDestinatario: txt(dt, 'CodiceDestinatario'), pecDestinatario: txt(dt, 'PECDestinatario'),
    },
    cedente: anagrafica(el(header, 'CedentePrestatore')),
    rappresentante: anagrafica(el(header, 'RappresentanteFiscale')),
    cessionario: anagrafica(el(header, 'CessionarioCommittente')),
    terzo: anagrafica(el(header, 'TerzoIntermediarioOSoggettoEmittente')),
    soggettoEmittente: txt(header, 'SoggettoEmittente'),
    corpi: [],
  };
  if (semplificata && out.cedente == null) out.cedente = anagrafica(el(header, 'CedentePrestatore'));
  if (semplificata) {
    const cc = el(header, 'CessionarioCommittente');
    if (cc && !out.cessionario?.nome) {
      const id = el(cc, 'IdentificativiFiscali');
      const a = el(cc, 'AltriDatiIdentificativi');
      out.cessionario = { nome: txt(a, 'Denominazione') || [txt(a, 'Nome'), txt(a, 'Cognome')].filter(Boolean).join(' '), partitaIva: id ? `${txt(id, 'IdFiscaleIVA/IdPaese')}${txt(id, 'IdFiscaleIVA/IdCodice')}` : '', codiceFiscale: txt(id, 'CodiceFiscale'), indirizzo: '', regimeFiscale: '' };
    }
  }
  for (const body of els(root, 'FatturaElettronicaBody')) out.corpi.push(parseBody(body, semplificata));
  if (!out.corpi.length) throw new Error('La fattura non contiene alcun documento (FatturaElettronicaBody mancante).');
  return out;
}

function parseBody(body, semplificata) {
  const dg = el(body, 'DatiGenerali');
  const doc = el(dg, 'DatiGeneraliDocumento');
  const bs = el(body, 'DatiBeniServizi');
  const c = {
    tipo: txt(doc, 'TipoDocumento'), divisa: txt(doc, 'Divisa') || 'EUR', data: txt(doc, 'Data'), numero: txt(doc, 'Numero'),
    totale: num(txt(doc, 'ImportoTotaleDocumento')), arrotondamento: num(txt(doc, 'Arrotondamento')),
    causali: els(doc, 'Causale').map((x) => x.text.trim()).filter(Boolean),
    art73: txt(doc, 'Art73'),
    ritenute: els(doc, 'DatiRitenuta').map((r) => ({ tipo: txt(r, 'TipoRitenuta'), importo: num(txt(r, 'ImportoRitenuta')), aliquota: num(txt(r, 'AliquotaRitenuta')), causale: txt(r, 'CausalePagamento') })),
    bollo: el(doc, 'DatiBollo') ? { virtuale: txt(doc, 'DatiBollo/BolloVirtuale'), importo: num(txt(doc, 'DatiBollo/ImportoBollo')) } : null,
    cassa: els(doc, 'DatiCassaPrevidenziale').map((r) => ({ tipo: txt(r, 'TipoCassa'), aliquota: num(txt(r, 'AlCassa')), importo: num(txt(r, 'ImportoContributoCassa')), imponibile: num(txt(r, 'ImponibileCassa')), aliquotaIva: num(txt(r, 'AliquotaIVA')), natura: txt(r, 'Natura') })),
    sconti: els(doc, 'ScontoMaggiorazione').map(sconto),
    riferimenti: [
      ...riferimenti(dg, 'DatiOrdineAcquisto'), ...riferimenti(dg, 'DatiContratto'), ...riferimenti(dg, 'DatiConvenzione'),
      ...riferimenti(dg, 'DatiRicezione'), ...riferimenti(dg, 'DatiFattureCollegate'),
    ],
    ddt: els(dg, 'DatiDDT').map((d) => ({ numero: txt(d, 'NumeroDDT'), data: txt(d, 'DataDDT') })),
    linee: [], riepilogo: [], pagamenti: [], allegati: [],
  };
  if (semplificata) {
    c.data = txt(dg, 'DatiGeneraliDocumento/Data') || c.data;
    for (const [i, x] of els(body, 'DatiBeniServizi').entries()) {
      c.linee.push({ numero: String(i + 1), descrizione: txt(x, 'Descrizione'), quantita: null, unita: '', prezzoUnitario: null, prezzoTotale: num(txt(x, 'Importo')), aliquota: num(txt(x, 'DatiIVA/Aliquota')), imposta: num(txt(x, 'DatiIVA/Imposta')), natura: txt(x, 'Natura'), codici: [], sconti: [], periodo: '', altri: [] });
    }
  } else {
    for (const l of els(bs, 'DettaglioLinee')) {
      c.linee.push({
        numero: txt(l, 'NumeroLinea'), tipoCessione: txt(l, 'TipoCessionePrestazione'),
        codici: els(l, 'CodiceArticolo').map((k) => `${txt(k, 'CodiceTipo')} ${txt(k, 'CodiceValore')}`.trim()),
        descrizione: txt(l, 'Descrizione'), quantita: num(txt(l, 'Quantita')), unita: txt(l, 'UnitaMisura'),
        periodo: [txt(l, 'DataInizioPeriodo'), txt(l, 'DataFinePeriodo')].filter(Boolean).map(dataIt).join(' – '),
        prezzoUnitario: num(txt(l, 'PrezzoUnitario')), sconti: els(l, 'ScontoMaggiorazione').map(sconto),
        prezzoTotale: num(txt(l, 'PrezzoTotale')), aliquota: num(txt(l, 'AliquotaIVA')), ritenuta: txt(l, 'Ritenuta'), natura: txt(l, 'Natura'),
        riferimentoAmministrazione: txt(l, 'RiferimentoAmministrazione'),
        altri: els(l, 'AltriDatiGestionali').map((a) => [txt(a, 'TipoDato'), txt(a, 'RiferimentoTesto'), txt(a, 'RiferimentoNumero'), txt(a, 'RiferimentoData')].filter(Boolean).join(' ')),
      });
    }
    for (const r of els(bs, 'DatiRiepilogo')) {
      c.riepilogo.push({ aliquota: num(txt(r, 'AliquotaIVA')), natura: txt(r, 'Natura'), spese: num(txt(r, 'SpeseAccessorie')), arrotondamento: num(txt(r, 'Arrotondamento')), imponibile: num(txt(r, 'ImponibileImporto')), imposta: num(txt(r, 'Imposta')), esigibilita: txt(r, 'EsigibilitaIVA'), normativa: txt(r, 'RiferimentoNormativo') });
    }
  }
  for (const p of els(body, 'DatiPagamento')) {
    c.pagamenti.push({
      condizioni: txt(p, 'CondizioniPagamento'),
      dettagli: els(p, 'DettaglioPagamento').map((d) => ({
        beneficiario: txt(d, 'Beneficiario'), modalita: txt(d, 'ModalitaPagamento'), scadenza: txt(d, 'DataScadenzaPagamento'),
        giorni: txt(d, 'GiorniTerminiPagamento'), riferimentoData: txt(d, 'DataRiferimentoTerminiPagamento'),
        importo: num(txt(d, 'ImportoPagamento')), istituto: txt(d, 'IstitutoFinanziario'), iban: txt(d, 'IBAN').replace(/\s+/g, ''),
        abi: txt(d, 'ABI'), cab: txt(d, 'CAB'), bic: txt(d, 'BIC'), codicePagamento: txt(d, 'CodicePagamento'),
      })),
    });
  }
  for (const a of els(body, 'Allegati')) {
    const data = txt(a, 'Attachment');
    c.allegati.push({ nome: txt(a, 'NomeAttachment') || 'allegato', compressione: txt(a, 'AlgoritmoCompressione'), formato: txt(a, 'FormatoAttachment'), descrizione: txt(a, 'DescrizioneAttachment'), base64: data, dimensione: Math.floor(data.replace(/\s+/g, '').length * 3 / 4) });
  }
  c.cig = uniq(c.riferimenti.map((r) => r.cig));
  c.cup = uniq(c.riferimenti.map((r) => r.cup));
  c.avvisi = controlli(c);
  c.calcoli = calcoli(c);
  return c;
}

function sconto(s) { return { tipo: txt(s, 'Tipo'), percentuale: num(txt(s, 'Percentuale')), importo: num(txt(s, 'Importo')) }; }
function uniq(a) { return [...new Set(a.filter(Boolean))]; }

/** Decodifica un allegato incorporato → Uint8Array. */
export function allegatoBytes(a) { return base64ToBytes(a.base64); }
/** Nome file sicuro per l'allegato. */
export function allegatoNome(a) {
  let n = (a.nome || 'allegato').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 150);
  if (!/\.[a-z0-9]{2,5}$/i.test(n) && a.formato) n += '.' + a.formato.toLowerCase().replace(/[^a-z0-9]/g, '');
  return n;
}

const round2 = (v) => Math.round(v * 100) / 100;

function calcoli(c) {
  const imponibile = round2(c.riepilogo.reduce((s, r) => s + (r.imponibile || 0), 0) || c.linee.reduce((s, l) => s + (l.prezzoTotale || 0), 0));
  const imposta = round2(c.riepilogo.reduce((s, r) => s + (r.imposta || 0), 0) || c.linee.reduce((s, l) => s + (l.imposta || 0), 0));
  const split = c.riepilogo.some((r) => r.esigibilita === 'S');
  const ivaSplit = round2(c.riepilogo.filter((r) => r.esigibilita === 'S').reduce((s, r) => s + (r.imposta || 0), 0));
  const ritenute = round2(c.ritenute.reduce((s, r) => s + (r.importo || 0), 0));
  const totale = c.totale ?? round2(imponibile + imposta + (c.bollo?.importo || 0));
  const nettoAPagare = round2(totale - (split ? ivaSplit : 0) - ritenute);
  return { imponibile, imposta, split, ivaSplit, ritenute, totale, nettoAPagare };
}

function controlli(c) {
  const av = [];
  if (!c.numero) av.push({ livello: 'errore', testo: 'Manca il numero della fattura.' });
  if (!c.data) av.push({ livello: 'errore', testo: 'Manca la data della fattura.' });
  if (!c.cig.length) av.push({ livello: 'avviso', testo: 'CIG non indicato: verificare se è obbligatorio per questo acquisto.' });
  if (!c.cup.length) av.push({ livello: 'info', testo: 'CUP non indicato (serve solo per i progetti di investimento pubblico).' });
  // somma righe per aliquota vs riepilogo
  if (c.riepilogo.length && c.linee.length) {
    const sommaLinee = round2(c.linee.reduce((s, l) => s + (l.prezzoTotale || 0), 0) + c.cassa.reduce((s, x) => s + (x.importo || 0), 0));
    const sommaRiep = round2(c.riepilogo.reduce((s, r) => s + (r.imponibile || 0) - (r.spese || 0) - (r.arrotondamento || 0), 0));
    if (Math.abs(sommaLinee - sommaRiep) > 0.01 * Math.max(1, c.linee.length)) av.push({ livello: 'avviso', testo: `Il totale delle righe (${euro(sommaLinee)}) non corrisponde all'imponibile del riepilogo IVA (${euro(sommaRiep)}).` });
  }
  if (c.totale != null && c.riepilogo.length) {
    const atteso = round2(c.riepilogo.reduce((s, r) => s + (r.imponibile || 0) + (r.imposta || 0), 0) + (c.arrotondamento || 0));
    const conBollo = round2(atteso + (c.bollo?.importo || 0));
    if (Math.abs(c.totale - atteso) > 0.011 && Math.abs(c.totale - conBollo) > 0.011) av.push({ livello: 'avviso', testo: `Il totale del documento (${euro(c.totale)}) non corrisponde a imponibile + IVA (${euro(atteso)}).` });
  }
  if (c.totale == null) av.push({ livello: 'info', testo: 'Il totale del documento non è indicato: Leggio lo ha calcolato dal riepilogo IVA.' });
  if (!c.pagamenti.length) av.push({ livello: 'info', testo: 'Nessun dato di pagamento indicato.' });
  return av;
}

// ---------- formattazione ----------
export function euro(v, divisa = 'EUR') {
  if (v == null || !Number.isFinite(v)) return '';
  const s = v.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: 'always' });
  return divisa === 'EUR' ? `${s} €` : `${s} ${divisa}`;
}
export function numIt(v, dec = 2) { return v == null ? '' : v.toLocaleString('it-IT', { minimumFractionDigits: 0, maximumFractionDigits: Math.max(dec, 8), useGrouping: 'always' }); }
export function dataIt(s) { const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[3]}/${m[2]}/${m[1]}` : (s || ''); }
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export function ibanFormat(iban) { return String(iban || '').replace(/(.{4})/g, '$1 ').trim(); }

/** Nome file proposto: Fattura_FORNITORE_n123_2026-10-31.pdf */
export function nomeProposto(f, i = 0) {
  const c = f.corpi[i];
  const forn = (f.cedente?.nome || 'Fornitore').replace(/[^A-Za-z0-9À-ÿ]+/g, ' ').trim().split(/\s+/).slice(0, 3).join('_');
  const n = (c.numero || '').replace(/[^A-Za-z0-9-]+/g, '-');
  const tipo = c.tipo === 'TD04' ? 'NotaCredito' : 'Fattura';
  return `${tipo}_${forn}_n${n}_${c.data || ''}.pdf`.replace(/_+/g, '_');
}

export const FATTURA_CSS = `
*{box-sizing:border-box}
.fpa{font:10.5pt/1.4 -apple-system,"Segoe UI",Helvetica,Arial,sans-serif;color:#1d2228;max-width:200mm;margin:0 auto;padding:6mm 4mm}
.fpa h1{font-size:17pt;margin:0;font-weight:650;letter-spacing:-.01em}
.fpa h2{font-size:10pt;text-transform:none;margin:14px 0 6px;color:#0f5f58;font-weight:650;border-bottom:1.5px solid #0f766e;padding-bottom:2px}
.fpa .top{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;border-bottom:3px solid #0f766e;padding-bottom:8px}
.fpa .top .meta{text-align:right;font-size:10pt}
.fpa .top .meta strong{font-size:12.5pt}
.fpa .parti{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:10px}
.fpa .box{border:1px solid #c9d2d0;border-radius:6px;padding:8px 10px;break-inside:avoid}
.fpa .box .lbl{font-size:8.5pt;color:#55606a;font-weight:600;margin-bottom:2px}
.fpa .box .nome{font-weight:650;font-size:11.5pt}
.fpa .chips{display:flex;flex-wrap:wrap;gap:8px;margin:10px 0 0}
.fpa .chip{border:1.5px solid #0f766e;background:#e3f3ef;border-radius:6px;padding:4px 10px;font-weight:600}
.fpa .chip.code{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:11.5pt;letter-spacing:.02em}
.fpa .chip.missing{border-color:#b54708;background:#fff4e5;color:#7a3306}
.fpa .chip.split{border-color:#5b3fa8;background:#efeafd;color:#3b2378}
.fpa table{width:100%;border-collapse:collapse;font-size:9.5pt}
.fpa th{text-align:left;font-weight:600;color:#3b454e;background:#eef2f1;padding:4px 6px;border-bottom:1px solid #b8c3c1}
.fpa td{padding:4px 6px;border-bottom:1px solid #e1e6e5;vertical-align:top}
.fpa td.n,.fpa th.n{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}
.fpa tr{break-inside:avoid}
.fpa .sub{color:#55606a;font-size:8.5pt}
.fpa .tot{margin-left:auto;width:60%;margin-top:8px}
.fpa .tot td{border:none;padding:2px 6px}
.fpa .tot tr.grand td{font-size:12.5pt;font-weight:700;border-top:2px solid #0f766e;padding-top:5px}
.fpa .tot tr.net td{font-weight:650;color:#0f5f58}
.fpa .iban{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:11pt;font-weight:600;letter-spacing:.03em}
.fpa .avvisi{margin:10px 0;padding:0;list-style:none}
.fpa .avvisi li{padding:5px 10px;border-radius:5px;margin-bottom:4px;font-size:9.5pt}
.fpa .avvisi .errore{background:#fde8e6;color:#8a1c12}
.fpa .avvisi .avviso{background:#fff4e5;color:#7a3306}
.fpa .avvisi .info{background:#eef2f1;color:#3b454e}
.fpa .foot{margin-top:14px;font-size:8pt;color:#6a737b;border-top:1px solid #d5dbda;padding-top:4px}
.fpa .corpo+.corpo{break-before:page;margin-top:20px}
@media print{.fpa{padding:0}.fpa .noprint{display:none}}
`;

/** HTML della fattura. opts: { compatta, firma: 'testo esito firma' } */
export function fatturaHtml(f, { compatta = false, firma = '', nomeFile = '' } = {}) {
  const parts = [];
  const party = (lbl, p) => p ? `<div class="box"><div class="lbl">${lbl}</div><div class="nome">${esc(p.nome || '—')}</div>
    ${p.partitaIva ? `<div>P. IVA <b>${esc(p.partitaIva)}</b></div>` : ''}${p.codiceFiscale ? `<div>Codice fiscale <b>${esc(p.codiceFiscale)}</b></div>` : ''}
    ${p.indirizzo ? `<div>${esc(p.indirizzo)}</div>` : ''}
    ${!compatta && p.regimeFiscale ? `<div class="sub">Regime fiscale: ${esc(REGIMI[p.regimeFiscale] || p.regimeFiscale)}</div>` : ''}
    ${!compatta && p.rea ? `<div class="sub">REA ${esc(p.rea)}</div>` : ''}
    ${!compatta && (p.telefono || p.email) ? `<div class="sub">${esc([p.telefono, p.email].filter(Boolean).join(' · '))}</div>` : ''}</div>` : '';
  f.corpi.forEach((c, idx) => {
    const k = c.calcoli;
    const d = c.divisa;
    const tipo = TIPI_DOCUMENTO[c.tipo] || c.tipo || 'Documento';
    parts.push(`<section class="corpo">
<div class="top"><div><h1>${esc(tipo)}</h1>${f.corpi.length > 1 ? `<div class="sub">Documento ${idx + 1} di ${f.corpi.length} nel file</div>` : ''}</div>
<div class="meta">Numero <strong>${esc(c.numero || '—')}</strong><br>del <strong>${esc(dataIt(c.data) || '—')}</strong></div></div>
<div class="parti">${party('Fornitore (cedente/prestatore)', f.cedente)}${party('Cliente (cessionario/committente)', f.cessionario)}</div>
<div class="chips">
${c.cig.length ? c.cig.map((x) => `<span class="chip code">CIG ${esc(x)}</span>`).join('') : '<span class="chip missing">CIG non indicato</span>'}
${c.cup.length ? c.cup.map((x) => `<span class="chip code">CUP ${esc(x)}</span>`).join('') : '<span class="chip missing">CUP non indicato</span>'}
${k.split ? '<span class="chip split">Scissione dei pagamenti: l\'IVA la versa l\'ente</span>' : ''}
${f.trasmissione.codiceDestinatario ? `<span class="chip">Codice ufficio ${esc(f.trasmissione.codiceDestinatario)}</span>` : ''}
</div>
${c.avvisi.filter((a) => !compatta || a.livello !== 'info').length ? `<ul class="avvisi">${c.avvisi.filter((a) => !compatta || a.livello !== 'info').map((a) => `<li class="${a.livello}">${esc(a.testo)}</li>`).join('')}</ul>` : ''}
${c.causali.length ? `<h2>Causale</h2><div>${c.causali.map(esc).join(' ')}</div>` : ''}
${!compatta && c.riferimenti.length ? `<h2>Riferimenti</h2><table><tr><th>Tipo</th><th>Documento</th><th>Data</th><th>CIG</th><th>CUP</th><th>Commessa</th></tr>${c.riferimenti.map((r) => `<tr><td>${esc({ DatiOrdineAcquisto: 'Ordine di acquisto', DatiContratto: 'Contratto', DatiConvenzione: 'Convenzione', DatiRicezione: 'Ricezione', DatiFattureCollegate: 'Fattura collegata' }[r.tipo])}</td><td>${esc(r.idDocumento)}</td><td>${esc(dataIt(r.data))}</td><td>${esc(r.cig)}</td><td>${esc(r.cup)}</td><td>${esc(r.commessa)}</td></tr>`).join('')}</table>` : ''}
${!compatta && c.ddt.length ? `<div class="sub">Documenti di trasporto: ${c.ddt.map((x) => `n. ${esc(x.numero)} del ${esc(dataIt(x.data))}`).join('; ')}</div>` : ''}
<h2>Dettaglio</h2>
<table><tr><th>Descrizione</th>${compatta ? '' : '<th class="n">Quantità</th><th class="n">Prezzo unitario</th>'}<th class="n">Importo</th><th class="n">IVA</th></tr>
${c.linee.map((l) => `<tr><td>${esc(l.descrizione)}${!compatta && (l.codici.length || l.periodo || l.sconti.length || l.riferimentoAmministrazione) ? `<div class="sub">${esc([l.codici.join(', '), l.periodo && 'Periodo ' + l.periodo, l.sconti.map((s) => `${s.tipo === 'MG' ? 'Maggiorazione' : 'Sconto'} ${s.percentuale != null ? numIt(s.percentuale) + '%' : euro(s.importo, d)}`).join(', '), l.riferimentoAmministrazione && 'Rif. amm. ' + l.riferimentoAmministrazione].filter(Boolean).join(' · '))}</div>` : ''}</td>
${compatta ? '' : `<td class="n">${l.quantita != null ? numIt(l.quantita) + (l.unita ? ' ' + esc(l.unita) : '') : ''}</td><td class="n">${l.prezzoUnitario != null ? euro(l.prezzoUnitario, d) : ''}</td>`}
<td class="n">${euro(l.prezzoTotale, d)}</td><td class="n">${l.natura ? esc(l.natura) : l.aliquota != null ? numIt(l.aliquota) + '%' : ''}</td></tr>`).join('')}
</table>
${c.cassa.length && !compatta ? `<div class="sub">Cassa previdenziale: ${c.cassa.map((x) => `${esc(x.tipo)} ${numIt(x.aliquota)}% = ${euro(x.importo, d)}`).join('; ')}</div>` : ''}
${c.riepilogo.length ? `<h2>Riepilogo IVA</h2><table><tr><th>Aliquota / natura</th><th class="n">Imponibile</th><th class="n">Imposta</th><th>Esigibilità</th></tr>
${c.riepilogo.map((r) => `<tr><td>${r.natura ? esc(r.natura + ' – ' + naturaLabel(r.natura)) : numIt(r.aliquota) + '%'}${r.normativa && !compatta ? `<div class="sub">${esc(r.normativa)}</div>` : ''}</td><td class="n">${euro(r.imponibile, d)}</td><td class="n">${euro(r.imposta, d)}</td><td>${esc(ESIGIBILITA[r.esigibilita] || r.esigibilita || '')}</td></tr>`).join('')}</table>` : ''}
<table class="tot">
<tr><td>Imponibile</td><td class="n">${euro(k.imponibile, d)}</td></tr>
<tr><td>IVA</td><td class="n">${euro(k.imposta, d)}</td></tr>
${c.bollo?.importo ? `<tr><td>Bollo${c.bollo.virtuale === 'SI' ? ' (virtuale)' : ''}</td><td class="n">${euro(c.bollo.importo, d)}</td></tr>` : ''}
${c.arrotondamento ? `<tr><td>Arrotondamento</td><td class="n">${euro(c.arrotondamento, d)}</td></tr>` : ''}
<tr class="grand"><td>Totale documento</td><td class="n">${euro(k.totale, d)}</td></tr>
${k.split ? `<tr><td>IVA trattenuta dall'ente (scissione dei pagamenti)</td><td class="n">− ${euro(k.ivaSplit, d)}</td></tr>` : ''}
${c.ritenute.map((r) => `<tr><td>${esc(TIPI_RITENUTA[r.tipo] || 'Ritenuta')}${r.aliquota != null ? ` (${numIt(r.aliquota)}%)` : ''}</td><td class="n">− ${euro(r.importo, d)}</td></tr>`).join('')}
${k.split || k.ritenute ? `<tr class="net"><td>Netto da pagare al fornitore <span class="sub">(calcolato)</span></td><td class="n">${euro(k.nettoAPagare, d)}</td></tr>` : ''}
</table>
${c.pagamenti.length ? `<h2>Pagamento</h2>${c.pagamenti.map((p) => `<div class="sub">${esc(CONDIZIONI_PAGAMENTO[p.condizioni] || p.condizioni)}</div><table><tr><th>Modalità</th><th>Scadenza</th><th class="n">Importo</th><th>Coordinate</th></tr>${p.dettagli.map((x) => `<tr><td>${esc(MODALITA_PAGAMENTO[x.modalita] || x.modalita)}${x.beneficiario ? `<div class="sub">Beneficiario: ${esc(x.beneficiario)}</div>` : ''}</td><td>${esc(dataIt(x.scadenza) || (x.giorni ? x.giorni + ' giorni' : ''))}</td><td class="n">${euro(x.importo, d)}</td><td>${x.iban ? `<div class="iban">${esc(ibanFormat(x.iban))}</div>` : ''}${x.istituto ? `<div class="sub">${esc(x.istituto)}${x.bic ? ' · BIC ' + esc(x.bic) : ''}</div>` : ''}${x.codicePagamento ? `<div class="sub">Codice pagamento ${esc(x.codicePagamento)}</div>` : ''}</td></tr>`).join('')}</table>`).join('')}` : ''}
${c.allegati.length ? `<h2>Allegati contenuti nella fattura</h2><ul>${c.allegati.map((a) => `<li>${esc(a.nome)}${a.descrizione ? ' – ' + esc(a.descrizione) : ''} <span class="sub">(${Math.max(1, Math.round(a.dimensione / 1024))} KB)</span></li>`).join('')}</ul>` : ''}
<div class="foot">Fattura elettronica ${esc(f.versione || '')}${f.trasmissione.progressivo ? ' · progressivo invio ' + esc(f.trasmissione.progressivo) : ''}${f.trasmissione.idTrasmittente ? ' · trasmittente ' + esc(f.trasmissione.idTrasmittente) : ''}${nomeFile ? ' · file ' + esc(nomeFile) : ''}${firma ? '<br>' + esc(firma) : ''}<br>Copia di cortesia generata da Leggio: il documento con valore fiscale è il file XML.</div>
</section>`);
  });
  return `<div class="fpa">${parts.join('')}</div>`;
}

/** Documento HTML completo (per stampa ed esportazione PDF). */
export function fatturaDocument(f, opts = {}) {
  return `<!DOCTYPE html><html lang="it"><head><meta charset="utf-8"><title>${esc(nomeProposto(f).replace(/\.pdf$/, ''))}</title><style>@page{size:A4;margin:12mm}body{margin:0;background:#fff}${FATTURA_CSS}</style></head><body>${fatturaHtml(f, opts)}</body></html>`;
}

/** Riconosce velocemente se dei byte sono una FatturaPA. */
export function isFattura(bytes) {
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 4096));
  return /<([a-zA-Z0-9_]+:)?FatturaElettronica(Semplificata)?[\s>]/.test(head);
}

export { findAll };
