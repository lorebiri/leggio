import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { compareVersions, riassuntoNote, rimandato, novitaDaMostrare, TRE_GIORNI } from '../src/renderer/features/aggiornamenti/logica.js';
import { NOVITA } from '../src/renderer/features/aggiornamenti/novita.js';

const require = createRequire(import.meta.url);
const main = require('../electron/updater.cjs'); // in Node 'electron' è solo un percorso: le parti Electron restano inattive
const pkg = require('../package.json');

const casi = [
  ['0.2.0', '0.1.0', 1], ['0.1.0', '0.1.0', 0], ['0.1.10', '0.1.9', 1], ['v1.0.0', '0.9.9', 1],
  ['1.0.0-beta.1', '1.0.0', -1], ['1.0.0-beta.2', '1.0.0-beta.10', -1], ['1.0.0', '1.0.0-rc.1', 1],
  ['1.0.0-alpha', '1.0.0-alpha.1', -1], ['1.0.0-alpha.1', '1.0.0-alpha.beta', -1], ['1.0.0+build.5', '1.0.0', 0],
  ['non-una-versione', '1.0.0', 0], ['', '', 0],
];

describe('confronto versioni', () => {
  for (const [a, b, atteso] of casi) {
    it(`${a} vs ${b} → ${atteso}`, () => {
      expect(compareVersions(a, b)).toBe(atteso);
      expect(main.compareVersions(a, b)).toBe(atteso); // main e renderer devono dire la stessa cosa
    });
  }
});

describe('scelta del file da scaricare', () => {
  const v = '0.2.0';
  const assets = ['mac-arm64.dmg', 'mac-x64.dmg', 'mac-arm64.zip', 'win-x64-installer.exe', 'win-x64-portatile.exe', 'win-x64-installer.exe.blockmap']
    .map((s) => ({ name: `Leggio-${v}-${s}`, browser_download_url: `https://x/${s}` }));
  it('macOS Apple Silicon e Intel', () => {
    expect(main.pickAsset(assets, { platform: 'darwin', arch: 'arm64' }).name).toBe('Leggio-0.2.0-mac-arm64.dmg');
    expect(main.pickAsset(assets, { platform: 'darwin', arch: 'x64' }).name).toBe('Leggio-0.2.0-mac-x64.dmg');
  });
  it('Windows: installer, o portatile se in uso la versione portatile; ARM usa x64', () => {
    expect(main.pickAsset(assets, { platform: 'win32', arch: 'x64' }).name).toBe('Leggio-0.2.0-win-x64-installer.exe');
    expect(main.pickAsset(assets, { platform: 'win32', arch: 'arm64' }).name).toBe('Leggio-0.2.0-win-x64-installer.exe');
    expect(main.pickAsset(assets, { platform: 'win32', arch: 'x64', portable: true }).name).toBe('Leggio-0.2.0-win-x64-portatile.exe');
  });
  it('nessun file adatto → null (si apre la pagina della release)', () => {
    expect(main.pickAsset([], { platform: 'darwin', arch: 'arm64' })).toBeNull();
    expect(main.pickAsset(assets, { platform: 'linux', arch: 'x64' })).toBeNull();
  });
  it('i nomi coincidono con artifactName della configurazione di electron-builder', () => {
    expect(pkg.build.artifactName).toBe('Leggio-${version}-${os}-${arch}.${ext}');
    expect(pkg.build.nsis.artifactName).toBe('Leggio-${version}-win-${arch}-installer.${ext}');
    expect(pkg.build.portable.artifactName).toBe('Leggio-${version}-win-${arch}-portatile.${ext}');
  });
});

describe('riassunto delle note di release', () => {
  it('pulisce le note automatiche di GitHub', () => {
    const md = "## What's Changed\n* Unione di PDF più veloce by @lorebiri in https://github.com/lorebiri/leggio/pull/12\n* Corretto il **salvataggio** dei [moduli](https://x.y) by @altro in https://github.com/lorebiri/leggio/pull/13\n\n## New Contributors\n* @altro made their first contribution in https://github.com/lorebiri/leggio/pull/13\n\n**Full Changelog**: https://github.com/lorebiri/leggio/compare/v0.1.0...v0.2.0";
    expect(riassuntoNote(md)).toEqual({ righe: ['Unione di PDF più veloce', 'Corretto il salvataggio dei moduli'], altro: false });
  });
  it('limita le righe e segnala che ce ne sono altre', () => {
    const r = riassuntoNote('- a\n- b\n- c\n- `d`\n- _e_', 3);
    expect(r).toEqual({ righe: ['a', 'b', 'c'], altro: true });
  });
  it('corpo vuoto', () => { expect(riassuntoNote(null)).toEqual({ righe: [], altro: false }); });
});

describe('«Più tardi»', () => {
  const ora = 1_000_000;
  it('vale per la stessa versione fino alla scadenza', () => {
    const st = { versione: '0.2.0', fino: ora + TRE_GIORNI };
    expect(rimandato(st, '0.2.0', ora)).toBe(true);
    expect(rimandato(st, '0.2.0', ora + TRE_GIORNI + 1)).toBe(false);
    expect(rimandato(st, '0.3.0', ora)).toBe(false);
    expect(rimandato(null, '0.2.0', ora)).toBe(false);
  });
});

describe('novità di questa versione', () => {
  const elenco = [{ versione: '0.3.0' }, { versione: '0.2.0' }, { versione: '0.1.0' }, { versione: '0.4.0' }];
  it('prima installazione: niente', () => { expect(novitaDaMostrare(elenco, null, '0.3.0')).toEqual([]); });
  it('stessa versione o ritorno indietro: niente', () => {
    expect(novitaDaMostrare(elenco, '0.3.0', '0.3.0')).toEqual([]);
    expect(novitaDaMostrare(elenco, '0.3.0', '0.2.0')).toEqual([]);
  });
  it('aggiornamento saltando versioni: tutte quelle intermedie, dalla più recente', () => {
    expect(novitaDaMostrare(elenco, '0.1.0', '0.3.0').map((n) => n.versione)).toEqual(['0.3.0', '0.2.0']);
  });
  it('il file delle novità ha una voce per la versione di package.json', () => {
    expect(NOVITA.some((n) => n.versione === pkg.version)).toBe(true);
    for (const n of NOVITA) { expect(n.punti.length).toBeGreaterThan(0); expect(compareVersions(n.versione, '0.0.0')).toBe(1); }
  });
});
