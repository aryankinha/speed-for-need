# 60 Second Rush — research, implementation and verification

24 October 2026. Changes are local; the CrazyGames build awaiting review is unchanged.

## Why this change

The existing game already has sprint gates, drift zones, jumps, pickups, traffic and police. More scenery or another isolated minigame would not solve its main first-session problem: most rewards are discovered accidentally, and sprint progress is hidden in the pause menu. There is little immediate feedback about what makes a good drive.

Three approaches were considered:

1. More world assets: rejected for this pass; increases loading/rendering cost without establishing a goal.
2. An economy and unlock tree: rejected; adds save/migration/UI work and locks existing cars behind grind.
3. A short optional skill run: implemented. One click starts a countdown, 60 seconds of scoring, then a result with replay/free-drive choices. No accounts, additional assets or dependencies.

The ordinary Drive button still starts unrestricted cruising. The new HUD only appears during Rush.

## Research applied

- [CrazyGames quality guidelines](https://docs.crazygames.com/requirements/quality/): recommends quick, skippable onboarding, reachable goals, clear controls and responsive feedback. Rush shows its medal target immediately and teaches banking in the play view instead of a tutorial page.
- [CrazyGames gameplay requirements](https://docs.crazygames.com/requirements/gameplay/): requires readable responsive layouts and consistent physics across refresh rates. Rush uses simulated seconds and existing driving controls; scores are tested at 30/60/120 Hz.
- [Three.js optimization manual](https://threejs.org/manual/pages/optimize-lots-of-objects.html): explains scene-object/draw overhead. This update adds no new 3D objects; existing spatial batching remains in place.
- [Three.js renderer information](https://threejs.org/docs/pages/WebGLRenderer.html#info): statistics must span all render passes to measure a composed frame. The previous telemetry counted just the last fullscreen triangle. The new wrapper resets once per complete frame and restores the renderer setting even if a pass throws.
- [MDN bounding volumes](https://developer.mozilla.org/en-US/docs/Games/Techniques/3D_collision_detection): simple distance/envelope tests suit frequent proximity queries. Rush checks traffic's physical widths and the sign change across its centre plane, with a cooldown and no collision/airborne awards.
- [Point-to-segment projection](https://paulbourke.net/geometry/pointlineplane/): the primary search result describes dot-product projection onto a line segment. The full page blocked crawler access, so this was not treated as an inspected implementation. The traffic optimization implements the standard projection directly and tests it against a dense numerical oracle, including arcs and the loop seam.

All scoring rates, medal cutoffs, countdown and durations are original game-balance choices, not claimed real-world vehicle or published engagement data. Increased retention or subjective enjoyment has not been measured with users.

## Gameplay

- Clean speed, drifts anywhere, near misses and clean landings contribute to a pending chain.
- Four seconds of continuous scoring raises the multiplier, up to ×5.
- Press B or tap Bank to secure a chain now; waiting 2.5 seconds without a scoring skill also banks it. Banking resets the multiplier. Impacts lose the pending chain, while banked points remain.
- A valid near miss requires passing the centre plane of a traffic car at speed with a small positive side clearance; touching, convoy driving, repeated overlapping, teleporting and airborne passes do not qualify.
- Clean landings award airtime once, after touchdown. A crash on landing cancels it.
- Three medals and per-car, per-map personal bests create a repeatable goal. City Street Study has lower speed/medal thresholds for its much smaller loop.
- Pause/backgrounding freezes the run. Reset, map travel, stunt travel, home or switching to a sprint abandons the run without saving a false record. Result controls support keyboard and touch.

## Measured optimizations and root causes

### Traffic route lookup

`roundedRoute.nearest()` previously performed 17 coarse route samples plus 30 ternary-search samples for each car on every AI tick. Routes are already known line segments and quarter circles. Exact line/arc projection replaces repeated search while retaining an 18 m local window, including wrap-around, so a collision cannot snap a car to an unrelated road.

Repeated 100,000-query microbenchmarks on this Mac:

- Original warmed runs: approximately 118–136 ms.
- Updated warmed runs: approximately 42–44 ms.
- About 64% less CPU time for this operation. This is **not** a claim of 64% higher whole-game FPS.

Both clockwise and counterclockwise 60-second traffic simulations remain within 0.26 m of the route, with safe following gaps. Additional dense-oracle tests check exact local projection across straights, bends and the seam.

### Adaptive resolution

The old quality controller allowed resolution increases at frame intervals below 40 ms: even a sustained 30 FPS could be classified as spare capacity. It now requires intervals below 18.5 ms before increasing quality, except when measured work is below 8 ms (preserving sharpness on a cheap, power-saving 30 Hz presentation cadence). Sustained missed frames with appreciable measured work reduce resolution; a cheap browser/power-saving 30 Hz cadence alone does not degrade visuals. Preset floors, assets, shadows and physics frequency are preserved.

### Driving-loop allocations

Rear wheel selection formerly created filtered/sliced arrays each driving frame. Those nodes are now cached once when each sourced vehicle is prepared. Rush reuses its input object and preallocates traffic pass state at run start. Its DOM counters update around 10 Hz, not at physics frequency.

## Verification and limits

- Pure tests exercise countdown, final banking, pause/no-time advancement, crash loss, reverse/spin rejection, drift thresholds, airtime/landing, near-miss rejection cases, teleport abandonment, retries, medals, corrupt/unavailable storage and car/map isolation.
- Traffic tests include 60-second dynamic simulations and dense nearest-point oracles.
- Browser playtests verified countdown, timer, scoring, manual banking (B), run results, new personal-best display and replay. A replay reached 854 banked points before the final inspection was interrupted.
- Phone-size iframe tests at 390×844 and 844×390 verified home/controls, result cards and touch-control layout. They exposed an overlap between Rush and Pause, corrected by reserving the top-right corner. Bank has an 88×44 px touch target. The selected-car label was moved above the portrait title to avoid overlap.
- Existing Electron smoke check passed: game boot, menu/IPC/security checks, no reported errors or failed requests. Approximate startup 17.5 seconds on this machine; this was a desktop smoke test, not the CrazyGames 10-second web-loading certification.
- During driving, timing varied with scene and browser/foreground conditions. Do not claim a universal 60 FPS. The final browser pass was cut short when macOS locked; no real-phone hardware test or finished-run medal on every map is claimed.
- `npm run check` passed all **433 tests** on the final code, including syntax checks for the two new modules. `git diff --check` also passed. No new screenshots, source push, live deployment, CrazyGames update, assets or external dependencies were required for this pass.
