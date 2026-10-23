import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const distDir = join(__dirname, '../dist');

test('loading screen HTML contains all required elements, IDs, and themed telemetry', () => {
  const html = readFileSync(join(distDir, 'index.html'), 'utf-8');

  // Verify critical contracts required by game.js and loading.js
  assert.ok(html.includes('id="loader"'), 'Must have #loader');
  assert.ok(html.includes('id="loadbar"'), 'Must have #loadbar');
  assert.ok(html.includes('id="loadtext"'), 'Must have #loadtext');
  assert.ok(html.includes('id="retry"'), 'Must have #retry');
  assert.ok(html.includes('id="ld-status"'), 'Must have #ld-status');
  assert.ok(html.includes('id="ld-pct"'), 'Must have #ld-pct');
  assert.ok(html.includes('id="ld-tip"'), 'Must have #ld-tip');

  // Verify game theme in-engine HUD elements
  assert.ok(html.includes('class="ld-reticles"'), 'Must have tactical viewport reticles');
  assert.ok(html.includes('class="ld-district-kicker"'), 'Must have district kicker');
  assert.ok(html.includes('PACIFIC COAST HIGHWAY'), 'Must feature Pacific Coast Highway');
  assert.ok(html.includes('DRIVER INTEL'), 'Must display themed driver intel kicker');
  assert.ok(html.includes('class="ld-status-pip"'), 'Must have animated status pip');

  // Verify requested removals (top bar and featured vehicle card)
  assert.ok(!html.includes('class="ld-top"'), 'Top bar must be removed from loading screen');
  assert.ok(!html.includes('class="ld-telemetry-meta"'), 'Top bar telemetry meta must be removed');
  assert.ok(!html.includes('class="ld-vehicle-card"'), 'Featured vehicle card must be removed');
  assert.ok(!html.includes('FEATURED VEHICLE'), 'Featured vehicle text must be removed');
  assert.ok(!html.includes('TESLA ROADSTER 2.0'), 'Featured vehicle model must be removed');
  assert.ok(!html.includes('QUAD-MOTOR AWD'), 'Featured vehicle specs must be removed');

  // Verify accessibility contracts
  assert.ok(html.includes('role="progressbar"'), 'Must provide role="progressbar"');
  assert.ok(html.includes('aria-valuemin="0"'), 'Must provide aria-valuemin');
  assert.ok(html.includes('aria-valuemax="100"'), 'Must provide aria-valuemax');
});

test('loading screen CSS defines tactical HUD components and responsive breakpoints', () => {
  const css = readFileSync(join(distDir, 'loading.css'), 'utf-8');

  assert.ok(css.includes('.ld-reticles'), 'Must style .ld-reticles');
  assert.ok(css.includes('.ld-district-kicker'), 'Must style .ld-district-kicker');
  assert.ok(css.includes('.ld-vehicle-card'), 'Must style .ld-vehicle-card');
  assert.ok(css.includes('.ld-live-pulse'), 'Must define ldLivePulse keyframe');
  assert.ok(css.includes('.ld-status-pip'), 'Must style .ld-status-pip');
  assert.ok(css.includes('@media (max-width:640px) and (orientation:portrait)'), 'Must have mobile portrait breakpoint');
  assert.ok(css.includes('@media (prefers-reduced-motion:reduce)'), 'Must support prefers-reduced-motion');
});

test('theme.css applies the golden-hour atmospheric grade and theme palette', () => {
  const theme = readFileSync(join(distDir, 'theme.css'), 'utf-8');

  assert.ok(theme.includes('#loader .ld-vehicle-card'), 'Must style .ld-vehicle-card with theme colors');
  assert.ok(theme.includes('#loader .ld-district-kicker'), 'Must style .ld-district-kicker with theme colors');
  assert.ok(theme.includes('var(--amber)'), 'Must use --amber accent token');
  // Confirm gray desaturation wash was eliminated
  assert.ok(!theme.includes('background:#7d7d7d;mix-blend-mode:saturation;opacity:.72'), 'Must not have dulling gray saturation wash');
});

test('loading screen image assets exist in high-resolution and mobile formats', () => {
  const desktopImg = join(distDir, 'assets/loading-art.jpg');
  const mobileImg = join(distDir, 'assets/loading-art-mobile.jpg');

  assert.ok(existsSync(desktopImg), 'Desktop loading art must exist');
  assert.ok(existsSync(mobileImg), 'Mobile loading art must exist');
});
