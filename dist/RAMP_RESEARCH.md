# Ramp and boost pad research

Scope: how arcade racers handle jump ramps, speed boost pads and trick ramps, and what this project reused.
Searches returned mostly fan guides; primary developer documentation was not reachable. Treat every number below as community-sourced.

## Sources and findings

- **Mario Kart Wii boost timing and speed (fan wiki).** https://wiki.mkwtas.com/wiki/Boost
  Boosts are timed: a per-frame timer counts down, and when it reaches zero the maximum speed returns to base, decaying at a fixed rate. Max speed modifiers: mini-turbo 20%, trick 30%, mushroom 40% (with a minimum). The mushroom duration was not reliably readable on the page.
  **Reused:** the idea of a timed boost that lapses back to the base cap. The pad uses a 2 s timer (`PAD_BOOST_SECONDS`) and the existing boost cap in `physics.js` (69 m/s boosted vs 55 m/s base, about +25%). It does not copy the 40% figure.

- **Trackmania turbo blocks (fan guide, French, newer Trackmania).** https://gamewave.fr/trackmania/trackmania-guide-des-blocs-interactifs/
  Turbo and boost blocks are direction-aware and hold a fixed boosted speed for a fixed time. The 200 km/h and 400 km/h figures are for that newer game only.
  **Not reused:** the speed numbers. This project's pads are direction-agnostic (they trigger from either driving direction), which is a deliberate arcade simplification.

- **Trackmania Turbo (2016) boost pads (Giant Bomb wiki).** https://giantbomb.com/wiki/Objects/Boost_Pad
  The page returned HTTP 403 and could not be read. Not used.

- **Hot Wheels Unleashed mid-air control and boost.** https://traxion.gg/tips-and-tricks-how-to-get-the-most-out-of-hot-wheels-unleashed/
  Boost lets the car rotate in the air; the right stick adjusts roll. No trick-scoring rule was found.
  **Not reused:** no trick scoring was added. Air tricks stay on the existing auto-complete model (spin and roll finish before touchdown).

- **Forza Horizon ramp technique (fan guides).** https://steamcommunity.com/app/1293830/discussions/0/4516632262417356591 and https://www.u4gm.com/forza-horizon-6/blog-forza-horizon-6-barrel-roll-skills-guide
  Keep speed through takeoff, land straight for jump credit, and larger ramps give more airtime. The second page is a near-duplicate of third-party copies, so it is weak evidence.
  **Reused:** the design choice that larger ramps give more air. The mega ramp is 5 m high and 16 m long (`RAMP_SHAPES.mega`), and the kicker is short and low.

## What was built from this

- Ramp profiles are data (`dist/ramp-shapes.js`): kicker 6 m long and 1.2 m high, standard 10 m long and 3.4 m high, mega 16 m long and 5 m high. Each profile has its own Kenney model scale and chamfered collider.
- Speed pads (`dist/boost-pads.js`) use a timer that re-triggers on entry and never touches the nitro tank.
- Spin and roll remain auto-completing aerial tricks, unchanged in model, placed behind a boost pad so the player arrives fast.

## Follow-up decisions

- **Standard deck width is 6 m (was 4.6 m).** Intentional: the wider deck lets a car enter from the flank and still
  be carried up. The model is scaled to this width, and `tests/ramp-variants.test.mjs` asserts it.
- **Spin ramps are tagged `variant: 'spin'`.** They wear a cyan-tinted copy of the Kenney material. The Stunt Park
  spin has a boost pad 21 m in front of its toe. A second spin ramp sits on the perimeter road, in the lane traffic
  does not use, 20 m past its own boost pad.
- **Body pose uses the wheels, not the centre.** Each axle is supported by its higher wheel, the body is lifted so no
  bumper corner sits below the deck, roll comes from the mean left and right wheel heights, and descent is limited
  to 0.1 m per 120 Hz step. The nose-buried metric in the stress sweep falls from 0.915 m to zero.
