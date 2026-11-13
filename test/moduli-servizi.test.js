// app.services.firmaFile: firma di un elenco di file già scelti (es. dall'archivio), canale feat:moduli:sign-files.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createRequire } from 'node:module';
import { readFileSync, mkdtempSync, writeFileSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { firmaFile } from '../src/renderer/features/moduli/digital.js';
import { createStore, memoryStorage } from '../src/renderer/features/moduli/lib/store.js';

const require = createRequire(import.meta.url);
const M = require('../electron/features/moduli.cjs');
const fixture = readFileSync(new URL('./fixtures/prova.pdf', import.meta.url));
const PW = 'segreta123';

/** Processo principale finto: registra i canali veri di moduli.cjs. */
function fakeMain() {
  const h = {}; const sent = [];
  // i file da firmare stanno in una cartella «scelta dall'utente» (come le cartelle dell'archivio)
  M.register({ pathAllowed: (p) => p.startsWith(dir), ipcMain: { handle: (c, f) => { h[c] = f; } }, dialog: { showOpenDialog: async () => { throw new Error('nessuna finestra deve aprirsi'); } }, getWindow: () => ({ webContents: { send: (c, p) => sent.push([c, p]) } }), app: { getPath: () => tmpdir() } });
  return { invoke: (ch, a) => h['feat:' + ch]({}, a), sent };
}
/** App finta: registra dialoghi, avvisi ed eventi. */
function fakeApp() {
  const ev = []; const dialogs = []; const toasts = [];
  return {
    ev, dialogs, toasts,
    bus: { emit: (n, p) => ev.push([n, p]) },
    ui: { withProgress: async (_t, fn) => fn({ set() {} }), dialog: async (o) => { dialogs.push(o.title); return null; }, toast: (m) => toasts.push(m), h: () => ({}) },
  };
}

let dir; let P12;
beforeAll(() => { dir = mkdtempSync(join(tmpdir(), 'leggio-serv-')); P12 = M.createSelfSignedId({ name: 'Anna Verdi', password: PW }); }, 30000);
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('canale feat:moduli:sign-files', () => {
  it('firma i file indicati, senza finestre, e valida gli argomenti', async () => {
    const { invoke } = fakeMain();
    const a = join(dir, 'a.pdf'); const b = join(dir, 'b.pdf'); writeFileSync(a, fixture); writeFileSync(b, fixture);
    const r = await invoke('moduli:sign-files', { credential: { type: 'p12', p12: P12, password: PW }, paths: [a, b, a, join(dir, 'manca.pdf')], options: { reason: 'Archivio' } });
    expect(r.ok).toBe(true);
    expect(r.result.results.map((x) => x.ok)).toEqual([true, true, false]);
    expect(r.result.results[0]).toMatchObject({ path: a, output: join(dir, 'a_firmato.pdf') });
    expect(r.result.results[2].error).toMatch(/non esiste più/);
    expect(readFileSync(a).equals(fixture)).toBe(true);
    expect((await M.verifyPdf(readFileSync(join(dir, 'b_firmato.pdf')))).signatures[0].signatureValid).toBe(true);
    // di nuovo: nessuna sovrascrittura
    const r2 = await invoke('moduli:sign-files', { credential: { type: 'p12', p12: P12, password: PW }, paths: [a] });
    expect(r2.result.results[0].output).toBe(join(dir, 'a_firmato (2).pdf'));
    expect((await invoke('moduli:sign-files', { credential: { type: 'p12', p12: P12, password: PW }, paths: [] })).error).toMatch(/Nessun file/);
    expect((await invoke('moduli:sign-files', { credential: { type: 'p12', p12: P12, password: PW }, paths: ['relativo.pdf'] })).error).toMatch(/non valido/);
    expect((await invoke('moduli:sign-files', { credential: { type: 'p12', p12: P12, password: PW }, paths: [5] })).error).toMatch(/non valido/);
    expect((await invoke('moduli:sign-files', { credential: { type: 'p12', p12: P12, password: 'no' }, paths: [a] })).error).toMatch(/Password/);
    expect((await invoke('moduli:sign-files', { credential: { type: 'p12', p12: P12, password: PW }, paths: Array(501).fill(a) })).error).toMatch(/500/);
  }, 60000);
});

describe('app.services.firmaFile', () => {
  const store = createStore(memoryStorage());
  const ask = (choice) => async () => (choice ? { format: choice.format || 'pdf', reason: 'Prova', credential: { type: 'p12', p12: P12, password: PW }, cert: { subject: 'Anna Verdi' } } : null);
  it('una sola scelta del certificato, rapporto per file, stato «firmato» per l\'archivio, nessuna finestra di esito se tutto va bene', async () => {
    const main = fakeMain(); const app = fakeApp(); let asked = 0;
    const f1 = join(dir, 'Determina 1.pdf'); const f2 = join(dir, 'Contratto.pdf'); writeFileSync(f1, fixture); writeFileSync(f2, fixture);
    const rep = await firmaFile(app, store, [{ path: f1, name: 'Determina 1.pdf' }, { path: f2, name: 'Contratto.pdf' }], { deps: { invoke: main.invoke, isDesktop: () => true, onProgress: () => () => {}, askCertificate: async (...a) => { asked++; return ask({})(...a); } } });
    expect(asked).toBe(1);
    expect(rep).toEqual([
      { path: f1, ok: true, uscita: join(dir, 'Determina 1_firmato.pdf'), errore: null },
      { path: f2, ok: true, uscita: join(dir, 'Contratto_firmato.pdf'), errore: null },
    ]);
    expect(app.ev.map(([n, p]) => [n, p.path, p.modifica.imposta])).toEqual([['archivio:stato', f1, 'firmato'], ['archivio:stato', f2, 'firmato']]);
    expect(app.dialogs).toEqual([]);
    expect(app.toasts[0]).toMatch(/Firmati 2 documenti/);
  }, 60000);
  it('.p7m, errori per file con finestra di esito, annullamento, elenco vuoto, browser', async () => {
    const main = fakeMain(); const app = fakeApp();
    const f = join(dir, 'nota.txt'); writeFileSync(f, 'testo');
    const deps = { invoke: main.invoke, isDesktop: () => true, onProgress: () => () => {}, askCertificate: ask({ format: 'p7m' }) };
    const rep = await firmaFile(app, store, [f, { path: join(dir, 'sparito.pdf') }], { deps });
    expect(rep[0]).toMatchObject({ path: f, ok: true, uscita: f + '.p7m' });
    expect(rep[1]).toMatchObject({ ok: false, uscita: null });
    expect(rep[1].errore).toMatch(/non esiste/);
    expect(app.dialogs).toEqual(['Firmati 1 file su 2']);
    expect(app.ev).toHaveLength(1);
    const ann = await firmaFile(fakeApp(), store, [f], { deps: { ...deps, askCertificate: async () => null } });
    expect(ann).toEqual([{ path: f, ok: false, uscita: null, errore: 'Firma annullata.' }]);
    expect(await firmaFile(fakeApp(), store, [], { deps })).toEqual([]);
    const web = fakeApp();
    const r = await firmaFile(web, store, [f], { deps: { ...deps, isDesktop: () => false } });
    expect(r[0].ok).toBe(false);
  }, 60000);
});

const runMac = process.platform === 'darwin' && process.env.LEGGIO_TEST_KEYCHAIN === '1' && existsSync('/usr/bin/security');
describe.skipIf(!runMac)('firmaFile con il portachiavi temporaneo (security cms)', () => {
  let kdir; let kc; let listBefore;
  const sec = (...a) => execFileSync('/usr/bin/security', a, { encoding: 'utf8' });
  beforeAll(() => {
    listBefore = sec('list-keychains', '-d', 'user');
    kdir = mkdtempSync(join(tmpdir(), 'leggio-kc-'));
    kc = join(kdir, 'leggio-prova.keychain-db');
    sec('create-keychain', '-p', 'prova-kc', kc); sec('unlock-keychain', '-p', 'prova-kc', kc);
    writeFileSync(join(kdir, 'id.p12'), P12);
    sec('import', join(kdir, 'id.p12'), '-k', kc, '-P', PW, '-T', '/usr/bin/security');
    try { sec('set-key-partition-list', '-S', 'apple-tool:,apple:', '-s', '-k', 'prova-kc', kc); } catch {}
    rmSync(join(kdir, 'id.p12'));
  }, 60000);
  afterAll(() => {
    try { sec('delete-keychain', kc); } catch {}
    rmSync(kdir, { recursive: true, force: true });
    expect(sec('list-keychains', '-d', 'user')).toBe(listBefore);
  });
  it('firma più documenti con l\'identità del portachiavi', async () => {
    const { ids } = await M.listSystemIds({ platform: 'darwin', keychain: kc });
    const signer = await M.resolveSigner({ type: 'system', id: ids[0].id }, { platform: 'darwin', keychain: kc });
    // il canale usa il portachiavi dell'utente: per la prova si collega lo stesso firmatario al servizio
    const invoke = async (ch, a) => {
      if (ch !== 'moduli:sign-files') throw new Error(ch);
      return { ok: true, result: { results: await M.signFilesWith(a.paths, signer, { ...a.options, format: a.format }) } };
    };
    const files = ['x.pdf', 'y.pdf'].map((n) => { const p = join(kdir, n); writeFileSync(p, fixture); return p; });
    const app = fakeApp();
    const rep = await firmaFile(app, createStore(memoryStorage()), files, { deps: { invoke, isDesktop: () => true, onProgress: () => () => {}, askCertificate: async () => ({ format: 'pdf', reason: '', credential: { type: 'system', id: ids[0].id }, cert: { subject: 'Anna Verdi' } }) } });
    expect(rep.every((r) => r.ok)).toBe(true);
    for (const r of rep) expect((await M.verifyPdf(readFileSync(r.uscita))).signatures[0]).toMatchObject({ integrity: true, signatureValid: true });
    expect(app.ev).toHaveLength(2);
    expect(readdirSync(kdir).filter((f) => /leggio-(tmp|prep)/.test(f))).toEqual([]);
  }, 60000);
});
