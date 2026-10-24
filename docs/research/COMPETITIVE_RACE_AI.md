# Competitive race AI and Drift containment — 2026-10-24

## Verified findings

The supplied research correctly identifies the original 0.40 grip multiplier, fixed 10 m/s² braking assumption (`20*d`), 0.96 top-speed cap, throttle taper and restrictive nitro curvature check. Its commercial-game implementation claims and critic score are not treated as verification.

Two corrections to the proposal: a boost pad does not instantly set velocity to 69 m/s; the solver applies bounded boost acceleration toward each car's own boost cap. Disabling all braking while boosting is unsafe before corners. The correction separates the desired engine speed from the braking envelope: exceeding the ordinary top-speed cap alone does not command brakes, but approaching a corner or blocked lane still does.

A browser test also reproduced stationary-player queues. Intended lane position was used in place of actual obstacle geometry, and the passing target did not follow a car displaced by contact. The updated controller uses actual positions, keeps an active passing side until clear, re-evaluates both sides when needed and allows physical reverse recovery after a blocked attempt.

## Implementation

- Speed-scaled pure pursuit steering; invert the same speed-dependent bicycle steering formula used by `physics.js`.
- Corner planning uses 80% of the actual surface-adjusted grip, with braking preview from 80% of the configured braking acceleration and a reaction margin. These are tested game-tuning margins, not manufacturer performance claims.
- Full acceleration until close to the safe target; nitro on suitable exits and passing opportunities, with start/continue hysteresis and the existing tank rules. Pad detection precedes the AI decision.
- Passing uses precomputed independent left/right clearance intervals, clipped against actual road and wall edges for the largest garage car plus clearance. No new arrays, vectors or callbacks are allocated by the controller's fixed-step methods.
- Follow a slower car when no safe passing space exists. Both player and opponents receive the imported track's asphalt/gravel grip and drag.
- Retain real dynamic Planck bodies, original garage tuning, lap validation, drafting, collision resolution and control-only recovery. No teleports, extra engine power or hidden catch-up speed bonuses.

## Track escape root cause and correction

The old map collision rectangle used approximate scene bounds (-237..270, -235..273), while the actual terrain is x=-224.832..235.285, z=-206.471..253.646. Cars could leave the visible ground before meeting that rectangle; authored access gaps also remained open.

The offline extractor now derives a closed outer facility contour from the asphalt's exterior plus a 2 m shoulder, clipped 0.4 m inside the actual terrain footprint. This preserves the infield and pit/access tail. A continuous physical chain and visible W-profile metal safety rail share that exact contour, including the end of the access tail. All authored track geometry, PBR maps, original barriers and scale remain intact. The addition is one rail mesh and one instanced support mesh, with no external assets or runtime tracing dependencies.

## Validation

`npm run check`: 454 passing tests. Additional checks cover full laps with measured car dimensions, preserved tuning, nitro use, brake/boost interactions, occupied lanes, parked players for every garage selection, recovery without teleporting, and boosted-car containment around every reachable perimeter edge. The original source/optimized track geometry and PBR preservation checks still pass. The generator reproduces the existing route and original collision contours unchanged.

The comparison data is in `RACE_AI_VALIDATION.json`. Across 20 opponent finishes for each controller, mean three-lap time changed from 183.00 s to 145.00 s (20.8% shorter). This is a deterministic simulation benchmark, not a guarantee of outcomes against human drivers. All five selection scenarios finished. Rail contacts decreased, but physical racing contacts and occasional recovery remain possible.

Live browser racing verified all four opponents passing a stopped player, updated leaderboard/laps and no console warnings/errors. Local Electron startup and security checks pass. No screenshots, deployment or GitHub push.

## Primary references

- [Coulter, Implementation of the Pure Pursuit Path Tracking Algorithm, CMU, 1992](https://www.ri.cmu.edu/publication_view.html?pub_id=278): geometric lookahead steering.
- [Nav2 Regulated Pure Pursuit](https://github.com/ros-navigation/navigation2/blob/main/nav2_regulated_pure_pursuit_controller/README.md): speed-scaled lookahead, curvature regulation and collision-aware planning. This is an algorithm reference; no ROS dependency was added.
- [Planck chain shapes](https://piqnt.dev/planck.js/docs/shape/chain.html): connected edges, ghost vertices and two-sided contacts in this engine. Modern Box2D's one-sided-chain behavior should not be assumed for the installed Planck version.
- Existing `physics.js`, garage definitions and original GLB geometry supply this game's physical limits and dimensions.
