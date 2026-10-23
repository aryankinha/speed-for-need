// Sandboxed preload (must be CommonJS). Exposes a minimal, fixed API; the
// renderer never receives ipcRenderer or any Node object.
const { contextBridge, ipcRenderer } = require('electron');

const MENU_COMMANDS = ['pause', 'reset', 'export', 'blur'];

contextBridge.exposeInMainWorld('electronAPI', Object.freeze({
  isElectron: true,
  platform: process.platform,
  versions: Object.freeze({ electron: process.versions.electron, chrome: process.versions.chrome }),
  notify: (payload) => ipcRenderer.invoke('app:notify', payload),
  saveRun: (data) => ipcRenderer.invoke('app:save-run', data),
  openExternal: (url) => ipcRenderer.invoke('app:open-external', url),
  toggleFullscreen: () => ipcRenderer.invoke('app:toggle-fullscreen'),
  quit: () => ipcRenderer.invoke('app:quit'),
  onMenuCommand: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const handler = (_event, command) => { if (MENU_COMMANDS.includes(command)) callback(command); };
    ipcRenderer.on('menu-command', handler);
    return () => ipcRenderer.removeListener('menu-command', handler);
  },
}));
