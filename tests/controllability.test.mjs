import test from 'node:test';
import assert from 'node:assert/strict';
import {createDrivingWorld} from '../dist/physics.js';
import {smoothSteering} from '../dist/driving-input.js';

test('Controllability: Cruising speed turning radius fits comfortably within 22m city streets', () => {
  const world = createDrivingWorld();
  const car = world.addVehicle({ x: 0, z: 0 });
  
  // Test at 25 m/s (90 km/h)
  car.setPose({ x: 0, z: 0, vz: -25 });
  car.setControls({ throttle: 1, steer: 1 });
  
  let minRadius = Infinity;
  for (let i = 0; i < 240; i++) { // 2 seconds at 120 Hz
    world.step(1/120);
    const yaw = Math.abs(car.yawRate);
    if (yaw > 0.1) {
      const r = car.speed / yaw;
      if (r < minRadius) minRadius = r;
    }
  }
  
  // Must turn within 18 metres (down from the 63m baseline) to easily clear 22m road intersections
  assert.ok(minRadius <= 18, `Cruising turning radius must be <= 18m, got ${minRadius.toFixed(2)}m`);
  // Must rotate at least 120 degrees in 2 seconds of full lock at 90 km/h (baseline was only 44 degrees)
  assert.ok(Math.abs(car.heading) >= (120 * Math.PI / 180), `Final rotation must be >= 120 deg, got ${(Math.abs(car.heading)*180/Math.PI).toFixed(1)} deg`);
});

test('Controllability: Intersection speed (54 km/h) turning radius is under 8 metres', () => {
  const world = createDrivingWorld();
  const car = world.addVehicle({ x: 0, z: 0 });
  
  // Test at 15 m/s (54 km/h)
  car.setPose({ x: 0, z: 0, vz: -15 });
  car.setControls({ throttle: 1, steer: 1 });
  
  let minRadius = Infinity;
  for (let i = 0; i < 240; i++) {
    world.step(1/120);
    const yaw = Math.abs(car.yawRate);
    if (yaw > 0.1) {
      const r = car.speed / yaw;
      if (r < minRadius) minRadius = r;
    }
  }
  
  assert.ok(minRadius <= 8.5, `Intersection turning radius must be <= 8.5m, got ${minRadius.toFixed(2)}m`);
});

test('Controllability: Standstill forward pull-away rotates immediately without dead zone', () => {
  const world = createDrivingWorld();
  const car = world.addVehicle({ x: 0, z: 0 });
  car.setControls({ throttle: 1, steer: 1 });
  
  // Simulate 0.5 seconds from dead stop
  for (let i = 0; i < 60; i++) world.step(1/120);
  
  const headingDeg = Math.abs(car.heading) * 180 / Math.PI;
  // Previously only turned 7 degrees in 0.5s; with low-speed assist turns > 18 degrees
  assert.ok(headingDeg >= 18, `Standstill 0.5s turn must be >= 18 deg, got ${headingDeg.toFixed(1)} deg`);
  assert.ok(Math.abs(car.yawRate) >= 0.8, `Standstill yaw rate must be >= 0.8 rad/s, got ${Math.abs(car.yawRate).toFixed(2)}`);
});

test('Controllability: Standstill reverse pull-away rotates immediately without dead zone', () => {
  const world = createDrivingWorld();
  const car = world.addVehicle({ x: 0, z: 0 });
  car.setControls({ reverse: 1, steer: 1 });
  
  // Simulate 0.5 seconds in reverse from dead stop
  for (let i = 0; i < 60; i++) world.step(1/120);
  
  const headingDeg = Math.abs(car.heading) * 180 / Math.PI;
  assert.ok(headingDeg >= 15, `Reverse 0.5s turn must be >= 15 deg, got ${headingDeg.toFixed(1)} deg`);
});

test('Controllability: Handbrake increases yaw authority for power sliding rather than understeering', () => {
  const worldNormal = createDrivingWorld();
  const carNormal = worldNormal.addVehicle({ x: 0, z: 0 });
  carNormal.setPose({ x: 0, z: 0, vz: -25 });
  carNormal.setControls({ throttle: 1, steer: 1, handbrake: false });
  for (let i = 0; i < 60; i++) worldNormal.step(1/120);
  
  const worldDrift = createDrivingWorld();
  const carDrift = worldDrift.addVehicle({ x: 0, z: 0 });
  carDrift.setPose({ x: 0, z: 0, vz: -25 });
  carDrift.setControls({ throttle: 1, steer: 1, handbrake: true });
  for (let i = 0; i < 60; i++) worldDrift.step(1/120);
  
  // Handbrake should promote oversteer yaw rotation (yaw rate must equal or exceed normal steering)
  assert.ok(Math.abs(carDrift.yawRate) >= Math.abs(carNormal.yawRate), 
    `Handbrake yaw rate (${Math.abs(carDrift.yawRate).toFixed(2)}) must not understeer below normal (${Math.abs(carNormal.yawRate).toFixed(2)})`);
});

test('Controllability: Input damping response provides rapid turn-in while remaining stable', () => {
  // Check responsiveness at 90 km/h (25 m/s)
  const dt = 1/60;
  let steer = 0;
  for (let i = 0; i < 6; i++) { // 100 ms (6 frames)
    steer = smoothSteering(steer, 1, 25, dt);
  }
  // At 100ms, steer should be at least 50% lock (previously took >250ms)
  assert.ok(steer >= 0.50, `100ms steering response must reach >= 50% lock, got ${(steer*100).toFixed(1)}%`);
});
