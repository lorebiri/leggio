// Pagina di download (site/): logica pura in site/scarica.js.
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  rilevaSistema, classificaFile, urlDownloadSicuro, urlApiFileSicuro, leggiRelease, leggiSomme,
  scegliPrincipale, formattaDimensione, formattaData, URL_RELEASES, CATALOGO,
} from '../site/scarica.js';

const UA = {
  win: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0',
  winFirefox: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0',
  macSafari: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15',
  macChrome: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  linux: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  linuxFirefox: 'Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:133.0) Gecko/20100101 Firefox/133.0',
  android: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
  ipad: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15',
  chromeos: 'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
};

const V = '1.2.3';
const dl = (n) => `https://github.com/lorebiri/leggio/releases/download/v${V}/${n}`;
const asset = (name, id, extra = {}) => ({ name, id, size: 104857600 + id, url: `https://api.github.com/repos/lorebiri/leggio/releases/assets/${id}`, browser_download_url: dl(name), ...extra });
const releaseFinta = (assets) => ({ tag_name: `v${V}`, published_at: '2026-11-18T10:00:00Z', html_url: `https://github.com/lorebiri/leggio/releases/tag/v${V}`, draft: false, prerelease: false, assets });

describe('rilevaSistema', () => {
  it('usa userAgentData.platform quando c\'è', () => {
    expect(rilevaSistema({ platform: 'Windows', userAgent: UA.win })).toBe('windows');
    expect(rilevaSistema({ platform: 'macOS', userAgent: UA.macChrome })).toBe('mac');
    expect(rilevaSistema({ platform: 'Linux', userAgent: UA.linux })).toBe('linux');
    expect(rilevaSistema({ platform: 'Android', userAgent: UA.android })).toBe('mobile');
    expect(rilevaSistema({ platform: 'Chrome OS', userAgent: UA.chromeos })).toBe('altro');
  });
  it('ricade sullo userAgent', () => {
    expect(rilevaSistema({ userAgent: UA.win })).toBe('windows');
    expect(rilevaSistema({ userAgent: UA.winFirefox })).toBe('windows');
    expect(rilevaSistema({ userAgent: UA.macSafari })).toBe('mac');
    expect(rilevaSistema({ userAgent: UA.linuxFirefox })).toBe('linux');
    expect(rilevaSistema({ userAgent: UA.android })).toBe('mobile');
    expect(rilevaSistema({ userAgent: UA.iphone })).toBe('mobile');
    expect(rilevaSistema({ userAgent: UA.chromeos })).toBe('altro');
    expect(rilevaSistema({ userAgent: '' })).toBe('altro');
    expect(rilevaSistema()).toBe('altro');
  });
  it('riconosce l\'iPad che si finge Mac dallo schermo touch', () => {
    expect(rilevaSistema({ userAgent: UA.ipad, maxTouchPoints: 5 })).toBe('mobile');
    expect(rilevaSistema({ userAgent: UA.ipad, maxTouchPoints: 0 })).toBe('mac');
  });
});

describe('classificaFile', () => {
  it('riconosce i nomi pubblicati', () => {
    expect(classificaFile(`Leggio-${V}-win-x64-installer.exe`)).toBe('win-installer');
    expect(classificaFile(`Leggio-${V}-win-x64-portatile.exe`)).toBe('win-portatile');
    expect(classificaFile(`Leggio-${V}-mac-arm64.dmg`)).toBe('mac-arm64-dmg');
    expect(classificaFile(`Leggio-${V}-mac-x64.dmg`)).toBe('mac-x64-dmg');
    expect(classificaFile(`Leggio-${V}-mac-arm64.zip`)).toBe('mac-arm64-zip');
    expect(classificaFile(`Leggio-${V}-mac-x64.zip`)).toBe('mac-x64-zip');
    expect(classificaFile(`Leggio-${V}-linux-x86_64.AppImage`)).toBe('linux-appimage');
    expect(classificaFile('SHA256SUMS.txt')).toBe('somme');
  });
  it('ignora file accessori e nomi estranei', () => {
    expect(classificaFile(`Leggio-${V}-win-x64-installer.exe.blockmap`)).toBeNull();
    expect(classificaFile('latest.yml')).toBeNull();
    expect(classificaFile(`Altro-${V}-mac-arm64.dmg`)).toBeNull();
    expect(classificaFile(undefined)).toBeNull();
  });
});

describe('indirizzi', () => {
  it('accetta solo i download di GitHub in HTTPS', () => {
    expect(urlDownloadSicuro(dl('a.exe'))).toBe(true);
    expect(urlDownloadSicuro(URL_RELEASES)).toBe(true);
    expect(urlDownloadSicuro('https://objects.githubusercontent.com/github-production-release-asset/123')).toBe(true);
  });
  it('rifiuta tutto il resto', () => {
    for (const u of [
      'http://github.com/lorebiri/leggio/releases/download/v1/a.exe',
      'https://github.com.evil.example/lorebiri/leggio/releases/download/v1/a.exe',
      'https://evil.example/https://github.com/lorebiri/leggio/releases/',
      'https://github.com/altro/leggio/releases/download/v1/a.exe',
      'https://github.com/lorebiri/leggio/archive/main.zip',
      'https://user:pw@github.com/lorebiri/leggio/releases/download/v1/a.exe',
      'https://github.com:8443/lorebiri/leggio/releases/download/v1/a.exe',
      'javascript:alert(1)',
      'data:text/html,ciao',
      '//github.com/lorebiri/leggio/releases/',
      '', null, 42,
    ]) expect(urlDownloadSicuro(u), String(u)).toBe(false);
  });
  it('API dei file: solo api.github.com del repository', () => {
    expect(urlApiFileSicuro('https://api.github.com/repos/lorebiri/leggio/releases/assets/123')).toBe(true);
    expect(urlApiFileSicuro('https://api.github.com/repos/altro/leggio/releases/assets/123')).toBe(false);
    expect(urlApiFileSicuro('https://api.github.com/repos/lorebiri/leggio/releases/assets/123?x=1')).toBe(false);
    expect(urlApiFileSicuro('https://evil.example/repos/lorebiri/leggio/releases/assets/123')).toBe(false);
  });
});

describe('leggiRelease', () => {
  it('ricava versione, data e file', () => {
    const r = leggiRelease(releaseFinta([
      asset(`Leggio-${V}-win-x64-installer.exe`, 1), asset(`Leggio-${V}-win-x64-portatile.exe`, 2),
      asset(`Leggio-${V}-mac-arm64.dmg`, 3), asset(`Leggio-${V}-mac-x64.dmg`, 4),
      asset(`Leggio-${V}-win-x64-installer.exe.blockmap`, 5), asset('SHA256SUMS.txt', 6, { size: 600 }),
    ]));
    expect(r.versione).toBe(V);
    expect(r.data).toBe('2026-11-18T10:00:00Z');
    expect(Object.keys(r.file).sort()).toEqual(['mac-arm64-dmg', 'mac-x64-dmg', 'win-installer', 'win-portatile']);
    expect(r.file['win-installer']).toMatchObject({ nome: `Leggio-${V}-win-x64-installer.exe`, url: dl(`Leggio-${V}-win-x64-installer.exe`), dimensione: 104857601 });
    expect(r.file['win-installer'].api).toBe('https://api.github.com/repos/lorebiri/leggio/releases/assets/1');
    expect(r.somme.nome).toBe('SHA256SUMS.txt');
    expect(r.file['linux-appimage']).toBeUndefined();
  });
  it('scarta i file con indirizzi non di GitHub', () => {
    const r = leggiRelease(releaseFinta([
      asset(`Leggio-${V}-win-x64-installer.exe`, 1, { browser_download_url: 'https://evil.example/Leggio.exe' }),
      asset(`Leggio-${V}-mac-arm64.dmg`, 3, { url: 'https://evil.example/api' }),
    ]));
    expect(r.file['win-installer']).toBeUndefined();
    expect(r.file['mac-arm64-dmg'].api).toBeNull();
  });
  it('rifiuta risposte non valide, bozze e pre-release', () => {
    expect(leggiRelease(null)).toBeNull();
    expect(leggiRelease({ message: 'API rate limit exceeded' })).toBeNull();
    expect(leggiRelease({ ...releaseFinta([]), tag_name: 'pippo' })).toBeNull();
    expect(leggiRelease({ ...releaseFinta([]), draft: true })).toBeNull();
    expect(leggiRelease({ ...releaseFinta([]), prerelease: true })).toBeNull();
    const r = leggiRelease({ ...releaseFinta([]), html_url: 'https://evil.example/', assets: 'x' });
    expect(r.pagina).toBe(URL_RELEASES);
    expect(r.file).toEqual({});
  });
});

describe('leggiSomme', () => {
  const h1 = 'a'.repeat(64), h2 = 'B'.repeat(32) + '0123456789abcdef'.repeat(2);
  it('legge il formato di sha256sum', () => {
    const m = leggiSomme(`${h1}  Leggio-${V}-mac-arm64.dmg\r\n${h2} *Leggio-${V}-win-x64-installer.exe\n\n`);
    expect(m.get(`Leggio-${V}-mac-arm64.dmg`)).toBe(h1);
    expect(m.get(`Leggio-${V}-win-x64-installer.exe`)).toBe(h2.toLowerCase());
    expect(m.size).toBe(2);
  });
  it('toglie i percorsi e ignora le righe non valide', () => {
    const m = leggiSomme(`${h1}  ./release/Leggio-${V}-mac-x64.dmg\nciao mondo\n${'a'.repeat(63)}  corto.exe\n${'g'.repeat(64)}  nonhex.exe\n# commento`);
    expect([...m.keys()]).toEqual([`Leggio-${V}-mac-x64.dmg`]);
    expect(leggiSomme('').size).toBe(0);
    expect(leggiSomme(undefined).size).toBe(0);
  });
});

describe('scegliPrincipale', () => {
  it('Windows → installer', () => expect(scegliPrincipale('windows').chiavi).toEqual(['win-installer']));
  it('Mac → chip Apple prima, Intel come seconda scelta', () => {
    expect(scegliPrincipale('mac').chiavi).toEqual(['mac-arm64-dmg', 'mac-x64-dmg']);
    expect(scegliPrincipale('mac', {}, 'arm').chiavi).toEqual(['mac-arm64-dmg', 'mac-x64-dmg']);
    expect(scegliPrincipale('mac', {}, 'x86').chiavi).toEqual(['mac-x64-dmg', 'mac-arm64-dmg']);
  });
  it('Linux → AppImage solo se pubblicata', () => {
    expect(scegliPrincipale('linux', {}).chiavi).toEqual([]);
    expect(scegliPrincipale('linux', { 'linux-appimage': {} }).chiavi).toEqual(['linux-appimage']);
  });
  it('telefoni e sistemi sconosciuti → nessun file', () => {
    expect(scegliPrincipale('mobile').chiavi).toEqual([]);
    expect(scegliPrincipale('altro').chiavi).toEqual([]);
  });
});

describe('formattazione', () => {
  it('dimensioni e date in italiano', () => {
    expect(formattaDimensione(104857600)).toBe('100,0 MB');
    expect(formattaDimensione(2048)).toBe('2 kB');
    expect(formattaDimensione(null)).toBe('');
    expect(formattaData('2026-11-18T10:00:00Z')).toBe('18 novembre 2026');
    expect(formattaData('boh')).toBe('');
  });
});

describe('index.html', () => {
  const SITO = join(__dirname, '..', 'site');
  const html = readFileSync(join(SITO, 'index.html'), 'utf8');
  it('ha un posto per ogni file del catalogo e i contenitori usati da avvio.js', () => {
    for (const v of CATALOGO) expect(html, v.chiave).toContain(`data-file="${v.chiave}"`);
    for (const id of ['principale', 'versione', 'altri-sistemi', 'linux-presto', 'somme-nota', 'd-avvisi', 'd-verifica']) expect(html, id).toContain(`id="${id}"`);
  });
  it('immagini locali, presenti, con testo alternativo e leggere', () => {
    const img = [...html.matchAll(/<img\b[^>]*>/g)].map((m) => m[0]);
    const src = [...html.matchAll(/\b(?:src|srcset)="([^"]+)"/g)].map((m) => m[1]).filter((u) => !u.endsWith('.js'));
    expect(img.length).toBeGreaterThan(5);
    for (const t of img) expect(t, t).toMatch(/\balt="/);
    for (const u of src) {
      expect(u, u).not.toMatch(/^(https?:)?\/\//);
      expect(existsSync(join(SITO, u)), u).toBe(true);
      expect(statSync(join(SITO, u)).size, u).toBeLessThan(200 * 1024);
    }
  });
  it('nessuna risorsa esterna, link esterni solo verso il repository, nessuna email', () => {
    expect(html).toMatch(/http-equiv="Content-Security-Policy"[^>]*script-src 'self'/);
    expect(html).not.toMatch(/<(script|link)\b[^>]*(src|href)="(https?:)?\/\//);
    expect(html).not.toMatch(/\bstyle="|<style\b|\bon[a-z]+="/);
    const esterni = [...html.matchAll(/href="(https?:[^"]+)"/g)].map((m) => m[1]);
    for (const u of esterni) expect(u, u).toMatch(/^https:\/\/github\.com\/lorebiri\/leggio(\/|$)/);
    expect(html).not.toMatch(/mailto:/);
  });
});
