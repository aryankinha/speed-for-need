# Frozen driving screen: root cause and repair

The latest commit is `7814a2e`; the optimization and subsequent AI merge are local working-tree changes. The active `localhost:4173` server was running from `roadster-game-ai`, not the integrated `roadster-game` directory. SHA-256 comparison of its served `game.js` confirmed the exact AI-folder copy.

The browser repeatedly reported `ReferenceError: px is not defined` in `updateSunShadow` (line 413). The shadow refactor moved this function out of `updateTransforms`, but `px` and `pz` remained local to `updateTransforms`. Every active driving frame aborted before `graphics.render(dt)`. Physics and HUD could advance while the 3D screen stayed frozen. AI simulation was not the cause of this particular freeze.

Repaired the AI copy by reading `pos.x` and `pos.z` inside `updateSunShadow`, matching the existing repair in main. Replaced the verified AI-folder development server with the merged main-folder server on the same local port and reloaded the user's tab.

Added `tests/frame-loop.test.mjs` to both folders. It executes the actual driving animation function and shadow function together, moves the car between frames, and verifies rendering continues across throttled shadow refreshes. This covers the branch that the earlier boot-only smoke checks did not exercise.

Validation: main syntax/tests passed (467 tests); the frame regression passes in both folders. Browser race countdown, live opponent positions and player acceleration to 65 km/h verified in the original normal-mode tab. No screenshots, public deployment, or GitHub push.
