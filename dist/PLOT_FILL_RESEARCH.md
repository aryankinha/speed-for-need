# Filling the empty plots between buildings

Research only. No game code or asset was changed. Date: 2026-10-23.

Question: the lots between the buildings are bare. What is empty, why, and how should we fill it?

Short answer: on the two big grid maps (Solana Coast and Solana Bay) about 83-90 % of every city-block interior is bare ground. Each 48-50 m lot holds a single building that covers only 14-22 % of it. The cheapest strong fix is a district-themed "lot kit" layer (trees, plaza or yard, parking courts, yards with containers) built from assets that are already in the repo, rendered through the BatchedMesh pattern that `street-cars.js` already uses, with almost no new colliders.

---

## 1. Which maps exist (important for "LA")

`dist/map-selection.js` lists three maps, and `game.js:7-9, 49-50` wires three world builders:

| Map id | Name in menu | World builder | Size |
|---|---|---|---|
| `default` | Solana Bay (the original) | `world-default.js` | 980 x 1340 m grid, 7 x 9 roads |
| `coast` | Solana Coast | `world.js` | same grid, plus the Sunset Mile diagonal |
| `la` | City Street Study | `world-street.js` | 200 x 260 m, 2 x 2 roads |

`world-la.js`, `la-layout.js`, `la-decks.js` (the 2.4 km "Solana LA" with the river channel) are **not imported by `game.js`**. Nothing in the shipped game builds that map. `LA_MAP_RESEARCH.md` describes it as a plan, not as shipped. So "the LA map" in the player's menu is the small City Street Study. I measured the unshipped LA layout too (section 3.4) in case it is revived.

`world.js` and `world-default.js` are near-duplicates (same structure, Coast adds the diagonal, districts and houses/warehouses). Any fill hook has to be added to both, or better, to a shared module they both call.

---

## 2. Why the gaps exist (root causes, with code references)

All line numbers are in the current files.

1. **Fixed 2 x 2 lot grid, one building per lot.** `world.js:95-102` places four lots per block at offsets dx = +-32, dz = +-33 with a 48 x 48 m lot rectangle (`world-default.js:76`: +-33 and 50 x 50 m). Between the lots there are cross corridors 16 m (x) and 18 m (z) wide. Exactly one building is put in each lot.
2. **Buildings are sized by height, not by lot.** Kenney commercial buildings are normalised to 12-24 m *tall* (`world.js:64`), and they are tall and narrow, so their footprint is only about 11-16 m. The photo-textured towers are scaled by 0.30-0.42 (`world.js:66`) giving 12-30 m footprints. `fit = min(1, 46/size)` only ever *shrinks* a building to stay inside the lot, it never grows one to fill it. Then a random 0.82-0.97 scale is applied (`world.js:99`).
3. **Only houses and warehouses are wide.** Houses are normalised to 21 m wide and warehouses to 42 m wide (`world.js:69`). That is why the Arts district is the fullest (35 % built) and Boardwalk, Sunset Mile and Palm Gardens are 92-95 % empty.
4. **The ground is one continuous lawn patch** (`world.js:90`: `patch(blockWidth-10,114,...,grass)`), so the leftover is read as an empty field. Only commercial and industrial blocks get 12 m asphalt cross-drives (`world.js:92`), and the Arts blocks are asphalt all over.
5. **Lots dropped by the Sunset diagonal.** `clearOfSunset(lot,1)` (`world.js:96`) removes 12 lots along the diagonal (4 Sunset Mile, 8 Palm Gardens). Those lots stay fully empty.
6. **Props sit only on block edges.** `world.js:105-106` puts two planters at x = +-58, two benches at z = +-58 and one dumpster in every third block. Industrial blocks get one water tower and two containers in the middle (`world.js:103`). That is about 5 props per 13,000 m² block.
7. **Parks are a separate system** (3 blocks, `world.js:93-94`, `park-life.js`, `street-props.js:layoutParkProps`). They are not the problem, they are the only blocks that look finished.
8. **The earlier research docs do not cover this.** `INTERACTIVE_WORLD_RESEARCH.md` is about knockable parks and tyre marks. `LA_MAP_RESEARCH.md` is a 2.4 km GTA-scale spec that was never built. Neither addresses lot fill.

Also relevant: the chase camera and the pedestrians were tuned around these lot rectangles (`pedestrian-sim.js:80` has a comment "coast lots reach 54.3 m from the block centre"). Any fill needs to respect the same sidewalk band.

---

## 3. Measured empty area

Method: a node script reproduces the layout constants without WebGL. It imports `map-layout.js` (`blockPolygons`, `clearOfSunset`, `mapDistrict`) directly, reads building sizes from the GLB accessor min/max (real model bounding boxes, with node transforms), re-applies the scaling rules from `world.js` / `world-default.js` and the seeded LCG from `game.js:74`, then sums footprints.

Scripts (kept out of the repo): `/private/tmp/claude-502/-Users-aryankinha-Downloads-Roadster-2/1892a444-de5d-41d9-a114-20d444fefe6e/scratchpad/measure.mjs` (Coast and Bay), `.../street.mjs` (City Street Study), `.../la.mjs` (unshipped LA), `.../glbbox.mjs` (GLB bounds).

Honest limits:
- Building footprints are axis-aligned bounding boxes of the scaled model. Real colliders follow the roof/wall slices (`building-colliders.js`), so true built area is a bit lower than I count, and the empty area a bit higher.
- The seeded random sequence is replicated in order but may not match the live game call for call (other code can draw from `random` first). I ran 20 different seeds as a check: Coast 82.7-84.6 % empty, Bay 88.1-91.4 %. The tables use the exact `game.js` seed (Coast 85.0 %, Bay 89.5 %). Treat all values as +-3 percentage points.
- "Interior" means the lawn/asphalt patch inside the 5-6 m sidewalk band, clipped by the Sunset diagonal on the Coast. It excludes roads, sidewalks, the 3 park blocks and the 2 stunt-park blocks.

### 3.1 Solana Coast (`world.js`)

World 980 x 1340 m = 1.31 km² (131 ha). 48 blocks: minus 2 stunt blocks, minus 3 parks = 43 built blocks.

| Quantity | Value |
|---|---|
| Block interior (buildable ground) | 531,000 m² = 53.1 ha |
| Park lawns (3, separate system) | 38,500 m² = 3.9 ha |
| Buildings placed / lots | 160 / 172 (12 lots dropped by the Sunset diagonal) |
| Building footprint (bbox sum) | 79,900 m² = 8.0 ha (about 500 m² each) |
| **Empty ground** | **451,000 m² = 45.1 ha = 85 % (83-85 % over seeds)** |
| Average lot fill (built lots) | 21.7 % of the 2,304 m² lot |
| Fully empty dropped lots | 12 x 2,304 = 27,600 m² |
| Inter-lot corridors (approx.) | about 135,000 m² (13.5 ha) |

By district (all figures from the same run):

| District | Blocks | Interior ha | Buildings | Empty % | Empty ha | Ground |
|---|---|---|---|---|---|---|
| Pacific Boardwalk | 6 | 7.4 | 24 | 94.6 | 7.0 | lawn |
| Palm Gardens (houses) | 10 | 11.8 | 32 (8 lots dropped) | 91.9 | 10.8 | lawn + driveway stubs |
| Sunset Mile | 7 | 8.3 | 24 (4 lots dropped) | 94.9 | 7.9 | lawn |
| Arts & Warehouse | 9 | 11.6 | 36 | 65.0 | 7.5 | asphalt all over |
| Downtown Solana | 11 | 14.1 | 44 | 84.6 | 11.9 | lawn + asphalt cross-drives |
| **Total** | **43** | **53.1** | **160** | **85.0** | **45.1** | |

About 7.5 ha of the empty ground is bare asphalt yard (Arts). Most of the rest, about 37 ha, is bare lawn. Downtown and Arts also have 12 m asphalt cross-drives (roughly 4-5 ha) that are meant as internal circulation and should stay open.

### 3.2 Solana Bay (`world-default.js`)

| Quantity | Value |
|---|---|
| Block interior (114 x 114 m lawn, 43 blocks) | 558,800 m² = 55.9 ha |
| Park lawns (3) | 39,000 m² = 3.9 ha |
| Buildings / lots | 172 / 172 (no diagonal) |
| Building footprint | 58,500 m² = 5.8 ha (about 340 m² each) |
| **Empty ground** | **500,300 m² = 50.0 ha = 89.5 % (88-91 % over seeds)** |
| Average lot fill | 13.6 % of the 2,500 m² lot |

Bay buildings are smaller on average because only the 14 Kenney commercial buildings and the 7 photo towers are used, all normalised by height. There are no houses or warehouses on this map.

### 3.3 City Street Study (`world-street.js`, menu id `la`)

Playable area is the rectangle inside the boundary colliders, x -64..134, z -129..129 = 198 x 258 m = 51,084 m² (5.1 ha). Measured on a 1 m raster. The frontage depth (6.2 m) comes from the GLB bounds (6.2 m on x) and is an assumption about how deep the body sits.

| Class | m² | share |
|---|---|---|
| Roads (x = 0 and 70, z = +-110, 16 m wide) | 9,280 | 18.2 % |
| Buildings (21 full buildings) and 4 frontage runs | 8,696 | 17.0 % |
| 5 m sidewalk band beside the kerbs | 5,664 | 11.1 % |
| **Empty** | **27,444** | **53.7 %** |
| of which inside the two central blocks | 4,868 | |
| of which outer margins behind the buildings | 22,576 | |

Most of the empty area here is behind the continuous facade rows and cannot be seen from the driving loop. The visible gaps are the 13-15 m alleys between the full buildings on the x = -26, 35 and 96 columns and the open approaches at the intersections. This map is a small prototype and has the least to gain.

### 3.4 Unshipped Solana LA (`world-la.js`), for reference

49 blocks of 266 x 266 m interior, 43 built (channel blocks skipped), 492 buildings of 12-21 m footprint plus 26 x 26 m plinths. About 3.04 km² of interior with 118,000 m² built is **96 % empty**. It is not in the menu, so it is not in scope unless the user wants it revived.

### 3.5 What these numbers mean visually

Each Coast lot is a 48 x 48 m square with a 12-16 m building in its middle. The visible ring around the building is 16-18 m wide on every side and 5-9 m even beside the largest towers. That is a lawn the size of three tennis courts per building, repeated 160 times.

---

## 4. Constraints a fill layer must respect (read from the code)

| System | File | What it means for fill |
|---|---|---|
| Collision budget | `stunts.js`/`spawn-clear.js` comments | Buildings are compound colliders with about 540 fixtures each, 86,800 on the Coast. A building-style collider per infill piece would double that. Fill must use single boxes. |
| Camera | `game.js:368` | The chase camera's overhead fallback only tests boxes whose actor `kind === 'building'`. Fill colliders must use another `kind` (for example `'lot-fill'`) so they never shove the camera overhead. |
| Obstacle consumers | `world.obstacles` | `spawnBlocked` (ride swap), `PropObstacles` (debris sweeps), `blockedAt` in `open-world.js` (hidden packages, 2 m margin) and the pedestrian obstacle list all read `world.obstacles`. Register fill colliders there with a box. |
| Interactive props | `world.js:40`, `street-props.js` | `addStatic` with the names planter, bench, dumpster, signal, lamp, stop-sign, cone, barrier does not create a static body. It turns the item into a knockable prop with limited active count (`maxActive:40`, view radius 120). Do not push hundreds of fill items through those names. |
| Seeded layout | `world.js:46`, `game.js:74` | Every building choice depends on the shared `random()` sequence. A single extra call in the lot loop would reshuffle every later building. Fill must use its own generator (`seeded()` is already exported by `street-props.js`). |
| Static batching | `world.js:24-31`, `mesh-batching.js` | Static meshes merge per cell (220 m) and material. Draw calls grow with the number of *materials*, not with the number of objects. Reuse existing materials where possible. |
| Parked cars | `street-cars.js` | One `BatchedMesh` for up to 250 kerbside cars, per-instance frustum culling and distance culling, optional shove-able bodies. A parking-court planner can reuse the same renderer. `planParkedCars` already has an `extraAvoid` hook. |
| Pedestrians | `pedestrian-sim.js:46-90` | Walk lanes sit 1.85 m inside the kerb of every block. Fill must stay off the sidewalk band. Obstacles wider than 4 m are treated as spawn blockers, narrower ones as circles walkers avoid. |

---

## 5. Research: how other games fill blocks

I used about ten web calls. The honest result is that Rockstar's and EA's own lot-filling methods are not publicly documented in a form I could cite, so the design heuristics below are general open-world practice, not claims about a specific game.

What I could source:

- GTA V renders distant areas as very coarse single meshes and the near area with thousands of draw calls, with heavily instanced small objects and real-time streaming. Adrian Courreges' frame analysis: https://adriancourreges.com/blog/2015/11/02/gta-v-graphics-study-part-2 (the Vinewood Hills area is a single draw call of about 2,500 triangles at distance; distant street lights are batched into instanced geometry). Lesson: fill is cheap if it is instanced or merged and has a distance cut-off.
- Commentary that Los Santos has few parking lots and relies on street parking: https://www.southernurbanism.org/p/citybuilding-less-parking-more-living . This is opinion about the setting, not a technical source.
- three.js guidance: instancing collapses many draws to one but does not reduce vertex cost, and BatchedMesh merges different geometries that share one material into one draw call (added in r159). Forum summaries: https://discourse.threejs.org/t/best-way-to-reduce-draw-calls/25186 and https://discourse.threejs.org/t/bad-performance-when-loading-more-than-3500-meshes-into-the-scene/63960/4 . Reference docs: https://threejs.org/docs/pages/InstancedMesh.html and https://threejs.org/docs/pages/BatchedMesh.html . The repo already uses both (`street-cars.js` BatchedMesh, `park-life.js` InstancedMesh).

General practice (not from a single cited source):

- Fill a block with a small number of **stamps** (parking court, yard, plaza, construction site, pocket park), chosen per district, rather than scattering random props. A stamp is a few dozen placements with a fixed layout, so it reads as designed.
- Reuse one set of cheap props at many scales and rotations. Keep triangle counts of repeated items low.
- Keep a clear 6 m or so strip next to the road so fill never competes with the street.
- Distance-cull small fill, keep big silhouettes (trees, containers, trucks) longer.

Candidate asset packs checked:

| Pack | Licence | What I verified | URL |
|---|---|---|---|
| Kenney City Kit Roads 2.2 | CC0 | 90 files, includes construction fence, light, signs, dumpster (already partly in repo) | https://kenney.nl/assets/city-kit-roads |
| Kenney City Kit Industrial 2.0 | CC0 | 40 files (tags: city, building, factory, warehouse). Source of the containers and water tower already in the repo | https://kenney.nl/assets/city-kit-industrial |
| Kenney City Kit Commercial / Suburban | CC0 | Commercial has 50+ objects including awnings, building parts, signs; Suburban has about 40 incl. fences, trees, driveways (OpenGameArt listings) | https://opengameart.org/content/city-kit-commercial , https://opengameart.org/content/city-kit-suburban |
| Kenney Nature Kit 1.0 | CC0 | 330 files; tags confirm trees, rocks, foliage. I could not confirm bushes or hedges from the page, so check the download | https://kenney.nl/assets/nature-kit |
| Quaternius | not stated on the front page | The repo already ships the free Downtown City MegaKit and its bundled `Quaternius-LICENSE.txt` says CC0. For any other Quaternius pack, read that pack's own licence first | https://quaternius.com |
| Poly Haven models | CC0 per repo and https://polyhaven.com/license | The repo already credits it for trash can, utility box, trashbag, chair, shrub, potted plant, bench, picnic table. Category list includes Containers & Storage and Industrial & Infrastructure; I saw listing names such as Barrel_01 and portable_generator but did not open the pages | https://polyhaven.com/models |
| ambientCG materials | CC0 | Repo already uses Grass005 this way | https://docs.ambientcg.com/license/ |

---

## 6. What we already have in `dist/assets` (usable with no new download)

Triangle counts are measured from the GLBs. "Use" is where fill can reuse them.

| Asset | Tris | Licence | Where it is used today | Good for |
|---|---|---|---|---|
| `la-real/la-palm-coconut.glb` (10.5 m tall) | 940 | CC0 (Nobiax / OpenGameArt) | the main palm on roads and parks | road trees only, too heavy for hundreds |
| `tree-palm.glb`, `-palmtall`, `-palmshort`, `-palmbend` (Kenney Nature Kit) | 186-200 | CC0 | not used on the Coast (only `tree-palmdetailedtall` as fallback) | **cheap lot trees, 5 variants** |
| `tree-palmdetailedshort/tall.glb` | 336 | CC0 | fallback palm | mid-detail trees |
| `la-real/la-palm.glb` | **56,000** | see `la-real` provenance | City Street Study | **do not reuse for fill** |
| `park/shrub.glb` | 1,449 | CC0 (Poly Haven) | parks, 84 instances | few hedges only, heavy per piece |
| `park/pot.glb` | 6,809 | CC0 | parks | skip for bulk fill |
| `park/bench.glb`, `bench.glb` | 630 / 170 | CC0 | parks, edges | plaza seating |
| `park/picnic.glb` | 1,517 | CC0 | parks | backyard stamp, few |
| `planter.glb` | 204 | CC0 (Kenney) | block edges | plaza stamp |
| `dumpster.glb` | 234 | CC0 (Kenney) | block corners | yards |
| `la-industry-shipping-container-a.glb` | 402 (0.37 x 0.35 x 0.82 source units, runtime 8 m) | CC0 (Kenney) | 2 per Arts block | **container stacks** |
| `la-industry-water-tower.glb` | 968 | CC0 | 1 per Arts block | landmark, already used |
| `props/construction-fence.glb` | 136 | CC0 (Kenney) | street roadworks | **site hoarding** |
| `construction-cone.glb`, `construction-barrier.glb` | 66 / 60 | CC0 | one roadworks site at (165-177, 164-167) | works sites |
| `props/construction-light.glb`, `road-sign-warning.glb` | 144 / 104 | CC0 | street props | works sites |
| `props/electricity-pole-single.glb` | 176 | CC0 | outer roads | service yards |
| `props/metal-trash-can`, `utility-box-01`, `trashbag`, `plastic-monobloc-chair-01` | 700-1,200 | CC0 (Poly Haven) | street scatter | tiny accents only |
| `cars/sedan-sports, hatchback-sports, suv-luxury, van, truck, delivery, garbage-truck` | 2,082-3,124 | CC0 (Kenney Car Kit 3.1) | traffic and 250 kerbside parked cars | **parking courts and truck yards** |
| `rock-largea.glb` | 80 | CC0 | shoreline | gravel yard accent |
| `house` / `industry` Kenney kits (`la-house-*`, `la-industry-*`) | 1.2-2.0 k | CC0 | Palm Gardens, Arts | low-rise infill (phase 2) |
| `building-a..n` | 1.2-4.4 k | CC0 (Kenney Commercial) | all commercial lots | infill (phase 2) |
| `building-skyscraper-a..e` | n/a | CC0 | **present but not loaded** (the loader list stops at letter n, `game.js:154`) | taller landmarks |
| Surface materials `lawn`, `sidewalk`, `plaza`, `sand`, `asphalt` | textures | CC0 | already shared materials | flush ground patches at no new draw cost |

Not usable as-is: `~/Downloads/city_buildings_-_blackthornprod_video.glb` is the source of `la-tower-*` (CC BY 4.0, Tiko, already credited). It needs no separate treatment.

New assets that would raise quality (all optional, none required for phase 1):

1. A few round-crown deciduous trees and low bushes. Kenney Nature Kit (CC0, https://kenney.nl/assets/nature-kit) is the natural source. Verify that the downloaded kit contains what we need, because the page only lists tree, rock and foliage tags.
2. A chain-link or low wall fence. Kenney City Kit Suburban lists fences (https://opengameart.org/content/city-kit-suburban).
3. Barrels, pallets, a generator for yards. Poly Haven (CC0, https://polyhaven.com/models). Check the poly count first (the existing Poly Haven props were 700-6,800 triangles; we simplified them).
4. A gravel or dirt ground texture for yards and construction sites. ambientCG (CC0).

Always add each new file to `dist/CREDITS.md` and a `*-source.json` with the hash, as the repo already does.

---

## 7. Options, ranked by visual gain per cost

Costs below are estimates, not measurements. They should be verified with `render-metrics.js` and the `writeTelemetry()` fields (`activeColliders`) at the Medium preset before and after.

### Option 1. District-themed lot kits ("stamps") - RECOMMENDED

What goes in each plot, chosen by district and by free space around the existing building:

- Downtown and Sunset Mile: a plaza patch (existing `plaza` material), planter rows, benches, a palm grid, and a surface parking court with 6-8 parked cars and painted bays on about 40 % of lots.
- Arts & Warehouse: container stacks (2 high, 4-8 containers), a fenced service yard with a truck or delivery van, dumpsters, a few barrels.
- Palm Gardens (houses): lawn with 3-5 palms, a driveway with a parked car, a low fence line, picnic table in a few back yards.
- Pacific Boardwalk: sand and rock patches, palm clusters, benches, a beach parking strip.
- Dropped lots beside the Sunset diagonal (12 lots): pocket plazas or construction sites.
- Construction site stamp on about 8 % of lots: construction fence ring, cones, a light, a barrier, a container.

| Item | Detail |
|---|---|
| Assets | all already in the repo (section 6). New CC0 trees/fences/barrels optional later |
| Licence | CC0 for everything listed, plus CC0 (Nobiax) coconut palm already credited |
| Draw calls | +3 to +6 in total. One `BatchedMesh` per material: Car Kit colormap, Industry palette, Roads colormap, palm leaf and trunk. Flush ground patches go through the existing `batchMesh` on existing materials, so +0. A gravel texture would add one material, at most one extra draw per visible 220 m cell |
| Triangles (estimate) | about 0.4 M added across the Coast, of which roughly 15-20 % visible at a time. About 650 palms at 190 tris, about 200 parked cars at about 2,100 tris, about 220 containers at 402, fence runs at 136 per section |
| Collision impact | about 900 static boxes: trunk boxes (about 4 per lot, 0.6 m), one box per parked row or container stack, one per fence run. That is about 1 % of the 86,800 building fixtures. No compound colliders |
| Risk to physics/traffic | low. Traffic loops run on road lanes (`roundedRoute`, lane offset 4.3 m, `game.js:168`) and never enter lots. Colliders use `kind:'lot-fill'` |
| Risk to spawn and camera | spawn at (-445.7, 110) is on the perimeter road. All destinations are on roads except Garden Park, which is a park block (excluded). Camera only reacts to `kind:'building'`, so nothing here moves it. Keep items over 3 m tall at least 10 m from any kerb so the chase camera still sees the car |
| Gain | high: every lot changes, in all five districts |
| Cost | medium: one new pure planner, one renderer, two one-line hooks |

### Option 2. Parking courts only

Only rows of parked cars with painted bays on commercial and industrial lots, using the existing parked-car pipeline.

| Item | Detail |
|---|---|
| Assets | `cars/*` (CC0, in repo), white bay marks via the existing flush-mark approach |
| Draw calls | +0 to +1 (extend the existing `ParkedCars` BatchedMesh) |
| Triangles | about 2,100 per car. Cap lot cars at about 120-200 and use distance culling (about 260 m) because the kerbside cars already use 250 |
| Collisions | one box per row. Do not create shove-able bodies for lot cars (kerbside cars already make 250 sleeping dynamic bodies) |
| Risk | very low. `planParkedCars` already supports `extraAvoid`, and the kerb avoid list shows the exclusion pattern to copy |
| Gain | medium: strong in Downtown and Arts, nothing in the residential and beach districts |
| Cost | lowest. Good first milestone and it is a subset of Option 1 |

### Option 3. Pocket parks and green lots

Turn about one lot in three (plus the 12 dropped lots) into a small park with trees, paths, benches, using the `ParkLife` / `layoutParkProps` approach.

| Item | Detail |
|---|---|
| Assets | Poly Haven park models in repo (bench, picnic, pot, shrub), Kenney palms |
| Draw calls | +0 to +2 (instanced per park, hidden beyond 145 m by `ParkLife.update`) |
| Triangles | shrubs are 1,449 tris and pots 6,809, so keep the counts low or add cheaper CC0 bushes |
| Collisions | a few trunk boxes and benches per park |
| Risk | low, but parks are drivable lawn with tyre marks and reduced grip (`INTERACTIVE_WORLD_RESEARCH.md`). More parks means more places where a car can leave the road. Do not mix this into the 3 existing parks |
| Gain | medium and only "green"; it does not make the city denser |
| Cost | low to medium |

### Option 4. Infill buildings

Add a second and third low-rise building (houses, warehouses, small commercial) in the leftover space of each lot.

| Item | Detail |
|---|---|
| Assets | existing Kenney house, industry and commercial kits (CC0) |
| Draw calls | +0 (same palette materials and `cityMaterial`) |
| Triangles | 1.2-4.4 k per building, the heaviest option; 150-300 extra buildings would add 0.3-1.0 M |
| Collisions | **the problem.** A normal building gets about 540 fixtures (`addBuildingColliders`). 200 more would add about 108,000 fixtures, +125 % on the Coast. Only workable with a single box per infill building (baseOnly style) |
| Risk | highest. Extra `kind:'building'` boxes lengthen the camera box list and trigger overhead fallbacks in narrow gaps. They also change spawn-clear checks, pedestrian spawn blockers, and the `placementErrors` check in `world.js:158` |
| Gain | highest for a dense city look |
| Cost | high. Treat as a phase 2 only if the user wants a dense look after seeing Option 1 |

Ranking by gain per cost: **1 (lot kits) first, 2 (parking only) is the safest slice of it, 3 (pocket parks) is a cheap add-on, 4 (infill) last.**

---

## 8. Recommended option and build plan

Recommended: **Option 1, delivered in the slices below, Coast first.** Estimated effort: 2-3 working days including tests and a visual pass.

1. **Extract lot geometry into a shared pure module** (`dist/lot-layout.js`, new). It returns, for a given map, every lot rectangle (centre, size, district, ground type, the building bounds placed there, whether it was dropped by the diagonal). Both `world.js` and `world-default.js` already compute exactly these values inline; this step only exposes them (the worlds return the list as `world.lots`). Add `tests/lot-layout.test.mjs` that locks the measured numbers from section 3 (172 / 160 lots, 12 dropped, empty-area ratio within a range) so the test is also the regression guard. Touching the world files is one return-value line in each, so it can be done after the other agent's work lands.
2. **Write a pure stamp planner** (`dist/lot-stamps.js`, new) with five stamps (parking court, container yard, construction site, plaza/garden, yard/residential). Input: lots, building bounds, exclusion list, its own `seeded()` generator. Output: items `{asset, x, z, rot, scale}` plus merged collider boxes. Exclusion rules are in section 9; each rule gets a test, in the style of `tests/street-cars.test.mjs` and `tests/street-props.test.mjs`. Keep every item at least 2 m inside the interior patch (lots currently reach the patch edge in z) and at least 3 m from the building bounds so there is a fire-lane gap.
3. **Write the renderer** (`dist/lot-fill.js`, new), copying the BatchedMesh pattern from `street-cars.js`: one BatchedMesh per material, per-instance frustum culling, distance culling every 12 frames (about 260 m for cars, 350 m for trees and containers), `castShadow` only for cars and containers. Ground patches (asphalt, plaza, gravel) go through the world's existing flush-surface path with existing materials. Register collider boxes with `physics.addBox({userData:{kind:'lot-fill'}})` and push `{box, actor}` into `world.obstacles`.
4. **Wire the Coast.** Add the extra model names to the `names` list in `game.js:154` (cars and Kenney palms are already in `assets`, only the load list changes), call `buildLotFill({scene, physics, models, map, world})` next to `buildStreetCars` at `game.js:171`. Do not add anything to the shared `random`.
5. **Test and measure.** Node tests for the planner and exclusions. Browser QA on the five districts: draw calls, triangles and `activeColliders` before and after at Medium preset; confirm spawn, ride swap, the six destinations, packages, drift zones, boost pads, ramps and the chase camera still behave. Drive a straight line across each district at speed. Tune counts down if the frame time budget in `OPTIMIZATION_RESEARCH.md` or the Medium preset is exceeded.
6. **Roll out to Solana Bay and decide on phase 2.** Bay has no districts, so use a mixed profile and a 50 m lot. Then decide whether to add new CC0 trees/fences (section 6) or the infill buildings of Option 4. City Street Study needs only a small margin kit, or nothing, since most of its empty area is hidden.

Rough target after phase 1 on the Coast: about 35 % of the 45 ha empty ground dressed (about 16 ha), parked cars about 200, trees about 650, container and yard stacks about 40, construction sites about 14.

---

## 9. What must NOT be placed

Taken from the layout code. Use these as test cases.

| Zone | Rule | Source |
|---|---|---|
| Roads | Never inside any road band. Half-width 12 m, 17 m for the wide road x = 0 and z = -300 on the Coast. Roads at x = +-450, +-300, +-150, 0 and z = +-600, +-450, +-300, +-150, 0 | `world.js:12,52-53` |
| Sidewalk band | Keep fill at least 6 m from the asphalt edge. The sidewalk is 5-6 m; street scatter (hydrants, bins, news boxes, works pits) sits 1.5-3.6 m beyond the kerb; pedestrian lanes are 1.85 m inside the kerb | `street-props.js:layoutStreetProps`, `pedestrian-sim.js:46-90` |
| Traffic routes | Three concentric rounded rectangles on road lanes (x = +-445.7 and so on). Lots are inside them, but never extend a stamp (fence, truck, cone) across a kerb | `game.js:168`, `traffic.js:3` |
| Kerbside parked cars | They sit on the road edge. Do not duplicate them | `street-cars.js:kerbLayout` |
| Sunset Mile diagonal (Coast) | Keep out of `sunsetDistance < 13 + 5 + margin + half lot diagonal`, the same test `clearOfSunset` uses. The 12 dropped lots are safe for pocket plazas only if their centre passes a 13 + 5 + 8 m check | `map-layout.js:clearOfSunset` |
| Stunt park | Whole reserved rectangle x -438..-312, z 312..588 plus a 6 m margin. Contains 5 ramps, boost pads and runway paint | `stunts.js`, `street-cars.js` (6 m), `street-props.js` (4 m) |
| Perimeter and ramps | Road ramp `roadspin` removed to keep traffic clear; boost pads at (-445.7, -75), (445.7, 75), (-355, 522), (-375, 566): keep 16 m clear | `boost-pads.js`, `street-cars.js:avoid` |
| Spawn corridor and destinations | Spawn (-445.7, 110) heading 0 on the perimeter road, plus all `DESTINATIONS` (Pacific Boardwalk, Sunset Mile, Downtown, Garden Park, Palm Gardens, Arts). Keep 30 m clear, like the parked-car planner | `map-layout.js`, `street-cars.js` |
| The 3 park blocks | (i1,j4), (i4,j2), (i2,j6), centred (-225, 75), (225, -225), (-75, 525). They have their own props, 7 m paths and shrubs; add nothing | `world.js:93-94`, `park-life.js` |
| Drift zones | `nw` x -466..-360, z -616..-520; `ne` x 360..466, z -616..-520; `se` x 360..466, z 520..616. They overlap corner lots, so no new colliders there | `activities.js:GRID_ZONES` |
| Hidden packages | Keep 8 m clear of every `pkg(...)` position. `blockedAt` nudges packages away from any obstacle within 2 m and may fail to find a free spot | `activities.js`, `open-world.js:101` |
| Existing roadworks | Cones and barriers at x 165-177, z 163-167: keep 12 m clear | `world.js:114`, `street-cars.js:avoid` |
| Perimeter promenade, beach, shore rocks, boundary walls | Outside the blocks. Do not extend fill past x = +-463 or z = +-663 | `world.js:110,145` |
| Colliders | No `kind:'building'` for fill. No compound colliders. No interactive-prop names (planter, bench, dumpster, cone, barrier and so on) for bulk fill | `game.js:368`, `world.js:40` |
| Tall objects | Nothing taller than about 3 m within 10 m of a kerb, so the chase camera never loses the car at junctions | `camera-aim.js` constants |
| Random numbers | Never call the shared `random()` | `world.js:46`, `game.js:74` |
| Heavy assets | Do not use `la-real/la-palm.glb` (56,000 tris), `park/pot.glb` (6,809) or `park/shrub.glb` (1,449) in bulk | measured |

---

## 10. Questions for the user before building

1. **Which map first?** I suggest Solana Coast, because it is the default menu map and has the most district variety. The same planner then covers Bay. City Street Study gains little (most of its empty area is hidden behind the facades).
2. **Dense city look or green parks?** Option 1 gives a mixed built-up look with parking, yards and plazas. If you want a really dense downtown, Option 4 (infill buildings) is needed and costs far more collision budget.
3. **New CC0 assets or repo-only?** Phase 1 works with what is in the repo. New Kenney Nature Kit trees, a fence kit and Poly Haven barrels would make the lots look better but need downloading, a provenance record and a CREDITS entry.
4. **How many parked cars is acceptable?** The default of about 200 lot cars on top of 250 kerbside cars is the biggest triangle cost (about 2,100 tris each). If lower-end machines matter, drop it to about 120.
5. **Does "LA" mean the City Street Study, or the unshipped 2.4 km Solana LA?** The latter is not wired into the game and would need its own plan.

---

## 11. Sources

- https://adriancourreges.com/blog/2015/11/02/gta-v-graphics-study-part-2
- https://www.southernurbanism.org/p/citybuilding-less-parking-more-living
- https://discourse.threejs.org/t/best-way-to-reduce-draw-calls/25186
- https://discourse.threejs.org/t/bad-performance-when-loading-more-than-3500-meshes-into-the-scene/63960/4
- https://threejs.org/docs/pages/InstancedMesh.html
- https://threejs.org/docs/pages/BatchedMesh.html
- https://kenney.nl/assets/city-kit-roads
- https://kenney.nl/assets/city-kit-industrial
- https://kenney.nl/assets/nature-kit
- https://opengameart.org/content/city-kit-commercial
- https://opengameart.org/content/city-kit-suburban
- https://quaternius.com
- https://polyhaven.com/models and https://polyhaven.com/license
- https://docs.ambientcg.com/license/

## 12. Coast implementation (2026-10-23)

This pass implements Coast only. Bay and City Street Study remain unchanged. `world-la.js` remains unshipped.

- `world.js` now exposes all 172 Coast lot rectangles, including the 12 dropped by the diagonal, with actual placed building bounds. The existing shared building RNG is unchanged.
- `lot-fill.js` uses an independent deterministic seed, real building bounds and existing obstacles to place low-cost greenery, seating/yard accents and parking courts. Placement checks preserve 3 m building clearance, sidewalks, internal drives, parks, drift zones, hidden packages, destinations, boost-pad approaches and the entire stunt area.
- Existing `StreetProps` instances render the added palms and accents. Palm trunks resist small bumps and break away on stronger hits. Benches/planters/dumpsters slide; lightweight items topple using the existing bounded debris pool. Palms cull at 280 m; small items retain the existing 120 m radius. No dense grass or custom foliage shader was restored.
- Exactly 65 lot cars extend the existing `StreetCars` batch, using the existing repository models, paints and sleeping shoveable bodies. Each car has its own collider rather than one invisible box around a row. Parking surfaces and paint merge into the existing ground batches.
- The live game seed produced **411 added palms, 228 interactive accents, 65 lot cars and one container**. The existing kerb planner's 250 figure is a cap: this seed produced 193 kerb cars, for **258 total parked cars**. Counts differ in constant-seed test fixtures; unsafe placements are omitted.
- No new assets were needed. Existing CC0 Kenney assets and existing prop attributions remain in `CREDITS.md`.

Validation: automated planner/exclusion checks, actual downloaded-palm breakaway test, parked-car batch/physics test, full game suite (412 tests), five district browser driving checks with no console errors, and successful Electron smoke check. Medium-preset browser samples at a 1920 px canvas were near 16.5 ms median; transition samples included 17–25 ms p95. This is not a guarantee of 60 FPS on every device, and no screenshots were captured.
