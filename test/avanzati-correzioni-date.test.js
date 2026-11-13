// Date «di oggi» nell'area avanzati: giorno locale, non UTC (tra mezzanotte e le 2 in Italia
// toISOString() dà ancora il giorno prima).
import { describe, it, expect, vi, afterEach } from 'vitest';
import { nomeMissione } from '../src/renderer/features/avanzati/lib/missione.js';
import { oggiLocale } from '../src/renderer/features/avanzati/lib/controlli.js';

const TZ = process.env.TZ;
afterEach(() => { vi.useRealTimers(); process.env.TZ = TZ; });

describe('date di oggi in ora locale', () => {
  it('alle 00:30 del 5 marzo in Italia il nome della missione ha il 5 marzo', () => {
    process.env.TZ = 'Europe/Rome';
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-03-04T23:30:00Z'));
    expect(oggiLocale()).toBe('2026-03-05');
    expect(nomeMissione('Rossi')).toBe('Missione_ROSSI_2026-03-05.pdf');
  });
});
