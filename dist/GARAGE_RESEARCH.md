# Garage research and validation — 22 October 2026

The current codebase was audited before integration; its 135 baseline tests passed. Audio, radar, loading art, themes, interpolation, nitro, camera and pause behavior were retained.

## Curated assets

Two additions only: BMW E36 M3 (Martin Trafas) and Honda NSX 1990 (Lexyc16). Both fit the existing detailed player-car style and provide different silhouettes. The downloads are 2.54 MB / 38,979 triangles and 3.10 MB / 40,495 triangles. The authored Brutalist Interior garage (vslite) is 3.01 MB and 2,106 triangles. All are CC BY 4.0; primary Sketchfab API verification records, attribution, source URLs and adaptation notes accompany the GLBs. See CREDITS.md and assets/new-cars-INTEGRATION.md.

Loader research: Three.js GLTFLoader documentation https://threejs.org/docs/#examples/en/loaders/GLTFLoader requires setMeshoptDecoder for EXT_meshopt_compression. Bundled official r170 decoder matches the existing renderer. No external runtime asset or CDN requests were introduced.

## Observed root causes and fixes

- Two-car special cases controlled loading, geometry orientation, physical configuration, names and selection. A single validated four-car catalog now drives these paths.
- BMW Object_18 is a giant display plinth. It is explicitly removed before normalization or collider measurement. The resulting measured footprint is approximately 1.808 x 4.43 game metres.
- NSX source wheel pivots are offset. Four wrappers are centered on their precise geometry bounds with attach(), preserving the authored world matrices. Both new cars retain their original nested hierarchy (browser QA also reproduced BMW wheel displacement after merging): browser QA reproduced a vertical/exploded body with static batching and confirmed the intact source hierarchy resolves it. Its measured footprint is approximately 1.962 x 4.43 metres. Browser inspection identified the front bumper facing the chase camera; a PI Y rotation fixes the actual driving orientation. This supersedes the initial raw-node inference in the asset handoff.
- Selection previously removed the active physics actor before validating the replacement. Invalid IDs now leave the active car intact.
- updateTransforms previously redirected the showroom's sun/shadow anchor back to the distant driving car when switching vehicles. Showroom updates now anchor to the active home/garage stage.
- Preview and equipped state are distinct; backing out cancels preview. Equip/drive persist only a valid car ID. Unavailable storage and stale IDs fall back safely.

## Runtime cost

One renderer/context, shared car geometry and textures across driving/home/garage. Only the selected garage clone is visible. The hidden garage is not updated. Four thumbnails render once at startup into one reused 256x144 target, then the target is disposed. No per-frame thumbnail rendering. Garage room uses authored baked lighting with no shadow casting. BMW retains 17 source meshes and NSX retains 38 source meshes to preserve correct transforms; correctness takes priority over unsafe merging. Added assets are eagerly loaded with the existing progress flow so every selection is ready and no driving-time network stall occurs.

Tuning bars compare fictional arcade settings across this game's collection; they are not manufacturer performance specifications.
