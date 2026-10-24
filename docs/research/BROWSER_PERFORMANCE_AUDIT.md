# Browser performance audit and implementation — 2026-10-24

## What was verified and corrected

The submitted audit correctly identified unthrottled shadow refresh, debug serialization in production, full-rate canvas radar redraw, continuously active distant traffic, prop/parked-car scans and expensive Coast collision preprocessing.

Several proposed details needed adjustment:

- Ordinary Three Mesh clones share geometry buffers. The player/showroom/garage do not each allocate a separate copy of every vertex buffer simply through `clone(true)`. Visible cars still incur rendering work; the dense hero models were a real triangle bottleneck.
- The installed BatchedMesh already culls individual parked-car instances against the shadow camera (`onBeforeShadow` delegates to `onBeforeRender`). The claim that every parked car is drawn into every shadow map is too broad. This was retained rather than adding another duplicate shadow batch.
- CCD must remain enabled for fast opponents and police as well as the player. Far civilian traffic can be inactive; nearby traffic also keeps bullet CCD to protect dynamic contacts.
- SharpenEffect and SMAA are both convolution effects. Combining them in the same EffectPass is not a correct optimization: the second effect would sample the preceding pass, not the newly processed neighbors. The existing tone mapping/color grading are already merged. The separate sharpening pass was retained.
- All five garage cars are used by the home lineup and races. Map-specific scenery was already loaded only for the selected map; removing the other car loads would break those features.
- Startup wheel reshading applies to the sourced steering assemblies, not whole car meshes. It remains to preserve the tested cockpit geometry/column behavior. Shader warm-up also remains to avoid first-use car-switch stalls.

## Changes

1. Shadows refresh at 30 Hz. The light's shadow projection moves only on those refreshes, keeping cached shadows aligned. Event-driven invalidations still refresh immediately. Small street furniture under 2.5 m stops casting shadows. Low/Medium use PCF, High/Ultra retain PCFSoft.
2. Periodic JSON telemetry and debug object exposure require `?debug`. Production only sets small one-time ready/map attributes; Electron smoke checks now use those and explicitly verify that production telemetry is absent.
3. Civilian traffic uses 220/240 m activation hysteresis and 70 m bullet CCD range. It resumes at its existing position, never teleports. Inactive traffic skips route control and mesh transforms. At the initial Coast spawn, 5 of 58 traffic bodies are active, with 1 civilian bullet body; racers/player/police keep their original protections.
4. Static radar layers are rendered once to a cached canvas. Free-roam and circuit radar redraw at 30 Hz, retaining dynamic traffic, race blips, activities and rotating navigation.
5. Medium's maximum pixel ratio is 1.25 instead of 1.5. Adaptive rendering responds after 1 second of sustained overload, retaining the 10-second recovery hysteresis. No tone-mapping/sharpening ordering was changed.
6. Sliding street props use the existing spatial index and a nearby active set. Moved props update their grid cell so returning to their actual position reactivates them correctly. Reusable before/previous/predicted states remove those per-frame object allocations. Parked-car contact events populate a small set for render updates; sleeping cars are removed after their final transform is written. Existing distance culling remains.
7. Concept GT: 213,347 to 78,957 triangles; Tesla Roadster: 229,698 to 54,409. Both now use Meshopt and WebP. The combined payload falls from 18.86 MB to 3.73 MB; combined triangles fall about 70%. All source node names, wheel pivots, transforms, materials and protected cockpit/steering/glass assemblies remain. The suggested 40k cap was not forced at the expense of driver-view detail. A separate downloadable AI LOD pool was unnecessary after this reduction; existing cloned cars continue sharing optimized geometry.
8. Offline Coast reproduction generates 69 exact height-sliced collision profiles (86,082 building fixtures). Stable geometry/content keys and a compiler-schema marker select the cache; altered or uncached geometry safely falls back to the established compiler. Browser validation found 160 cache hits and zero runtime profile compiles. These remain precise height-aware fixtures, not lot-sized boxes. Box2D body/fixture creation still occurs at startup.
9. Five stock garage thumbnails are now 256 x 144 WebP files totaling about 12 KB, replacing startup WebGL renders/readbacks/data-URL encodes. Customized previews update on demand. The HDR sky is downsampled in linear radiance to 1024 x 512, retaining HDR range; payload falls from 5.45 MB to 1.45 MB, with about 0.08% mean-radiance difference after RGBE encoding.

Original hero GLBs and 2K HDR are preserved under `source-assets/`, outside the shipped folder. Authored Drift track geometry/textures, garage behavior, cockpit modes, physics tuning, races and controls remain. The shipped runtime shrinks from 88.78 MB to about 72.64 MB, including the new collider cache.

## Verification and limits

`npm run check`: 461 passing tests, zero failures. New regression coverage checks traffic CCD/activation/resume, inactive route skipping, spatial reindexing, displaced furniture reactivation, serialized collision profile equivalence/schema fallback, actual optimized-asset/thumbnail correspondence, and contact-driven parked-car rendering. Existing cockpit, wheel, stunt, racing, collision and garage checks pass.

Brave checks covered normal Coast driving with no telemetry attribute, cached collision startup, all five loaded thumbnails, customized garage preview, Roadster selection/rotation preview and five-car Drift racing with no console warnings/errors after the corrected shadow-camera scope error. Both maps pass normal Electron startup/security checks and the no-production-telemetry assertion. Counter deltas confirm about 30 shadow refreshes and radar redraws per simulated second.

Raw figures are in `PERFORMANCE_VALIDATION.json`. At pixel ratio 1 on a 1512 x 812 canvas, a baseline Drift view drew about 1.09M triangles with a 21.0 ms GPU sample; one optimized view drew 433k with an 8.6 ms sample. A later busier optimized view sampled 17.4 ms. These are representative gameplay samples rather than identical controlled replays: visible cars, camera position and GPU scheduling vary. Do not turn these into a universal FPS or cold-load-time guarantee.

The Chrome tracing MCP required by the optional web-perf skill was unavailable. Validation used existing in-game timing/GPU queries, browser DOM/console checks, actual assets and physics tests. Loading still includes shader compilation, GLB decoding and fixture creation; there are remaining startup costs. No public deployment, GitHub push or screenshots were made.

## Rebuilding the generated assets

The exact build-tool versions are recorded in `source-assets/build-tools.json`. Install that manifest into a separate tools folder (the default scripts look in `/tmp/roadster-perf-tools`, overridable with `ASSET_TOOLS`). Runtime game dependencies are unchanged.

- `node scripts/optimize-hero-cars.mjs` reads preserved masters and regenerates both runtime GLBs and their report. It uses attribute-aware Meshoptimizer simplification with protected interior meshes.
- `node --loader ./scripts/offline-three-loader.mjs scripts/bake-building-colliders.mjs` reproduces the seeded Coast layout using a geometry-only GLB reader and native build canvas. The import loader maps Three to the same vendored browser files.
- `node --loader ./scripts/offline-three-loader.mjs scripts/bake-sky.mjs` regenerates the HDR from its preserved 2K source.
- With the local dev server running, `node_modules/.bin/electron scripts/bake-car-thumbnails.cjs` regenerates the five thumbnails and source hashes through the existing imported-car renderer. This renders car assets; it does not capture the screen.

## Primary references

- [Three Object3D and cloning](https://threejs.org/docs/pages/Object3D.html); the installed `Mesh.copy` and `BatchedMesh.onBeforeShadow` implementations were checked locally.
- [glTF Transform simplification pipeline](https://github.com/donmccurdy/glTF-Transform/blob/main/packages/cli/src/cli.ts) and the installed Meshoptimizer README for attribute-aware/Permissive simplification.
- [pmndrs effect compatibility](https://github.com/pmndrs/postprocessing/wiki/Effect-Merging): multiple convolution operators must not be combined naively.
