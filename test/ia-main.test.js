import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawn } from 'node:child_process';

const require = createRequire(import.meta.url);
const { estrai, destinazione, trova } = require('../electron/ia/archivi.cjs');
const { scarica, importa, hostAmmesso } = require('../electron/ia/scarica.cjs');
const { Indice } = require('../electron/ia/indice.cjs');
const { Motore, argomenti, leggiSistema, threadConsigliati } = require('../electron/ia/server.cjs');
const { MOTORE, MODELLI, motorePer } = require('../electron/ia/catalogo.cjs');
const { _test: ia } = require('../electron/features/ia.cjs');

const radice = fs.mkdtempSync(path.join(os.tmpdir(), 'leggio-ia-'));
afterAll(() => fs.rmSync(radice, { recursive: true, force: true }));
const tmp = (n) => path.join(radice, n + '-' + crypto.randomBytes(3).toString('hex'));
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

// ---------- pacchetti di prova ----------
function crc32(buf) {
  let c = ~0;
  for (const b of buf) { c ^= b; for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1; }
  return ~c >>> 0;
}
function zipDi(voci) { // voci: [{ nome, dati, deflate }]
  const locali = []; const centrali = []; let off = 0;
  for (const v of voci) {
    const nome = Buffer.from(v.nome); const dati = Buffer.from(v.dati);
    const comp = v.deflate ? zlib.deflateRawSync(dati) : dati;
    const l = Buffer.alloc(30); l.writeUInt32LE(0x04034b50, 0); l.writeUInt16LE(20, 4); l.writeUInt16LE(v.deflate ? 8 : 0, 8);
    l.writeUInt32LE(crc32(dati), 14); l.writeUInt32LE(comp.length, 18); l.writeUInt32LE(dati.length, 22); l.writeUInt16LE(nome.length, 26);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 6); c.writeUInt16LE(v.deflate ? 8 : 0, 10);
    c.writeUInt32LE(crc32(dati), 16); c.writeUInt32LE(comp.length, 20); c.writeUInt32LE(dati.length, 24); c.writeUInt16LE(nome.length, 28);
    c.writeUInt32LE(((v.modo || 0o644) << 16) >>> 0, 38); c.writeUInt32LE(off, 42);
    locali.push(l, nome, comp); centrali.push(c, nome); off += 30 + nome.length + comp.length;
  }
  const cd = Buffer.concat(centrali);
  const e = Buffer.alloc(22); e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(voci.length, 8); e.writeUInt16LE(voci.length, 10); e.writeUInt32LE(cd.length, 12); e.writeUInt32LE(off, 16);
  return Buffer.concat([...locali, cd, e]);
}
function tarGzDi(voci) { // voci: [{ nome, dati, tipo: '0'|'5'|'2', link, modo }]
  const blocchi = [];
  for (const v of voci) {
    const h = Buffer.alloc(512);
    h.write(v.nome, 0, 100); h.write(((v.modo || 0o644).toString(8)).padStart(7, '0') + '\0', 100);
    const dati = Buffer.from(v.dati || '');
    h.write(dati.length.toString(8).padStart(11, '0') + '\0', 124);
    h.write('        ', 148); h.write(v.tipo || '0', 156); if (v.link) h.write(v.link, 157, 100); h.write('ustar\0', 257);
    let s = 0; for (const b of h) s += b; h.write(s.toString(8).padStart(6, '0') + '\0 ', 148);
    blocchi.push(h, dati, Buffer.alloc((512 - (dati.length % 512)) % 512));
  }
  blocchi.push(Buffer.alloc(1024));
  return zlib.gzipSync(Buffer.concat(blocchi));
}

describe('assistente IA, main: pacchetti del motore', () => {
  it('estrae uno zip (memorizzato e compresso) e trova il binario', async () => {
    const z = tmp('m') + '.zip';
    fs.writeFileSync(z, zipDi([{ nome: 'llama-server.exe', dati: 'MZ finto', deflate: true }, { nome: 'ggml.dll', dati: 'x'.repeat(5000), deflate: true }, { nome: 'LICENSE', dati: 'MIT' }]));
    const d = tmp('dz');
    expect(await estrai(z, d)).toBe(3);
    expect(fs.readFileSync(path.join(d, 'ggml.dll'), 'utf8')).toBe('x'.repeat(5000));
    expect(trova(d, 'llama-server.exe')).toBe(path.join(d, 'llama-server.exe'));
  });

  it('non scrive fuori dalla cartella (percorsi assoluti e «..»)', async () => {
    const z = tmp('cattivo') + '.zip';
    fs.writeFileSync(z, zipDi([{ nome: '../fuori.txt', dati: 'no' }, { nome: '/assoluto.txt', dati: 'no' }, { nome: 'a/../../fuori2.txt', dati: 'no' }, { nome: 'ok.txt', dati: 'sì' }]));
    const d = tmp('dc');
    expect(await estrai(z, d)).toBe(1);
    expect(fs.existsSync(path.join(path.dirname(d), 'fuori.txt'))).toBe(false);
    expect(destinazione(d, 'C:/Windows/x')).toBe(null);
    expect(destinazione(d, 'sotto/file')).toBe(path.join(d, 'sotto', 'file'));
  });

  it.skipIf(process.platform === 'win32')('estrae un .tar.gz con cartelle, permessi e collegamenti interni', async () => {
    const t = tmp('m') + '.tar.gz';
    fs.writeFileSync(t, tarGzDi([
      { nome: 'llama-b1/', tipo: '5' },
      { nome: 'llama-b1/llama-server', dati: '#!/bin/sh\n', modo: 0o755 },
      { nome: 'llama-b1/libggml.1.0.0.dylib', dati: 'lib' },
      { nome: 'llama-b1/libggml.1.dylib', tipo: '2', link: 'libggml.1.0.0.dylib' },
      { nome: 'llama-b1/fuori', tipo: '2', link: '../../etc/passwd' },
      { nome: '../evaso', dati: 'no' },
    ]));
    const d = tmp('dt');
    expect(await estrai(t, d)).toBe(2);
    const bin = trova(d, 'llama-server');
    expect(fs.statSync(bin).mode & 0o111).toBeTruthy();
    expect(fs.readFileSync(path.join(d, 'llama-b1', 'libggml.1.dylib'), 'utf8')).toBe('lib');
    expect(fs.existsSync(path.join(d, 'llama-b1', 'fuori'))).toBe(false);
  });
});

describe('assistente IA, main: download con verifica', () => {
  const dati = crypto.randomBytes(300000);
  let server; let base; let richieste = [];
  beforeAll(async () => {
    server = http.createServer((req, res) => {
      richieste.push({ url: req.url, range: req.headers.range });
      if (req.url === '/redirect') { res.writeHead(302, { Location: base.replace('127.0.0.1', 'localhost') + '/file' }); return res.end(); }
      if (req.url === '/rotto') { res.writeHead(200, { 'Content-Length': dati.length }); res.write(dati.subarray(0, 1000)); return setTimeout(() => res.destroy(), 100); }
      const m = /bytes=(\d+)-/.exec(req.headers.range || '');
      if (m) { const da = Number(m[1]); res.writeHead(206, { 'Content-Length': dati.length - da }); return res.end(dati.subarray(da)); }
      res.writeHead(200, { 'Content-Length': dati.length }); res.end(dati);
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${server.address().port}`;
  });
  afterAll(() => server.close());
  const opz = (x = {}) => ({ sha256: sha(dati), byte: dati.length, hostExtra: [/^127\.0\.0\.1$/], ...x });

  it('accetta solo le fonti fisse in https', () => {
    expect(hostAmmesso('https://github.com/ggml-org/llama.cpp/releases/download/b1/x.zip')).toBe(true);
    expect(hostAmmesso('https://huggingface.co/a/b/resolve/c/x.gguf')).toBe(true);
    expect(hostAmmesso('https://cas-bridge.xethub.hf.co/x')).toBe(true);
    expect(hostAmmesso('http://github.com/x')).toBe(false);
    expect(hostAmmesso('https://example.com/x')).toBe(false);
    expect(hostAmmesso('https://github.com.example.com/x')).toBe(false);
  });

  it('scarica, verifica e mostra l\'avanzamento', async () => {
    const dest = tmp('f') + '.gguf';
    const av = [];
    const r = await scarica(base + '/file', dest, opz({ onProgress: (p) => av.push(p) }));
    expect(r.sha256).toBe(sha(dati));
    expect(fs.readFileSync(dest).equals(dati)).toBe(true);
    expect(av.at(-1)).toEqual({ fatti: dati.length, totale: dati.length });
    expect(fs.existsSync(dest + '.part')).toBe(false);
  });

  it('riprende un download interrotto (Range) da dove era arrivato', async () => {
    const dest = tmp('r') + '.gguf';
    fs.writeFileSync(dest + '.part', dati.subarray(0, 120000));
    richieste = [];
    await scarica(base + '/file', dest, opz());
    expect(richieste[0].range).toBe('bytes=120000-');
    expect(fs.readFileSync(dest).equals(dati)).toBe(true);
  });

  it('rifiuta un file con impronta diversa e lo cancella', async () => {
    const dest = tmp('x') + '.gguf';
    await expect(scarica(base + '/file', dest, opz({ sha256: 'a'.repeat(64) }))).rejects.toThrow(/impronta/);
    expect(fs.existsSync(dest)).toBe(false);
    expect(fs.existsSync(dest + '.part')).toBe(false);
  });

  it('senza impronta o verso host non ammessi non scarica nulla', async () => {
    await expect(scarica(base + '/file', tmp('y'), { byte: 1 })).rejects.toThrow(/Impronta/);
    await expect(scarica('https://example.com/x', tmp('y'), opz({ hostExtra: [] }))).rejects.toThrow(/non ammesso/);
    // reindirizzamento verso un host non ammesso (localhost non è in elenco)
    await expect(scarica(base + '/redirect', tmp('y'), opz())).rejects.toThrow(/non ammesso/);
  });

  it('una connessione caduta lascia il .part per riprendere', async () => {
    const dest = tmp('c') + '.gguf';
    await expect(scarica(base + '/rotto', dest, opz())).rejects.toThrow(/Riprova/);
    expect(fs.statSync(dest + '.part').size).toBe(1000);
  });

  it('interrompere lascia il .part', async () => {
    const dest = tmp('a') + '.gguf';
    const c = new AbortController(); c.abort();
    await expect(scarica(base + '/file', dest, opz({ signal: c.signal }))).rejects.toThrow(/interrotto/i);
  });

  it('importa da file solo se dimensione e impronta corrispondono', async () => {
    const orig = tmp('o'); fs.writeFileSync(orig, dati);
    const dest = tmp('i') + '.gguf';
    await importa(orig, dest, { sha256: sha(dati), byte: dati.length });
    expect(fs.readFileSync(dest).equals(dati)).toBe(true);
    await expect(importa(orig, tmp('j'), { sha256: 'b'.repeat(64), byte: dati.length })).rejects.toThrow(/impronta/);
    await expect(importa(orig, tmp('k'), { sha256: sha(dati), byte: 5 })).rejects.toThrow(/dimensione/);
  });
});

describe('assistente IA, main: catalogo', () => {
  it('ogni componente ha fonte fissa, dimensione e SHA-256', () => {
    for (const m of [...Object.values(MOTORE), ...Object.values(MODELLI)]) {
      expect(m.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(m.byte).toBeGreaterThan(1e6);
    }
    for (const m of Object.values(MODELLI)) {
      expect(m.url).toMatch(/^https:\/\/huggingface\.co\/[^/]+\/[^/]+\/resolve\/[0-9a-f]{40}\//);
      expect(hostAmmesso(m.url)).toBe(true);
      expect(['Apache-2.0', 'MIT']).toContain(m.licenza);
    }
    for (const p of ['win32-x64', 'darwin-arm64', 'darwin-x64', 'linux-x64']) {
      const m = motorePer(...p.split('-'));
      expect(m.url).toMatch(/^https:\/\/github\.com\/ggml-org\/llama\.cpp\/releases\/download\/b\d+\//);
    }
    expect(motorePer('freebsd', 'x64')).toBe(null);
  });
});

describe('assistente IA, main: indice per significato', () => {
  it('salva, ricarica e cerca (un risultato per documento)', async () => {
    const d = tmp('ix');
    const ix = new Indice(d);
    await ix.carica();
    ix.metti('a'.repeat(64), 'm1', [{ pagina: 1, testo: 'uno' }, { pagina: 4, testo: 'due' }], [[1, 0, 0], [0.9, 0.1, 0]]);
    ix.metti('b'.repeat(64), 'm1', [{ pagina: 2, testo: 'tre' }], [[0, 1, 0]]);
    await ix.salva();
    const ix2 = new Indice(d);
    await ix2.carica();
    expect(ix2.info()).toEqual({ documenti: 2, passaggi: 3 });
    const r = ix2.cerca([1, 0, 0], { k: 5 });
    expect(r.map((x) => [x.impronta[0], x.pagina])).toEqual([['a', 1], ['b', 2]]);
    expect(r[0].punteggio).toBeCloseTo(1);
    expect(ix2.impronte('m1')).toHaveLength(2);
    expect(ix2.impronte('altro')).toHaveLength(0);
    expect(ix2.cerca([1, 0, 0], { filtro: new Set(['b'.repeat(64)]) })).toHaveLength(1);
    ix2.togli(['a'.repeat(64)]); await ix2.salva();
    const ix3 = new Indice(d); await ix3.carica();
    expect(ix3.info().documenti).toBe(1);
    await ix3.cancella();
    expect(fs.existsSync(path.join(d, 'indice.ndjson'))).toBe(false);
  });
});

describe('assistente IA, main: processo del motore', () => {
  it('argomenti: solo 127.0.0.1, chiave, contesto e niente interfaccia web', () => {
    const a = argomenti('chat', { modello: '/m.gguf', porta: 1234, chiave: 'k', thread: 3 });
    expect(a.join(' ')).toMatch(/--host 127\.0\.0\.1 --port 1234 --api-key k -t 3 -tb 3 --no-webui -np 1 --jinja -c 8192 -cram 0/);
    expect(argomenti('embed', { modello: '/m.gguf', porta: 1, chiave: 'k', thread: 1 })).toContain('--embedding');
    expect(threadConsigliati(8)).toBe(4); expect(threadConsigliati(4)).toBe(3); expect(threadConsigliati(1)).toBe(1);
  });

  it('riconosce AVX2 e la variante CPU dalle righe del motore', () => {
    expect(leggiSistema('system_info: n_threads = 4 | CPU : SSE3 = 1 | AVX2 = 1 | FMA = 1')).toMatchObject({ avx2: true });
    expect(leggiSistema('load_backend: loaded CPU backend from C:\\x\\ggml-cpu-haswell.dll')).toMatchObject({ avx2: true, varianteCpu: 'haswell' });
    expect(leggiSistema('load_backend: loaded CPU backend from /x/libggml-cpu-sandybridge.so')).toMatchObject({ avx2: false });
  });

  // finto llama-server: un piccolo programma Node che risponde come il motore vero
  const finto = path.join(radice, 'finto-server.cjs');
  fs.writeFileSync(finto, `
    const http = require('http');
    const a = process.argv.slice(2); const v = (k) => a[a.indexOf(k) + 1];
    if (process.env.FINTO_CRASH) { console.error('E errore finto: modello illeggibile'); process.exit(3); }
    const chiave = v('--api-key');
    console.error('system_info: n_threads = ' + v('-t') + ' | CPU : AVX2 = 1 |');
    http.createServer((req, res) => {
      if (req.headers.authorization !== 'Bearer ' + chiave) { res.writeHead(401); return res.end('{}'); }
      let b = ''; req.on('data', (d) => (b += d)); req.on('end', () => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        if (req.url === '/health') return res.end('{"status":"ok"}');
        const j = b ? JSON.parse(b) : {};
        if (req.url === '/v1/chat/completions') return res.end(JSON.stringify({ choices: [{ message: { content: '<think>x</think>{"risposta":"' + j.messages.length + ' messaggi, schema ' + !!j.response_format + '","pagina":2}' } }], timings: { prompt_n: 10, cache_n: 3 } }));
        if (req.url === '/v1/embeddings') return res.end(JSON.stringify({ data: j.input.map((t, i) => ({ index: i, embedding: [t.length, 1] })).reverse() }));
        if (req.url === '/tokenize') return res.end(JSON.stringify({ tokens: Array(Math.ceil(j.content.length / 4)).fill(1) }));
        res.end('{}');
      });
    }).listen(Number(v('--port')), v('--host'));
  `);
  const spawnFn = (bin, args, o) => spawn(process.execPath, [finto, ...args], { ...o, cwd: radice });

  it('avvia il motore alla prima richiesta, risponde, riusa il processo e si ferma', async () => {
    const m = new Motore({ binario: '/finto/llama-server', cartellaRegistri: radice, spawnFn });
    const r = await m.chat('/m1.gguf', { messaggi: [{ role: 'system', content: 's' }, { role: 'user', content: 'u' }], schema: { type: 'object' } });
    expect(r.testo).toBe('{"risposta":"2 messaggi, schema true","pagina":2}');
    expect(r.tempi).toMatchObject({ promptN: 10, cacheN: 3 });
    const pid = m.chatP.proc.pid;
    await m.chat('/m1.gguf', { messaggi: [{ role: 'user', content: 'u' }] });
    expect(m.chatP.proc.pid).toBe(pid);
    expect(m.stato().chat).toMatchObject({ attivo: true, modello: 'm1.gguf', avx2: true });
    expect(await m.embed('/e.gguf', ['ab', 'abcd'])).toEqual([[2, 1], [4, 1]]);
    // cambiando modello il processo si riavvia
    await m.chat('/m2.gguf', { messaggi: [{ role: 'user', content: 'u' }] });
    expect(m.chatP.proc.pid).not.toBe(pid);
    await m.ferma();
    expect(m.stato().chat.attivo).toBe(false);
    expect(fs.readFileSync(path.join(radice, 'registro-motore.txt'), 'utf8')).toMatch(/AVX2 = 1/);
  });

  it('si ferma da solo dopo l\'inattività', async () => {
    const m = new Motore({ binario: '/finto/llama-server', cartellaRegistri: radice, spawnFn, inattivitaMs: 300 });
    await m.chat('/m1.gguf', { messaggi: [{ role: 'user', content: 'u' }] });
    expect(m.chatP.attivo()).toBe(true);
    await new Promise((r) => setTimeout(r, 1500));
    expect(m.chatP.attivo()).toBe(false);
  });

  it('un motore che si chiude all\'avvio dà un errore leggibile', async () => {
    const m = new Motore({ binario: '/finto/llama-server', cartellaRegistri: radice, spawnFn: (b, a, o) => spawn(process.execPath, [finto, ...a], { ...o, cwd: radice, env: { ...process.env, FINTO_CRASH: '1' } }) });
    await expect(m.chat('/m1.gguf', { messaggi: [{ role: 'user', content: 'u' }] })).rejects.toThrow(/si è chiuso all'avvio.*modello illeggibile/);
  });
});

describe('assistente IA, main: modulo dell\'area', () => {
  it('stato senza nulla installato, e niente avvio senza motore', async () => {
    ia.init(tmp('ud'));
    const s = await ia.stato();
    expect(s.motore === null || s.motore.installato === false).toBe(true);
    expect(Object.values(s.modelli).every((m) => !m.installato)).toBe(true);
    expect(s.ram.totale).toBeGreaterThan(0);
    await expect(ia.chiedi({ modello: 'principale', messaggi: [{ role: 'user', content: 'x' }] })).rejects.toThrow(/non è installato/);
    await expect(ia.vettori(['x'])).rejects.toThrow(/non è installato/);
  });

  it('rifiuta richieste non valide e file importati sbagliati', async () => {
    ia.init(tmp('ud'));
    await expect(ia.chiedi({ modello: 'sconosciuto', messaggi: [] })).rejects.toThrow(/sconosciuto/);
    const f = tmp('falso') + '.gguf'; fs.writeFileSync(f, 'non è un modello');
    await expect(ia.importaComponente('principale', f)).rejects.toThrow(/non è quello atteso/);
    await expect(ia.importaComponente('xyz', f)).rejects.toThrow(/sconosciuto/);
  });
});
