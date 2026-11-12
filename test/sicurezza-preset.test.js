// Modello pronto «Incarichi e assegni» (Amministrazione Trasparente) su testi realistici.
import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { PDFDocument, StandardFonts } from '@cantoo/pdf-lib';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { buildMatchers, findMatches } from '../src/renderer/features/sicurezza/logica/modelli.js';
import { getPreset, preselect, emailIstituzionale, signatureCandidates, FIRMA } from '../src/renderer/features/sicurezza/logica/preset.js';
import { findSignatures } from '../src/renderer/features/sicurezza/logica/firme.js';

const FONTS = fileURLToPath(new URL('../node_modules/pdfjs-dist/standard_fonts/', import.meta.url));
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
