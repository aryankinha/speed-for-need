# Solana Drive — Open Road

A browser free-roam driving game in an expanded 1.31km² coastal city. Five selectable downloaded cars: Concept GT, Voltic Roadster, Bavaria M-Coupe, Kanto Katana 1990 and Stuttgart Turbo. The main-menu garage has a live 3D interior, collection previews, tuning comparisons and saved ride selection.

Run `npm run dev` and open http://127.0.0.1:4173. No installation or build needed. WebGL/hardware acceleration required. All models, rendering libraries and physics are bundled locally; Google Fonts has system fallbacks.

## 60 Second Rush

Choose **60 SECOND RUSH** on the home screen, or start it from Pause → Settings. A short countdown starts a one-minute score attack: link clean speed, drifts, near misses and clean landings to build up to ×5. Press **B** or tap **Bank** to keep a chain; an impact loses unbanked points. Slow down safely to bank automatically. Results show medals and a personal best saved separately for each car and map. Retry with Enter/R, or choose Free Drive to return to cruising. Pausing stops the timer; reset or fast travel abandons the run.

The challenge panel appears only in Rush. Research, measured optimizations and verification limits: [dist/RUSH_RESEARCH.md](docs/research/RUSH_RESEARCH.md).

## Controls

- WASD or arrows: accelerate, steer, brake then reverse
- Space: drift / handbrake
- Shift: rechargeable boost
- C: chase, wide chase, cockpit camera
- B: bank the current Rush chain
- R: return to Ocean Drive (abandons Rush; retries on the result screen)
- Enter: start/cancel coastal sprint
- P, Esc or pause button: menu, garage, stats, map, sound, controls
- Touch controls are optional and off by default; enable in pause menu

The pause button, radar and nitro meter appear while driving. Sprint time/results appear in the pause menu; green physical gates show the route.

## Graphics
Rendering runs through `dist/graphics.js`: pmndrs/postprocessing + N8AO (vendored in `dist/vendor/`), with ambient occlusion, mipmap bloom, SMAA, ACES tone mapping and a light colour grade. Lighting is a Poly Haven midday pure-sky HDR, aligned with the shadow-casting sun, plus clear-coated car paint and tinted glass. Pause → Settings or Options → Graphics offers Auto / Low / Medium / High / Ultra. Auto reads the GPU name (`graphics-presets.js`) and picks Medium on integrated laptop GPUs. While driving, the pixel ratio adapts within the preset's range. If frames still miss budget at the lowest ratio, AO is halved, then switched off, then bloom is switched off.

`npm run dev` serves `dist/` with `Cache-Control: no-store`, so edits always show on reload.

## Living city
- **Pedestrians** (`pedestrians.js`, `pedestrian-sim.js`): Quaternius CC0 characters wearing shader-painted outfits. They walk the sidewalks and the beach, sit on the sea wall, dodge fast cars and get knocked down (which raises your wanted level). The crowd size follows the graphics preset (12/28/44/60).
- **Traffic** (`street-cars.js`): about 200 shovable parked cars per Solana map and 58 traffic cars across 11 Kenney models.
- **Street props** (`street-props.js`): about 1,100 knockable hydrants (with water spray), bins, news boxes, bags, chairs and construction gear. Power poles are solid.
- **Activities** (`activities.js`, `wanted.js`, `open-world.js`): speed traps, drift zones, 25 hidden packages, and a 0–3 star wanted level with police chases (Pause → Settings → Police chases).
- **Ambient** (`ambient.js`): seagull flocks over the shore, beach umbrellas and towels.

## Validation
`npm test` runs the regression suite covering driving, rendering, audio, UI, nitro and the garage. `npm run check` checks source syntax plus tests. Uses Planck.js / Box2D CCD with a fixed120Hz simulation, dynamic traffic, measured rotated vehicle fixtures and street-prop collisions. Buildings are fitted within lots and checked at runtime. World surfaces are planar arcade physics.

[Research and root causes](docs/research/RESEARCH.md) · [Asset credits](docs/research/CREDITS.md)

[Garage sources and debugging](docs/research/GARAGE_RESEARCH.md)

Three sourced stunt ramps sit in a dedicated paved park with clear runways and saved best jump distance. Yellow radar triangles mark their entries; Pause → Settings & Controls → Visit Stunt Park takes you to its entrance. [Verified stunt research](docs/research/STUNT_IMPLEMENTATION.md).

Garage paint and three authored wheel types are saved per car. All five cars have animated front steering and rolling wheels. [Customization and critic review](docs/research/CUSTOMIZATION_REVIEW.md).

The three park lanes offer Long Jump, airborne 360 Spin and Barrel Roll. Choose a lane in Pause → Settings & Controls before visiting. Take the ramp above 14 m/s (about 50 km/h) to trigger its aerial move. Cones and cone colliders have been removed from the park. Moves are arcade visual rotations over the existing planar collision model. [Graphics and aerial stunt review](docs/research/AERIAL_GRAPHICS_REVIEW.md).

## Solana Coast map
The map now has Pacific Boardwalk, Sunset Mile, Palm Gardens, Downtown Solana and Arts & Warehouse districts. A diagonal boulevard crosses the northern blocks, while the existing traffic, stunt park and four beach sides remain connected. Pause → Settings & Controls → Explore the coast selects a district arrival. New downloaded Kenney models are bundled locally for browser and Electron; no map API is needed. [Verified map research and validation](docs/research/LA_MAP_RESEARCH.md).

## Desktop (Electron)

Run: `npm start` (or `npm run electron`). Checks: `npm run electron:smoke` boots the real window headlessly and verifies sandboxing, CSP, IPC validation and that the game started (exit code 0 = pass). Build: `npm run pack` (unpacked app in `release/`), `npm run dist:app` (installers: dmg/zip, nsis/zip, AppImage). `npm run icon` regenerates `build/icon.png`.

### Architecture (main / preload / renderer)

| File | Role |
| --- | --- |
| `electron-main.mjs` | App lifecycle, game window, window-state persistence, single instance, crash/unresponsive recovery, global navigation guards |
| `electron-protocol.mjs` | Privileged `app://` scheme serving `dist/` read-only with CSP + traversal guard |
| `electron-menu.mjs` | Native application menu (Game / Edit / View / Window / Help) |
| `electron-ipc.mjs` | `ipcMain.handle` handlers: native notification, save dialog, open external link, fullscreen, quit |
| `electron-security.mjs` | Pure validators (URL allowlist, payload limits, path resolution, CSP) with unit tests |
| `preload.cjs` | Sandboxed preload; exposes the frozen `window.electronAPI` through `contextBridge` |
| `dist/electron-bridge.js` | Renderer side; no-op in a normal browser, so the web game is unchanged |

### Security checklist (electronjs.org/docs/latest/tutorial/security)

`nodeIntegration` off, `contextIsolation` on, `sandbox` on, `webSecurity` on, no insecure content, no experimental features, CSP on every response, all permission requests denied, `will-navigate` / `will-redirect` / `setWindowOpenHandler` / `will-attach-webview` locked for every web contents, only `https:` links reach `shell.openExternal`, IPC accepted from the game's main frame only and every payload validated in main, DevTools disabled in packaged builds, no remote code, custom scheme instead of `file://`, Electron Fuses flipped at package time (RunAsNode, NODE_OPTIONS, `--inspect` off; cookie encryption, ASAR integrity and only-load-from-ASAR on).

### Known limits

- Builds are ad-hoc signed on macOS and unsigned on Windows. A public release needs a Developer ID / notarisation certificate and a Windows code-signing certificate (set in the `build` block of `package.json`).
- No auto-update (needs a publish target such as GitHub Releases + `electron-updater`).

## Cockpits and collection presentation

C cycles to the cockpit: the camera sits behind the selected car’s own steering wheel, which turns with steering input. The Concept GT, Roadster, BMW and Porsche use their authored wheel geometry. The NSX uses a downloaded Savino CC0 wheel accessory. Home displays the full five-car lineup with the equipped car slightly forward; Garage contains the rotating platform.

Implementation research and model audit: [dist/COCKPIT_LINEUP_RESEARCH.md](docs/research/COCKPIT_LINEUP_RESEARCH.md).

## Supported maps and asset cleanup
Only Solana Coast and Drift Race Track ship. Removed Bay/City Street URLs and saved choices fall back to Coast. Each map loads its own world/scenery; Drift skips city crowds, police, traffic and furniture. The untouched Drift master is in source-assets/ for offline processing; only its compressed GLB is in dist/. Research lives in docs/research/.
