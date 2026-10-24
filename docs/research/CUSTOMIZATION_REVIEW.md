# Five-car customization and stunt park — 22 October 2026

## Delivered

Five sourced cars: Concept GT, Tesla Roadster 2020, BMW E36 M3, Honda NSX 1990, Porsche 911 (930) Turbo 1975. Every car has four independently rolling wheels and front-axle steering. The fused original Roadster scan is retained in the source; the active Roadster is an authored, licensed replacement with separate wheels and body paint. Porsche and Tesla origins, license links and adaptation notes are in CREDITS.md and accompanying assets/*-source.json / LICENSE documents. Detailed geometry evidence: assets/WHEEL_UPGRADE_RESEARCH.md.

Garage offers factory finish plus six paints and three wheel choices: factory, GT alloy, Classic mesh. Alternative wheels reuse actual GT/NSX geometry; no car or wheel model was generated. Choices persist independently for each car. Body materials are cloned per car, shared across that car's driving/home/garage views; tyres, glass, trim and other cars retain their finishes. Porsche paint was verified by actual triangle raycasts on bonnet, roof and doors, not material-name guessing. Native button keyboard activation works alongside garage browse/back shortcuts.

Wheel swaps fit the original wheel bounds. Templates are baked once from authored geometry, transformed into each target pivot's coordinates, and cached on first use. Hidden alternatives do not render. One WebGL renderer is retained. All transmission materials use the existing inexpensive alpha path to avoid an extra full-scene glass render pass. No upgrades, economy, parts marketplace, new game engine or generated replacement models were added (YAGNI).

## Ramp defects and repair

Old ramp entry only permitted forward-facing cars. Airborne landings only recognized ground Y0 and could leave the car inside a ramp's solid planar volume. Launch also occurred before the authored flat lip ended.

Support is now direction-independent at the low toe, respects the oriented car footprint, allows reversing down, and catches descending cars on the actual deck. Launch follows the full flat lip. Side/high vertical back faces remain solid. Regression tests cover repeated slow traversals, reverse up/back down, landing onto a deck, and fixed-step consistency.

All three ramps are in a dedicated 126 x276m paved park, x[-438,-312],z[312,588]. Two city blocks are reserved before procedural building placement. The unused interior street segment is paved into the park; its paint/crosswalks/street furniture are omitted. Surrounding traffic routes remain intact. The park is marked on the radar/map, and Pause → Settings & Controls → Visit Stunt Park takes the car to the southern entry.

Initial review found the smaller126m lot unsafe at full boost. The expanded strip now keeps all three65m/s test landings, including the whole car footprint, inside the park. No speed clamp was added to hide the layout problem.

## Independent critic (maximum3 review iterations, threshold8/10)

Implementation review iteration1: **8.7/10**, passing threshold. Scores: wheels9.0, licensed assets9.0, customization8.8, stunts8.7, UX8.0, tests9.0, performance/YAGNI8.5. The critic independently ran all175 tests and inspected actual decoded GLBs, centered pivots, leading axles, BMW source-triangle preservation, paint targeting, per-car storage, donor fit/caching and max-speed landing coverage. No blocking source-level findings remained. Its UX rating was based on source inspection; parent browser verification followed separately.

Parent browser verification: all five cars loaded and drove with four wheel pivots and changing rotation states. Roadster red/GT-alloy and Porsche blue/mesh choices survived reload. Porsche body recolors while glass/black trim remain unchanged. NSX climbed the park ramp to0.57m and reversed to ground at z548.44 without a stuck collider; telemetry reported elevation0 and no active ramp. Garage framing/control spacing was adjusted after visual inspection. **175 tests pass**; browser check is a smoke test, not an FPS guarantee or certification of every possible collision.
