// Native application menu. Game actions are sent to the renderer over IPC so
// the menu never needs keyboard accelerators that collide with game keys.
import { Menu, app, dialog, shell } from 'electron';

export const APP_NAME = 'SPEED FOR NEED';
const CREDITS_URL = 'https://kenney.nl/assets/racing-kit';

export function buildMenu({ getWindow, send, isDev }) {
  const mac = process.platform === 'darwin';
  const about = () => dialog.showMessageBox(getWindow() ?? undefined, {
    type: 'info', title: `About ${APP_NAME}`, message: APP_NAME,
    detail: `Version ${app.getVersion()}\nElectron ${process.versions.electron} · Chromium ${process.versions.chrome} · Node ${process.versions.node}\n\nOpen-world arcade racer built with three.js and Planck.js.`,
  });
  const template = [
    ...(mac ? [{ label: APP_NAME, submenu: [
      { label: `About ${APP_NAME}`, click: about }, { type: 'separator' },
      { role: 'services' }, { type: 'separator' },
      { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' },
    ] }] : []),
    { label: 'Game', submenu: [
      { label: 'Pause / Resume', accelerator: 'CmdOrCtrl+P', click: () => send('pause') },
      { label: 'Reset to Road', accelerator: 'CmdOrCtrl+Shift+R', click: () => send('reset') },
      { type: 'separator' },
      { label: 'Export Run Data…', accelerator: 'CmdOrCtrl+E', click: () => send('export') },
      ...(mac ? [] : [{ type: 'separator' }, { role: 'quit', label: 'Quit Game' }]),
    ] },
    { role: 'editMenu' },
    { label: 'View', submenu: [
      { role: 'togglefullscreen', accelerator: 'F11' },
      { type: 'separator' },
      { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' },
      ...(isDev ? [{ type: 'separator' }, { role: 'reload' }, { role: 'toggleDevTools' }] : []),
    ] },
    { role: 'windowMenu' },
    { role: 'help', submenu: [
      { label: 'Asset Credits (Kenney)', click: () => shell.openExternal(CREDITS_URL) },
      ...(mac ? [] : [{ type: 'separator' }, { label: `About ${APP_NAME}`, click: about }]),
    ] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
