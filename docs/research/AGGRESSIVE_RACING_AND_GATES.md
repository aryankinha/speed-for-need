# Aggressive racing and checkpoint visibility

## Research and design

Research subagent inspected the current controller and primary references:

- Andrew Fray, F1 context steering: https://www.gameaipro.com/GameAIPro2/GameAIPro2_Chapter18_Context_Steering_Behavior-Driven_Steering_at_the_Macro_Scale.pdf — separate race-line, avoidance and drafting influences so indiscriminate avoidance does not suppress competition.
- ARGOS attack/defense maneuvers: https://arxiv.org/html/2401.15783v1 — use temporally bounded maneuver states rather than oscillating reactive steering.
- BeamNG AI API: https://documentation.beamng.com/api/beamngpy/master/beamngpy.html — aggression and car avoidance are independent controls. Deliberate contact here is an arcade design choice, not a claim that professional racing permits ramming.
- W3C color guidance: https://www.w3.org/WAI/WCAG22/Understanding/use-of-color.html — supplement color with numbers and a labeled legend.

The prior controller explicitly left 0.48 m extra side clearance and only weakly defended. The added player-pressure phase predicts a closing player's lane, blocks it on broad straights, and deliberately contests a parallel car with a small body overlap target. Each attempt lasts at most 0.9 seconds, followed by 2.4 seconds of cooldown. Normal Planck steering, tire grip, mass and speed tuning remain unchanged. No teleports, impulses or hidden extra engine power. Stopped/wrong-way players, sharp corners, narrow lanes, high relative speeds and occupied adjacent lanes disable pressure. Emergency rear-end braking and avoidance of other AI remain active.

Gates now share a lightweight instanced builder: Drift width16m, Raceway20m; 5.2m high with 0.28m posts, 0.32m crossbars, ground strips and numbered panels. Red marks the current required gate; yellow marks upcoming gates (the following gate is bright, distant future gates dim); green marks cleared gates in the current lap. Finish gate is12; the first forward gate is1. State resets each lap and all gates are green after finishing. Decoration is non-colliding; existing ordered checkpoint validation remains intact.

Browser testing also exposed an existing onboarding timer error (`Illegal invocation`) when entering a race. DriveHint now invokes timer functions without passing the hint object as their receiver, covered by a regression test.

## Validation and critic

- `npm run check`:482 tests pass, including measured five-car three-lap races, stationary-player passing, recovery, collisions, resources and free roam.
- New tests prove blocking/release, actual Planck contact on both the procedural course and authored Drift track, stopped/wrong-way/narrow/corner exclusions, wider instanced gates and red/yellow/green lap/finish transitions.
- Browser: race starts, HUD legend present, full field advances through laps,180 recorded frames, no new errors after the onboarding repair. No screenshots taken; gate readability is supported by geometry/material checks, not a claimed visual/mobile screenshot inspection.
- Independent critic iteration1:8.5/10, all480 tests independently passed. Followups added actual Drift contact coverage, aligned gate numbering and narrowed texture cleanup ownership.
- Independent critic iteration2:9/10, no blockers;15 focused checks independently passed. Threshold8/10 achieved in two reviews (maximum three).

Changes are local. No deployment, public link, or GitHub push.
