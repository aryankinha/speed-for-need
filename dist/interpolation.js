// Render interpolation for a fixed-step simulation (Glenn Fiedler, "Fix Your Timestep":
// https://gafferongames.com/post/fix_your_timestep/ and the Box2D/Planck fixed-step guidance
// https://piqnt.com/planck.js/docs/world/simulation.html ).
// The physics advances in whole 1/120 s steps, so the latest state is a step ahead of or behind the
// display time depending on the frame rate. Rendering the latest state makes motion follow step counts
// (0, 1, 2, 3 per frame on 144/90/75/165 Hz or uneven frame times) and looks like stutter.
// Rendering the state between the state before the last step and the state after it, weighted by the
// leftover accumulator fraction (physics.alpha), makes the displayed time track real time instead.
// Heading is interpolated along the shortest arc. Nothing here allocates while driving.

/** Wraps an angle to (-PI, PI]. */
export function wrapAngle(angle) {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

/** Shortest-arc heading interpolation: a + wrap(b - a) * t. */
export function lerpHeading(a, b, t) {
  return a + wrapAngle(b - a) * t;
}

export class PoseInterpolator {
  /**
   * @param {number} capacity maximum number of actors (slots 0..capacity-1).
   */
  constructor(capacity) {
    if (!(capacity > 0) || !Number.isInteger(capacity)) throw new RangeError('PoseInterpolator capacity must be a positive integer.');
    this.capacity = capacity;
    this.count = 0;
    this.actors = new Array(capacity).fill(null);
    // Per slot: [x, z, heading].
    this.prev = new Float64Array(capacity * 3);
    this.curr = new Float64Array(capacity * 3);
  }

  /** Assigns an actor (any object with numeric x, z and heading) to a slot and snaps that slot to its live pose. */
  setActor(slot, actor) {
    if (!Number.isInteger(slot) || slot < 0 || slot >= this.capacity) throw new RangeError(`PoseInterpolator slot ${slot} out of range.`);
    this.actors[slot] = actor;
    if (slot >= this.count) this.count = slot + 1;
    this.snapSlot(slot);
  }

  /** Makes a slot's previous and current pose both equal its live pose (teleports, resets, new bodies). */
  snapSlot(slot) {
    const actor = this.actors[slot];
    if (!actor) return;
    this._write(this.prev, slot, actor);
    this._write(this.curr, slot, actor);
  }

  /** Call immediately before each fixed physics step: the live pose is the state that step starts from. */
  beginStep() {
    for (let i = 0; i < this.count; i++) this._write(this.prev, i, this.actors[i]);
  }

  /** Call once after all fixed steps of a frame: the live pose is the newest simulated state. */
  endStep() {
    for (let i = 0; i < this.count; i++) this._write(this.curr, i, this.actors[i]);
  }

  /**
   * Writes the pose of `slot` at fraction `alpha` (0 = previous step, 1 = latest step) into `out`
   * as {x, z, heading}. Returns `out`.
   */
  sample(slot, alpha, out) {
    const a = alpha < 0 ? 0 : alpha > 1 ? 1 : alpha;
    const p = slot * 3, prev = this.prev, curr = this.curr;
    out.x = prev[p] + (curr[p] - prev[p]) * a;
    out.z = prev[p + 1] + (curr[p + 1] - prev[p + 1]) * a;
    out.heading = lerpHeading(prev[p + 2], curr[p + 2], a);
    return out;
  }

  _write(buffer, slot, actor) {
    const p = slot * 3;
    buffer[p] = actor.x;
    buffer[p + 1] = actor.z;
    buffer[p + 2] = actor.heading;
  }
}

/**
 * The per-frame render sequence that game.js runs, as one object so the tests exercise the same code:
 *   beginStep() before each fixed physics step, endStep() once after all steps of the frame,
 *   advance(frameDt, paused) once per running frame (the render clock), sample(slot, alpha, out) to draw.
 * The render clock advances with real frame time, so it keeps moving on zero-step frames and freezes while paused.
 */
export class RenderState {
  constructor(capacity) {
    this.poses = new PoseInterpolator(capacity);
    this.time = 0;
  }

  setActor(slot, actor) { this.poses.setActor(slot, actor); }

  /** Teleports or new bodies: previous and current pose both become the live pose. */
  snapSlot(slot) { this.poses.snapSlot(slot); }

  beginStep() { this.poses.beginStep(); }

  endStep() { this.poses.endStep(); }

  /** Adds real frame time to the render clock unless the game is paused. Non-finite or negative input is ignored. */
  advance(frameDt, paused = false) {
    if (!paused && Number.isFinite(frameDt) && frameDt > 0) this.time += frameDt;
    return this.time;
  }

  /** Writes the pose of `slot` at physics fraction `alpha` into `out` ({x, z, heading}). */
  sample(slot, alpha, out) { return this.poses.sample(slot, alpha, out); }
}
