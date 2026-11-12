// Scrittura sicura (electron/core/safe-write.cjs): originale mai rovinato, ripiego Windows, messaggi chiari.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { safeWrite, friendly, cleanStaleTemps } = require('../electron/core/safe-write.cjs');
const V = require('../electron/core/validate.cjs');

let dir;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'leggio-sw-')); });
afterEach(() => { vi.restoreAllMocks(); fs.rmSync(dir, { recursive: true, force: true }); });
const listTmp = () => fs.readdirSync(dir).filter((f) => f.includes('leggio-tmp') || f.endsWith('.leggio-bak'));

describe('safeWrite', () => {
  it('crea un file nuovo e sostituisce un file esistente, senza lasciare temporanei', async () => {
    const p = path.join(dir, 'a.pdf');
    expect((await safeWrite(p, Buffer.from('uno'))).strategy).toBe('new');
    expect((await safeWrite(p, new Uint8Array([100, 117, 101]))).strategy).toBe('rename');
    expect(fs.readFileSync(p, 'utf8')).toBe('due');
    expect(listTmp()).toEqual([]);
  });
  it('conserva i permessi dell’originale', async () => {
    if (process.platform === 'win32') return;
    const p = path.join(dir, 'm.pdf'); fs.writeFileSync(p, 'x'); fs.chmodSync(p, 0o600);
    await safeWrite(p, Buffer.from('y'));
    expect(fs.statSync(p).mode & 0o777).toBe(0o600);
  });
  it('Windows: rename bloccato (EPERM) → riprova, poi copia con riserva; risultato corretto', async () => {
    const p = path.join(dir, 'w.pdf'); fs.writeFileSync(p, 'originale');
    vi.spyOn(fs.promises, 'rename').mockRejectedValue(Object.assign(new Error('perm'), { code: 'EPERM' }));
    const r = await safeWrite(p, Buffer.from('nuovo contenuto'), { renameTries: 2 });
    expect(r.strategy).toBe('copy');
    expect(fs.readFileSync(p, 'utf8')).toBe('nuovo contenuto');
    expect(listTmp()).toEqual([]);
  });
  it('Windows: rename riesce al secondo tentativo (file appena rilasciato da antivirus/OneDrive)', async () => {
    const p = path.join(dir, 'r.pdf'); fs.writeFileSync(p, 'old');
    const real = fs.promises.rename.bind(fs.promises);
    let n = 0;
    vi.spyOn(fs.promises, 'rename').mockImplementation((a, b) => (++n === 1 ? Promise.reject(Object.assign(new Error('busy'), { code: 'EBUSY' })) : real(a, b)));
    expect((await safeWrite(p, Buffer.from('new'))).strategy).toBe('rename');
    expect(fs.readFileSync(p, 'utf8')).toBe('new');
  });
  it('se anche la copia fallisce, l’originale viene ripristinato intatto', async () => {
    const p = path.join(dir, 'k.pdf'); fs.writeFileSync(p, 'ORIGINALE');
    vi.spyOn(fs.promises, 'rename').mockRejectedValue(Object.assign(new Error('perm'), { code: 'EPERM' }));
    const realCopy = fs.promises.copyFile.bind(fs.promises);
    vi.spyOn(fs.promises, 'copyFile').mockImplementation(async (a, b) => {
      if (String(a).includes('leggio-tmp')) { fs.writeFileSync(b, 'MEZZO'); throw Object.assign(new Error('disco pieno'), { code: 'ENOSPC' }); }
      return realCopy(a, b);
    });
    await expect(safeWrite(p, Buffer.from('NUOVO'), { renameTries: 1 })).rejects.toThrow(/Spazio su disco esaurito/);
    expect(fs.readFileSync(p, 'utf8')).toBe('ORIGINALE');
    expect(listTmp()).toEqual([]);
  });
  it('disco pieno durante il temporaneo: originale intatto, messaggio chiaro', async () => {
    const p = path.join(dir, 'f.pdf'); fs.writeFileSync(p, 'ORIG');
    vi.spyOn(fs.promises, 'open').mockRejectedValueOnce(Object.assign(new Error('nospc'), { code: 'ENOSPC' }));
    await expect(safeWrite(p, Buffer.from('X'))).rejects.toThrow(/Spazio su disco esaurito/);
    expect(fs.readFileSync(p, 'utf8')).toBe('ORIG');
  });
  it('cartella sparita (chiavetta scollegata): messaggio chiaro', async () => {
    const p = path.join(dir, 'non-esiste', 'x.pdf');
    await expect(safeWrite(p, Buffer.from('X'))).rejects.toThrow(/non è più raggiungibile/);
  });
  it('cartella in sola lettura: messaggio sui permessi', async () => {
    if (process.platform === 'win32' || process.getuid?.() === 0) return;
    const ro = path.join(dir, 'ro'); fs.mkdirSync(ro); fs.chmodSync(ro, 0o500);
    try { await expect(safeWrite(path.join(ro, 'x.pdf'), Buffer.from('X'))).rejects.toThrow(/permessi|bloccato/); }
    finally { fs.chmodSync(ro, 0o700); }
  });
  it('rifiuta percorsi relativi e file oltre 2 GB (comportamento definito)', async () => {
    await expect(safeWrite('relativo.pdf', Buffer.from('x'))).rejects.toThrow();
    const fake = { length: 2 ** 31, buffer: new ArrayBuffer(1), byteOffset: 0, byteLength: 1 };
    const big = Object.assign(Buffer.alloc(1), {});
    Object.defineProperty(big, 'length', { value: 2 ** 31 });
    await expect(safeWrite(path.join(dir, 'g.pdf'), big)).rejects.toThrow(/2 GB/);
    expect(fake).toBeTruthy();
  });
  it('verifica a rilettura: se il disco restituisce byte diversi, l’originale non viene toccato', async () => {
    const p = path.join(dir, 'v.pdf'); fs.writeFileSync(p, 'ORIG');
    const realOpen = fs.promises.open.bind(fs.promises);
    vi.spyOn(fs.promises, 'open').mockImplementation(async (f, flags, mode) => {
      const fh = await realOpen(f, flags, mode);
      if (flags === 'wx') { const w = fh.write.bind(fh); fh.write = (buf, off, len) => w(Buffer.alloc(len, 0x41), 0, len); }
      return fh;
    });
    await expect(safeWrite(p, Buffer.from('BBBB'))).rejects.toThrow(/Errore di lettura\/scrittura/);
    expect(fs.readFileSync(p, 'utf8')).toBe('ORIG');
    expect(listTmp()).toEqual([]);
  });
  it('cleanStaleTemps elimina temporanei rimasti da salvataggi interrotti', async () => {
    const p = path.join(dir, 's.pdf'); fs.writeFileSync(p, 'x');
    fs.writeFileSync(path.join(dir, '.s.pdf.abcd1234.leggio-tmp'), 'resto');
    await cleanStaleTemps(p);
    expect(listTmp()).toEqual([]);
  });
  it('friendly: codici noti tradotti', () => {
    for (const c of ['ENOSPC', 'EACCES', 'EPERM', 'EBUSY', 'EROFS', 'ENOENT', 'EIO']) {
      const e = friendly(Object.assign(new Error('x'), { code: c }), '/a/b.pdf');
      expect(e.userMessage).toMatch(/b\.pdf|\/a/);
    }
  });
});

describe('validazione IPC', () => {
  it('percorsi, byte, nomi, chiavi, url', () => {
    expect(() => V.absPath('rel/x.pdf')).toThrow();
    expect(() => V.absPath('/a/\0b')).toThrow();
    expect(V.absPath(path.resolve('/a/../b/x.pdf'))).toBe(path.resolve('/b/x.pdf'));
    expect(() => V.bytes('ciao')).toThrow();
    expect(V.bytes(new ArrayBuffer(3)).length).toBe(3);
    expect(V.fileName('../../etc/passwd')).not.toMatch(/[\\/]/);
    expect(V.fileName('..')).not.toBe('..');
    expect(() => V.key('../x')).toThrow();
    expect(V.key('a1b2c3d4e5f6')).toBe('a1b2c3d4e5f6');
    expect(V.webUrl('file:///etc/passwd')).toBe(null);
    expect(V.webUrl('javascript:alert(1)')).toBe(null);
    expect(V.webUrl('https://cnr.it/x')).toBe('https://cnr.it/x');
    expect(V.webUrl('mailto:a@b.it')).toBe('mailto:a@b.it');
  });
});
