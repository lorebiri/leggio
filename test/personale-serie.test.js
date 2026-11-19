// Compilazione in serie e modelli (features/personale/lib/serie.js, modelli.js): nomi dei file,
// abbinamento automatico, record da rubrica e da CSV, controlli per record, generazione vera con pdf-lib
// (file singoli e PDF unico), zone su PDF non compilabili, firma PNG, interruzione, impronte dei modelli.
import { describe, it, expect } from 'vitest';
import * as PDFLib from '@cantoo/pdf-lib';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { readValues } from '../src/renderer/features/moduli/formtools.js';
import {
  pulisciNomeFile, nomeFileDaSchema, creaNomiUnici, chiaveIntestazione, recordDaContatto, recordDaRiga,
  abbinaColonne, abbinaRubrica, controllaRecord, generaSerie, riepilogo, riepilogoCsv,
} from '../src/renderer/features/personale/lib/serie.js';
import {
  improntaPdf, modelloDaPdf, modelloPerDocumento, corrispondenzeModello, compilaConModello, normalizzaModello,
  valoreChiave, campiDaPdf, posizionePredefinita, paginaEffettiva,
} from '../src/renderer/features/personale/lib/modelli.js';
import { tabellaDaCsv } from '../src/renderer/features/personale/lib/tabelle.js';
import { createArchivio } from '../src/renderer/features/personale/lib/archivio.js';
import { createMemoryBackend } from '../src/renderer/features/personale/lib/backend.js';

// codici fiscali validi (carattere di controllo corretto)
const CF_OK = ['RSSMRA80A01H501U', 'BNCLRA85M41F205C', 'VRDGPP70C15L219C'];

async function moduloProva({ pagine = 1 } = {}) {
  const d = await PDFLib.PDFDocument.create();
  const p = d.addPage([595, 842]);
  for (let i = 1; i < pagine; i++) d.addPage([595, 842]);
  const f = d.getForm();
  f.createTextField('cognome').addToPage(p, { x: 150, y: 700, width: 250, height: 20 });
  f.createTextField('nome').addToPage(p, { x: 150, y: 660, width: 250, height: 20 });
  const cf = f.createTextField('codice_fiscale'); cf.setMaxLength(16); cf.addToPage(p, { x: 150, y: 620, width: 250, height: 20 });
  f.createTextField('data').addToPage(p, { x: 150, y: 580, width: 120, height: 20 });
  f.createTextField('ufficio_note').addToPage(p, { x: 150, y: 540, width: 250, height: 20 });
  f.createCheckBox('accetto').addToPage(p, { x: 150, y: 500, width: 14, height: 14 });
  return d.save();
}
async function pdfNormale(pagine = 1, rotazione = 0) {
  const d = await PDFLib.PDFDocument.create();
  const font = await d.embedFont(PDFLib.StandardFonts.Helvetica);
  for (let i = 0; i < pagine; i++) { const p = d.addPage([595, 842]); p.drawText(`Domanda pagina ${i + 1}`, { x: 50, y: 800, size: 12, font }); if (rotazione) p.setRotation(PDFLib.degrees(rotazione)); }
  return d.save();
}
async function testoPagine(bytes) {
  const pdf = await pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false }).promise;
  const out = [];
  for (let i = 1; i <= pdf.numPages; i++) out.push((await (await pdf.getPage(i)).getTextContent()).items.map((x) => x.str).join(' '));
  await pdf.loadingTask.destroy();
  return out;
}
// PNG 4×2 rosso (base64)
const PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAQAAAACCAYAAAB/qH1jAAAAEklEQVR4nGP4z8DwHxkzoAsAAA8hD/EEN8afAAAAAElFTkSuQmCC'), (c) => c.charCodeAt(0));

describe('nomi dei file', () => {
  const dati = { cognome: 'Rossi', nome: 'Maria', codiceFiscale: CF_OK[0], 'colonna:Protocollo': '12/2026', 'colonna:Ufficio': 'Ragioneria' };
  it('segnaposto, numero con zeri, data, colonne del file', () => {
    expect(nomeFileDaSchema('{cognome}_{nome}_domanda.pdf', dati)).toBe('Rossi_Maria_domanda.pdf');
    expect(nomeFileDaSchema('{n}_{cognome}', dati, { n: 7, totale: 120 })).toBe('007_Rossi.pdf');
    expect(nomeFileDaSchema('{data}_{codiceFiscale}', dati, { data: new Date(2026, 10, 19) })).toBe(`2026-11-19_${CF_OK[0]}.pdf`);
    expect(nomeFileDaSchema('{Ufficio} {protocollo}', dati)).toBe('Ragioneria 12_2026.pdf');
  });
  it('pulizia: caratteri non validi, segnaposto vuoti, nomi riservati, lunghezza, estensione', () => {
    expect(nomeFileDaSchema('{cognome}_{ragioneSociale}_domanda', dati)).toBe('Rossi_domanda.pdf');
    expect(pulisciNomeFile('  a<b>:c*?d|e"f\\g/h  ')).toBe('a_b_c_d_e_f_g_h');
    expect(pulisciNomeFile('...nascosto. ')).toBe('nascosto');
    expect(pulisciNomeFile('CON')).toBe('_CON');
    expect(pulisciNomeFile('')).toBe('documento');
    expect(pulisciNomeFile('x'.repeat(400)).length).toBe(150);
    expect(nomeFileDaSchema('{inesistente}', {})).toBe('documento.pdf');
    expect(nomeFileDaSchema('Domanda.PDF', {})).toBe('Domanda.pdf');
    expect(nomeFileDaSchema('{cognome}', { cognome: "D'Angelo Gaetà" })).toBe("D'Angelo Gaetà.pdf");
  });
  it('nomi doppi resi unici, senza distinguere le maiuscole', () => {
    const u = creaNomiUnici();
    expect([u('Rossi.pdf'), u('rossi.pdf'), u('Rossi.pdf'), u('Bianchi.pdf')]).toEqual(['Rossi.pdf', 'rossi_2.pdf', 'Rossi_3.pdf', 'Bianchi.pdf']);
  });
});

describe('record e abbinamento automatico', () => {
  it('record da un contatto della rubrica', () => {
    const r = recordDaContatto({ id: 'c1', nome: 'Maria', cognome: 'Rossi', codiceFiscale: CF_OK[0], ruolo: 'Istruttore', note: 'x' });
    expect(r).toMatchObject({ id: 'c1', etichetta: 'Maria Rossi' });
    expect(r.dati).toMatchObject({ nome: 'Maria', cognome: 'Rossi', nomeCompleto: 'Maria Rossi', qualifica: 'Istruttore' });
    expect(r.dati.note).toBeUndefined();
  });
  it('record da una riga CSV: colonne e chiavi riconosciute', () => {
    const t = tabellaDaCsv('Cognome;Nome;C.F.;Città;Protocollo\nRossi;Maria;rssmra80a01h501u;Pisa;12\n');
    expect(chiaveIntestazione('C.F.')).toBe('codiceFiscale');
    expect(chiaveIntestazione('Città')).toBe('citta');
    expect(chiaveIntestazione('Protocollo')).toBe(null);
    const r = recordDaRiga(t.righe[0], t.intestazioni, 0);
    expect(r.dati).toMatchObject({ 'colonna:Cognome': 'Rossi', 'colonna:Protocollo': '12', cognome: 'Rossi', nome: 'Maria', codiceFiscale: 'rssmra80a01h501u', citta: 'Pisa', nomeCompleto: 'Maria Rossi' });
    expect(r.etichetta).toBe('Maria Rossi');
    expect(recordDaRiga({ Protocollo: '' }, ['Protocollo'], 4).etichetta).toBe('Riga 5');
  });
  it('colonne ↔ campi: nome identico, chiave riconosciuta, chiave derivata, data', () => {
    const campi = [{ nome: 'cognome', tipo: 'text' }, { nome: 'Nome_e_cognome', tipo: 'text' }, { nome: 'cf', tipo: 'text' }, { nome: 'Protocollo', tipo: 'text' }, { nome: 'data', tipo: 'text' }, { nome: 'xyz', tipo: 'text' }, { nome: 'accetto', tipo: 'checkbox' }];
    const a = abbinaColonne(campi, ['Cognome', 'Nome', 'Codice fiscale', 'PROTOCOLLO']);
    expect(a).toEqual({ cognome: 'colonna:Cognome', Nome_e_cognome: 'nomeCompleto', cf: 'colonna:Codice fiscale', Protocollo: 'colonna:PROTOCOLLO', data: 'oggi', xyz: '', accetto: '' });
    expect(abbinaRubrica(campi)).toEqual({ cognome: 'cognome', Nome_e_cognome: 'nomeCompleto', cf: 'codiceFiscale', Protocollo: '', data: 'oggi', xyz: '', accetto: '' });
  });
});

describe('controlli per record', () => {
  const modello = normalizzaModello({ tipo: 'acroform', campi: [{ nome: 'cognome' }, { nome: 'codice_fiscale' }, { nome: 'note' }], corrispondenze: { cognome: 'cognome', codice_fiscale: 'codiceFiscale', note: 'fisso:Nessuna' } });
  it('campi abbinati vuoti e codici fiscali non validi', () => {
    expect(controllaRecord({ dati: { cognome: 'Rossi', codiceFiscale: CF_OK[0] } }, modello).avvisi).toEqual([]);
    const r = controllaRecord({ dati: { codiceFiscale: 'RSSMRA80A01H501X' } }, modello);
    expect(r.mancanti).toEqual(['cognome']);
    expect(r.cf).toHaveLength(1);
    expect(r.avvisi.join(' ')).toMatch(/Campi senza dato: cognome.*Codice fiscale non valido/);
  });
  it('codice fiscale da una colonna del file', () => {
    const m = normalizzaModello({ tipo: 'acroform', campi: [{ nome: 'campo1' }], corrispondenze: { campo1: 'colonna:Cod. fiscale' } });
    expect(controllaRecord({ dati: { 'colonna:Cod. fiscale': 'ABC' } }, m).cf).toHaveLength(1);
  });
});

describe('modelli', () => {
  it('impronta, campi, corrispondenze, riconoscimento del documento', async () => {
    const bytes = await moduloProva();
    const m = await modelloDaPdf(PDFLib, bytes, { nome: 'Domanda' });
    expect(m.impronta).toBe(await improntaPdf(bytes));
    expect(m.impronta).toMatch(/^[0-9a-f]{64}$/);
    expect(m.tipo).toBe('acroform');
    expect(m.campi.map((c) => c.nome)).toEqual(['cognome', 'nome', 'codice_fiscale', 'data', 'ufficio_note', 'accetto']);
    expect(m.corrispondenze).toMatchObject({ cognome: 'cognome', nome: 'nome', codice_fiscale: 'codiceFiscale', data: 'oggi', accetto: '' });
    expect(corrispondenzeModello({ campi: [{ nome: 'a' }, { nome: 'b' }], corrispondenze: { a: 'nome' } })).toEqual({ a: 'nome', b: '' });

    const archivio = createArchivio({ backend: createMemoryBackend() });
    await archivio.apri();
    const salvato = await archivio.salvaModello(m, bytes);
    expect(salvato.blob).toBeTruthy();
    expect(Array.from(await archivio.pdfModello(salvato.id))).toEqual(Array.from(bytes));
    expect((await modelloPerDocumento(archivio, bytes))?.id).toBe(salvato.id);
    // stesso modulo già compilato (byte diversi): riconosciuto dai campi
    const d = await PDFLib.PDFDocument.load(bytes); d.getForm().getTextField('cognome').setText('Rossi');
    expect((await modelloPerDocumento(archivio, await d.save()))?.id).toBe(salvato.id);
    expect(await modelloPerDocumento(archivio, await pdfNormale())).toBe(null);
    expect(await modelloPerDocumento([], bytes)).toBe(null);
  });
  it('valori delle chiavi', () => {
    expect(valoreChiave('', {})).toBe(null);
    expect(valoreChiave('oggi', {}, '01/02/2026')).toBe('01/02/2026');
    expect(valoreChiave('fisso:Pisa', {})).toBe('Pisa');
    expect(valoreChiave('colonna:Ufficio', { 'colonna:Ufficio': ' Tributi ' })).toBe('Tributi');
    expect(valoreChiave('cognome', {})).toBe('');
  });
  it('compilaConModello scrive campi AcroForm (anche le caselle) e segnala i vuoti', async () => {
    const bytes = await moduloProva();
    const m = await modelloDaPdf(PDFLib, bytes);
    m.corrispondenze.accetto = 'fisso:Sì';
    m.corrispondenze.ufficio_note = 'colonna:Ufficio';
    const d = await PDFLib.PDFDocument.load(bytes);
    const r = await compilaConModello(PDFLib, d, m, { cognome: 'Rossi', nome: 'Maria', codiceFiscale: CF_OK[0] }, { oggi: '19/11/2026' });
    expect(r.scritti).toBe(5);
    expect(r.vuoti).toEqual(['ufficio_note']);
    const v = readValues(PDFLib, await PDFLib.PDFDocument.load(await d.save())).values;
    expect(v).toMatchObject({ cognome: 'Rossi', nome: 'Maria', codice_fiscale: CF_OK[0], data: '19/11/2026', accetto: true, ufficio_note: '' });
  });
  it('posizioni predefinite e pagina effettiva', () => {
    expect(posizionePredefinita([595, 842], 'basso-destra', { size: [150, 60] }).rect).toEqual([397, 56, 547, 116]);
    expect(posizionePredefinita([595, 842], 'basso-sinistra').rect[0]).toBe(48);
    expect(paginaEffettiva(-1, 3)).toBe(2);
    expect(paginaEffettiva(7, 3)).toBe(2);
  });
});

describe('generazione', () => {
  const contatti = Array.from({ length: 100 }, (_, i) => ({ id: 'c' + i, nome: 'Nome' + i, cognome: i % 10 === 0 ? 'Rossi' : 'Cognome' + i, codiceFiscale: i === 5 ? 'SBAGLIATO' : CF_OK[i % 3] }));
  const records = contatti.map(recordDaContatto);
  delete records[7].dati.nome; // un record con un campo vuoto

  it('100 record → 100 PDF con i valori giusti, avvisi per record, nomi unici', async () => {
    const base = await moduloProva();
    const modello = await modelloDaPdf(PDFLib, base);
    expect(modello.corrispondenze.ufficio_note).toBe('ufficio'); // riconosciuto, ma la rubrica non ha l'ufficio
    modello.corrispondenze.ufficio_note = '';
    const pdf = []; const gruppi = [];
    const r = await generaSerie({ PDFLib, base, modello, records, opzioni: { schema: '{cognome}_{nome}.pdf', oggi: '19/11/2026' }, gruppo: 25, onGruppo: async (g) => { gruppi.push(g.length); pdf.push(...g); } });
    expect(gruppi).toEqual([25, 25, 25, 25]);
    expect(r.esiti).toHaveLength(100);
    expect(riepilogo(r.esiti)).toMatchObject({ totale: 100, generati: 100, errori: 0, avvisi: 2 });
    expect(r.esiti[5].avvisi.join()).toMatch(/Codice fiscale non valido/);
    expect(r.esiti[7].avvisi.join()).toMatch(/Campi senza dato: nome/);
    expect(new Set(r.esiti.map((e) => e.nome.toLowerCase())).size).toBe(100);
    expect(r.esiti[0].nome).toBe('Rossi_Nome0.pdf');
    expect(r.esiti[7].nome).toBe('Cognome7.pdf');
    expect(r.esiti[0].bytes).toBeUndefined(); // i byte viaggiano solo nei gruppi
    for (const [i, e] of pdf.entries()) {
      const v = readValues(PDFLib, await PDFLib.PDFDocument.load(e.bytes)).values;
      expect(v.cognome).toBe(contatti[i].cognome);
      expect(v.nome).toBe(i === 7 ? '' : 'Nome' + i);
      expect(v.data).toBe('19/11/2026');
    }
    const csv = riepilogoCsv(r.esiti);
    expect(csv.split('\r\n')[0]).toContain('N.;Record;File;Esito');
    expect(csv).toContain('Generato con avvisi');
  });

  it('PDF unico con 100 × pagine, campi appiattiti e testo leggibile', async () => {
    const base = await moduloProva({ pagine: 2 });
    const modello = await modelloDaPdf(PDFLib, base);
    let gruppiConByte = 0;
    const r = await generaSerie({ PDFLib, base, modello, records, opzioni: { schema: '{n}', unico: true }, onGruppo: async (g) => { gruppiConByte += g.filter((e) => e.bytes).length; } });
    expect(gruppiConByte).toBe(0);
    expect(r.pagineUnico).toBe(200);
    const d = await PDFLib.PDFDocument.load(r.unico);
    expect(d.getPageCount()).toBe(200);
    expect(d.getForm().getFields()).toHaveLength(0);
    const testi = await testoPagine(r.unico);
    expect(testi[0]).toContain('Rossi');
    expect(testi[2]).toContain('Cognome1');
    expect(testi[198]).toContain('Cognome99');
  });

  it('un record con errori non blocca gli altri', async () => {
    const base = await moduloProva();
    const modello = await modelloDaPdf(PDFLib, base);
    modello.corrispondenze.ufficio_note = '';
    const cattivo = { id: 'x', etichetta: 'Rotto', get dati() { throw new Error('dati illeggibili'); } };
    const r = await generaSerie({ PDFLib, base, modello, records: [records[0], cattivo, records[1]], opzioni: {} });
    expect(r.esiti.map((e) => e.stato)).toEqual(['ok', 'errore', 'ok']);
    expect(r.esiti[1].errore).toMatch(/illeggibili/);
  });

  it('zone su un PDF non compilabile (anche su pagina ruotata): il testo compare', async () => {
    const base = await pdfNormale(2, 0);
    const modello = normalizzaModello({ tipo: 'zone', zone: [
      { pagina: 0, rect: [100, 700, 400, 720], chiave: 'cognome', size: 12 },
      { pagina: 0, rect: [100, 660, 400, 680], chiave: 'codiceFiscale', size: 11, allinea: 'destra' },
      { pagina: 1, rect: [100, 600, 300, 620], chiave: 'fisso:Pisa, lì', allinea: 'centro' },
      { pagina: 1, rect: [100, 560, 300, 580], chiave: 'colonna:Assente' },
    ] });
    const recs = [{ id: 'a', dati: { cognome: 'Niccolò Àlvarez', codiceFiscale: CF_OK[0] } }];
    const out = [];
    const r = await generaSerie({ PDFLib, base, modello, records: recs, opzioni: { schema: '{cognome}' }, onGruppo: async (g) => out.push(...g) });
    expect(r.esiti[0].stato).toBe('avvisi'); // la colonna assente è vuota
    const t = await testoPagine(out[0].bytes);
    expect(t[0]).toContain('Niccolò Àlvarez');
    expect(t[0]).toContain(CF_OK[0]);
    expect(t[1]).toContain('Pisa, lì');
    // pagina ruotata: il testo resta leggibile
    const ruotata = await pdfNormale(1, 90);
    const d = await PDFLib.PDFDocument.load(ruotata);
    await compilaConModello(PDFLib, d, normalizzaModello({ tipo: 'zone', zone: [{ pagina: 0, rect: [300, 100, 320, 400], chiave: 'cognome' }] }), { cognome: 'Ruotato' });
    expect((await testoPagine(await d.save()))[0]).toContain('Ruotato');
  });

  it('firma PNG aggiunta a tutti (una sola immagine preparata nel modulo di base)', async () => {
    const base = await moduloProva();
    const modello = await modelloDaPdf(PDFLib, base);
    const out = [];
    await generaSerie({ PDFLib, base, modello, records: records.slice(0, 3), opzioni: { firma: { bytes: PNG, posizione: { pagina: -1, rect: [400, 50, 550, 110] } } }, onGruppo: async (g) => out.push(...g) });
    expect(out).toHaveLength(3);
    for (const e of out) {
      const d = await PDFLib.PDFDocument.load(e.bytes);
      const xo = d.getPage(0).node.Resources().lookup(PDFLib.PDFName.of('XObject'));
      const immagini = xo ? xo.keys().filter((k) => d.context.lookup(xo.get(k)).dict.get(PDFLib.PDFName.of('Subtype'))?.toString() === '/Image') : [];
      expect(immagini.length).toBe(1);
    }
  });

  it('interruzione a metà: si ferma, tiene gli esiti fatti, niente PDF unico', async () => {
    const base = await moduloProva();
    const modello = await modelloDaPdf(PDFLib, base);
    const signal = { aborted: false };
    let fatti = 0;
    const r = await generaSerie({ PDFLib, base, modello, records, opzioni: { unico: true }, signal, onProgresso: (n) => { fatti = n; if (n === 40) signal.aborted = true; } });
    expect(r.interrotto).toBe(true);
    expect(r.esiti).toHaveLength(40);
    expect(fatti).toBe(40);
    expect(r.unico).toBeUndefined();
  });

  it('modulo AcroForm: campi rilevati anche con nomi gerarchici', async () => {
    const d = await PDFLib.PDFDocument.create(); const p = d.addPage();
    d.getForm().createTextField('anagrafica.cognome').addToPage(p, { x: 10, y: 10, width: 100, height: 20 });
    const campi = campiDaPdf(PDFLib, await PDFLib.PDFDocument.load(await d.save()));
    expect(campi).toEqual([{ nome: 'anagrafica.cognome', tipo: 'text' }]);
  });
});
