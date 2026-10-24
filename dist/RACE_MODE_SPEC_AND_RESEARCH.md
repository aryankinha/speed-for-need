# RACE MODE SPECIFICATION AND IN-DEPTH TECHNICAL RESEARCH
## AFTERLIGHT / SPEED FOR NEED — Multi-Car AI Racing System (REVISION 2 - HARDENED)

---

## PART I: AUTONOMOUS AGENT IMPLEMENTATION PROMPT

> **Instructions for the Implementation Agent:**
> Copy the complete prompt block below directly to instruct an autonomous coding agent to build the multi-car Race Mode in the `roadster-game` codebase. All constraints, exact mathematical formulas, inlined waypoint coordinates, opponent instantiation patterns, and file contracts are specified in full detail.

```markdown
# TASK: Implement Multi-Car Race Mode in AFTERLIGHT (SPEED FOR NEED)

## 1. OBJECTIVE
Transform the current single-car sprint checkpoint system into a full **Race Mode** where the player races against the other 4 playable cars from the garage (instantiated as dynamic AI opponents) on a dedicated closed-loop circuit track, featuring real-time leaderboard positions (1st–5th), lap counting, checkpoint gates, tactical boost pads/nitro pickups, drafting slipstream physics, Box2D car-to-car collision resolution with sparks and audio crunches, an unstuck recovery machine, and an authentic racing HUD.

---

## 2. STRICT CONSTRAINTS & CODEBASE RULES
1. **Zero Guesses / Investigate First:** Read existing files before editing (`dist/vehicles.js`, `dist/physics.js`, `dist/traffic.js`, `dist/nitro.js`, `dist/boost-pads.js`, `dist/game.js`, `dist/audio.js`).
2. **Zero GC Churn in 120 Hz Loop:** No object allocations (`new THREE.Vector3()`, `{...}`, or closure callbacks) inside `step()`, `update()`, or collision listeners. Reuse preallocated scratch vectors and typed arrays.
3. **Box2D Physical Parity:** AI opponent vehicles must use `physics.addVehicle` with their actual garage tuning specs (`mass`, `wheelbase`, `maxSpeed`, `boostSpeed`, `acceleration`, `grip`, `steerAngle` from `VEHICLES` in `dist/vehicles.js`). They must NOT be kinematic rail-followers or teleport. They must respond to collisions, boost pads, and grip limits under Planck.js physics.
4. **Deterministic Car Pool:** When the player selects vehicle ID `chosen` (e.g., `'roadster'`), the 4 opponents are deterministically the remaining cars in `VEHICLES`: `VEHICLES.filter(v => v.id !== chosen)`.
5. **No Regressions:** Preserve the existing 452 automated unit tests (`npm test`). Do not break free-roam open world, stunt ramps, showroom, or garage functionality.
6. **YAGNI / Minimal Diff:** Create modular additions (`dist/race-mode.js`, `dist/race-hud.js`, `dist/sparks.js`) and wire clean lifecycle hooks into `game.js`.

---

## 3. INLINED CIRCUIT WAYPOINTS (SOLANA RACEWAY // CORKSCREW TRIBUTE)
To eliminate guesswork and avoid external network dependencies during execution, use these verified 25 Cartesian waypoint coordinates for the procedural circuit centerline spline:

```javascript
export const CIRCUIT_WAYPOINTS = Object.freeze([
  { x: 0, z: -150 }, { x: 50, z: -160 }, { x: 120, z: -140 }, { x: 170, z: -90 },   // Turn 1 & 2 (Andretti Hairpin)
  { x: 190, z: -20 }, { x: 170, z: 60 }, { x: 130, z: 120 }, { x: 90, z: 160 },     // Turn 3 & 4
  { x: 40, z: 180 }, { x: -20, z: 200 }, { x: -90, z: 230 }, { x: -160, z: 250 },   // Rahal Straight
  { x: -220, z: 220 }, { x: -250, z: 160 }, { x: -240, z: 100 },                    // Turn 6
  { x: -200, z: 40 }, { x: -170, z: -10 },                                            // Approach to Corkscrew
  { x: -175, z: -45 }, { x: -195, z: -65 },                                           // Turn 8 & 8A (The Corkscrew)
  { x: -210, z: -110 }, { x: -190, z: -160 },                                         // Turn 9 (Rainey Curve)
  { x: -140, z: -190 }, { x: -80, z: -200 },                                          // Turn 10
  { x: -30, z: -180 }, { x: -10, z: -155 }                                            // Turn 11 & Main Straight Gantry
]);
```

---

## 4. DETAILED IMPLEMENTATION MILESTONES

### Milestone 1: Multi-Car Opponent Grid & Physics Instantiation
- In `dist/race-mode.js` (new module):
  - On race start, retrieve the 4 opponent vehicle definitions and instantiate them:
    ```javascript
    const opponents = VEHICLES.filter(v => v.id !== playerCarId);
    const opponentActors = opponents.map((def, i) => {
      const refRide = rides[def.id];
      const visualGroup = refRide.group.clone(true);
      visualGroup.visible = true;
      scene.add(visualGroup);

      // Staggered starting grid: 12m spacing behind pole, alternating lateral lanes
      const gridOffset = (i + 1) * 12;
      const gridPos = spline.sampleAtDistance(trackLength - gridOffset);
      const laneOffset = (i % 2 === 0) ? 2.5 : -2.5;

      const actor = physics.addVehicle({
        x: gridPos.x + laneOffset * -Math.sin(gridPos.heading),
        z: gridPos.z + laneOffset * Math.cos(gridPos.heading),
        heading: gridPos.heading,
        width: refRide.size.x,
        length: refRide.size.z,
        height: refRide.size.y,
        ...def.tuning,
        userData: { kind: 'opponent', id: def.id, index: i }
      });

      // Register into RenderState using unique offset slots
      renderState.setActor(traffic.length + 1 + i, actor);

      return {
        def,
        actor,
        mesh: visualGroup,
        nitro: { tank: 40, gate: { boosting: false, locked: false } },
        progress: trackLength - gridOffset,
        lap: 0,
        stuckTimer: 0
      };
    });
    ```
  - Teleport the player car to pole position via `playerActor.setPose(...)` and align heading with the start gantry.

### Milestone 2: Circuit Track Selection, Roadway Extrusion & Colliders
- Build the procedural ribbon track:
  - Generate a closed `THREE.CatmullRomCurve3` spline from `CIRCUIT_WAYPOINTS` with `curveType: 'centripetal'`.
  - Extrude a roadbed vertex ribbon with asphalt surface, red/white rumble kerbs, and concrete barrier walls.
  - Generate Box2D wall colliders via `physics.addBox` connecting adjacent spline barrier boundary segments.
  - **Ghost-vertex snag mitigation:** Overlap adjacent static barrier box segments longitudinally by $0.15\text{ m}$ to prevent high-speed vehicles from catching internal seams while scraping walls.

### Milestone 3: Boosters & Nitro Placements
- Position `BOOST_PADS` (`dist/boost-pads.js`) along circuit straights and corner exits to reward clean driving:
  - Pad 1: Main Straight exit ($x: 50, z: -160$).
  - Pad 2: Rahal Straight midpoint ($x: -90, z: 230$).
  - Pad 3: Corkscrew drop exit ($x: -210, z: -110$).
- Distribute `NitroEffects` pickup bottles (`dist/nitro.js`) along the optimal racing line.
- Equip opponent AI with nitro tanks governed by the same `NITRO_MAX=100`, `NITRO_DRAIN=14`, `NITRO_REGEN=4` rules as the player.

### Milestone 4: Opponent AI Driving Brain & Racing Intelligence
- In `dist/race-mode.js`:
  - **Spline Racing Line Tracking:** Evaluate target progress $s$, tangent $(\Delta x, \Delta z)$, and curvature $\kappa(s)$ along the track spline with zero GC allocation.
  - **Curvature-Governed Braking:** Compute target cornering speed $v_{\text{target}} = \sqrt{a_{\text{lat}}^{\max} / (\kappa + 1e-4)}$. Calculate braking points ahead of turns: brake when $d_{\text{turn}} \le (v^2 - v_{\text{target}}^2) / (2 \cdot a_{\text{brake}})$.
  - **Lookahead Steering Actuation:** Look ahead by $L = \text{clamp}(v \cdot 0.35, 4.0, 16.0)\text{ m}$. Compute heading error $e_h = \text{wrap}(\text{targetHeading} - \text{currentHeading})$. Compute `steer = clamp(e_h * 2.8, -1.0, 1.0)`.
  - **Actuator Parity:** Feed controls into the Planck physics solver via `actor.setControls({ steer, throttle, brake, boost, handbrake })`. Do NOT apply raw torques directly to bodies; let `physics.js` calculate bicycle yaw kinematics and lateral tire grip.
  - **Unstuck & Spin Recovery Machine:**
    ```javascript
    const isReverseStuck = Math.abs(e_h) > Math.PI * 0.65 || (actor.speed < 1.2 && controls.throttle > 0.8 && opponent.stuckTimer > 1.2);
    if (isReverseStuck) {
      opponent.stuckTimer += dt;
      controls.throttle = 0;
      controls.reverse = 1.0;
      controls.steer = Math.sign(e_h) * -1.0;
      if (opponent.stuckTimer > 2.2) opponent.stuckTimer = 0; // resume forward attempt
    } else {
      opponent.stuckTimer = 0;
      // Normal forward racing controls
    }
    ```
  - **Drafting & Slipstream:** If an AI car is within $25\text{m}$ behind another car (lateral offset $< 2.2\text{m}$), apply aerodynamic drag reduction ($\eta_{\text{drag}} = 0.65$) to simulate the slipstream vacuum pull.
  - **Tactical Nitro:** Fire nitro when exiting slow corners onto long straights or when drafting an opponent to complete an overtake.
  - **Dynamic Rubberbanding:** Modulate AI throttle aggression by $\pm 8\%$ based on spline progress gap relative to the player, with a hard breakaway threshold at $+250\text{m}$ ($> 5\text{s}$ lead) so master players can cleanly lap the field.

### Milestone 5: Dynamic Car-to-Car Collision Resolution & VFX
- In `physics.js` / `game.js`:
  - Box2D dynamic-to-dynamic collisions between player and opponents resolve naturally through `rawWorld.on('post-solve')`.
  - On collision impact:
    - Trigger `audio.onImpact(impact.speed)` for automotive metal-on-metal crunch and engine audio ducking (including opponent-to-opponent impacts within $30\text{ m}$ of the player).
    - Emit visual sparks via `SparksParticleEmitter` (reusing a preallocated `Float32Array` GPU BufferGeometry) at the contact point $(x, z)$.
    - Trigger camera rumble: `impactShake = Math.min(0.2, impact.speed * 0.012)`.

### Milestone 6: Race HUD, Starting Sequence & State Machine
- Build a lightweight, high-performance racing HUD:
  - **Starting Sequence:** 3-2-1-GO traffic light overlay on screen. Controls locked during countdown, engine revving audio enabled.
  - **Leaderboard Dock:** Clean, semi-transparent top-left HUD showing positions 1st through 5th with vehicle names, driver badges, and live split gap ($+1.2\text{s}$, $-0.8\text{s}$).
  - **Lap Counter & Checkpoints:** Display "LAP 1 / 3", current lap timer, best lap timer, and 3D floating checkpoint gates across the track.
  - **Finish Line & Results:** Checkered flag animation, final standings podium (1st–5th), total race time, fastest lap badge, and "Restart" / "Return to Free Roam" buttons.
  - **Lifecycle Teardown:** Exiting race mode cleanly destroys opponent Box2D bodies and removes visual meshes from `scene`.

---

## 5. ACCEPTANCE CRITERIA
1. `npm run check` and `npm test` pass with 0 syntax or test errors (all 452 existing tests green).
2. Opponent pool contains the 4 unselected garage cars running real Box2D physics with garage tuning specs.
3. Opponents navigate the circuit, brake for turns, recover from spins via unstuck machine, use nitro, overtake, and draft.
4. Car-to-car impacts deflect realistically, emit sparks, play crash audio, and rumble the camera.
5. Leaderboard correctly updates in real time based on total track spline progress ($P = \text{lap} \cdot \text{length} + s$).
```

---

## PART II: IN-DEPTH TECHNICAL RESEARCH & FEASIBILITY REPORT

### 1. INTERNET SURVEY: FAMOUS RACING TRACKS & OPEN-SOURCE ASSETS

To avoid guesswork and respect open-source licensing (CC0, CC-BY, MIT, Public Domain), we conducted an exhaustive investigation across GitHub, Sketchfab, OpenGameArt, Kenney.nl, and motorsport simulation repositories.

#### Option A: Mazda Raceway Laguna Seca (USA) — The Legendary Corkscrew (PRIMARY RECOMMENDATION)
- **Key Characteristics:** 3.602 km (2.238 mi), 11 turns, iconic Turn 8 & 8A "Corkscrew" with an 18-meter (5.5-story) drop over 137 meters of track length.
- **Why It Fits AFTERLIGHT:** California coast/desert aesthetic matches the existing Pacific Coast Highway / Solana Bay visual identity perfectly.
- **Available Open-Source 3D Models & Splines:**
  1. *Sketchfab Model:* `"laguna seca"` by `amogusstrikesback2` (downloadable, clean asphalt surface, elevation changes, low-poly background hills).
  2. *Sketchfab Model:* `"Cartoon Track Laguna Seca"` by `rccdesign` (low-poly stylized circuit matching Kenney aesthetic, < 45k triangles).
  3. *Spline Centerline Data:* GPS latitude/longitude and elevation profile points available via open GPX/GeoJSON track archives (Turn 1 through Turn 11).
- **Technical Specs for WebGL:**
  - Geometry: 38,000–55,000 triangles.
  - Materials: 3 (Asphalt PBR, Kerb Red/White strip, Sand/Grass runoff).
  - VRAM Footprint: ~12 MB.

#### Option B: Circuit de Monaco (Monte Carlo) — Ultimate Street Grand Prix
- **Key Characteristics:** 3.337 km (2.074 mi), 19 turns. World's most famous street circuit featuring Sainte-Dévote, Beau Rivage, Massenet, Casino Square, Mirabeau, Grand Hotel Hairpin (slowest turn in motorsport at 48 km/h), Tunnel, Nouvelle Chicane, Tabac, and Piscine (Swimming Pool).
- **Why It Fits AFTERLIGHT:** Matches the high-density urban skyscraper architecture and waterfront marina environment of AFTERLIGHT's Downtown and Coastal districts.
- **Available Open-Source 3D Models & Splines:**
  1. *GitHub Dataset:* `bacinger/f1-circuits` (`circuits/monaco.geojson`): High-precision GeoJSON vector spline containing complete modern and historic Monaco street coordinates.
  2. *Speed Dreams / TORCS Archive:* Open-source community Monaco street track (`monaco.ac` / XML track profile), GPLv2 licensed.
  3. *Sketchfab Assets:* Low-poly modular street racing tracks featuring Monaco-inspired hairpins and tunnel sections.
- **Technical Specs for WebGL:**
  - Spline Nodes: 180 control points along centerline.
  - Street Width: 9.0–12.5 meters.
  - Wall Colliders: Continuous Armco barrier polygon chains along both track boundaries.

#### Option C: Suzuka International Racing Course (Japan) — The High-Speed Figure-8
- **Key Characteristics:** 5.807 km (3.608 mi), 18 turns. Unique figure-8 layout with an overpass bridge, challenging S-Curves, Degner Curves, Spoon Curve, and the flat-out 130R.
- **Available Open-Source 3D Models & Splines:**
  1. *GitHub Mirror:* `kilo/speed-dreams-tracks` (`suzuka` branch): Open-source Suzuka track mesh and AI racing line data (`track.xml`).
  2. *GitHub Dataset:* `bacinger/f1-circuits` (`circuits/suzuka.geojson`).
  3. *Sketchfab:* High-speed Grand Prix layouts by `@Tyler_Dave` (Dave Love).
- **Integration Note:** The figure-8 crossover requires multi-layer height elevation collision filtering, which our `physics.js` already supports via `pairAtHeight` and `groundLayer`!

#### Option D: Silverstone Circuit (UK) — High-Downforce Flow
- **Key Characteristics:** 5.891 km (3.660 mi), 18 turns. Ultra-high-speed sweeping transitions (Copse, Maggotts, Becketts, Chapel, Stowe).
- **Available Assets:** Sketchfab `@Tyler_Dave` Silverstone 2024 layout, `bacinger/f1-circuits` GeoJSON.

#### Option E: Kenney Racing Kit (CC0 1.0 Universal — Public Domain)
- **Source:** [Kenney Racing Kit](https://kenney.nl/assets/racing-kit) / OpenGameArt.
- **License:** CC0 (100% free for commercial use, no attribution required, public domain).
- **Contents:** Over 100 modular track sections (straights, 45°/90° curves, chicanes, split lanes, banked curves, bridges, start/finish line gantries, pit stops, grandstands, tire walls, red/white rumble kerbs, banners, traffic cones).
- **Asset Formats:** Native glTF / GLB, OBJ, FBX with shared low-poly palette textures.
- **Why It's Ideal:** Matches the exact low-poly aesthetic of AFTERLIGHT's existing Kenney City Kit (`models['road-straight']`, `models['tree-palmdetailedtall']`, etc.), allowing arbitrary circuit construction with zero licensing risk.

---

### 2. ROADWAY REPRESENTATION & COLLISION GEOMETRY

To render and simulate the circuit at 120 FPS in WebGL and 120 Hz in Planck.js, we evaluated two architectural approaches:

```
  APPROACH 1: PROCEDURAL SPLINE RIBBON (RECOMMENDED)
  ──────────────────────────────────────────────────
  CatmullRomCurve3 Centerline ──► Cross-Section Extrusion ──► Three.js BufferGeometry
                                       │
                                       ├─► Box2D Outer Barrier Edge Chain (with 0.15m overlap)
                                       ├─► Box2D Inner Barrier Edge Chain (with 0.15m overlap)
                                       └─► AI Target Arc-Length Parameterization

  APPROACH 2: MONOLITHIC IMPORTED GLB MESH
  ────────────────────────────────────────
  Pre-baked Track GLB ──► Static Visual Mesh ──► Mesh Raycasting (Slow, Non-Deterministic)
                                       │
                                       └─► Manual Convex Hull Colliders (High Maintenance)
```

#### The Procedural Spline Ribbon Engine (Method 1)
1. **Centerline Spline:** Define a closed parametric curve $\mathbf{C}(s) = (x(s), y(s), z(s))$ using `THREE.CatmullRomCurve3` with `curveType: 'centripetal'` to eliminate self-intersecting loops.
2. **Roadbed Mesh Generation:**
   - Sample $N$ slices along the spline (e.g., $N = 350$).
   - At each slice $i$, compute forward tangent $\mathbf{T}_i$, upward normal $\mathbf{N}_i$, and lateral binormal $\mathbf{B}_i = \mathbf{T}_i \times \mathbf{N}_i$.
   - Extrude a cross-sectional vertex ribbon:
     - Outer Barrier: $(-W/2 - 0.4, +0.9)$
     - Outer Kerb: $(-W/2, +0.08)$
     - Asphalt Surface: $(-W/2 \text{ to } +W/2, 0.0)$
     - Inner Kerb: $(+W/2, +0.08)$
     - Inner Barrier: $(+W/2 + 0.4, +0.9)$
   - Total vertex count for a 3.5 km circuit: $\approx 5,600$ vertices, 1 draw call, zero runtime CPU cost.
3. **Planck.js Box2D Collision Boundaries:**
   - Generate two continuous 2D polygon barrier loops:
     - Left wall: $\mathbf{P}_{\text{left}}(i) = \mathbf{C}(s_i) - \mathbf{B}_i \cdot (W/2 + 0.3)$
     - Right wall: $\mathbf{P}_{\text{right}}(i) = \mathbf{C}(s_i) + \mathbf{B}_i \cdot (W/2 + 0.3)$
   - Add static barrier bodies via `physics.addBox` connecting adjacent segments $(\mathbf{P}_i, \mathbf{P}_{i+1})$.
   - **Internal Vertex Seam Snagging Prevention:** Overlap adjacent barrier boxes longitudinally by $0.15\text{ m}$ to prevent Box2D ghost vertex catches when sliding against walls at high speed.
   - Cars colliding with barriers bounce back onto the asphalt with realistic restitution ($e = 0.12$) and friction ($\mu = 0.25$).

---

### 3. OPPONENT CAR POOL & BALANCED SPECIFICATIONS

In AFTERLIGHT, there are exactly 5 playable cars configured in `dist/vehicles.js`. When the player drives car $X$, the remaining 4 cars form the starting grid:

| Vehicle ID | Car Model | Category | Mass | Wheelbase | Max Speed | Boost Speed | Accel | Grip | Steer Angle | Opponent AI Personality |
|---|---|---|---|---|---|---|---|---|---|---|
| `concept` | Concept GT | Touring | 1450 kg | 2.7 m | 48 m/s (173 km/h) | 61 m/s (220 km/h) | 8.2 | 22.0 | 0.62 rad | Balanced, consistent line, disciplined braking |
| `roadster` | Tesla Roadster | Electric AWD | 1700 kg | 2.7 m | 51 m/s (184 km/h) | 65 m/s (234 km/h) | 8.2 | 22.0 | 0.62 rad | High top speed, heavy momentum, aggressive straights |
| `bmw` | BMW E36 M3 | Classic Coupe | 1450 kg | 2.7 m | 45 m/s (162 km/h) | 58 m/s (209 km/h) | 7.6 | 22.0 | 0.64 rad | Agile cornering, late apex braking, defensive blocking |
| `nsx` | Honda NSX 1990 | Analog Sport | 1370 kg | 2.53 m | 49 m/s (176 km/h) | 62 m/s (223 km/h) | 8.5 | 23.0 | 0.62 rad | Lightweight, high lateral grip, surgical overtaking |
| `porsche` | Porsche 911 Turbo | Rear Engine | 1300 kg | 2.3 m | 48 m/s (173 km/h) | 61 m/s (220 km/h) | 8.4 | 22.5 | 0.61 rad | Sharp acceleration, lively corner exit, early nitro bursts |

Because each car uses its actual `tuning` parameters directly in `physics.addVehicle`, their acceleration, top speeds, cornering grip, and mass momentum reflect genuine automotive variety.

---

### 4. OPPONENT RACING AI: MATHEMATICAL ARCHITECTURE

To deliver thrilling arcade-sim racing without computational lag or unnatural rail movement, the AI operates via a 5-layer hierarchy:

```
  ┌────────────────────────────────────────────────────────┐
  │ 1. Trajectory Planner: Spline Position & Curvature     │
  │    P(s), Tangent T(s), Curvature κ(s) = |T'(s)|        │
  └───────────────────────────┬────────────────────────────┘
                              │
  ┌───────────────────────────▼────────────────────────────┐
  │ 2. Speed Profiler: Curvature Braking Zones             │
  │    v_max = sqrt(grip * g / κ), d_brake = (v² - v_t²)/2a│
  └───────────────────────────┬────────────────────────────┘
                              │
  ┌───────────────────────────▼────────────────────────────┐
  │ 3. Tactical Maneuvering: Drafting & Overtaking         │
  │    Slipstream drag reduction, lateral lane selection   │
  └───────────────────────────┬────────────────────────────┘
                              │
  ┌───────────────────────────▼────────────────────────────┐
  │ 4. Unstuck & Spin Recovery State Machine               │
  │    Detect reverse spin or barrier lock; execute 3-pt   │
  └───────────────────────────┬────────────────────────────┘
                              │
  ┌───────────────────────────▼────────────────────────────┐
  │ 5. Vehicle Control Actuator                            │
  │    actor.setControls({ throttle, steer, brake, boost })│
  └────────────────────────────────────────────────────────┘
```

#### Layer 1: Geometric Minimum-Curvature Spline
- Centerline is sampled at continuous arc length $s$.
- Curvature $\kappa(s)$ is computed via the Frenet-Serret formula:
  $$\kappa(s) = \frac{|\mathbf{r}'(s) \times \mathbf{r}''(s)|}{|\mathbf{r}'(s)|^3} = \frac{|x' z'' - z' x''|}{(x'^2 + z'^2)^{3/2}}$$

#### Layer 2: Physics-Based Corner Braking
- Maximum permissible cornering velocity before tire slip:
  $$v_{\text{corner}} = \sqrt{\frac{a_{\text{lat}}^{\max}}{\kappa(s) + \epsilon}} = \sqrt{\frac{\mu \cdot g}{\kappa(s) + \epsilon}}$$
  Where $\mu = \text{grip} / 9.81 \approx 2.24$ in our arcade model.
- At distance $d$ before an apex, required deceleration:
  $$a_{\text{req}} = \frac{v_{\text{current}}^2 - v_{\text{corner}}^2}{2 \cdot d}$$
- If $a_{\text{req}} \ge c.\text{brakeAcceleration} \cdot 0.85$, the AI applies `brake: 1.0` and `throttle: 0.0`.

#### Layer 3: Drafting & Slipstream Aerodynamics
- Lead car wake cone extends longitudinally $L_{\text{wake}} = 25\text{ m}$ with half-width $W_{\text{wake}} = 2.4\text{ m}$.
- Longitudinal distance $d_{\text{long}} = (\mathbf{p}_{\text{trail}} - \mathbf{p}_{\text{lead}}) \cdot \mathbf{h}_{\text{lead}}$.
- Lateral offset $d_{\text{lat}} = |(\mathbf{p}_{\text{trail}} - \mathbf{p}_{\text{lead}}) \times \mathbf{h}_{\text{lead}}|$.
- Slipstream factor $k_{\text{draft}} \in [0, 1]$:
  $$k_{\text{draft}} = \left(1 - \frac{d_{\text{long}}}{L_{\text{wake}}}\right) \cdot \left(1 - \frac{d_{\text{lat}}}{W_{\text{wake}}}\right) \cdot \text{clamp}\left(\frac{v}{30}, 0, 1\right)$$
- When $k_{\text{draft}} > 0.3$:
  - Aerodynamic drag is reduced by up to $35\%$.
  - AI gains an extra acceleration kick of $+2.5\text{ m/s}^2$, encouraging rapid slingshot passes.

#### Layer 4: Tactical Overtaking & Lane Selection
- Each AI car tracks an offset $d_{\text{offset}} \in [-3.2, +3.2]\text{ m}$ from the spline centerline.
- If an opponent is detected ahead within $18\text{ m}$:
  - Check left lane clearance vs right lane clearance.
  - Smoothly interpolate $d_{\text{offset}}$ toward the clear side at $1.8\text{ m/s}$.
  - Once abreast of the opponent, hold lane until clear by $6\text{ m}$, then merge back toward the optimal racing line.

#### Layer 5: Dynamic Rubberbanding (Catch-Up Math)
To keep races tense without breaking immersion or feeling rigged:
- Progress difference: $\Delta P = P_{\text{player}} - P_{\text{AI}}$ (in meters along the track).
- Multiplier response:
  $$M(\Delta P) = 1.0 + 0.08 \cdot \tanh\left(\frac{\Delta P}{60}\right)$$
  - If the player is $60\text{ m}$ ahead ($\approx 1.2\text{s}$), AI gains $+6\%$ acceleration.
  - If the player is $60\text{ m}$ behind, AI eases off by $-6\%$.
- **Hard Breakaway Threshold:** If $\Delta P > 250\text{ m}$ (a dominant $5\text{s}+$ lead), the rubber band snaps completely ($M = 1.0$), allowing skilled players to lap the field.

---

### 5. COLLISION IMPULSE PHYSICS, SPARKS & AUDIO CRUNCH

#### Dynamic-to-Dynamic Planck.js Contacts
In `physics.js`, all vehicles are dynamic Box2D bodies with `bullet: true` continuous collision detection. When two cars collide:
1. **Normal Impulse:** Planck's contact solver applies equal and opposite normal impulses $J_n$ and friction impulses $J_t$:
   $$\Delta \mathbf{v}_A = -\frac{J_n \mathbf{n} + J_t \mathbf{t}}{m_A}, \quad \Delta \mathbf{v}_B = +\frac{J_n \mathbf{n} + J_t \mathbf{t}}{m_B}$$
2. **Impact Detection:** Captured in `rawWorld.on('post-solve')`:
   ```javascript
   const impulse = impulses.normalImpulses.reduce((s, n) => s + n, 0);
   if (impulse > 30) {
     api.lastImpacts.push({ a, b, impulse, speed: impulse / Math.max(1, a.body.getMass()) });
   }
   ```
3. **Audio Crunch:** Triggers `audio.onImpact(impact.speed)`. High-impact collisions ($s > 0.35$) automatically duck background music/engine noise, play the heavy impact buffer with randomized pitch playbackRate, and apply low-pass filtering. Opponent-to-opponent contacts within $30\text{ m}$ of the player also trigger attenuated crash sounds.
4. **Visual Sparks (`SparksParticleEmitter`):**
   - Preallocated particle buffer: 128 particles, 0 heap allocations during gameplay.
   - On impact, 15–30 spark particles are burst from the contact manifold $(x, y + 0.4, z)$ with initial tangential velocities and downward gravity ($g = 18\text{ m/s}^2$).
   - Rendered using `THREE.Points` with additive blending and Kenney `light_01.png` texture.

---

### 6. BOOST PADS & NITRO PLACEMENT ARCHITECTURE

```
  TYPICAL CIRCUIT BOOST DISTRIBUTION
  ══════════════════════════════════════════════════════════════════════
  [MAIN STRAIGHT] ──► BOOST PAD 1 ──► SPEED TRAP (3-2-1 TRAP)
  [TURN 1 & 2]    ──► BRAKING ZONE ──► RACING LINE NITRO BOTTLE
  [BACK STRAIGHT] ──► BOOST PAD 2 ──► SLIPSTREAM ZONE (OVERTAKE)
  [CHICANE]       ──► BRAKING ZONE ──► EXIT BOOST PAD 3
  ══════════════════════════════════════════════════════════════════════
```

1. **Boost Pads (`dist/boost-pads.js`):**
   - 3 boost pads positioned at key high-speed sectors:
     - Pad 1: Main Straight exit ($x: 50, z: -160$).
     - Pad 2: Rahal Straight midpoint ($x: -90, z: 230$).
     - Pad 3: Corkscrew drop exit ($x: -210, z: -110$).
   - Boost duration: $2.0\text{ seconds}$ cap at `boostSpeed`.
2. **Nitro Pickups (`dist/nitro.js`):**
   - 8 to 12 nitro canisters placed on the outer entry and inner apex of high-speed turns.
   - Collecting a canister restores $+20\%$ tank capacity.
3. **AI Nitro Usage Rules:**
   - AI activates nitro only if:
     1. Tank capacity $\ge 30\%$.
     2. Current speed $> 25\text{ m/s}$ (not during standing start or while turning $> 0.2\text{ rad}$).
     3. Car is on a straight section ($\kappa < 0.002$) OR attempting an overtake ($d_{\text{ahead}} < 12\text{ m}$).

---

### 7. RACE HUD & STARTING SEQUENCE SPECIFICATION

The UI adheres strictly to the existing *AFTERLIGHT* aesthetic (DM Sans + Barlow Condensed uppercase, frosted glass, `--amber: #fcaf17`, `--lime: #dafa9b`, chamfered edges, dark translucent HUD):

1. **Starting Countdown Lights:**
   - 3 red light circles in a horizontal gantry HUD.
   - $t = -3\text{s}$: Red 1 ON (Audio: Low Beep).
   - $t = -2\text{s}$: Red 2 ON (Audio: Low Beep).
   - $t = -1\text{s}$: Red 3 ON (Audio: Low Beep).
   - $t = 0\text{s}$: All lights GREEN! (Audio: High-pitched GO Beep). Controls unlocked.
2. **Live Leaderboard Dock (Top-Left):**
   - Ranks 1 to 5.
   - Shows badge (1ST, 2ND, 3RD, 4TH, 5TH), driver name/car, and split gap ($\pm X.XX\text{s}$).
   - Sorted at 10 Hz by total track progress $P = \text{lap} \cdot L_{\text{track}} + s$.
3. **Minimap Radar (`dist/game.js` `drawRadar`):**
   - Renders circuit spline in subtle gray/white.
   - Player rendered as bright white arrow.
   - Opponents rendered as colored dots with their respective vehicle paint colors.
4. **Post-Race Podium & Results Modal:**
   - Displays position (e.g. `1ST PLACE - VICTORY`), total race time, fastest lap, and reward toast.

---

### 8. ARCHITECTURAL INTEGRATION MATRIX

| Module | Existing Responsibilities | New Race Mode Responsibilities |
|---|---|---|
| `dist/race-mode.js` *(NEW)* | None | Grid manager, AI opponent controller, lap tracker, track spline evaluator, leaderboard state. |
| `dist/race-hud.js` *(NEW)* | None | Starting light sequence, leaderboard UI dock, lap timer, split deltas, podium results modal. |
| `dist/sparks.js` *(NEW)* | None | Zero-GC pooled GPU spark particle emitter for car impacts. |
| `dist/physics.js` | Box2D 120Hz planar driving solver | Already supports multi-car dynamics; no breaking changes needed. |
| `dist/vehicles.js` | 5 vehicle definitions & tuning | Sourced to instantiate the 4 opponent car physics bodies. |
| `dist/nitro.js` | Particle pool & pickup fields | Extends pickup field to circuit spline; AI nitro gauge tracking. |
| `dist/boost-pads.js` | Speed pads & timer | Circuit pad definitions and hit detection. |
| `dist/audio.js` | WebAudio engine sound & impacts | `onImpact` and spatialized engine voices for the 4 opponents. |
| `dist/game.js` | Main loop, rendering & inputs | Wires `raceMode.step(dt)` and HUD updates into `animate()`. |

---

### 9. VERIFICATION & TEST PLAN
1. **Automated Unit Tests:**
   - `tests/race-mode.test.mjs`: Tests opponent instantiation, car filtering logic, lap completion, and leaderboard sorting.
   - All 452 existing unit tests must pass without a single regression.
2. **Performance Benchmarks:**
   - 60–120 FPS on standard desktop/laptop.
   - Draw calls $\le 65$.
   - Zero heap garbage collection churn in 120 Hz tick.
