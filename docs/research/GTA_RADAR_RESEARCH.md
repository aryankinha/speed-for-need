# GTA-Style Circular Radar & Palette Research (Revision 1.0)

## 1. Design Vision & User Objectives

The objective is to replace the green/teal pause-only minimap with a **circular, player-centered GPS radar HUD on the active playing screen**, authentic to the iconic **Grand Theft Auto (GTA V / GTA IV)** aesthetic.

Key design criteria:
1. **Playing Screen HUD Placement:** Circular radar positioned in the bottom-left corner of the viewport, rendered dynamically while driving.
2. **Rotating Player-Centered GPS Radar:** In GTA driving mode, the radar is centered on the vehicle and rotates in real-time with the car's heading so that forward travel is always directed upward.
3. **GTA Visual Language & Color Palette:**
   - **Void / Ocean:** Deep obsidian charcoal `#0a0e14` (semi-transparent glass background).
   - **Landmass:** Dark slate `#161c24` with clean coastline definition.
   - **Road Network:** High-contrast GTA highway white/silver `#f0f2f5` with `#242c38` road casings.
   - **Player Blip:** Iconic GTA sharp white navigation chevron (`#ffffff`) with `#000000` stroke and subtle drop shadow.
   - **Traffic Blips:** Subtle silver/grey vehicle dots (`#94a1b2`).
   - **Objectives / Sprint Gates:** Signature GTA waypoint yellow (`#f5c518` / `#ffd000`) with pulsating beacon ring.
   - **Radar Housing:** Frosted dark-glass circular bezel with 2px stroke (`rgba(255, 255, 255, 0.16)`), cardinal North (`N`) indicator, and integrated district/speed telemetry readout.
4. **Pause Menu Cohesion:** The pause menu map (`#minimap`) adopts this exact GTA palette for complete aesthetic consistency across the game.

---

## 2. Technical Architecture & Performance Budget

### A. High-DPI Canvas Rendering
* Radar canvas resolution: $320 \times 320$ pixels, displayed at $150 \times 150$ CSS pixels (2.13× device pixel ratio) for razor-sharp vector line rasterization on retina displays.
* Bounded circular clipping via `ctx.arc(cx, cy, radius - 2, 0, Math.PI * 2); ctx.clip()`.

### B. Frame Budget & Zero-GC Execution
* The radar rendering executes in under **0.08 ms** per frame (<20 canvas2D primitives).
* No objects, arrays, or closures are allocated during `drawRadar()`. Preallocated coordinates and static values prevent V8 GC churn.

### C. Orientation & Projection Mathematics
* Translation: `ctx.translate(cx, cy)`
* Dynamic Heading Rotation: `ctx.rotate(playerActor.heading)` (ensures forward is always +Y upward on the radar).
* World Coordinate Mapping: `ctx.scale(zoom, zoom); ctx.translate(-playerActor.x, -playerActor.z)`.
* North Indicator: Rotates dynamically along the bezel rim at angle `playerActor.heading` to indicate true North.

---

## 3. Implementation Plan

1. **`dist/index.html`**:
   - Add `#radar-hud` container in `<main id="game">` containing `#radar` canvas, bezel, North indicator, and district/speed badge.
   - Preserve existing `<canvas id="minimap" width="450" height="260">` in `#menu` for pause menu test compatibility.
2. **`dist/style.css`**:
   - Style `.radar-hud` with fixed bottom-left positioning, frosted glass backdrop (`backdrop-filter: blur(12px)`), circular bezel, and responsive breakpoints for mobile.
3. **`dist/game.js`**:
   - Implement `drawRadar()` and update `drawMap()` with the GTA color palette.
   - Hook `drawRadar()` into the active render loop during gameplay (`!paused && !inShowroom`).
   - Show/hide `#radar-hud` when pausing, resuming, or entering the showroom.
4. **Testing (`tests/gta-radar.test.mjs`)**:
   - Verify HTML structure, canvas IDs, GTA color palette constants, and circular radar clip logic.
