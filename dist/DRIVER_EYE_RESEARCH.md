# Driver-eye cockpit refinement

24 October 2026. Local browser / Electron changes; no deployment.

## What the screenshot and code reveal

The screenshot has a large, almost featureless black roof/header, an instrument area that reads as a dark slab, and a wheel competing with the road rather than framing the cluster. The existing cabin geometry has strongly simplified surfaces. Lighting alone cannot supply missing instruments or change perspective.

Confirmed implementation causes:

- Every car used steering-hub + (0, 0.24, 0.64) as its eye position, despite different seat, roof and windshield geometry. FOV was a shared 64 degrees vertically, increasing under nitro. This was a hub-relative camera, not a measured driver seat fit.
- BMW `Cover` and Porsche `Material.002` / `Material.009` are literally zero RGB reflectance with no base-colour texture. A light cannot reveal a diffuse black surface with zero reflectance. The cabin treatment previously omitted these generic mesh names.
- Existing meshes include seats, glass/frame, mirrors and cabin trim, but several have no independent functioning gauge geometry. Some front cabin surfaces are extremely sparse. No camera adjustment can turn those into manufacturer-quality interiors.
- The geometry test reader formerly omitted glTF PBR factors and double-sided flags. This hid interior-facing seat/headliner intersections from ray tests. It now reads the actual source values. Camera calibration caught Concept seat-back and NSX seat/roof intersections that a single forward ray missed.

## Primary references and what is actually documented

- [BeamNG internal cameras](https://www.docs.beamng.com/modding/vehicle/sections/camera/): vehicle-relative driver cameras and compliant, damped movement under driving forces. This supports a car-specific eye anchor and small load-responsive head movement, not random shake.
- [BeamNG props](https://documentation.beamng.com/modding/vehicle/sections/props/) and [electrics](https://docs.beamng.com/modding/vehicle/vehicle_system/electrics/): steering wheels and gauge needles are animated meshes, driven by vehicle state with bounded sweeps. Our needles use the existing arcade drivetrain / audio calculations; they are not a new engine simulation.
- [Forza Horizon 5 accessibility documentation](https://support.forza.net/hc/en-us/articles/4409280058259-Forza-Horizon-5-Accessibility-Support): adjustable PC FOV and separately controllable cockpit drift camera, including sensitivity, speed and range. [Official Hot Wheels update](https://forza.net/news/forza-horizon-5-hot-wheels-now-available) distinguishes driver and dashboard camera FOV settings. This supports separating projection from seat position and keeping motion restrained.
- [EA's SHIFT 2 announcement](https://news.ea.com/press-releases/press-releases-details/2011/Need-for-Speed-Redefines-Racing-Simulation-with-SHIFT-2-UNLEASHED-on-Retail-Shelves-Today/default.aspx): driver / helmet camera developed with race-driver input. This is the relevant NFS reference; it does not establish cockpit support in every NFS title or disclose a reusable engine algorithm.
- [Assetto Corsa Competizione 0.2.1](https://assettocorsa.gg/assetto-corsa-competizione-ea-0-2-1-vr-hotfix/) documents view-setting camera offsets and look directions; [1.2](https://assettocorsa.gg/assetto-corsa-competizione-update-1-2-is-out-on-steam/) discusses correct world scale. These are public design references, not claims about proprietary camera code, and ACC is distinguished from original Assetto Corsa.
- [Honda's original 1991 NSX press kit](https://hondanews.com/en-US/releases/release-cc39196e84787a20ec3cb086fb095286-1991-acura-nsx) supplies contemporary interior dimensions. [Honda owner manual](https://techinfo.honda.com/rjanisis/pubs/om/NS9191/NS9191MAINIDX.pdf) was located but its PDF retrieval failed; it was not used to invent dimensions.
- [Porsche's historic 901 interior reference](https://newsroom.porsche.com/en/2023/scene-passion/porsche-blue-wonder-alois-ruf-christophorus-406-31827.html) illustrates the five-dial tradition. Contemporary 1975 930 and 1991 NSX interior photos were also located for visual comparison; no photos or commercial-game assets were imported.

Real cockpit layout principles: eyes sit ahead of the seat back, above and behind the steering hub; the wheel surrounds the instrument sightline; the dashboard remains below the central road corridor. Pillars and the windshield header remain physical framing. Seats behind the head should not be forced into a forward-only view. Mirror meshes retain their existing environment response; this change does not claim live rear-facing mirrors.

## Implementation

`cockpit-profiles.js` records per-car eye, look pitch, horizontal FOV reference and cluster placement in the shipped models' normalized metre coordinates. These are measured gameplay fits, not claimed manufacturer CAD data. Front dashboard probes found Concept's authored display face around (0, .816, -1.104), Roadster dash top near .778 m, BMW near .892 m, and NSX near .717 m. Porsche's existing upper instrument/trim region is around .89 m. Cluster pods fit these existing regions rather than scaling up the entire dashboard.

- Separate seat fit and aspect-correct projection, with vertical FOV bounded 48–74 degrees. Cockpit nitro widening is limited to 1.5 degrees. Chase modes retain their settings.
- Short damped lateral / fore-aft head movement driven by lateral load and longitudinal acceleration, bounded around 2 cm. Modest corner look is bounded at about 1.4 degrees. No new oscillating shake. Reduced-motion preference disables head offsets. Switching camera/car resets motion state.
- Existing authored steering assemblies retain their pivots and source triangles. The existing Three.js `toCreasedNormals` utility smooths wheel shading across 60-degree creases without changing vertex positions; the source column is measured before unindexing to avoid changing covariance weighting. Road-wheel geometry and driving physics are unchanged. Steering animation shares the road wheels' speed-dependent steering reduction.
- Modest, depth-tested **3D instrument pods** inside the car: two digital displays, BMW / NSX analog layouts, and Porsche's five-dial layout. Analog needles are real 3D meshes. Static dial markings are material textures on 3D faces; digital textures refresh at most 10 Hz and only when the value changes. There is no screen-space cockpit overlay.
- Speed, reverse / forward gear and tachometer use the game's existing audio/drivetrain model. Auxiliary needle positions are decorative steady readings because the game does not simulate fuel, oil pressure or coolant temperature. The EV display does not show a combustion tachometer.
- Local cabin lighting and physically non-zero charcoal trim preserve the exterior/world exposure. Existing seats, side windows, windshield frame and mirrors are retained. Camera-specific glass hiding follows the pre-existing system.

## Performance and verification

Instruments render only for the active cockpit. At most 16 added meshes (Porsche); digital clusters add two. Static geometry/materials are shared by display clones. One short-range cabin light, no shadow map, no rear-view world pass, no per-frame geometry generation. Camera updates reuse scratch vectors. Smooth browser FPS still depends on the scene, device and graphics settings; no universal 60 FPS claim is made.

Actual-GLB tests exercise each seat fit with 12 rays across the central driving corridor, visible instrument surface samples, projected wheel size, source triangle preservation, steering return/pivot, bounded head motion, reduced motion, aspect ratio and reverse/idle/forward instruments. Material fixtures preserve real PBR values and face-sidedness. Browser runtime checks use the existing DOM telemetry and UI, without screenshots under the user's earlier restriction.

Final validation: **451 tests passed** and Electron smoke passed with no errors or failed requests. Brave checks exercised the Concept digital cluster under acceleration/steering, NSX analog instruments (~67 km/h in second gear), Porsche profile/cluster startup, and all three camera modes. Chase / wide restore 0.12 m near clipping, exterior glass and hidden instrument pods. Console error log was empty. A short Concept sample measured frame p50 ~8.3 ms and p95 ~8.8 ms on this Mac; this is a local observation, not a cross-device FPS guarantee. No screenshots were taken, so the final appearance has not been independently verified through a new rendered screenshot.
