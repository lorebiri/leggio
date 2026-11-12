// Leggio — processo principale Electron.
// Gestisce finestre, menu, dialoghi file, file recenti e i moduli "feature" lato main
// (ogni file in electron/features/*.cjs esporta register({ ipcMain, app, BrowserWindow, dialog })).
const { app, BrowserWindow, ipcMain, dialog, Menu, shell, nativeTheme } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

const isMac = process.platform === 'darwin';
const pendingOpen = [];
let mainWindow = null;

// ---------- file recenti ----------
const recentFile = () => path.join(app.getPath('userData'), 'recenti.json');
function readRecent() {
  try { return JSON.parse(fs.readFileSync(recentFile(), 'utf8')).filter((p) => fs.existsSync(p)); } catch { return []; }
}
function addRecent(p) {
  const list = [p, ...readRecent().filter((x) => x !== p)].slice(0, 15);
  try { fs.writeFileSync(recentFile(), JSON.stringify(list)); } catch {}
  if (isMac || process.platform === 'win32') app.addRecentDocument(p);
  buildMenu();
}

function readPdf(p) {
  const bytes = fs.readFileSync(p);
  addRecent(p);
  return { path: p, name: path.basename(p), bytes: new Uint8Array(bytes) };
}

function sendOpen(paths) {
  const files = paths.filter((p) => /\.pdf$/i.test(p) && fs.existsSync(p));
  if (!files.length) return;
  if (mainWindow && mainWindow.webContents && !mainWindow.webContents.isLoading()) {
    for (const p of files) mainWindow.webContents.send('app:open-file', readPdf(p));
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  } else pendingOpen.push(...files);
}

// ---------- finestra ----------
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
      sandbox: false,
      spellcheck: true,
    },
  });
  const devUrl = process.env.LEGGIO_DEV_URL;
  if (devUrl) mainWindow.loadURL(devUrl);
  else mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));

  mainWindow.webContents.on('did-finish-load', () => {
    const files = pendingOpen.splice(0);
    for (const p of files) mainWindow.webContents.send('app:open-file', readPdf(p));
  });
  // link esterni nel browser di sistema
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^(https?|mailto):/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file:') && !(devUrl && url.startsWith(devUrl))) { e.preventDefault(); if (/^(https?|mailto):/i.test(url)) shell.openExternal(url); }
  });
  // chiusura con modifiche non salvate: chiede al renderer
  let forceClose = false;
  mainWindow.on('close', (e) => {
    if (forceClose) return;
    e.preventDefault();
    mainWindow.webContents.send('app:before-close');
  });
  ipcMain.removeHandler('app:confirm-close');
  ipcMain.handle('app:confirm-close', () => { forceClose = true; mainWindow.close(); });
  mainWindow.on('closed', () => { mainWindow = null; });
}

// ---------- menu ----------
function cmd(id) { return () => mainWindow && mainWindow.webContents.send('app:command', id); }
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
        { label: 'Svuota elenco', click: () => { try { fs.writeFileSync(recentFile(), '[]'); } catch {} app.clearRecentDocuments(); buildMenu(); } },
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
      { label: 'Tutti gli strumenti', accelerator: 'CmdOrCtrl+K', click: cmd('tools') },
    ] },
    { label: 'Vista', submenu: [
      { label: 'Ingrandisci', accelerator: 'CmdOrCtrl+Plus', click: cmd('zoom-in') },
      { label: 'Riduci', accelerator: 'CmdOrCtrl+-', click: cmd('zoom-out') },
      { label: 'Dimensioni reali', accelerator: 'CmdOrCtrl+0', click: cmd('zoom-reset') },
      { label: 'Adatta alla larghezza', accelerator: 'CmdOrCtrl+1', click: cmd('fit-width') },
      { label: 'Adatta alla pagina', accelerator: 'CmdOrCtrl+2', click: cmd('fit-page') },
      { type: 'separator' },
      { label: 'Ruota vista in senso orario', accelerator: 'CmdOrCtrl+R', click: cmd('rotate-view') },
      { label: 'Barra laterale', accelerator: 'F4', click: cmd('toggle-sidebar') },
      { label: 'Modalità lettura', accelerator: 'CmdOrCtrl+L', click: cmd('reading-mode') },
      { label: 'Tema chiaro/scuro', click: cmd('toggle-theme') },
      { type: 'separator' },
      { role: 'togglefullscreen', label: 'Schermo intero' },
      ...(app.isPackaged ? [] : [{ role: 'toggleDevTools', label: 'Strumenti sviluppatore' }, { role: 'reload', label: 'Ricarica' }]),
    ] },
    { label: 'Finestra', submenu: [{ role: 'minimize', label: 'Riduci a icona' }, { role: 'zoom', label: 'Zoom' }] },
    { label: 'Aiuto', submenu: [
      { label: 'Sito di Leggio', click: () => shell.openExternal('https://github.com/lorebiri/leggio') },
      { label: 'Segnala un problema', click: () => shell.openExternal('https://github.com/lorebiri/leggio/issues') },
      { label: 'Scorciatoie da tastiera', click: cmd('shortcuts') },
      { type: 'separator' }, { label: 'Controlla aggiornamenti…', click: () => require('./updater.cjs').checkInteractive(mainWindow) },
    ] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---------- IPC di base ----------
function registerCoreIpc() {
  ipcMain.handle('file:open-dialog', async (_e, opts = {}) => {
    const res = await dialog.showOpenDialog(mainWindow, {
      title: opts.title || 'Apri',
      properties: ['openFile', ...(opts.multiple ? ['multiSelections'] : [])],
      filters: opts.filters || [{ name: 'Documenti PDF', extensions: ['pdf'] }],
    });
    if (res.canceled) return [];
    return res.filePaths.map((p) => {
      const isPdf = /\.pdf$/i.test(p);
      return isPdf && !opts.raw ? readPdf(p) : { path: p, name: path.basename(p), bytes: new Uint8Array(fs.readFileSync(p)) };
    });
  });
  ipcMain.handle('file:save-dialog', async (_e, { defaultName, filters, bytes, title }) => {
    const res = await dialog.showSaveDialog(mainWindow, {
      title: title || 'Salva', defaultPath: defaultName,
      filters: filters || [{ name: 'Documenti PDF', extensions: ['pdf'] }],
    });
    if (res.canceled || !res.filePath) return null;
    if (bytes) fs.writeFileSync(res.filePath, Buffer.from(bytes));
    if (/\.pdf$/i.test(res.filePath)) addRecent(res.filePath);
    return { path: res.filePath, name: path.basename(res.filePath) };
  });
  ipcMain.handle('file:choose-folder', async (_e, { title } = {}) => {
    const res = await dialog.showOpenDialog(mainWindow, { title: title || 'Scegli cartella', properties: ['openDirectory', 'createDirectory'] });
    return res.canceled ? null : res.filePaths[0];
  });
  ipcMain.handle('file:write', async (_e, { path: p, bytes }) => {
    // scrittura atomica: file temporaneo + rename, così un errore non rovina l'originale
    const tmp = p + '.leggio-tmp';
    fs.writeFileSync(tmp, Buffer.from(bytes));
    fs.renameSync(tmp, p);
    return true;
  });
  ipcMain.handle('file:write-in-folder', async (_e, { folder, name, bytes }) => {
    const p = path.join(folder, name.replace(/[\\/:*?"<>|]/g, '_'));
    fs.writeFileSync(p, Buffer.from(bytes));
    return p;
  });
  ipcMain.handle('file:read', async (_e, p) => readPdf(p));
  ipcMain.handle('file:recent', () => readRecent());
  ipcMain.handle('file:show-in-folder', (_e, p) => shell.showItemInFolder(p));
  ipcMain.handle('app:open-external', (_e, url) => { if (/^(https?|mailto):/i.test(url)) shell.openExternal(url); });
  ipcMain.handle('app:info', () => ({ version: app.getVersion(), platform: process.platform, userData: app.getPath('userData'), resources: process.resourcesPath, packaged: app.isPackaged }));
  ipcMain.handle('app:print', () => new Promise((resolve) => mainWindow.webContents.print({ silent: false, printBackground: true }, (ok, err) => resolve({ ok, err }))));
  ipcMain.handle('app:set-theme', (_e, t) => { nativeTheme.themeSource = t; });
  ipcMain.handle('app:set-title', (_e, t) => { if (mainWindow) mainWindow.setTitle(t); });
}

function registerFeatureModules() {
  const dir = path.join(__dirname, 'features');
  if (!fs.existsSync(dir)) return;
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.cjs')).sort()) {
    try { require(path.join(dir, f)).register({ ipcMain, app, BrowserWindow, dialog, getWindow: () => mainWindow }); }
    catch (err) { console.error('[leggio] modulo main non caricato:', f, err); }
  }
}

// ---------- ciclo di vita ----------
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();
else {
  app.on('second-instance', (_e, argv) => sendOpen(argv.slice(1)));
  app.on('open-file', (e, p) => { e.preventDefault(); sendOpen([p]); });
  app.whenReady().then(() => {
    registerCoreIpc();
    registerFeatureModules();
    buildMenu();
    createWindow();
    require('./updater.cjs').setup({ getWindow: () => mainWindow });
    sendOpen(process.argv.slice(app.isPackaged ? 1 : 2));
    app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
  });
  app.on('window-all-closed', () => { if (!isMac) app.quit(); });
}
