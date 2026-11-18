// I moduli del main delle aree (electron/features/*.cjs) devono rispettare gli stessi permessi del
// nucleo: un renderer compromesso non può leggere, elencare o scrivere file fuori dalle cartelle
// scelte dall'utente, né sovrascrivere un file aperto in sola lettura, né far avviare programmi.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'node:module';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const require = createRequire(import.meta.url);
const { createGrants } = require('../electron/core/grants.cjs');

let dir; let fuori; let scelta;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'leggio-permessi-'));
  fuori = join(dir, 'fuori'); scelta = join(dir, 'scelta');
  mkdirSync(fuori); mkdirSync(scelta);
  writeFileSync(join(fuori, 'segreto.pdf'), '%PDF segreto');
  writeFileSync(join(scelta, 'scansione.pdf'), '%PDF scansione');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function carica(file, extra = {}) {
  const handlers = {};
  const grants = createGrants();
  const ipcMain = { removeHandler() {}, handle: (c, f) => { handlers[c] = f; } };
  const app = { getPath: () => join(dir, 'ud') };
  require(file).register({ ipcMain, app, dialog: {}, getWindow: () => null, BrowserWindow: null, grants, ...extra });
  return { handlers, grants };
}

describe('underFolder / canUse', () => {
  it('dentro la cartella scelta sì, fuori no; «..bozze» è una cartella vera', () => {
    const g = createGrants({ caseInsensitive: false });
    g.grantFolder('/A/scelta');
    expect(g.underFolder('/A/scelta')).toBe(true);
    expect(g.underFolder('/A/scelta/sub/x.pdf')).toBe(true);
    expect(g.underFolder('/A/scelta/..bozze/x.pdf')).toBe(true);
    expect(g.underFolder('/A/scelta/../altro.pdf')).toBe(false);
    expect(g.underFolder('/A/sceltaaltro/x.pdf')).toBe(false);
    expect(g.canUse('/B/y.pdf')).toBe(false);
    g.grantFile('/B/y.pdf');
    expect(g.canUse('/B/y.pdf')).toBe(true);
  });
});

describe('conversione (OCR di una cartella)', () => {
  const MOD = '../electron/features/conversione.cjs';
  it('fuori dalle cartelle scelte: niente lettura, elenco, esistenza né scrittura', async () => {
    const { handlers: h } = carica(MOD);
    const ev = {};
    await expect(h['feat:conversione:leggi'](ev, join(fuori, 'segreto.pdf'))).rejects.toThrow(/scelt/);
    await expect(h['feat:conversione:elenca'](ev, { cartella: fuori })).rejects.toThrow(/scelt/);
    await expect(h['feat:conversione:esiste'](ev, join(fuori, 'segreto.pdf'))).rejects.toThrow(/scelt/);
    await expect(h['feat:conversione:scrivi'](ev, { percorso: join(fuori, 'segreto.pdf'), bytes: new Uint8Array([1]) })).rejects.toThrow(/scelt/);
    expect(readFileSync(join(fuori, 'segreto.pdf'), 'utf8')).toBe('%PDF segreto');
  });
  it('dentro la cartella scelta funziona; un file in sola lettura non si sovrascrive', async () => {
    const { handlers: h, grants } = carica(MOD);
    grants.grantFolder(scelta);
    const ev = {};
    const l = await h['feat:conversione:elenca'](ev, { cartella: scelta, escludi: 'non un elenco' });
    expect(l.map((x) => x.name)).toEqual(['scansione.pdf']);
    expect((await h['feat:conversione:leggi'](ev, join(scelta, 'scansione.pdf'))).length).toBe(14);
    const out = join(scelta, 'Leggio OCR', 'scansione.pdf');
    await h['feat:conversione:scrivi'](ev, { percorso: out, bytes: new TextEncoder().encode('%PDF nuovo') });
    expect(readFileSync(out, 'utf8')).toBe('%PDF nuovo');
    grants.setReadOnly(out, true);
    await expect(h['feat:conversione:scrivi'](ev, { percorso: out, bytes: new Uint8Array([1]) })).rejects.toThrow(/sola lettura/);
  });
});

describe('moduli: firma di file e programmi di firma', () => {
  const MOD = '../electron/features/moduli.cjs';
  it('sign-files rifiuta file non scelti dall’utente', async () => {
    const { handlers: h } = carica(MOD);
    const r = await h['feat:moduli:sign-files']({}, { paths: [join(fuori, 'segreto.pdf')], credential: { type: 'p12', p12: new Uint8Array([1]), password: 'x' } });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/scelt/);
  });
  it.skipIf(process.platform === 'win32')('l’elenco dei programmi di firma accetta solo applicazioni (.app/.exe), non /bin/sh', async () => {
    const { handlers: h } = carica(MOD);
    mkdirSync(join(dir, 'ud'), { recursive: true });
    writeFileSync(join(dir, 'ud', 'moduli-programmi-firma.json'), JSON.stringify([{ path: '/bin/sh', name: 'Dike' }]));
    const r = await h['feat:moduli:external-apps']({});
    expect(r.result.some((a) => a.name === 'Dike')).toBe(false);
  });
  it('external-sign con un percorso non scelto non lo usa (ne serve una copia)', async () => {
    const { handlers: h } = carica(MOD);
    const r = await h['feat:moduli:external-sign']({}, { appId: 'inesistente', path: join(fuori, 'segreto.pdf') });
    expect(r.ok).toBe(false);
    expect(existsSync(join(fuori, 'segreto.pdf'))).toBe(true);
  });
});

describe('avanzati: scrittura nella cartella scelta', () => {
  it('«Sostituisci gli originali» non sovrascrive un file aperto in sola lettura', async () => {
    const A = require('../electron/features/avanzati.cjs');
    const grants = createGrants();
    A.register({ ipcMain: { removeHandler() {}, handle() {} }, BrowserWindow: null, dialog: null, getWindow: () => null, grants });
    const t = A._test;
    t.allow(scelta);
    grants.setReadOnly(join(scelta, 'scansione.pdf'), true);
    await expect(t.writeAllowed({ folder: scelta, name: 'scansione.pdf', bytes: new Uint8Array([37, 80]), overwrite: true })).rejects.toThrow(/sola lettura/);
    expect(readFileSync(join(scelta, 'scansione.pdf'), 'utf8')).toBe('%PDF scansione');
    const out = await t.writeAllowed({ folder: scelta, name: 'nuovo.pdf', bytes: new TextEncoder().encode('%PDF x'), overwrite: true });
    expect(readFileSync(out, 'utf8')).toBe('%PDF x');
  });
  it('una sottocartella che inizia con «..» (es. «..bozze») è dentro la cartella scelta', () => {
    const t = require('../electron/features/avanzati.cjs')._test;
    t.allow(scelta);
    expect(t.isAllowed(join(scelta, '..bozze', 'x.pdf'))).toBe(true);
    expect(t.isAllowed(join(scelta, '..', 'x.pdf'))).toBe(false);
  });
});

describe('avanzati: HTML → PDF non legge altri file locali', () => {
  const { requestAllowed } = require('../electron/features/avanzati.cjs');
  const { pathToFileURL } = require('node:url');
  it('HTML generato: solo la pagina stessa, niente iframe file:// né rete', () => {
    const page = join(tmpdir(), 'leggio-html-x', 'pagina.html');
    const t = { file: page };
    expect(requestAllowed(t, { html: '<p>' }, pathToFileURL(page).href)).toBe(true);
    expect(requestAllowed(t, { html: '<p>' }, pathToFileURL(join(tmpdir(), 'segreto.txt')).href)).toBe(false);
    expect(requestAllowed(t, { html: '<p>' }, 'https://esempio.it/spia.png')).toBe(false);
    expect(requestAllowed(t, { html: '<p>' }, 'data:image/png;base64,AAAA')).toBe(true);
  });
  it('file HTML scelto: i file della sua cartella sì, gli altri no', () => {
    const page = join(scelta, 'pagina.html');
    const t = { file: page };
    expect(requestAllowed(t, { filePath: page }, pathToFileURL(join(scelta, 'img', 'a.png')).href)).toBe(true);
    expect(requestAllowed(t, { filePath: page }, pathToFileURL(join(fuori, 'segreto.pdf')).href)).toBe(false);
  });
  it('indirizzo web: niente file locali', () => {
    expect(requestAllowed({ url: 'https://esempio.it/' }, {}, 'https://esempio.it/a.css')).toBe(true);
    expect(requestAllowed({ url: 'https://esempio.it/' }, {}, 'file:///etc/passwd')).toBe(false);
  });
});
