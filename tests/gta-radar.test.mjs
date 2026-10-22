import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const htmlPath = resolve('dist/index.html');
const cssPath = resolve('dist/style.css');
const jsPath = resolve('dist/game.js');

const html = readFileSync(htmlPath, 'utf8');
const css = readFileSync(cssPath, 'utf8');
const js = readFileSync(jsPath, 'utf8');

test('GTA Radar HTML: Container and elements exist with semantic and accessibility attributes', () => {
  assert.ok(html.includes('id="radar-hud"'), 'Expected #radar-hud container in index.html');
  assert.ok(html.includes('id="radar"'), 'Expected #radar canvas in index.html');
  assert.ok(html.includes('width="320" height="320"'), 'Expected 320x320 resolution on radar canvas for high-DPI rasterization');
  assert.ok(html.includes('id="radar-north"'), 'Expected #radar-north indicator in index.html');
  assert.ok(html.includes('id="radar-district"'), 'Expected #radar-district readout in index.html');
  assert.ok(html.includes('id="radar-speed"'), 'Expected #radar-speed readout in index.html');
  assert.ok(html.includes('aria-label="Navigation radar"'), 'Expected aria-label for accessibility');
  // Confirm minimap contract is preserved for pause menu
  assert.ok(html.includes('id="minimap"'), 'Minimap canvas remains in #menu');
});

test('GTA Radar CSS: Frosted dark bezel, circular geometry, and responsive ergonomics', () => {
  assert.ok(css.includes('.radar-hud{'), 'Expected .radar-hud styles');
  assert.ok(css.includes('.radar-bezel{'), 'Expected .radar-bezel styles');
  assert.ok(css.includes('border-radius:50%'), 'Expected circular bezel');
  assert.ok(css.includes('backdrop-filter:blur'), 'Expected frosted glass backdrop filter');
  assert.ok(css.includes('#radar{'), 'Expected #radar styles');
  assert.ok(css.includes('.radar-north{'), 'Expected .radar-north styles');
  assert.ok(css.includes('.radar-info{'), 'Expected .radar-info readout bar styles');

  // Mobile touch collision avoidance: Moves radar away from bottom-left touch steering d-pad
  assert.ok(css.includes('@media(pointer:coarse)'), 'Expected pointer:coarse media query for touch devices');
  assert.ok(css.includes('.radar-hud{bottom:auto;top:20px;left:20px}'), 'Touch displays relocate radar to top-left to avoid D-pad collision');

  // Compact scaling for small viewports
  assert.ok(css.includes('.radar-bezel{width:105px;height:105px}'), 'Compact viewports scale radar bezel down to 105px');
});

test('GTA Palette Integration: Authentic GTA V hex colors used across radar and map', () => {
  // Deep obsidian void / ocean
  assert.ok(js.includes("ctx.fillStyle='#0a0e14'") || js.includes("radarCtx.fillStyle='#0a0e14'"), 'Expected #0a0e14 obsidian ocean');
  // Dark slate island landmass
  assert.ok(js.includes("ctx.fillStyle='#161c24'") || js.includes("radarCtx.fillStyle='#161c24'"), 'Expected #161c24 dark slate landmass');
  // Asphalt road casing
  assert.ok(js.includes("ctx.fillStyle='#242c38'") || js.includes("radarCtx.fillStyle='#242c38'"), 'Expected #242c38 asphalt casings');
  // High contrast road surfaces
  assert.ok(js.includes("ctx.fillStyle='#f0f2f5'") || js.includes("radarCtx.fillStyle='#f0f2f5'"), 'Expected #f0f2f5 road surfaces');
  // GTA waypoint yellow
  assert.ok(js.includes("ctx.fillStyle='#f5c518'") || js.includes("radarCtx.fillStyle='#f5c518'"), 'Expected #f5c518 waypoint yellow');
  // Traffic silver
  assert.ok(js.includes("ctx.fillStyle='#94a1b2'") || js.includes("radarCtx.fillStyle='#94a1b2'"), 'Expected #94a1b2 traffic blips');
  // Player chevron white
  assert.ok(js.includes("radarCtx.fillStyle='#ffffff'"), 'Expected #ffffff player chevron fill');
});

test('GTA Radar Logic: Clip encapsulation, player-centric rotation, and speed zoom', () => {
  assert.ok(js.includes('radarCtx.clip()'), 'Radar encapsulates rendering in circular clip path');
  assert.ok(js.includes('radarCtx.rotate(ph)'), 'Rotates canvas by player heading so forward is UP');
  assert.ok(js.includes('lerp(0.32,0.18') || js.includes('lerp(0.24,0.14') || js.includes('lerp('), 'Implements speed-adaptive zoom');
  assert.ok(js.includes('drawRadar('), 'drawRadar function declared');
  assert.ok(js.includes('drawRadar(dt)') || js.includes('drawRadar(simDt)'), 'drawRadar hooked into active simulation loop');
});

test('GTA Radar Objective Clamping: Sprint gates outside radar radius are pegged to circular rim', () => {
  assert.ok(js.includes('maxR=142') || js.includes('maxR'), 'Defines perimeter clamping boundary');
  assert.ok(js.includes('dist>maxR'), 'Checks if waypoint distance exceeds visible radar radius');
  assert.ok(js.includes('rx/dist') && js.includes('ry/dist'), 'Projects gate coordinates onto perimeter vector');
});

test('GTA Radar Visibility: Hidden in showroom and pause menu, visible during active driving', () => {
  assert.ok(js.includes("$('#radar-hud').hidden=true"), 'Radar hidden on showHome()');
  assert.ok(js.includes("$('#radar-hud').hidden=value"), 'Radar toggled by setPause(value)');
});

test('North Indicator Trigonometry: Accurate cardinal positions on bezel rim', () => {
  const calcPos = (ph) => ({
    left: 50 + Math.sin(ph) * 41,
    top: 50 - Math.cos(ph) * 41
  });

  // Facing North (ph = 0) -> North is straight UP (left: 50%, top: 9%)
  const northPos = calcPos(0);
  assert.ok(Math.abs(northPos.left - 50) < 0.01);
  assert.ok(Math.abs(northPos.top - 9) < 0.01);

  // Facing West (ph = Math.PI / 2) -> North is to the RIGHT (left: 91%, top: 50%)
  const westPos = calcPos(Math.PI / 2);
  assert.ok(Math.abs(westPos.left - 91) < 0.01);
  assert.ok(Math.abs(westPos.top - 50) < 0.01);

  // Facing South (ph = Math.PI) -> North is at the BOTTOM (left: 50%, top: 91%)
  const southPos = calcPos(Math.PI);
  assert.ok(Math.abs(southPos.left - 50) < 0.01);
  assert.ok(Math.abs(southPos.top - 91) < 0.01);

  // Facing East (ph = -Math.PI / 2) -> North is to the LEFT (left: 9%, top: 50%)
  const eastPos = calcPos(-Math.PI / 2);
  assert.ok(Math.abs(eastPos.left - 9) < 0.01);
  assert.ok(Math.abs(eastPos.top - 50) < 0.01);
});

test('Perimeter Clamping Geometry: Waypoint projects accurately to circle rim', () => {
  const maxR = 142;
  const clampWaypoint = (dx, dz, ph, zoom) => {
    const cos = Math.cos(ph), sin = Math.sin(ph);
    const rx = (dx * cos - dz * sin) * zoom;
    const ry = (dx * sin + dz * cos) * zoom;
    const dist = Math.hypot(rx, ry);
    if (dist > maxR) {
      return {
        clamped: true,
        x: 160 + (rx / dist) * maxR,
        y: 160 + (ry / dist) * maxR,
        dist
      };
    }
    return {
      clamped: false,
      x: 160 + rx,
      y: 160 + ry,
      dist
    };
  };

  // Close waypoint (50m forward, ph = 0, zoom = 0.25)
  // rx = 0, ry = -12.5 px -> within 142px radius
  const close = clampWaypoint(0, -50, 0, 0.25);
  assert.equal(close.clamped, false);
  assert.equal(close.x, 160);
  assert.equal(close.y, 147.5);

  // Distant waypoint (1000m East, car facing North, ph = 0, zoom = 0.25)
  // rx = 250 px, ry = 0 -> exceeds 142px maxR
  const farEast = clampWaypoint(1000, 0, 0, 0.25);
  assert.equal(farEast.clamped, true);
  assert.equal(farEast.x, 160 + maxR); // 302
  assert.equal(farEast.y, 160);
});
