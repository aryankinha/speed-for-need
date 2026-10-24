# Aerial stunts and graphics review — 23 October 2026

## Scope and root causes
The user chose airborne 360 spins and barrel rolls. Three existing sourced Kenney ramps now provide a long jump, 360 yaw spin and barrel roll. A qualified forward launch above 14 m/s starts one full turn. Flight duration comes from the ballistic quadratic, then smoothstep schedules a turn during the first 80% of flight. Unwrapped angles prevent interpolation unwinding at landing; early forced landings and resets clear both current and previous angles. Rotations use the car body's centre. This is an arcade visual maneuver over Planck's 2D collision model, not full 3D rigid-body collision. No new physics engine, generated stunt model, trick economy or scoring system.

Ramp-side and park perimeter cones were real solid fixtures and could snag a vehicle. All park cone meshes and fixtures are removed; flush paint and batched ground labels replace them. Five ordinary construction cones outside the park remain. The pause menu provides a three-lane arrival selector; no new driving overlay.

## Graphics and render cost
Added original 1024px Poly Haven Asphalt 02 diffuse and OpenGL normal maps, sRGB only for color, identical world-space 3 m UV repeats, anisotropy capped at 8. About 1.97 MB total downloaded texture bytes, no extra surface geometry. Existing 2048px sun shadow map now covers a tighter nearby area for sharper detail; distant scenery remains fogged. Far clipping moves from 1900 to 1200, beyond the existing 1060 fog end.

Safe static car batching preserves wheels, paint targets, glass sorting, normals and bounds. Normalized/interleaved quantized attributes must become floating point before matrix transformation; treating their integer storage as ordinary coordinates corrupts geometry. Actual GLB regressions verify triangles, bounds, wheel matrices and paint material identity for all five cars. Mesh counts: Concept GT 109→45, Roadster 105→55, BMW 31→30, NSX 38→32, Porsche 32→24.

Async optional GPU timer queries and a 180-frame ring buffer measure render cost without waiting for the GPU. Adaptive resolution uses CPU/GPU work when available, so a 30 Hz presentation cadence alone does not trigger a downgrade. Existing fallback and hysteresis remain. Hidden pages stop rendering; a paused driving scene redraws only after invalidation. DPR changes invalidate the canvas, and quality adaptation stops during a static pause.

## Measured validation
191 tests pass. Real browser driving verified both launches and successful touchdown: 360 yaw and roll each reached 2π, each reported a completed maneuver. Barrel-roll screenshot captured at elevation 4.77 m with active roll, then successful landing confirmed.

Stationary park view: Roadster, red paint, touring wheels, x=-375/z=580, heading 0, chase FOV 57, viewport 1280×720, DPR 1.5 (1920px canvas), 180 samples per window. Before: draw calls 437, triangles 884815, frame p50/p95 16.3/17.3 ms, CPU p50/p95 3.7/5.5 ms, latest GPU query 8.60 ms. After: draw calls 370, triangles 880281, frame p50/p95 16.3/19.0 ms, CPU p50/p95 3.3/4.6 ms, latest GPU query 5.65 ms. About 15% fewer draw calls with improved surfaces; median cadence remains around 60 FPS on this machine. Frame p95 was slightly worse in this short sample, so these measurements do not prove improved frame-time consistency or a universal FPS guarantee. Traffic timing and system scheduling vary. GPU numbers are latest samples, not percentiles.

## Primary references
- Ballistic flight equations: https://www1.grc.nasa.gov/beginners-guide-to-aeronautics/ballistic-flight-equations/
- Three.js shadow-map coverage and cost: https://threejs.org/manual/pages/shadows.html
- Drawing-buffer resolution: https://threejs.org/manual/pages/responsive.html
- Renderer API: https://threejs.org/docs/pages/WebGLRenderer
- Planck 2D physics: https://github.com/piqnt/planck.js
- Sourced texture and license: https://polyhaven.com/a/asphalt_02 and https://polyhaven.com/license

Critic review iteration 1: **8.6/10 — PASS**, threshold 8/10, no redo required. Independently reran 191 tests and inspected before/after and barrel-roll captures. Aerial stunts 9.0, cone removal 9.0, graphics 8.3, performance 8.2, UX 8.3, tests 9.0, YAGNI 8.5. Initial review caught a paused-canvas invalidation issue; fixed before this score. Residual limitation: short benchmark does not establish steadier frame timing.
