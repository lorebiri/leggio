// Pagina di download sempre allineata all'ultima versione: dati statici in site/index.html,
// sezione «Novità» da novita.js, JSON-LD, sitemap e workflow di pubblicazione.
// Se un test qui fallisce dopo un cambio di versione o di novita.js: esegui `npm run sito` e fai il commit di site/.
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { NOVITA } from '../src/renderer/features/aggiornamenti/novita.js';
import {
  CATALOGO, URL_RELEASES, nomeFile, confrontaVersioni, ultimeNovita, leggiDatiStatici, classificaFile,
} from '../site/scarica.js';
import {
  applica, datiDaPackage, datiDaRelease, datiNellaPagina, sitemap, sostituisciBlocco, URL_SITO,
} from '../scripts/sito-aggiorna.mjs';

const RADICE = join(__dirname, '..');
const SITO = join(RADICE, 'site');
const leggi = (f) => readFileSync(join(RADICE, f), 'utf8').replace(/\r\n/g, '\n');
const PKG = JSON.parse(leggi('package.json'));
const html = leggi('site/index.html');
const dati = datiNellaPagina(html);
const AIUTO = 'esegui «npm run sito» e fai il commit di site/';

const V = '9.8.7';
const dl = (n) => `https://github.com/lorebiri/leggio/releases/download/v${V}/${n}`;
const asset = (name, id, size = 100000000 + id) => ({ name, id, size, url: `https://api.github.com/repos/lorebiri/leggio/releases/assets/${id}`, browser_download_url: dl(name) });
const releaseFinta = (extra = {}) => ({
  tag_name: `v${V}`, published_at: '2027-01-15T10:00:00Z', html_url: `https://github.com/lorebiri/leggio/releases/tag/v${V}`, draft: false, prerelease: false,
  assets: [...CATALOGO.map((v, i) => asset(nomeFile(v.chiave, V), i + 1)), asset('SHA256SUMS.txt', 99, 700)],
  ...extra,
});
const sommeFinte = CATALOGO.map((v, i) => `${String(i).repeat(64)}  ${nomeFile(v.chiave, V)}`).join('\n');

describe('versione scritta nella pagina', () => {
  it('coincide con package.json', () => {
    expect(dati, `dati-versione mancanti in index.html: ${AIUTO}`).toBeTruthy();
    expect(dati.versione, AIUTO).toBe(PKG.version);
    const letti = leggiDatiStatici(dati);
    expect(letti).toBeTruthy();
    expect(letti.versione).toBe(PKG.version);
  });
  it('i blocchi generati sono allineati a dati e novita.js (nessuna modifica a mano)', () => {
    expect(applica(html, dati, NOVITA) === html, AIUTO).toBe(true);
  });
  it('numero di versione visibile anche senza JavaScript, con tutti i file del catalogo', () => {
    expect(html).toMatch(new RegExp(`id="versione-testo">Versione ${PKG.version.replace(/\./g, '\\.')}[.,]`));
    const principale = html.slice(html.indexOf('<!-- sync:principale'), html.indexOf('<!-- /sync:principale'));
    expect(principale).toContain(`Scarica Leggio ${PKG.version}`);
    for (const v of CATALOGO) {
      const li = new RegExp(`<li data-file="${v.chiave}"[^>]*>([\\s\\S]*?)</li>`).exec(html);
      expect(li, v.chiave).toBeTruthy();
      expect(li[1], v.chiave).toContain(nomeFile(v.chiave, PKG.version));
      const href = /href="([^"]+)"/.exec(li[1])[1];
      expect(href === URL_RELEASES || href.endsWith(`/download/v${PKG.version}/${nomeFile(v.chiave, PKG.version)}`), href).toBe(true);
    }
  });
  it('se i dati vengono da GitHub ci sono data, dimensioni e impronte', () => {
    if (dati.fonte !== 'github') return;
    expect(dati.data).toMatch(/^\d{4}-\d\d-\d\dT/);
    for (const v of CATALOGO) {
      expect(dati.file[v.chiave]?.dimensione, v.chiave).toBeGreaterThan(1000000);
      expect(dati.file[v.chiave]?.sha256, v.chiave).toMatch(/^[0-9a-f]{64}$/);
      expect(html, v.chiave).toContain(`<code>${dati.file[v.chiave].sha256}</code>`);
    }
  });
});

describe('sezione «Novità»', () => {
  const sezione = html.slice(html.indexOf('<section id="novita"'), html.indexOf('</section>', html.indexOf('<section id="novita"')));
  const voci = [...sezione.matchAll(/data-versione="([^"]+)"/g)].map((m) => m[1]);
  it('c\'è la voce della versione corrente, in cima', () => {
    const voce = NOVITA.find((n) => n.versione === PKG.version);
    expect(voce, `manca in novita.js la voce per la ${PKG.version}`).toBeTruthy();
    expect(voci[0], AIUTO).toBe(PKG.version);
    expect(sezione).toContain(voce.titolo.replace(/&/g, '&amp;'));
    for (const p of voce.punti) expect(sezione).toContain(p.replace(/&/g, '&amp;'));
  });
  it('le ultime 3 versioni, dalla più nuova', () => {
    expect(voci).toEqual(ultimeNovita(NOVITA, PKG.version, 3).map((n) => n.versione));
    expect(voci.length).toBe(Math.min(3, NOVITA.length));
  });
  it('raggiungibile dal menu e dal numero di versione', () => {
    expect(html).toContain('<a href="#novita">Novità</a>');
    expect(html).toContain('<a href="#novita">Le novità</a>');
  });
});

describe('SEO', () => {
  const ld = JSON.parse(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html)[1]);
  it('JSON-LD SoftwareApplication con versione, data e prezzo zero', () => {
    expect(ld['@type']).toBe('SoftwareApplication');
    expect(ld.softwareVersion).toBe(PKG.version);
    if (dati.data) expect(ld.datePublished).toBe(new Date(dati.data).toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' }));
    expect(ld.offers).toMatchObject({ price: '0', priceCurrency: 'EUR' });
    expect(ld.operatingSystem).toMatch(/Windows.*macOS.*Linux/);
  });
  it('title, description, canonical e Open Graph con immagine presente', () => {
    expect(html).toMatch(/<title>[^<]{20,70}<\/title>/);
    const desc = /<meta name="description" content="([^"]+)"/.exec(html)[1];
    expect(desc.length).toBeGreaterThan(80);
    expect(html).toContain(`<link rel="canonical" href="${URL_SITO}">`);
    for (const p of ['og:title', 'og:description', 'og:url', 'og:image', 'og:type', 'og:locale']) expect(html, p).toContain(`property="${p}"`);
    const img = /property="og:image" content="([^"]+)"/.exec(html)[1];
    expect(img.startsWith(URL_SITO)).toBe(true);
    expect(existsSync(join(SITO, img.slice(URL_SITO.length)))).toBe(true);
    const sic = leggi('site/sicurezza.html');
    expect(sic).toContain(`<link rel="canonical" href="${URL_SITO}sicurezza.html">`);
    expect(sic).toContain('property="og:image"');
  });
  it('sitemap.xml allineata e robots.txt che la indica', () => {
    expect(leggi('site/sitemap.xml')).toBe(sitemap(dati));
    expect(leggi('site/sitemap.xml')).toContain(`<loc>${URL_SITO}sicurezza.html</loc>`);
    expect(leggi('site/robots.txt')).toContain(`Sitemap: ${URL_SITO}sitemap.xml`);
  });
  it('la pagina chiede dati solo all\'API di GitHub (le impronte sono già nella pagina)', () => {
    expect(html).toMatch(/connect-src https:\/\/api\.github\.com;/);
    expect(leggi('site/avvio.js')).not.toMatch(/caricaSomme|application\/octet-stream/);
  });
});

describe('scripts/sito-aggiorna.mjs', () => {
  it('dati da una release di GitHub: link diretti, dimensioni, impronte, date', () => {
    const d = datiDaRelease(releaseFinta(), sommeFinte, [{ ...releaseFinta(), tag_name: 'v9.8.6', published_at: '2026-12-01T09:00:00Z' }]);
    expect(d).toMatchObject({ versione: V, data: '2027-01-15T10:00:00Z', fonte: 'github', somme: { nome: 'SHA256SUMS.txt', url: dl('SHA256SUMS.txt') } });
    expect(d.file['win-installer']).toEqual({ nome: `Leggio-${V}-win-x64-installer.exe`, url: dl(`Leggio-${V}-win-x64-installer.exe`), dimensione: 100000001, sha256: '0'.repeat(64) });
    expect(d.date).toEqual({ '9.8.6': '2026-12-01T09:00:00Z', [V]: '2027-01-15T10:00:00Z' });
    expect(datiDaRelease({ ...releaseFinta(), draft: true })).toBeNull();
    expect(datiDaRelease({ message: 'API rate limit exceeded' })).toBeNull();
  });
  it('dati da package.json: nomi giusti, link alla pagina delle versioni, date già note conservate', () => {
    const d = datiDaPackage('1.0.0', { date: { '0.9.0': '2026-10-01T00:00:00Z' } });
    expect(d.fonte).toBe('package.json');
    expect(d.data).toBeNull();
    for (const v of CATALOGO) expect(d.file[v.chiave]).toEqual({ nome: nomeFile(v.chiave, '1.0.0'), url: URL_RELEASES, dimensione: null, sha256: null });
    expect(d.date['0.9.0']).toBe('2026-10-01T00:00:00Z');
    expect(leggiDatiStatici(d)).toBeTruthy();
  });
  it('scrive versione, file, impronte, JSON-LD e Novità; è idempotente', () => {
    const d = datiDaRelease(releaseFinta(), sommeFinte);
    const novita = [{ versione: '10.0.0', titolo: 'Futura', punti: ['non ancora pubblicata'] }, { versione: V, titolo: 'Prova <b>&</b>', punti: ['uno «due»'] }, ...NOVITA];
    const out = applica(html, d, novita);
    expect(applica(out, d, novita)).toBe(out);
    expect(out).toContain(`Versione ${V}, pubblicata il 15 gennaio 2027.`);
    expect(out).toContain(`href="${dl(`Leggio-${V}-mac-arm64.dmg`)}"`);
    expect(out).toContain('95,4 MB');
    expect(out).toContain(`<code>${'2'.repeat(64)}</code>`);
    expect(out).toContain('"softwareVersion":"9.8.7"');
    expect(out).toContain('"datePublished":"2027-01-15"');
    // le Novità si fermano alla versione pubblicata e il testo è protetto
    expect(out).not.toContain('Futura');
    expect(out).toContain('data-versione="9.8.7"');
    expect(out).toContain('Prova &lt;b&gt;&amp;&lt;/b&gt;');
    expect(datiNellaPagina(out)).toEqual(d);
    expect(out).not.toMatch(/<\/script>[^\n]*<\/script>/); // il JSON non può chiudere il blocco <script>
  });
  it('se manca un file nella release, la riga è nascosta (e Linux «presto disponibile»)', () => {
    const r = releaseFinta();
    r.assets = r.assets.filter((a) => !a.name.endsWith('.AppImage'));
    const out = applica(html, datiDaRelease(r, ''), NOVITA);
    expect(out).toContain('<li data-file="linux-appimage" class="assente">');
    expect(out).toMatch(/<p class="nota" id="linux-presto">/);
  });
  it('si rifiuta di lavorare su una pagina senza segnaposto', () => {
    expect(() => sostituisciBlocco('<html></html>', 'elenco', 'x')).toThrow(/sync:elenco/);
  });
});

describe('scarica.js: versioni e dati statici', () => {
  it('nomeFile e classificaFile sono coerenti', () => {
    for (const v of CATALOGO) expect(classificaFile(nomeFile(v.chiave, '0.2.2'))).toBe(v.chiave);
    expect(nomeFile('boh', '0.2.2')).toBeNull();
    expect(nomeFile('win-installer', 'x')).toBeNull();
  });
  it('confronta le versioni come numeri', () => {
    expect(confrontaVersioni('0.10.0', '0.9.9')).toBeGreaterThan(0);
    expect(confrontaVersioni('0.2.2', '0.2.2')).toBe(0);
    expect(confrontaVersioni('0.2.1', '0.2.2')).toBeLessThan(0);
  });
  it('ultimeNovita: le più nuove fino alla versione indicata', () => {
    expect(ultimeNovita(NOVITA, '0.2.1', 2).map((n) => n.versione)).toEqual(['0.2.1', '0.2.0']);
    expect(ultimeNovita(null, '1.0.0')).toEqual([]);
  });
  it('leggiDatiStatici scarta indirizzi estranei, impronte e date non valide', () => {
    const d = datiDaRelease(releaseFinta(), sommeFinte);
    d.file['win-installer'].url = 'https://evil.example/Leggio.exe';
    d.file['mac-x64-dmg'].sha256 = 'zz';
    d.date['1.0.0'] = 'boh';
    d.pagina = 'javascript:alert(1)';
    const l = leggiDatiStatici(d);
    expect(l.file['win-installer']).toBeUndefined();
    expect(l.file['mac-arm64-dmg'].url).toBe(dl(`Leggio-${V}-mac-arm64.dmg`));
    expect(l.impronte.has(`Leggio-${V}-mac-x64.dmg`)).toBe(false);
    expect(l.impronte.get(`Leggio-${V}-mac-arm64.dmg`)).toBe('2'.repeat(64));
    expect(l.date['1.0.0']).toBeUndefined();
    expect(l.pagina).toBe(URL_RELEASES);
    expect(leggiDatiStatici(null)).toBeNull();
    expect(leggiDatiStatici({ versione: 'x' })).toBeNull();
  });
});

describe('pubblicazione automatica', () => {
  const yml = leggi('.github/workflows/pages.yml');
  it('pages.yml parte alla pubblicazione di una release, ai push su main e a mano', () => {
    expect(yml).toMatch(/release:\s*\n\s*types: \[published\]/);
    expect(yml).toMatch(/push:\s*\n\s*branches: \[main\]/);
    for (const p of ["'site/**'", "'src/renderer/features/aggiornamenti/novita.js'"]) expect(yml, p).toContain(p);
    expect(yml).toContain('workflow_dispatch:');
    expect(yml).not.toMatch(/solo a mano/i);
  });
  it('prima di pubblicare scrive l\'ultima versione pubblicata, e i deploy partono da main', () => {
    expect(yml).toContain('node scripts/sito-aggiorna.mjs --pubblicata --dir _pagina');
    expect(yml).toMatch(/gh workflow run pages\.yml[^\n]*--ref/);
    expect(yml).toMatch(/if: github\.event_name != 'release'/);
  });
  it('documentazione aggiornata', () => {
    expect(leggi('site/LEGGIMI.md')).not.toMatch(/parte solo a mano/i);
    expect(leggi('site/LEGGIMI.md')).toContain('npm run sito');
    expect(leggi('docs/RILASCIO.md')).toContain('npm run sito');
    expect(PKG.scripts.sito).toBe('node scripts/sito-aggiorna.mjs');
  });
});
