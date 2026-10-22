# Curated additions — inspected 22 October 2026

Two additions only: a classic front-engine BMW E36 M3 and a mid-engine Honda NSX 1990. These contrast with the existing Concept GT and Tesla Roadster while staying substantially below the Concept GT's download weight. No new car geometry was generated.

## Sources and rights

- BMW E36 M3 by Martin Trafas: https://sketchfab.com/3d-models/bmw-e36-m3-762b90efd3dc413cb61c3e3c8097b8ac
- Honda NSX 1990 by Lexyc16: https://sketchfab.com/3d-models/honda-nsx-1990-1cc15628a00a4739a6b6c01128927c8d
- Both source records were independently checked using Sketchfab's public `/v3/models/{uid}` API: downloadable, `license.slug=by`, license URL CC BY 4.0, author names match. Minimal captured verification records and per-model attribution documents accompany the GLBs.
- Downloads are optimized, publicly licensed redistributions from https://github.com/pedrosoandre/carros. Its license/provenance record identifies geometry weld/simplify/prune and Meshopt compression, which must remain identified in credits.
- General CC BY requirements: name author, link original work and license, identify adaptations. Manufacturer names identify subjects and do not imply endorsement.

Other candidates considered: Quaternius Cars (official CC0 but the coarse low-poly style does not match these player cars); Sloyd community cars (generated assets, inconsistent style); Three.js Ferrari (existing project caution, avoided); several 7–15 MB tuner models (unnecessary asset weight). The selected pair is downloadable, modest in size, distinct in silhouette and engine layout, and licensed for redistribution and adaptation.

## File inspection

| Asset | Bytes | Triangles | Meshes | Materials |
|---|---:|---:|---:|---:|
| bmw-e36-m3.glb | 2,543,508 | 38,979 | 17 | 15 |
| honda-nsx.glb | 3,097,524 | 40,495 | 38 | 20 |

Both use `EXT_meshopt_compression` and `KHR_mesh_quantization`. Configure the official Three.js `MeshoptDecoder` on GLTFLoader before parsing; Draco alone is insufficient. Geometry is quantized, so use precise geometry-derived bounds (`new Box3().setFromObject(model, true)`) when normalizing/centering, and validate loaded buffers before taking collision sizes.

## BMW orientation and authored scene cleanup

- Up: +Y. Front: +Z, verified from HeadLights near z +10.17 and RearLights near z -10.51 after root transforms. Rotate Y by PI for gameplay's -Z forward.
- Remove node `Object_18`, material `Scene`: it is the author's oversized display plinth (raw bounds approximately x/z +/-27). Keeping it causes an incorrect normalization scale and erroneous collision dimensions.
- Clean raw car bounds approximately x [-4.6949,4.6945], y [.9611,7.7123], z [-11.5215,11.4808]. Normalize longitudinal extent to 4.43 game metres: approximately width 1.808, height 1.300.
- The four tyres and rims are merged by material across all four wheel positions; no four authored wheel pivots exist. Do not rotate an entire material mesh pretending it is one wheel. Static wheels are truthful; optional later connectivity segmentation can separate existing mesh islands without generating geometry.
- Body paint material: `CarPaint`.

## Honda orientation and wheels

- Up: +Y. Browser QA corrected the initial raw-node inference: front bumper faces +Z. Rotate Y by PI to face gameplay -Z. Retain its original nested hierarchy rather than static batching.
- Retain all meshes: Object_25's very large local translation is canceled by its parent transform and is part of the body. A local-space translation alone does not prove an object is scenery.
- Raw complete bounds approximately x +/-.6618, y [.4398,1.305], z [-.6231,2.3651]. Normalize to 4.43 game metres length: approximately width 1.962, height 1.283.
- Four authored wheel subtrees: `Circle.001_9` (+X rear), `Circle.002_19` (+X front), `Circle.003_20` (-X front), `Circle.004_21` (-X rear).
- World-space wheel centers before normalization approximately x +/-.527, y .7199, z .0347 (front) or 1.7479 (rear). Authored node pivots sit near x +/-.69 and are offset from wheel centers. Recenter under a wrapper using the precise world geometry box center and attach the existing wheel subtree preserving its world transform. Then spin the wrapper around car X and steer front wrappers around car Y. Preserve wrapper subtrees during static batching.
- Body paint material: `Material.003`.

## Performance / garage integration notes

Load car assets lazily and cache parsed templates. Keep a single game renderer and showcase scene where possible; hidden garages should not render. Static batch by shared material while excluding animated wheel subtrees. Keep physical vehicle size bound to each normalized car, avoiding the BMW plinth trap. Car specification values should be described as game tuning, not manufacturer-verified performance.

Authored garage selected and downloaded: 'Brutalist Interior' by vslite, CC BY 4.0 independently verified through the primary Sketchfab API (downloadable true), shipped as garage-interior.glb with its own license and source-verification documents. It is 3,009,036 bytes, 2,106 triangles, one mesh/material, embedded baked-light/emissive/normal/AO textures. Approximate world dimensions 40.8m wide by 42.2m long, ceiling3.58m, floornear0; alreadyYup. Keep original scale. This provides an authored garage without generating a substitute model.
