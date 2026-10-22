# AFTERLIGHT — Driving rebuild: findings and validation

## Reproduced causes in the first implementation

- Buildings tested only the player center against AABBs padded by 1.1m. A 4.8m car's nose and corners could intersect a wall while its center remained outside. Orientation never entered the test.
- On contact, the position was restored and scalar speed multiplied by -0.22. This reversed tangential motion as well as normal motion, producing bouncing/snags rather than sliding.
- Traffic collision required player speed >3m/s and used a 3.5m sphere. A stopped player was explicitly excluded. Traffic positions were overwritten every render frame, so no physical impulse could displace them.
- Traffic corners changed instantly between straight segments, with a discontinuous 4.5m lane-offset jump at each junction.
- Kenney traffic cars face +Z (verified from front and rear wheel translations; the SUV spare is at the negative-Z rear). Rendered heading used -Z forward, so cars faced backward relative to travel.
- Car speed was clamped from a 94m/s boost cap to 73m/s in one frame when boost was released.
- Variable render dt was clamped to 50ms. Slower rendering discarded elapsed time and changed the simulated driving rate.
- Buildings were scaled to desired height without a footprint constraint. Wide assets could exceed their allocated lots.
- Default Box3 transforms are conservative for nested rotated meshes. Precise vertex bounds avoid inflated car measurements or incorrect ground positioning. The Concept car also ships with front wheels already turned 30 degrees; corrected before measurement.

## Established methods used

1. Planck.js / Box2D, rather than bespoke point collision: rotated convex car fixtures, static box/circle fixtures, contact manifolds, impulse resolution, friction, restitution and time-of-impact continuous collision detection. Player and traffic are dynamic bodies; player reset is the only regular transform teleport.
2. A 120Hz fixed-step accumulator. Rendering does not set the simulation rate. A bounded 250ms backlog protects tab resume; blur/hidden state pauses simulation.
3. A bicycle yaw target (speed / wheelbase * tan(steering angle)) with speed-sensitive steering and bounded lateral grip. Velocity remains a vector, so drift and impact momentum are physical. Vehicle tuning is arcade tuning, not a claimed real manufacturer specification.
4. Constant-arc-length line/circle routes for traffic, local nearest-path projection and look-ahead velocity following. Corner speed is bounded by sqrt(allowed lateral acceleration / curvature). Braking preview includes the current corner.
5. Precise source-model bounds and footprint-constrained lots. Street props receive base-level colliders. Camera distance is shortened against building volumes.

Primary references:
- https://piqnt.com/planck.js/docs/world/simulation.html
- https://piqnt.com/planck.js/docs/core-concepts.html
- https://piqnt.com/planck.js/docs/body.html
- https://box2d.org/doc_version_2_4/md__e_1_2github_2box2d__24_2docs_2dynamics.html
- https://box2d.org/files/ErinCatto_ContinuousCollision_GDC2013.pdf
- https://www.mathworks.com/help/robotics/ug/mobile-robot-kinematics-equations.html
- https://mathworld.wolfram.com/ArcLength.html
- https://threejs.org/docs/#api/en/math/Box3

## Asset selection

Compared the supplied Roadster, official sample Ferrari, and Khronos CarConcept. The Ferrari was excluded because its original source is disabled and the exact redistributable license could not be confirmed. CarConcept has explicit CC BY 4.0 attribution, embedded resources, named wheels/pivots and 213k triangles, versus approximately 972k triangles for the supplied Roadster. CarConcept is the default; the original Roadster remains selectable.

New downloaded CC0 props: benches, planters, dumpsters, cones, construction barriers, stop signs, highway signage and shoreline rocks. Original geometry retained. Credits and direct creator/source links are in CREDITS.md.

## Validation

20 deterministic regression tests cover full car footprint, high-speed impacts, thin poles, glancing wall slides, corners, stationary-player traffic impacts, near misses, sustained wall contact, reset, reversing, smooth boost release, 30/60/120Hz equivalence, route continuity, lane separation, traffic yielding and following distance.

Traffic algorithm debugging used 60-second simulations seeded near all corners. Before: 9.4–9.7m maximum lane deviation, approximately 54 degree heading error. After: 0.244m clockwise / 0.254m counterclockwise deviation and under 4.65 degree maximum heading error, with no corner teleport.

World: 980m × 1340m (1.31km²), 4.3 times the original ground area. 180 buildings, three parks, 38 physically simulated traffic cars. A runtime lot audit verifies every building footprint stays inside its own lot. During driving only the pause button is visible; optional touch controls are explicitly enabled in the pause menu. All information, garage selection and controls are in that menu.

Scope: planar arcade vehicle simulation. No deformable crash damage, suspension, airborne physics, or pedestrian simulation is claimed.
