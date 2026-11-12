import { describe, it, expect } from 'vitest';
import * as PDFLib from '@cantoo/pdf-lib';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import fs from 'node:fs';
import { estraiDati, partitaIvaValida, codiceFiscaleValido, ibanValido, importo, riepilogoTesto } from '../src/renderer/features/avanzati/lib/datichiave.js';
import { creaFascicolo, pagineIndice } from '../src/renderer/features/avanzati/lib/fascicolo.js';
import { normalizzaEnte, validaEnte, valorePerCampo, vociInseribili, firmatari } from '../src/renderer/features/avanzati/lib/ente.js';
import { riquadroContenuto, ritaglioUtile, nomeMissione, aggiungiRiepilogo, dividiPerDimensione } from '../src/renderer/features/avanzati/lib/missione.js';
import { raggruppaPerVoce, csvRendiconto } from '../src/renderer/features/avanzati/lib/rendiconto.js';
import { nuovoLavoro, registra, daFare, conteggi, lavoroValido, registroCsv } from '../src/renderer/features/avanzati/lib/registro.js';

const prova = new Uint8Array(fs.readFileSync(new URL('./fixtures/prova.pdf', import.meta.url)));
const secondo = new Uint8Array(fs.readFileSync(new URL('./fixtures/secondo.pdf', import.meta.url)));

describe('dati chiave', () => {
  it('validatori', () => {
    expect(partitaIvaValida('01234567890')).toBe(false);
    expect(partitaIvaValida('02118311006')).toBe(true);
    expect(codiceFiscaleValido('RSSMRA70A01H501S')).toBe(true);
    expect(codiceFiscaleValido('RSSMRA70A01H501U')).toBe(false);
    expect(ibanValido('IT60 X054 2811 1010 0000 0123 456')).toBe(true);
    expect(importo('1.234,56')).toBe(1234.56); expect(importo('1234.56')).toBe(1234.56); expect(importo('€ 12')).toBe(12);
  });
  it('estrae CIG, CUP, P.IVA, IBAN, totale e scadenze', () => {
    const t = 'Fornitore P.IVA IT02118311006. CIG: Z1A2B3C4D5 – CUP B12C34000560001. Imponibile € 1.000,00 IVA € 220,00 Totale documento € 1.220,00. IBAN IT60 X054 2811 1010 0000 0123 456. Scadenza pagamento: 30/11/2026. Referente RSSMRA70A01H501S';
    const d = estraiDati(t);
    expect(d.cig.map((x) => x.valore)).toEqual(['Z1A2B3C4D5']);
    expect(d.cup.map((x) => x.valore)).toEqual(['B12C34000560001']);
    expect(d.piva.map((x) => x.valore)).toEqual(['02118311006']);
    expect(d.cf.map((x) => x.valore)).toEqual(['RSSMRA70A01H501S']);
    expect(d.iban[0].valore).toBe('IT60X0542811101000000123456');
    expect(d.totale).toBe(1220);
    expect(d.scadenze[0]).toMatchObject({ valore: '2026-11-30' });
    expect(riepilogoTesto(d)).toContain('CIG: Z1A2B3C4D5');
    expect(d.durc).toBeNull();
  });
  it('DURC scaduto o valido', () => {
    const scaduto = estraiDati('DURC On Line — Documento Unico di Regolarità Contributiva. Il datore di lavoro RISULTA REGOLARE. Scadenza validità 12/02/2026', { oggi: new Date(2026, 10, 12) });
    expect(scaduto.durc).toMatchObject({ scadenza: '2026-02-12', scaduto: true, regolare: true });
    const valido = estraiDati('DURC Data richiesta 01/10/2026', { oggi: new Date(2026, 10, 12), durataDurc: 120 });
    expect(valido.durc).toMatchObject({ scadenza: '2027-01-29', calcolata: true, scaduto: false, giorniResidui: 78 });
  });
});

describe('fascicolo con indice', () => {
  it('unisce, crea indice cliccabile e segnalibri, salta i file rotti', async () => {
    const { pdfDoc, voci, saltati } = await creaFascicolo(PDFLib, [
      { titolo: 'Determina di aggiudicazione', bytes: prova }, { titolo: 'Rotto', bytes: new Uint8Array([1, 2, 3]) }, { titolo: 'Contratto', bytes: secondo },
    ], { titolo: 'Gara 12/2026', etichetta: 'Allegato', numeriPagina: true });
    expect(saltati).toEqual([{ titolo: 'Rotto', motivo: 'non è un PDF leggibile' }]);
    expect(voci).toEqual([{ titolo: 'Determina di aggiudicazione', pagina: 2, pagine: 6, n: 1 }, { titolo: 'Contratto', pagina: 8, pagine: 2, n: 2 }]);
    const bytes = await pdfDoc.save();
    const pdf = await pdfjs.getDocument({ data: bytes, isEvalSupported: false }).promise;
    expect(pdf.numPages).toBe(9);
    const outline = await pdf.getOutline();
    expect(outline.map((o) => o.title)).toEqual(['Indice', '1. Determina di aggiudicazione', '2. Contratto']);
    expect(await pdf.getPageIndex(outline[2].dest[0])).toBe(7);
    const annots = await (await pdf.getPage(1)).getAnnotations();
    const links = annots.filter((a) => a.subtype === 'Link');
    expect(links).toHaveLength(2);
    expect(await pdf.getPageIndex(links[1].dest[0])).toBe(7);
    const t8 = (await (await pdf.getPage(8)).getTextContent()).items.map((i) => i.str).join(' ');
    expect(t8).toContain('Allegato n. 2'); expect(t8).toContain('Pagina 8 di 9');
    await pdf.loadingTask.destroy();
    expect(pagineIndice(100)).toBe(5);
  });
});

describe('profilo dell\'ente', () => {
  const ente = normalizzaEnte({ denominazione: 'CNR - ICCOM', sigla: 'ICCOM-CNR', indirizzo: 'Via Madonna del Piano 10', cap: '50019', citta: 'Sesto Fiorentino', provincia: 'FI', codiceFiscale: '80054330586', partitaIva: '02118311006', pec: 'protocollo@pec.cnr.it', codiceUfficio: 'ABC123', direttore: 'Mario Rossi', firmatari: 'Anna Bianchi — RUP\nLuca Neri', vuoto: 'x' });
  it('valida e normalizza', () => {
    expect(ente.vuoto).toBeUndefined();
    expect(validaEnte(ente)).toEqual([]);
    expect(validaEnte({ partitaIva: '123', pec: 'nopec' })).toHaveLength(2);
    expect(firmatari(ente)).toEqual([{ nome: 'Mario Rossi', qualifica: 'Direttore' }, { nome: 'Anna Bianchi', qualifica: 'RUP' }, { nome: 'Luca Neri', qualifica: '' }]);
  });
  it('compila i campi dell\'ente ma lascia il codice fiscale della persona', () => {
    expect(valorePerCampo('codice_univoco_ufficio', ente)).toMatchObject({ value: 'ABC123' });
    expect(valorePerCampo('Denominazione', ente)).toMatchObject({ value: 'CNR - ICCOM' });
    expect(valorePerCampo('PEC', ente)).toMatchObject({ value: 'protocollo@pec.cnr.it' });
    expect(valorePerCampo('codice_fiscale_ente', ente)).toMatchObject({ value: '80054330586' });
    expect(valorePerCampo('codice_fiscale', ente)).toBeNull();
    expect(vociInseribili(ente).find((v) => v.label === 'Intestazione completa').testo).toContain('C.F. 80054330586 – P.IVA 02118311006');
  });
});

describe('pratica di missione', () => {
  it('trova il riquadro del contenuto in una scansione con margini bianchi', () => {
    const w = 200; const h = 300; const data = new Uint8ClampedArray(w * h * 4).fill(255);
    for (let y = 100; y < 180; y++) for (let x = 40; x < 150; x++) { const i = (y * w + x) * 4; data[i] = data[i + 1] = data[i + 2] = 20; }
    const r = riquadroContenuto({ data, width: w, height: h });
    expect(r.x).toBeLessThanOrEqual(40); expect(r.x).toBeGreaterThan(30);
    expect(r.y).toBeLessThanOrEqual(100); expect(r.x + r.w).toBeGreaterThanOrEqual(150); expect(r.y + r.h).toBeGreaterThanOrEqual(180);
    expect(ritaglioUtile(r, w, h)).toBe(true);
    expect(riquadroContenuto({ data: new Uint8ClampedArray(w * h * 4).fill(255), width: w, height: h })).toBeNull();
  });
  it('nome del file e pagina di riepilogo', async () => {
    expect(nomeMissione("D'Àngelo", '2026-11-12')).toBe('Missione_DANGELO_2026-11-12.pdf');
    const d = await PDFLib.PDFDocument.load(prova);
    await aggiungiRiepilogo(d, PDFLib, [{ titolo: 'Biglietto treno', pagina: 0 }, { titolo: 'Albergo', pagina: 2 }], { righe: ['Missione a Roma'] });
    expect(d.getPageCount()).toBe(7);
  });
  it('divide in parti sotto la soglia, con «parte k di N»', async () => {
    const d = await PDFLib.PDFDocument.create(); const f = await d.embedFont(PDFLib.StandardFonts.Helvetica);
    for (let i = 0; i < 12; i++) { const p = d.addPage(); for (let k = 0; k < 40; k++) p.drawText(`Pagina ${i} riga ${k} ` + 'x'.repeat(80) + Math.random(), { x: 20, y: 800 - k * 18, size: 8, font: f }); }
    const bytes = await d.save({ useObjectStreams: true });
    const max = Math.ceil(bytes.length / 3);
    const parti = await dividiPerDimensione(PDFLib, bytes, max);
    expect(parti.length).toBeGreaterThanOrEqual(3);
    expect(parti.every((p) => p.bytes.length <= max)).toBe(true);
    expect(parti[0].da).toBe(1); expect(parti[parti.length - 1].a).toBe(12);
    const pdf = await pdfjs.getDocument({ data: parti[1].bytes, isEvalSupported: false }).promise;
    expect((await (await pdf.getPage(1)).getTextContent()).items.map((i) => i.str).join(' ')).toContain(`Parte 2 di ${parti.length}`);
    await pdf.loadingTask.destroy();
  });
});

describe('rendicontazione e registro', () => {
  it('raggruppa per voce e produce il CSV per Excel', () => {
    const g = raggruppaPerVoce([{ rel: 'Viaggi/treno 10.pdf' }, { rel: 'Viaggi/treno 2.pdf' }, { rel: 'Materiali/fattura.pdf' }, { rel: 'sciolto.pdf' }]);
    expect(g.map((x) => x.voce)).toEqual(['Materiali', 'Viaggi', 'Senza voce']);
    expect(g[1].files.map((f) => f.rel)).toEqual(['Viaggi/treno 2.pdf', 'Viaggi/treno 10.pdf']);
    const csv = csvRendiconto([{ voce: 'Viaggi', n: 1, file: 'treno; A/R.pdf', pagine: 1, paginaNelPdf: 2, data: '2026-10-01', importo: 1234.5 }]);
    expect(csv.startsWith('﻿')).toBe(true);
    expect(csv).toContain('Viaggi;1;"treno; A/R.pdf";1;2;01/10/2026;1234,50');
  });
  it('lavoro ripristinabile senza password e registro', () => {
    const items = Array.from({ length: 5 }, (_, i) => ({ path: `/c/${i}.pdf`, name: `${i}.pdf`, rel: `${i}.pdf`, size: 10 }));
    const l = nuovoLavoro({ items, passi: [{ op: 'proteggi', params: { password: 'segreta' } }], opzioni: { dest: 'sub' } });
    expect(JSON.stringify(l)).not.toContain('segreta');
    registra(l, l.items[0], { s: 'ok', dove: '/c/Elaborati/0.pdf' }); registra(l, l.items[1], { s: 'saltato', motivo: 'protetto' });
    expect(daFare(l).map((x) => x.name)).toEqual(['2.pdf', '3.pdf', '4.pdf']);
    expect(conteggi(l)).toMatchObject({ ok: 1, saltati: 1, mancanti: 3 });
    expect(lavoroValido(JSON.parse(JSON.stringify(l)))).toBe(true);
    expect(lavoroValido({ v: 1 })).toBe(false);
    expect(registroCsv(l).split('\r\n')[3]).toMatch(/^DA FARE;2\.pdf/);
  });
});
