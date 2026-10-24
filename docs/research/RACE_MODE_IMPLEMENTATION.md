# Solana Raceway — implementation and verification

The supplied research and the existing vehicle, Planck physics, traffic, nitro, boost-pad, audio, interpolation and game lifecycle code were inspected before changes. This mode is separate from free roam. No external track download or new dependency is required.

## Verified corrections to the draft

- The supplied 25-point closed centripetal spline is **1,463.04 metres**, not the real Laguna Seca's reported 3.6 km. It is a flat, fictional Corkscrew tribute. The coordinates contain no elevation data; no real-world elevation accuracy is claimed.
- This engine faces `(-sin(heading), -cos(heading))`; the lateral right vector is `(cos(heading), -sin(heading))`. The draft starting-grid lateral formula did not match that convention.
- The draft stuck timer reset on every normal tick, preventing a stationary-car threshold from ever accumulating. Recovery now accumulates a real stall interval, reverses using the regular controls, then retries forward.
- `grip` in the shipped solver is already an acceleration limit, not a dimensionless tyre coefficient. The planner reserves a conservative fraction for cornering/avoidance; it does not multiply the configured grip by gravity or change the cars' actual tuning.
- Overlap is not the same as Box2D's ghost-vertex chain mechanism. Barrier boxes have the requested 0.15 m longitudinal overlap and continuous bullet car bodies. Actual three-lap tests exercise those colliders; overlap is not represented as a mathematical guarantee against every possible snag.

Primary references: [Three.js closed centripetal curves](https://threejs.org/docs/pages/CatmullRomCurve3.html), [Planck world/contact callbacks](https://piqnt.com/planck.js/docs/api/classes/World.html), [Box2D ghost collisions](https://box2d.org/posts/2020/06/ghost-collisions/). Contact callbacks only record pooled data; bodies are created/destroyed outside the solver callbacks as Planck requires. Unverified Sketchfab model claims and download/licensing estimates from the research were not used.

## Modules and behaviour

- `race-track.js`: exact supplied control points, arc-length lookup tables, allocation-free sample/projection, textured ribbon and red/white kerbs, overlapping static wall boxes, 12 gates and checkered start/finish. Repeated walls, gate parts, finish squares and pads use instancing.
- `race-mode.js`: deterministic remaining-four garage pool, unchanged garage physics tuning and measured car dimensions, staggered grid, three-second locked countdown, three laps, ordered checkpoints, real crossing-time splits, stable progress/finish ordering, nitro/pads, slipstream, passing lanes, braking preview and reverse/forward recovery.
- AI calls `setControls` on real dynamic Planck bodies. It never calls `setTarget`, sets a transform, overrides mass/grip/top speed or applies its own body forces/torques while racing. Initial grid placement and explicit restart/return are lifecycle operations.
- The player and AI share `nextBoost`, its 100-capacity/14-drain/4-regeneration rules, and `BoostPadTimer`. All five share circuit pickups. The existing `NitroEffects` renders the circuit bottles and player/AI exhaust; its original free-roam field is restored on exit.
- Slipstream changes only the aerodynamic component of resistance to 0.65, leaving rolling resistance, engine tune and speed limits intact. Wake tests use actual positions/headings. Catch-up changes throttle demand within ±8%; beyond a 250 m gap it returns to neutral. No progress teleports or speed-cap manipulation.
- All gates must be passed forward and in order, within the road corridor. The leaderboard uses continuous validated lap distance and keeps finished drivers ordered by actual finish time. Split labels use actual shared gate crossing times rather than distance divided by an invented speed.
- Finishers drive a restrained cooldown to clear the finish line. The field can finish before final results; after 45 seconds following the player's finish, remaining drivers are marked DNF. Fuel/oil systems, multiplayer and elevation simulation are intentionally absent.
- `race-hud.js` / `race.css`: separate RACE home entry, countdown lamps, five-car dock, lap/current/best timing, checkpoint number, drafting state, results/fastest lap, restart and free-roam return. Racing radar and pause map draw the actual circuit. UI refresh is outside the 120 Hz simulation at 10 Hz.
- `sparks.js`: typed particle buffers, additive contact-point sparks, gravity/fading, no per-particle objects. Pooled post-solve records supply real manifold positions. Existing impact audio/ducking and camera rumble run outside the contact listener, including nearby AI impacts. Cockpit impact translation is restrained to 35% of chase-camera shake to keep the road readable.

## Lifecycle and performance scope

The circuit is isolated from playable maps. Existing moving world bodies are suspended and city visuals hidden, with their exact activation/visibility state saved; distant static bodies stay in the broadphase to avoid expensive remove/reinsert spikes; race exit destroys every circuit wall/opponent, releases interpolation slots, restores the player/free-roam activation and nitro field/tank, and removes/disposes owned visual resources. Car geometry/materials are borrowed and never disposed by the race.

New fixed-step race functions and collision recording reuse control records, sampling scratch storage, typed split/rank/particle arrays and a preallocated impact pool. Physics callbacks are stable functions. There are no new application object/array allocations or callback creation in the race's 120 Hz step. This is not a claim that the third-party solver or WebAudio/DOM allocates no memory internally. Lifecycle construction, UI strings and results rendering can allocate outside that loop.

The source research's universal 60–120 FPS and ≤65 draw-call estimates are targets, not verified guarantees for five existing detailed garage models. Browser rendering is measured separately; car detail is preserved.

## Tests

The original 452 tests remain unchanged and green. Added tests cover all five pool choices/tuning/grid normal, countdown, real-wall three-lap completion with AI teleport/kinematic calls forbidden, braking/nitro/pads/drafting, spin recovery, skipped gates, unwrapped ranking/finish ordering, lifecycle activation/slot restoration and pooled sparks/contact points. The full check currently passes 462 tests. These simulations found and fixed finish-line blocking by stopped finishers.

## Final local validation (24 October 2026)

- `npm run check`: syntax checks plus all 462 tests pass (452 existing + 10 race tests). Lifecycle coverage also checks exact restoration of visible/hidden city nodes across repeated starts.
- `npm test`: all 462 pass.
- `npm run electron:smoke`: passes; real Electron game boot, no renderer errors, sandbox/CSP and IPC validation checks pass. This is a startup/security smoke test, not a full desktop race playthrough.
- Brave, actual local game: the RACE button opens the five-car grid, countdown releases, player acceleration/nitro and shared split gaps work, opponents complete three laps, R reconstructs the starting grid, pause/resume works, EXIT RACE restores the original free-roam location/tank and hides the showroom. No browser console errors were reported. No screenshots were taken.
- Rendering sample: 180-frame window, frame median 33.3 ms / p95 34 ms, CPU median 5.2 ms / p95 6.7 ms, GPU sample about 10.0 ms, 330 draw calls with detailed cars visible. Another view measured 376 calls / 12.8 ms GPU. These observations do **not** establish 60 FPS. Instanced circuit scenery and hidden city traversal reduce unnecessary work, but the existing detailed car materials remain; device/browser display scheduling and different views need separate profiling before a stronger FPS claim.
- No GitHub push or public deployment was performed.
