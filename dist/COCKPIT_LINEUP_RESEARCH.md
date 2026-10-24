# Cockpit cameras and collection lineup

24 October 2026 — local implementation, with the previously submitted CrazyGames build preserved.

## Evidence and root cause

The old mode labelled `Hood` explicitly set `currentRide.group.visible = camMode !== 2`. It then positioned a single generic camera in front of the vehicle origin. The result was an unobstructed world view with the whole car hidden: there could be no visible dashboard or steering wheel. The camera also had no steering-wheel rig to animate.

The five downloaded vehicle GLBs were inspected using their actual indexed geometry, node transforms and connected components, before static batching. The driver's eye is now placed relative to the measured wheel centre, rather than sharing one guessed position across all models. In neutral pose the steering centre projects to NDC Y ≈ -0.598 (lower part of the view). Geometry ray tests confirm that the forward centre sightline is not blocked by the car.

| Vehicle | Steering source | Treatment |
| --- | --- | --- |
| Concept GT | `InteriorSteeringWheel01..04` and emblem | Preserve authored assembly under a hub pivot. Centre driving position matches the authored model. |
| Tesla Roadster | `roadster.014_Metal - Black rough_0` | Preserve source yoke. Correct its almost-horizontal neutral mount for a readable cockpit view. |
| BMW E36 M3 | Connected component of `Object_10`, measured centre approximately (-.327, .834, -.572) m | Separate only the authored steering component from the merged cabin; preserve remaining cabin triangles. |
| Honda NSX | Existing cabin has no separately usable steering assembly | Add the downloaded Savino CC0 wheel as a game accessory, not a claimed authentic Honda part. |
| Porsche 911 Turbo | Connected component of `Object_40`, measured centre approximately (-.314, .835, -.312) m | Separate only the authored steering component, preserving the seats and cabin. |

The measured centres above use normalized vehicle metres: X centred, Y grounded and front facing -Z. The camera uses the actual geometry after normalization, not these rounded audit numbers.

## Research and decisions

- [Three.js Object3D](https://threejs.org/docs/pages/Object3D.html): local/world transforms, `attach`, quaternions and parent transforms. Steering geometry is baked into a neutral hub frame before reparenting, avoiding quantized/non-uniform source hierarchy distortion. Existing authored mesh vertices are reused.
- [Three.js PerspectiveCamera](https://threejs.org/docs/pages/PerspectiveCamera.html): camera near plane must remain positive and projection changes require updating the projection matrix. Cockpit uses 0.025 m near clipping; chase/home/garage restore 0.12 m. Portrait uses a wider vertical field of view to keep the steering wheel visible.
- [Savino, Steering wheel](https://opengameart.org/content/steering-wheel): author-published CC0 steering asset. Original OBJ and converted GLB are bundled locally; source and license are recorded in `assets/cockpit/LICENSE.md`.
- [Three.js optimization manual](https://threejs.org/manual/pages/optimize-lots-of-objects.html): keep shared meshes/materials and static batching. Cockpit parts are explicitly pinned out of batching, while everything else keeps the existing batching path. Steering animation updates one quaternion, with reusable scratch objects.

Steering-column axes come from the source assembly's smallest covariance eigenvector (Jacobi diagonalization of the symmetric 3×3 covariance matrix). This finds the actual tilted wheel plane rather than assuming local Z. All source world matrices are refreshed before measuring newly separated components; an independent NumPy covariance check was used while debugging the BMW axis.

Steering follows the smoothed gameplay steering input, not the keyboard directly. It has a bounded cosmetic wheel rotation and returns to neutral. It does not alter physics. The camera follows the vehicle's rendered pose, including pitch and roll, and looks through the windshield. Only the relevant window geometry is hidden while inside, preventing opaque/tinted source glass from obscuring the road; exterior camera modes restore it. No extra cockpit render pass or duplicated world is used.

## Home and garage

Home now displays all five sourced cars side by side, with no platform and no automatic rotation. Only the equipped car advances 1.35 m toward the camera. Selection changes ease between positions; reduced-motion mode switches immediately. The camera fits the complete lineup using the viewport aspect ratio.

The existing circular stage styling is now inside the downloaded garage. The selected garage car sits on it and rotates; browsing a car remains a preview until the user equips/drives it. Existing saved paint/wheel choices are preserved across both presentations.

## Verification

- Actual GLB tests for all five cars: stable hub position, left/right rotation and neutral return, valid driver-eye placement, steering projected into the lower view, clear centre sightline and glass restoration.
- Authored geometry triangle counts are preserved for the Concept, Roadster, BMW and Porsche. NSX adds only the sourced CC0 wheel.
- Lineup tests cover all five cars visible, one equipped car forward, no automatic rotation, hidden-stage inactivity and portrait/landscape framing.
- Browser runtime checks exercised cockpit mode and nonzero steering in every car: Concept ~+3.34 rad, Roadster ~-3.32 rad, BMW ~+3.26 rad, NSX ~+3.17 rad, Porsche ~+3.11 rad during held inputs. These are test samples, not fixed steering angles.
- Development inspection confirmed the five-car home lineup. Further screenshot capture was blocked under the user's earlier restriction; no screenshot was used to claim cockpit appearance. Source-geometry projection/raycast checks and runtime state checks supplied the cockpit verification instead.
- Final automated checks passed all **439 tests**. Electron smoke startup passed with no reported errors or failed requests (about 17.8 seconds on this Mac). No GitHub push, live deployment or CrazyGames replacement is included.
