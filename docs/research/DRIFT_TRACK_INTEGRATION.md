# Drift Race Track integration

## Source inspection and visual preservation

The user's master `source-assets/drift-track/drift_race_track_free.glb` is **Drift Race Track Free**, by Nicholas-3D, rather than the separate paid Drift Race Track listing. Embedded metadata supplies the author, source URL and CC BY-ND 4.0 licence. Source listing: https://sketchfab.com/3d-models/drift-race-track-free-b4108132c93f4736957d97e274fbd11e . The source file remains untouched outside dist/; only the compressed runtime GLB ships. Attribution and licence links are in CREDITS.md; hashes/settings are in the adjacent source-manifest.json. Work stays local. The licence allows format conversion, but prohibits sharing adaptations; no publication clearance for an adapted version is assumed: https://creativecommons.org/licenses/by-nd/4.0/ .

Inspection found 247 meshes, 314,141 triangles, five materials and nine embedded images. Materials include Ground, Asphalt, Decals, Leafs_Mat and Metal. Asphalt and terrain retain base colour, normal and metallic/roughness maps. Vegetation retains its alpha mask. No Kenney city, replacement road, generated barrier wall or low-poly foliage is placed on this map. The free download itself supplies the scenery; absent details from the paid version are not fabricated.

The runtime GLB merges static primitives to five meshes, uses EXT_meshopt_compression, and converts textures to full-resolution WebP (2048² terrain/asphalt, 1024² decal/foliage images). Normal and roughness maps are lossless; colour maps use quality 95. No triangle simplification, texture resizing, road retexturing or material roughness override is used. Original 57,555,548-byte input is reduced to about 26 MiB; exact file lengths and checksums are recorded in the manifest. Source UVs and tangents remain authored. Mesh compression quantization is sub-centimetre at this scene's extent.

GLTFLoader already loads the PBR colour roles correctly: colour maps are sRGB; normal/roughness maps remain linear non-colour data. The existing Meshopt decoder is local, and no CDN is required at runtime. Lighting reuses the local midday HDR, ACES filmic tone mapping, exposure 0.95, environment intensity 0.8, sun intensity 3 and the established sun direction. Track materials are not made glossy or repainted to compensate for lighting.

Primary API references reviewed:
- https://gltf-transform.dev/cli
- https://gltf-transform.dev/modules/functions/functions/meshopt
- https://gltf-transform.dev/modules/functions/functions/textureCompress
- https://threejs.org/manual/pages/color-management.html
- https://registry.khronos.org/glTF/
- https://piqnt.dev/planck.js/docs/shape/chain.html

## Metres, ground and circuit

The full authored world transforms are retained at scale 1, following glTF's metre convention. The scene is approximately 508 × 509 m. The road's actual flat surface is y=0.002518 m. Imported guardrails are 1.5 m tall; existing garage cars remain their calibrated 4.29–4.8 m lengths, with measured widths (including the wider Concept GT). These are measured asset dimensions, not a claim of a surveyed real track or manufacturer-accurate architecture.

The source is a branched drift facility with a pit/access tail. The chosen closed route visits both the northern technical section and southern loop; the access tail remains available in free driving. The ~1.18 km racing line is traced within the actual asphalt mesh, not based on the earlier Solana waypoints. Road-aware A* anchors, uniform sampling and smoothing remove grid kinks. Every one of the final 2,048 spline samples, all 12 gates, the starting grid and track pickups are checked against authored tarmac. Spawn is on the long diagonal straight, oriented down it; all four alternate garage cars race the same native course. No scale-to-fit normalisation is used for the track.

## Physics

Visual triangles do not create collision. Offline preprocessing clips actual Rails/Barrier triangles to y=0.12–1.15 m, unions their projected footprints, expands 2 mm to close precision cracks, and simplifies contours with a maximum 2.5 cm tolerance. It produces 67 named obstacle footprints (2,357 vertices), plus one boundary chain at the visible terrain extent. This keeps gaps open and avoids entire-object collision boxes. The low slice excludes overhead sign/banner spans and preserves their ground-level feet.

Planck's Chain shape connects adjacent ghost vertices and supports two-sided contacts. Collisions are real static-chain versus dynamic bullet-vehicle contacts, with the original tyre grip/engine tuning. Tracing does not bridge deliberate gaps or install an invisible road-width box around the facility. Tests drive into rail chains from both sides. Foliage, flags and cones remain authored visuals; this integration does not invent rigid collision volumes for every decorative leaf/cone.

A real regression was found at the facility's nearby branches: the previous ±35 m nearest-point search could jump ~36 m in one tick and skip a required gate. Progress projection is now bounded by actual physical displacement, including a stationary-car guard. Ordered gates, splits and finish ranking remain enforced. A second issue was an unconditional ocean animation access; inland maps now skip it safely.

## Maps and gameplay lifecycle

Select **Maps → Drift Race Track** or use the pause drawer's destination list to switch maps. Switching worlds reloads the existing page, releasing the previous world's GPU/physics resources. Four local destinations on this circuit also support travel. Other maps keep their identities and defaults.

DRIVE provides free practice; RACE / Enter provides the existing three-lap five-car competition on this model. Three boost strips and ten race pickups use this route. The practice pickup field also follows the actual spline, not rectangular city roads. Circular GPS and pause maps draw the authored asphalt outline (including infield holes and the access tail). Race gates, timing, split labels and restart/free-roam return use the existing RaceMode/RaceHud lifecycle. The imported root is retained while racing; only temporary timing markers/opponents are removed on race exit.

City traffic, parked Kenney cars, street furniture, crowd, beach ambience and open-world police are not instantiated for this track. Garage, home showcase, cars, cockpit/chase cameras, touch joystick and other maps retain their existing systems. No second scenery kit is inserted into the imported map.

## Reproducibility

Runtime requires only shipped JS/GLB assets. Offline tools are optional:

1. Install @gltf-transform/core/extensions/functions 4.5.1, meshoptimizer and sharp in a temporary tools directory; copy scripts/optimize-drift-track.mjs into that directory so its package imports resolve there. Run it with input/output GLB paths. No simplification transform is present.
2. Install numpy and shapely into an offline Python tools environment. Run `scripts/trace-drift-track.py INPUT.glb OUTPUT.js` to regenerate drift-track-data.js. Regeneration was compared byte-for-byte with the runtime generated-data file.

## Verification

`npm run check` passes 468 tests: the existing 462 (including the earlier 452 gameplay tests), plus six new imported-track tests. The map identity test now expects the fourth destination. New tests verify preserved triangle/material roles, source checksum, road-contained samples/gates/pickups, real chain impacts from both sides, close-branch progress stability, native map selection and all five measured garage cars completing three laps without teleport or kinematic target calls.

Performance measurements are scene- and hardware-dependent; a steady universal 60 FPS cannot follow from file compression alone. Browser and Electron verification results are recorded below after local checks. No screenshots, GitHub push or public deployment are part of this work.

### Local verification results — 24 October 2026

- Brave free practice: median 8.4 ms, p95 16.7 ms over 180 frames; CPU median 2.7 ms / p95 3.4 ms, GPU sample 13.0 ms, 178 draw calls. The car accelerated on the imported straight with ground elevation 0.002518 m.
- Brave five-car race: automatic Medium, pixel ratio 1.5; median 16.3 ms, p95 16.8 ms over 180 frames; CPU median 3.7 ms / p95 4.5 ms, GPU sample 15.2 ms, 301 draw calls / 1.38 M rendered triangles including detailed cars and effects. This sample is approximately 60 FPS, not a guarantee for every device/view/preset.
- Browser checks: home Race starts this imported course, live AI/nitro/drafting and shared splits work, R resets the grid, local travel exits racing and grounds the player, all four maps appear, switching back to Coast boots normally, and the Coast pause drawer offers Drift Race Track. No new console errors were observed after fixing the inland/ocean lifecycle access. The camera modes and joystick remain the existing systems.
- Electron: existing startup/security smoke passes on the default world. Added a test-only `ELECTRON_SMOKE_MAP=drift` option; that smoke loads the actual compressed circuit under app://, confirms the requested map and game ready state, and passes sandbox/CSP/IPC checks with no errors (local load about 5.2 seconds). This is not a claim of a complete desktop race playthrough.
- `npm test` and `npm run check`: all 468 tests pass. The additional full-size car race simulation finishes all five cars in approximately 180–187 simulated seconds. Source-data regeneration matches byte-for-byte. No screenshots, public links, push or deployment were produced.
