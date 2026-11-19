// Avvio pulito: decisione all'avvio, migrazione dalla 0.2, posizione per file, file di sessione del main.
// Il collaudo nell'app vera (casi a–d) è in test/e2e/avvio-pulito.mjs.
import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { snapshot, startupPlan, migrateFrom02, rememberView, recallView, MAX_VIEW_MEMORY, KEY_REOPEN } from '../src/renderer/features/avanzati/lib/session.js';

const require = createRequire(import.meta.url);
const { createSessionStore, normalizza } = require('../electron/core/sessione.cjs');

const A = join(tmpdir(), 'a.pdf'); const B = join(tmpdir(), 'b.pdf');
const prev = (extra = {}) => ({ previous: { docs: [{ path: A, page: 3 }, { path: B, page: 1 }], active: B, ...extra.previous }, interrupted: false, withFiles: false, ...extra });

describe('decisione all\'avvio', () => {
  it('avvio normale: nessun documento riaperto (casi a e b)', () => {
    expect(startupPlan(prev()).action).toBe('none');
    expect(startupPlan(prev(), { reopen: false }).docs).toEqual([]);
  });
  it('opzione attiva: riapre i documenti lasciati aperti, con la scheda attiva', () => {
    expect(startupPlan(prev(), { reopen: true })).toEqual({ action: 'reopen', docs: [{ path: A, page: 3 }, { path: B, page: 1 }], active: B });
  });
  it('aperto con un file (doppio clic, «Apri con»): solo quel file, anche con l\'opzione attiva (caso c)', () => {
    expect(startupPlan(prev({ withFiles: true }), { reopen: true }).action).toBe('none');
    expect(startupPlan(prev(), { reopen: true, busy: true }).action).toBe('none');
  });
  it('sessione interrotta: domanda, mai apertura automatica, anche con l\'opzione o con un file (caso d)', () => {
    for (const o of [{}, { reopen: true }, { reopen: true, busy: true }]) {
      const p = startupPlan(prev({ interrupted: true, withFiles: !!o.busy }), o);
      expect(p.action).toBe('ask');
      expect(p.docs.map((d) => d.path)).toEqual([A, B]);
    }
    expect(startupPlan({ previous: { docs: [] }, interrupted: true }).action).toBe('none');
  });
  it('niente sessione precedente o dati rovinati', () => {
    expect(startupPlan(null, { reopen: true }).action).toBe('none');
    expect(startupPlan({ previous: 'x', interrupted: true }).action).toBe('none');
  });
  it('l\'istantanea contiene solo i documenti aperti adesso, con la pagina', () => {
    const a = { path: A, viewState: { page: 4 } }; const n = { path: null }; const b = { path: B };
    expect(snapshot([a, n, b], b, 7)).toMatchObject({ docs: [{ path: A, page: 4 }, { path: B, page: 7 }], active: B });
    expect(snapshot([], null, 1)).toMatchObject({ docs: [], active: null });
  });
});

describe('migrazione dalla 0.2', () => {
  const fake = (data) => ({ data, get: (k, d) => (k in data ? data[k] : d), has: (k) => k in data, remove: (k) => { delete data[k]; } });
  it('vecchia sessione e interruttore attivo: niente riapertura, si tiene l\'ultimo documento', () => {
    const s = fake({ 'avanzati.session': { docs: [{ path: A, page: 3 }, { path: B }], active: A }, 'avanzati.restoreSession': true, theme: 'dark' });
    expect(migrateFrom02(s)).toEqual({ last: { path: A, page: 3 } });
    expect(s.data).toEqual({ theme: 'dark' });
    expect(s.data[KEY_REOPEN]).toBeUndefined();
  });
  it('senza documento attivo vale il primo; sessione rovinata → nessun ultimo documento', () => {
    expect(migrateFrom02(fake({ 'avanzati.session': { docs: [{ path: B }], active: null } }))).toEqual({ last: { path: B, page: 1 } });
    expect(migrateFrom02(fake({ 'avanzati.session': 'spazzatura', 'avanzati.restoreSession': false }))).toEqual({ last: null });
  });
  it('niente da migrare (installazione nuova o già migrata)', () => {
    expect(migrateFrom02(fake({ theme: 'light' }))).toBeNull();
  });
});

describe('posizione e zoom ricordati per ogni file', () => {
  it('ricorda e restituisce pagina, zoom e scorrimento', () => {
    const m = rememberView({}, A, { page: 5, scale: '1.5', scrollTop: 1234.6 }, 10);
    expect(recallView(m, A)).toEqual({ page: 5, scale: '1.5', scrollTop: 1235 });
    expect(recallView(m, B)).toBeNull();
    expect(recallView(null, A)).toBeNull();
  });
  it('dati rovinati: pagina 1, nessuno scorrimento senza zoom', () => {
    expect(recallView({ [A]: { page: -2, scale: {}, scrollTop: 50 } }, A)).toEqual({ page: 1, scale: null, scrollTop: null });
    expect(recallView({ [A]: 'x' }, A)).toBeNull();
  });
  it('tiene solo i file usati più di recente', () => {
    let m = {};
    for (let i = 0; i < MAX_VIEW_MEMORY + 5; i++) m = rememberView(m, `/f${i}.pdf`, { page: 1, scale: 'auto' }, i);
    expect(Object.keys(m)).toHaveLength(MAX_VIEW_MEMORY);
    expect(m['/f0.pdf']).toBeUndefined();
    expect(m[`/f${MAX_VIEW_MEMORY + 4}.pdf`]).toBeTruthy();
  });
});

describe('file di sessione del main (electron/core/sessione.cjs)', () => {
  const nuovo = () => { const d = mkdtempSync(join(tmpdir(), 'leggio-sess-')); return { file: join(d, 'sessione.json'), store: createSessionStore(join(d, 'sessione.json')) }; };

  it('prima installazione: nessuna sessione precedente, sessione segnata in corso', () => {
    const { file, store } = nuovo();
    expect(store.start()).toEqual({ previous: null, interrupted: false });
    expect(JSON.parse(readFileSync(file, 'utf8'))).toMatchObject({ v: 2, running: true, docs: [] });
  });
  it('chiusura regolare: all\'avvio dopo, sessione non interrotta; «last» conservato', () => {
    const { store } = nuovo();
    store.start();
    store.update({ docs: [{ path: A, page: 2 }], active: A, last: { path: A, page: 2 }, running: true });
    store.update({ docs: [{ path: A, page: 2 }], active: A, last: { path: A, page: 2 }, running: false });
    const s = store.start();
    expect(s.interrupted).toBe(false);
    expect(s.previous.docs).toEqual([{ path: A, page: 2 }]);
    expect(store.read()).toMatchObject({ running: true, docs: [], last: { path: A, page: 2 } });
  });
  it('crash (nessuna chiusura regolare): la sessione successiva la vede interrotta, con i documenti aperti allora', () => {
    const { store } = nuovo();
    store.start();
    store.update({ docs: [{ path: A }, { path: B, page: 9 }], active: B, running: true });
    const s = store.start();
    expect(s.interrupted).toBe(true);
    expect(s.previous.docs).toEqual([{ path: A, page: 1 }, { path: B, page: 9 }]);
    // la domanda si fa una volta: all'avvio dopo ancora (senza documenti aperti) non c'è più niente da proporre
    expect(store.start().previous.docs).toEqual([]);
  });
  it('dati dal renderer validati: percorsi relativi, doppioni, pagine assurde, troppe voci', () => {
    const n = normalizza({ running: 'sì', docs: [{ path: 'rel.pdf' }, { path: A, page: 1e9 }, { path: A }, null, ...Array.from({ length: 50 }, (_, i) => ({ path: join(tmpdir(), `x${i}.pdf`) }))], active: '/non/aperto.pdf', last: { path: 3 } });
    expect(n.running).toBe(false);
    expect(n.docs[0]).toEqual({ path: A, page: 1 });
    expect(n.docs).toHaveLength(30);
    expect(n.active).toBeNull();
    expect(n.last).toBeNull();
  });
  it('file rovinato o di un\'altra versione: come se non ci fosse', () => {
    const { file, store } = nuovo();
    writeFileSync(file, '{rotto');
    expect(store.start()).toEqual({ previous: null, interrupted: false });
    writeFileSync(file, JSON.stringify({ v: 1, running: true, docs: [{ path: A }] }));
    expect(store.start()).toEqual({ previous: null, interrupted: false });
    expect(existsSync(file)).toBe(true);
  });
});
