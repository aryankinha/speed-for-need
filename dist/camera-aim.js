// Pure chase-camera math (no three.js import) so game.js and tests/camera.test.mjs share one implementation.

// Constants shared with game.js.
export const CHASE_BUMPER = 2.4;          // car centre to rear bumper (metres)
export const CHASE_MIN_CENTRE = 4.5;      // camera never closer than this to the car centre
export const CHASE_OVERHEAD_Y = 8.5;      // overhead fallback height when a static wall blocks the chase position
export const CHASE_OVERHEAD_BACK = 2.2;   // overhead fallback offset behind the car centre
export const CHASE_ROAD_R = 2.7;          // traffic car radius used for the camera lift (half length 2.4, half width 1.0, +0.1)
export const CHASE_TRAFFIC_LIFT = 1.5;    // extra height when a traffic car sits under the chase camera
export const CHASE_DAMP_RATE = 6;         // camera position damping rate (1/s)

// Forward offset (metres) the chase camera leads the car by so that, under exponential damping
// camera += (goal - camera) * (1 - k) with k = exp(-rate * dt), the settled camera sits at its nominal distance.
// Frame-rate independent: lag = v * dt * k / (1 - k) (exact for the discrete update, unlike v / rate).
export function chaseLead(forwardSpeed, dt, rate = CHASE_DAMP_RATE) {
  if (!(dt > 0)) return 0;
  const k = Math.exp(-rate * dt);
  return forwardSpeed * dt * k / Math.max(1e-9, 1 - k);
}

// Writes into `out` the point to look at so the car anchor projects to NDC y = ndcY (negative = below centre)
// and horizontally centred, for a camera at `cam` with vertical FOV `fovDeg`. cam, car and out are {x,y,z}.
export function chaseAim(cam, car, fovDeg, ndcY, out) {
  const rx = car.x - cam.x, ry = car.y - cam.y, rz = car.z - cam.z;
  const horiz = Math.hypot(rx, rz) || 1e-4, dist = Math.hypot(rx, ry, rz);
  const phi = Math.atan(-ndcY * Math.tan(fovDeg * Math.PI / 360)); // angle between view axis and car, vertical plane
  const elev = Math.atan2(ry, horiz) + phi;
  const c = Math.cos(elev) * dist;
  out.x = cam.x + rx / horiz * c;
  out.y = cam.y + Math.sin(elev) * dist;
  out.z = cam.z + rz / horiz * c;
  return out;
}

// Slab test: entry distance along the unit ray (ox,oy,oz)+t*(dx,dy,dz) into box {min,max}; -1 on miss, 0 if origin inside.
const slab = {t0: 0, t1: 0};
function slabAxis(o, d, lo, hi) {
  if (Math.abs(d) < 1e-12) return o >= lo && o <= hi;
  let a = (lo - o) / d, b = (hi - o) / d;
  if (a > b) { const s = a; a = b; b = s; }
  if (a > slab.t0) slab.t0 = a;
  if (b < slab.t1) slab.t1 = b;
  return slab.t0 <= slab.t1;
}
function rayBox(ox, oy, oz, dx, dy, dz, box) {
  slab.t0 = -Infinity; slab.t1 = Infinity;
  if (!slabAxis(ox, dx, box.min.x, box.max.x)) return -1;
  if (!slabAxis(oy, dy, box.min.y, box.max.y)) return -1;
  if (!slabAxis(oz, dz, box.min.z, box.max.z)) return -1;
  if (slab.t1 < 0) return -1;
  return Math.max(slab.t0, 0);
}

// Distance along the ray the chase camera may travel before a static building blocks it.
// Returns maxDist when nothing is hit, otherwise hit - 0.55 but never below minDist.
// Traffic cars do not clamp: they only lift the camera (see chaseCameraGoal).
export function clampDistance(ox, oy, oz, dx, dy, dz, maxDist, minDist, boxes) {
  let d = maxDist;
  // 2D interval reject: skip buildings that cannot touch any point within maxDist of the origin.
  const minX = ox - maxDist - 2, maxX = ox + maxDist + 2, minZ = oz - maxDist - 2, maxZ = oz + maxDist + 2;
  for (let i = 0; i < boxes.length; i++) {
    const bb = boxes[i];
    if (bb.max.x < minX || bb.min.x > maxX || bb.max.z < minZ || bb.min.z > maxZ) continue;
    const e = rayBox(ox, oy, oz, dx, dy, dz, boxes[i]);
    if (e >= 0 && e < d) d = Math.max(minDist, e - 0.55);
  }
  return d;
}

// Settled chase camera position for one frame (lead is NOT included; stepChaseCamera adds it to the damped target).
// p = {x,z (car centre), fx,fz (unit forward), back, height, boxes (static buildings), spheres (traffic [{x,z,r}])}.
// Writes {x,y,z,clamped,w} into out. w is the overhead blend weight (0 = chase, 1 = overhead).
// Unblocked: the point behind the car at back distance and chase height (+CHASE_TRAFFIC_LIFT when a traffic car is under it).
// Walls: the camera moves to the minimum distance behind the rear bumper and, as a wall gets closer than that,
// blends into an overhead point above the car so it never sits inside a wall or the car body.
// Traffic never triggers the overhead blend.
export function chaseCameraGoal(p, out, bumper = CHASE_BUMPER) {
  const ox = p.x - p.fx * bumper, oy = 1.2, oz = p.z - p.fz * bumper;
  const gx = p.x - p.fx * p.back, gy = p.height, gz = p.z - p.fz * p.back;
  let dx = gx - ox, dy = gy - oy, dz = gz - oz;
  const maxDist = Math.hypot(dx, dy, dz);
  dx /= maxDist; dy /= maxDist; dz /= maxDist;
  const minDist = Math.max(0.5, CHASE_MIN_CENTRE - bumper);
  const d = clampDistance(ox, oy, oz, dx, dy, dz, maxDist, minDist, p.boxes);
  const cx = ox + dx * d, cy = oy + dy * d, cz = oz + dz * d;
  const hx = p.x - p.fx * CHASE_OVERHEAD_BACK, hy = CHASE_OVERHEAD_Y, hz = p.z - p.fz * CHASE_OVERHEAD_BACK;
  const w = Math.min(1, Math.max(0, 1 - (d - minDist) / 1.5));
  let lift = 0;
  const sp = p.spheres;
  if (sp) for (let i = 0; i < sp.length; i++) {
    if (Math.hypot(gx - sp[i].x, gz - sp[i].z) < sp[i].r) { lift = CHASE_TRAFFIC_LIFT; break; }
  }
  out.x = cx + (hx - cx) * w;
  out.y = cy + (hy - cy) * w + lift * (1 - w);
  out.z = cz + (hz - cz) * w;
  // Blending a close point with the overhead point can dip inside the minimum radius; push out radially.
  const rx = out.x - p.x, ry = out.y - 0.6, rz = out.z - p.z, r = Math.hypot(rx, ry, rz);
  if (r < CHASE_MIN_CENTRE && r > 1e-6) {
    const s = CHASE_MIN_CENTRE / r;
    out.x = p.x + rx * s; out.y = 0.6 + ry * s; out.z = p.z + rz * s;
  }
  out.clamped = d < maxDist - 1e-4;
  out.w = w;
  return out;
}

// Keeps the camera at least minR from the car centre (car = {x,z} on the ground, centre height 0.6 m).
// Applied after damping and shake, because a straight lerp between two valid goals can cut through the minimum radius.
export function pushOutOfCar(cam, car, minR = CHASE_MIN_CENTRE) {
  const rx = cam.x - car.x, ry = cam.y - 0.6, rz = cam.z - car.z, r = Math.hypot(rx, ry, rz);
  if (r < minR && r > 1e-6) {
    const s = minR / r;
    cam.x = car.x + rx * s; cam.y = 0.6 + ry * s; cam.z = car.z + rz * s;
  }
  return cam;
}

// One frame of the chase camera, in the order game.js relies on:
// goal -> snap (after a cut) or damped move -> shake offset -> minimum-radius push-out.
// cam and car are {x,y,z} / {x,z}; p is the goal parameter object (see chaseCameraGoal); shake is {x,y} or null.
const stepGoal = {x: 0, y: 0, z: 0, clamped: false, w: 0};
export function stepChaseCamera(cam, car, dt, p, snap, shake) {
  chaseCameraGoal(p, stepGoal);
  if (snap) {
    cam.x = stepGoal.x; cam.y = stepGoal.y; cam.z = stepGoal.z;
  } else {
    // Damped target leads the settled point by the car's lag, so a steady camera sits exactly at the settled point.
    const lead = p.lead * (1 - stepGoal.w);
    const tx = stepGoal.x + p.fx * lead, ty = stepGoal.y, tz = stepGoal.z + p.fz * lead;
    const a = 1 - Math.exp(-dt * CHASE_DAMP_RATE);
    cam.x += (tx - cam.x) * a;
    cam.y += (ty - cam.y) * a;
    cam.z += (tz - cam.z) * a;
  }
  if (shake) { cam.x += shake.x; cam.y += shake.y; }
  pushOutOfCar(cam, car);
  return stepGoal;
}
