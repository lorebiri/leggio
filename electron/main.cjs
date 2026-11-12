// Leggio — processo principale Electron.
// Gestisce finestre, menu, dialoghi file, file recenti e i moduli "feature" lato main
// (ogni file in electron/features/*.cjs esporta register({ ipcMain, app, BrowserWindow, dialog })).
// Robustezza (docs/ROBUSTEZZA.md): scrittura sicura, cronologia su disco temporaneo, recupero
// automatico, registro ruotato, recupero da crash del renderer, IPC validato, finestra isolata.
const { app, BrowserWindow, ipcMain, dialog, Menu, shell, nativeTheme, session } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const fsp = fs.promises;
const os = require('node:os');
const crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { safeWrite, friendly, cleanStaleTemps } = require('./core/safe-write.cjs');
const { createLogger } = require('./core/log.cjs');
const V = require('./core/validate.cjs');

const isMac = process.platform === 'darwin';
const pendingOpen = [];
let mainWindow = null;
let logger = null;
let forceClose = false;
const L = (level, msg, data, source) => { try { logger?.write(level, msg, data, source); } catch { /* */ } };

// ---------- errori del processo principale ----------
process.on('uncaughtException', (err) => { console.error(err); L('error', 'eccezione non gestita nel main: ' + err?.message, { stack: err?.stack }); });
process.on('unhandledRejection', (r) => { L('error', 'promessa rifiutata nel main: ' + (r?.message || r), { stack: r?.stack }); });

// ---------- permessi sui percorsi ----------
// Il renderer può sovrascrivere solo file che l'utente ha aperto o scelto (dialoghi, recenti,
// trascinamento, riga di comando) e scrivere solo nelle cartelle scelte con il dialogo.
const grantedFiles = new Set();
const grantedFolders = new Set();
const norm = (p) => (process.platform === 'win32' || isMac ? path.normalize(p).toLowerCase() : path.normalize(p));
const grantFile = (p) => { if (p) grantedFiles.add(norm(p)); };
const grantFolder = (p) => { if (p) grantedFolders.add(norm(p)); };
const canWrite = (p) => grantedFiles.has(norm(p));
// file non PDF (es. .p7m) che l'utente ha aperto dal sistema: il renderer può leggerli, non sovrascriverli
const grantedReads = new Set();
const grantRead = (p) => { if (p) grantedReads.add(norm(p)); };

// ---------- file recenti ----------
const recentFile = () => path.join(app.getPath('userData'), 'recenti.json');
function readRecent() {
  try { return JSON.parse(fs.readFileSync(recentFile(), 'utf8')).filter((p) => typeof p === 'string' && fs.existsSync(p)); } catch { return []; }
}
function addRecent(p) {
  const list = [p, ...readRecent().filter((x) => x !== p)].slice(0, 15);
  try { fs.writeFileSync(recentFile(), JSON.stringify(list)); } catch { /* */ }
  if (isMac || process.platform === 'win32') app.addRecentDocument(p);
  buildMenu();
}

function friendlyRead(err, p) {
  const n = path.basename(p);
  const m = {
    ENOENT: `«${n}» non esiste più (spostato, eliminato, o il disco è scollegato).`,
    EACCES: `Non hai i permessi per leggere «${n}».`, EPERM: `Non hai i permessi per leggere «${n}».`,
    EBUSY: `«${n}» è bloccato da un altro programma.`, EIO: `Errore del disco leggendo «${n}».`,
  }[err.code];
  return Object.assign(new Error(m || `Impossibile leggere «${n}»: ${err.message}`), { userMessage: m });
}
function readFileChecked(p) {
  let st;
  try { st = fs.statSync(p); } catch (err) { throw friendlyRead(err, p); }
  if (st.isDirectory()) throw Object.assign(new Error(`«${path.basename(p)}» è una cartella, non un file.`), { userMessage: true });
  if (st.size > V.MAX_BYTES) throw Object.assign(new Error(`«${path.basename(p)}» supera i 2 GB: Leggio non può aprirlo.`), { userMessage: true });
  try { const b = fs.readFileSync(p); return new Uint8Array(b.buffer, b.byteOffset, b.byteLength); } catch (err) { throw friendlyRead(err, p); }
}
function readPdf(p) {
  const bytes = readFileChecked(p);
  grantFile(p);
  addRecent(p);
  return { path: p, name: path.basename(p), bytes };
}

function send(channel, payload) { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload); }
function notify(kind, message, title) { send('app:notify', { kind, message, title }); }

// Accetta qualunque file esistente passato dal sistema (doppio clic, «Apri con», trascinamento sull'icona,
// riga di comando): è il renderer a decidere, in base ai gestori registrati (app.registerOpener).
function sendOpen(paths) {
  const files = paths.filter((p) => { try { return typeof p === 'string' && !p.startsWith('-') && path.isAbsolute(p) && fs.statSync(p).isFile(); } catch { return false; } });
  if (!files.length) return;
  if (mainWindow && mainWindow.webContents && !mainWindow.webContents.isLoading()) {
    for (const p of files) openInRenderer(p);
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  } else pendingOpen.push(...files);
}
// Si invia solo il percorso: i byte li chiede il renderer con file:read (invoke). Passare grandi
// Uint8Array come argomenti di un evento attraverso contextBridge blocca il renderer per minuti
// (copia elemento per elemento): verificato con Electron 45 e sandbox attiva.
function openInRenderer(p) {
  try {
    const st = fs.statSync(p);
    if (st.size > V.MAX_BYTES) throw new Error(`«${path.basename(p)}» supera i 2 GB: Leggio non può aprirlo.`);
    if (/\.pdf$/i.test(p)) grantFile(p); else grantRead(p);
    send('app:open-file', { path: p, name: path.basename(p) });
  }
  catch (err) { L('warn', 'apertura non riuscita', { p, error: err.message }); notify('error', err.message, 'Impossibile aprire il documento'); }
}

// ---------- cartelle: cronologia (temporanea) e recupero (userData) ----------
const historyRoot = () => path.join(app.getPath('temp'), 'leggio-cronologia');
const historyDir = () => path.join(historyRoot(), String(process.pid));
const recoveryRoot = () => path.join(app.getPath('userData'), 'recupero');
let recoverySession = null; // cambia a ogni caricamento del renderer
const recoveryDir = () => path.join(recoveryRoot(), recoverySession);
const SESSION_RE = /^[a-z0-9-]{4,64}$/;

function pidAlive(pid) { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } }
/** Elimina le cronologie temporanee lasciate da processi non più in vita (crash, uscite forzate). */
function cleanStaleHistory() {
  let list = [];
  try { list = fs.readdirSync(historyRoot()); } catch { return; }
  for (const d of list) { const pid = Number(d); if (!Number.isInteger(pid) || pid === process.pid || !pidAlive(pid)) rmrf(path.join(historyRoot(), d)); }
}
function rmrf(p) { try { fs.rmSync(p, { recursive: true, force: true }); } catch (err) { L('warn', 'pulizia non riuscita', { p, error: err.message }); } }
function newRecoverySession() { recoverySession = `${Date.now().toString(36)}-${process.pid}-${crypto.randomBytes(3).toString('hex')}`; }
function cleanEmptyRecoverySessions() {
  let list = [];
  try { list = fs.readdirSync(recoveryRoot()); } catch { return; }
  for (const s of list) {
    const d = path.join(recoveryRoot(), s);
    try { if (!fs.readdirSync(d).some((f) => f.endsWith('.pdf'))) rmrf(d); } catch { /* */ }
  }
}

// ---------- finestra ----------
let rendererHung = false;
let rendererGone = false;
const indexUrl = () => pathToFileURL(path.join(__dirname, '..', 'dist', 'index.html')).href;
function appUrlOk(url) {
  const devUrl = process.env.LEGGIO_DEV_URL;
  if (devUrl && url.startsWith(devUrl)) return true;
  return String(url).split('#')[0].split('?')[0] === indexUrl();
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1360, height: 900, minWidth: 900, minHeight: 600,
    title: 'Leggio',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1c1d21' : '#f4f3ef',
    titleBarStyle: isMac ? 'hiddenInset' : 'default',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      navigateOnDragDrop: false,
      spellcheck: true,
      // niente rallentamento dei timer quando la finestra è in secondo piano: pdf-lib e pdf.js
      // cedono il controllo con setTimeout, e un salvataggio o una modifica lunga avviata prima
      // di passare a un'altra app altrimenti procederebbe a un passo al secondo (minuti invece di secondi)
      backgroundThrottling: false,
    },
  });
  const devUrl = process.env.LEGGIO_DEV_URL;
  newRecoverySession();
  if (devUrl) mainWindow.loadURL(devUrl);
  else mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));

  const wc = mainWindow.webContents;
  wc.on('did-start-navigation', (d) => { if (d.isMainFrame && !d.isSameDocument) { newRecoverySession(); rendererGone = false; rendererHung = false; } });
  wc.on('did-finish-load', () => {
    const files = pendingOpen.splice(0);
    for (const p of files) openInRenderer(p);
  });
  wc.on('render-process-gone', async (_e, details) => {
    rendererGone = true;
    L('error', 'processo di visualizzazione terminato', details);
    if (details.reason === 'clean-exit' || !mainWindow || mainWindow.isDestroyed() || forceClose) return;
    const r = await dialog.showMessageBox(mainWindow, {
      type: 'error', title: 'Leggio ha avuto un problema',
      message: 'La finestra di Leggio si è interrotta in modo imprevisto.',
      detail: 'Le modifiche non salvate erano state copiate nel recupero automatico: ricaricando, Leggio ti proporrà di ripristinarle.',
      buttons: ['Ricarica', 'Esci'], defaultId: 0, cancelId: 1,
    });
    if (r.response === 0) wc.reload(); else { forceClose = true; app.quit(); }
  });
  wc.on('unresponsive', async () => {
    if (rendererHung) return;
    rendererHung = true;
    L('warn', 'la finestra non risponde');
    const r = await dialog.showMessageBox(mainWindow, {
      type: 'warning', title: 'Leggio non risponde',
      message: 'Leggio sta impiegando molto tempo (forse un documento molto grande).',
      detail: 'Puoi attendere oppure ricaricare la finestra: le modifiche non salvate sono nel recupero automatico e verranno proposte dopo il ricaricamento.',
      buttons: ['Attendi', 'Ricarica'], defaultId: 0, cancelId: 0,
    });
    if (r.response === 1 && rendererHung) { L('warn', 'ricaricamento forzato dopo blocco'); wc.forcefullyCrashRenderer(); wc.reload(); }
  });
  wc.on('responsive', () => { rendererHung = false; });

  // chiusura con modifiche non salvate: chiede al renderer (se è vivo)
  mainWindow.on('close', (e) => {
    if (forceClose || rendererGone || wc.isCrashed()) return;
    e.preventDefault();
    if (rendererHung) {
      const r = dialog.showMessageBoxSync(mainWindow, { type: 'warning', title: 'Chiudere Leggio?', message: 'Leggio non risponde. Chiudere comunque?', detail: 'Le modifiche non salvate restano nel recupero automatico.', buttons: ['Chiudi', 'Attendi'], defaultId: 1, cancelId: 1 });
      if (r === 0) { forceClose = true; mainWindow.close(); }
      return;
    }
    wc.send('app:before-close');
  });
  mainWindow.on('closed', () => { mainWindow = null; });
}

// ---------- sicurezza di tutti i webContents ----------
async function confirmExternal(url) {
  const target = V.webUrl(url);
  if (!target) { L('warn', 'collegamento bloccato', { url: String(url).slice(0, 300) }); return false; }
  if (/^https:\/\/github\.com\/lorebiri\/leggio(\/|$)/.test(target)) { shell.openExternal(target); return true; }
  const r = await dialog.showMessageBox(mainWindow || undefined, {
    type: 'question', title: 'Aprire il collegamento?',
    message: target.startsWith('mailto:') ? 'Scrivere un messaggio di posta a questo indirizzo?' : 'Aprire questo indirizzo nel browser?',
    detail: target.length > 300 ? target.slice(0, 300) + '…' : target,
    buttons: ['Apri', 'Annulla'], defaultId: 1, cancelId: 1,
  });
  if (r.response === 0) { shell.openExternal(target); return true; }
  return false;
}

function hardenWebContents(wc) {
  wc.setWindowOpenHandler(({ url }) => { confirmExternal(url); return { action: 'deny' }; });
  wc.on('will-navigate', (e, url) => { if (!appUrlOk(url)) { e.preventDefault(); confirmExternal(url); } });
  wc.on('will-redirect', (e, url) => { if (!appUrlOk(url)) e.preventDefault(); });
  wc.on('will-attach-webview', (e) => e.preventDefault());
}

function senderOk(e) { return appUrlOk(e.senderFrame?.url || ''); }
/** ipcMain.handle con verifica del mittente e messaggi d'errore puliti. */
function handle(channel, fn) {
  ipcMain.removeHandler(channel);
  ipcMain.handle(channel, async (e, ...args) => {
    if (!senderOk(e)) { L('warn', 'IPC da mittente non autorizzato', { channel, url: e.senderFrame?.url }); throw new Error('Mittente non autorizzato'); }
    try { return await fn(e, ...args); }
    catch (err) {
      if (err.userMessage || err instanceof V.IpcValidationError) L('warn', `IPC ${channel}: ${err.message}`);
      else L('error', `IPC ${channel}: ${err.message}`, { stack: err.stack });
      throw new Error(typeof err.userMessage === 'string' ? err.userMessage : err.message);
    }
  });
}

// ---------- menu ----------
let toolsMenu = []; // [{ label, items:[{id, label}] }] dal renderer
function cmd(id) { return () => send('app:command', id); }
function buildMenu() {
  const recent = readRecent();
  const template = [
    ...(isMac ? [{ label: 'Leggio', submenu: [
      { role: 'about', label: 'Informazioni su Leggio' }, { type: 'separator' },
      { label: 'Impostazioni…', accelerator: 'Cmd+,', click: cmd('settings') }, { type: 'separator' },
      { role: 'hide', label: 'Nascondi Leggio' }, { role: 'hideOthers', label: 'Nascondi altre' }, { role: 'unhide', label: 'Mostra tutte' },
      { type: 'separator' }, { role: 'quit', label: 'Esci da Leggio' }] }] : []),
    { label: 'File', submenu: [
      { label: 'Apri…', accelerator: 'CmdOrCtrl+O', click: cmd('open') },
      { label: 'Apri recenti', submenu: recent.length ? [
        ...recent.map((p) => ({ label: p, click: () => sendOpen([p]) })),
        { type: 'separator' },
        { label: 'Svuota elenco', click: () => { try { fs.writeFileSync(recentFile(), '[]'); } catch { /* */ } app.clearRecentDocuments(); buildMenu(); } },
      ] : [{ label: 'Nessun file recente', enabled: false }] },
      { label: 'Crea PDF da file…', click: cmd('tool:create-pdf') },
      { type: 'separator' },
      { label: 'Salva', accelerator: 'CmdOrCtrl+S', click: cmd('save') },
      { label: 'Salva con nome…', accelerator: 'CmdOrCtrl+Shift+S', click: cmd('save-as') },
      { type: 'separator' },
      { label: 'Stampa…', accelerator: 'CmdOrCtrl+P', click: cmd('print') },
      { label: 'Proprietà documento…', accelerator: 'CmdOrCtrl+D', click: cmd('properties') },
      { type: 'separator' },
      { label: 'Chiudi scheda', accelerator: 'CmdOrCtrl+W', click: cmd('close-tab') },
      ...(isMac ? [] : [{ type: 'separator' }, { label: 'Impostazioni…', click: cmd('settings') }, { role: 'quit', label: 'Esci' }]),
    ] },
    { label: 'Modifica', submenu: [
      { label: 'Annulla', accelerator: 'CmdOrCtrl+Z', click: cmd('undo') },
      { label: 'Ripeti', accelerator: isMac ? 'Cmd+Shift+Z' : 'Ctrl+Y', click: cmd('redo') },
      { type: 'separator' },
      { role: 'cut', label: 'Taglia' }, { role: 'copy', label: 'Copia' }, { role: 'paste', label: 'Incolla' },
      { role: 'selectAll', label: 'Seleziona tutto' },
      { type: 'separator' },
      { label: 'Trova…', accelerator: 'CmdOrCtrl+F', click: cmd('find') },
    ] },
    { label: 'Vista', submenu: [
      { label: 'Ingrandisci', accelerator: 'CmdOrCtrl+Plus', click: cmd('zoom-in') },
      { label: 'Riduci', accelerator: 'CmdOrCtrl+-', click: cmd('zoom-out') },
      { label: 'Dimensioni reali', accelerator: 'CmdOrCtrl+0', click: cmd('zoom-reset') },
      { label: 'Adatta alla larghezza', accelerator: 'CmdOrCtrl+1', click: cmd('fit-width') },
      { label: 'Adatta alla pagina', accelerator: 'CmdOrCtrl+2', click: cmd('fit-page') },
      { type: 'separator' },
      { label: 'Ruota la visualizzazione (non modifica il file)', accelerator: 'CmdOrCtrl+R', click: cmd('rotate-view') },
      { label: 'Barra laterale', accelerator: 'F4', click: cmd('toggle-sidebar') },
      { label: 'Modalità lettura', accelerator: 'CmdOrCtrl+L', click: cmd('reading-mode') },
      { label: 'Tema chiaro/scuro', click: cmd('toggle-theme') },
      { type: 'separator' },
      { label: 'Caratteri e pulsanti grandi', click: cmd('toggle-large-ui') },
      { label: 'Ingrandisci l\'interfaccia', accelerator: 'CmdOrCtrl+Shift+Plus', click: cmd('ui-zoom-in') },
      { label: 'Riduci l\'interfaccia', accelerator: 'CmdOrCtrl+Shift+-', click: cmd('ui-zoom-out') },
      { label: 'Interfaccia a dimensione normale', click: cmd('ui-zoom-reset') },
      { type: 'separator' },
      { role: 'togglefullscreen', label: 'Schermo intero' },
      ...(app.isPackaged ? [] : [{ role: 'toggleDevTools', label: 'Strumenti sviluppatore' }, { role: 'reload', label: 'Ricarica' }]),
    ] },
    { label: 'Strumenti', submenu: [
      { label: 'Tutti gli strumenti…', accelerator: 'CmdOrCtrl+K', click: cmd('tools') },
      ...(toolsMenu.length ? [{ type: 'separator' }] : []),
      ...toolsMenu.map((g) => ({ label: g.label, submenu: g.items.map((t) => ({ label: t.label, click: cmd('tool:' + t.id) })) })),
    ] },
    { label: 'Finestra', submenu: [{ role: 'minimize', label: 'Riduci a icona' }, { role: 'zoom', label: 'Zoom' }] },
    { label: 'Aiuto', submenu: [
      { label: 'Sito di Leggio', click: () => shell.openExternal('https://github.com/lorebiri/leggio') },
      { label: 'Segnala un problema', click: () => shell.openExternal('https://github.com/lorebiri/leggio/issues') },
      { label: 'Scorciatoie da tastiera', click: cmd('shortcuts') },
      { type: 'separator' },
      { label: 'Controlla aggiornamenti…', click: () => require('./updater.cjs').checkInteractive(mainWindow) },
      { label: 'Recupera documenti non salvati…', click: () => send('app:open-recovery') },
      { label: 'Apri cartella dei log', click: () => openLogs() },
    ] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
function openLogs() { try { fs.mkdirSync(logger.dir, { recursive: true }); } catch { /* */ } return shell.openPath(logger.dir); }

// ---------- IPC di base ----------
function registerCoreIpc() {
  handle('file:open-dialog', async (_e, opts = {}) => {
    const res = await dialog.showOpenDialog(mainWindow, {
      title: V.optStr(opts.title, 'titolo', 200) || 'Apri',
      properties: ['openFile', ...(opts.multiple ? ['multiSelections'] : [])],
      filters: V.filters(opts.filters) || [{ name: 'Documenti PDF', extensions: ['pdf'] }],
    });
    if (res.canceled) return [];
    return res.filePaths.map((p) => (/\.pdf$/i.test(p) && !opts.raw ? readPdf(p) : { path: p, name: path.basename(p), bytes: readFileChecked(p) }));
  });
  handle('file:save-dialog', async (_e, { defaultName, filters, bytes, title } = {}) => {
    if (bytes != null) V.bytes(bytes);
    const res = await dialog.showSaveDialog(mainWindow, {
      title: V.optStr(title, 'titolo', 200) || 'Salva', defaultPath: V.optStr(defaultName, 'nome', 1024),
      filters: V.filters(filters) || [{ name: 'Documenti PDF', extensions: ['pdf'] }],
    });
    if (res.canceled || !res.filePath) return null;
    grantFile(res.filePath);
    if (bytes) await safeWrite(res.filePath, bytes);
    if (/\.pdf$/i.test(res.filePath)) addRecent(res.filePath);
    return { path: res.filePath, name: path.basename(res.filePath) };
  });
  handle('file:choose-folder', async (_e, { title } = {}) => {
    const res = await dialog.showOpenDialog(mainWindow, { title: V.optStr(title, 'titolo', 200) || 'Scegli cartella', properties: ['openDirectory', 'createDirectory'] });
    if (res.canceled) return null;
    grantFolder(res.filePaths[0]);
    return res.filePaths[0];
  });
  handle('file:write', async (_e, { path: p, bytes } = {}) => {
    const target = V.absPath(p);
    V.bytes(bytes);
    if (!canWrite(target)) throw Object.assign(new Error(`Leggio non ha il permesso di scrivere «${path.basename(target)}» (file non aperto né scelto dall'utente). Usa «Salva con nome».`), { userMessage: true });
    const t0 = Date.now();
    const r = await safeWrite(target, bytes);
    L('info', 'salvato', { name: path.basename(target), size: bytes.byteLength, ms: Date.now() - t0, strategy: r.strategy });
    cleanStaleTemps(target);
    return true;
  });
  handle('file:write-in-folder', async (_e, { folder, name, bytes } = {}) => {
    const dir = V.absPath(folder, 'cartella');
    if (!grantedFolders.has(norm(dir))) throw Object.assign(new Error('Cartella non scelta dall\'utente: scegline una con il dialogo.'), { userMessage: true });
    const p = path.join(dir, V.fileName(name));
    V.bytes(bytes);
    await safeWrite(p, bytes);
    return p;
  });
  handle('file:read', async (_e, p) => {
    const target = V.absPath(p);
    if (/\.pdf$/i.test(target)) return readPdf(target);
    if (!grantedReads.has(norm(target))) throw new V.IpcValidationError('Si possono riaprire solo file PDF o file aperti dall\'utente.');
    return { path: target, name: path.basename(target), bytes: readFileChecked(target) };
  });
  handle('file:recent', () => readRecent());
  handle('file:show-in-folder', (_e, p) => shell.showItemInFolder(V.absPath(p)));
  handle('app:open-external', (_e, url) => confirmExternal(V.str(url, 'url', 8192)));
  handle('app:info', () => ({ version: app.getVersion(), platform: process.platform, userData: app.getPath('userData'), resources: process.resourcesPath, packaged: app.isPackaged }));
  handle('app:printers', async () => {
    const list = await mainWindow.webContents.getPrintersAsync();
    return list.map((p) => ({ name: p.name, displayName: p.displayName || p.name, isDefault: !!p.isDefault, description: p.description || '' }));
  });
  // Stampa del contenuto preparato dal renderer (#print-root). Con una stampante scelta niente finestra di sistema.
  handle('app:print', async (_e, o = {}) => {
    const printer = o.printer ? V.str(o.printer, 'stampante', 512) : '';
    if (printer) {
      const ok = (await mainWindow.webContents.getPrintersAsync()).some((p) => p.name === printer);
      if (!ok) return { ok: false, err: 'stampante non disponibile' };
    }
    const opts = {
      silent: !!printer, deviceName: printer || undefined, printBackground: true,
      copies: Math.max(1, Math.min(99, Math.floor(Number(o.copies) || 1))),
      duplexMode: ['simplex', 'longEdge', 'shortEdge'].includes(o.duplex) ? o.duplex : 'simplex',
      color: o.color !== false, margins: { marginType: 'none' },
    };
    L('info', 'stampa', { silent: opts.silent, copies: opts.copies, duplex: opts.duplexMode, color: opts.color });
    return new Promise((resolve) => mainWindow.webContents.print(opts, (ok, err) => resolve({ ok, err: err || '' })));
  });
  handle('app:set-theme', (_e, t) => { if (['system', 'light', 'dark'].includes(t)) nativeTheme.themeSource = t; });
  handle('app:set-title', (_e, t) => { if (mainWindow) mainWindow.setTitle(V.str(t, 'titolo', 500)); });
  handle('app:confirm-close', () => { forceClose = true; if (mainWindow) mainWindow.close(); });

  // --- registro ---
  handle('app:log', (_e, entry = {}) => {
    const level = ['info', 'warn', 'error'].includes(entry?.level) ? entry.level : 'info';
    L(level, String(entry?.message ?? '').slice(0, 2000), entry?.data, 'renderer');
  });
  handle('app:open-logs', () => openLogs());

  // --- memoria e disco ---
  handle('app:memory', () => {
    let diskFree = 0;
    try { const s = fs.statfsSync(app.getPath('temp')); diskFree = s.bavail * s.bsize; } catch { /* */ }
    return { total: os.totalmem(), free: os.freemem(), diskFree };
  });

  // --- cronologia Annulla su disco (cartella temporanea dell'app, ripulita all'avvio e all'uscita) ---
  handle('app:history-put', async (_e, bytes) => {
    V.bytes(bytes);
    await fsp.mkdir(historyDir(), { recursive: true });
    const key = crypto.randomBytes(12).toString('hex');
    const file = path.join(historyDir(), key + '.bin');
    try { await fsp.writeFile(file, bytes, { flag: 'wx' }); }
    catch (err) { await fsp.unlink(file).catch(() => {}); throw friendly(err, file, 'history'); }
    return key;
  });
  handle('app:history-get', async (_e, key) => {
    const b = await fsp.readFile(path.join(historyDir(), V.key(key) + '.bin'));
    return new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
  });
  handle('app:history-drop', async (_e, keys) => {
    if (!Array.isArray(keys) || keys.length > 1000) throw new V.IpcValidationError('Chiavi non valide');
    for (const k of keys) await fsp.unlink(path.join(historyDir(), V.key(k) + '.bin')).catch(() => {});
  });
  handle('app:history-clear', () => rmrf(historyDir()));

  // --- recupero automatico (userData/recupero/<sessione>/) ---
  handle('app:recovery-write', async (_e, { meta, bytes } = {}) => {
    V.bytes(bytes);
    const id = Number(meta?.id);
    if (!Number.isInteger(id) || id < 0) throw new V.IpcValidationError('id non valido');
    const m = { id, name: V.str(meta.name, 'nome', 1024), path: meta.path ? V.absPath(meta.path) : null, size: bytes.byteLength, time: Date.now(), pages: Number(meta.pages) || 0 };
    const dir = recoveryDir();
    await fsp.mkdir(dir, { recursive: true });
    await safeWrite(path.join(dir, `${id}.pdf`), bytes, { verify: false });
    await safeWrite(path.join(dir, `${id}.json`), Buffer.from(JSON.stringify(m)), { verify: false });
    return true;
  });
  handle('app:recovery-remove', async (_e, { id } = {}) => {
    const n = Number(id); if (!Number.isInteger(n) || !recoverySession) return;
    for (const ext of ['.pdf', '.json']) await fsp.unlink(path.join(recoveryDir(), n + ext)).catch(() => {});
  });
  handle('app:recovery-list', async () => {
    const out = [];
    let sessions = [];
    try { sessions = await fsp.readdir(recoveryRoot()); } catch { return out; }
    for (const s of sessions) {
      if (s === recoverySession || !SESSION_RE.test(s)) continue;
      const dir = path.join(recoveryRoot(), s);
      let files = [];
      try { files = await fsp.readdir(dir); } catch { continue; }
      for (const f of files.filter((x) => x.endsWith('.json'))) {
        try {
          const m = JSON.parse(await fsp.readFile(path.join(dir, f), 'utf8'));
          if (fs.existsSync(path.join(dir, `${m.id}.pdf`))) out.push({ ...m, session: s });
        } catch { /* voce rovinata: ignorata */ }
      }
    }
    return out.sort((a, b) => b.time - a.time);
  });
  handle('app:recovery-read', async (_e, { session: s, id } = {}) => {
    if (typeof s !== 'string' || !SESSION_RE.test(s)) throw new V.IpcValidationError('sessione non valida');
    const n = Number(id); if (!Number.isInteger(n)) throw new V.IpcValidationError('id non valido');
    const dir = path.join(recoveryRoot(), s);
    try { const m = JSON.parse(await fsp.readFile(path.join(dir, `${n}.json`), 'utf8')); if (m.path) grantFile(m.path); } catch { /* */ }
    const b = await fsp.readFile(path.join(dir, `${n}.pdf`));
    return new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
  });
  handle('app:recovery-discard', async (_e, { session: s } = {}) => {
    if (typeof s !== 'string' || !SESSION_RE.test(s) || s === recoverySession) return;
    rmrf(path.join(recoveryRoot(), s));
  });

  // --- menu Strumenti generato dagli strumenti registrati ---
  handle('app:tools-menu', (_e, groups) => {
    if (!Array.isArray(groups) || groups.length > 30) throw new V.IpcValidationError('menu non valido');
    toolsMenu = groups.map((g) => ({
      label: V.str(g?.label, 'categoria', 100),
      items: (Array.isArray(g?.items) ? g.items : []).slice(0, 200).map((t) => ({ id: V.str(t?.id, 'id', 100), label: V.str(t?.label, 'nome', 200) })),
    })).filter((g) => g.items.length);
    buildMenu();
  });

  // percorso di un file trascinato: arriva dal preload (webUtils), non dal codice della pagina
  ipcMain.removeHandler('internal:grant-dropped');
  ipcMain.handle('internal:grant-dropped', (e, p) => {
    if (!senderOk(e) || typeof p !== 'string' || !path.isAbsolute(p)) return false;
    if (/\.pdf$/i.test(p)) { grantFile(p); addRecent(p); }
    return true;
  });
}

function registerFeatureModules() {
  const dir = path.join(__dirname, 'features');
  if (!fs.existsSync(dir)) return;
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.cjs')).sort()) {
    try { require(path.join(dir, f)).register({ ipcMain, app, BrowserWindow, dialog, getWindow: () => mainWindow }); }
    catch (err) { console.error('[leggio] modulo main non caricato:', f, err); L('error', 'modulo main non caricato: ' + f, { error: err.message }); }
  }
}

// ---------- ciclo di vita ----------
// cartella dati separata (collaudo automatico, più copie in parallelo): LEGGIO_USER_DATA=/percorso
if (process.env.LEGGIO_USER_DATA) app.setPath('userData', path.resolve(process.env.LEGGIO_USER_DATA));
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();
else {
  app.on('second-instance', (_e, argv) => { sendOpen(argv.slice(1)); if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.focus(); } });
  app.on('open-file', (e, p) => { e.preventDefault(); sendOpen([p]); });
  app.on('web-contents-created', (_e, wc) => hardenWebContents(wc));
  app.whenReady().then(() => {
    logger = createLogger(path.join(app.getPath('userData'), 'logs'));
    L('info', 'avvio', { version: app.getVersion(), electron: process.versions.electron, platform: process.platform, arch: process.arch, mem: os.totalmem() });
    // cronologie temporanee di sessioni precedenti (processi terminati) e la nostra, se esiste
    cleanStaleHistory();
    rmrf(historyDir());
    cleanEmptyRecoverySessions();
    // nessun permesso del browser (fotocamera, microfono, posizione, notifiche…) tranne il minimo indispensabile
    const allowed = new Set(['clipboard-sanitized-write', 'fullscreen']);
    session.defaultSession.setPermissionRequestHandler((_wc, perm, cb) => cb(allowed.has(perm)));
    session.defaultSession.setPermissionCheckHandler((_wc, perm) => allowed.has(perm));
    registerCoreIpc();
    registerFeatureModules();
    buildMenu();
    createWindow();
    require('./updater.cjs').setup({ getWindow: () => mainWindow });
    sendOpen(process.argv.slice(app.isPackaged ? 1 : 2));
    app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
  });
  app.on('window-all-closed', () => { if (!isMac) app.quit(); });
  app.on('will-quit', () => {
    rmrf(historyDir());
    cleanEmptyRecoverySessions();
    L('info', 'uscita');
  });
}
