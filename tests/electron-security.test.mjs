import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CONTENT_SECURITY_POLICY, MAX_EXPORT_BYTES, clampWindowState, exportFileName, isAllowedExternal,
  isAppUrl, isMenuCommand, sanitizeNotification, serializeRunExport,
} from '../electron-security.mjs';
import { buildRunExport, detectRecords } from '../dist/electron-bridge.js';

test('only plain https links may open externally', () => {
  assert.ok(isAllowedExternal('https://kenney.nl/assets/racing-kit'));
  for (const bad of ['http://x.com', 'file:///etc/passwd', 'javascript:alert(1)', 'app://game/', 'https://u:p@x.com', 'https://', '', null, 42, 'https://x.com/' + 'a'.repeat(3000)])
    assert.equal(isAllowedExternal(bad), false, String(bad));
});

test('app url check is strict', () => {
  assert.ok(isAppUrl('app://game/index.html'));
  assert.equal(isAppUrl('app://evil/'), false);
  assert.equal(isAppUrl('https://app://game/'), false);
  assert.equal(isAppUrl(undefined), false);
});

test('notification payload is clipped and needs a title', () => {
  assert.equal(sanitizeNotification({ body: 'x' }), null);
  assert.equal(sanitizeNotification(null), null);
  const n = sanitizeNotification({ title: 'a\nb'.repeat(100), body: 'z'.repeat(999) });
  assert.ok(n.title.length <= 80 && n.body.length === 200 && !/[\n]/.test(n.title));
});

test('run export must be a small plain object', () => {
  assert.equal(serializeRunExport([1]), null);
  assert.equal(serializeRunExport('x'), null);
  assert.equal(serializeRunExport(null), null);
  const cyc = {}; cyc.self = cyc;
  assert.equal(serializeRunExport(cyc), null);
  assert.equal(serializeRunExport({ blob: 'x'.repeat(MAX_EXPORT_BYTES) }), null);
  assert.deepEqual(JSON.parse(serializeRunExport({ a: 1 })), { a: 1 });
});

test('export file name is filesystem safe', () => {
  assert.match(exportFileName(new Date('2026-10-23T09:05:07Z')), /^speed-for-need-run-2026-10-23-09-05-07\.json$/);
});

test('menu commands are whitelisted', () => {
  assert.ok(isMenuCommand('pause'));
  assert.equal(isMenuCommand('rm -rf'), false);
});

test('window state is clamped to the screen and sane sizes', () => {
  const screen = { x: 0, y: 0, width: 1920, height: 1080 };
  assert.deepEqual(clampWindowState(null, screen), { width: 1280, height: 720 });
  assert.deepEqual(clampWindowState({ width: 10, height: 10, x: 5000, y: 5000 }, screen), { width: 1280, height: 720 });
  assert.deepEqual(clampWindowState({ width: 1000, height: 600, x: 100, y: 80, maximized: true }, screen), { width: 1000, height: 600, x: 100, y: 80, maximized: true });
});

test('CSP blocks remote code and plugins', () => {
  assert.match(CONTENT_SECURITY_POLICY, /default-src 'self'/);
  assert.match(CONTENT_SECURITY_POLICY, /object-src 'none'/);
  assert.doesNotMatch(CONTENT_SECURITY_POLICY, /https?:\/\/|\*/);
});

test('run export is built from game stats with safe defaults', () => {
  const out = buildRunExport({ map: 'coast', car: 'concept', distanceM: 12345.6, raceBest: 61.234, jumpBest: 33.33, landings: 2.9 }, new Date('2026-10-23T00:00:00Z'));
  assert.deepEqual(out, { game: 'SPEED FOR NEED', exportedAt: '2026-10-23T00:00:00.000Z', map: 'coast', car: 'concept', distanceKm: 12.35, bestSprintSeconds: 61.23, bestJumpMetres: 33.3, lastJumpMetres: 0, jumpLandings: 2 });
  assert.equal(buildRunExport(undefined).distanceKm, 0);
});

test('records notify only when beaten', () => {
  assert.deepEqual(detectRecords({ raceBest: 0, jumpBest: 0 }, { raceBest: 0, jumpBest: 0 }), []);
  assert.equal(detectRecords({ raceBest: 0, jumpBest: 0 }, { raceBest: 70, jumpBest: 0 }).length, 1);
  assert.equal(detectRecords({ raceBest: 70, jumpBest: 10 }, { raceBest: 75, jumpBest: 10 }).length, 0);
  assert.equal(detectRecords({ raceBest: 70, jumpBest: 10 }, { raceBest: 65, jumpBest: 12 }).length, 2);
});
