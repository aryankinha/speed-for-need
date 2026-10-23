# Authored PBR city assets

Downloaded from the original creators, licensed CC0. No GTA game data or extracted proprietary models are included.

- Quaternius, [Downtown City MegaKit Standard](https://quaternius.com/packs/downtowncitymegakit.html), [official download](https://quaternius.itch.io/downtown-city-megakit). Three complete buildings with facade detail, window frames and interior cards. The free kit does not include the paid Source engine shaders.
- James Ray Cock / Poly Haven, [Modular Urban Apartments Facade](https://polyhaven.com/a/modular_urban_apartments_facade), [CC0 license](https://polyhaven.com/license). Six selected authored facade modules.

Prepared using `scripts/prepare-la-assets.mjs`. Geometry dimensions, materials, triangle counts, hashes and alterations are recorded in `source-provenance.json` and `preparation-report.json`. Imported building origins are offset; use the supplied bounds rather than assuming the origin is centered. The facade-kit modules intentionally overlap at local origin and must be instantiated by name, not displayed as the whole scene.

Normal and ORM maps contain linear data; color maps use sRGB. ORM means R=occlusion, G=roughness, B=metalness. Material names and GLB JSON preserve the original PBR bindings. Transparent glass remains transparent; do not merge it with opaque facade surfaces.
