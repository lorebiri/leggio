import { describe, it, expect } from 'vitest';
import { planPrintJobs, normalizePreset, DEFAULT_PRINT_PRESET } from '../src/renderer/core/printplan.js';

const pages = (n) => [...Array(n).keys()];
const flat = (jobs) => jobs.map((j) => j.map((x) => (x.blank ? 'b' : `${x.file}:${x.page}`)).join(' '));

describe('piano di stampa', () => {
  it('solo fronte: tutte le pagine di seguito, un lavoro', () => {
    expect(flat(planPrintJobs([{ pages: pages(3) }, { pages: pages(2) }]))).toEqual(['0:0 0:1 0:2 1:0 1:1']);
  });
  it('fronte/retro: pagina bianca dopo i file dispari (tranne l’ultimo), così ogni file inizia su un foglio nuovo', () => {
    expect(flat(planPrintJobs([{ pages: pages(3) }, { pages: pages(1) }, { pages: pages(1) }], { duplex: 'longEdge' }))).toEqual(['0:0 0:1 0:2 b 1:0 b 2:0']);
  });
  it('lavori da al massimo N pagine; i file non vengono spezzati se ci stanno', () => {
    const jobs = planPrintJobs([{ pages: pages(150) }, { pages: pages(100) }, { pages: pages(30) }], { maxPagesPerJob: 200 });
    expect(jobs.map((j) => j.length)).toEqual([150, 130]);
    const big = planPrintJobs([{ pages: pages(450) }], { maxPagesPerJob: 200 });
    expect(big.map((j) => j.length)).toEqual([200, 200, 50]);
    expect(big.flat().map((x) => x.page)).toEqual(pages(450));
  });
  it('file senza pagine scelte ignorati', () => {
    expect(planPrintJobs([{ pages: [] }, { pages: [4] }])).toEqual([[{ file: 1, page: 4 }]]);
  });
  it('preset normalizzato: copie 1–99, fronte/retro e qualità validi', () => {
    expect(normalizePreset({ copies: 500, duplex: 'boh', quality: 72 })).toMatchObject({ copies: 99, duplex: 'simplex', quality: '150' });
    expect(normalizePreset({ copies: '3', duplex: 'shortEdge', copyStamp: 1 })).toMatchObject({ copies: 3, duplex: 'shortEdge', copyStamp: true });
    expect(normalizePreset()).toEqual(DEFAULT_PRINT_PRESET);
    expect(Object.keys(normalizePreset({ pages: '1-3', remember: true }))).toEqual(Object.keys(DEFAULT_PRINT_PRESET));
  });
});
