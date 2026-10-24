import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const gameJsPath = path.resolve(__dirname, '../dist/game.js');
const gameJs = fs.readFileSync(gameJsPath, 'utf8');

test('P0 Optimization: Glass transmission pass is eliminated via material override in prepareRide', () => {
  assert.ok(gameJs.includes("o.material.transmission=0;"), 'Glass material transmission must be explicitly set to 0');
  assert.ok(gameJs.includes("o.material.transparent=true;"), 'Glass material must be transparent');
  assert.ok(gameJs.includes("o.material?.name==='Glass'"), 'Must target the Glass material specifically');
});

test('P0 Optimization: Route sample supports zero-allocation out-parameter and dual buffers', async () => {
  const { roundedRoute } = await import('../dist/traffic.js');
  const route = roundedRoute({ left: -450, right: 450, top: -600, bottom: 600 });
  
  // Test backward-compatibility when target is omitted
  const fresh = route.sample(100);
  assert.ok(fresh && typeof fresh.x === 'number');

  // Test zero-allocation mutation when target is passed
  const target = { x: 0, z: 0, dx: 0, dz: 0, curvature: 0, heading: 0 };
  const returned = route.sample(100, target);
  assert.equal(returned, target, 'Must return the exact same target struct');
  assert.ok(Number.isFinite(target.x));
  assert.ok(Number.isFinite(target.z));
});

test('P1 Optimization: Scalar accessors match actor.state without object allocations', async () => {
  const { createDrivingWorld } = await import('../dist/physics.js');
  const world = createDrivingWorld();
  const car = world.addVehicle({ x: 10, z: -25, heading: 0.5 });
  car.setPose({ x: 12, z: -30, heading: 0.4, vx: 5, vz: -10 });
  
  const s = car.state;
  assert.equal(car.x, s.x, 'actor.x must match state.x');
  assert.equal(car.z, s.z, 'actor.z must match state.z');
  assert.equal(car.heading, s.heading, 'actor.heading must match state.heading');
  assert.equal(car.vx, s.vx, 'actor.vx must match state.vx');
  assert.equal(car.vz, s.vz, 'actor.vz must match state.vz');
  assert.ok(Math.abs(car.speed - s.speed) < 1e-9, 'actor.speed must match state.speed');
  assert.ok(Math.abs(car.forwardSpeed - s.forwardSpeed) < 1e-9, 'actor.forwardSpeed must match state.forwardSpeed');
  assert.ok(Math.abs(car.lateralSpeed - s.lateralSpeed) < 1e-9, 'actor.lateralSpeed must match state.lateralSpeed');
  assert.equal(car.yawRate, s.yawRate, 'actor.yawRate must match state.yawRate');

  // copyState reuse test
  const reuse = {};
  const copyRet = car.copyState(reuse);
  assert.equal(copyRet, reuse, 'copyState must return the target struct');
  assert.equal(reuse.x, s.x);
  assert.equal(reuse.speed, s.speed);

  // Snapshot immutability test (before vs after move)
  const snapshotBefore = car.state;
  car.setPose({ x: 99, z: 150 });
  assert.equal(snapshotBefore.x, 12, 'Earlier snapshot must not mutate when actor moves');
  assert.equal(car.x, 99, 'Scalar accessor reflects current pose');
});

test('P1 Optimization: Fixed-harmonic AI stepping in game.js operates at 60 Hz', () => {
  assert.ok(gameJs.includes("if(++physicsStepCount%2===0)followTraffic(traffic,playerActor,fixed);"), 'Traffic AI must step on alternate fixed physics ticks');
  assert.ok(gameJs.includes("const beforeX=playerActor.x,beforeZ=playerActor.z;"), 'Odometer delta must use scalar accessors');
});

test('P1 Optimization: chase-camera building clamp pre-filters far boxes without changing results', async () => {
  const { clampDistance } = await import('../dist/camera-aim.js');
  const box = (x0, z0, x1, z1) => ({ min: { x: x0, y: 0, z: z0 }, max: { x: x1, y: 30, z: z1 } });
  // Ray from the car (origin 0,1.2,0) straight back along +z for 10 m.
  const far = box(40, -10, 60, 10), side = box(-300, 5, -280, 25), wall = box(-5, 6, 5, 8);
  assert.equal(clampDistance(0, 1.2, 0, 0, 0, 1, 10, 0.5, [far, side]), 10, 'far boxes never clamp');
  const hit = clampDistance(0, 1.2, 0, 0, 0, 1, 10, 0.5, [far, side, wall]);
  assert.ok(Math.abs(hit - (6 - 0.55)) < 1e-9, 'near wall still clamps to hit - 0.55');
  assert.equal(clampDistance(0, 1.2, 0, 0, 0, 1, 10, 0.5, [wall, far, side]), hit, 'box order does not matter');
  assert.equal(clampDistance(0, 1.2, 0, 0, 0, 1, 10, 6, [wall]), 6, 'minimum distance respected');
});

