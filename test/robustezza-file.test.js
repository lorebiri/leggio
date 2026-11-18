// Corpus di file malformati e fuzzing deterministico: pdf.js (come nell'app) deve sempre
// rispondere — aprire il file o lanciare un errore — entro un tempo limite, e il nucleo
// deve produrre un messaggio chiaro. Nessun blocco, nessuna eccezione non gestita.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { PDFDocument, StandardFonts } from '@cantoo/pdf-lib';
import { repairPdf } from '../src/renderer/core/repair.js';
import { sniff, precheck, describeOpenError, hasEof, cleanIpcMessage, isBenignError } from '../src/renderer/core/errors.js';

const require = createRequire(import.meta.url);
pdfjs.GlobalWorkerOptions.workerSrc = (await import('node:url')).pathToFileURL(require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs')).href;
const TIMEOUT = 15000;

// In Node pdf.js usa un "worker finto" nello stesso processo: i suoi errori interni su file
// corrotti emergono come promesse rifiutate non gestite (nel browser restano dentro il Worker).
// Si filtrano solo quelli che provengono dal worker di pdf.js; tutto il resto resta fatale.
const workerNoise = [];
beforeAll(() => {
  const prev = process.listeners('unhandledRejection');
  process.removeAllListeners('unhandledRejection');
  process.on('unhandledRejection', (reason, p) => {
    if (/pdf\.worker/.test(String(reason?.stack || ''))) { workerNoise.push(reason?.name || 'Error'); return; }
    for (const l of prev) l(reason, p);
  });
});

/** Apre come l'app (copia dei byte, opzioni sicure); → {ok, pages, error, ms} */
async function tryOpen(bytes, password) {
  const t0 = Date.now();
  const task = pdfjs.getDocument({ data: bytes.slice(), password, isEvalSupported: false, stopAtErrors: false, verbosity: 0 });
  task.onPassword = (_u, reason) => { const e = new Error(reason === 2 ? 'Password errata' : 'Password richiesta'); e.name = 'PasswordException'; task._pw = e; task.destroy(); };
  let timer;
  const timeout = new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('TIMEOUT')), TIMEOUT - 2000); });
  try {
    const pdf = await Promise.race([task.promise, timeout]);
    let pages = pdf.numPages;
    // come l'app: la prima pagina deve essere almeno richiedibile (può fallire, ma senza bloccare)
    try { const p = await Promise.race([pdf.getPage(1), timeout]); await Promise.race([p.getOperatorList(), timeout]); } catch (e) { if (e.message === 'TIMEOUT') throw e; }
    await task.destroy();
    return { ok: true, pages, ms: Date.now() - t0 };
  } catch (error) {
    if (error.message === 'TIMEOUT') throw error;
    await task.destroy().catch(() => {});
    return { ok: false, error: task._pw || error, ms: Date.now() - t0 };
  } finally { clearTimeout(timer); }
}

function rng(seed) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }
const enc = (s) => new TextEncoder().encode(s);
const dec = (b) => new TextDecoder('latin1').decode(b);
const latin = (s) => Uint8Array.from(s, (c) => c.charCodeAt(0) & 0xff);

let valid; // PDF valido non compresso (oggetti leggibili)
let validCompressed;
beforeAll(async () => {
  const d = await PDFDocument.create();
  const f = await d.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < 3; i++) d.addPage([300, 300]).drawText('Pagina ' + (i + 1), { x: 20, y: 250, size: 18, font: f });
  valid = await d.save({ useObjectStreams: false });
  validCompressed = new Uint8Array(readFileSync('test/fixtures/prova.pdf'));
});

function expectClearMessage(r, bytes, name = 'prova.pdf') {
  const msg = describeOpenError(r.error, bytes, name);
  expect(typeof msg).toBe('string');
  expect(msg.length).toBeGreaterThan(15);
  expect(msg).toContain(name);
  return msg;
}

describe('diagnosi dei byte', () => {
  it('riconosce vuoto, PDF, intestazione spostata e formati comuni', () => {
    expect(sniff(new Uint8Array()).kind).toBe('empty');
    expect(sniff(enc('%PDF-1.7\n')).kind).toBe('pdf');
    expect(sniff(enc('garbage\r\n%PDF-1.4')).kind).toBe('pdf-offset');
    expect(sniff(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 13, 10])).what).toMatch(/PNG/);
    expect(sniff(new Uint8Array([0xff, 0xd8, 0xff, 0xe0])).what).toMatch(/JPEG/);
    expect(sniff(new Uint8Array([0x50, 0x4b, 3, 4])).what).toMatch(/Office|ZIP/);
    expect(sniff(enc('<!DOCTYPE html><html>')).what).toMatch(/HTML/);
    expect(sniff(enc('ciao mondo')).kind).toBe('unknown');
    expect(precheck(new Uint8Array(), 'x.pdf')).toMatch(/vuoto/);
    expect(precheck({ length: 3 * 2 ** 30 }, 'x.pdf')).toMatch(/2 GB/);
    expect(precheck(enc('%PDF'), 'x.pdf')).toBe(null);
    expect(hasEof(valid)).toBe(true);
    expect(hasEof(valid.slice(0, valid.length / 2))).toBe(false);
  });
  it('pulisce i messaggi IPC e riconosce il rumore benigno', () => {
    expect(cleanIpcMessage("Error invoking remote method 'file:write': Error: Disco pieno")).toBe('Disco pieno');
    expect(isBenignError({ name: 'RenderingCancelledException' })).toBe(true);
    expect(isBenignError(new Error('ResizeObserver loop limit exceeded'))).toBe(true);
    expect(isBenignError(new Error('vero errore'))).toBe(false);
  });
});

describe('corpus di file malformati', () => {
  const cases = () => {
    const s = dec(valid);
    const xrefAt = s.lastIndexOf('xref');
    const sx = s.lastIndexOf('startxref');
    const out = {
      'zero byte': new Uint8Array(),
      'immagine PNG rinominata': new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new Uint8Array(200)]),
      'immagine JPEG rinominata': new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new Uint8Array(200)]),
      'documento Word rinominato': new Uint8Array([0x50, 0x4b, 0x03, 0x04, ...enc('[Content_Types].xml word/document.xml')]),
      'pagina HTML': enc('<!DOCTYPE html><html><body>Errore 404</body></html>'),
      'testo qualunque': enc('Questo non è un PDF, solo testo.\n'.repeat(20)),
      'solo intestazione': enc('%PDF-1.7\n'),
      'troncato al 10%': valid.slice(0, Math.floor(valid.length * 0.1)),
      'troncato al 50%': valid.slice(0, Math.floor(valid.length * 0.5)),
      'troncato al 95%': valid.slice(0, Math.floor(valid.length * 0.95)),
      'compresso troncato al 60%': validCompressed.slice(0, Math.floor(validCompressed.length * 0.6)),
      'xref cancellata': latin(s.slice(0, xrefAt) + 'XXXX' + s.slice(xrefAt + 4)),
      'startxref sbagliato': latin(s.slice(0, sx) + 'startxref\n999999999\n%%EOF\n'),
      'startxref negativo': latin(s.slice(0, sx) + 'startxref\n-5\n%%EOF\n'),
      'offset xref tutti zero': latin(s.replace(/\d{10} 00000 n/g, '0000000000 00000 n')),
      'oggetto Pages mancante': latin(s.replace(/(\d+) 0 obj\s*<<\s*\/Type \/Pages[\s\S]*?endobj/, '')),
      'catalogo mancante': latin(s.replace(/(\d+) 0 obj\s*<<\s*\/Type \/Catalog[\s\S]*?endobj/, '')),
      'stream corrotto': latin(s.replace(/stream\r?\n([\s\S]{10})/g, (m) => m.slice(0, -10) + 'ÿþ\u0000\u0001garbage!')),
      'Length dello stream sbagliata': latin(s.replace(/\/Length \d+/g, '/Length 99999999')),
      'spazzatura prima dell’intestazione': new Uint8Array([...enc('From: posta@example.org\r\n\r\n'), ...valid]),
      'byte casuali': (() => { const r = rng(7); return Uint8Array.from({ length: 5000 }, () => Math.floor(r() * 256)); })(),
      'albero pagine ciclico': enc(cyclic()),
      'pagina figlia di sé stessa': enc(selfKid()),
      'Count enorme': latin(s.replace(/\/Count \d+/, '/Count 2147483647')),
    };
    return out;
  };

  for (const [name, gen] of Object.entries({ all: 1 })) void name, void gen;
  it.each(Object.keys({
    'zero byte': 1, 'immagine PNG rinominata': 1, 'immagine JPEG rinominata': 1, 'documento Word rinominato': 1, 'pagina HTML': 1,
    'testo qualunque': 1, 'solo intestazione': 1, 'troncato al 10%': 1, 'troncato al 50%': 1, 'troncato al 95%': 1,
    'compresso troncato al 60%': 1, 'xref cancellata': 1, 'startxref sbagliato': 1, 'startxref negativo': 1, 'offset xref tutti zero': 1,
    'oggetto Pages mancante': 1, 'catalogo mancante': 1, 'stream corrotto': 1, 'Length dello stream sbagliata': 1,
    'spazzatura prima dell’intestazione': 1, 'byte casuali': 1, 'albero pagine ciclico': 1, 'pagina figlia di sé stessa': 1, 'Count enorme': 1,
  }))('%s: risponde senza bloccarsi', async (k) => {
    const bytes = cases()[k];
    const r = await tryOpen(bytes);
    if (!r.ok) expectClearMessage(r, bytes);
    else expect(r.pages).toBeGreaterThanOrEqual(0);
    // l'esito è registrato per docs/ROBUSTEZZA.md
    (globalThis.__esiti ||= []).push([k, r.ok ? `aperto (${r.pages} pag.)` : 'rifiutato', r.ms]);
  }, TIMEOUT);

  it('i file solo danneggiati in parte vengono comunque aperti da pdf.js (ripiego)', async () => {
    const c = cases();
    for (const k of ['xref cancellata', 'startxref sbagliato', 'offset xref tutti zero', 'spazzatura prima dell’intestazione', 'Length dello stream sbagliata']) {
      const r = await tryOpen(c[k]);
      expect(r.ok, k).toBe(true);
    }
  }, 60000);

  it('messaggi specifici: vuoto, immagine, non PDF, troncato', async () => {
    const c = cases();
    expect(describeOpenError(new Error('x'), c['zero byte'], 'a.pdf')).toMatch(/vuoto/);
    expect(describeOpenError(Object.assign(new Error('Invalid PDF structure.'), { name: 'InvalidPDFException' }), c['immagine PNG rinominata'], 'a.pdf')).toMatch(/PNG/);
    expect(describeOpenError(Object.assign(new Error('Invalid PDF structure.'), { name: 'InvalidPDFException' }), c['testo qualunque'], 'a.pdf')).toMatch(/non sembra un PDF/);
    const tr = c['troncato al 10%'];
    const r = await tryOpen(tr);
    if (!r.ok) expect(describeOpenError(r.error, tr, 'a.pdf')).toMatch(/danneggiato|troncato|pagine/);
  }, 30000);
});

describe('riparazione dei file troncati', () => {
  it('pdf.js rifiuta i troncati, la riparazione con pdf-lib li rende apribili', async () => {
    const esiti = [];
    for (const [k, frac, src] of [['troncato 50%', 0.5, () => valid], ['troncato 95%', 0.95, () => valid], ['compresso troncato 60%', 0.6, () => validCompressed], ['compresso troncato 95%', 0.95, () => validCompressed]]) {
      const b = src().slice(0, Math.floor(src().length * frac));
      const before = await tryOpen(b);
      const rep = await repairPdf(b);
      const after = rep ? await tryOpen(rep.bytes) : { ok: false };
      esiti.push([k, before.ok, rep?.pages ?? 0, after.ok]);
      expect(after.ok, k).toBe(true);
    }
    (globalThis.__riparati = esiti);
  }, 30000);
  it('il file riparato ha un albero delle pagine coerente: ogni pagina dichiarata si apre', async () => {
    // troncato dopo alcune pagine: /Pages /Count dichiarava ancora tutte le pagine dell'originale
    // e pdf.js falliva sulle pagine «mancanti» («Page dictionary kid reference points to wrong type»)
    const b = new Uint8Array(readFileSync(new URL('./fixtures/prova.pdf', import.meta.url)));
    const tr = b.slice(0, Math.floor(b.length / 2));
    const rep = await repairPdf(tr);
    expect(rep).not.toBe(null);
    const d = await pdfjs.getDocument({ data: rep.bytes.slice() }).promise;
    expect(d.numPages).toBe(rep.pages);
    for (let i = 1; i <= d.numPages; i++) await d.getPage(i);
    await d.loadingTask.destroy();
  }, 30000);
  it('non inventa nulla da file che non sono PDF', async () => {
    expect(await repairPdf(enc('ciao'))).toBe(null);
    expect(await repairPdf(new Uint8Array())).toBe(null);
    expect(await repairPdf(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe(null);
  });
});

afterAll(() => {
  if (process.env.LEGGIO_ESITI) console.log('[esiti]\n' + (globalThis.__esiti || []).map(([k, e, ms]) => `| ${k} | ${e} | ${ms} ms |`).join('\n') + `\n[rumore worker] ${workerNoise.length}`);
});

describe('file cifrati', () => {
  let encrypted;
  beforeAll(async () => {
    const d = await PDFDocument.load(valid);
    d.encrypt({ userPassword: 'giusta', ownerPassword: 'proprietario' });
    encrypted = await d.save();
  });
  it('password giusta: si apre', async () => {
    const r = await tryOpen(encrypted, 'giusta');
    expect(r.ok, String(r.error?.stack)).toBe(true); expect(r.pages).toBe(3);
  });
  it('password errata o assente: errore PasswordException con messaggio chiaro, nessun blocco', async () => {
    for (const pw of ['sbagliata', undefined]) {
      const r = await tryOpen(encrypted, pw);
      expect(r.ok).toBe(false);
      expect(r.error.name).toBe('PasswordException');
      expect(describeOpenError(r.error, encrypted, 'segreto.pdf')).toMatch(/password/);
    }
  }, 30000);
});

describe('fuzzing deterministico (byte mutati da un PDF valido)', () => {
  const N = Number(process.env.LEGGIO_FUZZ || 150);
  it(`${N} mutazioni con seme fisso: mai bloccato, sempre esito definito`, async () => {
    const r = rng(20261112);
    let opened = 0, refused = 0, maxMs = 0;
    for (let i = 0; i < N; i++) {
      const src = i % 2 ? valid : validCompressed;
      const b = src.slice();
      const kind = i % 4;
      const muts = 1 + Math.floor(r() * 24);
      for (let m = 0; m < muts; m++) {
        const at = Math.floor(r() * b.length);
        if (kind === 0) b[at] = Math.floor(r() * 256);                 // byte casuale
        else if (kind === 1) b[at] ^= 1 << Math.floor(r() * 8);        // bit invertito
        else if (kind === 2) b.fill(0, at, Math.min(b.length, at + 1 + Math.floor(r() * 64))); // buco di zeri
        else b.copyWithin(at, Math.floor(r() * b.length), Math.floor(r() * b.length)); // blocchi spostati
      }
      const res = await tryOpen(b);
      maxMs = Math.max(maxMs, res.ms);
      if (res.ok) opened++; else { refused++; expectClearMessage(res, b, 'fuzz.pdf'); }
    }
    expect(opened + refused).toBe(N);
    console.log(`[fuzz] ${N} casi: ${opened} aperti, ${refused} rifiutati con messaggio; caso più lento ${maxMs} ms`);
  }, 300000);
});

// --- PDF costruiti a mano ---
function build(objs) {
  let out = '%PDF-1.7\n'; const offs = [];
  objs.forEach((o, i) => { offs.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const x = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('');
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF\n`;
  return out;
}
function cyclic() {
  // Pages 2 → Kids [3]; 3 è un nodo Pages con Kids [2]: ciclo
  return build(['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 2 >>', '<< /Type /Pages /Parent 2 0 R /Kids [2 0 R 4 0 R] /Count 1 >>', '<< /Type /Page /Parent 3 0 R /MediaBox [0 0 200 200] >>']);
}
function selfKid() {
  return build(['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [2 0 R] /Count 1 >>']);
}
