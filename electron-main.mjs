// Electron main process. Serves dist/ over a privileged app:// scheme so ES
// modules, fetch() of GLB/HDR/DRACO wasm and WebGL textures work (file:// blocks
// them), and adds the desktop layer: secure preload bridge, native menu, native
// notifications, save dialog, external-link handling, window state, single instance.
import { app, BrowserWindow, Menu, Notification, dialog, ipcMain, net, powerSaveBlocker, protocol, screen, shell } from 'electron';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promises as fs, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  APP_ORIGIN, CONTENT_SECURITY_POLICY, clampWindowState, exportFileName, isAllowedExternal, isAppUrl,
  isMenuCommand, sanitizeNotification, serializeRunExport,
} from './electron-security.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, 'dist');
const isDev = !app.isPackaged;
const smoke = process.env.ELECTRON_SMOKE === '1';
const APP_NAME = 'SPEED FOR NEED';
const BACKGROUND = '#0e1013';

app.setName(APP_NAME);
// Audio can start without a prior click inside the desktop shell.
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

if (!smoke && !app.requestSingleInstanceLock()) {
  app.quit();
}

let win = null;
let sleepBlocker = null;
const statePath = () => path.join(app.getPath('userData'), 'window-state.json');

function loadWindowState() {
  let saved = null;
  try { saved = JSON.parse(readFileSync(statePath(), 'utf8')); } catch {}
  return clampWindowState(saved, screen.getPrimaryDisplay().workArea);
}

function saveWindowState() {
  if (!win || win.isDestroyed() || win.isFullScreen()) return;
  const maximized = win.isMaximized();
  const b = maximized ? win.getNormalBounds() : win.getBounds();
  try { writeFileSync(statePath(), JSON.stringify({ ...b, maximized })); } catch {}
}

function send(command) {
  if (win && !win.isDestroyed() && isMenuCommand(command)) win.webContents.send('menu-command', command);
}

function buildMenu() {
  const mac = process.platform === 'darwin';
  const about = () => dialog.showMessageBox(win, {
    type: 'info', title: `About ${APP_NAME}`, message: APP_NAME,
    detail: `Version ${app.getVersion()}\nElectron ${process.versions.electron} · Chromium ${process.versions.chrome}\n\nOpen-world arcade racer built with three.js and Planck.js.`,
  });
  const credits = () => shell.openExternal('https://kenney.nl/assets/racing-kit');
  const template = [
    ...(mac ? [{ label: APP_NAME, submenu: [{ label: `About ${APP_NAME}`, click: about }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' }] }] : []),
    { label: 'Game', submenu: [
      { label: 'Pause / Resume', accelerator: 'CmdOrCtrl+P', click: () => send('pause') },
      { label: 'Reset to Road', accelerator: 'CmdOrCtrl+Shift+R', click: () => send('reset') },
      { type: 'separator' },
      { label: 'Export Run Data…', accelerator: 'CmdOrCtrl+E', click: () => send('export') },
      ...(mac ? [] : [{ type: 'separator' }, { label: 'Quit Game', accelerator: 'Alt+F4', click: () => app.quit() }]),
    ] },
    { label: 'View', submenu: [
      { role: 'togglefullscreen', accelerator: 'F11' },
      { type: 'separator' },
      { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' },
      ...(isDev ? [{ type: 'separator' }, { role: 'toggleDevTools' }] : []),
    ] },
    { label: 'Window', submenu: [{ role: 'minimize' }, { role: 'close' }] },
    { label: 'Help', submenu: [
      { label: 'Asset Credits (Kenney)', click: credits },
      ...(mac ? [] : [{ type: 'separator' }, { label: `About ${APP_NAME}`, click: about }]),
    ] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// IPC handlers: every one checks that the call comes from the game page.
function handle(channel, fn) {
  ipcMain.handle(channel, (event, ...args) => {
    if (!isAppUrl(event.senderFrame?.url)) throw new Error('Blocked IPC from untrusted frame');
    return fn(event, ...args);
  });
}

function registerIpc() {
  handle('app:notify', (_event, payload) => {
    const clean = sanitizeNotification(payload);
    if (!clean || !Notification.isSupported()) return false;
    new Notification({ ...clean, silent: true }).show();
    return true;
  });
  handle('app:save-run', async (_event, data) => {
    const text = serializeRunExport(data);
    if (text === null) return { ok: false, error: 'invalid-data' };
    const result = await dialog.showSaveDialog(win, {
      title: 'Export run data',
      defaultPath: path.join(app.getPath('documents'), exportFileName()),
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (result.canceled || !result.filePath) return { ok: false, canceled: true };
    await fs.writeFile(result.filePath, text, 'utf8');
    return { ok: true, path: result.filePath };
  });
  handle('app:open-external', async (_event, url) => {
    if (!isAllowedExternal(url)) return false;
    await shell.openExternal(url);
    return true;
  });
  handle('app:toggle-fullscreen', () => { win.setFullScreen(!win.isFullScreen()); return win.isFullScreen(); });
  handle('app:quit', () => { app.quit(); });
}

function createWindow() {
  const state = loadWindowState();
  win = new BrowserWindow({
    width: state.width, height: state.height, x: state.x, y: state.y,
    minWidth: 800, minHeight: 500,
    title: APP_NAME, backgroundColor: BACKGROUND, show: false,
    webPreferences: {
      preload: path.join(here, 'preload.cjs'),
      contextIsolation: true, sandbox: true, nodeIntegration: false,
      spellcheck: false, devTools: isDev,
    },
  });
  if (state.maximized) win.maximize();
  win.once('ready-to-show', () => win.show());

  // Links never open a second game window; https links go to the default browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternal(url)) shell.openExternal(url);
    // In-app documents (CREDITS.md, RESEARCH.md) open in a plain, script-less child window.
    if (isAppUrl(url)) {
      return { action: 'allow', overrideBrowserWindowOptions: { width: 900, height: 700, autoHideMenuBar: true, parent: win, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, devTools: false } } };
    }
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (isAppUrl(url)) return;
    event.preventDefault();
    if (isAllowedExternal(url)) shell.openExternal(url);
  });
  win.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));

  win.on('resize', saveWindowState);
  win.on('move', saveWindowState);
  win.on('close', saveWindowState);
  win.on('focus', () => { if (sleepBlocker === null) sleepBlocker = powerSaveBlocker.start('prevent-display-sleep'); });
  win.on('blur', () => {
    if (sleepBlocker !== null) { powerSaveBlocker.stop(sleepBlocker); sleepBlocker = null; }
    send('blur');
  });
  win.on('closed', () => { win = null; });

  if (smoke) {
    const errors = [];
    win.webContents.on('console-message', (event) => { if (event.level === 'error') errors.push(event.message); });
    win.webContents.on('did-fail-load', (_e, code, desc) => errors.push(`did-fail-load ${code} ${desc}`));
    win.webContents.once('did-finish-load', () => setTimeout(async () => {
      let api = '{}';
      try {
        api = await win.webContents.executeJavaScript(`JSON.stringify({
          api: Object.keys(window.electronAPI || {}), node: typeof require, process: typeof process,
          electronAttr: document.documentElement.dataset.electron,
          exportButtonHidden: document.getElementById('export-run')?.hidden,
          loaderHidden: (() => { const l = document.getElementById('loader'); return !l || l.hidden || getComputedStyle(l).display === 'none' || getComputedStyle(l).visibility === 'hidden' || getComputedStyle(l).opacity === '0'; })(),
          telemetry: Boolean(document.getElementById('game').dataset.telemetry) })`);
      } catch (e) { errors.push(String(e)); }
      console.log('SMOKE', JSON.stringify({ errors, renderer: JSON.parse(api) }));
      app.exit(errors.length ? 1 : 0);
    }, 12000));
  }
  win.loadURL(APP_ORIGIN);
}

app.whenReady().then(() => {
  protocol.handle('app', async (request) => {
    const { pathname } = new URL(request.url);
    const file = path.normalize(path.join(root, decodeURIComponent(pathname === '/' ? '/index.html' : pathname)));
    if (!file.startsWith(root + path.sep)) return new Response('Forbidden', { status: 403 });
    const upstream = await net.fetch(pathToFileURL(file).toString());
    const headers = new Headers(upstream.headers);
    headers.set('Content-Security-Policy', CONTENT_SECURITY_POLICY);
    if (file.endsWith('.md')) headers.set('Content-Type', 'text/plain; charset=utf-8');
    return new Response(upstream.body, { status: upstream.status, statusText: upstream.statusText, headers });
  });
  registerIpc();
  buildMenu();
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('second-instance', () => {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.focus();
});

app.on('window-all-closed', () => app.quit());
