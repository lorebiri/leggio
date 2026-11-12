import { describe, it, expect } from 'vitest';
import { confrontaPixel } from '../src/renderer/features/conversione/lib/pixel.js';

const img = (w, h, fill = 255) => new Uint8ClampedArray(w * h * 4).fill(fill);
describe('confronto visivo', () => {
  it('immagini uguali → nessuna differenza', () => {
    const r = confrontaPixel(img(64, 64), img(64, 64), 64, 64);
    expect(r.diverse).toBe(0); expect(r.riquadri).toEqual([]);
  });
  it('un quadrato nero cambiato → un riquadro che lo contiene', () => {
    const a = img(100, 100); const b = img(100, 100);
    for (let y = 40; y < 60; y++) for (let x = 20; x < 30; x++) { const i = (y * 100 + x) * 4; b[i] = b[i + 1] = b[i + 2] = 0; }
    const r = confrontaPixel(a, b, 100, 100);
    expect(r.diverse).toBe(200);
    expect(r.riquadri).toHaveLength(1);
    const q = r.riquadri[0];
    expect(q.x0).toBeLessThanOrEqual(20); expect(q.x1).toBeGreaterThanOrEqual(30);
    expect(q.y0).toBeLessThanOrEqual(40); expect(q.y1).toBeGreaterThanOrEqual(60);
  });
  it('rumore lieve sotto soglia ignorato', () => {
    const a = img(32, 32, 200); const b = img(32, 32, 210);
    expect(confrontaPixel(a, b, 32, 32).diverse).toBe(0);
  });
});
