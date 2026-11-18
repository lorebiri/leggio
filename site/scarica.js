// Logica della pagina di download, senza DOM: riconosce il sistema, sceglie i file dell'ultima
// versione, legge SHA256SUMS.txt e scarta qualunque indirizzo che non sia di GitHub.
// Modulo puro: lo usa site/avvio.js nel browser e lo provano i test (test/sito-download.test.js).

export const REPO = 'lorebiri/leggio';
export const URL_API = `https://api.github.com/repos/${REPO}/releases/latest`;
export const URL_RELEASES = `https://github.com/${REPO}/releases/latest`;
export const URL_SORGENTE = `https://github.com/${REPO}`;

// I file pubblicati a ogni versione (nomi da package.json → build.artifactName).
// `chiave` è usata anche negli attributi data-file della pagina.
export const CATALOGO = [
  { chiave: 'win-installer', sistema: 'windows', etichetta: 'Windows — installer', breve: 'Installer per Windows', re: /^Leggio-[\w.+-]+-win-x64-installer\.exe$/i },
  { chiave: 'win-portatile', sistema: 'windows', etichetta: 'Windows — versione portatile', breve: 'Versione portatile', re: /^Leggio-[\w.+-]+-win-x64-portatile\.exe$/i },
  { chiave: 'mac-arm64-dmg', sistema: 'mac', etichetta: 'Mac con chip Apple (M1, M2, M3, M4…)', breve: 'Mac con chip Apple', re: /^Leggio-[\w.+-]+-mac-arm64\.dmg$/i },
  { chiave: 'mac-x64-dmg', sistema: 'mac', etichetta: 'Mac con processore Intel', breve: 'Mac con processore Intel', re: /^Leggio-[\w.+-]+-mac-x64\.dmg$/i },
  { chiave: 'mac-arm64-zip', sistema: 'mac', etichetta: 'Mac con chip Apple — archivio .zip', breve: 'Chip Apple (.zip)', re: /^Leggio-[\w.+-]+-mac-arm64\.zip$/i },
  { chiave: 'mac-x64-zip', sistema: 'mac', etichetta: 'Mac Intel — archivio .zip', breve: 'Intel (.zip)', re: /^Leggio-[\w.+-]+-mac-x64\.zip$/i },
  { chiave: 'linux-appimage', sistema: 'linux', etichetta: 'Linux — AppImage (x86_64)', breve: 'Linux AppImage', re: /^Leggio-[\w.+-]+-linux-x86_64\.AppImage$/i },
];
export const NOME_SOMME = 'SHA256SUMS.txt';

/**
 * Riconosce il sistema operativo del visitatore.
 * @param {{ platform?: string, userAgent?: string, maxTouchPoints?: number }} info
 *   platform: navigator.userAgentData.platform se il browser lo fornisce, altrimenti vuoto.
 * @returns {'windows'|'mac'|'linux'|'mobile'|'altro'}
 */
export function rilevaSistema({ platform = '', userAgent = '', maxTouchPoints = 0 } = {}) {
  const p = String(platform).toLowerCase();
  const ua = String(userAgent);
  if (p) {
    if (p === 'windows') return 'windows';
    if (p === 'macos') return 'mac';
    if (p === 'android' || p === 'ios') return 'mobile';
    if (p === 'linux') return /Android/i.test(ua) ? 'mobile' : 'linux';
    if (p === 'chrome os' || p === 'chromeos') return 'altro';
  }
  if (/Android|iPhone|iPad|iPod|Mobile/i.test(ua)) return 'mobile';
  if (/Windows NT|Win64|Windows/i.test(ua)) return 'windows';
  if (/Macintosh|Mac OS X/i.test(ua)) {
    // iPadOS si presenta come un Mac, ma ha lo schermo touch
    return maxTouchPoints > 1 ? 'mobile' : 'mac';
  }
  if (/CrOS/i.test(ua)) return 'altro';
  if (/Linux|X11|FreeBSD/i.test(ua)) return 'linux';
  return 'altro';
}

/** Riconosce un file dal nome: restituisce la voce del CATALOGO, 'somme' per SHA256SUMS.txt, oppure null. */
export function classificaFile(nome) {
  const n = String(nome || '');
  if (n === NOME_SOMME) return 'somme';
  const voce = CATALOGO.find((v) => v.re.test(n));
  return voce ? voce.chiave : null;
}

function parseUrl(url) {
  if (typeof url !== 'string' || url.length > 2048) return null;
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' || u.username || u.password || u.port) return null;
    return u;
  } catch { return null; }
}

/**
 * Vero solo per i link di download di GitHub: https://github.com/lorebiri/leggio/releases/…
 * (o objects.githubusercontent.com, dove GitHub conserva i file). Tutto il resto è rifiutato.
 */
export function urlDownloadSicuro(url) {
  const u = parseUrl(url);
  if (!u) return false;
  if (u.hostname === 'github.com') return u.pathname.startsWith(`/${REPO}/releases/`);
  return u.hostname === 'objects.githubusercontent.com';
}

/** Vero solo per l'indirizzo API di un file della release (serve per leggere SHA256SUMS.txt con CORS). */
export function urlApiFileSicuro(url) {
  const u = parseUrl(url);
  return !!u && u.hostname === 'api.github.com' && new RegExp(`^/repos/${REPO}/releases/assets/\\d+$`).test(u.pathname) && !u.search;
}

/**
 * Dalla risposta di /releases/latest ricava versione, data e i file riconosciuti.
 * I file con indirizzi non validi vengono ignorati. Restituisce null se la risposta non è utilizzabile.
 */
export function leggiRelease(json) {
  if (!json || typeof json !== 'object' || json.draft || json.prerelease) return null;
  const tag = String(json.tag_name || '');
  const m = /^v?(\d+\.\d+\.\d+(?:[-+][\w.-]+)?)$/.exec(tag);
  if (!m) return null;
  const file = {};
  let somme = null;
  for (const a of Array.isArray(json.assets) ? json.assets : []) {
    if (!a || typeof a !== 'object') continue;
    const tipo = classificaFile(a.name);
    if (!tipo || !urlDownloadSicuro(a.browser_download_url)) continue;
    const voce = {
      nome: a.name,
      url: a.browser_download_url,
      api: urlApiFileSicuro(a.url) ? a.url : null,
      dimensione: Number.isFinite(a.size) && a.size >= 0 ? a.size : null,
    };
    if (tipo === 'somme') somme = voce;
    else if (!file[tipo]) file[tipo] = voce;
  }
  const data = typeof json.published_at === 'string' && !Number.isNaN(Date.parse(json.published_at)) ? json.published_at : null;
  const pagina = urlDownloadSicuro(json.html_url) ? json.html_url : URL_RELEASES;
  return { versione: m[1], data, pagina, file, somme };
}

/**
 * Legge un file nel formato di `sha256sum`: «<64 cifre esadecimali>  <nome>» (anche «*<nome>» in modalità binaria).
 * Restituisce una Map nome → impronta in minuscolo. Le righe non valide vengono ignorate.
 */
export function leggiSomme(testo) {
  const somme = new Map();
  for (const riga of String(testo || '').split(/\r?\n/)) {
    const m = /^([0-9a-fA-F]{64}) [ *]?(.+?)\s*$/.exec(riga.trim());
    if (!m) continue;
    const nome = m[2].replace(/^\.?\//, '').split('/').pop();
    if (nome && !somme.has(nome)) somme.set(nome, m[1].toLowerCase());
  }
  return somme;
}

/**
 * Quali file proporre come pulsante principale.
 * @param {string} sistema  risultato di rilevaSistema
 * @param {object} file     release.file (può essere vuoto se l'API non ha risposto)
 * @param {string} [arch]   architettura dichiarata dal browser ('arm', 'x86'), se nota
 * @returns {{ sistema: string, chiavi: string[] }} chiavi nell'ordine di importanza
 */
export function scegliPrincipale(sistema, file = {}, arch = '') {
  if (sistema === 'windows') return { sistema, chiavi: ['win-installer'] };
  if (sistema === 'mac') {
    // dal browser spesso non si sa che chip ha il Mac: di regola si propone Apple Silicon,
    // Intel solo se il browser dice esplicitamente x86
    const intel = String(arch).toLowerCase().startsWith('x86');
    return { sistema, chiavi: intel ? ['mac-x64-dmg', 'mac-arm64-dmg'] : ['mac-arm64-dmg', 'mac-x64-dmg'] };
  }
  if (sistema === 'linux') return { sistema, chiavi: file['linux-appimage'] ? ['linux-appimage'] : [] };
  return { sistema, chiavi: [] };
}

/** 123456789 → «117,7 MB» */
export function formattaDimensione(byte) {
  if (!Number.isFinite(byte) || byte < 0) return '';
  if (byte < 1024 * 1024) return `${Math.max(1, Math.round(byte / 1024))} kB`;
  return `${(byte / 1048576).toLocaleString('it-IT', { maximumFractionDigits: 1, minimumFractionDigits: 1 })} MB`;
}

/** '2026-11-18T10:00:00Z' → «18 novembre 2026» */
export function formattaData(iso) {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  return new Date(t).toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Rome' });
}

export const NOMI_SISTEMA = { windows: 'Windows', mac: 'macOS', linux: 'Linux', mobile: 'telefono o tablet', altro: 'questo sistema' };

// ---- «Quanto risparmi» ----
// Nessun prezzo di terzi nella pagina: il calcolo usa solo i numeri scritti da chi la visita.

/**
 * Spesa annua che si evita con Leggio: postazioni × costo annuo per postazione indicato dall'utente.
 * @returns {number|null} null se le postazioni non sono un intero tra 1 e 100000 o il costo non è un numero tra 0 e 100000
 */
export function risparmioAnnuo(postazioni, costoPerPostazione) {
  const n = Number(postazioni);
  if (postazioni === '' || postazioni == null || !Number.isInteger(n) || n < 1 || n > 100000) return null;
  const c = typeof costoPerPostazione === 'string' ? Number(costoPerPostazione.trim().replace(',', '.')) : Number(costoPerPostazione);
  if (costoPerPostazione === '' || costoPerPostazione == null || !Number.isFinite(c) || c < 0 || c > 100000) return null;
  return Math.round(n * c);
}

/** 14630 → «14.630 €» */
export function formattaEuro(euro) {
  if (!Number.isFinite(euro)) return '';
  // separatore delle migliaia scritto a mano: alcuni browser non lo mettono sotto 10.000 in it-IT
  return `${String(Math.round(euro)).replace(/\B(?=(\d{3})+(?!\d))/g, '.')} €`;
}
