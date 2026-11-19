// Allinea la pagina di download (site/) all'ultima versione di Leggio, senza interventi a mano.
//
// Scrive dentro site/index.html, tra i segnaposto <!-- sync:NOME --> … <!-- /sync:NOME -->:
//   head       JSON-LD (SoftwareApplication con versione e data) e i dati della versione per avvio.js
//   principale il pulsante che si vede senza JavaScript
//   versione   «Versione X.Y.Z, pubblicata il …»
//   elenco     tutti i file con nome, dimensione, link diretto e impronta SHA-256
//   novita     la sezione «Novità» con le ultime 3 versioni di src/renderer/features/aggiornamenti/novita.js
// e rigenera site/sitemap.xml.
//
// Uso:
//   node scripts/sito-aggiorna.mjs                      versione di package.json (da fare prima del commit di un rilascio:
//                                                       `npm run sito`). Se quella versione è già su GitHub Releases prende
//                                                       anche data, dimensioni e impronte; altrimenti link alla pagina delle versioni.
//   node scripts/sito-aggiorna.mjs --pubblicata --dir _pagina
//                                                       ultima versione PUBBLICATA su GitHub Releases (lo usa .github/workflows/pages.yml).
//                                                       Se GitHub non risponde lascia i dati già scritti nella pagina.
// Variabile facoltativa GITHUB_TOKEN: evita il limite di richieste anonime dell'API.
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  REPO, URL_RELEASES, NOME_SOMME, CATALOGO, leggiRelease, leggiSomme, leggiDatiStatici, nomeFile,
  ultimeNovita, formattaDimensione, formattaData,
} from '../site/scarica.js';

export const URL_SITO = 'https://lorebiri.github.io/leggio/';
const RADICE = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const API = `https://api.github.com/repos/${REPO}`;

// ---- dati ----

/** Dati della versione presi solo da package.json (versione non ancora pubblicata, o GitHub non raggiungibile). */
export function datiDaPackage(versione, precedenti = null) {
  const file = {};
  for (const v of CATALOGO) file[v.chiave] = { nome: nomeFile(v.chiave, versione), url: URL_RELEASES, dimensione: null, sha256: null };
  const date = { ...(precedenti?.date || {}) };
  return { versione, data: date[versione] || null, pagina: URL_RELEASES, fonte: 'package.json', file, somme: null, date };
}

/** Dati della versione dalla risposta dell'API di GitHub (una release), dal testo di SHA256SUMS.txt e dall'elenco delle release. */
export function datiDaRelease(json, testoSomme = '', elenco = [], precedenti = null) {
  const r = leggiRelease(json);
  if (!r) return null;
  const impronte = leggiSomme(testoSomme);
  const file = {};
  for (const [chiave, f] of Object.entries(r.file)) file[chiave] = { nome: f.nome, url: f.url, dimensione: f.dimensione, sha256: impronte.get(f.nome) || null };
  const date = { ...(precedenti?.date || {}) };
  for (const x of Array.isArray(elenco) ? elenco : []) {
    const rx = leggiRelease(x);
    if (rx?.data) date[rx.versione] = rx.data;
  }
  if (r.data) date[r.versione] = r.data;
  return {
    versione: r.versione, data: r.data, pagina: r.pagina, fonte: 'github', file,
    somme: r.somme ? { nome: NOME_SOMME, url: r.somme.url } : null, date,
  };
}

/** I dati scritti nella pagina (blocco head), così come li legge avvio.js; null se mancano. */
export function datiNellaPagina(html) {
  const m = /<script type="application\/json" id="dati-versione">([\s\S]*?)<\/script>/.exec(String(html));
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch { return null; }
}

// ---- HTML ----

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const jsonInHtml = (o) => JSON.stringify(o).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
const giorno = (iso) => (iso ? new Date(Date.parse(iso)).toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' }) : '');

// Schede dei file: [chiave, testo del pulsante, descrizione, pulsante piccolo]
const SCHEDE = [
  { sistema: 'windows', id: 't-win', titolo: 'Windows 10 e 11', file: [
    ['win-installer', 'Installer', 'consigliato, crea l\'icona nel menu Start'],
    ['win-portatile', 'Versione portatile', 'si avvia senza installare nulla, anche da chiavetta'],
  ] },
  { sistema: 'mac', id: 't-mac', titolo: 'macOS 12 o successivo', file: [
    ['mac-arm64-dmg', 'Mac con chip Apple', 'M1, M2, M3, M4 e successivi'],
    ['mac-x64-dmg', 'Mac con processore Intel', ''],
    ['mac-arm64-zip', 'Chip Apple (.zip)', 'alternativa al .dmg', true],
    ['mac-x64-zip', 'Intel (.zip)', 'alternativa al .dmg', true],
  ], nota: '<p class="nota">Non sai che Mac hai? Menu Apple (la mela in alto a sinistra) → <em>Informazioni su questo Mac</em>: se leggi «Chip Apple M…» scegli <strong>chip Apple</strong>, se leggi «Processore Intel» scegli <strong>Intel</strong>.</p>' },
  { sistema: 'linux', id: 't-linux', titolo: 'Linux', file: [
    ['linux-appimage', 'AppImage (x86_64)', 'rendila eseguibile e aprila'],
  ] },
];

function rigaFile(dati, [chiave, testo, descrizione, piccolo], rientro) {
  const f = dati.file[chiave];
  const info = f ? [f.nome, formattaDimensione(f.dimensione)].filter(Boolean).join(' · ') : '';
  const pezzi = [
    `<a class="btn${piccolo ? ' piccolo' : ''}" href="${esc(f ? f.url : URL_RELEASES)}">${esc(testo)}</a>`,
    `<span class="file-info">${esc(info)}</span>`,
  ];
  if (descrizione) pezzi.push(`<span class="file-desc">${esc(descrizione)}</span>`);
  if (f?.sha256) pezzi.push(`<span class="impronta"><span>SHA-256:</span> <code>${esc(f.sha256)}</code></span>`);
  return `${rientro}<li data-file="${chiave}"${f ? '' : ' class="assente"'}>${pezzi.join(' ')}</li>`;
}

function bloccoElenco(dati) {
  const r = '      ';
  const righe = [`${r}<div class="griglia-file" id="elenco-file">`];
  for (const s of SCHEDE) {
    righe.push(`${r}  <article class="carta" data-sistema="${s.sistema}" aria-labelledby="${s.id}">`);
    righe.push(`${r}    <h3 id="${s.id}">${esc(s.titolo)}</h3>`);
    righe.push(`${r}    <ul class="file">`);
    for (const f of s.file) righe.push(rigaFile(dati, f, `${r}      `));
    righe.push(`${r}    </ul>`);
    if (s.nota) righe.push(`${r}    ${s.nota}`);
    if (s.sistema === 'linux') {
      righe.push(`${r}    <p class="nota" id="linux-presto"${dati.file['linux-appimage'] ? ' hidden' : ''}>Linux: presto disponibile. Nel frattempo puoi <a href="https://github.com/${REPO}">compilarlo dal codice sorgente</a> (servono Node.js e <code>npm run dev</code>).</p>`);
    }
    righe.push(`${r}  </article>`);
  }
  righe.push(`${r}</div>`);
  righe.push(dati.somme
    ? `${r}<p class="nota" id="somme-nota">Le impronte di tutti i file sono anche nel file <a href="${esc(dati.somme.url)}"><code>SHA256SUMS.txt</code></a> pubblicato insieme alla versione.</p>`
    : `${r}<p class="nota" id="somme-nota">Le impronte di tutti i file sono anche nel file <code>SHA256SUMS.txt</code> pubblicato insieme alla versione, sulla <a href="${URL_RELEASES}">pagina delle versioni</a>.</p>`);
  return righe.join('\n');
}

function testoVersione(dati) {
  const d = formattaData(dati.data);
  return `Versione ${dati.versione}${d ? `, pubblicata il ${d}` : ''}.`;
}

function bloccoVersione(dati) {
  return `        <p class="nota" id="versione"><span id="versione-testo">${esc(testoVersione(dati))}</span> <a href="#novita">Le novità</a></p>`;
}

function bloccoPrincipale(dati) {
  return [
    '          <div class="cta">',
    `            <a class="btn primario" href="${esc(dati.pagina)}">Scarica Leggio ${esc(dati.versione)} <small>da GitHub</small></a>`,
    '            <a class="btn" href="#altri-sistemi">Scegli il file per il tuo computer</a>',
    '          </div>',
    '          <p class="nota">Windows 10 e 11 · macOS 12 o successivo · Linux (AppImage, x86_64).</p>',
  ].join('\n');
}

function bloccoNovita(dati, novita) {
  const voci = ultimeNovita(novita, dati.versione, 3);
  const r = '      ';
  const righe = [
    `${r}<p class="occhiello">Novità</p>`,
    `${r}<h2 id="t-novita">Cosa c'è di nuovo in Leggio</h2>`,
    `${r}<p class="intro">Le ultime versioni, in breve. Leggio ti avvisa da solo quando ne esce una nuova: documenti e impostazioni restano al loro posto.</p>`,
    `${r}<ol class="novita">`,
  ];
  for (const v of voci) {
    const d = dati.date?.[v.versione];
    righe.push(`${r}  <li class="carta voce-novita" data-versione="${esc(v.versione)}">`);
    righe.push(`${r}    <h3><span class="novita-versione">Leggio ${esc(v.versione)}</span> ${esc(v.titolo)}</h3>`);
    if (d) righe.push(`${r}    <p class="nota novita-data">Pubblicata il <time datetime="${giorno(d)}">${esc(formattaData(d))}</time></p>`);
    righe.push(`${r}    <ul class="punti">`);
    for (const p of v.punti || []) righe.push(`${r}      <li>${esc(p)}</li>`);
    righe.push(`${r}    </ul>`);
    righe.push(`${r}  </li>`);
  }
  righe.push(`${r}</ol>`);
  righe.push(`${r}<p class="nota"><a href="https://github.com/${REPO}/releases">Tutte le versioni e le note complete su GitHub</a></p>`);
  return righe.join('\n');
}

function bloccoHead(dati) {
  const installer = dati.file['win-installer'];
  const ld = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'Leggio',
    description: 'Lettore ed editor PDF libero e gratuito per l\'ufficio italiano: modifica, oscura, firma, unisci e converti i PDF; apre e verifica i .p7m e le fatture elettroniche XML. Senza account e senza Internet.',
    url: URL_SITO,
    image: `${URL_SITO}img/anteprima.png`,
    screenshot: `${URL_SITO}img/inizio.webp`,
    applicationCategory: 'BusinessApplication',
    operatingSystem: 'Windows 10, Windows 11, macOS 12 o successivo, Linux',
    inLanguage: 'it',
    isAccessibleForFree: true,
    license: 'https://www.gnu.org/licenses/gpl-3.0.html',
    author: { '@type': 'Person', name: 'Lorenzo Birindelli' },
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'EUR' },
    softwareVersion: dati.versione,
    ...(dati.data ? { datePublished: giorno(dati.data) } : {}),
    downloadUrl: dati.pagina,
    releaseNotes: dati.fonte === 'github' ? dati.pagina : `https://github.com/${REPO}/releases`,
    ...(installer?.dimensione ? { fileSize: formattaDimensione(installer.dimensione).replace(',', '.') } : {}),
  };
  return [
    `<script type="application/ld+json">${jsonInHtml(ld)}</script>`,
    `<script type="application/json" id="dati-versione">${jsonInHtml(dati)}</script>`,
  ].join('\n');
}

/** Sostituisce il contenuto di un blocco <!-- sync:nome --> … <!-- /sync:nome -->. Errore se il blocco non c'è. */
export function sostituisciBlocco(html, nome, contenuto) {
  const re = new RegExp(`(<!-- sync:${nome}\\b[^>]*-->)[\\s\\S]*?(\\n[ \\t]*<!-- /sync:${nome} -->)`);
  if (!re.test(html)) throw new Error(`Blocco «sync:${nome}» non trovato in index.html`);
  return html.replace(re, (_, a, b) => `${a}\n${contenuto}${b}`);
}

/** Scrive i dati della versione e le Novità dentro index.html. Funzione pura: stessa entrata → stessa uscita. */
export function applica(html, dati, novita) {
  let out = String(html).replace(/\r\n/g, '\n');
  out = sostituisciBlocco(out, 'head', bloccoHead(dati));
  out = sostituisciBlocco(out, 'principale', bloccoPrincipale(dati));
  out = sostituisciBlocco(out, 'versione', bloccoVersione(dati));
  out = sostituisciBlocco(out, 'elenco', bloccoElenco(dati));
  out = sostituisciBlocco(out, 'novita', bloccoNovita(dati, novita));
  return out;
}

export function sitemap(dati) {
  const lastmod = dati.data ? `<lastmod>${giorno(dati.data)}</lastmod>` : '';
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${URL_SITO}</loc>${lastmod}</url>
  <url><loc>${URL_SITO}sicurezza.html</loc></url>
</urlset>
`;
}

// ---- rete ----

async function leggiJson(url) {
  const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'leggio-sito' };
  let r = null;
  if (process.env.GITHUB_TOKEN) {
    r = await fetch(url, { headers: { ...headers, Authorization: `Bearer ${process.env.GITHUB_TOKEN}` }, signal: AbortSignal.timeout(20000) });
    if (r.status === 401) r = null; // token non valido per l'API: si riprova senza
  }
  r ??= await fetch(url, { headers, signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`${url}: GitHub ha risposto ${r.status}`);
  return r.json();
}

async function leggiTestoSomme(release) {
  const a = (release.assets || []).find((x) => x?.name === NOME_SOMME);
  if (!a) return '';
  try {
    const r = await fetch(a.browser_download_url, { headers: { 'User-Agent': 'leggio-sito' }, signal: AbortSignal.timeout(20000) });
    return r.ok ? (await r.text()).slice(0, 100000) : '';
  } catch { return ''; }
}

async function daGitHub(percorso, precedenti) {
  const release = await leggiJson(`${API}${percorso}`);
  const [somme, elenco] = await Promise.all([leggiTestoSomme(release), leggiJson(`${API}/releases?per_page=20`).catch(() => [])]);
  return datiDaRelease(release, somme, elenco, precedenti);
}

// ---- riga di comando ----

async function main(argv) {
  const pubblicata = argv.includes('--pubblicata');
  const i = argv.indexOf('--dir');
  const dir = resolve(i >= 0 ? argv[i + 1] : join(RADICE, 'site'));
  const versionePkg = JSON.parse(readFileSync(join(RADICE, 'package.json'), 'utf8')).version;
  const { NOVITA } = await import(pathToFileURL(join(RADICE, 'src/renderer/features/aggiornamenti/novita.js')).href);
  const percorsoHtml = join(dir, 'index.html');
  const html = readFileSync(percorsoHtml, 'utf8');
  const precedenti = datiNellaPagina(html);

  let dati = null;
  if (pubblicata) {
    try { dati = await daGitHub('/releases/latest', precedenti); } catch (e) { console.warn(`Avviso: ${e.message}`); }
    if (!dati) {
      console.warn('Avviso: ultima versione pubblicata non disponibile, restano i dati già scritti nella pagina.');
      dati = leggiDatiStatici(precedenti) ? precedenti : datiDaPackage(versionePkg, precedenti);
    } else if (dati.versione !== versionePkg) {
      console.log(`Nota: l'ultima versione pubblicata è la ${dati.versione}, package.json dice ${versionePkg} (normale prima di pubblicare la release).`);
    }
  } else {
    try { dati = await daGitHub(`/releases/tags/v${versionePkg}`, precedenti); } catch (e) { console.log(`La ${versionePkg} non è (ancora) su GitHub Releases: ${e.message}`); }
    if (!dati && precedenti?.versione === versionePkg && precedenti.fonte === 'github' && leggiDatiStatici(precedenti)) dati = precedenti;
    if (!dati) dati = datiDaPackage(versionePkg, precedenti);
  }

  writeFileSync(percorsoHtml, applica(html, dati, NOVITA));
  writeFileSync(join(dir, 'sitemap.xml'), sitemap(dati));
  console.log(`Pagina allineata a Leggio ${dati.versione} (fonte: ${dati.fonte}${dati.data ? `, ${giorno(dati.data)}` : ''}).`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch((e) => { console.error(e); process.exit(1); });
}
