// IPC handlers. Every call is rejected unless it comes from the main frame of
// the game window loaded from app://game/. Payloads are validated in main.
import { Notification, app, dialog, ipcMain, shell } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { exportFileName, isAllowedExternal, isAppUrl, sanitizeNotification, serializeRunExport } from './electron-security.mjs';

export function registerIpc(getWindow) {
  const handle = (channel, fn) => ipcMain.handle(channel, (event, ...args) => {
    const win = getWindow();
    const frame = event.senderFrame;
    if (!win || event.sender !== win.webContents || !frame || frame !== win.webContents.mainFrame || !isAppUrl(frame.url)) {
      throw new Error(`Blocked IPC ${channel} from untrusted sender`);
    }
    return fn(win, ...args);
  });

  handle('app:notify', (win, payload) => {
    const clean = sanitizeNotification(payload);
    if (!clean || !Notification.isSupported()) return false;
    const note = new Notification({ ...clean, silent: true });
    note.on('click', () => { if (!win.isDestroyed()) { if (win.isMinimized()) win.restore(); win.focus(); } });
    note.show();
    return true;
  });

  handle('app:save-run', async (win, data) => {
    const text = serializeRunExport(data);
    if (text === null) return { ok: false, error: 'invalid-data' };
    const result = await dialog.showSaveDialog(win, {
      title: 'Export run data',
      defaultPath: path.join(app.getPath('documents'), exportFileName()),
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (result.canceled || !result.filePath) return { ok: false, canceled: true };
    try {
      await fs.writeFile(result.filePath, text, 'utf8');
    } catch (error) {
      return { ok: false, error: String(error?.code ?? 'write-failed') };
    }
    return { ok: true, path: result.filePath };
  });

  handle('app:open-external', async (_win, url) => {
    if (!isAllowedExternal(url)) return false;
    await shell.openExternal(url);
    return true;
  });
  handle('app:toggle-fullscreen', (win) => { win.setFullScreen(!win.isFullScreen()); return win.isFullScreen(); });
  handle('app:quit', () => { app.quit(); });
}
