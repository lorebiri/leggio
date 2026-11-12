import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { _test: m } = require('../electron/features/archivio.cjs');

const radice = fs.mkdtempSync(path.join(os.tmpdir(), 'leggio-arch-'));
let dati; let docs;
afterAll(() => fs.rmSync(radice, { recursive: true, force: true }));
beforeEach(() => {
  const k = crypto.randomBytes(4).toString('hex');
  dati = path.join(radice, 'dati-' + k); docs = path.join(radice, 'docs-' + k);
  fs.mkdirSync(path.join(docs, 'Fatture', '2026'), { recursive: true });
  fs.mkdirSync(path.join(docs, 'Elaborati'), { recursive: true });
  fs.writeFileSync(path.join(docs, 'Fatture', '2026', 'f1.pdf'), '%PDF-1.4 uno');
  fs.writeFileSync(path.join(docs, 'Fatture', 'fattura.xml'), '<x/>');
  fs.writeFileSync(path.join(docs, 'nota.txt'), 'non indicizzata');
  fs.writeFileSync(path.join(docs, '.nascosto.pdf'), '%PDF');
  fs.writeFileSync(path.join(docs, '~$temp.pdf'), '%PDF');
  m.init(dati);
});

describe('modulo main «archivio»', () => {
  it('collega le cartelle, evita doppioni e cartelle annidate', async () => {
    const r = await m.aggiungiCartella(docs);
    expect(r.cartella.percorso).toBe(path.resolve(docs));
    expect((await m.aggiungiCartella(docs)).avviso).toMatch(/già collegata/);
    expect((await m.aggiungiCartella(path.join(docs, 'Fatture'))).avviso).toMatch(/già compresa/);
    // una cartella che contiene quella collegata la sostituisce
    m.init(dati);
    await m.aggiungiCartella(path.join(docs, 'Fatture'));
    const r2 = await m.aggiungiCartella(docs);
    expect(r2.assorbite).toHaveLength(1);
    expect(m.S.config.cartelle).toHaveLength(1);
    // la configurazione è sul disco
    m.S.config = { cartelle: [] };
    m.leggiConfig();
    expect(m.S.config.cartelle).toHaveLength(1);
    await expect(m.aggiungiCartella(path.join(docs, 'non-esiste'))).rejects.toThrow(/non è raggiungibile/);
  });

  it('scansiona solo i tipi di documento, salta nascosti e temporanei', async () => {
    const { cartella } = await m.aggiungiCartella(docs);
    const s = await m.scansiona({ id: cartella.id });
    expect(s.raggiungibile).toBe(true);
    expect(s.file.map((f) => f[0].split(path.sep).join('/')).sort()).toEqual(['Fatture/2026/f1.pdf', 'Fatture/fattura.xml']);
    expect(s.file[0][1]).toBeGreaterThan(0);
  });

  it('cartella non raggiungibile: segnalata, senza errori', async () => {
    const { cartella } = await m.aggiungiCartella(docs);
    fs.renameSync(docs, docs + '-via');
    try {
      const s = await m.scansiona({ id: cartella.id });
      expect(s.raggiungibile).toBe(false);
      expect(s.errore).toMatch(/non è raggiungibile.*L'indice resta/);
    } finally { fs.renameSync(docs + '-via', docs); }
  });

  it('legge con impronta SHA-256 solo dentro le cartelle collegate', async () => {
    await m.aggiungiCartella(docs);
    const p = path.join(docs, 'Fatture', '2026', 'f1.pdf');
    const r = await m.leggi({ path: p });
    expect(r.impronta).toBe(crypto.createHash('sha256').update('%PDF-1.4 uno').digest('hex'));
    expect(Buffer.from(r.bytes).toString()).toBe('%PDF-1.4 uno');
    const g = await m.leggi({ path: p, maxBytes: 4 });
    expect(g).toMatchObject({ bytes: null, troppoGrande: true, impronta: r.impronta });
    await expect(m.leggi({ path: '/etc/hosts' })).rejects.toThrow(/cartella collegata/);
    await expect(m.leggi({ path: path.join(docs, '..', 'altro.pdf') })).rejects.toThrow(/cartella collegata/);
    await expect(m.leggi({ path: 'relativo.pdf' })).rejects.toThrow(/non valido/);
  });

  it('indice: scrittura atomica, blocchi orfani eliminati dopo un\'interruzione', async () => {
    const man = { formato: 'leggio-archivio-indice', versione: 1, seq: 2, blocchi: [{ chiave: 'k1', file: 'b-k1-1.ndjson', n: 1 }] };
    await m.indiceScrivi({ scrivi: [{ file: 'b-k1-1.ndjson', testo: '{"id":"a"}\n' }], manifesto: man, elimina: [] });
    expect(await m.indiceBlocco({ file: 'b-k1-1.ndjson' })).toBe('{"id":"a"}\n');
    // interruzione: blocco nuovo scritto ma manifesto non aggiornato + temporaneo rimasto
    fs.writeFileSync(path.join(dati, 'indice', 'b-k1-9.ndjson'), '{"id":"mezzo"}');
    fs.writeFileSync(path.join(dati, 'indice', '.manifesto.json.abcd.leggio-tmp'), '{');
    const r = await m.indiceManifesto();
    expect(r.manifesto.blocchi[0].file).toBe('b-k1-1.ndjson');
    expect(r.orfani).toBe(2);
    expect(fs.existsSync(path.join(dati, 'indice', 'b-k1-9.ndjson'))).toBe(false);
    // sostituzione: il vecchio blocco va via solo dopo il manifesto nuovo
    await m.indiceScrivi({ scrivi: [{ file: 'b-k1-3.ndjson', testo: '{"id":"a2"}\n' }], manifesto: { ...man, blocchi: [{ chiave: 'k1', file: 'b-k1-3.ndjson', n: 1 }] }, elimina: ['b-k1-1.ndjson'] });
    expect(fs.readdirSync(path.join(dati, 'indice')).sort()).toEqual(['b-k1-3.ndjson', 'manifesto.json']);
    await expect(m.indiceBlocco({ file: '../config.json' })).rejects.toThrow(/non valido/);
    await expect(m.indiceScrivi({ scrivi: [{ file: '../x', testo: '' }], manifesto: man, elimina: [] })).rejects.toThrow(/non valido/);
  });

  it('stati: copia di riserva e ripiego se il file è rovinato', async () => {
    await m.statiScrivi({ testo: '{"stati":{"v":1}}' });
    await m.statiScrivi({ testo: '{"stati":{"v":2}}' });
    expect(JSON.parse(fs.readFileSync(path.join(dati, 'stati.json.bak'), 'utf8')).stati.v).toBe(1);
    fs.writeFileSync(path.join(dati, 'stati.json'), '{rovinato');
    const r = await m.statiLeggi();
    expect(r).toMatchObject({ riserva: true });
    expect(JSON.parse(r.testo).stati.v).toBe(1);
    await expect(m.statiScrivi({ testo: '{non json' })).rejects.toThrow();
  });

  it('copie: mai sopra un file esistente, sempre dentro «Elaborati» o una cartella scelta', async () => {
    await m.aggiungiCartella(docs);
    const orig = path.join(docs, 'Fatture', '2026', 'f1.pdf');
    const p1 = await m.scriviCopia({ origine: orig, sotto: 'Elaborati', nome: 'f1.pdf', bytes: new Uint8Array([1, 2]) });
    const p2 = await m.scriviCopia({ origine: orig, sotto: 'Elaborati', nome: 'f1.pdf', bytes: new Uint8Array([3]) });
    expect(p1).toBe(path.join(docs, 'Fatture', '2026', 'Elaborati', 'f1.pdf'));
    expect(p2).toBe(path.join(docs, 'Fatture', '2026', 'Elaborati', 'f1 (2).pdf'));
    expect(fs.readFileSync(orig, 'utf8')).toBe('%PDF-1.4 uno');
    const p3 = await m.scriviCopia({ origine: orig, sotto: '../../..', nome: '../evil.pdf', bytes: new Uint8Array([1]) });
    expect(p3.startsWith(path.join(docs, 'Fatture', '2026'))).toBe(true);
    const c = await m.copiaFile({ path: orig, sotto: 'Rinominati', nome: 'Fattura_ALFA_n1.pdf' });
    expect(fs.readFileSync(c, 'utf8')).toBe('%PDF-1.4 uno');
    await expect(m.scriviCopia({ cartella: os.tmpdir(), nome: 'x.pdf', bytes: new Uint8Array([1]) })).rejects.toThrow(/Scegli di nuovo/);
  });

  it('cancella l\'indice (e, se richiesto, anche stati e cartelle)', async () => {
    await m.aggiungiCartella(docs);
    await m.indiceScrivi({ scrivi: [{ file: 'b-k1-1.ndjson', testo: '{"id":"a"}\n' }], manifesto: { formato: 'leggio-archivio-indice', blocchi: [] }, elimina: [] });
    await m.statiScrivi({ testo: '{}' });
    await m.cancellaIndice({});
    expect(fs.existsSync(path.join(dati, 'indice'))).toBe(false);
    expect(fs.existsSync(path.join(dati, 'stati.json'))).toBe(true);
    await m.cancellaIndice({ anche: 'tutto' });
    expect(fs.existsSync(path.join(dati, 'stati.json'))).toBe(false);
    expect(m.S.config.cartelle).toHaveLength(0);
  });
});
