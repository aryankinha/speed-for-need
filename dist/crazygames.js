// CrazyGames SDK v3 wrapper (https://docs.crazygames.com/sdk/intro/).
// Every call is safe and never throws into the game: outside CrazyGames (itch, Electron, plain hosting) the SDK
// is skipped or reports environment "disabled", and all methods become no-ops. Calls made before init finishes
// are queued in order, so the game never waits on the SDK.
const SDK_URL = 'https://sdk.crazygames.com/crazygames-sdk-v3.js';
const SCRIPT_TIMEOUT_MS = 6000;

export function createCrazyGames(win = globalThis.window) {
  const doc = win?.document;
  const state = { playing: false, loading: false, adActive: false, muted: false };
  const muteListeners = new Set();
  let api = null, chain = Promise.resolve();

  const loadScript = () => new Promise((resolve, reject) => {
    if (win.CrazyGames?.SDK) return resolve();
    const script = doc.createElement('script');
    const timer = setTimeout(() => reject(new Error('sdk timeout')), SCRIPT_TIMEOUT_MS);
    script.src = SDK_URL;
    script.async = true;
    script.onload = () => { clearTimeout(timer); resolve(); };
    script.onerror = () => { clearTimeout(timer); reject(new Error('sdk blocked')); };
    doc.head.appendChild(script);
  });

  const applySettings = settings => {
    const muted = Boolean(settings?.muteAudio);
    if (muted === state.muted) return;
    state.muted = muted;
    for (const fn of muteListeners) { try { fn(muted); } catch { /* listener errors must not reach the SDK */ } }
  };

  const ready = (async () => {
    // Desktop (Electron) build and non-browser hosts never load the portal SDK.
    if (!win || !doc || win.electronAPI?.isElectron) return false;
    try {
      await loadScript();
      const sdk = win.CrazyGames?.SDK;
      if (!sdk) return false;
      await sdk.init();
      if (sdk.environment === 'disabled') return false;
      api = sdk;
      try { applySettings(sdk.game.settings); sdk.game.addSettingsChangeListener(applySettings); } catch { /* optional */ }
      return true;
    } catch { return false; }
  })();

  const run = fn => { chain = chain.then(() => ready).then(ok => { if (ok) fn(api); }).catch(() => {}); };

  return {
    ready,
    get active() { return api !== null; },
    get muted() { return state.muted; },
    onMuteChange(fn) { muteListeners.add(fn); return () => muteListeners.delete(fn); },
    loadingStart() { if (state.loading) return; state.loading = true; run(s => s.game.loadingStart()); },
    loadingStop() { if (!state.loading) return; state.loading = false; run(s => s.game.loadingStop()); },
    /** Player is actively driving. Idempotent: repeated calls send one event. */
    gameplayStart() { if (state.playing) return; state.playing = true; run(s => s.game.gameplayStart()); },
    /** Menu, pause or showroom. Do not call for window focus changes; the platform handles those. */
    gameplayStop() { if (!state.playing) return; state.playing = false; run(s => s.game.gameplayStop()); },
    /** Major achievement only (e.g. a new personal best). The site shows a celebration. */
    happytime() { run(s => s.game.happytime()); },
    /**
     * Midgame ad at a natural break. onStart should mute and pause; onEnd should restore. onEnd also runs when
     * no ad is shown (ads disabled in Basic Launch, unfilled, adblock, cooldown), so the game always continues.
     */
    midgameAd({ onStart = () => {}, onEnd = () => {} } = {}) {
      if (state.adActive) return;
      state.adActive = true;
      let ended = false;
      const finish = () => { if (ended) return; ended = true; state.adActive = false; try { onEnd(); } catch { /* keep going */ } };
      const start = () => { try { onStart(); } catch { /* keep going */ } };
      run(s => {
        try { s.ad.requestAd('midgame', { adStarted: start, adFinished: finish, adError: finish }); } catch { finish(); }
      });
      // Not usable at all (no SDK, wrong domain): release the guard so later breaks can retry harmlessly.
      ready.then(ok => { if (!ok) finish(); });
    },
  };
}

export const crazyGames = createCrazyGames();
