import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { _test: m, register } = require('../electron/features/avanzati.cjs');

let dir;
beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'leggio-av-'));
  fs.mkdirSync(path.join(dir, 'sotto', 'profonda'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'a.pdf'), '%PDF-1.4');
  fs.writeFileSync(path.join(dir, 'b.PDF'), '%PDF-1.4');
  fs.writeFileSync(path.join(dir, 'nota.txt'), 'x');
  fs.writeFileSync(path.join(dir, 'sotto', 'profonda', 'c.pdf'), '%PDF-1.4');
  fs.writeFileSync(path.join(dir, '.nascosto.pdf'), '%PDF');
});
afterAll(() => { fs.rmSync(dir, { recursive: true, force: true }); delete process.env.LEGGIO_SOFFICE; });

describe('modulo main «avanzati»', () => {
  it('rifiuta cartelle non scelte dall\'utente', async () => {
    await expect(m.listFiles({ folder: dir })).rejects.toThrow(/scelti da te/);
    await expect(m.readAllowed({ path: '/etc/hosts' })).rejects.toThrow(/scelti da te/);
    await expect(m.listFiles({ folder: 'relativo' })).rejects.toThrow(/non valido/);
  });

  it('elenca i PDF anche nelle sottocartelle, saltando i nascosti', async () => {
    m.allow(dir);
    const r = await m.listFiles({ folder: dir });
    expect(r.files.map((f) => f.rel).sort()).toEqual(['a.pdf', 'b.PDF', path.join('sotto', 'profonda', 'c.pdf')].sort());
    const flat = await m.listFiles({ folder: dir, recursive: false });
    expect(flat.files).toHaveLength(2);
    const lim = await m.listFiles({ folder: dir, max: 1 });
    expect(lim.truncated).toBe(true);
  });

  it('non esce dalla cartella autorizzata con ../', async () => {
    await expect(m.readAllowed({ path: path.join(dir, '..', 'altro.pdf') })).rejects.toThrow(/scelti da te/);
  });

  it('scrive nella sottocartella Elaborati senza sovrascrivere', async () => {
    const p1 = await m.writeAllowed({ folder: dir, sub: 'Elaborati', name: 'a.pdf', bytes: new Uint8Array([1, 2]) });
    const p2 = await m.writeAllowed({ folder: dir, sub: 'Elaborati', name: 'a.pdf', bytes: new Uint8Array([3]) });
    expect(path.basename(p1)).toBe('a.pdf');
    expect(path.basename(p2)).toBe('a (2).pdf');
    expect(fs.readFileSync(p1)).toEqual(Buffer.from([1, 2]));
    const p3 = await m.writeAllowed({ folder: dir, sub: '../fuori', name: '../x.pdf', bytes: new Uint8Array([1]) });
    expect(p3.startsWith(dir)).toBe(true);
  });

  it('nomi di file sicuri', () => {
    expect(m.safeName('a/b\\c:d*.pdf')).toBe('a_b_c_d_.pdf');
    expect(m.safeName('CON.pdf')).toBe('_CON.pdf');
    expect(m.safeName('...')).toBe('documento');
  });

  // il finto soffice è uno script sh: su Windows non si può eseguire direttamente
  it.skipIf(process.platform === 'win32')('converte con LibreOffice (simulato) e gestisce gli errori', async () => {
    const fake = path.join(dir, 'soffice-finto.sh');
    // simula soffice: crea <outdir>/<nome>.pdf
    fs.writeFileSync(fake, '#!/bin/sh\nwhile [ "$1" != "--outdir" ]; do shift; done\nout="$2"; in="$3"\nb=$(basename "$in"); b="${b%.*}"\nprintf "%%PDF-1.7 finto" > "$out/$b.pdf"\n');
    fs.chmodSync(fake, 0o755);
    process.env.LEGGIO_SOFFICE = fake;
    const r = await m.officeConvert({ name: 'lettera.docx', bytes: new Uint8Array([80, 75]) });
    expect(r.engine).toBe('libreoffice');
    expect(Buffer.from(r.bytes).toString()).toBe('%PDF-1.7 finto');
    await expect(m.officeConvert({ name: 'virus.exe', bytes: new Uint8Array([1]) })).rejects.toThrow(/non è tra quelli convertibili/);
    const slow = path.join(dir, 'lento.sh');
    // lo script dura molto più del limite (5 s): niente corse fra i due tempi
    fs.writeFileSync(slow, '#!/bin/sh\nsleep 60\n'); fs.chmodSync(slow, 0o755);
    process.env.LEGGIO_SOFFICE = slow;
    await expect(m.officeConvert({ name: 'x.odt', bytes: new Uint8Array([1]), timeoutMs: 5000 })).rejects.toThrow(/troppo tempo|non è riuscita/);
  }, 20000);

  it('lo script per Microsoft Office protegge gli apici', () => {
    expect(m.msOfficeScript("C:\\a'b.docx", 'C:\\o.pdf', 'docx')).toContain("'C:\\a''b.docx'");
  });

  it('registra i canali e risponde con {ok,error} invece di lanciare', async () => {
    const handlers = {};
    register({ ipcMain: { removeHandler() {}, handle: (n, f) => { handlers[n] = f; } }, BrowserWindow: null, dialog: null, getWindow: () => null });
    expect(Object.keys(handlers)).toContain('feat:avanzati:office-convert');
    const r = await handlers['feat:avanzati:read'](null, { path: 42 });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/non valido/);
  });
});
