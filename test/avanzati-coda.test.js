import { describe, it, expect } from 'vitest';
import * as PDFLib from '@cantoo/pdf-lib';
import fs from 'node:fs';
import { componi, mancanti, applicaConformita } from '../src/renderer/features/avanzati/lib/conformita.js';
import { analizza, proponiNome, trovaDate } from '../src/renderer/features/avanzati/lib/rinomina.js';
import { parseMime, bodyText, attachments, summary, parseDaticert, decodeWords, headerParams } from '../src/renderer/features/avanzati/lib/mime.js';

const fixture = new Uint8Array(fs.readFileSync(new URL('./fixtures/prova.pdf', import.meta.url)));

describe('dichiarazione di conformità', () => {
  it('compone i segnaposto e segnala quelli mancanti', () => {
    const t = componi('Il sottoscritto {nome}, {qualifica}, attesta che il documento di {pagine} pagine è conforme. {luogo}, {data}', { nome: 'Maria Verdi', qualifica: '', pagine: 6, data: '12/11/2026', luogo: 'Sesto Fiorentino' });
    expect(t).toContain('Maria Verdi, {qualifica}');
    expect(mancanti(t)).toEqual(['{qualifica}']);
  });
  it('aggiunge una pagina o scrive in calce', async () => {
    const d = await PDFLib.PDFDocument.load(fixture); const n = d.getPageCount();
    const r = await applicaConformita(d, PDFLib, { testo: 'Testo fornito dall\'ufficio.\nSeconda riga è qui.', firmatario: 'Maria Verdi', qualifica: 'Funzionario', luogoData: 'Sesto Fiorentino, 12/11/2026', dove: 'pagina', spazioFirma: true });
    expect(r).toEqual({ pagina: n + 1, aggiunta: true });
    const r2 = await applicaConformita(d, PDFLib, { testo: 'Breve attestazione.', firmatario: 'M. V.', dove: 'calce-prima' });
    expect(r2).toEqual({ pagina: 1, aggiunta: false });
    await expect(applicaConformita(d, PDFLib, { testo: 'parola '.repeat(3000), dove: 'calce-ultima' })).rejects.toThrow(/troppo lungo/);
    expect((await PDFLib.PDFDocument.load(await d.save())).getPageCount()).toBe(n + 1);
  });
});

describe('rinomina intelligente', () => {
  it('fattura', () => {
    const c = analizza('FORNITURE SCIENTIFICHE S.r.l. Via Roma 10 — FATTURA n. 123/A del 31/10/2026 — Spett.le CNR', 'scansione001.pdf');
    expect(c).toMatchObject({ tipo: 'Fattura', numero: '123/A', data: '2026-10-31', soggetto: 'FORNITURE SCIENTIFICHE' });
    expect(proponiNome(c)).toBe('Fattura_FORNITURE_SCIENTIFICHE_n123-A_2026-10-31.pdf');
  });
  it('DURC con scadenza', () => {
    const c = analizza('Documento Unico di Regolarità Contributiva. Denominazione/ragione sociale: EDIL ROSSI S.R.L. Data richiesta 15/10/2026 Scadenza validità 12/02/2027');
    expect(c.tipo).toBe('DURC');
    expect(c.scadenza).toBe('2027-02-12');
    expect(proponiNome(c)).toBe('DURC_EDIL_ROSSI_scad2027-02-12.pdf');
  });
  it('regola personalizzata e campi vuoti', () => {
    expect(proponiNome({ tipo: 'Documento', soggetto: '', numero: '', data: '', originale: 'x' }, '{data}_{tipo}_n{numero}')).toBe('Documento.pdf');
    expect(proponiNome({ tipo: 'Verbale', data: '2026-01-02', originale: 'CON' }, '{originale}')).toBe('_CON.pdf');
    expect(trovaDate('il 5 marzo 2026 e il 31/02/2026')).toEqual([{ iso: '2026-03-05', index: 3 }]);
  });
});

const EML = [
  'From: =?UTF-8?B?UG9zdGEgQ2VydGlmaWNhdGE=?= <posta-certificata@pec.example.it>',
  'To: ufficio@pec.cnr.it',
  'Subject: =?UTF-8?Q?POSTA_CERTIFICATA:_Offerta_gara_n=C2=B0_12?=',
  'Date: Thu, 12 Nov 2026 10:00:00 +0100',
  'MIME-Version: 1.0',
  'Content-Type: multipart/signed; protocol="application/pkcs7-signature"; boundary="ESTERNO"',
  '',
  '--ESTERNO',
  'Content-Type: multipart/mixed; boundary="MISTO"',
  '',
  '--MISTO',
  'Content-Type: text/plain; charset=utf-8',
  'Content-Transfer-Encoding: quoted-printable',
  '',
  'Messaggio di posta certificata: il giorno 12/11/2026 alle ore 10:00 =C3=A8 stato inviato',
  '--MISTO',
  'Content-Type: application/xml; name="daticert.xml"',
  'Content-Disposition: attachment; filename="daticert.xml"',
  '',
  '<?xml version="1.0"?><postacert tipo="posta-certificata" errore="nessuno"><intestazione><mittente>ditta@pec.it</mittente><destinatari tipo="certificato">ufficio@pec.cnr.it</destinatari><risposte>ditta@pec.it</risposte><oggetto>Offerta gara n° 12</oggetto></intestazione><dati><gestore-emittente>GESTORE PROVA</gestore-emittente><data zona="+0100"><giorno>12/11/2026</giorno><ora>10:00:00</ora></data><identificativo>opec123</identificativo><msgid>&lt;abc@pec.it&gt;</msgid></dati></postacert>',
  '--MISTO',
  'Content-Type: message/rfc822; name="postacert.eml"',
  'Content-Disposition: inline; filename="postacert.eml"',
  '',
  'From: ditta@pec.it',
  'Subject: Offerta',
  'Content-Type: multipart/mixed; boundary="INTERNO"',
  '',
  '--INTERNO',
  'Content-Type: text/plain; charset=utf-8',
  '',
  'In allegato la nostra offerta.',
  '--INTERNO',
  'Content-Type: application/pdf; name*=UTF-8\'\'offerta%20economica.pdf',
  'Content-Disposition: attachment; filename*=UTF-8\'\'offerta%20economica.pdf',
  'Content-Transfer-Encoding: base64',
  '',
  Buffer.from('%PDF-1.4 finto').toString('base64'),
  '--INTERNO--',
  '--MISTO--',
  '--ESTERNO',
  'Content-Type: application/pkcs7-signature; name="smime.p7s"',
  'Content-Transfer-Encoding: base64',
  '',
  'MIIBAA==',
  '--ESTERNO--',
  '',
].join('\r\n');

describe('PEC (.eml)', () => {
  const m = parseMime(new Uint8Array(Buffer.from(EML, 'utf8')));
  it('legge intestazioni codificate', () => {
    expect(summary(m).oggetto).toBe('POSTA CERTIFICATA: Offerta gara n° 12');
    expect(summary(m).da).toBe('Posta Certificata <posta-certificata@pec.example.it>');
    expect(decodeWords('=?iso-8859-1?Q?caff=E8?=')).toBe('caffè');
    expect(headerParams('attachment; filename*0="a"; filename*1="b.pdf"').params.filename).toBe('ab.pdf');
  });
  it('trova daticert, il messaggio originale e i suoi allegati', () => {
    const all = attachments(m);
    expect(all.map((a) => a.name)).toEqual(['daticert.xml', 'postacert.eml', 'smime.p7s']);
    const dc = parseDaticert(all[0].bytes);
    expect(dc).toMatchObject({ tipoLabel: 'Messaggio di posta certificata', mittente: 'ditta@pec.it', oggetto: 'Offerta gara n° 12', data: '12/11/2026 10:00:00 (+0100)', gestore: 'GESTORE PROVA', msgid: '<abc@pec.it>' });
    const orig = parseMime(all[1].bytes);
    expect(bodyText(orig)).toBe('In allegato la nostra offerta.');
    const inner = attachments(orig);
    expect(inner[0].name).toBe('offerta economica.pdf');
    expect(Buffer.from(inner[0].bytes).toString()).toBe('%PDF-1.4 finto');
    expect(bodyText(m)).toContain('è stato inviato');
  });
  it('non va in crash su dati casuali', () => {
    expect(() => parseMime(new Uint8Array(2000).map((_, i) => (i * 31) & 0xff))).not.toThrow();
  });
});

describe('testo delle pagine', async () => {
  const { pageText } = await import('../src/renderer/features/avanzati/lib/textsearch.js');
  it('non spezza le parole divise in più elementi', () => {
    const items = [
      { str: 'Scientifi', width: 40, transform: [10, 0, 0, 10, 100, 700] },
      { str: 'che', width: 15, transform: [10, 0, 0, 10, 140, 700] },
      { str: 'Laboratorio', width: 50, transform: [10, 0, 0, 10, 160, 700], hasEOL: true },
    ];
    expect(pageText(items)).toBe('Scientifiche Laboratorio\n');
  });
});
