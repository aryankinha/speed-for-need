# Map and runtime asset cleanup — 2026-10-24

Only Solana Coast and Drift Race Track remain selectable. Retired Bay (`default`) and City Street Study (`la`) links and saved choices fall back to Coast.

## Removed

- Bay and City world builders, City layout, exclusive street-real pack and its preparation script.
- Unused unfinished LA world/deck code, its exclusive model exports and preparation script.
- Unused physics cell manager, obsolete fused Roadster model, old sky HDR, retired grass model, unused palm and skyscraper variants.
- Tests that exclusively exercised removed maps or deleted, unused assets. Retained-map tests use retained geometry fixtures.

Shared assets were audited before deletion: Coast skyline towers, coconut palms, facade/concrete textures, suburban/industrial buildings, interactive park furniture, traffic, pedestrians, all five garage vehicles and their cockpit assets remain.

## Loading and runtime

- Import only the selected world. Coast crowd, activities/police, street furniture, park and beach systems load only on Coast; Drift skips their models and construction.
- Share the startup texture cache, then clear and disable it after initialization.
- Reuse surface records and iterate existing road arrays instead of allocating surface records, arrays and callbacks every physics step.
- Keep the original Drift master intact in `source-assets/drift-track/`; ship only the compressed runtime GLB. Research documents now live in `docs/research/`, outside the shipped `dist/` folder.

## Measurements

- Before: 204,973,835 bytes in shipped dist files.
- After: 88,795,149 bytes across 261 shipped files.
- Reduction: 116,178,686 bytes (56.7%). These are decimal byte measurements, not compressed transfer sizes. Moving the preserved raw Drift source accounts for 57,555,548 bytes of this shipping reduction.
- Removing unloaded files reduces the package/upload footprint. The selected-map loading changes reduce actual startup work; this is not a claim of a measured universal FPS gain.

## Validation

- `npm run check`: 448 tests pass, zero failures, syntax checks pass.
- Asset catalog checks verify both maps have all startup models and retired content stays out of the shipping folder.
- Browser: Coast and Drift both load, drive, and report no warnings/errors; selector offers exactly two maps. Coast retains 160 buildings, 258 kerbside cars and 65 lot-fill cars.
- Electron smoke checks: Coast and Drift both pass with no console errors or failed assertions.
- No GitHub push, deployment, public link, screenshots or installer rebuild performed. Existing release installers have not been regenerated.
