// Leggio — avviso aggiornamenti (lato main), senza electron-updater.
//
// Cosa fa: qualche secondo dopo l'avvio e poi ogni 24 ore (se l'app resta aperta) chiede a GitHub
// qual è l'ultima release pubblicata di lorebiri/leggio. Se è più recente della versione in uso,
// manda al renderer 'app:update-available' { version, name, url, notes, downloadUrl, downloadName }.
// L'avviso vero e proprio lo mostra l'area src/renderer/features/aggiornamenti/.
// Dal menu Aiuto → «Controlla aggiornamenti…» il controllo si fa subito e risponde sempre
// con un dialogo nativo (anche «Hai già l'ultima versione»).
//
// Privacy: una sola richiesta GET anonima all'API pubblica di GitHub. Nessun dato dell'utente,
// nessun identificativo, nessuna telemetria.
//
// Preferenze: il renderer comunica l'impostazione «Controlla automaticamente gli aggiornamenti»
// con invoke('app:update-prefs', { auto }). Variabili d'ambiente:
//   LEGGIO_NO_UPDATE_CHECK=1  spegne il controllo automatico (il menu resta disponibile)
//   LEGGIO_UPDATE_TEST=1      collaudo: simula una release più nuova (anche fuori dall'app installata);
//                             in questa modalità non scrive nulla su disco
const { app, dialog, shell, net, ipcMain } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

const REPO = 'lorebiri/leggio';
const API = `https://api.github.com/repos/${REPO}/releases/latest`;
const RELEASES = `https://github.com/${REPO}/releases/latest`;
const DAY = 24 * 60 * 60 * 1000;
const FIRST_DELAY = 6000;

const yes = (v) => /^(1|true|si|sì|yes)$/i.test(String(v || ''));
const testMode = () => yes(process.env.LEGGIO_UPDATE_TEST);

// ---------- stato su disco (userData/aggiornamenti.json) ----------
const stateFile = () => path.join(app.getPath('userData'), 'aggiornamenti.json');
function readState() { try { return JSON.parse(fs.readFileSync(stateFile(), 'utf8')) || {}; } catch { return {}; } }
function writeState(patch) { if (testMode()) return; try { fs.writeFileSync(stateFile(), JSON.stringify({ ...readState(), ...patch })); } catch {} }

// ---------- versioni (semver essenziale, scritto a mano) ----------
// 1.2.10 > 1.2.9; una pre-release (1.2.0-beta.1) è minore della stabile 1.2.0.
function parseVersion(v) {
  const m = String(v || '').trim().replace(/^v/i, '').match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+.*)?$/);
  if (!m) return null;
  return { nums: [+m[1], +m[2], +m[3]], pre: m[4] ? m[4].split('.') : [] };
}
function compareVersions(a, b) {
  const x = parseVersion(a), y = parseVersion(b);
  if (!x || !y) return 0;
  for (let i = 0; i < 3; i++) if (x.nums[i] !== y.nums[i]) return x.nums[i] > y.nums[i] ? 1 : -1;
  if (!x.pre.length && !y.pre.length) return 0;
  if (!x.pre.length) return 1;
  if (!y.pre.length) return -1;
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    const p = x.pre[i], q = y.pre[i];
    if (p === undefined) return -1;
    if (q === undefined) return 1;
    const pn = /^\d+$/.test(p), qn = /^\d+$/.test(q);
    if (pn && qn) { if (+p !== +q) return +p > +q ? 1 : -1; continue; }
    if (pn !== qn) return pn ? -1 : 1;
    if (p !== q) return p > q ? 1 : -1;
  }
  return 0;
}

// ---------- scelta del file giusto per questo computer ----------
// Nomi prodotti da electron-builder (vedi "build" in package.json):
//   Leggio-X.Y.Z-mac-arm64.dmg · Leggio-X.Y.Z-mac-x64.dmg
//   Leggio-X.Y.Z-win-x64-installer.exe · Leggio-X.Y.Z-win-x64-portatile.exe
function pickAsset(assets, { platform = process.platform, arch = process.arch, portable = false } = {}) {
  const list = (assets || []).filter((a) => a && a.name && a.browser_download_url);
  const find = (re) => list.find((a) => re.test(a.name));
  let a = null;
  if (platform === 'darwin') {
    a = find(new RegExp(`mac-${arch}\\.dmg$`, 'i')) || find(/mac-universal\.dmg$/i) || find(/\.dmg$/i);
  } else if (platform === 'win32') {
    a = portable ? find(/portatile\.exe$/i) : (find(/win-x64-installer\.exe$/i) || find(/installer\.exe$/i));
  }
  return a ? { url: a.browser_download_url, name: a.name } : null;
}

function toInfo(release) {
  const version = String(release.tag_name || '').replace(/^v/i, '');
  const asset = pickAsset(release.assets, { portable: !!process.env.PORTABLE_EXECUTABLE_DIR });
  return {
    version,
    name: release.name || `Leggio ${version}`,
    url: release.html_url || RELEASES,
    notes: String(release.body || '').slice(0, 4000),
    publishedAt: release.published_at || null,
    downloadUrl: asset ? asset.url : null,
    downloadName: asset ? asset.name : null,
  };
}

function fakeRelease() {
  const p = parseVersion(app.getVersion()) || { nums: [0, 0, 0] };
  const v = `${p.nums[0]}.${p.nums[1] + 1}.0`;
  const a = (n) => ({ name: n, browser_download_url: `https://github.com/${REPO}/releases/download/v${v}/${n}` });
  return {
    tag_name: 'v' + v, name: `Leggio ${v}`, draft: false, prerelease: false,
    html_url: `https://github.com/${REPO}/releases`,
    body: `## Novità\n\n- **Firma più veloce**: i documenti si firmano in un clic.\n- Nuovo strumento per [numerare le pagine](https://example.org).\n\n## Correzioni\n\n* Stampa corretta dei moduli compilati\n* Testi più chiari nei messaggi di errore\n\n**Full Changelog**: https://github.com/${REPO}/compare/v${app.getVersion()}...v${v}`,
    assets: [a(`Leggio-${v}-mac-arm64.dmg`), a(`Leggio-${v}-mac-x64.dmg`), a(`Leggio-${v}-win-x64-installer.exe`), a(`Leggio-${v}-win-x64-portatile.exe`)],
  };
}

async function fetchLatest() {
  if (testMode()) return toInfo(fakeRelease());
  const res = await net.fetch(API, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': `Leggio/${app.getVersion()}` },
    cache: 'no-store',
  });
  if (res.status === 404) return null; // nessuna release pubblicata
  if (!res.ok) throw new Error(`GitHub ha risposto ${res.status}`);
  const j = await res.json();
  if (!j || j.draft || j.prerelease) return null;
  return toInfo(j);
}

async function check() {
  const latest = await fetchLatest();
  const current = app.getVersion();
  const newer = !!(latest && latest.version && compareVersions(latest.version, current) > 0);
  return { current, latest, newer };
}

// ---------- controllo automatico ----------
let getWindow = () => null;
let timer = null;

function autoEnabled() {
  if (yes(process.env.LEGGIO_NO_UPDATE_CHECK)) return false;
  if (!app.isPackaged && !testMode()) return false; // in sviluppo non disturba
  return readState().auto !== false;
}

function notify(info) {
  const win = getWindow();
  if (!info || !win || win.isDestroyed()) return;
  const send = () => win.webContents.send('app:update-available', info);
  if (win.webContents.isLoading()) win.webContents.once('did-finish-load', send); else send();
}

/** Serve un nuovo controllo? Un'ultima data nel futuro (orologio messo male una volta) non blocca i controlli. */
function checkDue(lastCheck, now = Date.now()) {
  const t = Number(lastCheck);
  return !Number.isFinite(t) || t <= 0 || t > now || now - t >= DAY;
}

async function autoCheck() {
  if (!autoEnabled()) return;
  const st = readState();
  const due = testMode() || checkDue(st.lastCheck);
  if (!due) {
    // controllato da poco: ripropone l'ultima versione trovata, se è ancora più nuova
    if (st.found && compareVersions(st.found.version, app.getVersion()) > 0) notify(st.found);
    return;
  }
  try {
    const r = await check();
    writeState({ lastCheck: Date.now(), found: r.newer ? r.latest : null });
    if (r.newer) notify(r.latest);
  } catch (err) {
    // senza rete o con limite API raggiunto: nessun messaggio all'utente, si riprova più tardi
    console.warn('[leggio] controllo aggiornamenti non riuscito:', err.message);
  }
}

function setup(opts = {}) {
  if (opts.getWindow) getWindow = opts.getWindow;
  ipcMain.removeHandler('app:update-prefs');
  ipcMain.handle('app:update-prefs', (_e, prefs = {}) => {
    if (typeof prefs.auto === 'boolean') writeState({ auto: prefs.auto });
    return { auto: readState().auto !== false };
  });
  setTimeout(autoCheck, FIRST_DELAY);
  clearInterval(timer);
  timer = setInterval(autoCheck, 60 * 60 * 1000); // ogni ora guarda se sono passate 24 ore
  timer.unref?.();
}

// ---------- controllo dal menu: risponde sempre ----------
async function checkInteractive(win) {
  const show = (o) => (win && !win.isDestroyed() ? dialog.showMessageBox(win, o) : dialog.showMessageBox(o));
  let r;
  try { r = await check(); }
  catch {
    const { response } = await show({ type: 'warning', title: 'Aggiornamenti', message: 'Non riesco a controllare gli aggiornamenti in questo momento.',
      detail: 'Controlla di essere collegato a Internet e riprova tra qualche minuto. Puoi anche aprire la pagina di Leggio e guardare tu stesso.',
      buttons: ['Apri la pagina', 'Chiudi'], defaultId: 1, cancelId: 1 });
    if (response === 0) shell.openExternal(RELEASES);
    return;
  }
  writeState({ lastCheck: Date.now(), found: r.newer ? r.latest : null });
  if (r.newer) {
    const { response } = await show({ type: 'info', title: 'Aggiornamenti', message: `È disponibile Leggio ${r.latest.version}.`,
      detail: `Tu hai la versione ${r.current}. Premi «Scarica», poi apri il file scaricato e segui le istruzioni: i tuoi documenti e le impostazioni restano al loro posto.`,
      buttons: ['Scarica', 'Più tardi'], defaultId: 0, cancelId: 1 });
    if (response === 0) shell.openExternal(r.latest.downloadUrl || r.latest.url);
  } else {
    await show({ type: 'info', title: 'Aggiornamenti', message: 'Hai già l\'ultima versione di Leggio.',
      detail: `Versione in uso: ${r.current}.`, buttons: ['OK'] });
  }
}

module.exports = { setup, check, checkInteractive, checkDue, compareVersions, parseVersion, pickAsset, toInfo };
