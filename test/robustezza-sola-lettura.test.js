// Sola lettura a prova di errore: i permessi del main non lasciano MAI sovrascrivere un originale
// aperto in sola lettura (file:write, «Salva con nome» sullo stesso percorso, scrittura in cartella).
// I percorsi dell'interfaccia (applyEdit, Annulla/Ripeti, recupero, salvataggi delle aree, chiusura
// con «Salva») sono provati nell'app vera da test/e2e/sola-lettura-app.mjs.
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createGrants } = require('../electron/core/grants.cjs');

const ORIG = '/Archivio/2026/determina-12.pdf';

describe('permessi di scrittura e sola lettura', () => {
  it('file aperto normalmente: si può sovrascrivere', () => {
    const g = createGrants(); g.grantFile(ORIG);
    expect(g.whyNotWrite(ORIG)).toBe(null);
  });
  it('file in sola lettura: file:write rifiutato anche se il file era stato concesso', () => {
    const g = createGrants(); g.grantFile(ORIG); g.setReadOnly(ORIG, true);
    expect(g.whyNotWrite(ORIG)).toMatch(/sola lettura/);
  });
  it('concedere di nuovo il file (riapertura, ripristino dal recupero) non toglie la sola lettura', () => {
    const g = createGrants(); g.setReadOnly(ORIG, true); g.grantFile(ORIG); g.grantFile(ORIG);
    expect(g.whyNotWrite(ORIG)).toMatch(/sola lettura/);
  });
  it('«Salva con nome» sullo stesso percorso rifiutato; con un altro nome consentito', () => {
    const g = createGrants(); g.setReadOnly(ORIG, true);
    expect(g.whyNotSaveAs(ORIG)).toMatch(/sola lettura/);
    expect(g.whyNotSaveAs('/Archivio/2026/determina-12_copia.pdf')).toBe(null);
  });
  it('scrittura nella cartella scelta: mai sopra l’originale in sola lettura', () => {
    const g = createGrants(); g.grantFolder('/Archivio/2026'); g.setReadOnly(ORIG, true);
    expect(g.whyNotWriteInFolder('/Archivio/2026', ORIG)).toMatch(/sola lettura/);
    expect(g.whyNotWriteInFolder('/Archivio/2026', '/Archivio/2026/altro.pdf')).toBe(null);
    expect(g.whyNotWriteInFolder('/Altrove', '/Altrove/x.pdf')).toMatch(/Cartella non scelta/);
  });
  it('maiuscole/minuscole e percorsi non normalizzati non aggirano la protezione (macOS/Windows)', () => {
    const g = createGrants({ caseInsensitive: true }); g.grantFile(ORIG); g.setReadOnly(ORIG, true);
    expect(g.whyNotWrite('/archivio/2026/DETERMINA-12.pdf')).toMatch(/sola lettura/);
    expect(g.whyNotWrite('/Archivio/2026/../2026/./determina-12.pdf')).toMatch(/sola lettura/);
  });
  it('riaperto normalmente dall’utente: la protezione si toglie', () => {
    const g = createGrants(); g.grantFile(ORIG); g.setReadOnly(ORIG, true); g.setReadOnly(ORIG, false);
    expect(g.whyNotWrite(ORIG)).toBe(null);
  });
});
