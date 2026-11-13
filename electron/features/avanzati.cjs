// Leggio — area «avanzati», processo principale.
// Canali (tutti 'feat:avanzati:*', argomenti validati):
//   choose-folder, choose-files      dialoghi che autorizzano i percorsi scelti
//   list, read, write, stat          accesso ai file SOLO dentro cartelle/file autorizzati dall'utente
//   html-to-pdf                      pagina web, file HTML o HTML generato → PDF (BrowserWindow nascosta + printToPDF)
//   office-info, office-convert      Word/Excel/PowerPoint/ODT → PDF con LibreOffice (o Microsoft Office su Windows)
//   cancel                           interrompe una conversione in corso
const path = require('node:path');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const { execFile } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const { safeWrite } = require('../core/safe-write.cjs');

const MB = 1024 * 1024;
const MAX_READ = 1024 * MB;
const MAX_WRITE = 1024 * MB;
const MAX_HTML = 50 * MB;
const MAX_LIST = 200000;

// ---------------- validazione ----------------
class UserError extends Error {}
function str(v, name, max = 4096) {
  if (typeof v !== 'string' || !v.length || v.length > max || v.includes('\0')) throw new UserError(`Parametro non valido: ${name}`);
  return v;
}
function optStr(v, name, max) { return v == null || v === '' ? null : str(v, name, max); }
function bool(v) { return v === true; }
function int(v, name, min, max, def) {
  if (v == null) return def;
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) throw new UserError(`Parametro non valido: ${name}`);
  return Math.floor(v);
}
function bytesArg(v, name, max) {
  let b = v;
  if (b instanceof ArrayBuffer) b = new Uint8Array(b);
  if (!(b instanceof Uint8Array)) throw new UserError(`Parametro non valido: ${name}`);
  if (b.length > max) throw new UserError('Il file è troppo grande.');
  return b;
}
function absPath(p, name) {
  str(p, name, 4096);
  if (!path.isAbsolute(p)) throw new UserError(`Percorso non valido: ${name}`);
  return path.resolve(p);
}
/** Nome di file sicuro (niente separatori, niente nomi riservati di Windows). */
function safeName(n, fallback = 'documento') {
  let s = String(n || '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/^[.\s]+/, '').replace(/[.\s]+$/, '').slice(0, 200);
  if (!s) s = fallback;
  if (/^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i.test(s)) s = '_' + s;
  return s;
}

// percorsi autorizzati dall'utente tramite i dialoghi di questo modulo
const allowedRoots = new Set();
let grantsRef = null; // permessi del nucleo (sola lettura)
function allow(p) { allowedRoots.add(path.resolve(p)); }
function isAllowed(p) {
  const r = path.resolve(p);
  for (const root of allowedRoots) {
    if (r === root) return true;
    const rel = path.relative(root, r);
    if (rel && rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel)) return true;
  }
  return false;
}
function mustBeAllowed(p) {
  if (!isAllowed(p)) throw new UserError('Per sicurezza Leggio può usare solo file e cartelle scelti da te. Scegli di nuovo la cartella.');
}

// ---------------- file ----------------
async function listFiles({ folder, exts, recursive = true, max = 5000, skipDirs = [] }) {
  const root = absPath(folder, 'cartella');
  mustBeAllowed(root);
  const extSet = new Set((Array.isArray(exts) ? exts : ['pdf']).slice(0, 50).map((e) => '.' + String(e).toLowerCase().replace(/^\./, '')));
  const skip = new Set((Array.isArray(skipDirs) ? skipDirs : []).slice(0, 20).map(String));
  const limit = int(max, 'max', 1, MAX_LIST, 50000);
  const out = []; let truncated = false; const errors = [];
  async function walk(dir, depth) {
    if (out.length >= limit) { truncated = true; return; }
    let entries;
    try { entries = await fsp.readdir(dir, { withFileTypes: true }); }
    catch (err) { errors.push({ path: dir, error: err.code === 'EACCES' || err.code === 'EPERM' ? 'Accesso negato' : err.message }); return; }
    entries.sort((a, b) => a.name.localeCompare(b.name, 'it', { numeric: true }));
    for (const e of entries) {
      if (out.length >= limit) { truncated = true; return; }
      if (e.name.startsWith('.') || e.name.startsWith('~$')) continue;
      const p = path.join(dir, e.name);
      if (e.isSymbolicLink()) continue; // niente cicli
      if (e.isDirectory()) { if (recursive && depth < 24 && !skip.has(e.name)) await walk(p, depth + 1); continue; }
      if (!e.isFile() || !extSet.has(path.extname(e.name).toLowerCase())) continue;
      try {
        const st = await fsp.stat(p);
        out.push({ path: p, name: e.name, rel: path.relative(root, p), size: st.size, mtime: st.mtimeMs });
      } catch {}
    }
  }
  await walk(root, 0);
  return { files: out, truncated, errors };
}

async function readAllowed({ path: p, maxBytes }) {
  const abs = absPath(p, 'percorso');
  mustBeAllowed(abs);
  const limit = int(maxBytes, 'maxBytes', 1, MAX_READ, 400 * MB);
  const st = await fsp.stat(abs);
  if (!st.isFile()) throw new UserError('Non è un file.');
  if (st.size > limit) throw new UserError(`Il file è troppo grande (${Math.round(st.size / MB)} MB).`);
  return new Uint8Array(await fsp.readFile(abs));
}

async function uniquePath(dir, name) {
  const ext = path.extname(name); const base = name.slice(0, name.length - ext.length);
  let p = path.join(dir, name); let i = 2;
  while (fs.existsSync(p)) { p = path.join(dir, `${base} (${i++})${ext}`); if (i > 9999) throw new UserError('Troppi file con lo stesso nome.'); }
  return p;
}

async function writeAllowed({ folder, sub, name, bytes, overwrite }) {
  const dirRoot = absPath(folder, 'cartella');
  mustBeAllowed(dirRoot);
  const data = bytesArg(bytes, 'bytes', MAX_WRITE);
  let dir = dirRoot;
  if (sub) {
    const parts = String(sub).split(/[\\/]+/).filter(Boolean).slice(0, 8).map((x) => safeName(x, 'cartella'));
    if (parts.some((x) => x === '..')) throw new UserError('Sottocartella non valida.');
    dir = path.join(dirRoot, ...parts);
  }
  await fsp.mkdir(dir, { recursive: true });
  const fileName = safeName(name);
  const target = overwrite === true ? path.join(dir, fileName) : await uniquePath(dir, fileName);
  // «Sostituisci gli originali» non vale per i file aperti in sola lettura (es. dall'archivio)
  if (grantsRef && grantsRef.isReadOnly(target)) throw new UserError(`«${fileName}» è aperto in sola lettura: l'originale non viene sovrascritto.`);
  // scrittura atomica e verificata (temporaneo unico, ripulito in caso di errore)
  await safeWrite(target, data);
  return target;
}

// ---------------- HTML → PDF ----------------
const PAGE_SIZES = new Set(['A3', 'A4', 'A5', 'Letter', 'Legal', 'Tabloid']);
function marginsFor(m) {
  const mm = typeof m === 'number' && Number.isFinite(m) ? Math.max(0, Math.min(60, m)) : m === 'none' ? 0 : m === 'minimum' ? 5 : 12;
  const inch = mm / 25.4;
  return { top: inch, bottom: inch, left: inch, right: inch };
}

async function htmlToPdf(BrowserWindow, args = {}) {
  const pageSize = PAGE_SIZES.has(args.pageSize) ? args.pageSize : 'A4';
  const timeout = int(args.timeoutMs, 'timeoutMs', 2000, 180000, 60000);
  let tmpDir = null; let target; let allowJs = false;
  if (args.html != null) {
    str(args.html, 'html', MAX_HTML);
    tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'leggio-html-'));
    const f = path.join(tmpDir, 'pagina.html');
    await fsp.writeFile(f, args.html, 'utf8');
    target = { file: f };
  } else if (args.url != null) {
    const u = str(args.url, 'url', 8192).trim();
    let parsed;
    try { parsed = new URL(u); } catch { throw new UserError('Indirizzo web non valido. Esempio: https://www.cnr.it'); }
    if (!/^https?:$/.test(parsed.protocol)) throw new UserError('Sono accettati solo indirizzi che iniziano con http:// o https://');
    target = { url: parsed.href }; allowJs = true;
  } else if (args.filePath != null) {
    const p = absPath(args.filePath, 'file');
    mustBeAllowed(p);
    if (!/\.(html?|xhtml|svg|txt|xml)$/i.test(p)) throw new UserError('Il file deve essere una pagina HTML (.html, .htm).');
    target = { file: p }; allowJs = bool(args.allowScripts);
  } else throw new UserError('Niente da convertire.');

  const partition = 'leggio-html2pdf-' + Date.now() + '-' + Math.random().toString(36).slice(2);
  const win = new BrowserWindow({
    show: false, width: 1200, height: 1600,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: allowJs, partition, spellcheck: false, offscreen: false },
  });
  const wc = win.webContents;
  wc.setWindowOpenHandler(() => ({ action: 'deny' }));
  wc.session.on('will-download', (e) => e.preventDefault());
  wc.session.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
  if (target.file) wc.on('will-navigate', (e) => e.preventDefault());
  // HTML generato da Leggio (fatture, messaggi .eml…): può contenere <iframe src="file:///…"> o immagini
  // remote messe da chi ha scritto il documento. Si carica solo la pagina stessa (niente altri file locali,
  // niente rete); per un file HTML scelto dall'utente, solo i file della sua cartella.
  wc.session.webRequest.onBeforeRequest((d, cb) => cb({ cancel: !requestAllowed(target, args, d.url) }));
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new UserError('La pagina impiega troppo tempo a caricarsi. Controlla l\'indirizzo o la connessione e riprova.')), timeout);
      wc.once('did-finish-load', () => { clearTimeout(timer); resolve(); });
      wc.once('did-fail-load', (_e, code, desc, _url, isMain) => { if (isMain === false) return; clearTimeout(timer); reject(new UserError(`Impossibile caricare la pagina (${desc || code}). Controlla l'indirizzo e la connessione a Internet.`)); });
      const p = target.file ? win.loadFile(target.file) : win.loadURL(target.url, { userAgent: wc.getUserAgent().replace(/Electron\/\S+\s?/, '') });
      p.catch(() => {});
    });
    await new Promise((r) => setTimeout(r, allowJs ? 1200 : 150));
    const pdf = await wc.printToPDF({
      pageSize, landscape: bool(args.landscape), printBackground: args.printBackground !== false,
      margins: marginsFor(args.margins), preferCSSPageSize: args.html != null,
      displayHeaderFooter: false,
    });
    return new Uint8Array(pdf);
  } finally {
    try { win.destroy(); } catch {}
    if (tmpDir) fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

function requestAllowed(target, args, url) {
  if (/^(data|blob|about|devtools):/i.test(url)) return true;
  if (target.url) return /^https?:/i.test(url);
  let p;
  try { const u = new URL(url); if (u.protocol !== 'file:') return false; p = require('node:url').fileURLToPath(u); } catch { return false; }
  if (args.html != null) return path.resolve(p) === path.resolve(target.file);
  const dir = path.dirname(path.resolve(target.file));
  const rel = path.relative(dir, path.resolve(p));
  return rel === '' || (rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel));
}

// ---------------- Office → PDF ----------------
const OFFICE_EXT = new Set(['doc', 'docx', 'docm', 'dot', 'dotx', 'odt', 'ott', 'rtf', 'txt', 'wpd', 'xls', 'xlsx', 'xlsm', 'ods', 'csv', 'ppt', 'pptx', 'pps', 'ppsx', 'odp', 'odg', 'vsd', 'pub', 'html', 'htm']);
const jobs = new Map();

function sofficeCandidates() {
  const c = [];
  if (process.env.LEGGIO_SOFFICE) c.push(process.env.LEGGIO_SOFFICE);
  if (process.platform === 'darwin') {
    c.push('/Applications/LibreOffice.app/Contents/MacOS/soffice', path.join(os.homedir(), 'Applications/LibreOffice.app/Contents/MacOS/soffice'),
      '/Applications/LibreOffice Vanilla.app/Contents/MacOS/soffice', '/Applications/Collabora Office.app/Contents/MacOS/soffice', '/opt/homebrew/bin/soffice', '/usr/local/bin/soffice');
  } else if (process.platform === 'win32') {
    for (const base of [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.ProgramW6432, process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs')].filter(Boolean)) {
      c.push(path.join(base, 'LibreOffice', 'program', 'soffice.exe'), path.join(base, 'LibreOffice 7', 'program', 'soffice.exe'), path.join(base, 'Collabora Office', 'program', 'soffice.exe'));
    }
  } else {
    c.push('/usr/bin/soffice', '/usr/bin/libreoffice', '/usr/local/bin/soffice', '/snap/bin/libreoffice', '/opt/libreoffice/program/soffice');
  }
  for (const dir of (process.env.PATH || '').split(path.delimiter).filter(Boolean).slice(0, 60)) {
    c.push(path.join(dir, process.platform === 'win32' ? 'soffice.exe' : 'soffice'));
  }
  return c;
}
function findSoffice() {
  for (const p of sofficeCandidates()) { try { if (fs.statSync(p).isFile()) return p; } catch {} }
  return null;
}
function hasMsOffice() {
  if (process.platform !== 'win32') return false;
  const bases = [process.env.ProgramFiles, process.env['ProgramFiles(x86)']].filter(Boolean);
  for (const b of bases) for (const v of ['root\\Office16', 'root\\Office15', 'Office16', 'Office15']) {
    if (fs.existsSync(path.join(b, 'Microsoft Office', v, 'WINWORD.EXE'))) return true;
  }
  return false;
}

function run(cmd, args, { timeout, jobId }) {
  return new Promise((resolve, reject) => {
    const child = execFile(cmd, args, { timeout, windowsHide: true, maxBuffer: 4 * MB }, (err, stdout, stderr) => {
      if (jobId) jobs.delete(jobId);
      if (child.leggioCancelled) return reject(new UserError('Conversione annullata.'));
      if (err) {
        if (err.killed || err.signal === 'SIGTERM') return reject(new UserError('La conversione ha impiegato troppo tempo ed è stata interrotta.'));
        return reject(new UserError('La conversione non è riuscita: ' + (String(stderr || err.message).split('\n').find((l) => l.trim()) || 'errore sconosciuto')));
      }
      resolve({ stdout, stderr });
    });
    if (jobId) jobs.set(jobId, child);
  });
}

async function officeConvert(args = {}) {
  const name = safeName(str(args.name, 'nome', 300));
  const ext = path.extname(name).slice(1).toLowerCase();
  if (!OFFICE_EXT.has(ext)) throw new UserError(`Il formato «.${ext || '?'}» non è tra quelli convertibili (Word, Excel, PowerPoint, OpenDocument, RTF, testo).`);
  const data = bytesArg(args.bytes, 'bytes', 300 * MB);
  const timeout = int(args.timeoutMs, 'timeoutMs', 5000, 600000, 180000);
  const jobId = optStr(args.jobId, 'jobId', 100);
  const engine = args.engine === 'msoffice' ? 'msoffice' : 'auto';
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'leggio-office-'));
  try {
    const input = path.join(tmp, 'in', name);
    const outDir = path.join(tmp, 'out');
    await fsp.mkdir(path.dirname(input), { recursive: true });
    await fsp.mkdir(outDir, { recursive: true });
    await fsp.writeFile(input, Buffer.from(data.buffer, data.byteOffset, data.byteLength));
    const soffice = engine === 'auto' ? findSoffice() : null;
    let usedEngine;
    if (soffice) {
      usedEngine = 'libreoffice';
      // profilo separato: funziona anche se LibreOffice è già aperto dall'utente
      const profile = pathToFileURL(path.join(tmp, 'profilo')).href;
      await run(soffice, ['--headless', '--invisible', '--norestore', '--nolockcheck', '--nodefault', `-env:UserInstallation=${profile}`, '--convert-to', 'pdf', '--outdir', outDir, input], { timeout, jobId });
    } else if (hasMsOffice()) {
      usedEngine = 'msoffice';
      const out = path.join(outDir, path.basename(name, path.extname(name)) + '.pdf');
      await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', msOfficeScript(input, out, ext)], { timeout, jobId });
    } else {
      const err = new UserError('NO_OFFICE');
      err.code = 'NO_OFFICE';
      throw err;
    }
    const files = (await fsp.readdir(outDir)).filter((f) => f.toLowerCase().endsWith('.pdf'));
    if (!files.length) throw new UserError('La conversione non ha prodotto alcun PDF: il file potrebbe essere protetto da password o danneggiato.');
    return { bytes: new Uint8Array(await fsp.readFile(path.join(outDir, files[0]))), engine: usedEngine };
  } finally {
    fsp.rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
}

function psq(s) { return "'" + String(s).replace(/'/g, "''") + "'"; }
function msOfficeScript(input, out, ext) {
  const i = psq(input); const o = psq(out);
  if (/^(xls|xlsx|xlsm|ods|csv)$/.test(ext)) {
    return `$ErrorActionPreference='Stop'; $a=New-Object -ComObject Excel.Application; $a.DisplayAlerts=$false; try { $w=$a.Workbooks.Open(${i}, 0, $true); $w.ExportAsFixedFormat(0, ${o}); $w.Close($false) } finally { $a.Quit() }`;
  }
  if (/^(ppt|pptx|pps|ppsx|odp)$/.test(ext)) {
    return `$ErrorActionPreference='Stop'; $a=New-Object -ComObject PowerPoint.Application; try { $p=$a.Presentations.Open(${i}, $true, $false, $false); $p.SaveAs(${o}, 32); $p.Close() } finally { $a.Quit() }`;
  }
  return `$ErrorActionPreference='Stop'; $a=New-Object -ComObject Word.Application; $a.Visible=$false; $a.DisplayAlerts=0; try { $d=$a.Documents.Open(${i}, $false, $true); $d.SaveAs([ref]${o}, [ref]17); $d.Close([ref]$false) } finally { $a.Quit() }`;
}

// ---------------- lavoro delle azioni guidate (ripresa dopo un'interruzione) ----------------
let userDataDir = null;
const jobFile = () => path.join(userDataDir || os.tmpdir(), 'avanzati-azioni-guidate.json');
async function jobSave({ json }) {
  str(json, 'json', 80 * MB);
  const f = jobFile(); const tmp = f + '.tmp';
  await fsp.writeFile(tmp, json, 'utf8'); await fsp.rename(tmp, f);
  return true;
}
async function jobLoad() { try { return await fsp.readFile(jobFile(), 'utf8'); } catch { return null; } }
async function jobClear() { try { await fsp.rm(jobFile(), { force: true }); } catch {} return true; }

// ---------------- HEIC → JPEG (foto dell'iPhone): su macOS con sips di sistema ----------------
async function heicToJpeg({ name, bytes }) {
  const data = bytesArg(bytes, 'bytes', 100 * MB);
  if (process.platform !== 'darwin' || !fs.existsSync('/usr/bin/sips')) throw new UserError('Le foto HEIC si possono convertire solo su macOS. Sul telefono imposta «Più compatibile» (JPEG) oppure salvale come JPEG.');
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'leggio-heic-'));
  try {
    const inp = path.join(tmp, 'in.heic'); const out = path.join(tmp, 'out.jpg');
    await fsp.writeFile(inp, Buffer.from(data.buffer, data.byteOffset, data.byteLength));
    await run('/usr/bin/sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '85', inp, '--out', out], { timeout: 60000 });
    return new Uint8Array(await fsp.readFile(out));
  } catch (e) { throw e instanceof UserError ? e : new UserError(`Impossibile convertire «${safeName(name || 'foto')}».`); }
  finally { fsp.rm(tmp, { recursive: true, force: true }).catch(() => {}); }
}

// ---------------- registrazione ----------------
function wrap(fn) {
  return async (_e, args) => {
    try { return { ok: true, value: await fn(args || {}) }; }
    catch (err) {
      if (!(err instanceof UserError)) console.error('[leggio avanzati]', err);
      return { ok: false, error: err instanceof UserError ? err.message : (err?.code === 'ENOENT' ? 'File o cartella non trovati.' : err?.code === 'EACCES' || err?.code === 'EPERM' ? 'Accesso negato: controlla i permessi della cartella.' : err?.code === 'ENOSPC' ? 'Spazio su disco esaurito.' : 'Operazione non riuscita: ' + (err?.message || err)), code: err?.code || null };
    }
  };
}

function register({ ipcMain, BrowserWindow, dialog, getWindow, app, grants }) {
  grantsRef = grants || null;
  try { userDataDir = app?.getPath?.('userData') || null; } catch { userDataDir = null; }
  const h = (name, fn) => { ipcMain.removeHandler('feat:avanzati:' + name); ipcMain.handle('feat:avanzati:' + name, wrap(fn)); };
  h('choose-folder', async ({ title }) => {
    const r = await dialog.showOpenDialog(getWindow(), { title: optStr(title, 'title', 200) || 'Scegli una cartella', properties: ['openDirectory', 'createDirectory'] });
    if (r.canceled || !r.filePaths[0]) return null;
    allow(r.filePaths[0]);
    return r.filePaths[0];
  });
  h('choose-files', async ({ title, filters, multiple }) => {
    const f = Array.isArray(filters) ? filters.slice(0, 10).map((x) => ({ name: String(x.name || 'File').slice(0, 80), extensions: (x.extensions || []).slice(0, 40).map((e) => String(e).slice(0, 10)) })) : [{ name: 'Documenti PDF', extensions: ['pdf'] }];
    const r = await dialog.showOpenDialog(getWindow(), { title: optStr(title, 'title', 200) || 'Scegli i file', filters: f, properties: ['openFile', ...(multiple === false ? [] : ['multiSelections'])] });
    if (r.canceled) return [];
    const out = [];
    for (const p of r.filePaths.slice(0, 5000)) { allow(p); try { const st = fs.statSync(p); out.push({ path: p, name: path.basename(p), size: st.size, mtime: st.mtimeMs }); } catch {} }
    return out;
  });
  h('list', listFiles);
  h('read', readAllowed);
  h('write', writeAllowed);
  h('stat', async ({ path: p }) => { const abs = absPath(p, 'percorso'); mustBeAllowed(abs); const st = await fsp.stat(abs); return { size: st.size, mtime: st.mtimeMs, isFile: st.isFile(), isDir: st.isDirectory() }; });
  h('html-to-pdf', (a) => htmlToPdf(BrowserWindow, a));
  h('office-info', async () => ({ soffice: findSoffice(), msoffice: hasMsOffice(), platform: process.platform }));
  h('office-convert', officeConvert);
  h('job-save', jobSave);
  h('job-load', jobLoad);
  h('job-clear', jobClear);
  h('heic-to-jpeg', heicToJpeg);
  h('cancel', async ({ jobId }) => { const c = jobs.get(str(jobId, 'jobId', 100)); if (c) { c.leggioCancelled = true; try { c.kill(); } catch {} } return !!c; });
}

module.exports = { register, requestAllowed, pathAllowed: (p) => { try { return typeof p === 'string' && path.isAbsolute(p) && isAllowed(p); } catch { return false; } }, _test: { jobSave, jobLoad, jobClear, heicToJpeg, safeName, isAllowed, allow, listFiles, readAllowed, writeAllowed, officeConvert, findSoffice, marginsFor, msOfficeScript, UserError } };
