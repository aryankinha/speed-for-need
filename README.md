# AFTERLIGHT — Open Road

A browser free-roam driving game in an expanded 1.31km² coastal city. Downloaded CarConcept GT is the default, with the original supplied Roadster selectable in the pause-menu garage.

Run `npm run dev` and open http://127.0.0.1:4173. No installation or build needed. WebGL/hardware acceleration required. All models, rendering libraries and physics are bundled locally; Google Fonts has system fallbacks.

## Controls
- WASD or arrows: accelerate, steer, brake then reverse
- Space: drift / handbrake
- Shift: rechargeable boost
- C: chase, wide chase, hood camera
- R: return to Ocean Drive
- Enter: start/cancel coastal sprint
- Esc or pause button: menu, garage, stats, map, sound, controls
- Touch controls are optional and off by default; enable in pause menu

Only the pause button is visible while driving. Sprint time/results appear in the pause menu; green physical gates show the route.

## Validation
`npm test` runs 20 physics/traffic regression tests. `npm run check` checks source syntax plus tests. Uses Planck.js / Box2D CCD with a fixed120Hz simulation, dynamic traffic, measured rotated vehicle fixtures and street-prop collisions. Buildings are fitted within lots and checked at runtime. World surfaces are planar arcade physics.

[Research and root causes](dist/RESEARCH.md) · [Asset credits](dist/CREDITS.md)
