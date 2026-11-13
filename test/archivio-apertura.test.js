// Ogni apertura dall'archivio è in sola lettura: PDF (openPath), .p7m, fatture XML, .eml (openFile), anche se il
// gestore dell'area che apre il file ignora le opzioni.
import { describe, it, expect } from 'vitest';
import { opzioniApertura, apriInSolaLettura } from '../src/renderer/features/archivio/lib/apertura.js';
import { Bus } from '../src/renderer/core/bus.js';

function finta() {
  const bus = new Bus();
  const chiamate = [];
  const app = {
    bus,
    async openPath(path, opts) { chiamate.push(['openPath', path, opts]); const doc = { name: 'a.pdf', readOnly: !!opts.readOnly }; bus.emit('document:loaded', { doc }); return doc; },
    // come un gestore che IGNORA le opzioni: apre il contenuto (PDF del .p7m, fattura impaginata) senza readOnly
    async openFile(file, opts) { chiamate.push(['openFile', file.name, opts]); const doc = { name: file.name + ' (contenuto).pdf' }; bus.emit('document:loaded', { doc }); return doc; },
  };
  return { app, chiamate };
}

describe('apertura dall\'archivio in sola lettura', () => {
  it('opzioni: readOnly sempre, pagina e ricerca se ci sono', () => {
    expect(opzioniApertura()).toEqual({ readOnly: true });
    expect(opzioniApertura({ q: '"colonna"', pagina: 3 })).toEqual({ readOnly: true, page: 3, search: 'colonna' });
  });
  it('PDF nell\'app: openPath con readOnly', async () => {
    const { app, chiamate } = finta();
    const docs = await apriInSolaLettura({ app, desktop: true, leggiBytes: async () => new Uint8Array() }, { ext: 'pdf', path: '/x/a.pdf', nome: 'a.pdf' }, { pagina: 2 });
    expect(chiamate[0]).toEqual(['openPath', '/x/a.pdf', { readOnly: true, page: 2 }]);
    expect(docs.every((d) => d.readOnly)).toBe(true);
  });
  for (const [ext, nome] of [['p7m', 'contratto.pdf.p7m'], ['xml', 'IT01234567890_FE1.xml'], ['eml', 'pec.eml'], ['pdf', 'web.pdf']]) {
    it(`${ext}: le opzioni arrivano al gestore e il documento aperto è comunque in sola lettura`, async () => {
      const { app, chiamate } = finta();
      const docs = await apriInSolaLettura({ app, desktop: ext !== 'pdf', leggiBytes: async () => new Uint8Array([1]) }, { ext, path: '/x/' + nome, nome }, {});
      expect(chiamate[0][0]).toBe('openFile');
      expect(chiamate[0][2]).toMatchObject({ readOnly: true });
      expect(docs).toHaveLength(1);
      expect(docs[0].readOnly).toBe(true);
    });
  }
  it('dopo l\'apertura non marca più i documenti aperti da altri', async () => {
    const { app } = finta();
    await apriInSolaLettura({ app, desktop: true, leggiBytes: async () => new Uint8Array() }, { ext: 'pdf', path: '/x/a.pdf', nome: 'a.pdf' });
    const altro = { name: 'utente.pdf' };
    app.bus.emit('document:loaded', { doc: altro });
    expect(altro.readOnly).toBeUndefined();
  });
});
