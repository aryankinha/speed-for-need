// Electron entry: serves dist/ over a privileged app:// scheme so ES modules,
// fetch() of GLB/HDR/DRACO wasm and WebGL textures work (file:// blocks them).
import { app, BrowserWindow, protocol, net } from 'electron';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), 'dist');

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

app.whenReady().then(() => {
  protocol.handle('app', (request) => {
    const { pathname } = new URL(request.url);
    const file = path.normalize(path.join(root, decodeURIComponent(pathname === '/' ? '/index.html' : pathname)));
    if (!file.startsWith(root + path.sep)) return new Response('Forbidden', { status: 403 });
    return net.fetch(pathToFileURL(file).toString());
  });
  const win = new BrowserWindow({ width: 1280, height: 720, backgroundColor: '#172a2d', autoHideMenuBar: true });
  win.loadURL('app://game/');
});

app.on('window-all-closed', () => app.quit());
