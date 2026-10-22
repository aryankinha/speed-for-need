# Stunt notes independently checked — 22 October 2026

The earlier STUNT_RAMP_RESEARCH.md is a proposal, not verified implementation. This audit supersedes its geometry, placement, filtering and performance claims.

## Primary evidence

- Kenney Racing Kit: https://kenney.nl/assets/racing-kit — official page identifies CC0. Downloaded its linked original archive; shipped only Models/GLTF format/ramp.glb (6,996 bytes, 94 triangles, two untextured materials). Byte hash, exact geometry dimensions, direct download and CC0 license are in assets/stunt-ramp-source.json and stunt-ramp-LICENSE.txt. No ramp geometry was generated.
- Ballistic equations: https://www1.grc.nasa.gov/beginners-guide-to-aeronautics/ballistic-flight-equations/ — horizontal/vertical velocity decomposition and y = y0 + vy*t - g*t²/2. Gravity18.5m/s² is explicitly arcade tuning, not real gravity.
- Contact filtering/fixed steps: https://box2d.org/documentation/md_simulation.html ; the bundled Planck1.4.2 source was also inspected directly: Contact.setEnabled at vendor/planck.mjs:5326 and World.preSolve at6499. Planck retains the existing planar CCD solver; the new layer supplies elevation and pitch at its existing120Hz fixed step.

## Claims corrected

| Proposal | Verified finding / implemented decision |
| --- | --- |
| Disable every non-skyscraper contact while player airborne | Unsafe: callback also receives unrelated traffic/traffic contacts, and all buildings use kind=building. Filter only the actual contact pair by measured vertical overlap; unmeasured colliders and boundaries remain conservative. Own ramp is ignored only during a valid traversal/departure. |
| Ramp x=-454.5 clears traffic x=-450 | Actual traffic lanes are offset±4.3m. Put a4.6m ramp on the road center x=-450, between lanes, with measured vehicle-fit entry gate. |
| x170,z160 is clear construction space | It lies outside the x150 road corridor among existing props/lots. Use x150,z250 instead and audit each ramp against actual obstacle bounds at world creation. |
| Generated parabolic ramp,22degrees,128triangles | Downloaded ramp is a straight incline plus flat lip,94triangles. Normalize to width4.6,length10,height3.4; measured incline run9.046805m gives20.596degrees. Launch at the incline/flat transition. |
| Flat ground sampling changes at x=-486 | Physical island boundaries prevent driving onto that sand. All three chosen flight corridors land on actual planar asphalt at Y0. No invented terrain sampler or rooftop driving is claimed. |
| Zero new draw calls / under0.08ms / zero GC guaranteed | Not established. Reuse the current material/cell batcher; no extra renderer, textures or render passes. No timing guarantee is asserted. Small scalar jump updates run at120Hz. |
|135 existing tests |144 tests passed before this change;159 now pass, including real asset, jump, camera, pickup and unrelated collision regressions. |

## Delivered scope (YAGNI)

Three repeated sourced ramp models: Ocean Drive toe(-450,-80), facing north; Civic Boulevard(0,100), facing south; East Boulevard(150,250), facing north. Optional pause-menu Explore stunt jumps places the car65m before the first toe. Yellow radar/map triangles mark entries. Jump distance records appear in settings and persist locally. Driving gets no new overlay.

Cars climb the measured slope, depart into constant-acceleration flight, interpolate elevation/pitch between fixed steps, coast without tyre propulsion in air, and restore grip over120ms on landing. Chase/wide/hood camera heights follow the car; ground shadow stays on the street. Existing impact audio supplies the landing cue. Nitro exhaust uses rendered height; airborne cars neither burn propulsion nitro nor collect bottles beyond ground pickup reach.

Reverse/high-lip/side entry cannot arm the launch sensor; the ramp volume remains solid for invalid entries. Slow traversal can roll off the incline but only forward takeoffs≥14m/s count as a recorded jump. Collision uses vertical extents from source models, preserving normal contact when a car is too low to clear a prop/traffic. It remains arcade2.5D physics, with no full3D suspension, loops, barrel rolls or rooftop landing system. Speed traps, gantries, flash overlays and scoring tiers were omitted because the request is to add stunts.

## Verification

159 tests pass. New regressions cover all three real ramp layouts with solid ramp colliders, forward takeoff and landing, wrong-way entry, 30/60/144Hz equivalence, reset, record persistence/storage failures, low/tall obstacle clearance, unchanged traffic/traffic collisions, authored GLB normalization/deck dimensions, altitude-aware camera aim and ground pickup exclusion. Browser QA loaded all assets and completed a jump; telemetry confirmed an airborne car at6.07m with camera following, plus an earlier completed jump with a saved distance. Existing garage, car selection, radar, nitro and pause controls remain intact.
