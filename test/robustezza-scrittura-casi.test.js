// Salvataggio sicuro (electron/core/safe-write.cjs): casi limite trovati nel debug.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'node:module';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, symlinkSync, lstatSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const require = createRequire(import.meta.url);
const { safeWrite, cleanStaleTemps } = require('../electron/core/safe-write.cjs');

let dir;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'leggio-sw-')); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('safeWrite: casi limite', () => {
  it.skipIf(process.platform === 'win32')('salvando un collegamento simbolico si aggiorna il file vero e il collegamento resta', async () => {
    const vero = join(dir, 'vero.pdf'); const link = join(dir, 'link.pdf');
    writeFileSync(vero, '%PDF vecchio');
    symlinkSync(vero, link);
    await safeWrite(link, Buffer.from('%PDF nuovo'));
    expect(readFileSync(vero, 'utf8')).toBe('%PDF nuovo');
    expect(lstatSync(link).isSymbolicLink()).toBe(true);
  });
  it('un nome lungo (240 byte) si salva: il temporaneo non supera il limite del sistema', async () => {
    const nome = 'a'.repeat(236) + '.pdf';
    const p = join(dir, nome);
    await safeWrite(p, Buffer.from('%PDF lungo'));
    expect(readFileSync(p, 'utf8')).toBe('%PDF lungo');
    expect(readdirSync(dir)).toEqual([nome]);
  });
  it('i temporanei rimasti (anche di nomi lunghi) vengono ripuliti', async () => {
    const p = join(dir, 'b'.repeat(236) + '.pdf');
    await safeWrite(p, Buffer.from('%PDF'));
    const { tempName } = require('../electron/core/safe-write.cjs');
    writeFileSync(join(dir, tempName(p)), 'resto');
    await cleanStaleTemps(p);
    expect(readdirSync(dir)).toHaveLength(1);
  });
});
