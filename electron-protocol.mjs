// app:// scheme: serves dist/ read-only, adds the CSP header, blocks traversal.
import { net, protocol } from 'electron';
import { pathToFileURL } from 'node:url';
import { CONTENT_SECURITY_POLICY, isReadMethod, resolveAppFile } from './electron-security.mjs';

// Must run before app.whenReady().
export function registerAppScheme() {
  protocol.registerSchemesAsPrivileged([
    { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
  ]);
}

export function handleAppScheme(root) {
  protocol.handle('app', async (request) => {
    if (!isReadMethod(request.method)) return new Response('Method Not Allowed', { status: 405 });
    const file = resolveAppFile(root, new URL(request.url).pathname);
    if (!file) return new Response('Forbidden', { status: 403 });
    let upstream;
    try {
      upstream = await net.fetch(pathToFileURL(file).toString());
    } catch {
      return new Response('Not Found', { status: 404 });
    }
    const headers = new Headers(upstream.headers);
    headers.set('Content-Security-Policy', CONTENT_SECURITY_POLICY);
    headers.set('X-Content-Type-Options', 'nosniff');
    if (file.endsWith('.md')) headers.set('Content-Type', 'text/plain; charset=utf-8');
    return new Response(upstream.body, { status: upstream.status, statusText: upstream.statusText, headers });
  });
}
