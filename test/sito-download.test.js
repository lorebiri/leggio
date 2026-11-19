// Pagina di download (site/): logica pura in site/scarica.js.
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  rilevaSistema, classificaFile, urlDownloadSicuro, urlApiFileSicuro, leggiRelease, leggiSomme,
  scegliPrincipale, formattaDimensione, formattaData, URL_RELEASES, CATALOGO,
  risparmioAnnuo, formattaEuro,
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

describe('quanto risparmi', () => {
  it('moltiplica le postazioni per il costo scritto da chi visita', () => {
    expect(risparmioAnnuo(10, 120)).toBe(1200);
    expect(risparmioAnnuo('25', '99.5')).toBe(2488);
    expect(risparmioAnnuo(3, '24,5')).toBe(74);
    expect(risparmioAnnuo(1, 0)).toBe(0);
  });
  it('rifiuta valori non validi', () => {
    for (const v of [0, -3, 2.5, NaN, '', 'dieci', null, 100001]) expect(risparmioAnnuo(v, 100), String(v)).toBeNull();
    for (const c of ['', null, -1, 'tanto', 100001]) expect(risparmioAnnuo(5, c), String(c)).toBeNull();
  });
  it('scrive gli euro all\'italiana', () => {
    expect(formattaEuro(290)).toBe('290 €');
    expect(formattaEuro(2930)).toBe('2.930 €');
    expect(formattaEuro(1463000)).toBe('1.463.000 €');
    expect(formattaEuro(NaN)).toBe('');
  });
});

describe('index.html', () => {
  const SITO = join(__dirname, '..', 'site');
  const html = readFileSync(join(SITO, 'index.html'), 'utf8');
  it('ha un posto per ogni file del catalogo e i contenitori usati da avvio.js', () => {
    for (const v of CATALOGO) expect(html, v.chiave).toContain(`data-file="${v.chiave}"`);
    for (const id of ['principale', 'versione', 'altri-sistemi', 'linux-presto', 'somme-nota', 'd-avvisi', 'd-verifica',
      'confronto', 'risparmio', 'esclusive', 'fiducia', 'calcolo', 'postazioni', 'costo', 'calcolo-esito', 'd-limiti']) expect(html, id).toContain(`id="${id}"`);
  });
  it('promessa e vantaggi in alto, prima del pulsante di download', () => {
    const h1 = html.indexOf('<h1'); const vantaggi = html.indexOf('class="vantaggi"'); const principale = html.indexOf('id="principale"');
    expect(h1).toBeGreaterThan(0);
    expect(h1).toBeLessThan(vantaggi);
    expect(vantaggi).toBeLessThan(principale);
    expect(html.match(/<h1\b/g)).toHaveLength(1);
  });
  // Scelta di Lorenzo: nessun nome di prodotto o azienda di terzi (si possono nominare solo i sistemi operativi, i chip dei Mac e GitHub).
  const VIETATI = ['Adobe', 'Acrobat', 'Reader', 'Foxit', 'PDF-XChange', 'XChange', 'Tracker Software', 'Nitro', 'Wondershare', 'PDFelement',
    'Smallpdf', 'iLovePDF', 'Edge', 'Chrome', 'Chromium', 'Firefox', 'Safari', 'Microsoft', 'Google', 'SmartScreen', 'OneDrive',
    'Word', 'Excel', 'PowerPoint', 'LibreOffice', 'Office', 'Dike', 'ArubaSign'];
  // antivirus: non si nominano nemmeno nella guida agli avvisi
  const ANTIVIRUS = ['Avast', 'AVG', 'Norton', 'McAfee', 'Kaspersky', 'Bitdefender', 'ESET', 'Avira', 'Malwarebytes', 'Trend Micro', 'Sophos', 'Panda'];
  const avvio = readFileSync(join(SITO, 'avvio.js'), 'utf8');
  for (const [nome, testo] of [['index.html', html], ['avvio.js', avvio]]) {
    it(`nessun nome di prodotti o aziende di terzi in ${nome}`, () => {
      for (const v of VIETATI) expect(testo, `${nome}: ${v}`).not.toMatch(new RegExp(`\\b${v.replace('-', '\\-')}\\b`, 'i'));
    });
  }
  it('nessun nome di terzi nel confronto, solo categorie', () => {
    const tabella = html.slice(html.indexOf('id="confronto"'), html.indexOf('</section>', html.indexOf('id="confronto"')));
    expect(tabella).toContain('<table class="confronto"');
    for (const v of [...VIETATI, ...ANTIVIRUS]) expect(tabella, `confronto: ${v}`).not.toMatch(new RegExp(`\\b${v.replace('-', '\\-')}\\b`, 'i'));
    for (const v of ['Windows', 'macOS', 'Apple', 'Edge', 'Chrome']) expect(tabella, `confronto: ${v}`).not.toMatch(new RegExp(`\\b${v}\\b`));
  });
  it('avviso di sicurezza ben visibile vicino al download, con link alla guida', () => {
    const principale = html.indexOf('id="principale"'); const box = html.indexOf('id="avvisi-sicurezza"'); const confronto = html.indexOf('id="confronto"');
    expect(box).toBeGreaterThan(principale);
    expect(box).toBeLessThan(confronto);
    const testo = html.slice(box, html.indexOf('</aside>', box));
    expect(testo).toContain('Al primo avvio Windows o macOS potrebbero avvisarti: ecco cosa fare');
    expect(testo).toContain('href="sicurezza.html"');
    for (const t of ['Ulteriori informazioni', 'Esegui comunque', 'Privacy e sicurezza', 'Apri comunque', 'chmod +x']) expect(testo, t).toContain(t);
    const faq = html.slice(html.indexOf('id="d-avvisi"'), html.indexOf('id="d-verifica"'));
    expect(faq).toContain('href="sicurezza.html"');
    expect(faq).not.toMatch(/clic destro[^<]*<\/em>[^<]*<em>Apri<\/em>, poi ancora/); // il vecchio trucco non basta più da macOS 15
    expect(avvio).toContain('sicurezza.html#');
  });
  it('nessun prezzo altrui e nessun disclaimer sui marchi', () => {
    for (const m of html.matchAll(/([\d.,]+)\s*€/g)) expect(m[1], m[0]).toBe('0');
    expect(html).not.toMatch(/sono marchi|è un marchio|marchio registrato/i);
    expect(html).not.toMatch(/tutto quello che fa/i);
  });
  it('confronto per categorie: Leggio e due colonne generiche, righe complete', () => {
    const tabella = html.slice(html.indexOf('<table class="confronto"'), html.indexOf('</table>'));
    const intest = [...tabella.slice(0, tabella.indexOf('</thead>')).matchAll(/<th scope="col"[^>]*>([^<]*)</g)].map((m) => m[1]).filter(Boolean);
    expect(intest).toEqual(['Leggio', 'Lettori PDF gratuiti', 'Editor PDF a pagamento']);
    const righe = [...tabella.slice(tabella.indexOf('<tbody>')).matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g)].map((m) => m[1]);
    expect(righe.length).toBeGreaterThanOrEqual(12);
    for (const r of righe) {
      expect((r.match(/<td\b/g) || []).length, r.slice(0, 80)).toBe(3);
      expect(r).toMatch(/<td class="noi">/);
    }
    // valori prudenti, niente assoluti sulle categorie
    const generiche = righe.flatMap((r) => [...r.matchAll(/<td>([^<]*)<\/td>/g)].map((m) => m[1]));
    for (const g of generiche) expect(g, g).not.toMatch(/^(Sì|No|Mai|Nessuno|Tutti)\b/);
    expect(generiche.some((g) => /di solito no/i.test(g))).toBe(true);
    for (const t of ['.p7m', 'fatture elettroniche', 'fronte/retro', 'Titulus', 'senza Internet', 'Prezzo']) expect(tabella, t).toContain(t);
    expect((tabella.match(/class="distintivo"|distintivo"/g) || []).length).toBeGreaterThanOrEqual(6);
    expect((tabella.match(/class="si"><span class="vh">Sì<\/span>/g) || []).length).toBe((tabella.match(/class="si"/g) || []).length);
  });
  it('«Quanto risparmi»: messaggio generico, senza cifre di terzi', () => {
    expect(html).toContain('Gli editor PDF professionali costano di solito un abbonamento annuale per ogni postazione. Leggio: 0 €, su tutti i computer che vuoi.');
  });
  it('fiducia: licenza, codice, nessun account, nessuna telemetria', () => {
    const f = html.slice(html.indexOf('id="fiducia"'), html.indexOf('</section>', html.indexOf('id="fiducia"')));
    for (const t of ['Open source', 'GPL', 'https://github.com/lorebiri/leggio"', 'Nessun account', 'Nessuna telemetria', 'File mai inviati']) expect(f, t).toContain(t);
    expect(html).toMatch(/non è firmato digitalmente/);
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

describe('sicurezza.html (avvisi di sicurezza)', () => {
  const SITO = join(__dirname, '..', 'site');
  const html = readFileSync(join(SITO, 'sicurezza.html'), 'utf8');
  const js = readFileSync(join(SITO, 'sicurezza.js'), 'utf8');
  const testo = html.replace(/<[^>]+>/g, ' ');

  it('spiega il perché in modo onesto e invita a scaricare solo dalle fonti ufficiali', () => {
    for (const t of ['non ha ancora una firma digitale a pagamento', 'Non vuol dire che contenga un virus', 'reputazione',
      'Il codice è aperto', 'li costruisce GitHub', 'SHA-256', 'solo dalla pagina ufficiale', 'GitHub Releases']) expect(testo, t).toContain(t);
    expect(html).toContain('href="https://github.com/lorebiri/leggio/releases"');
  });
  it('una guida per sistema, apribile, con le ancore usate dalla pagina principale', () => {
    for (const id of ['perche', 'guide', 'windows', 'mac', 'linux', 'smart-app-control', 'antivirus', 'verifica']) expect(html, id).toContain(`id="${id}"`);
    for (const s of ['windows', 'mac', 'linux']) expect(html, s).toMatch(new RegExp(`<details class="guida-sistema" id="${s}" data-sistema="${s}" open>`));
    expect(js).toMatch(/from '\.\/scarica\.js'/);
    expect(js).toContain('rilevaSistema');
  });
  it('Windows: browser, SmartScreen, Controllo intelligente delle app, antivirus', () => {
    for (const t of ['non viene scaricato comunemente', 'Mantieni', 'Mostra altro', 'Mantieni comunque', 'Scarica file sospetto',
      'Windows ha protetto il PC', 'Ulteriori informazioni', 'Esegui comunque',
      'Controllo intelligente delle app', 'non ha un pulsante per proseguire', 'Controllo app e browser', 'Impostazioni di Controllo intelligente delle app',
      'quarantena', 'Cronologia protezione', 'falso positivo']) expect(testo, t).toContain(t);
  });
  it('macOS: file giusto, «Apri comunque», niente più clic destro, xattr con avvertimento', () => {
    for (const t of ['mac-arm64.dmg', 'mac-x64.dmg', 'Informazioni su questo Mac', 'Impostazioni di Sistema', 'Privacy e sicurezza', 'Apri comunque',
      'Touch ID', 'Sposta nel Cestino', 'Da macOS 15 Sequoia questo trucco non basta più', 'circa un\'ora']) expect(testo, t).toContain(t);
    const xattr = html.slice(html.indexOf('class="esperti"'), html.indexOf('</details>', html.indexOf('class="esperti"')));
    expect(xattr).toContain('xattr -dr com.apple.quarantine /Applications/Leggio.app');
    expect(xattr).toMatch(/Attenzione/);
  });
  it('Linux: permesso di esecuzione, chmod +x, libfuse2', () => {
    for (const t of ['Consenti di eseguire il file come programma', 'chmod +x', 'libfuse2', 'libfuse2t64']) expect(testo, t).toContain(t);
  });
  it('verifica SHA-256 con i comandi da copiare per Windows, macOS e Linux', () => {
    const v = html.slice(html.indexOf('id="verifica"'));
    for (const t of ['Get-FileHash', '-Algorithm SHA256', 'shasum -a 256', 'sha256sum', 'SHA256SUMS.txt']) expect(v, t).toContain(t);
    expect((html.match(/<code data-copia>/g) || []).length).toBeGreaterThanOrEqual(6);
  });
  it('figure fatte in HTML e CSS: pulsanti evidenziati e numerati, nascoste ai lettori di schermo con didascalia', () => {
    const figure = [...html.matchAll(/<figure class="figura">([\s\S]*?)<\/figure>/g)].map((m) => m[1]);
    expect(figure.length).toBeGreaterThanOrEqual(4);
    for (const f of figure) {
      expect(f).toMatch(/class="finestra[^"]*" aria-hidden="true"/);
      expect(f).toMatch(/class="num">\d</);
      expect(f).toMatch(/evidenziat/);
      expect(f).toMatch(/<figcaption>/);
    }
    expect(html).not.toMatch(/<img\b(?![^>]*icona\.svg)/); // niente schermate: solo l'icona di Leggio
  });
  it('nessun nome di prodotti di terzi oltre ai sistemi e alle loro funzioni', () => {
    // ammessi perché servono a seguire i passi: Windows, macOS, Microsoft, Apple, Edge, Chrome, SmartScreen, GitHub e le distribuzioni Linux
    const vietati = ['Adobe', 'Acrobat', 'Reader', 'Foxit', 'PDF-XChange', 'Nitro', 'Wondershare', 'PDFelement', 'Smallpdf', 'iLovePDF',
      'Firefox', 'Safari', 'Opera', 'Brave', 'Google', 'OneDrive', 'Word', 'Excel', 'Office', 'LibreOffice', 'Dike', 'ArubaSign',
      'Avast', 'AVG', 'Norton', 'McAfee', 'Kaspersky', 'Bitdefender', 'ESET', 'Avira', 'Malwarebytes', 'Trend Micro', 'Sophos'];
    for (const [nome, t] of [['sicurezza.html', html], ['sicurezza.js', js]]) {
      for (const v of vietati) expect(t, `${nome}: ${v}`).not.toMatch(new RegExp(`\\b${v.replace('-', '\\-')}\\b`, 'i'));
    }
  });
  it('stesse regole della pagina principale: CSP, niente risorse esterne, link solo verso il repository', () => {
    expect(html).toMatch(/http-equiv="Content-Security-Policy"[^>]*script-src 'self'/);
    expect(html).not.toMatch(/<(script|link)\b[^>]*(src|href)="(https?:)?\/\//);
    expect(html).not.toMatch(/\bstyle="|<style\b|\bon[a-z]+="/);
    for (const m of html.matchAll(/href="(https?:[^"]+)"/g)) expect(m[1], m[1]).toMatch(/^https:\/\/github\.com\/lorebiri\/leggio(\/|$)/);
    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(html).toContain('lang="it"');
    expect(html).toContain('name="viewport"');
    for (const id of [...html.matchAll(/href="#([^"]+)"/g)].map((m) => m[1])) expect(html, `#${id}`).toContain(`id="${id}"`);
  });
});
