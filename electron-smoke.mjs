// `npm run electron:smoke`: loads the real window, checks the renderer is
// sandboxed, CSP is active, the game booted, then exits 0 (ok) or 1 (failed).
import { app } from 'electron';

const CHECKS = `(async () => JSON.stringify({
  api: Object.keys(window.electronAPI || {}),
  noNode: typeof require === 'undefined' && typeof process === 'undefined' && typeof module === 'undefined',
  noRawIpc: typeof ipcRenderer === 'undefined' && !('ipcRenderer' in (window.electronAPI || {})),
  evalBlockedByCsp: (() => { try { new Function('return 1')(); return false; } catch { return true; } })(),
  electronFlag: document.documentElement.dataset.electron === '1',
  desktopButtons: ['export-run', 'quit-game'].every((id) => document.getElementById(id) && !document.getElementById(id).hidden),
  loaderHidden: (() => { const l = document.getElementById('loader'); return !l || l.hidden || getComputedStyle(l).display === 'none' || getComputedStyle(l).visibility === 'hidden' || getComputedStyle(l).opacity === '0'; })(),
  gameBooted: Boolean(document.getElementById('game').dataset.telemetry),
  menuCommandsOk: typeof window.electronAPI.onMenuCommand === 'function',
  ipcRejectsBadUrl: (await window.electronAPI.openExternal('file:///etc/passwd')) === false,
  ipcRejectsBadExport: (await window.electronAPI.saveRun([1, 2])).error === 'invalid-data',
  ipcRejectsEmptyNotice: (await window.electronAPI.notify({})) === false,
}))()`;

export function runSmoke(win) {
  const errors = [];
  win.webContents.on('console-message', (event) => { if (event.level === 'error') errors.push(event.message); });
  win.webContents.on('did-fail-load', (_e, code, desc) => errors.push(`did-fail-load ${code} ${desc}`));
  win.webContents.once('did-finish-load', () => setTimeout(async () => {
    let result = {};
    try { result = JSON.parse(await win.webContents.executeJavaScript(CHECKS)); } catch (e) { errors.push(String(e)); }
    const failed = Object.entries(result).filter(([k, v]) => k !== 'api' && v !== true).map(([k]) => k);
    const needed = ['notify', 'saveRun', 'openExternal', 'toggleFullscreen', 'quit', 'onMenuCommand'];
    for (const name of needed) if (!result.api?.includes(name)) failed.push(`api.${name}`);
    console.log('SMOKE', JSON.stringify({ errors, failed, result }));
    app.exit(errors.length || failed.length ? 1 : 0);
  }, 12000));
}
