import test from 'node:test';
import assert from 'node:assert/strict';
import {createDrivingWorld} from '../dist/physics.js';
import {PoseInterpolator, RenderState, wrapAngle} from '../dist/interpolation.js';
import {snapShadowAnchor} from '../dist/shadow-snap.js';
import {chaseAim, chaseLead, stepChaseCamera} from '../dist/camera-aim.js';

// ---- Deterministic frame pacing -------------------------------------------------------------
function lcg(seed) {
  let s = seed >>> 0;
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
}
// Frame times in seconds: a constant rate, or a rate with +-jitter uniform noise (seeded).
function frameTimes({hz, jitter = 0}, count, seed = 12345) {
  const rand = lcg(seed), out = [];
  for (let i = 0; i < count; i++) out.push((1 / hz) * (1 + (rand() * 2 - 1) * jitter));
  return out;
}

// ---- Metrics ---------------------------------------------------------------------------------
// Quadratic least-squares fit over a +-W frame window; returns the largest residual of the centre sample.
// Smooth (constant-velocity or gently curving) motion has tiny residuals; stair-steps from fixed-step
// quantisation do not.
function maxQuadResidual(ts, ys, W) {
  let max = 0;
  for (let k = 0; k < ts.length; k++) {
    const a = Math.max(0, k - W), b = Math.min(ts.length - 1, k + W);
    if (b - a < 6) continue;
    let s0 = 0, s1 = 0, s2 = 0, s3 = 0, s4 = 0, y0 = 0, y1 = 0, y2 = 0;
    for (let i = a; i <= b; i++) {
      const t = ts[i] - ts[k], y = ys[i], t2 = t * t;
      s0++; s1 += t; s2 += t2; s3 += t2 * t; s4 += t2 * t2; y0 += y; y1 += t * y; y2 += t2 * y;
    }
    const M = [[s0, s1, s2, y0], [s1, s2, s3, y1], [s2, s3, s4, y2]];
    for (let c = 0; c < 3; c++) {
      let p = c;
      for (let r = c + 1; r < 3; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
      [M[c], M[p]] = [M[p], M[c]];
      for (let r = 0; r < 3; r++) if (r !== c) {
        const f = M[r][c] / M[c][c];
        for (let q = c; q < 4; q++) M[r][q] -= f * M[c][q];
      }
    }
    max = Math.max(max, Math.abs(ys[k] - M[0][3] / M[0][0]));
  }
  return max;
}

// Coefficient of variation of the speed samples (displacement / frame time). Constant speed gives a small value.
function speedCV(ts, xs, zs, from) {
  const v = [];
  for (let k = from + 1; k < ts.length; k++) v.push(Math.hypot(xs[k] - xs[k - 1], zs[k] - zs[k - 1]) / (ts[k] - ts[k - 1]));
  const m = v.reduce((a, b) => a + b, 0) / v.length;
  const sd = Math.sqrt(v.reduce((a, b) => a + (b - m) * (b - m), 0) / v.length);
  return sd / m;
}

// Same projection as tests/camera.test.mjs: look-at camera, three.js convention.
function project(cam, aim, pt, fovDeg, aspect) {
  const f = [aim.x - cam.x, aim.y - cam.y, aim.z - cam.z];
  const fl = Math.hypot(...f), u = f.map(v => v / fl);
  let r = [-u[2], 0, u[0]];
  const rl = Math.hypot(...r);
  r = r.map(v => v / rl);
  const up = [r[1] * u[2] - r[2] * u[1], r[2] * u[0] - r[0] * u[2], r[0] * u[1] - r[1] * u[0]];
  const d = [pt.x - cam.x, pt.y - cam.y, pt.z - cam.z];
  const zc = d[0] * u[0] + d[1] * u[1] + d[2] * u[2], t = Math.tan(fovDeg * Math.PI / 360);
  return {x: (d[0] * r[0] + d[1] * r[1] + d[2] * r[2]) / zc / (t * aspect), y: (d[0] * up[0] + d[1] * up[1] + d[2] * up[2]) / zc / t};
}

// ---- Simulation: real physics, real chase camera, two render paths ---------------------------
// mode 'old': render the latest physics state (what game.js did before).
// mode 'new': render the interpolated state at physics.alpha (what game.js does now).
function simulate({hz, jitter = 0, mode, seconds = 14, warm = 10, seed = 12345, pauseEvery = 0}) {
  const dts = frameTimes({hz, jitter}, Math.round(seconds * hz * 1.2) + 10, seed);
  const world = createDrivingWorld({fixedStep: 1 / 120});
  const player = world.addVehicle({x: 0, z: 0, heading: 0, userData: {kind: 'player'}});
  const traffic = world.addVehicle({x: 6, z: -400, heading: 0});
  traffic.setTarget({vx: 0, vz: -12, heading: 0, maxAcceleration: 6});
  // Same object game.js uses: slot 0 = player, slot 1 = traffic. mode 'old' renders the live state (pre-fix path).
  const rs = new RenderState(2);
  rs.setActor(0, player);
  rs.setActor(1, traffic);
  const controls = {throttle: 1, reverse: 0, steer: 0, handbrake: false, boost: false, brake: 0};
  const cam = {x: -9.5, y: 3.1, z: 0}, car = {x: 0, z: 0};
  const p = {x: 0, z: 0, fx: 1, fz: 0, back: 9.5, lead: 0, height: 3.1, boxes: [], spheres: []};
  const pose = {x: 0, z: 0, heading: 0}, aim = {x: 0, y: 0, z: 0};
  const ts = [], px = [], pz = [], tx = [], tz = [], ndcX = [], ndcY = [];
  const pickPose = (slot, actor) => {
    if (mode === 'old') { pose.x = actor.x; pose.z = actor.z; pose.heading = actor.heading; }
    else rs.sample(slot, world.alpha, pose);
    return pose;
  };
  let t = 0, frame = 0;
  for (const dt of dts) {
    frame++;
    const paused = pauseEvery > 0 && frame % pauseEvery === 0;
    if (!paused) {
      world.step(dt, () => { rs.beginStep(); player.setControls(controls); });
      rs.endStep();
      rs.advance(dt);
    }
    t += dt;
    const ego = {...pickPose(0, player)};
    ts.push(t); px.push(ego.x); pz.push(ego.z);
    const tr = pickPose(1, traffic);
    tx.push(tr.x); tz.push(tr.z);
    // Camera: damped on the frame time, lead from the rendered car's speed, same order as game.js.
    const fwd = {x: -Math.sin(ego.heading), z: -Math.cos(ego.heading)};
    car.x = ego.x; car.z = ego.z;
    p.x = ego.x; p.z = ego.z; p.fx = fwd.x; p.fz = fwd.z; p.lead = chaseLead(player.forwardSpeed, dt);
    stepChaseCamera(cam, car, dt, p, ts.length === 1, null);
    chaseAim(cam, {x: ego.x, y: 0.6, z: ego.z}, 57, -0.5, aim);
    // Project a point 60 m ahead of the car (moves with the car; its NDC shows any camera jitter).
    const ahead = {x: ego.x + fwd.x * 60, y: 0.6, z: ego.z + fwd.z * 60};
    const s = project(cam, aim, ahead, 57, 16 / 9);
    ndcX.push(s.x); ndcY.push(s.y);
  }
  const from = ts.findIndex(x => x >= warm);
  return {
    egoResidual: maxQuadResidual(ts.slice(from), px.slice(from).map((x, i) => Math.hypot(x - px[from], pz[from + i] - pz[from])), 4),
    egoCV: speedCV(ts, px, pz, from),
    trafficResidual: maxQuadResidual(ts.slice(from), tx.slice(from).map((x, i) => Math.hypot(x - tx[from], tz[from + i] - tz[from])), 4),
    camNdcX: maxQuadResidual(ts.slice(from), ndcX.slice(from), 6),
    camNdcY: maxQuadResidual(ts.slice(from), ndcY.slice(from), 6),
  };
}

const RATES = [30, 60, 75, 90, 120, 144, 165];

test('interpolated render path: car, traffic and chase camera move smoothly at every frame rate and with frame-time jitter', () => {
  const cases = [...RATES.map(hz => ({hz})), {hz: 144, jitter: .15}, {hz: 60, jitter: .15}, {hz: 90, jitter: .15}];
  for (const c of cases) {
    const r = simulate({...c, mode: 'new'}), tag = JSON.stringify(c);
    assert.ok(r.egoResidual < 0.005, `${tag} car residual ${r.egoResidual} m`);
    assert.ok(r.trafficResidual < 0.005, `${tag} traffic residual ${r.trafficResidual} m`);
    assert.ok(r.camNdcX < 0.002 && r.camNdcY < 0.002, `${tag} camera NDC residual x ${r.camNdcX} y ${r.camNdcY}`);
    assert.ok(r.egoCV < 0.02, `${tag} speed CV ${r.egoCV}`);
  }
});

test('latest-state render path shows the stutter at 144 Hz and with jittered pacing (regression baseline)', () => {
  const bad = simulate({hz: 144, mode: 'old'}), good = simulate({hz: 144, mode: 'new'});
  assert.ok(bad.egoResidual > 0.05, `old 144 Hz residual ${bad.egoResidual}`);
  assert.ok(bad.camNdcY > 0.004, `old 144 Hz camera NDC residual ${bad.camNdcY}`);
  assert.ok(bad.egoCV > 0.2, `old 144 Hz speed CV ${bad.egoCV}`);
  assert.ok(good.egoResidual * 10 < bad.egoResidual);
  const jit = simulate({hz: 60, jitter: .15, mode: 'old'});
  assert.ok(jit.egoResidual > 0.05, `old jittered residual ${jit.egoResidual}`);
});

test('at 60 Hz (two steps per frame) both paths agree, so the fix does not change the reference motion', () => {
  const a = simulate({hz: 60, mode: 'old'}), b = simulate({hz: 60, mode: 'new'});
  assert.ok(Math.abs(a.egoCV - b.egoCV) < 0.002);
  assert.ok(b.egoResidual < 0.005 && a.egoResidual < 0.005);
});

test('PoseInterpolator: alpha blends the step before and the newest step, zero-step frames keep the blend moving', () => {
  const body = {x: 0, z: 0, heading: 0};
  const it = new PoseInterpolator(1);
  it.setActor(0, body);
  const out = {x: 0, z: 0, heading: 0};
  it.beginStep(); body.x = 1; body.z = 2; body.heading = 0.4; it.endStep();
  it.sample(0, 0, out); assert.deepEqual([out.x, out.z], [0, 0]);
  it.sample(0, 1, out); assert.deepEqual([out.x, out.z], [1, 2]);
  it.sample(0, 0.5, out); assert.ok(Math.abs(out.x - 0.5) < 1e-12 && Math.abs(out.heading - 0.2) < 1e-12);
  // A frame with no physics step keeps the same previous/newest pair; a larger alpha moves further.
  it.sample(0, 0.25, out); assert.ok(Math.abs(out.x - 0.25) < 1e-12);
  it.sample(0, 2, out); assert.equal(out.x, 1, 'alpha clamps to 1');
});

test('PoseInterpolator: heading interpolates along the shortest arc across +-pi', () => {
  const body = {x: 0, z: 0, heading: Math.PI - 0.05};
  const it = new PoseInterpolator(1);
  it.setActor(0, body);
  it.beginStep(); body.heading = -Math.PI + 0.05; it.endStep();
  const out = {x: 0, z: 0, heading: 0};
  it.sample(0, 0.5, out);
  assert.ok(Math.abs(wrapAngle(out.heading - Math.PI)) < 1e-9, `heading ${out.heading}`);
});

test('PoseInterpolator: snapSlot removes the blend after a teleport, and bad inputs throw', () => {
  const body = {x: 0, z: 0, heading: 0};
  const it = new PoseInterpolator(2);
  it.setActor(0, body);
  it.beginStep(); body.x = 10; it.endStep();
  body.x = -50;
  it.snapSlot(0);
  const out = {x: 0, z: 0, heading: 0};
  it.sample(0, 0.3, out);
  assert.equal(out.x, -50);
  assert.throws(() => it.setActor(2, body), RangeError);
  assert.throws(() => new PoseInterpolator(0), RangeError);
});

test('shadow anchor snaps to whole texels in light space and is stable under sub-texel motion', () => {
  const texel = 150 / 2048, light = [-140, 130, -130], out = {x: 0, y: 0, z: 0};
  const f = [140, -130, 130], fl = Math.hypot(...f); // view forward (light -> target)
  const fu = f.map(v => v / fl);
  let r = [-fu[2], 0, fu[0]]; const rl = Math.hypot(...r); r = r.map(v => v / rl);
  const u = [r[1] * fu[2] - r[2] * fu[1], r[2] * fu[0] - r[0] * fu[2], r[0] * fu[1] - r[1] * fu[0]];
  const proj = (p, axis) => p.x * axis[0] + p.y * axis[1] + p.z * axis[2];
  for (const [x, z] of [[0, 0], [123.4, -57.8], [-391.2, 260.9], [12.3, 4.5]]) {
    snapShadowAnchor(out, x, z, ...light, texel);
    const a = proj(out, r) / texel, b = proj(out, u) / texel;
    assert.ok(Math.abs(a - Math.round(a)) < 1e-6, `right ${a}`);
    assert.ok(Math.abs(b - Math.round(b)) < 1e-6, `up ${b}`);
    assert.ok(Math.hypot(out.x - x, out.y, out.z - z) < texel * 1.5, 'snap moves less than about a texel');
  }
  // Sweep a ground target across one texel in light-space right: the anchor may only jump in whole texels,
  // so at most two distinct anchors appear (one per rounding boundary crossed).
  const sweep = new Set();
  for (let s2 = 0; s2 < 1; s2 += 0.01) {
    const q = snapShadowAnchor({x: 0, y: 0, z: 0}, 100 + r[0] * texel * s2, -40 + r[2] * texel * s2, ...light, texel);
    sweep.add(Math.round(proj(q, r) / texel));
  }
  assert.ok(sweep.size <= 2, `anchor jumped in ${sweep.size} texel positions over one texel of motion`);
});

test('RenderState: zero-step frames still advance the render clock and the blended pose keeps moving', () => {
  const body = {x: 0, z: 0, heading: 0};
  const rs = new RenderState(1);
  rs.setActor(0, body);
  const out = {x: 0, z: 0, heading: 0};
  // One physics step of 1/120 s moves the body 1 m; the frame is 1/240 s, so no step and alpha 0.5 blended later.
  rs.beginStep(); body.x = 1; rs.endStep();
  assert.equal(rs.advance(1 / 240), 1 / 240);
  rs.sample(0, 0.5, out);
  assert.ok(Math.abs(out.x - 0.5) < 1e-12);
  // A second frame with no steps: the clock advances again and the blend moves further, no jump.
  assert.ok(Math.abs(rs.advance(1 / 240) - 2 / 240) < 1e-12);
  rs.sample(0, 1, out);
  assert.equal(out.x, 1);
});

test('RenderState: paused frames freeze the render clock', () => {
  const rs = new RenderState(1);
  rs.setActor(0, {x: 0, z: 0, heading: 0});
  rs.advance(0.1);
  assert.equal(rs.advance(0.5, true), 0.1);
  assert.equal(rs.advance(Number.NaN), 0.1);
  assert.equal(rs.advance(-1), 0.1);
  assert.equal(rs.time, 0.1);
});

test('RenderState: snapSlot (reset, teleport) removes the blend immediately', () => {
  const body = {x: 0, z: 0, heading: 0};
  const rs = new RenderState(1);
  rs.setActor(0, body);
  rs.beginStep(); body.x = 10; rs.endStep();
  body.x = -50;
  rs.snapSlot(0);
  const out = {x: 0, z: 0, heading: 0};
  rs.sample(0, 0.3, out);
  assert.equal(out.x, -50);
});

test('RenderState: during paused frames the render pose and clock are unchanged; they resume smoothly', () => {
  const world = createDrivingWorld({fixedStep: 1 / 120});
  const player = world.addVehicle({x: 0, z: 0, heading: 0});
  player.setPose({x: 0, z: 0, heading: 0, vz: -30});
  const rs = new RenderState(1);
  rs.setActor(0, player);
  const pose = {x: 0, z: 0, heading: 0};
  let lastZ = 0, lastTime = 0;
  const dt = 1 / 144;
  for (let frame = 1; frame <= 288; frame++) {
    const paused = frame % 9 === 0;
    if (!paused) {
      world.step(dt, () => rs.beginStep());
      rs.endStep();
    }
    rs.advance(dt, paused);
    rs.sample(0, world.alpha, pose);
    if (paused) {
      assert.equal(rs.time, lastTime, 'clock frozen while paused');
      assert.equal(pose.z, lastZ, 'pose frozen while paused');
    } else if (frame > 2) { // frame 1 has no physics step yet, so the pose is still at the start
      assert.ok(pose.z < lastZ, 'car keeps moving while running');
      const expected = player.vz * dt; // drag slows the car; compare with its live velocity
      assert.ok(Math.abs((pose.z - lastZ) - expected) < 0.02 * Math.abs(expected) + 0.002, `running displacement ${pose.z - lastZ} vs ${expected}`);
    }
    lastZ = pose.z; lastTime = rs.time;
  }
});
