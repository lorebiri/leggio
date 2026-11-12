// Campi AcroForm: lettura/scrittura valori, creazione/modifica/eliminazione (Prepara modulo), casi limite.
import { describe, it, expect } from 'vitest';
import * as PDFLib from '@cantoo/pdf-lib';
import { readValues, writeValues, safeAppearances, countSignatures } from '../src/renderer/features/moduli/formtools.js';
import { applyFormChanges, removeWidget } from '../src/renderer/features/moduli/formeditor.js';
import { placement, localToPdf, todayIt, initialsOf, strokeWidths, smoothSegments, thinPoints, removeBackground, opaqueBounds, fitRectInPage, winAnsiSafe } from '../src/renderer/features/moduli/lib/geom.js';
import { createStore, memoryStorage, profileValueFor } from '../src/renderer/features/moduli/lib/store.js';

async function sampleForm() {
  const d = await PDFLib.PDFDocument.create();
  const p = d.addPage([595, 842]); d.addPage([595, 842]);
  const f = d.getForm();
  f.createTextField('nome').addToPage(p, { x: 50, y: 700, width: 200, height: 20 });
  const cf = f.createTextField('anagrafica.codice_fiscale'); cf.setMaxLength(16); cf.addToPage(p, { x: 50, y: 660, width: 200, height: 20 });
  f.createCheckBox('accetto').addToPage(p, { x: 50, y: 620, width: 14, height: 14 });
  const rg = f.createRadioGroup('mezzo'); rg.addOptionToPage('treno', p, { x: 50, y: 580, width: 14, height: 14 }); rg.addOptionToPage('auto', p, { x: 100, y: 580, width: 14, height: 14 });
  const dd = f.createDropdown('sede'); dd.setOptions(['Pisa', 'Firenze']); dd.addToPage(p, { x: 50, y: 540, width: 120, height: 20 });
  const ol = f.createOptionList('lingue'); ol.setOptions(['it', 'en', 'fr']); ol.enableMultiselect(); ol.addToPage(p, { x: 50, y: 470, width: 120, height: 60 });
  return PDFLib.PDFDocument.load(await d.save());
}

describe('valori dei campi', () => {
  it('scrittura e lettura di tutti i tipi, con riapertura', async () => {
    const d = await sampleForm();
    const r = writeValues(PDFLib, d, { nome: 'Maria Rossì', 'anagrafica.codice_fiscale': 'RSSMRA80A01H501UXXXX', accetto: 'Sì', mezzo: 'auto', sede: 'Firenze', lingue: ['it', 'fr'], inesistente: 'x' });
    expect(r.set).toBe(6);
    expect(r.missing).toEqual(['inesistente']);
    await safeAppearances(PDFLib, d, d.getForm());
    const d2 = await PDFLib.PDFDocument.load(await d.save());
    const { values } = readValues(PDFLib, d2);
    expect(values).toMatchObject({ nome: 'Maria Rossì', 'anagrafica.codice_fiscale': 'RSSMRA80A01H501U', accetto: true, mezzo: 'auto', sede: 'Firenze', lingue: ['it', 'fr'] });
  });
  it('valori non previsti segnalati, non bloccanti; testo non codificabile', async () => {
    const d = await sampleForm();
    const r = writeValues(PDFLib, d, { mezzo: 'aereo', sede: 'Roma', nome: 'Ελληνικά 漢字', accetto: false });
    expect(r.failed.sort()).toEqual(['mezzo', 'sede']);
    await safeAppearances(PDFLib, d, d.getForm()); // il font standard non disegna il greco: non deve bloccare
    const d2 = await PDFLib.PDFDocument.load(await d.save());
    expect(readValues(PDFLib, d2).values.nome).toBe('Ελληνικά 漢字');
  });
  it('documento senza modulo', async () => {
    const d = await PDFLib.PDFDocument.create(); d.addPage();
    expect(readValues(PDFLib, d).values).toEqual({});
    expect(writeValues(PDFLib, d, { a: 'b' }).missing).toEqual(['a']);
  });
  it('modulo con centinaia di campi e nomi gerarchici', async () => {
    const d = await PDFLib.PDFDocument.create(); const f = d.getForm();
    const pages = Array.from({ length: 10 }, () => d.addPage([595, 842]));
    for (let i = 0; i < 600; i++) f.createTextField(`sezione${i % 6}.riga${i}`).addToPage(pages[i % 10], { x: 20 + (i % 3) * 180, y: 20 + ((i / 3) % 40) * 20, width: 170, height: 16 });
    const t0 = Date.now();
    const data = {}; for (let i = 0; i < 600; i++) data[`sezione${i % 6}.riga${i}`] = 'valore ' + i;
    expect(writeValues(PDFLib, d, data).set).toBe(600);
    await safeAppearances(PDFLib, d, d.getForm());
    const d2 = await PDFLib.PDFDocument.load(await d.save());
    expect(Object.keys(readValues(PDFLib, d2).values)).toHaveLength(600);
    expect(Date.now() - t0).toBeLessThan(15000);
  }, 30000);
  it('campi malformati (senza /FT, /Kids rotti) non fanno fallire la lettura', async () => {
    const d = await sampleForm();
    const ctx = d.context; const acro = d.catalog.lookup(PDFLib.PDFName.of('AcroForm'));
    const fields = acro.lookup(PDFLib.PDFName.of('Fields'));
    fields.push(ctx.register(ctx.obj({ T: PDFLib.PDFString.of('strano') })));
    fields.push(ctx.register(ctx.obj({ T: PDFLib.PDFString.of('rotto'), FT: 'Tx', Kids: [PDFLib.PDFRef.of(99999)] })));
    const d2 = await PDFLib.PDFDocument.load(await d.save());
    const r = readValues(PDFLib, d2);
    expect(r.values.nome).toBe('');
    expect(r.skipped).toBeGreaterThanOrEqual(1);
    expect(writeValues(PDFLib, d2, { nome: 'ok' }).set).toBe(1);
  });
});

describe('prepara modulo: applyFormChanges', () => {
  it('crea tutti i tipi di campo, con formato e proprietà', async () => {
    const d = await PDFLib.PDFDocument.create(); d.addPage([595, 842]);
    const mk = (kind, name, rect, props = {}) => ({ kind, name, pageIndex: 0, rect, existing: null, dirty: true, props: { required: false, readOnly: false, multiline: false, maxLen: 0, align: 0, fontSize: 0, font: 'Helv', defaultValue: '', options: [], exportValue: 'Sì', label: '', format: 'none', ...props } });
    const items = [
      mk('text', 'importo', [50, 700, 200, 720], { format: 'number', required: true, align: 2, maxLen: 12, defaultValue: '0,00' }),
      mk('text', 'note', [50, 600, 300, 680], { multiline: true, font: 'Cour', fontSize: 10 }),
      mk('checkbox', 'ok', [50, 560, 64, 574], { defaultValue: 'on' }),
      mk('radio', 'scelta', [50, 520, 64, 534], { exportValue: 'A' }), mk('radio', 'scelta', [80, 520, 94, 534], { exportValue: 'B' }),
      mk('dropdown', 'sede', [50, 480, 200, 500], { options: ['Pisa', 'Firenze'], defaultValue: 'Pisa' }),
      mk('listbox', 'lingue', [50, 400, 200, 460], { options: ['it', 'en'] }),
      mk('button', 'invia', [50, 360, 140, 384], { label: 'Invia' }),
      mk('signature', 'firma', [300, 100, 500, 150]),
      mk('text', 'importo', [50, 300, 200, 320]), // nome duplicato → rinominato
    ];
    const r = await applyFormChanges(PDFLib, d, items, []);
    expect(r.problems).toEqual([]);
    const d2 = await PDFLib.PDFDocument.load(await d.save());
    const f = d2.getForm();
    expect(f.getFields().map((x) => x.getName()).sort()).toEqual(['firma', 'importo', 'importo_2', 'invia', 'lingue', 'note', 'ok', 'scelta', 'sede'].sort());
    expect(f.getTextField('importo').isRequired()).toBe(true);
    expect(f.getTextField('importo').getMaxLength()).toBe(12);
    expect(f.getTextField('importo').acroField.dict.lookup(PDFLib.PDFName.of('AA')).toString()).toContain('AFNumber_Format(2, 2');
    expect(f.getTextField('note').isMultiline()).toBe(true);
    expect(f.getCheckBox('ok').isChecked()).toBe(true);
    expect(f.getRadioGroup('scelta').getOptions()).toEqual(['A', 'B']);
    expect(f.getDropdown('sede').getSelected()).toEqual(['Pisa']);
    expect(f.getField('firma')).toBeInstanceOf(PDFLib.PDFSignature);
  });
  it('modifica, rinomina ed elimina campi esistenti (anche widget di un gruppo)', async () => {
    const d = await sampleForm();
    const pages = d.getPages();
    const widRef = (name, i = 0) => { const f = d.getForm().getField(name); const w = f.acroField.getWidgets()[i]; return [...d.context.enumerateIndirectObjects()].find(([, o]) => o === w.dict)[0]; };
    const nomeRef = widRef('nome'); const autoRef = widRef('mezzo', 1); const ccRef = widRef('accetto');
    const ex = (ref) => ({ num: ref.objectNumber, gen: ref.generationNumber });
    const items = [{ kind: 'text', name: 'nominativo', origName: 'nome', pageIndex: 0, rect: [60, 710, 300, 730], existing: ex(nomeRef), dirty: true, props: { required: true, readOnly: true, multiline: false, maxLen: 30, align: 1, fontSize: 11, font: 'TiRo', defaultValue: 'X', format: 'date', options: [] } }];
    const deleted = [{ name: 'mezzo', existing: ex(autoRef), pageIndex: 0 }, { name: 'accetto', existing: ex(ccRef), pageIndex: 0 }];
    const r = await applyFormChanges(PDFLib, d, items, deleted);
    expect(r.problems).toEqual([]);
    const d2 = await PDFLib.PDFDocument.load(await d.save());
    const f = d2.getForm();
    const names = f.getFields().map((x) => x.getName());
    expect(names).toContain('nominativo');
    expect(names).not.toContain('accetto');
    expect(f.getRadioGroup('mezzo').acroField.getWidgets()).toHaveLength(1);
    const t = f.getTextField('nominativo');
    expect(t.isRequired()).toBe(true); expect(t.isReadOnly()).toBe(true); expect(t.getMaxLength()).toBe(30);
    expect(t.acroField.getWidgets()[0].getRectangle()).toEqual({ x: 60, y: 710, width: 240, height: 20 });
    expect(pages.length).toBe(2);
    // annotazioni della pagina: il widget eliminato non c'è più
    const annots = d2.getPages()[0].node.lookup(PDFLib.PDFName.of('Annots'));
    expect(annots.asArray().some((a) => a.objectNumber === ccRef.objectNumber)).toBe(false);
  });
  it('riferimenti inesistenti non fanno fallire', async () => {
    const d = await sampleForm();
    expect(removeWidget(PDFLib, d, { num: 99999, gen: 0 }, 0)).toBe(false);
    const r = await applyFormChanges(PDFLib, d, [{ kind: 'text', name: 'x', origName: 'x', pageIndex: 0, rect: [0, 0, 10, 10], existing: { num: 99998, gen: 0 }, dirty: true, props: {} }], []);
    expect(r.problems[0]).toMatch(/non trovato/);
  });
});

describe('geometria e firma grafica', () => {
  it('posizionamento con rotazione della pagina', () => {
    expect(placement([10, 20, 110, 70], 0)).toEqual({ x: 10, y: 20, w: 100, h: 50, rotate: 0 });
    expect(placement([10, 20, 110, 70], 90)).toEqual({ x: 110, y: 20, w: 50, h: 100, rotate: 90 });
    expect(placement([10, 20, 110, 70], 180)).toEqual({ x: 110, y: 70, w: 100, h: 50, rotate: 180 });
    expect(placement([10, 20, 110, 70], 270)).toEqual({ x: 10, y: 70, w: 50, h: 100, rotate: 270 });
    expect(placement([110, 70, 10, 20], -90).rotate).toBe(270);
    // l'angolo visivo in alto a destra cade dentro il rettangolo per ogni rotazione
    for (const r of [0, 90, 180, 270]) {
      const pl = placement([10, 20, 110, 70], r); const p = localToPdf(pl, pl.w, pl.h);
      expect(p.x).toBeGreaterThanOrEqual(10); expect(p.x).toBeLessThanOrEqual(110); expect(p.y).toBeGreaterThanOrEqual(20); expect(p.y).toBeLessThanOrEqual(70);
    }
  });
  it('utilità di testo', () => {
    expect(todayIt(new Date(2026, 0, 5))).toBe('05/01/2026');
    expect(initialsOf('maria grazia Rossi')).toBe('M.G.R.');
    expect(initialsOf('')).toBe('');
    expect(winAnsiSafe('Città “bella” ✓ 漢', (c) => c.charCodeAt(0) < 256)).toBe('Città "bella" v ?');
  });
  it('tratti della firma: spessore secondo la velocità, curve morbide', () => {
    const pts = [{ x: 0, y: 0, t: 0 }, { x: 1, y: 0, t: 10 }, { x: 80, y: 0, t: 20 }, { x: 160, y: 0, t: 30 }];
    const w = strokeWidths(pts, { min: 1, max: 4 });
    expect(w).toHaveLength(4); expect(w[3]).toBeLessThan(w[1]);
    expect(smoothSegments([{ x: 1, y: 1 }], [2])[0].dot).toBe(true);
    expect(smoothSegments(pts, w)).toHaveLength(3);
    expect(smoothSegments([], [])).toEqual([]);
    expect(thinPoints([{ x: 0, y: 0 }, { x: 0.1, y: 0 }, { x: 0.2, y: 0 }, { x: 5, y: 0 }])).toHaveLength(2);
  });
  it('sfondo della firma scansionata reso trasparente e ritaglio', () => {
    const w = 20; const h = 10; const data = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) { data.set([245, 243, 238, 255], i * 4); }
    for (let x = 5; x < 15; x++) data.set([20, 20, 30, 255], (5 * w + x) * 4); // tratto d'inchiostro
    removeBackground(data, w, h);
    expect(data[3]).toBe(0);
    expect(data[(5 * w + 7) * 4 + 3]).toBe(255);
    expect(opaqueBounds(data, w, h)).toEqual({ x: 5, y: 5, w: 10, h: 1 });
    expect(opaqueBounds(new Uint8ClampedArray(16), 2, 2)).toBe(null);
  });
  it('riquadro dentro la pagina', () => {
    expect(fitRectInPage(590, 10, 100, 40, [0, 0, 595, 842])).toEqual([495, 0, 595, 40]);
  });
});

describe('archivio locale e profilo', () => {
  it('firme salvate: ordine, limite, rimozione, dati non validi', () => {
    const s = createStore(memoryStorage());
    for (let i = 0; i < 15; i++) s.add({ kind: 'signature', dataUrl: 'data:image/png;base64,AAA' + i, w: 10, h: 5 });
    s.add({ kind: 'initials', dataUrl: 'data:image/png;base64,BBB' });
    expect(s.list('signature')).toHaveLength(12);
    expect(s.list('signature')[0].dataUrl).toBe('data:image/png;base64,AAA14');
    expect(s.list('initials')).toHaveLength(1);
    const last = s.list('signature')[5]; s.touch(last.id); expect(s.list('signature')[0].id).toBe(last.id);
    s.remove(last.id); expect(s.list('signature')).toHaveLength(11);
    expect(() => s.add({ dataUrl: 'javascript:alert(1)' })).toThrow(/non valida/);
    expect(() => s.add({ dataUrl: 'data:image/png;base64,' + 'A'.repeat(4 * 1024 * 1024) })).toThrow(/troppo grande/);
  });
  it('archivio corrotto o pieno', () => {
    const st = memoryStorage(); st.setItem('leggio.moduli.firme.v1', '{rotto'); st.setItem('leggio.moduli.profilo.v1', '[1,2]');
    const s = createStore(st);
    expect(s.list()).toEqual([]); expect(s.getProfile()).toEqual({});
    const full = { getItem: () => null, setItem: () => { throw new Error('QuotaExceeded'); } };
    expect(() => createStore(full).add({ dataUrl: 'data:image/png;base64,A' })).toThrow(/Spazio esaurito/);
  });
  it('profilo: salvataggio e riconoscimento dei campi', () => {
    const s = createStore(memoryStorage());
    s.setProfile({ nome: ' Maria ', cognome: 'Rossi', codiceFiscale: 'RSSMRA80A41H501X', ufficio: 'Amministrazione', ignoto: 'x', email: '' });
    const p = s.getProfile();
    expect(p).toEqual({ nome: 'Maria', cognome: 'Rossi', codiceFiscale: 'RSSMRA80A41H501X', ufficio: 'Amministrazione' });
    expect(profileValueFor('Codice_Fiscale', p)?.value).toBe('RSSMRA80A41H501X');
    expect(profileValueFor('nome_e_cognome', p)?.value).toBe('Maria Rossi');
    expect(profileValueFor('Cognome', p)?.value).toBe('Rossi');
    expect(profileValueFor('nome', p)?.value).toBe('Maria');
    expect(profileValueFor('Ufficio di appartenenza', p)?.value).toBe('Amministrazione');
    expect(profileValueFor('data', p, '12/11/2026')?.value).toBe('12/11/2026');
    expect(profileValueFor('data_nascita', p, '12/11/2026')).toBe(null);
    expect(profileValueFor('importo', p)).toBe(null);
    expect(profileValueFor('', p)).toBe(null);
  });
});

describe('conteggio firme', () => {
  it('trova i /ByteRange nei byte', () => {
    const enc = new TextEncoder();
    expect(countSignatures(enc.encode('%PDF /ByteRange [0 1 2 3] ... /ByteRange[0 1 2 3] /ByteRang'))).toBe(2);
    expect(countSignatures(new Uint8Array(0))).toBe(0);
    expect(countSignatures(null)).toBe(0);
  });
});
