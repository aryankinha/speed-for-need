# Speed for Need — Open Road

A browser free-roam driving game in an expanded 1.31km² coastal city. Four selectable downloaded cars: Concept GT, the supplied Tesla Roadster, BMW E36 M3 and Honda NSX 1990. The main-menu garage has a live 3D interior, collection previews, tuning comparisons and saved ride selection.

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

The pause button, radar and nitro meter appear while driving. Sprint time/results appear in the pause menu; green physical gates show the route.

## Validation
`npm test` runs 159 regression tests covering driving, rendering, audio, UI, nitro and the garage. `npm run check` checks source syntax plus tests. Uses Planck.js / Box2D CCD with a fixed120Hz simulation, dynamic traffic, measured rotated vehicle fixtures and street-prop collisions. Buildings are fitted within lots and checked at runtime. World surfaces are planar arcade physics.

[Research and root causes](dist/RESEARCH.md) · [Asset credits](dist/CREDITS.md)

[Garage sources and debugging](dist/GARAGE_RESEARCH.md)

Three sourced stunt ramps add airborne jumps and saved best distance. Yellow radar triangles mark their entries; Pause → Settings & Controls → Explore stunt jumps takes you to the first approach. [Verified stunt research](dist/STUNT_IMPLEMENTATION.md).
