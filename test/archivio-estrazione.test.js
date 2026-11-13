// Estrazione su documenti realistici generati da test/archivio-genera.mjs: testo con pdf.js
// (come nel worker dell'app), tipo e dati chiave riconosciuti, scansioni, file protetti e rovinati.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { pageText } from '../src/renderer/features/avanzati/lib/textsearch.js';
import { openP7m, innerName } from '../src/renderer/features/avanzati/lib/cades.js';
import { parseFattura } from '../src/renderer/features/avanzati/lib/fattura.js';
import { datiDaTesto, datiDaFattura, eScansione, firmePdf, esitoFirmeP7m, etichettaFirma } from '../src/renderer/features/archivio/lib/estrai.js';
import { segnaturaGenerica } from '../src/renderer/features/archivio/lib/segnatura.js';
import { immaginiDisegnate, strisciaCandidata } from '../src/renderer/features/archivio/lib/striscia.js';

let dir; let files;
beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'leggio-arch-gen-'));
  execFileSync(process.execPath, [path.resolve('test/archivio-genera.mjs'), dir, '--n=160'], { stdio: 'pipe' });
  files = [];
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else files.push(p); } };
  walk(dir);
}, 120000);
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

async function testoPdf(bytes) {
  const pdf = await pdfjs.getDocument({ data: bytes, isEvalSupported: false, useSystemFonts: false, disableFontFace: true }).promise;
  try {
    const parti = []; const car = [];
    for (let i = 1; i <= pdf.numPages; i++) { const pg = await pdf.getPage(i); const t = pageText((await pg.getTextContent()).items); parti.push(t); car.push(t.replace(/\s+/g, '').length); }
    return { testo: parti.join('\f'), car, pagine: pdf.numPages };
  } finally { await pdf.loadingTask.destroy(); }
}
const cartella = (p) => path.relative(dir, p).split(path.sep)[0];
const ATTESO = { Fatture: 'fattura', 'Note di credito': 'nota-credito', DURC: 'durc', 'Ordini e determine': 'ordine', Missioni: 'missione', Contratti: 'contratto', Fornitori: 'tracciabilita', MePA: 'ordine', Incarichi: 'incarico' };

describe('estrazione su un archivio generato', () => {
  it('riconosce il tipo e i dati chiave dei PDF (≥ 95 %)', async () => {
    let tot = 0; let ok = 0; const sbagli = [];
    let conPiva = 0; let conImporto = 0; let fatture = 0; let segnature = 0; let segnatureSbagliate = 0;
    for (const f of files.filter((x) => x.endsWith('.pdf') && ATTESO[cartella(x)])) {
      const { testo } = await testoPdf(new Uint8Array(fs.readFileSync(f)));
      const d = datiDaTesto(testo, { nome: path.basename(f) });
      const seg = segnaturaGenerica(testo.split('\f')[0]);
      const attesa = testo.match(/CNR-ICCOM - (\d{7}) - /)?.[1];
      if (seg) { segnature++; if (seg.numero !== attesa || seg.aoo !== 'CNR-ICCOM') segnatureSbagliate++; }
      else if (attesa) segnatureSbagliate++;
      tot++;
      if (d.tipo === ATTESO[cartella(f)]) ok++; else sbagli.push(`${path.relative(dir, f)} → ${d.tipo}`);
      if (d.tipo === 'fattura') { fatture++; if (d.piva) conPiva++; if (d.importo) conImporto++; expect(d.piva).not.toBe('02118311006'); }
    }
    expect(tot).toBeGreaterThan(80);
    expect(segnature).toBeGreaterThan(5); // segnature di Titulus lette dal documento
    expect(segnatureSbagliate).toBe(0); // nessuna inventata (DURC, fatture, missioni senza segnatura) e nessuna persa
    expect(ok / tot, sbagli.join('\n')).toBeGreaterThanOrEqual(0.95);
    expect(conPiva / fatture).toBeGreaterThanOrEqual(0.95);
    expect(conImporto / fatture).toBeGreaterThanOrEqual(0.95);
  }, 120000);

  it('individua la striscia-immagine di segnatura sulla pagina 1 (e nessuna striscia dove non c\'è)', async () => {
    let con = 0; let senza = 0;
    for (const f of files.filter((x) => x.endsWith('.pdf') && ['Fatture', 'Ordini e determine', 'DURC', 'Missioni'].includes(cartella(x)))) {
      const pdf = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(f)), isEvalSupported: false }).promise;
      try {
        const pg = await pdf.getPage(1);
        const ol = await pg.getOperatorList();
        const imgs = immaginiDisegnate(ol.fnArray, ol.argsArray, pdfjs.OPS);
        const s = strisciaCandidata(imgs, pg.view);
        if (imgs.length) { con++; expect(s).toMatchObject({ verticale: true, lato: 'sinistra', px: [69, 2493] }); } else { senza++; expect(s).toBe(null); }
      } finally { await pdf.loadingTask.destroy(); }
    }
    expect(con).toBeGreaterThan(3);
    expect(senza).toBeGreaterThan(50);
  }, 120000);

  it('scansioni senza testo, PDF protetti e rovinati', async () => {
    for (const f of files.filter((x) => cartella(x) === 'Scansioni')) {
      const { car } = await testoPdf(new Uint8Array(fs.readFileSync(f)));
      expect(eScansione(car)).toBe(true);
    }
    for (const f of files.filter((x) => cartella(x) === 'Riservati')) {
      await expect(testoPdf(new Uint8Array(fs.readFileSync(f)))).rejects.toMatchObject({ name: 'PasswordException' });
    }
    let rotti = 0;
    for (const f of files.filter((x) => cartella(x) === 'Da sistemare')) {
      try { await testoPdf(new Uint8Array(fs.readFileSync(f))); } catch { rotti++; }
    }
    expect(rotti).toBeGreaterThan(0);
  }, 60000);

  it('firme PAdES nei contratti e buste .p7m', async () => {
    const firmati = files.filter((x) => cartella(x) === 'Contratti').filter((f) => firmePdf(new Uint8Array(fs.readFileSync(f))).length);
    expect(firmati.length).toBeGreaterThan(0);
    expect(firmePdf(new Uint8Array(fs.readFileSync(firmati[0])))[0]).toBe('Mario Rossi');
    for (const f of files.filter((x) => x.endsWith('.p7m'))) {
      const r = await openP7m(new Uint8Array(fs.readFileSync(f)), { verify: false });
      expect(r.levels[0].signers[0].name).toBe('MARIO ROSSI');
      const nome = innerName(path.basename(f), r.kind);
      if (r.kind === 'fattura') expect(datiDaFattura(parseFattura(r.content)).piva).toMatch(/^\d{11}$/);
      else expect(nome.endsWith('.pdf')).toBe(true);
    }
  }, 60000);

  it('un .p7m alterato NON risulta «Firmato digitalmente»: «Firma non valida»', async () => {
    const f = files.find((x) => x.endsWith('.p7m'));
    const buono = new Uint8Array(fs.readFileSync(f));
    const ok = esitoFirmeP7m(await openP7m(buono, { verify: true }));
    expect(ok).toBe('valida');
    expect(etichettaFirma({ firme: 1, firmaEsito: ok })).toMatchObject({ testo: 'Firmato digitalmente' });
    // un byte cambiato nel contenuto firmato (a metà file, lontano dalla firma in coda)
    const alterato = buono.slice(); const i = Math.floor(alterato.length / 3); alterato[i] = alterato[i] ^ 0x20;
    const esito = esitoFirmeP7m(await openP7m(alterato, { verify: true }));
    expect(esito).toBe('non-valida');
    expect(etichettaFirma({ firme: 1, firmaEsito: esito })).toMatchObject({ testo: 'Firma non valida', classe: 'err' });
    // firma nel PDF non verificata dall'indice: mai «Firmato digitalmente»
    expect(etichettaFirma({ firme: 1, firmaEsito: 'non-verificata' }).testo).toMatch(/da verificare/);
    expect(etichettaFirma({ firme: 0 })).toBe(null);
  }, 60000);

  it('fatture elettroniche XML', () => {
    const xml = files.filter((x) => x.endsWith('.xml'));
    expect(xml.length).toBeGreaterThan(0);
    for (const f of xml) {
      const d = datiDaFattura(parseFattura(fs.readFileSync(f)));
      expect(d.fornitore).toBeTruthy();
      expect(d.cig[0]).toMatch(/^[A-Z0-9]{10}$/);
      expect(d.importo).toBeGreaterThan(0);
    }
  });
});
