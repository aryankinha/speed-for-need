// Electron main process: app lifecycle and the game window. Desktop features
// live in electron-menu / electron-ipc / electron-protocol; pure, testable
// validation lives in electron-security.mjs.
import { BrowserWindow, app, dialog, powerSaveBlocker, screen, session, shell } from 'electron';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { APP_ORIGIN, clampWindowState, isAllowedExternal, isAppUrl, isMenuCommand, isPermissionAllowed } from './electron-security.mjs';
import { registerAppScheme, handleAppScheme } from './electron-protocol.mjs';
import { APP_NAME, buildMenu } from './electron-menu.mjs';
import { registerIpc } from './electron-ipc.mjs';
import { runSmoke } from './electron-smoke.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, 'dist');
const iconPath = path.join(here, 'build', 'icon.png');
const isDev = !app.isPackaged;
const smoke = process.env.ELECTRON_SMOKE === '1';
const APP_ID = 'com.speedforneed.game';
const BACKGROUND = '#0e1013';

app.setName(APP_NAME);
app.setAppUserModelId(APP_ID); // required for Windows notifications / taskbar grouping
app.setAboutPanelOptions({ applicationName: APP_NAME, applicationVersion: app.getVersion(), copyright: 'Open-source assets credited in CREDITS.md' });
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
registerAppScheme();

let win = null;
let sleepBlocker = null;
let stateTimer = null;
const statePath = () => path.join(app.getPath('userData'), 'window-state.json');

function loadWindowState() {
  let saved = null;
  try { saved = JSON.parse(readFileSync(statePath(), 'utf8')); } catch { /* first run */ }
  return clampWindowState(saved, screen.getPrimaryDisplay().workArea);
}

function saveWindowState() {
  if (!win || win.isDestroyed() || win.isFullScreen() || win.isMinimized()) return;
  const maximized = win.isMaximized();
  const bounds = maximized ? win.getNormalBounds() : win.getBounds();
  try { writeFileSync(statePath(), JSON.stringify({ ...bounds, maximized })); } catch { /* read-only profile */ }
}
const saveWindowStateSoon = () => { clearTimeout(stateTimer); stateTimer = setTimeout(saveWindowState, 400); };

function send(command) {
  if (win && !win.isDestroyed() && isMenuCommand(command)) win.webContents.send('menu-command', command);
}

function stopSleepBlocker() {
  if (sleepBlocker !== null) { powerSaveBlocker.stop(sleepBlocker); sleepBlocker = null; }
}

// Applies to every web contents (game window and any child window).
app.on('web-contents-created', (_event, contents) => {
  contents.on('will-attach-webview', (event) => event.preventDefault());
  const guard = (event, url) => {
    if (isAppUrl(url)) return;
    event.preventDefault();
    if (isAllowedExternal(url)) shell.openExternal(url);
  };
  contents.on('will-navigate', guard);
  contents.on('will-redirect', guard);
  contents.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternal(url)) { shell.openExternal(url); return { action: 'deny' }; }
    // In-app documents (CREDITS.md, RESEARCH.md) open in a plain, script-less child window.
    if (isAppUrl(url)) {
      return { action: 'allow', overrideBrowserWindowOptions: { width: 900, height: 700, autoHideMenuBar: true, parent: win ?? undefined, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, devTools: false } } };
    }
    return { action: 'deny' };
  });
});

function createWindow() {
  const state = loadWindowState();
  win = new BrowserWindow({
    width: state.width, height: state.height, x: state.x, y: state.y,
    minWidth: 800, minHeight: 500,
    title: APP_NAME, backgroundColor: BACKGROUND, show: false,
    ...(existsSync(iconPath) ? { icon: iconPath } : {}),
    webPreferences: {
      preload: path.join(here, 'preload.cjs'),
      contextIsolation: true, sandbox: true, nodeIntegration: false,
      webSecurity: true, allowRunningInsecureContent: false, experimentalFeatures: false,
      navigateOnDragDrop: false, spellcheck: false, devTools: isDev,
    },
  });
  if (state.maximized) win.maximize();
  win.once('ready-to-show', () => win.show());

  win.on('resize', saveWindowStateSoon);
  win.on('move', saveWindowStateSoon);
  win.on('close', saveWindowState);
  win.on('focus', () => { if (sleepBlocker === null) sleepBlocker = powerSaveBlocker.start('prevent-display-sleep'); });
  win.on('blur', () => { stopSleepBlocker(); send('blur'); });
  win.on('closed', () => { stopSleepBlocker(); win = null; });

  // Recover instead of leaving a dead white window.
  win.webContents.on('render-process-gone', (_e, details) => {
    if (smoke) { console.log('SMOKE render-process-gone', details.reason); app.exit(1); return; }
    if (details.reason !== 'clean-exit' && win && !win.isDestroyed()) win.webContents.reload();
  });
  win.on('unresponsive', async () => {
    if (smoke || !win) return;
    const { response } = await dialog.showMessageBox(win, { type: 'warning', buttons: ['Wait', 'Reload'], defaultId: 0, message: `${APP_NAME} is not responding.` });
    if (response === 1 && win && !win.isDestroyed()) win.webContents.reload();
  });

  if (smoke) runSmoke(win);
  win.loadURL(APP_ORIGIN);
}

if (!smoke && !app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.whenReady().then(() => {
    session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(isPermissionAllowed()));
    session.defaultSession.setPermissionCheckHandler(() => isPermissionAllowed());
    handleAppScheme(root);
    registerIpc(() => win);
    buildMenu({ getWindow: () => win, send, isDev });
    if (process.platform === 'darwin' && existsSync(iconPath)) app.dock?.setIcon(iconPath);
    createWindow();
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  });

  app.on('second-instance', () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });

  // macOS convention: stay alive without windows, quit on Cmd+Q.
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
}

process.on('uncaughtException', (error) => {
  console.error('Uncaught exception in main process:', error);
  if (!smoke && app.isReady()) dialog.showErrorBox(`${APP_NAME} hit an error`, String(error?.message ?? error));
});
