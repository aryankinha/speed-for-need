// Speed pads: flat chevron strips on the road and in the stunt park. Detection
// and timing are pure and allocation-free, and they never touch the nitro bar.
export const PAD_BOOST_SECONDS = 2;
const PAD = (id, x, z, heading) => Object.freeze({id, x, z, heading, length: 6, width: 4});
// heading follows the physics convention (0 faces -z). Pads trigger from either direction.
export const BOOST_PADS = Object.freeze([
  PAD('road-west', -445.7, -75, 0),
  PAD('road-east', 445.7, 75, Math.PI),
  PAD('park-mega', -355, 522, 0),
  PAD('park-spin', -375, 566, 0),
  // Lane the perimeter spin ramp occupies (the one traffic leaves free).
  PAD('road-spin', -455, -75, 0),
  // Approach to the barrel roll (the park lane between the spin and the roll toe is clear of the mega and kicker).
  PAD('park-roll', -340, 566, 0),
]);

/** Index of the pad whose rectangle contains a grounded actor's centre, or -1. */
export function padHit(actor, pads = BOOST_PADS) {
  if (!actor || actor.isAirborne || (actor.elevation || 0) > 0.3) return -1;
  for (let i = 0; i < pads.length; i++) {
    const p = pads[i], dx = actor.x - p.x, dz = actor.z - p.z, c = Math.cos(p.heading), s = Math.sin(p.heading);
    const along = -dx * s - dz * c, lateral = dx * c - dz * s;
    if (Math.abs(along) <= p.length / 2 && Math.abs(lateral) <= p.width / 2) return i;
  }
  return -1;
}

/**
 * Pad boost timer. Entering a pad (re)starts the boost; staying on it does not.
 * The state is {timeLeft, current}. Nothing here reads or writes the nitro tank.
 */
export class BoostPadTimer {
  constructor(pads = BOOST_PADS) {
    this.pads = pads;
    this.reset();
    this.triggers = 0;
  }
  reset() {
    this.timeLeft = 0;
    this.current = -1;
  }
  get active() {
    return this.timeLeft > 0;
  }
  /** One fixed step. Returns true on the step the actor enters a pad. */
  step(actor, dt) {
    const delta = Number.isFinite(dt) && dt > 0 ? dt : 0;
    this.timeLeft = Math.max(0, this.timeLeft - delta);
    const hit = padHit(actor, this.pads), entered = hit >= 0 && hit !== this.current;
    this.current = hit;
    if (entered) {
      this.timeLeft = PAD_BOOST_SECONDS;
      this.triggers++;
    }
    return entered;
  }
}

// Body class that drives the boost vignette and speed-line styling. Reset must clear it, or a reset during a
// pad or nitro boost leaves the vignette on.
export const BOOST_BODY_CLASS='nitro-active';
export function clearBoostBodyClass(classList){if(classList)classList.remove(BOOST_BODY_CLASS);}
// One demand for the physics boost cap. Nitro and pad boosts share the same top speed and never stack.
export function boostDemand(nitroBoosting,padActive){return !!(nitroBoosting||padActive);}

/** Chevron markers for the radar and map, drawn in world metres like the ramp triangles. */
export function drawBoostPadMarks(ctx, pads = BOOST_PADS) {
  ctx.save();
  ctx.strokeStyle = '#fcaf17';
  ctx.lineWidth = 2.2;
  ctx.lineJoin = 'round';
  for (const p of pads) {
    ctx.save();
    ctx.translate(p.x, p.z);
    ctx.rotate(-p.heading);
    ctx.beginPath();
    for (const dy of [-4, 1]) {
      ctx.moveTo(-5, dy + 4);
      ctx.lineTo(0, dy);
      ctx.lineTo(5, dy + 4);
    }
    ctx.stroke();
    ctx.restore();
  }
  ctx.restore();
}
