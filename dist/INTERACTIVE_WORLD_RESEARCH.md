# Interactive parks and drifting tracks

Implemented October 23, 2026 on the current world layouts, preserving park paths and existing prop placements.

- Existing pots, benches, dumpsters, lamps, signs and traffic lights are extracted before static scene batching. No immovable duplicate visual or collider remains.
- Heavy furniture uses the existing Planck/Box2D planar contact solver with finite mass, damping and sleeping. Only furniture near the player is active. It slides against cars and walls; this is not full 3D tumbling simulation.
- Breakaway poles resist light impacts. A swept car check removes their base collider before a sufficiently strong impact, then bounded lightweight motion animates their fall. Distant poles are rejected before expensive checks. Fallen pieces can be struck again.
- Lightweight debris uses 120 Hz substeps, segment-versus-expanded-AABB sweeps and full vertical interval filtering against static scenery. Large teleports never create swept impacts across the map.
- Three existing garden plots gain sourced lawn tufts, bendable shrubs, potted plants, picnic tables and seats. Paths remain empty. Vegetation instances render only near the player; a shared GPU trail field bends foliage under the wheels without blade colliders. Grass has reduced tyre grip and mild resistance.
- Rear tyre ribbon positions come from the actual wheel pivots of the selected car. Slip and handbrake motion create asphalt marks; lawn driving creates lighter tracks. The fixed pool holds 3,000 segments in one draw call and fades over 55 simulated seconds. Resets, jumps, ramps, surface changes and discontinuous movement break ribbons.
- The old bench source was normalized to 2 m wide, producing a 2.35 m tall seat. Its replacement is an authored CC0 wooden bench at its native 0.889 m height. Picnic tables also retain source metre scale.

Primary references:
- https://piqnt.com/planck.js/docs/body.html — static/dynamic bodies, forces, damping, sleeping and continuous collision.
- https://threejs.org/docs/pages/InstancedMesh.html — shared-geometry rendering.
- https://threejs.org/docs/pages/BufferGeometry.html — fixed GPU buffers for tyre ribbons.
- https://www.cg.tuwien.ac.at/research/publications/2016/JAHRMANN-2016-IGR/ — interactive grass rendering background; the implementation here uses a small WebGL-compatible shared interaction field, not the thesis' complete OpenGL pipeline.
- https://polyhaven.com/license — CC0 source models; detailed provenance in assets/park/source-manifest.json.

Validation covers sampled-versus-swept hits in forward/reverse, no teleport impacts, heavy furniture against a wall, low/high-speed pole hits, path clearance, tyre ribbon upward normals, bounded capacity and no ribbons during jumps. Browser QA must additionally verify foliage shaders, visible tyre marks, UI travel and frame times at the selected quality setting.

Final QA: all 379 automated tests passed. Original, Coast and City Street Study maps booted and drove without console errors. Breakaway actors retain their own activation lifecycle, including after collision-cell refresh and respawn. Final independent critic review: 8.5/10 (iteration 3). Coast medium-preset browser sample at 852 px canvas width measured 8.3 ms median and 9.3 ms p95 frame time after warm-up; this is a measured viewport/device result, not a universal 60 FPS guarantee.
