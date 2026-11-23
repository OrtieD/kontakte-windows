const { app, BrowserWindow, ipcMain, dialog, shell, nativeTheme, Menu } = require('electron');
const path = require('path');
const fs = require('fs');

// Kontakte braucht keine 3D-Grafik: GPU komplett aus (verhindert Treiber-Abstürze)
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-gpu-compositing');
app.commandLine.appendSwitch('disable-software-rasterizer');

const DATA_DIR = app.getPath('userData');
const LOG_FILE = path.join(DATA_DIR, 'log.txt');
function log(...a) { try { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.appendFileSync(LOG_FILE, `[${new Date().toISOString()}] ${a.join(' ')}\n`); } catch (_) {} }
try { if (fs.existsSync(LOG_FILE) && fs.statSync(LOG_FILE).size > 1e6) fs.unlinkSync(LOG_FILE); } catch (_) {}
log('Start', app.getVersion(), process.platform, process.arch, require('os').release());
process.on('uncaughtException', e => log('uncaughtException', e.stack || e));
app.on('child-process-gone', (_e, d) => log('child-process-gone', JSON.stringify(d)));
app.on('render-process-gone', (_e, _w, d) => log('render-process-gone', JSON.stringify(d)));
const DATA_FILE = path.join(DATA_DIR, 'contacts.json');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');

let win;
let pendingOpenFiles = process.argv.slice(1).filter(a => a.toLowerCase().endsWith('.vcf'));

function overlayColors() {
  const dark = nativeTheme.shouldUseDarkColors;
  return { color: dark ? '#2b2b2d' : '#ececec', symbolColor: dark ? '#e6e6e6' : '#333333', height: 38 };
}

function createWindow() {
  win = new BrowserWindow({
    width: 1180, height: 760, minWidth: 820, minHeight: 520,
    title: 'Kontakte',
        backgroundColor: nativeTheme.shouldUseDarkColors ? '#1e1e1e' : '#ffffff',
    icon: path.join(__dirname, 'src', 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, spellcheck: true }
  });
  Menu.setApplicationMenu(null);
  win.webContents.on('did-finish-load', () => log('Fenster geladen'));
  win.loadFile(path.join(__dirname, 'src', 'index.html'));
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
}

// Single instance: .vcf-Doppelklick öffnet in laufender App
if (!app.requestSingleInstanceLock()) { app.quit(); }
else {
  app.on('second-instance', (_e, argv) => {
    const files = argv.filter(a => a.toLowerCase().endsWith('.vcf'));
    if (win) { if (win.isMinimized()) win.restore(); win.focus(); if (files.length) win.webContents.send('open-files', readFiles(files)); }
  });
  app.whenReady().then(createWindow);
  app.on('window-all-closed', () => app.quit());
}

function readFiles(files) {
  return files.map(f => { try { return fs.readFileSync(f, 'utf8'); } catch (_) { return ''; } }).filter(Boolean);
}

// ---------- Datenhaltung ----------
ipcMain.handle('load', () => {
  try {
    if (fs.existsSync(DATA_FILE)) return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch (e) {
    // defekte Datei sichern, nicht überschreiben
    try { fs.copyFileSync(DATA_FILE, DATA_FILE + '.defekt-' + Date.now()); } catch (_) {}
  }
  return null;
});

let lastBackupDay = '';
ipcMain.handle('save', (_e, data) => {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data));
  fs.renameSync(tmp, DATA_FILE);
  // tägliches Backup, 14 Stück aufbewahren
  const day = new Date().toISOString().slice(0, 10);
  if (day !== lastBackupDay) {
    lastBackupDay = day;
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const target = path.join(BACKUP_DIR, `contacts-${day}.json`);
    if (!fs.existsSync(target)) fs.copyFileSync(DATA_FILE, target);
    const all = fs.readdirSync(BACKUP_DIR).filter(f => f.startsWith('contacts-')).sort();
    all.slice(0, Math.max(0, all.length - 14)).forEach(f => fs.unlinkSync(path.join(BACKUP_DIR, f)));
  }
  return true;
});

ipcMain.handle('initial-files', () => { const r = readFiles(pendingOpenFiles); pendingOpenFiles = []; return r; });

ipcMain.handle('import-dialog', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'Kontakte importieren', properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'vCard / CSV', extensions: ['vcf', 'vcard', 'csv'] }]
  });
  if (r.canceled) return [];
  return r.filePaths.map(f => ({ name: path.basename(f), text: fs.readFileSync(f, 'utf8') }));
});

ipcMain.handle('export-dialog', async (_e, { defaultName, content, ext }) => {
  const r = await dialog.showSaveDialog(win, {
    title: 'Exportieren', defaultPath: path.join(app.getPath('documents'), defaultName),
    filters: ext === 'csv' ? [{ name: 'CSV (Excel)', extensions: ['csv'] }] : [{ name: 'vCard', extensions: ['vcf'] }]
  });
  if (r.canceled || !r.filePath) return false;
  fs.writeFileSync(r.filePath, (ext === 'csv' ? '﻿' : '') + content, 'utf8');
  return true;
});

ipcMain.handle('pick-photo', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'Foto wählen', properties: ['openFile'], filters: [{ name: 'Bilder', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'] }] });
  if (r.canceled) return null;
  const f = r.filePaths[0];
  const ext = path.extname(f).slice(1).toLowerCase().replace('jpg', 'jpeg');
  return `data:image/${ext};base64,` + fs.readFileSync(f).toString('base64');
});

ipcMain.handle('confirm', async (_e, { message, detail, ok }) => {
  const r = await dialog.showMessageBox(win, { type: 'warning', buttons: [ok || 'Löschen', 'Abbrechen'], defaultId: 1, cancelId: 1, message, detail });
  return r.response === 0;
});

// ---------- iCloud / CardDAV ----------
const { safeStorage } = require('electron');
const { CardDAV } = require('./carddav');
const ICLOUD_FILE = path.join(DATA_DIR, 'icloud.json');
let dav = null, davCfg = null;

function loadIcloud() {
  try {
    const c = JSON.parse(fs.readFileSync(ICLOUD_FILE, 'utf8'));
    const pass = c.enc && safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(Buffer.from(c.pass, 'base64')) : Buffer.from(c.pass, 'base64').toString();
    davCfg = c; dav = new CardDAV(c.appleId, pass);
  } catch (_) { dav = null; davCfg = null; }
}
app.whenReady().then(loadIcloud);
const needDav = () => { if (!dav) throw new Error('Nicht mit iCloud verbunden'); return dav; };

ipcMain.handle('icloud-status', () => davCfg ? { connected: true, appleId: davCfg.appleId } : { connected: false });
ipcMain.handle('icloud-connect', async (_e, { appleId, pass }) => {
  const client = new CardDAV(appleId.trim(), pass.trim());
  let book;
  try { ({ book } = await client.discover()); log('iCloud verbunden, Adressbuch', book); }
  catch (e) { log('iCloud-Verbindung fehlgeschlagen:', e.message, e.detail || ''); throw e; }
  const enc = safeStorage.isEncryptionAvailable();
  const stored = enc ? safeStorage.encryptString(pass.trim()).toString('base64') : Buffer.from(pass.trim()).toString('base64');
  davCfg = { appleId: appleId.trim(), pass: stored, enc, book };
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(ICLOUD_FILE, JSON.stringify(davCfg));
  dav = client;
  return { connected: true, appleId: davCfg.appleId };
});
ipcMain.handle('icloud-disconnect', () => { try { fs.unlinkSync(ICLOUD_FILE); } catch (_) {} dav = null; davCfg = null; return true; });
ipcMain.handle('dav-list', () => needDav().list(davCfg.book));
ipcMain.handle('dav-multiget', (_e, hrefs) => needDav().multiget(davCfg.book, hrefs));
ipcMain.handle('dav-put', (_e, { href, data, etag }) => needDav().put(davCfg.book, href, data, etag));
ipcMain.handle('dav-del', (_e, { href, etag }) => needDav().del(davCfg.book, href, etag));
ipcMain.handle('dav-book', () => davCfg ? new URL(davCfg.book).pathname : null);

ipcMain.handle('log', (_e, msg) => log(msg));
ipcMain.handle('open-external', (_e, url) => shell.openExternal(url));
ipcMain.handle('open-data-folder', () => shell.openPath(DATA_DIR));
