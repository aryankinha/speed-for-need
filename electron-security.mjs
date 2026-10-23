// Pure helpers for the Electron main process. Kept free of `electron` imports
// so they can be unit-tested with node --test.
import path from 'node:path';

export const APP_ORIGIN = 'app://game/';
export const MAX_EXPORT_BYTES = 64 * 1024;
export const MENU_COMMANDS = Object.freeze(['pause', 'reset', 'export', 'blur']);

// Game runs from app://game/ only. wasm-unsafe-eval is needed by Draco; blob:
// workers are used by three.js loaders. Nothing is loaded from the network.
export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self' data: blob:",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
].join('; ');

export function isAppUrl(url) {
  return typeof url === 'string' && url.startsWith(APP_ORIGIN);
}

// Only plain https links may leave the app, and never with credentials.
export function isAllowedExternal(url) {
  if (typeof url !== 'string' || url.length > 2048) return false;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && Boolean(u.hostname) && !u.username && !u.password;
  } catch {
    return false;
  }
}

export function sanitizeNotification(input) {
  const clip = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max) : '');
  const title = clip(input?.title, 80);
  if (!title) return null;
  return { title, body: clip(input?.body, 200) };
}

// Returns pretty JSON text, or null when the payload is not a small plain object.
export function serializeRunExport(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  let text;
  try { text = JSON.stringify(data, null, 2); } catch { return null; }
  if (typeof text !== 'string' || Buffer.byteLength(text) > MAX_EXPORT_BYTES) return null;
  return text;
}

export function exportFileName(date = new Date()) {
  const stamp = date.toISOString().slice(0, 19).replace(/[:T]/g, '-');
  return `speed-for-need-run-${stamp}.json`;
}

export function isMenuCommand(command) {
  return MENU_COMMANDS.includes(command);
}

export function clampWindowState(state, bounds) {
  const fallback = { width: 1280, height: 720 };
  const w = Number(state?.width), h = Number(state?.height);
  const out = { width: Number.isFinite(w) && w >= 800 ? Math.round(w) : fallback.width, height: Number.isFinite(h) && h >= 500 ? Math.round(h) : fallback.height };
  const x = Number(state?.x), y = Number(state?.y);
  if (Number.isFinite(x) && Number.isFinite(y) && bounds &&
      x >= bounds.x - 50 && y >= bounds.y - 50 &&
      x + out.width <= bounds.x + bounds.width + 50 && y + out.height <= bounds.y + bounds.height + 50) {
    out.x = Math.round(x); out.y = Math.round(y);
  }
  if (state?.maximized === true) out.maximized = true;
  return out;
}

// Maps an app:// pathname to a file inside `root`, or null when it escapes the
// root, contains NUL bytes, is malformed, or is not a plain relative path.
export function resolveAppFile(root, pathname) {
  let decoded;
  try { decoded = decodeURIComponent(pathname === '/' || pathname === '' ? '/index.html' : pathname); } catch { return null; }
  if (decoded.includes('\0') || decoded.includes('\\')) return null;
  const file = path.resolve(root, '.' + decoded);
  return file.startsWith(path.resolve(root) + path.sep) ? file : null;
}

// Nothing in the game needs camera, mic, geolocation, notifications via the web
// API (the main process raises native ones) or any other web permission.
export function isPermissionAllowed() {
  return false;
}

export function isReadMethod(method) {
  return method === 'GET' || method === 'HEAD';
}
