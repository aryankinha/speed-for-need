// Desktop layer for the Electron build. In a normal browser window.electronAPI
// does not exist, so every export here is a no-op and the game is unchanged.
const api = typeof window !== 'undefined' ? window.electronAPI : undefined;
export const isElectron = Boolean(api && api.isElectron);

export function buildRunExport(stats, now = new Date()) {
  const n = (v, digits = 2) => (Number.isFinite(v) ? +v.toFixed(digits) : 0);
  return {
    game: 'SPEED FOR NEED',
    exportedAt: now.toISOString(),
    map: String(stats?.map ?? ''),
    car: String(stats?.car ?? ''),
    distanceKm: n((stats?.distanceM ?? 0) / 1000),
    bestSprintSeconds: n(stats?.raceBest),
    bestJumpMetres: n(stats?.jumpBest, 1),
    lastJumpMetres: n(stats?.jumpLast, 1),
    jumpLandings: Math.max(0, Math.trunc(stats?.landings ?? 0)),
  };
}

// Compares two stat snapshots and returns the notifications to show.
export function detectRecords(previous, next) {
  const out = [];
  const race = next?.raceBest ?? 0, prevRace = previous?.raceBest ?? 0;
  if (race > 0 && (prevRace <= 0 || race < prevRace)) {
    out.push({ title: 'New best sprint!', body: `${race.toFixed(2)} s` });
  }
  const jump = next?.jumpBest ?? 0, prevJump = previous?.jumpBest ?? 0;
  if (jump > prevJump && jump > 0) {
    out.push({ title: 'New longest jump!', body: `${jump.toFixed(1)} m` });
  }
  return out;
}

// `game` = { getStats(), getState() -> {ready, paused, home}, setPause(v), reset() }
export function initElectron(game, doc = document) {
  if (!isElectron) return false;
  doc.documentElement.dataset.electron = '1';
  doc.querySelectorAll('[data-desktop-only]').forEach((el) => { el.hidden = false; });

  const exportRun = async () => {
    const button = doc.getElementById('export-run');
    const label = button?.querySelector('.btn-text');
    // A rejected IPC call (dialog closed with the window, handler error) reports "Save failed" instead of an unhandled rejection.
    const result = await api.saveRun(buildRunExport(game.getStats())).catch(() => ({ ok: false }));
    if (label) {
      const idle = label.dataset.idle || (label.dataset.idle = label.textContent);
      label.textContent = result?.ok ? 'Saved ✓' : result?.canceled ? idle : 'Save failed';
      setTimeout(() => { label.textContent = idle; }, 2000);
    }
  };
  doc.getElementById('export-run')?.addEventListener('click', exportRun);
  doc.getElementById('quit-game')?.addEventListener('click', () => api.quit());

  api.onMenuCommand((command) => {
    const state = game.getState();
    if (!state.ready || state.home) return;
    if (command === 'pause') game.setPause(!state.paused);
    else if (command === 'blur') { if (!state.paused) game.setPause(true); }
    else if (command === 'reset') game.reset();
    else if (command === 'export') exportRun();
  });

  // Native notification when a record is beaten (stats polled; no game hooks).
  let known = game.getStats();
  setInterval(() => {
    const now = game.getStats();
    for (const note of detectRecords(known, now)) api.notify(note);
    known = now;
  }, 1000);
  return true;
}
