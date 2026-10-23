# Speed for Need — Open Road

A browser free-roam driving game in an expanded 1.31km² coastal city. Five selectable downloaded cars: Concept GT, Tesla Roadster, BMW E36 M3, Honda NSX 1990 and Porsche 911 Turbo. The main-menu garage has a live 3D interior, collection previews, tuning comparisons and saved ride selection.

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
`npm test` runs 260 regression tests covering driving, rendering, audio, UI, nitro and the garage. `npm run check` checks source syntax plus tests. Uses Planck.js / Box2D CCD with a fixed120Hz simulation, dynamic traffic, measured rotated vehicle fixtures and street-prop collisions. Buildings are fitted within lots and checked at runtime. World surfaces are planar arcade physics.

[Research and root causes](dist/RESEARCH.md) · [Asset credits](dist/CREDITS.md)

[Garage sources and debugging](dist/GARAGE_RESEARCH.md)

Three sourced stunt ramps sit in a dedicated paved park with clear runways and saved best jump distance. Yellow radar triangles mark their entries; Pause → Settings & Controls → Visit Stunt Park takes you to its entrance. [Verified stunt research](dist/STUNT_IMPLEMENTATION.md).

Garage paint and three authored wheel types are saved per car. All five cars have animated front steering and rolling wheels. [Customization and critic review](dist/CUSTOMIZATION_REVIEW.md).

The three park lanes offer Long Jump, airborne 360 Spin and Barrel Roll. Choose a lane in Pause → Settings & Controls before visiting. Take the ramp above 14 m/s (about 50 km/h) to trigger its aerial move. Cones and cone colliders have been removed from the park. Moves are arcade visual rotations over the existing planar collision model. [Graphics and aerial stunt review](dist/AERIAL_GRAPHICS_REVIEW.md).

## Solana Coast map
The map now has Pacific Boardwalk, Sunset Mile, Palm Gardens, Downtown Solana and Arts & Warehouse districts. A diagonal boulevard crosses the northern blocks, while the existing traffic, stunt park and four beach sides remain connected. Pause → Settings & Controls → Explore the coast selects a district arrival. New downloaded Kenney models are bundled locally for browser and Electron; no map API is needed. [Verified map research and validation](dist/LA_MAP_RESEARCH.md).
