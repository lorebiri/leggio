// 0.3 — firme e timbri: pulizia delle foto di firme su carta, timbri (modelli e spec), posizioni sulle
// pagine anche ruotate («Sigla tutte le pagine», timbro su tutte), profilo nell'archivio personale.
import { describe, it, expect } from 'vitest';
import { pulisciFoto, stimaCarta, hexRgb, ricolora } from '../src/renderer/features/moduli/lib/foto.js';
import { MODELLI_TIMBRO, normalizzaSpec, righeTimbro, haData, nomeTimbro } from '../src/renderer/features/moduli/lib/timbri.js';
import { rettangoloInPosizione, posizioneRelativa, dimensioniVisive, visivoToPdf, pdfToVisivo, placement } from '../src/renderer/features/moduli/lib/geom.js';
import { createStore, memoryStorage } from '../src/renderer/features/moduli/lib/store.js';
import { createArchivio } from '../src/renderer/features/personale/lib/archivio.js';
import { createMemoryBackend } from '../src/renderer/features/personale/lib/backend.js';

/** Foto sintetica: carta giallina con un'ombra che cresce verso destra, tratti scuri, blu e a matita. */
function foto(w = 400, h = 200) {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4; const k = 1 - 0.45 * x / w;
      d[i] = 250 * k; d[i + 1] = 240 * k; d[i + 2] = 200 * k; d[i + 3] = 255;
      if (y >= 95 && y <= 100) { d[i] = 40 * k + 20; d[i + 1] = 40 * k + 20; d[i + 2] = 45 * k + 20; }
      if (x >= 50 && x <= 53 && y > 20 && y < 180) { d[i] = 40; d[i + 1] = 60; d[i + 2] = 170; }
      if (x >= 300 && x <= 302 && y > 20 && y < 180) { d[i] = 150 * k; d[i + 1] = 150 * k; d[i + 2] = 140 * k; }
    }
  }
  return { d, w, h, a: (x, y) => d[(y * w + x) * 4 + 3], rgb: (x, y) => Array.from(d.subarray((y * w + x) * 4, (y * w + x) * 4 + 3)) };
}

describe('firma da foto o scansione', () => {
  it('toglie carta colorata e ombra, tiene inchiostro nero, blu e tratti chiari', () => {
    const f = foto();
    const r = pulisciFoto(f.d, f.w, f.h, { sensibilita: 0.5 });
    expect(r.carta[0]).toBeGreaterThan(r.carta[2]); // carta giallina riconosciuta
    for (const [x, y] of [[10, 10], [390, 10], [200, 150], [390, 190]]) expect(f.a(x, y)).toBe(0);
    for (const [x, y] of [[20, 97], [380, 97], [51, 50], [301, 50]]) expect(f.a(x, y)).toBe(255);
  });
  it('ricolora l\'inchiostro nel colore scelto e con sensibilità bassa scarta i tratti deboli', () => {
    const f = foto();
    pulisciFoto(f.d, f.w, f.h, { sensibilita: 0.5, inchiostro: hexRgb('#1d3f9a') });
    expect(f.rgb(51, 50)).toEqual([29, 63, 154]);
    const g = foto();
    pulisciFoto(g.d, g.w, g.h, { sensibilita: 0 });
    expect(g.a(20, 97)).toBe(255);
    const d = new Uint8ClampedArray([10, 10, 10, 255, 0, 0, 0, 0]); ricolora(d, [1, 2, 3]);
    expect(Array.from(d)).toEqual([1, 2, 3, 255, 0, 0, 0, 0]);
  });
  it('immagini vuote o minime non rompono nulla', () => {
    expect(pulisciFoto(new Uint8ClampedArray(4), 1, 1).pixelInchiostro).toBe(0);
    expect(stimaCarta(new Uint8ClampedArray(16).fill(255), 2, 2)).toEqual([255, 255, 255]);
  });
});

describe('timbri', () => {
  it('modelli pronti richiesti', () => {
    expect(MODELLI_TIMBRO.map((m) => m.nome)).toEqual(['Copia conforme all\'originale', 'Ricevuto il [data]', 'Annullato', 'Visto', 'Pagato']);
  });
  it('data automatica, limiti e valori non validi', () => {
    expect(righeTimbro(MODELLI_TIMBRO[1].spec, '19/11/2026')).toEqual(['RICEVUTO IL', '19/11/2026']);
    expect(righeTimbro({ righe: ['VISTO'], data: true }, '01/02/2026')).toEqual(['VISTO', '01/02/2026']);
    expect(haData(MODELLI_TIMBRO[1].spec)).toBe(true);
    expect(haData(MODELLI_TIMBRO[3].spec)).toBe(false);
    const s = normalizzaSpec({ forma: 'stella', righe: 'COMUNE\nDI PRATO', colore: 'rosso', rotazione: 200, bordoTesto: 'x' });
    expect(s).toMatchObject({ forma: 'rettangolo', righe: ['COMUNE', 'DI PRATO'], colore: '#1d3f9a', rotazione: 45, bordoTesto: '' });
    expect(normalizzaSpec({ forma: 'tondo', bordoTesto: 'COMUNE DI PRATO', righe: [] })).toMatchObject({ righe: ['TIMBRO'], bordoTesto: 'COMUNE DI PRATO' });
    expect(nomeTimbro({ forma: 'tondo', bordoTesto: 'PRO LOCO DI VAIANO' })).toBe('PRO LOCO DI VAIANO');
  });
});

describe('posizioni sulla pagina (anche ruotata)', () => {
  const vb = [0, 0, 595, 842];
  it('«in basso a destra» resta in basso a destra per come si vede la pagina, con le misure giuste', () => {
    for (const rot of [0, 90, 180, 270]) {
      const r = rettangoloInPosizione(vb, rot, 'br', 100, 40, 20);
      const pl = placement(r, rot);
      expect([Math.round(pl.w), Math.round(pl.h)]).toEqual([100, 40]);
      const P = dimensioniVisive(vb, rot);
      const rel = posizioneRelativa(vb, rot, r);
      expect(rel.fx * P.w).toBeCloseTo(P.w - 20 - 50, 5);
      expect(rel.fy * P.h).toBeCloseTo(P.h - 20 - 20, 5);
    }
  });
  it('visivo ↔ PDF sono inverse; una posizione relativa si replica su pagine di formato diverso', () => {
    for (const rot of [0, 90, 180, 270]) {
      const [x, y] = visivoToPdf([10, 20, 400, 600], rot, 33, 77);
      expect(pdfToVisivo([10, 20, 400, 600], rot, x, y)).toEqual([33, 77]);
    }
    const src = rettangoloInPosizione(vb, 0, 'tr', 60, 20, 30);
    const rel = posizioneRelativa(vb, 0, src);
    const a3 = [0, 0, 842, 1191];
    const dst = rettangoloInPosizione(a3, 0, { fx: rel.fx, fy: rel.fy }, rel.w, rel.h);
    expect(dst[2] - dst[0]).toBeCloseTo(60, 5);
    expect(dst[0] / 842).toBeCloseTo(src[0] / 595, 1);
    // non esce mai dalla pagina
    const fuori = rettangoloInPosizione(vb, 0, { fx: 1.2, fy: -0.5 }, 100, 50);
    expect(fuori[0]).toBeGreaterThanOrEqual(0); expect(fuori[2]).toBeLessThanOrEqual(595); expect(fuori[3]).toBeLessThanOrEqual(842);
  });
});

describe('profilo: dall\'archivio personale quando è aperto', () => {
  it('createStore legge e scrive il profilo nell\'archivio passato', async () => {
    const a = createArchivio({ backend: createMemoryBackend() });
    await a.apri();
    a.salvaProfilo({ nome: 'Maria', iban: 'IT60X0542811101000000123456' });
    const s = createStore(memoryStorage(), { archivio: a });
    expect(s.getProfile()).toEqual({ nome: 'Maria' });
    s.setProfile({ nome: 'Maria', cognome: 'Rossi' });
    expect(a.profilo()).toMatchObject({ nome: 'Maria', cognome: 'Rossi', iban: 'IT60X0542811101000000123456' });
    // archivio non aperto: si torna al localStorage (compatibilità)
    const b = createArchivio({ backend: createMemoryBackend() });
    const t = createStore(memoryStorage(), { archivio: b });
    t.setProfile({ nome: 'Ugo' });
    expect(t.getProfile()).toEqual({ nome: 'Ugo' });
  });
});
