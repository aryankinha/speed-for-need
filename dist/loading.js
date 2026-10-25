// Loading-screen presentation only. game.js keeps owning #loadbar, #loadtext, #retry and #loader;
// this file observes those elements and never changes game state.
(() => {
  const loader = document.getElementById('loader');
  const bar = document.getElementById('loadbar');
  const track = bar?.parentElement;
  const loadtext = document.getElementById('loadtext');
  const status = document.getElementById('ld-status');
  const pct = document.getElementById('ld-pct');
  const tipEl = document.getElementById('ld-tip');
  const retry = document.getElementById('retry');
  if (!loader || !bar) return;

  const reduced = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  const clamp = (v) => Math.max(0, Math.min(100, v));

  // Tips: each rotation swaps the text and replays the .is-swap keyframe fade (no timers gate visibility).
  const TIPS = [
    'Hold SHIFT for nitro boost · Refill with roadside pick-ups',
    'Hold SPACE into sharp corners to initiate high-speed drift',
    'Pacific Coast Highway: High-speed sweepers with elevation drops',
    'Launch off stunt ramps at 180+ KM/H for maximum aerial hangtime',
    'Visit the Garage to tune colors, wheels, and customize your fleet',
    'Press C to cycle between Chase, Wide, and Cockpit cameras',
    'Press P or ESC at any time to open the Pause Menu for graphics & controls',
  ];
  if (tipEl) {
    let index = Math.floor(Math.random() * TIPS.length);
    tipEl.textContent = TIPS[index];
    if (!reduced) {
      const tipTimer = setInterval(() => {
        if (loader.hidden) { clearInterval(tipTimer); return; }
        if (loader.style.opacity === '0') return;
        index = (index + 1) % TIPS.length;
        tipEl.textContent = TIPS[index];
        tipEl.classList.remove('is-swap');
        void tipEl.offsetWidth; // restart the CSS animation
        tipEl.classList.add('is-swap');
      }, 3800);
    }
  }

  // One number everywhere: the big percent is taken from game.js's own #loadtext percent
  // (or the bar width when the text has none), set directly with no easing.
  const syncProgress = () => {
    const text = loadtext?.textContent ?? '';
    const match = text.match(/(\d{1,3})\s*%/);
    const width = parseFloat(bar.style.width);
    const widthValue = Number.isFinite(width) ? clamp(width) : 0;
    const value = match ? clamp(Number(match[1])) : widthValue;
    if (pct) pct.textContent = `${Math.round(value)}%`;
    track?.setAttribute('aria-valuenow', String(Math.round(value)));
    track?.style.setProperty('--p', `${widthValue}%`);
    if (status) {
      const clean = text.replace(/\s*[·•|\-–]?\s*\d{1,3}\s*%\s*$/, '').trim() || text;
      status.innerHTML = `<i class="ld-status-pip" aria-hidden="true"></i>${clean}`;
    }
  };
  new MutationObserver(syncProgress).observe(bar, {attributes: true, attributeFilter: ['style']});
  if (loadtext) new MutationObserver(syncProgress).observe(loadtext, {childList: true, characterData: true, subtree: true});
  syncProgress();

  // Minimum display time: on cached loads game.js can hide the loader within a few hundred ms.
  // Until HOLD_MS has passed, the fade-out and hide that game.js sets are deferred, then applied as they would have been.
  const HOLD_MS = 1400;
  const holdUntil = performance.now() + HOLD_MS;
  let finishTimer = 0;
  const finishLater = () => {
    if (finishTimer) return;
    finishTimer = setTimeout(() => {
      finishTimer = 0;
      loader.style.opacity = '0';
      setTimeout(() => { loader.hidden = true; }, 550);
    }, Math.max(0, holdUntil - performance.now()));
  };
  new MutationObserver(() => {
    if (performance.now() >= holdUntil) return;
    if (loader.hidden) loader.hidden = false;
    if (loader.style.opacity === '0') loader.style.opacity = '';
    finishLater();
  }).observe(loader, {attributes: true, attributeFilter: ['style', 'hidden']});

  // game.js fades the loader with style.opacity = 0; mirror that as a class for the exit zoom.
  new MutationObserver(() => loader.classList.toggle('is-done', loader.style.opacity === '0'))
    .observe(loader, {attributes: true, attributeFilter: ['style']});

  // game.js un-hides #retry when an asset fails; mirror that as an error state.
  if (retry) {
    new MutationObserver(() => loader.classList.toggle('is-error', !retry.hidden))
      .observe(retry, {attributes: true, attributeFilter: ['hidden']});
    loader.classList.toggle('is-error', !retry.hidden);
  }
})();

// Watchdog: if the game module graph fails before game.js can show its own error, offer a retry.
setTimeout(() => {
  const loader = document.querySelector('#loader'), bar = document.querySelector('#loadbar');
  if (!loader || loader.hidden || loader.style.opacity === '0') return;
  if (bar && parseFloat(bar.style.width) > 0) return;
  const retry = document.querySelector('#retry'), text = document.querySelector('#loadtext');
  if (retry) retry.hidden = false;
  if (text) text.textContent = 'Could not start. Reload to retry.';
  loader.classList.add('is-error');
}, 25000);
