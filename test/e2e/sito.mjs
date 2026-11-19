// Collaudo della pagina di download (site/) con Playwright, senza rete verso GitHub (risposte simulate).
// Uso: node test/e2e/sito.mjs [cartella-schermate]      (npm run collaudo:sito)
// Prova: pulsante e file giusti per Windows, macOS (chip Apple e Intel), Linux e telefono; GitHub che risponde con una
// versione più nuova, in errore, con il limite di richieste, lento o irraggiungibile; JavaScript spento; telefono e
// tablet in tema chiaro e scuro (niente scorrimento orizzontale); errori in console.
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { datiNellaPagina } from '../../scripts/sito-aggiorna.mjs';
import { CATALOGO, nomeFile } from '../../site/scarica.js';

const RADICE = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SITO = join(RADICE, 'site');
const { chromium } = createRequire(join(RADICE, 'package.json'))('playwright');
const SCHERMATE = process.argv[2] || '';
if (SCHERMATE) mkdirSync(SCHERMATE, { recursive: true });

const STATICA = datiNellaPagina(readFileSync(join(SITO, 'index.html'), 'utf8'));
const VS = STATICA.versione;

// ---- server statico ----
const TIPI = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.png': 'image/png', '.xml': 'application/xml', '.txt': 'text/plain' };
const server = createServer((req, res) => {
  const percorso = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^([/\\])+/, '');
  const file = join(SITO, percorso || 'index.html');
  if (!file.startsWith(SITO) || !existsSync(file)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': TIPI[extname(file)] || 'application/octet-stream' });
  res.end(readFileSync(file));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}/`;

// ---- GitHub simulato ----
const NUOVA = '0.99.0';
const releaseFinta = (v) => ({
  tag_name: `v${v}`, published_at: '2027-03-01T10:00:00Z', html_url: `https://github.com/lorebiri/leggio/releases/tag/v${v}`, draft: false, prerelease: false,
  assets: CATALOGO.map((c, i) => ({ name: nomeFile(c.chiave, v), size: 140000000 + i, url: `https://api.github.com/repos/lorebiri/leggio/releases/assets/${i + 1}`, browser_download_url: `https://github.com/lorebiri/leggio/releases/download/v${v}/${nomeFile(c.chiave, v)}` })),
});
const CORS = { 'access-control-allow-origin': '*' };
async function rotte(page, modo) {
  await page.route('https://api.github.com/**', async (route) => {
    if (modo === 'nuova') return route.fulfill({ status: 200, contentType: 'application/json', headers: CORS, body: JSON.stringify(releaseFinta(NUOVA)) });
    if (modo === 'uguale') return route.fulfill({ status: 200, contentType: 'application/json', headers: CORS, body: JSON.stringify(releaseFinta(VS)) });
    if (modo === 'limite') return route.fulfill({ status: 403, contentType: 'application/json', headers: { ...CORS, 'x-ratelimit-remaining': '0' }, body: '{"message":"API rate limit exceeded"}' });
    if (modo === 'errore') return route.fulfill({ status: 500, headers: CORS, body: '' });
    if (modo === 'lenta') { await new Promise((r) => setTimeout(r, 15000)); return route.abort().catch(() => {}); }
    return route.abort('internetdisconnected');
  });
}

// ---- profili ----
const UA = {
  win: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  safari: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15',
  linux: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  android: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
};
const PROFILI = {
  windows: { ua: UA.win, uad: { platform: 'Windows', architecture: 'x86' } },
  'mac-apple': { ua: UA.mac, uad: { platform: 'macOS', architecture: 'arm' } },
  'mac-intel': { ua: UA.mac, uad: { platform: 'macOS', architecture: 'x86' } },
  'mac-safari': { ua: UA.safari, uad: null },
  linux: { ua: UA.linux, uad: { platform: 'Linux', architecture: 'x86' } },
  telefono: { ua: UA.android, uad: { platform: 'Android', architecture: 'arm' }, mobile: true },
};

const browser = await chromium.launch();
let falliti = 0;
const ok = (cond, msg) => { if (!cond) { falliti++; console.log(`  ✗ ${msg}`); } };

async function apri({ profilo = 'windows', modo = 'uguale', vp = [1366, 900], tema = 'light', js = true, pagina = '', attesa = 1200 }) {
  const p = PROFILI[profilo];
  const ctx = await browser.newContext({ userAgent: p.ua, viewport: { width: vp[0], height: vp[1] }, colorScheme: tema, javaScriptEnabled: js, isMobile: !!p.mobile, hasTouch: !!p.mobile, deviceScaleFactor: SCHERMATE ? 2 : 1 });
  await ctx.addInitScript((uad) => {
    const d = uad && { platform: uad.platform, mobile: false, brands: [], getHighEntropyValues: async () => ({ architecture: uad.architecture }) };
    Object.defineProperty(Navigator.prototype, 'userAgentData', { get: () => d || undefined, configurable: true });
  }, p.uad);
  const page = await ctx.newPage();
  const errori = [];
  page.on('pageerror', (e) => errori.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errori.push(m.text()); });
  page.on('requestfailed', (r) => { if (!r.url().startsWith('https://api.github.com/')) errori.push(`richiesta fallita ${r.url()}`); });
  page.on('response', (r) => { if (r.url().startsWith(BASE) && r.status() >= 400) errori.push(`HTTP ${r.status()} ${r.url()}`); });
  await rotte(page, modo);
  await page.goto(BASE + pagina, { waitUntil: 'load' });
  await page.waitForTimeout(attesa);
  const stato = await page.evaluate(() => ({
    principale: [...document.querySelectorAll('#principale a')].map((a) => ({ testo: a.textContent.replace(/\s+/g, ' ').trim(), href: a.getAttribute('href') })),
    versione: document.querySelector('#versione-testo')?.textContent.trim() || '',
    avviso: /Non riesco a leggere/.test(document.querySelector('#principale')?.textContent || ''),
    largo: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    impronte: document.querySelectorAll('#elenco-file .impronta').length,
    novita: document.querySelectorAll('#novita .voce-novita').length,
  }));
  return { ctx, page, stato, errori };
}
const fine = async (r, nome) => {
  ok(!r.errori.length, `${nome}: errori in console ${JSON.stringify(r.errori)}`);
  await r.ctx.close();
};
const foto = async (r, nome, intera = false) => { if (SCHERMATE) await r.page.screenshot({ path: join(SCHERMATE, `${nome}.png`), fullPage: intera }); };
const primo = (s) => s.principale[0] || { testo: '', href: '' };
const fileStatico = (chiave) => STATICA.file[chiave];

// 1. sistemi: il pulsante e il file giusti, con versione e dimensione
const ATTESI = { windows: 'win-installer', 'mac-apple': 'mac-arm64-dmg', 'mac-intel': 'mac-x64-dmg', 'mac-safari': 'mac-arm64-dmg', linux: 'linux-appimage' };
for (const [profilo, chiave] of Object.entries(ATTESI)) {
  console.log(`• ${profilo}`);
  const r = await apri({ profilo });
  const f = fileStatico(chiave);
  ok(primo(r.stato).href === f.url, `${profilo}: link ${primo(r.stato).href} invece di ${f.url}`);
  ok(primo(r.stato).testo.includes(`versione ${VS}`), `${profilo}: manca la versione nel pulsante («${primo(r.stato).testo}»)`);
  if (f.dimensione) ok(/\d,\d MB/.test(primo(r.stato).testo), `${profilo}: manca la dimensione nel pulsante`);
  ok(r.stato.versione.startsWith(`Versione ${VS}`), `${profilo}: testo versione «${r.stato.versione}»`);
  if (STATICA.fonte === 'github') ok(r.stato.impronte === CATALOGO.length, `${profilo}: impronte ${r.stato.impronte}`);
  ok(r.stato.novita === 3, `${profilo}: voci Novità ${r.stato.novita}`);
  if (profilo === 'mac-apple' || profilo === 'mac-intel') ok(r.stato.principale.length >= 2, `${profilo}: manca la seconda scelta per l'altro chip`);
  if (profilo === 'windows') await foto(r, 'desktop-windows-chiaro');
  await fine(r, profilo);
}
{
  console.log('• telefono');
  const r = await apri({ profilo: 'telefono', vp: [390, 844] });
  ok(primo(r.stato).href === '#altri-sistemi', 'telefono: deve proporre la scelta del file');
  await fine(r, 'telefono');
}

// 2. GitHub: versione più nuova, poi i casi in cui non risponde
{
  console.log('• GitHub con una versione più nuova');
  const r = await apri({ profilo: 'windows', modo: 'nuova' });
  ok(r.stato.versione.startsWith(`Versione ${NUOVA}`), `nuova: testo versione «${r.stato.versione}»`);
  ok(primo(r.stato).href.endsWith(`/v${NUOVA}/${nomeFile('win-installer', NUOVA)}`), `nuova: link ${primo(r.stato).href}`);
  ok(r.stato.impronte === 0, 'nuova: non deve mostrare le impronte della versione precedente');
  await fine(r, 'nuova');
}
for (const modo of ['limite', 'errore', 'giu', 'lenta']) {
  console.log(`• GitHub: ${modo}`);
  const r = await apri({ profilo: 'mac-apple', modo, attesa: modo === 'lenta' ? 2500 : 1200 });
  ok(primo(r.stato).href === fileStatico('mac-arm64-dmg').url, `${modo}: link ${primo(r.stato).href}`);
  ok(r.stato.versione.startsWith(`Versione ${VS}`), `${modo}: testo versione «${r.stato.versione}»`);
  ok(!r.stato.avviso, `${modo}: con i dati della pagina non serve l'avviso di errore`);
  await fine(r, modo);
}

// 3. JavaScript spento
{
  console.log('• senza JavaScript');
  const r = await apri({ profilo: 'windows', js: false });
  ok(primo(r.stato).testo.startsWith(`Scarica Leggio ${VS}`), `no-js: pulsante «${primo(r.stato).testo}»`);
  ok(r.stato.versione.startsWith(`Versione ${VS}`), `no-js: testo versione «${r.stato.versione}»`);
  const li = await r.page.locator('[data-file="win-installer"] a').getAttribute('href');
  ok(li === fileStatico('win-installer').url, `no-js: link dell'installer ${li}`);
  await foto(r, 'senza-javascript');
  await fine(r, 'no-js');
}

// 4. telefono e tablet, chiaro e scuro: niente scorrimento orizzontale
for (const [nome, profilo, vp] of [['telefono', 'telefono', [390, 844]], ['telefono-piccolo', 'telefono', [320, 640]], ['tablet', 'mac-apple', [820, 1180]], ['desktop', 'windows', [1366, 900]]]) {
  for (const tema of ['light', 'dark']) {
    for (const pagina of ['', 'sicurezza.html']) {
      const r = await apri({ profilo, vp, tema, pagina });
      ok(r.stato.largo <= 0, `${nome} ${tema} ${pagina || 'index'}: scorrimento orizzontale di ${r.stato.largo}px`);
      const etichetta = `${pagina ? 'sicurezza-' : ''}${nome}-${tema === 'light' ? 'chiaro' : 'scuro'}`;
      if (nome !== 'telefono-piccolo') await foto(r, etichetta);
      if (nome === 'desktop' && !pagina && tema === 'light' && SCHERMATE) {
        await r.page.locator('#novita').scrollIntoViewIfNeeded();
        await r.page.locator('#novita').screenshot({ path: join(SCHERMATE, 'novita.png') });
        await r.page.locator('#altri-sistemi').screenshot({ path: join(SCHERMATE, 'tutti-i-file.png') });
      }
      await fine(r, etichetta);
    }
  }
}

await browser.close();
server.close();
console.log(falliti ? `\n${falliti} controlli falliti` : '\nTutti i controlli sono passati.');
process.exit(falliti ? 1 : 0);
