// Bug segnalato: Leggio «cambiava l'estensione» dei .p7m e su Windows comparivano come documenti PDF.
// Il file firmato originale non va MAI riscritto, rinominato o sostituito: il PDF contenuto si apre in
// memoria e una copia si salva solo con «Salva come», con un nome distinto.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { destinazione, nomeUscitaFirmato } from '../src/renderer/features/avanzati/lib/batch-ops.js';
import { innerName } from '../src/renderer/features/avanzati/lib/cades.js';

const require = createRequire(import.meta.url);
const { safeWrite, isSignedEnvelopePath } = require('../electron/core/safe-write.cjs');
const { _test: av } = require('../electron/features/avanzati.cjs');
const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

let dir;
beforeAll(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'leggio-p7m-')); });
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('il file firmato originale non si tocca', () => {
  it('safeWrite rifiuta di sovrascrivere un .p7m/.p7s/.m7m/.tsd esistente', async () => {
    for (const ext of ['p7m', 'P7M', 'p7s', 'm7m', 'tsd']) {
      const p = path.join(dir, `contratto.pdf.${ext}`);
      fs.writeFileSync(p, 'BUSTA-FIRMATA');
      await expect(safeWrite(p, Buffer.from('%PDF-1.7 contenuto'))).rejects.toThrow(/firmato/);
      expect(fs.readFileSync(p, 'utf8')).toBe('BUSTA-FIRMATA');
    }
    // un .p7m NUOVO (firma appena creata) si scrive normalmente
    const nuovo = path.join(dir, 'nuovo.pdf.p7m');
    await safeWrite(nuovo, Buffer.from('x'));
    expect(fs.existsSync(nuovo)).toBe(true);
    expect(isSignedEnvelopePath('a.pdf.p7m')).toBe(true);
    expect(isSignedEnvelopePath('a.pdf')).toBe(false);
  });

  it('«Azioni guidate › Sostituisci gli originali» non scrive il PDF sopra il .p7m', async () => {
    const src = path.join(dir, 'fattura.xml.p7m');
    fs.writeFileSync(src, 'BUSTA');
    const it0 = { path: src, name: 'fattura.xml.p7m' };
    const d = destinazione(it0, { dest: 'overwrite' });
    // per i file firmati niente sovrascrittura: copia accanto con nome distinto
    expect(d.overwrite).toBe(false);
    const name = nomeUscitaFirmato(it0.name);
    expect(name).toBe('fattura (da p7m).pdf');
    av.allow(dir);
    const out = await av.writeAllowed({ folder: d.folder, sub: d.sub, name, bytes: new Uint8Array([37, 80, 68, 70]), overwrite: d.overwrite });
    expect(path.basename(out)).toBe('fattura (da p7m).pdf');
    expect(fs.readFileSync(src, 'utf8')).toBe('BUSTA');
    // anche chiedendo esplicitamente la sovrascrittura del .p7m, il main rifiuta
    await expect(av.writeAllowed({ folder: dir, name: 'fattura.xml.p7m', bytes: new Uint8Array([1]), overwrite: true })).rejects.toThrow(/firmato/);
    expect(fs.readFileSync(src, 'utf8')).toBe('BUSTA');
  });

  it('i PDF normali continuano a essere sostituiti con «Sostituisci gli originali»', () => {
    const d = destinazione({ path: path.join(dir, 'a.pdf'), name: 'a.pdf' }, { dest: 'overwrite' });
    expect(d.overwrite).toBe(true);
  });

  it('il nome della copia del contenuto è distinto dal file firmato', () => {
    expect(innerName('contratto.pdf.p7m', 'pdf')).toBe('contratto.pdf');
    expect(nomeUscitaFirmato('contratto.pdf.p7m')).toBe('contratto (da p7m).pdf');
    expect(nomeUscitaFirmato('contratto.pdf.p7m.p7m')).toBe('contratto (da p7m).pdf');
    expect(nomeUscitaFirmato('IT0123_00001.xml.p7m')).toBe('IT0123_00001 (da p7m).pdf');
  });
});

describe('associazioni dei file nell\'installer', () => {
  const b = pkg.build;
  it('nessuna associazione globale che valga per Windows con l\'icona dell\'app', () => {
    // le associazioni globali finiscono anche nell'installer NSIS (APP_ASSOCIATE con l'icona del programma,
    // la stessa dei PDF): su Windows le registra build/installer.nsh con ProgID e icone distinte
    expect(b.fileAssociations).toBeUndefined();
    expect(b.win.fileAssociations).toBeUndefined();
    expect(b.nsis.include).toBe('build/installer.nsh');
  });
  it('su macOS il .p7m ha nome, tipo e icona propri (non «Documento PDF»)', () => {
    const fa = b.mac.fileAssociations;
    const p7m = fa.find((x) => [].concat(x.ext).includes('p7m'));
    const pdf = fa.find((x) => [].concat(x.ext).includes('pdf'));
    expect(p7m.name).not.toMatch(/PDF/);
    expect(p7m.mimeType).toBe('application/pkcs7-mime');
    expect(p7m.icon).toBe('build/p7m');
    expect(pdf.ext).toBe('pdf');
    expect(fs.existsSync(new URL('../build/p7m.icns', import.meta.url))).toBe(true);
  });
  it('installer.nsh: ProgID distinti, icona p7m propria, nessun «PDF» nel tipo del .p7m', () => {
    const nsh = fs.readFileSync(new URL('../build/installer.nsh', import.meta.url), 'utf8');
    expect(nsh).toMatch(/Leggio\.FirmatoP7M/);
    expect(nsh).toMatch(/Leggio\.PDF/);
    expect(fs.existsSync(new URL('../build/p7m.ico', import.meta.url))).toBe(true);
    // la classe del .p7m ha la descrizione del documento firmato e l'icona p7m.ico
    const blocco = nsh.split('Leggio.FirmatoP7M').slice(1).join('');
    expect(blocco).toMatch(/Documento firmato digitalmente/);
    expect(nsh).toMatch(/p7m\.ico/);
    // il .p7m non viene mai registrato con la classe dei PDF
    expect(nsh).not.toMatch(/\.p7m[^\n]*Leggio\.PDF/);
    // disinstallazione: si tolgono le chiavi aggiunte
    expect(nsh).toMatch(/customUnInstall/);
  });
});
