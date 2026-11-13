import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const require = createRequire(import.meta.url);
const S = require('../electron/core/segnalazione.cjs');

describe('Segnala un problema', () => {
  it('prepara una mail per lo sviluppatore con versione e sistema', () => {
    const m = S.preparaMail({ versione: '0.1.0', sistema: 'win32', versioneSistema: '10.0.22631' });
    expect(m.url.startsWith('mailto:lorenzo.birindelli@cnr.it?subject=')).toBe(true);
    const body = decodeURIComponent(m.url.split('&body=')[1]);
    expect(body).toContain('Versione di Leggio: 0.1.0');
    expect(body).toContain('Windows 10.0.22631');
    expect(decodeURIComponent(m.url.split('subject=')[1].split('&')[0])).toBe('Leggio 0.1.0: segnalazione di un problema');
  });

  it('non supera la lunghezza accettata dai programmi di posta, anche con molti errori', () => {
    const errori = Array.from({ length: 50 }, (_, i) => `2026-11-13 10:00:0${i % 10} [ERROR] (renderer) errore lungo ${'x'.repeat(200)}`);
    const m = S.preparaMail({ versione: '0.1.0', sistema: 'darwin', errori });
    expect(m.url.length).toBeLessThanOrEqual(S.MAX_URL);
    expect(m.corpo).toContain('Versione di Leggio');
  });

  it('dal registro prende solo avvisi ed errori, senza cartelle personali', () => {
    const testo = [
      '2026-11-13T09:00:00.123Z [INFO] (main) avvio',
      '2026-11-13T09:00:01.456Z [ERROR] (main) salvataggio non riuscito {"path":"/Users/mario/Documenti/Fatture/Fattura 12.pdf"}',
      '2026-11-13T09:00:02.000Z [WARN] (renderer) file C:\\Users\\Mario\\Desktop\\pratica\\ordine.pdf non trovato',
    ].join('\n');
    const righe = S.righeErrore(testo).map((r) => S.pulisci(r, '/Users/mario'));
    expect(righe).toHaveLength(2);
    expect(righe.join('\n')).not.toMatch(/mario|Mario|Documenti|Desktop/);
    expect(righe[0]).toContain('Fattura 12.pdf');
    expect(righe[1]).toContain('ordine.pdf');
    expect(righe[0].startsWith('2026-11-13 09:00:01')).toBe(true);
  });

  it('legge la coda del registro dal file e indica l\'immagine della finestra', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'leggio-segn-'));
    try {
      fs.writeFileSync(path.join(dir, 'leggio.log'), '2026-11-13T09:00:00.000Z [ERROR] (main) qualcosa\n');
      const m = S.mailDaRegistro({ logDir: dir, home: '', versione: '0.1.0', sistema: 'darwin', versioneSistema: '25.0', immagine: 'Leggio-segnalazione-x.png' });
      expect(m.corpo).toContain('qualcosa');
      expect(m.corpo).toContain('Leggio-segnalazione-x.png');
      expect(m.corpo).toContain('cartella Download');
      const vuota = S.mailDaRegistro({ logDir: path.join(dir, 'manca'), versione: '0.1.0' });
      expect(vuota.corpo).not.toContain('Ultimi errori');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  it('dà all\'immagine un nome con data e ora', () => {
    expect(S.nomeImmagine(new Date(2026, 10, 13, 9, 5, 7))).toBe('Leggio-segnalazione-2026-11-13-090507.png');
  });
});
