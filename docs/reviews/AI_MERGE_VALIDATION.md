# Racing AI integration review

Integrated `roadster-game-ai` into `roadster-game` selectively. Both repositories start at commit `7814a2e`. The AI folder contains an older partial copy of the performance work; copying that folder wholesale would revert the optimized models, sky, collider cache, garage thumbnails, radar caching, parked-car updates, and newer input/quality checks.

## Scope

Imported only `dist/race-mode.js` and its two additional tests in `tests/race-mode.test.mjs`. No new runtime dependencies or asset changes. Added `tests/race-ai-merge.test.mjs` for integration coverage. The source AI folder is unchanged.

The AI adds cached minimum-curvature racing lines, car-specific driving profiles, clearance-aware overtaking and side-by-side spacing, defensive positioning, pickup/pad seeking, drafting alignment, and revised braking/nitro decisions. Opponents still use physical controls and unchanged garage tuning.

Corrected during review:

- Replaced the per-step `isLaneClear` closure with a shared class method to avoid allocations in the AI loop.
- Intersect asymmetric wall bounds with an optional symmetric lane limit instead of dropping wall clearance when both APIs exist.
- Capture the upcoming corner-exit decision before the braking preview overwrites its shared sample; otherwise the decision accidentally uses the end of the braking horizon.

## Validation

- Main baseline: 461 tests passed.
- Unmodified source AI: all 24 race/Drift tests passed.
- Integrated `npm run check`: all syntax checks and 466 tests passed.
- Added tests sample the complete Drift racing line (including seam) against measured clearance, cover combined lane APIs, and run every selected-car grid through three laps with measured model sizes, real walls, unchanged tuning, and no teleport/kinematic control. Every entry finishes under the existing 165-second threshold.
- Existing tests cover procedural circuit racing, stationary-player passing on every grid, spin recovery, collision contacts, nitro/pads, ranking, countdown, teardown, free roam, controls, cockpit, garage and optimized assets.
- Electron smoke checks passed on both Drift and Coast with no errors or failed checks, including production telemetry remaining disabled.
- Brave local test: countdown, all four opponents racing/passing a stationary player, leaderboard, player acceleration (78 km/h observed), pause/resume, and exit to free roam passed with no console warnings/errors.

Only the racing module and race tests were changed among the files present before this integration; prior performance work was preserved. Changes remain local and uncommitted. No screenshots, deployment, public link, or GitHub push.
