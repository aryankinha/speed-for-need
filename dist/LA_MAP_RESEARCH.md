# Solana Coast — map research and implementation
Verified 23 October 2026.

## Decision
A compact, original Southern California city built from downloaded CC0 modular kits fits this game's existing Three.js WebGL renderer and Planck 2D vehicle solver. It is an LA-inspired fictional coastal map, not a geographic recreation of Los Angeles or a GTA asset port. The existing 980 × 1340 m playable footprint and four-sided beaches remain; its streets, zoning, building distribution and navigational presentation are rebuilt. A new 636 m diagonal connects the coastal side to the northern residential blocks. Broad avenues connect downtown to the waterfront and southern warehouses. Cars, garage/customization, race gates, traffic loops, boost pads and stunt lanes remain compatible.

LA Tourism distinguishes the beach cities, Hollywood, Downtown and other regions. That supports contrasting low-rise coastal/residential neighborhoods with a concentrated urban skyline rather than distributing skyscrapers uniformly. We use that as visual inspiration, not survey data or street tracing.
https://www.discoverlosangeles.com/meetla/plan/regions
https://www.discoverlosangeles.com/discover-la-your-way-los-angeles-beach-cities

## Checks on the supplied research
- Kenney's official Suburban and Industrial pages confirm CC0. Selected 12 authored GLB assets (six houses, four industrial buildings, a water tower and a container). Downloads came from Kenney's own OpenGameArt uploads because direct downloads from kenney.nl failed TLS connectivity in this environment. Original licenses and per-file hashes are bundled. About 1.41 MB of new GLBs; original palette PNGs are embedded so Electron needs no missing external texture path. Geometry was not generated.
  https://kenney.nl/assets/city-kit-suburban
  https://kenney.nl/assets/city-kit-industrial
  https://opengameart.org/content/city-kit-suburban
  https://opengameart.org/content/city-kit-industrial
- Existing Commercial buildings, palms and street props are reused with their existing attributions. New district zoning replaces uniform random tower selection.
  https://kenney.nl/assets/city-kit-commercial
- Quaternius confirms 315 models overall, but its free Standard release contains only 60–70% of the full pack. Its official description says Boston/NYC-style blocks. Paid source shaders do not automatically work in this renderer. It is a valid alternative, not the selected LA-specific solution.
  https://quaternius.com/packs/downtowncitymegakit.html
- A GTA/fan-rip map was not selected: the supplied document did not establish redistribution permission for its underlying game assets. Public model availability alone is not source verification.
- Google Map Tiles policy prohibits unauthorized offline use and storage. An exported or streamed Google city is not a self-contained offline Electron asset. Blosm's code license does not independently license third-party imagery/data. No Google tiles or GIS extraction are used.
  https://developers.google.com/maps/documentation/tile/policies
- A 15–30 MB total package, fewer than 500 draw calls or 75% memory reduction cannot be promised just by selecting a kit or compression format. Actual model counts, texture format and visible scene matter. The pre-existing game assets exceed that total-package range. Added assets are measured separately.

## Implementation and scope
map-layout.js defines district identity, destination poses, the diagonal corridor and polygon clipping. Sutherland–Hodgman half-plane clipping splits lot surfaces on both sides of the road; the road is not painted over solid buildings. Conservative real-footprint clearance excludes buildings and street furniture from the corridor. Existing road intersections connect it to the rest of the city. Ordinary streets stay at their original locations to preserve traffic and established stunt/boost approaches. Main avenues are wider, with their lamps/signals moved outside the wider lane envelope. Downtown towers are concentrated and taller; residential and warehouse districts use the new authored models.

Static geometry remains batched by material in 220 m spatial cells for frustum culling, and final static transforms are frozen. Shared kit palettes keep repeated buildings from creating a material per instance. New map geometry is road/sidewalk layout only. No heavy streaming framework, new physics engine, API billing or whole-city monolithic model is added. The current planar solver supports ground-level roads and existing arcade stunt heights; no unsupported driveable multi-level freeway is advertised.
https://threejs.org/manual/pages/optimize-lots-of-objects.html
https://threejs.org/docs/pages/InstancedMesh.html

Both the pause map and live radar share the same district/diagonal definitions. District arrival choices are inside the existing pause settings. Map backing colours are drawn before streets so they cannot conceal the road network. The home screen retains the existing car turntable with the new skyline behind it.

## Validation
- Baseline: 258 checks passed before editing. Final: 260 checks pass, including actual sourced model world construction and placement invariants.
- Actual physics probes sample the diagonal every 8 m and check all five district arrival poses for overlap with any solid world object. Existing stunt park cone absence, boost approaches, ramp behavior, five car wheel rigs, paint, traffic and audio regressions remain green.
- Browser: all new local GLBs load without console errors. Verified downtown, warehouses, new district selector and diagonal driving. A real 8.5-second drive advanced about 200 m through the new diagonal and its intersections, with traffic active. Static parked downtown 1280×720, canvas 1920px, DPR 1.5: 180-frame sample p50 16.6 ms / p95 18.0 ms; CPU p50 3.3 ms / p95 4.1 ms; 239 draw calls and about 545k triangles. These are local observations, not a cross-device FPS guarantee or matched improvement benchmark.
- Electron: launched the existing app:// build with the same local assets; no asset or script errors reported in its log. Native visual inspection could not complete because macOS was locked. Browser screenshots are the visual proof; Electron visual QA remains unverified.
