import { describe, it, expect } from 'vitest';
import { History, MemoryStore, DiskStore, memoryBudget, diskBudget, MB, GB } from '../src/renderer/core/history.js';
import { TaskQueue, QueueClosedError } from '../src/renderer/core/queue.js';

const B = (n, fill = 1) => new Uint8Array(n).fill(fill);

describe('tetti dinamici', () => {
  it('memoria: fra 96 e 600 MB, proporzionale alla RAM', () => {
    expect(memoryBudget({ totalMemory: 2 * GB })).toBe(96 * MB * 1 > 0.12 * 2 * GB ? 96 * MB : Math.round(0.12 * 2 * GB));
    expect(memoryBudget({ totalMemory: 64 * GB })).toBe(600 * MB);
    expect(memoryBudget({ totalMemory: 16 * GB, heapLimit: 1 * GB })).toBe(Math.round(0.35 * GB));
    expect(memoryBudget({})).toBeGreaterThanOrEqual(96 * MB);
  });
  it('disco: un quarto dello spazio libero, max 4 GB', () => {
    expect(diskBudget(100 * GB)).toBe(4 * GB);
    expect(diskBudget(2 * GB)).toBe(512 * MB);
    expect(diskBudget(undefined)).toBe(2 * GB);
  });
});

describe('History', () => {
  it('annulla e ripeti ripristinano byte e versioni', async () => {
    const h = new History();
    await h.push('A', 0, B(10, 0));
    await h.push('B', 1, B(10, 1));
    let r = await h.undo(2, B(10, 2));
    expect(r.label).toBe('B'); expect(r.version).toBe(1); expect(r.bytes[0]).toBe(1);
    r = await h.undo(1, r.bytes);
    expect(r.label).toBe('A'); expect(r.version).toBe(0);
    expect(await h.undo(0, r.bytes)).toBe(null);
    r = await h.redo(0, r.bytes);
    expect(r.version).toBe(1);
    r = await h.redo(1, r.bytes);
    expect(r.version).toBe(2); expect(r.bytes[0]).toBe(2);
  });
  it('una nuova modifica svuota i Ripeti', async () => {
    const h = new History();
    await h.push('A', 0, B(4));
    await h.undo(1, B(4));
    expect(h.canRedo).toBe(true);
    await h.push('C', 0, B(4));
    expect(h.canRedo).toBe(false);
  });
  it('rispetta il numero massimo di passi e avvisa', async () => {
    const trims = [];
    const h = new History({ maxEntries: 5, onTrim: (t) => trims.push(t) });
    for (let i = 0; i < 9; i++) await h.push('x' + i, i, B(4));
    expect(h.undoStack.length).toBe(5);
    expect(h.undoStack[0].label).toBe('x4');
    expect(trims.reduce((s, t) => s + t.dropped, 0)).toBe(4);
  });
  it('tetto di memoria: scarta i più vecchi ma conserva sempre l’ultimo Annulla', async () => {
    const trims = [];
    const h = new History({ memoryBudget: () => 25, onTrim: (t) => trims.push(t) });
    await h.push('a', 0, B(10)); await h.push('b', 1, B(10)); await h.push('c', 2, B(10));
    expect(h.undoStack.map((e) => e.label)).toEqual(['b', 'c']);
    await h.push('d', 3, B(100)); // da solo supera il tetto: resta comunque
    expect(h.undoStack.map((e) => e.label)).toEqual(['d']);
    expect(trims.at(-1).reason).toBe('memory');
  });
  it('copie grandi vanno su disco, piccole in memoria; ripiego in memoria se il disco fallisce', async () => {
    const files = new Map(); let n = 0; let fail = false;
    const backend = { async put(b) { if (fail) throw new Error('ENOSPC'); const k = 'k' + ++n; files.set(k, b.slice()); return k; }, async get(k) { return files.get(k); }, async drop(ks) { ks.forEach((k) => files.delete(k)); } };
    const h = new History({ disk: new DiskStore(backend), diskThreshold: 100 });
    await h.push('piccola', 0, B(10));
    await h.push('grande', 1, B(1000));
    expect(h.undoStack.map((e) => e.where)).toEqual(['memory', 'disk']);
    expect(files.size).toBe(1);
    const r = await h.undo(2, B(1000, 7)); // lo stato corrente va su disco come Ripeti
    expect(r.bytes.length).toBe(1000);
    expect(files.size).toBe(1); // la copia letta è stata eliminata, quella nuova creata
    fail = true;
    await h.push('dopo guasto', 1, B(1000));
    expect(h.undoStack.at(-1).where).toBe('memory');
    expect(h.diskFailed).toBe(true);
    await h.clear();
    expect(files.size).toBe(0);
  });
  it('se la copia non è leggibile lo stato non cambia', async () => {
    const backend = { put: async () => 'k', get: async () => { throw new Error('file sparito'); }, drop: async () => {} };
    const h = new History({ disk: new DiskStore(backend), diskThreshold: 1 });
    await h.push('A', 0, B(10));
    await expect(h.undo(1, B(10))).rejects.toThrow('file sparito');
    expect(h.undoStack.length).toBe(1); expect(h.redoStack.length).toBe(0);
  });
});

describe('TaskQueue', () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  it('esegue in serie, nell’ordine, anche se lanciate insieme', async () => {
    const q = new TaskQueue(); const log = [];
    const a = q.run('a', async () => { log.push('a1'); await sleep(20); log.push('a2'); return 1; });
    const b = q.run('b', async () => { log.push('b1'); await sleep(1); log.push('b2'); return 2; });
    expect(q.busy).toBe(true);
    expect(await Promise.all([a, b])).toEqual([1, 2]);
    expect(log).toEqual(['a1', 'a2', 'b1', 'b2']);
    await q.idle(); expect(q.busy).toBe(false);
  });
  it('un errore non blocca le operazioni successive', async () => {
    const q = new TaskQueue();
    const a = q.run('a', async () => { throw new Error('x'); });
    const b = q.run('b', async () => 'ok');
    await expect(a).rejects.toThrow('x');
    expect(await b).toBe('ok');
  });
  it('close rifiuta le operazioni non iniziate', async () => {
    const q = new TaskQueue();
    const a = q.run('a', () => sleep(10).then(() => 'fatto'));
    const b = q.run('b', async () => 'mai');
    await sleep(1); // «a» è iniziata
    q.close();
    const bErr = b.catch((e) => e);
    expect(await a).toBe('fatto');
    expect(await bErr).toBeInstanceOf(QueueClosedError);
    await expect(q.run('c', async () => 1)).rejects.toBeInstanceOf(QueueClosedError);
  });
  it('notifica occupato/libero con l’etichetta', async () => {
    const ev = []; const q = new TaskQueue((busy, label) => ev.push([busy, label]));
    await q.run('salva', async () => {});
    await q.idle();
    expect(ev[0]).toEqual([true, 'salva']); expect(ev.at(-1)).toEqual([false, null]);
  });
});
