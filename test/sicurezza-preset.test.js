// Modello pronto «Incarichi e assegni» (Amministrazione Trasparente) su testi realistici.
import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { PDFDocument, StandardFonts } from '@cantoo/pdf-lib';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { buildMatchers, findMatches } from '../src/renderer/features/sicurezza/logica/modelli.js';
import { getPreset, preselect, emailIstituzionale, signatureCandidates, FIRMA, datiEnte, isDatoEnte } from '../src/renderer/features/sicurezza/logica/preset.js';
import { findSignatures } from '../src/renderer/features/sicurezza/logica/firme.js';

const FONTS = fileURLToPath(new URL('../node_modules/pdfjs-dist/standard_fonts/', import.meta.url)).replace(/\\/g, '/'); // barra finale anche su Windows
const P = getPreset('incarichi');
const applica = (testo) => {
  const hits = findMatches(testo, buildMatchers({ models: P.cerca }));
  return { oscura: hits.filter((h) => preselect(P, h)).map((h) => h.text), resta: hits.filter((h) => !preselect(P, h)).map((h) => h.text) };
};

const INCARICO = `CONSIGLIO NAZIONALE DELLE RICERCHE — Istituto di Chimica dei Composti OrganoMetallici
Via G. Moruzzi 13, 56124 Pisa — C.F. 80054330586 — P.IVA 02118311006 — protocollo.iccom@pec.cnr.it
CONTRATTO DI LAVORO AUTONOMO OCCASIONALE
tra il CNR-ICCOM, rappresentato dal Direttore, e la dott.ssa Laura Bianchi, nata a Livorno (LI) il 14/03/1990,
codice fiscale BNCLRA90C54E625H, residente in Via dei Mille 22, 57123 Livorno, tel. 0586 123456,
cellulare +39 340 1122334, email laura.bianchi90@gmail.com, IBAN IT60X0542811101000000123456.
Oggetto: supporto all'analisi dei dati spettroscopici. Durata: dal 01/12/2026 al 31/05/2027.
Compenso lordo complessivo: euro 4.800,00 (quattromilaottocento/00).
Per le comunicazioni: segreteria.iccom@iccom.cnr.it, tel. 050 315 2443.
Firma del contraente`;

const ASSEGNO = `DECRETO DI CONFERIMENTO ASSEGNO DI RICERCA (contratto di ricerca ex art. 22 L. 240/2010)
IL DIRETTORE dell'Istituto ICCOM-CNR
DECRETA il conferimento al dott. Marco Verdi, nato il 02/07/1993 a Firenze, C.F. VRDMRC93L02D612J,
data di nascita: 02/07/1993, residente in Piazza Santo Spirito 5, 50125 Firenze,
recapito telefonico 333 765 4321, indirizzo email m.verdi@libero.it,
dell'assegno per lo svolgimento del progetto "Catalizzatori verdi", importo annuo lordo euro 24.000,00,
da accreditare sul conto IBAN IT60 X054 2811 1010 0000 0123 456.
Ditta fornitrice dei servizi: Beta S.r.l., Partita IVA 12345678903.`;

describe('modello «Incarichi e assegni»', () => {
  it('incarico: oscura i dati della persona, lascia nome, dati dell\'ente, P.IVA e compenso', () => {
    const r = applica(INCARICO);
    expect(r.oscura).toEqual(expect.arrayContaining([
      'Livorno (LI) il 14/03/1990', 'BNCLRA90C54E625H', 'Via dei Mille 22, 57123 Livorno', '0586 123456', '+39 340 1122334',
      'laura.bianchi90@gmail.com', 'IT60X0542811101000000123456',
    ]));
    const tutto = r.oscura.join(' | ');
    for (const resta of ['Laura Bianchi', '4.800,00', '02118311006', 'protocollo.iccom@pec.cnr.it', 'segreteria.iccom@iccom.cnr.it', '01/12/2026', 'Moruzzi']) expect(tutto).not.toContain(resta);
    expect(r.resta).toEqual(expect.arrayContaining(['02118311006', 'protocollo.iccom@pec.cnr.it', 'segreteria.iccom@iccom.cnr.it', 'Via G. Moruzzi 13, 56124 Pisa']));
  });
  it('decreto di assegno: nascita (due forme), CF, residenza, telefono, email personale, IBAN; la P.IVA della ditta resta', () => {
    const r = applica(ASSEGNO);
    expect(r.oscura).toEqual(expect.arrayContaining([
      '02/07/1993 a Firenze', '02/07/1993', 'VRDMRC93L02D612J', 'Piazza Santo Spirito 5, 50125 Firenze', '333 765 4321', 'm.verdi@libero.it', 'IT60 X054 2811 1010 0000 0123 456',
    ]));
    const tutto = r.oscura.join(' | ');
    for (const resta of ['Marco Verdi', '24.000,00', '12345678903']) expect(tutto).not.toContain(resta);
    expect(r.resta).toContain('12345678903');
  });
  it('email istituzionali', () => {
    expect(emailIstituzionale('mario.rossi@cnr.it')).toBe(true);
    expect(emailIstituzionale('a@iccom.cnr.it')).toBe(true);
    expect(emailIstituzionale('protocollo.iccom@pec.cnr.it')).toBe(true);
    expect(emailIstituzionale('ditta@legalmail.it')).toBe(true);
    expect(emailIstituzionale('mario@gmail.com')).toBe(false);
    expect(emailIstituzionale('x@unipi.it')).toBe(true);
  });
  it('il modello «Dati personali comuni» non cambia comportamento', () => {
    const d = getPreset('dati');
    const hits = findMatches(INCARICO, buildMatchers({ models: d.cerca }));
    const on = hits.filter((h) => preselect(d, h)).map((h) => h.text);
    expect(on).toContain('BNCLRA90C54E625H');
    expect(on).not.toContain('Via dei Mille 22, 57123 Livorno');
    expect(on).toContain('protocollo.iccom@pec.cnr.it'); // senza «email personale» tutte le email sono spuntate
  });
});

describe('firma autografa come immagine', () => {
  it('riquadri candidati: piccola e larga vicino a «Firma»; scansioni e loghi esclusi', () => {
    const labels = [[60, 140, 160, 152]];
    const c = signatureCandidates([
      { rect: [70, 90, 230, 135] },   // firma
      { rect: [0, 0, 595, 842] },     // scansione a tutta pagina
      { rect: [400, 780, 440, 820] }, // logo quadrato lontano
      { rect: [300, 600, 500, 640] }, // immagine larga ma lontana dalla dicitura
    ], labels, 595, 842);
    expect(c).toEqual([[67, 87, 233, 138]]);
  });
  it('in un PDF vero trova l\'immagine della firma vicino a «Firma del contraente»', async () => {
    const d = await PDFDocument.create(); const f = await d.embedFont(StandardFonts.Helvetica);
    const p = d.addPage([595, 842]);
    p.drawText('Firma del contraente', { x: 60, y: 200, size: 11, font: f });
    const png = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64'));
    const img = await d.embedPng(png);
    p.drawImage(img, { x: 60, y: 140, width: 150, height: 45 });
    p.drawImage(img, { x: 400, y: 760, width: 60, height: 60 }); // logo
    const t = pdfjs.getDocument({ data: await d.save(), standardFontDataUrl: FONTS }); const doc = await t.promise;
    const page = await doc.getPage(1);
    const r = await findSignatures(page, await page.getTextContent(), pdfjs.OPS);
    await t.destroy();
    expect(r).toHaveLength(1);
    expect(r[0].map(Math.round)).toEqual([57, 137, 213, 188]);
    expect(FIRMA).toMatch(/Firma/);
  });
});

describe('recapiti del Profilo dell\'ente: mai oscurati', () => {
  const profilo = {
    denominazione: 'CNR - Istituto di Chimica dei Composti Organometallici (ICCOM)', partitaIva: '02118311006', codiceFiscale: '80054330586',
    pec: 'protocollo.iccom@pec.cnr.it', telefono: 'Segreteria 050 315 2443 / sede di Sesto +39 055 5225000',
    ufficio: 'Ufficio amministrazione — segreteria.iccom@iccom.cnr.it',
  };
  const ente = datiEnte(profilo);
  it('estrae telefoni ed email dal profilo (i codici fiscali e le P.IVA non sono telefoni)', () => {
    expect([...ente.emails].sort()).toEqual(['protocollo.iccom@pec.cnr.it', 'segreteria.iccom@iccom.cnr.it']);
    expect(ente.phones.has('0503152443')).toBe(true);
    expect(ente.phones.has('0555225000')).toBe(true);
  });
  it('nel modello «Dati personali comuni» il telefono della segreteria resta, quello della persona no', () => {
    const d = getPreset('dati');
    const hits = findMatches(INCARICO, buildMatchers({ models: d.cerca })).filter((h) => !isDatoEnte(h, ente));
    const oscura = hits.filter((h) => preselect(d, h)).map((h) => h.text);
    expect(oscura).toEqual(expect.arrayContaining(['0586 123456', '+39 340 1122334', 'laura.bianchi90@gmail.com']));
    expect(oscura).not.toContain('050 315 2443');
    expect(oscura).not.toContain('protocollo.iccom@pec.cnr.it');
    expect(oscura).not.toContain('segreteria.iccom@iccom.cnr.it');
  });
  it('formati diversi dello stesso numero e profilo vuoto', () => {
    expect(isDatoEnte({ matcher: 'Numero di telefono', text: '+39 050-3152443' }, ente)).toBe(true);
    expect(isDatoEnte({ matcher: 'Numero di telefono', text: '050 315 2444' }, ente)).toBe(false);
    expect(isDatoEnte({ matcher: 'Indirizzo email', text: 'Protocollo.ICCOM@pec.cnr.it' }, ente)).toBe(true);
    expect(isDatoEnte({ matcher: 'Numero di telefono', text: '050 315 2443' }, datiEnte({}))).toBe(false);
    expect(isDatoEnte({ matcher: 'Numero di telefono', text: '050 315 2443' }, null)).toBe(false);
  });
});

describe('proposta automatica del modello', () => {
  it('riconosce incarichi, contratti di collaborazione, assegni e borse', async () => {
    const { sembraIncarico, presetConsigliato, profiloEnteCompilato } = await import('../src/renderer/features/sicurezza/logica/preset.js');
    expect(sembraIncarico(INCARICO)).toBe(true); // contratto di lavoro autonomo occasionale
    expect(sembraIncarico(ASSEGNO)).toBe(true);
    expect(sembraIncarico('DECRETO DI CONFERIMENTO DI UNA BORSA DI STUDIO per laureati')).toBe(true);
    expect(sembraIncarico('Contratto di collaborazione coordinata e continuativa')).toBe(true);
    expect(sembraIncarico('Conferimento dell’incarico\nprofessionale')).toBe(true);
    expect(sembraIncarico('Fattura n. 910/2026 — Vetreria Toscana Spa — CIG Z9F8E7D6C5')).toBe(false);
    expect(sembraIncarico('Determina di affidamento diretto della fornitura di reagenti')).toBe(false);
    expect(sembraIncarico('Ordine di missione n. 12')).toBe(false);
    expect(presetConsigliato({ testo: 'Fattura', tipoArchivio: 'incarico' })).toBe('incarichi');
    expect(presetConsigliato({ testo: 'Fattura n. 1', tipoArchivio: 'fattura' })).toBe(null);
    expect(profiloEnteCompilato({})).toBe(false);
    expect(profiloEnteCompilato({ denominazione: 'ICCOM', partitaIva: '02118311006' })).toBe(false);
    expect(profiloEnteCompilato({ telefono: '055 5225000' })).toBe(true);
  });
});
