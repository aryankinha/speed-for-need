import test from 'node:test';
import assert from 'node:assert/strict';
import {chaseAim, chaseLead, chaseCameraGoal, stepChaseCamera, clampDistance, pushOutOfCar,
  CHASE_BUMPER, CHASE_MIN_CENTRE, CHASE_OVERHEAD_Y, CHASE_OVERHEAD_BACK, CHASE_TRAFFIC_LIFT, CHASE_ROAD_R} from '../dist/camera-aim.js';

// Projects a world point through a look-at camera (three.js convention: right = forward x up, camera looks down -z).
function project(cam, aim, car, vfovDeg, aspect) {
  const sub = (a, b) => ({x: a.x - b.x, y: a.y - b.y, z: a.z - b.z});
  const cross = (a, b) => ({x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x});
  const norm = a => { const l = Math.hypot(a.x, a.y, a.z); return {x: a.x / l, y: a.y / l, z: a.z / l}; };
  const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
  const f = norm(sub(aim, cam));
  const r = norm(cross(f, {x: 0, y: 1, z: 0}));
  const u = cross(r, f);
  const p = sub(car, cam);
  const zc = dot(p, f), t = Math.tan(vfovDeg * Math.PI / 360);
  return {ndcX: dot(p, r) / zc / (t * aspect), ndcY: dot(p, u) / zc / t};
}

const wall = x => ({min: {x: x - 20, y: -1, z: -40}, max: {x, y: 30, z: 40}}); // vertical slab at plane x
const noSpheres = [];
const centreDist = (c, car) => Math.hypot(c.x - car.x, c.y - car.y, c.z - car.z);
const params = (over = {}) => ({x: 0, z: 0, fx: 1, fz: 0, back: 9.5, lead: 0, height: 3.1, boxes: [], spheres: noSpheres, ...over});

test('chase aim centres the car horizontally and places it at NDC y -0.5 for every FOV, aspect and pose', () => {
  const out = {x: 0, y: 0, z: 0};
  const poses = [
    {back: 9.5, height: 3.1, heading: 0}, {back: 10.4, height: 3.1, heading: 0.7},
    {back: 9.5, height: 3.1, heading: 2.5}, {back: 16, height: 5.1, heading: -1.2}, {back: 7.8, height: 3.1, heading: 3.0},
  ];
  for (const fov of [57, 67, 70]) for (const aspect of [16 / 9, 9 / 16]) for (const p of poses) {
    const car = {x: 120, y: 0.6, z: -40};
    const fwd = {x: -Math.sin(p.heading), z: -Math.cos(p.heading)};
    const cam = {x: car.x - fwd.x * p.back, y: p.height, z: car.z - fwd.z * p.back};
    chaseAim(cam, car, fov, -0.5, out);
    const s = project(cam, out, car, fov, aspect);
    assert.ok(Math.abs(s.ndcY + 0.5) < 1e-9, `fov ${fov} aspect ${aspect.toFixed(2)} ${JSON.stringify(p)} ndcY ${s.ndcY}`);
    assert.ok(Math.abs(s.ndcX) < 1e-9, `fov ${fov} aspect ${aspect.toFixed(2)} ${JSON.stringify(p)} ndcX ${s.ndcX}`);
  }
});

test('aim honours a non-default NDC target (-0.45) for a car anchored at 0.6 m', () => {
  const out = {x: 0, y: 0, z: 0}, car = {x: 0, y: 0.6, z: 0}, cam = {x: 0, y: 3.1, z: 9.5};
  chaseAim(cam, car, 57, -0.45, out);
  assert.ok(Math.abs(project(cam, out, car, 57, 16 / 9).ndcY + 0.45) < 1e-9);
});

test('chase lead is zero without elapsed time and never produces NaN', () => {
  assert.equal(chaseLead(40, 0), 0);
  assert.equal(chaseLead(0, 1 / 60), 0);
  assert.ok(Number.isFinite(chaseLead(40, 1e-9)));
});

test('stepChaseCamera settles at the nominal distance and NDC -0.5 at 30, 60 and 144 fps', () => {
  for (const back of [9.5, 16]) for (const speed of [12, 40]) for (const fps of [30, 60, 144]) {
    const dt = 1 / fps, car = {x: 0, z: 0}, cam = {x: -back, y: 3.1, z: 0}, p = params({back});
    let pos = 0;
    for (let i = 0; i < fps * 20; i++) {
      pos += speed * dt;
      car.x = pos; car.z = 0;
      p.x = pos; p.lead = chaseLead(speed, dt);
      stepChaseCamera(cam, car, dt, p, false, null);
    }
    const carPt = {x: pos, y: 0.6, z: 0};
    assert.ok(Math.abs(pos - cam.x - back) < 1e-3, `back ${back} speed ${speed} fps ${fps}: distance ${pos - cam.x}`);
    const aim = chaseAim(cam, carPt, 57, -0.5, {x: 0, y: 0, z: 0});
    assert.ok(Math.abs(project(cam, aim, carPt, 57, 16 / 9).ndcY + 0.5) < 1e-9, `fps ${fps} NDC`);
  }
});

test('building clamp stops the ray at the wall minus 0.55 m, never closer than the minimum', () => {
  const o = {x: 0, y: 1.2, z: 0}, dir = {x: -1, y: 0, z: 0}, max = 7.1, minD = CHASE_MIN_CENTRE - CHASE_BUMPER;
  assert.equal(clampDistance(o.x, o.y, o.z, dir.x, dir.y, dir.z, max, minD, [wall(-3)]), 2.45);
  assert.equal(clampDistance(o.x, o.y, o.z, dir.x, dir.y, dir.z, max, minD, [wall(-1.5)]), minD);
  assert.equal(clampDistance(o.x, o.y, o.z, dir.x, dir.y, dir.z, max, minD, [wall(-12)]), max);
  assert.equal(clampDistance(o.x, o.y, o.z, dir.x, dir.y, dir.z, max, minD, []), max);
});

test('traffic never clamps or triggers the overhead view, it only lifts the camera when a car sits under it', () => {
  const out = {x: 0, y: 0, z: 0, clamped: false};
  // Car 6 m behind the player: camera goal is 9.5 m back, so the traffic car is 3.5 m from the camera goal.
  chaseCameraGoal(params({spheres: [{x: -6, z: 0, r: CHASE_ROAD_R}]}), out);
  assert.equal(out.clamped, false);
  assert.ok(Math.abs(out.x + 9.5) < 1e-9 && Math.abs(out.y - 3.1) < 1e-9, 'no lift, no overhead');
  // Tailgating at 8 m: traffic car lies under the camera goal, lift the camera over it.
  chaseCameraGoal(params({spheres: [{x: -8, z: 0, r: CHASE_ROAD_R}]}), out);
  assert.equal(out.clamped, false);
  assert.ok(Math.abs(out.y - (3.1 + CHASE_TRAFFIC_LIFT)) < 1e-9, `lift ${out.y}`);
  assert.ok(Math.abs(out.x + 9.5) < 1e-9, 'horizontal position unchanged');
});

test('camera never sits inside a static wall or closer than the minimum to the car centre, for walls at any distance', () => {
  const out = {x: 0, y: 0, z: 0, clamped: false};
  for (let e = 0.5; e <= 9; e += 0.25) {
    const wallX = -(CHASE_BUMPER + e); // wall plane e metres behind the rear bumper
    chaseCameraGoal(params({boxes: [wall(wallX)]}), out);
    assert.ok(out.x >= wallX - 1e-6, `wall ${e}: camera behind wall at x=${out.x}`);
    const d = centreDist(out, {x: 0, y: 0.6, z: 0});
    assert.ok(d >= CHASE_MIN_CENTRE - 1e-6, `wall ${e}: centre distance ${d}`);
  }
});

test('a wall right behind the bumper gives the overhead view, clear of the car roof and the wall', () => {
  const out = {x: 0, y: 0, z: 0, clamped: false};
  chaseCameraGoal(params({boxes: [wall(-CHASE_BUMPER - 0.5)]}), out);
  assert.ok(Math.abs(out.x + CHASE_OVERHEAD_BACK) < 1e-9 && Math.abs(out.y - CHASE_OVERHEAD_Y) < 1e-9, `${out.x},${out.y}`);
  assert.ok(out.y > 1.3 + 1, 'above the car roof');
});

test('an unobstructed chase goal is the point behind the car at the chase height', () => {
  const out = {x: 0, y: 0, z: 0, clamped: false};
  chaseCameraGoal(params({x: 10, z: 5, fx: 0, fz: 1}), out);
  assert.equal(out.clamped, false);
  assert.ok(Math.abs(out.x - 10) < 1e-9 && Math.abs(out.y - 3.1) < 1e-9 && Math.abs(out.z - (5 - 9.5)) < 1e-9);
});

test('a camera cut lands on the settled point (no lead) whether or not a wall clamps it', () => {
  const cam = {x: 0, y: 0, z: 0};
  stepChaseCamera(cam, {x: 0, z: 0}, 1 / 60, params({x: 0, z: 0, fx: 0, fz: 1, lead: 2.5, back: 9.5}), true, null);
  assert.ok(Math.abs(cam.z - -9.5) < 1e-9, `unclamped cut z=${cam.z}`);
  const cam3 = {x: 0, y: 0, z: 0};
  stepChaseCamera(cam3, {x: 0, z: 0}, 1 / 60, params({x: 0, z: 0, fx: 1, fz: 0, lead: 2.5, back: 9.5, boxes: [wall(-CHASE_BUMPER - 3)]}), true, null);
  assert.ok(Math.hypot(cam3.x, cam3.y - 0.6, cam3.z) >= CHASE_MIN_CENTRE - 1e-6, 'clamped cut stays outside the minimum radius');
  assert.ok(cam3.x >= -(CHASE_BUMPER + 3) - 1e-6, 'clamped cut stays in front of the wall');
});

test('at 40 m/s the chase camera stays on the chase ramp, not the overhead view', () => {
  const cam = {x: -9.5, y: 3.1, z: 0}, car = {x: 0, z: 0}, dt = 1 / 60, p = params({lead: chaseLead(40, dt)});
  let maxW = 0;
  for (let i = 0; i < 600; i++) { p.x += 40 * dt; car.x = p.x; p.lead = chaseLead(40, dt); maxW = Math.max(maxW, stepChaseCamera(cam, car, dt, p, false, null).w); }
  assert.equal(maxW, 0);
  assert.ok(Math.abs(cam.y - 3.1) < 1e-6, `height ${cam.y}`);
});

test('shake is applied before the minimum-radius push, so it cannot pull the camera into the car', () => {
  const cam = {x: -9.5, y: 3.1, z: 0}, car = {x: 0, z: 0};
  stepChaseCamera(cam, car, 1e-6, params(), false, {x: 6, y: 0});
  assert.ok(centreDist(cam, {x: 0, y: 0.6, z: 0}) >= CHASE_MIN_CENTRE - 1e-6, `after shake ${centreDist(cam, {x: 0, y: 0.6, z: 0})}`);
});

test('a damped step between two valid goals that cuts through the minimum radius is pushed back out', () => {
  const car = {x: 0, z: 0}, a = {x: -4.6, y: 3.0, z: 0}, b = {x: 0.5, y: 5.2, z: 0};
  const mid = {x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: 0};
  assert.ok(centreDist(mid, {x: 0, y: 0.6, z: 0}) < CHASE_MIN_CENTRE, 'chord really dips inside the radius');
  pushOutOfCar(mid, car);
  assert.ok(Math.abs(centreDist(mid, {x: 0, y: 0.6, z: 0}) - CHASE_MIN_CENTRE) < 1e-9);
});

test('jump camera translates its goal, aim and minimum car distance with altitude',()=>{
  const ground={x:12,y:0,z:40,fx:0,fz:-1,back:9.5,lead:0,height:3.1,boxes:[],spheres:[]};
  const a={},b={};chaseCameraGoal(ground,a);chaseCameraGoal({...ground,y:17},b);
  assert.ok(Math.abs(b.x-a.x)<1e-9&&Math.abs(b.z-a.z)<1e-9);
  assert.ok(Math.abs(b.y-a.y-17)<1e-9);
  const cam={x:ground.x,y:17.7,z:ground.z+.2};pushOutOfCar(cam,{x:ground.x,y:17,z:ground.z});
  assert.ok(Math.abs(Math.hypot(cam.x-ground.x,cam.y-17.6,cam.z-ground.z)-CHASE_MIN_CENTRE)<1e-9);
  for(const hz of [30,60,144]){
    const camera={x:12,y:20.1,z:49.5};const car={x:12,y:17,z:40};const aim={};
    stepChaseCamera(camera,car,1/hz,{...ground,y:17},true,null);chaseAim(camera,{...car,y:17.6},57,-.5,aim);
    const screen=project(camera,aim,{...car,y:17.6},57,16/9);
    assert.ok(Math.abs(screen.ndcY+.5)<1e-9);
  }
});
