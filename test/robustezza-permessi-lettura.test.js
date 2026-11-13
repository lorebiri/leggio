// Leggere un PDF dal renderer (file:read) NON deve dare il permesso di sovrascriverlo:
// il permesso di scrittura nasce solo da una scelta dell'utente (dialogo, trascinamento, doppio clic,
// file recenti). Prima ogni file:read di un .pdf concedeva la scrittura e lo aggiungeva ai recenti.
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createGrants } = require('../electron/core/grants.cjs');

describe('permessi dopo file:read di un PDF', () => {
  it('PDF mai scelto dall’utente: si legge, ma non si può sovrascrivere né finisce nei recenti', () => {
    const g = createGrants();
    const r = g.onRendererRead('/Documenti/altro.pdf', []);
    expect(r).toEqual({ write: false, recent: false });
    expect(g.whyNotWrite('/Documenti/altro.pdf')).toMatch(/non è stato aperto da te/);
  });
  it('PDF già concesso (doppio clic, dialogo, trascinamento): resta scrivibile e va nei recenti', () => {
    const g = createGrants(); g.grantFile('/Documenti/mio.pdf');
    expect(g.onRendererRead('/Documenti/mio.pdf', [])).toEqual({ write: true, recent: true });
    expect(g.whyNotWrite('/Documenti/mio.pdf')).toBe(null);
  });
  it('PDF nei file recenti (riaperto dalla schermata iniziale o dalla sessione precedente): diventa scrivibile', () => {
    const g = createGrants();
    expect(g.onRendererRead('/Documenti/recente.pdf', ['/Documenti/recente.pdf'])).toEqual({ write: true, recent: true });
    expect(g.whyNotWrite('/Documenti/recente.pdf')).toBe(null);
  });
  it('maiuscole diverse nei recenti valgono su macOS/Windows', () => {
    const g = createGrants({ caseInsensitive: true });
    expect(g.onRendererRead('/documenti/RECENTE.pdf', ['/Documenti/recente.pdf']).write).toBe(true);
  });
  it('un file in sola lettura resta protetto anche se è nei recenti', () => {
    const g = createGrants(); g.setReadOnly('/A/x.pdf', true);
    g.onRendererRead('/A/x.pdf', ['/A/x.pdf']);
    expect(g.whyNotWrite('/A/x.pdf')).toMatch(/sola lettura/);
  });
});

describe('permessi per il recupero automatico', () => {
  it('hasFile dice se il file è stato concesso (il main lo registra nel recupero)', () => {
    const g = createGrants();
    expect(g.hasFile('/A/x.pdf')).toBe(false);
    g.grantFile('/A/x.pdf');
    expect(g.hasFile('/A/x.pdf')).toBe(true);
    expect(g.hasFile('/A/./x.pdf')).toBe(true);
  });
});
