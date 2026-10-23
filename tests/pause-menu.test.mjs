import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(__dirname, '../dist');

const htmlPath = path.join(distDir, 'index.html');
const cssPath = path.join(distDir, 'style.css');
const jsPath = path.join(distDir, 'game.js');

const html = fs.readFileSync(htmlPath, 'utf8');
const css = fs.readFileSync(cssPath, 'utf8');
const js = fs.readFileSync(jsPath, 'utf8');

test('pause menu HTML contains all required elements and IDs', () => {
  const requiredIds = [
    'menu',
    'resume',
    'camera',
    'sound',
    'touch-toggle',
    'reset',
    'race',
    'race-status',
    'controls',
    'showroom',
    'minimap',
    'district',
    'menu-status',
    'quick-resume',
  ];

  for (const id of requiredIds) {
    assert.ok(
      html.includes(`id="${id}"`),
      `Expected element with id="${id}" to exist in index.html`
    );
  }

  const removedIds = ['vehicle', 'car-description', 'session-distance', 'session-speed'];
  for (const id of removedIds) {
    assert.ok(
      !html.includes(`id="${id}"`),
      `Expected element with id="${id}" to NOT exist in pause DOM`
    );
  }
});

test('minimap canvas maintains correct dimensions for drawMap scale', () => {
  assert.ok(html.includes('<canvas id="minimap" width="450" height="260"'));
});

test('style.css implements cinematic frosted glass and floating hud', () => {
  assert.ok(css.includes('.overlay{position:fixed;inset:0;background:radial-gradient'));
  assert.ok(css.includes('backdrop-filter:blur(4px)'));
  assert.ok(css.includes('.pause-hud{'));
  assert.ok(css.includes('.pause-card{'));
  assert.ok(css.includes('.pause-map-dock{'));
  assert.ok(css.includes('.pause-telemetry-dock{'));
  assert.ok(css.includes('.pause-primary-btn{'));
});

test('all game.js querySelectors for pause menu resolve in index.html', () => {
  // Find all $('#...') selectors in game.js
  const matches = js.matchAll(/\$\('#([^']+)'\)/g);
  const matchedIds = new Set(Array.from(matches, m => m[1]));

  for (const id of matchedIds) {
    assert.ok(
      html.includes(`id="${id}"`),
      `Selector $('#${id}') in game.js must match an element in index.html`
    );
  }
});

test('HTML structure: semantic tags, accessibility, and kbd elements', () => {
  // Semantic tags inside the pause menu
  assert.ok(html.includes('<header class="pause-topbar">'), 'Expected <header>');
  assert.ok(html.includes('<section class="pause-card">'), 'Expected <section>');
  assert.ok(html.includes('<details id="controls" class="pause-accordion">'), 'Expected <details>');
  assert.ok(html.includes('<summary>Driving controls'), 'Expected <summary>');
  assert.ok(html.includes('<dl class="controls-list">'), 'Expected <dl>');
  assert.ok(html.includes('<dt>Drive / brake & reverse</dt>'), 'Expected <dt>');
  assert.ok(html.includes('<dd><kbd>W</kbd>'), 'Expected <dd>');
  assert.ok(html.includes('<aside class="pause-map-dock" aria-label="District map">'), 'Expected map <aside>');
  assert.ok(!html.includes('pause-telemetry-dock'), 'Expected telemetry dock to be removed from pause DOM');
  assert.ok(!html.includes('85% clear view'), 'Expected 85% clear view text to be removed');
  assert.ok(!html.includes('A LITTLE FURTHER. A LITTLE FREER.'), 'Expected A little further text to be removed from initial HTML');

  // Form labels with for attribute matching select id
  assert.ok(!html.includes('for="vehicle"'), 'Vehicle picking removed from pause menu');
  assert.ok(!html.includes('id="vehicle"'), 'Vehicle select removed from pause menu');
  assert.ok(html.includes('<label for="camera" class="pause-pill-label">'), 'Label for camera');
  assert.ok(html.includes('<select id="camera"'), 'Select id camera');

  // Accessibility attributes
  assert.ok(html.includes('aria-label="Pause menu"'), 'aria-label on pause-hud');
  assert.ok(html.includes('aria-label="Resume game"'), 'aria-label on quick-resume');
  assert.ok(html.includes('aria-label="Map of expanded Solana Coast"'), 'aria-label on minimap');
  assert.ok(html.includes('aria-pressed="false"'), 'aria-pressed on toggles');
  assert.ok(html.includes('aria-hidden="true"'), 'aria-hidden on brand logo SVG');

  // kbd tags for shortcuts
  const expectedKbds = ['ESC', 'C', 'R', '↵', 'W', 'S', 'Space', 'Shift', 'Esc', 'Enter'];
  for (const key of expectedKbds) {
    assert.ok(html.includes(`<kbd>${key}</kbd>`), `Expected <kbd>${key}</kbd>`);
  }

  // Tag balancing check (no unclosed tags)
  const voidElements = new Set([
    'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
    'link', 'meta', 'param', 'source', 'track', 'wbr',
    'path', 'circle', 'rect', 'line', 'polyline', 'polygon'
  ]);
  const tagRegex = /<\/?([a-zA-Z0-9]+)(?:\s+[^>]*?)?(\/?)>/g;
  const stack = [];
  let m;
  while ((m = tagRegex.exec(html)) !== null) {
    const full = m[0];
    const tag = m[1].toLowerCase();
    if (tag === '!doctype') continue;
    const isClosing = full.startsWith('</');
    const isSelfClosing = m[2] === '/' || voidElements.has(tag);
    if (isClosing) {
      assert.ok(stack.length > 0, `Unexpected closing tag </${tag}>`);
      const top = stack.pop();
      assert.equal(tag, top.tag, `Mismatched tag: expected </${top.tag}>, found </${tag}>`);
    } else if (!isSelfClosing) {
      stack.push({ tag, index: m.index });
    }
  }
  assert.equal(stack.length, 0, `Unclosed tags remaining: ${stack.map(s => s.tag).join(', ')}`);
});

test('CSS styling: frosted glass, translucency, lime accents, and responsive breakpoints', () => {
  // Required selectors exist
  const selectors = [
    '.overlay',
    '.pause-hud',
    '.pause-card',
    '.pause-primary-btn',
    '.pause-grid',
    '.pause-map-dock',
    '.pause-telemetry-dock'
  ];
  for (const sel of selectors) {
    assert.ok(css.includes(sel), `Expected selector ${sel} in style.css`);
  }

  // Frosted glass and translucency
  assert.ok(css.includes('.overlay{position:fixed;inset:0;background:radial-gradient(circle at center,rgba(14,30,33,0.4) 0%,rgba(10,20,22,0.78) 100%);backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px)'));
  assert.ok(css.includes('.pause-card{pointer-events:auto;width:min(440px,94vw);background:rgba(18,38,36,0.85);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px)'));
  assert.ok(css.includes('.pause-map-card{background:rgba(18,38,36,0.8);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px)'));
  assert.ok(css.includes('.telemetry-pill{background:rgba(18,38,36,0.8);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px)'));

  // Lime accents
  assert.ok(css.includes('--lime:#def79e'), 'CSS defines --lime accent variable');
  assert.ok(css.includes('.pause-primary-btn{width:100%;background:var(--lime)'), 'Primary button uses --lime');
  assert.ok(css.includes('.pause-badge{font-size:8px;letter-spacing:1.8px;color:var(--lime)'), 'Badge uses --lime');
  assert.ok(css.includes('.telemetry-label{') && css.includes('color:var(--lime)'), 'Telemetry label uses --lime');
  assert.ok(css.includes('.toggle[aria-pressed=true]{background:#def79e20;color:var(--lime)'), 'Active toggle uses --lime');

  // Responsive breakpoints
  assert.ok(css.includes('@media(max-width:960px)'), 'Breakpoint for <=960px');
  assert.ok(css.includes('@media(max-width:540px)'), 'Breakpoint for <=540px');
  assert.ok(css.includes('@media(max-height:720px) and (min-width:961px)'), 'Breakpoint for compact height');
  assert.ok(css.includes('@media(pointer:coarse)'), 'Breakpoint for touch pointers');
  assert.ok(css.includes('@media(prefers-reduced-motion:reduce)'), 'Breakpoint for reduced motion');
});

test('Edge cases: district calculations for spatial regions', () => {
  // Extract district function implementation logic from game.js
  const districtFn = (s) => (
    s.x < -370 ? 'Ocean Drive'
      : s.x > 225 ? 'Skyline District'
      : s.z < -300 ? 'North Quarter'
      : s.z > 300 ? 'Palm Quarter'
      : 'Downtown'
  );

  // Spawn position (-445.7, 110) should be Ocean Drive
  assert.equal(districtFn({ x: -445.7, z: 110 }), 'Ocean Drive');
  assert.equal(districtFn({ x: -400, z: 0 }), 'Ocean Drive');
  assert.equal(districtFn({ x: -371, z: -500 }), 'Ocean Drive');

  // Far East (x > 225)
  assert.equal(districtFn({ x: 230, z: 0 }), 'Skyline District');
  assert.equal(districtFn({ x: 450, z: 200 }), 'Skyline District');

  // North (z < -300 and -370 <= x <= 225)
  assert.equal(districtFn({ x: 0, z: -350 }), 'North Quarter');
  assert.equal(districtFn({ x: -100, z: -600 }), 'North Quarter');

  // South (z > 300 and -370 <= x <= 225)
  assert.equal(districtFn({ x: 0, z: 350 }), 'Palm Quarter');
  assert.equal(districtFn({ x: 150, z: 600 }), 'Palm Quarter');

  // Central core
  assert.equal(districtFn({ x: 0, z: 0 }), 'Downtown');
  assert.equal(districtFn({ x: -200, z: 100 }), 'Downtown');
});

test('Edge cases: telemetry speed and distance formatting', () => {
  const formatSpeed = (speedMs) => `${Math.round(speedMs * 3.6)} <small>KM/H</small>`;
  const formatDistance = (distM) => `${(distM / 1000).toFixed(2)} <small>KM</small>`;

  // 0 speed
  assert.equal(formatSpeed(0), '0 <small>KM/H</small>');
  // Low speed (5 m/s = 18 km/h)
  assert.equal(formatSpeed(5), '18 <small>KM/H</small>');
  // Highway cruise (35 m/s = 126 km/h)
  assert.equal(formatSpeed(35), '126 <small>KM/H</small>');
  // Top speed with boost (65 m/s = 234 km/h)
  assert.equal(formatSpeed(65), '234 <small>KM/H</small>');

  // 0 distance
  assert.equal(formatDistance(0), '0.00 <small>KM</small>');
  // Fraction of a km
  assert.equal(formatDistance(456.7), '0.46 <small>KM</small>');
  // Extended session
  assert.equal(formatDistance(12345.6), '12.35 <small>KM</small>');
});

test('Edge cases: coastal sprint status and time formatting', () => {
  const formatTime = (t) => `${Math.floor(t / 60).toString().padStart(2, '0')}:${(t % 60).toFixed(2).padStart(5, '0')}`;

  // Time format check
  assert.equal(formatTime(0), '00:00.00');
  assert.equal(formatTime(75.4), '01:15.40');
  assert.equal(formatTime(125.03), '02:05.03');

  // Status transitions
  const totalGates = 6;
  const getMenuStatus = (raceActive, cp) => (
    raceActive
      ? `COASTAL SPRINT · CHECKPOINT ${cp + 1} / ${totalGates}`
      : ''
  );
  const getRaceBtnText = (raceActive) => (
    raceActive ? 'Cancel sprint ↗' : 'Start coastal sprint ↗'
  );

  // Inactive
  assert.equal(getMenuStatus(false, 0), '');
  assert.equal(getRaceBtnText(false), 'Start coastal sprint ↗');

  // Active checkpoints 0 through 5
  assert.equal(getMenuStatus(true, 0), 'COASTAL SPRINT · CHECKPOINT 1 / 6');
  assert.equal(getMenuStatus(true, 5), 'COASTAL SPRINT · CHECKPOINT 6 / 6');
  assert.equal(getRaceBtnText(true), 'Cancel sprint ↗');
});

test('Edge cases: sound and touch toggle state consistency', () => {
  // Sound toggle simulator matching game.js lines 113-114
  let soundOn = false;
  const toggleSound = () => {
    soundOn = !soundOn;
    return {
      text: soundOn ? 'On' : 'Off',
      ariaPressed: String(soundOn)
    };
  };

  const s1 = toggleSound();
  assert.equal(s1.text, 'On');
  assert.equal(s1.ariaPressed, 'true');

  const s2 = toggleSound();
  assert.equal(s2.text, 'Off');
  assert.equal(s2.ariaPressed, 'false');

  // Touch toggle simulator matching game.js lines 110-112
  let touchEnabled = false;
  const toggleTouch = () => {
    touchEnabled = !touchEnabled;
    return {
      text: touchEnabled ? 'On' : 'Off',
      ariaPressed: String(touchEnabled),
      hudHidden: (isPaused) => isPaused || !touchEnabled
    };
  };

  const t1 = toggleTouch();
  assert.equal(t1.text, 'On');
  assert.equal(t1.ariaPressed, 'true');
  // When driving (unpaused), touch hud is visible
  assert.equal(t1.hudHidden(false), false);
  // When paused, touch hud is hidden
  assert.equal(t1.hudHidden(true), true);

  const t2 = toggleTouch();
  assert.equal(t2.text, 'Off');
  assert.equal(t2.ariaPressed, 'false');
  // When off, touch hud is hidden even while driving
  assert.equal(t2.hudHidden(false), true);
});

test('Polish verification: paused hotkeys R, C, Enter enabled in game.js', () => {
  // Check keydown event handler for hotkeys while paused
  assert.ok(
    js.includes("key==='c'&&(!paused||!inShowroom)"),
    'Camera toggle (C) must be enabled while paused outside showroom'
  );
  assert.ok(
    js.includes("key==='r'&&(!paused||!inShowroom)"),
    'Reset to road (R) must be enabled while paused outside showroom'
  );
  assert.ok(
    js.includes("key==='enter'&&(!paused||!inShowroom)"),
    'Start sprint / Enter must be enabled while paused outside showroom'
  );
  assert.ok(
    js.includes("if(paused&&raceActive)setPause(false)"),
    'Enter while paused should immediately launch sprint and unpause'
  );
  assert.ok(
    js.includes("if(paused&&!inShowroom){updateCamera(0.1);graphics.render(0);}"),
    'Camera and reset actions while paused should re-render scene immediately for visual feedback'
  );
});

test('Polish verification: microcopy font sizes and letter-spacing in style.css', () => {
  // Check microcopy font sizes >= 8.5px / 9px
  assert.ok(css.includes('.clean-note{font-size:8.5px;color:var(--dim);letter-spacing:.4px'), 'clean-note 8.5px');
  assert.ok(css.includes('.telemetry-label{font-size:8.5px;letter-spacing:1.5px'), 'telemetry-label 8.5px');
  assert.ok(css.includes('.pause-subtitle{font-size:9px;letter-spacing:1.5px'), 'pause-subtitle 9px');
  assert.ok(css.includes('.pause-race-info{font-size:9px;color:var(--dim);letter-spacing:.5px'), 'pause-race-info 9px');
  assert.ok(css.includes('.controls-list{margin:8px 0 2px;display:grid;grid-template-columns:1fr auto;gap:6px;font-size:9px}'), 'controls-list 9px');
  assert.ok(css.includes('.showroom-return{border:0;background:none;color:var(--lime);font-size:9px'), 'showroom-return 9px');
  assert.ok(css.includes('.toggle{background:transparent;border:1px solid #d4e7c52c;border-radius:20px;min-width:47px;padding:4px 9px;color:var(--dim);font-size:9px'), 'toggle 9px');
  assert.ok(css.includes('.subtle{font-size:9px'), 'subtle 9px');
});

test('Polish verification: custom frosted scrollbar on .overlay in style.css', () => {
  assert.ok(
    css.includes('.overlay{position:fixed;inset:0;background:radial-gradient(circle at center,rgba(14,30,33,0.4) 0%,rgba(10,20,22,0.78) 100%);backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);z-index:10;overflow-y:auto;overflow-x:hidden;scrollbar-width:thin;scrollbar-color:rgba(222,247,158,0.25) transparent}'),
    'Standard CSS frosted scrollbar on .overlay'
  );
  assert.ok(
    css.includes('.overlay::-webkit-scrollbar{width:6px}'),
    'Webkit scrollbar width on .overlay'
  );
  assert.ok(
    css.includes('.overlay::-webkit-scrollbar-thumb{background:rgba(222,247,158,0.25);border-radius:3px}'),
    'Webkit scrollbar thumb frosted lime styling'
  );
});

test('Polish verification: compact landscape media query @media(max-height:520px) in style.css', () => {
  assert.ok(
    css.includes('@media(max-height:520px){'),
    '@media(max-height:520px) breakpoint exists'
  );
  assert.ok(
    css.includes('.pause-hud{padding:12px 18px}'),
    'Compact padding for landscape phones'
  );
  assert.ok(
    css.includes('.pause-card{padding:14px 18px;gap:8px}'),
    'Compact card padding and gap'
  );
  assert.ok(
    css.includes('.pause-map-dock{display:none}'),
    'Minimap hidden in landscape mode to prevent vertical crowding'
  );
  assert.ok(
    css.includes('.pause-telemetry-dock{bottom:12px;right:18px}'),
    'Telemetry dock repositioned in compact landscape'
  );
});

test('Three-button layout: Pause card contains exactly 3 primary action buttons', () => {
  const cardMatch = html.match(/<section class="pause-card">([\s\S]*?)<\/section>/);
  assert.ok(cardMatch, 'Expected .pause-card section in HTML');
  const cardHtml = cardMatch[1];

  assert.ok(cardHtml.includes('id="resume"'), 'Expected #resume in pause-card');
  assert.ok(cardHtml.includes('id="pause-settings-btn"'), 'Expected #pause-settings-btn in pause-card');
  assert.ok(cardHtml.includes('id="showroom"'), 'Expected #showroom in pause-card');

  assert.ok(!cardHtml.includes('id="vehicle"'), '#vehicle should not be in main card');
  assert.ok(!cardHtml.includes('85% clear view'), '85% clear view should not be in main card');
  assert.ok(!cardHtml.includes('A LITTLE FURTHER. A LITTLE FREER.'), 'A little further text should not be in main card');
  assert.ok(!cardHtml.includes('id="camera"'), '#camera should be in settings drawer, not main card');
  assert.ok(!cardHtml.includes('id="sound"'), '#sound should be in settings drawer, not main card');
  assert.ok(!cardHtml.includes('id="controls"'), '#controls should be in settings drawer, not main card');
});

test('Setting drawer: #pause-drawer houses all configuration widgets cleanly', () => {
  const drawerMatch = html.match(/<section id="pause-drawer"[\s\S]*?>([\s\S]*?)<\/section>/);
  assert.ok(drawerMatch, 'Expected #pause-drawer in HTML');
  const drawerHtml = drawerMatch[1];

  assert.ok(html.includes('id="pause-drawer" class="pause-drawer home-drawer" hidden'), '#pause-drawer starts hidden');
  assert.ok(drawerHtml.includes('id="close-pause-drawer"'), 'Expected close button in drawer');
  assert.ok(drawerHtml.includes('id="back-pause-drawer"'), 'Expected back button in drawer');
  assert.ok(!drawerHtml.includes('id="vehicle"'), '#vehicle must not be in drawer (car picking only in garage)');
  assert.ok(!drawerHtml.includes('id="car-description"'), '#car-description must not be in drawer');
  assert.ok(drawerHtml.includes('id="camera"'), 'Expected #camera in drawer');
  assert.ok(drawerHtml.includes('id="sound"'), 'Expected #sound in drawer');
  assert.ok(drawerHtml.includes('id="touch-toggle"'), 'Expected #touch-toggle in drawer');
  assert.ok(drawerHtml.includes('id="reset"'), 'Expected #reset in drawer');
  assert.ok(drawerHtml.includes('id="race"'), 'Expected #race in drawer');
  assert.ok(drawerHtml.includes('id="controls"'), 'Expected #controls in drawer');
});

test('Tabbed Drawer (Option 2): tab navigation, zero-scroll panels, and distinct visual affordances', () => {
  const themeCss = fs.readFileSync(path.join(distDir, 'theme.css'), 'utf8');

  // Verify tab navigation buttons
  assert.ok(html.includes('class="pause-tab-bar"'), 'Expected .pause-tab-bar tablist');
  assert.ok(html.includes('data-tab="settings"'), 'Expected settings tab button');
  assert.ok(html.includes('data-tab="travel"'), 'Expected travel tab button');
  assert.ok(html.includes('data-tab="controls"'), 'Expected controls tab button');

  // Verify tab panels
  assert.ok(html.includes('id="tab-settings"'), 'Expected #tab-settings panel');
  assert.ok(html.includes('id="tab-travel"'), 'Expected #tab-travel panel');
  assert.ok(html.includes('id="tab-controls"'), 'Expected #tab-controls panel');

  // Verify visual distinction & categorization
  assert.ok(html.includes('class="pause-section-title"'), 'Expected section title category dividers');
  assert.ok(html.includes('class="pause-travel-block"'), 'Expected dedicated travel input card block');
  assert.ok(html.includes('pause-action-primary'), 'Expected distinct primary action button style');
  assert.ok(html.includes('pause-race-btn'), 'Expected distinct sprint button style');
  assert.ok(html.includes('class="pause-info-box"'), 'Expected callout info box for activity status');

  // Verify scroll containment and fixed sticky header/footer
  assert.ok(themeCss.includes('overscroll-behavior:contain'), 'Must contain scroll chaining in theme.css');
  assert.ok(css.includes('overscroll-behavior:contain'), 'Must contain scroll chaining in style.css');
  assert.ok(themeCss.includes('.pause-tab-body{'), 'Must define inner scroll container');

  // Verify tab switching in game.js
  assert.ok(js.includes('document.querySelectorAll(\'.pause-tab-btn\')'), 'Tab switching wired in game.js');
});

test('Responsive Settings UI: text visibility, centered fitted dropdowns, and contrast safety', () => {
  const themeCss = fs.readFileSync(path.join(distDir, 'theme.css'), 'utf8');

  // Pill field & select: centered, fitted, high contrast
  assert.ok(themeCss.includes('.pause-pill-field{flex-direction:row;justify-content:space-between;min-height:44px;'), 'Pill field has min-height and space-between layout');
  assert.ok(themeCss.includes('.pause-select{appearance:none;'), 'Select has custom appearance reset');
  assert.ok(themeCss.includes('max-width:65%'), 'Select is bounded to prevent label overflow');
  assert.ok(themeCss.includes('text-align:right'), 'Select options are right-aligned');
  assert.ok(themeCss.includes('.pause-pill-field:hover .pause-select,.pause-pill-field:focus-within .pause-select{color:var(--ink)}'), 'Select maintains readable ink color on hover/focus');

  // Stunt park and travel pill fields match structure
  assert.ok(html.includes('for="map-destination"'), 'Destination label exists');
  assert.ok(html.includes('for="stunt-lane"'), 'Stunt lane label exists');
  assert.ok(html.includes('<span class="pause-pill-label"><span>DESTINATION</span></span>'), 'Destination has semantic label span');
  assert.ok(html.includes('<span class="pause-pill-label"><span>STUNT LANE</span></span>'), 'Stunt lane has semantic label span');

  // Drawer responsive dimensions
  assert.ok(themeCss.includes('width:380px;max-width:calc(100vw - 32px)'), 'Drawer width is responsive with viewport padding');
  assert.ok(themeCss.includes('@media (max-width:760px){'), 'Mobile breakpoint exists in theme.css');
  assert.ok(themeCss.includes('@media (max-height:600px){'), 'Compact height breakpoint exists in theme.css');
});

test('Responsive Settings UI: vertical toggle column and accordion focus safety', () => {
  const themeCss = fs.readFileSync(path.join(distDir, 'theme.css'), 'utf8');

  // Toggle rows are full-width vertical stack (never overflowing with 3 items)
  assert.ok(themeCss.includes('.pause-toggle-row{display:flex;flex-direction:column;gap:6px;width:100%'), 'Toggle row is full-width vertical flex column');
  assert.ok(themeCss.includes('.pause-toggle-item{position:relative;display:flex;align-items:center;justify-content:space-between;min-height:44px;'), 'Toggle item has min-height and space-between layout');
  assert.ok(themeCss.includes('.toggle{background:transparent;border:1px solid rgba(14,16,19,.4);border-radius:2px;color:var(--ink)'), 'Toggle button has clean ink styling');

  // Accordion outline & link spacing
  assert.ok(themeCss.includes('.pause-accordion summary:focus-visible{outline:2px solid var(--amber);outline-offset:-2px}'), 'Accordion summary uses inset outline to prevent clipping');
  assert.ok(themeCss.includes('.accordion-links{display:flex;align-items:center;gap:8px;padding-top:6px}'), 'Accordion links have dedicated flex container and padding');
  assert.ok(html.includes('class="accordion-links"'), 'HTML contains accordion-links container');
  assert.ok(!html.includes('<p class="subtle">Downloaded models and sounds, verified credits, and collision research are included. <p class="touch-help">'), 'Nested p tags eliminated');
});
