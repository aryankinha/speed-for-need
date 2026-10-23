import test from 'node:test';
import assert from 'node:assert/strict';
import {makeBoxWindow, clampDistance} from '../dist/camera-aim.js';

const box = (x, z, w = 6, d = 6, h = 20) => ({min: {x: x - w / 2, y: 0, z: z - d / 2}, max: {x: x + w / 2, y: h, z: z + d / 2}});
let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;

test('windowed boxes give the same camera clamp as the full list while the car drives across the map', () => {
  const boxes = Array.from({length: 4000}, () => box(rnd() * 1200 - 600, rnd() * 1200 - 600, 2 + rnd() * 20, 2 + rnd() * 20));
  const win = makeBoxWindow();
  let x = -500, z = -500;
  for (let i = 0; i < 3000; i++) {
    x += 0.7 + rnd() * 0.3; z += 0.5 + rnd() * 0.3;
    const heading = rnd() * Math.PI * 2, dist = 8 + rnd() * 10, dx = Math.sin(heading), dz = Math.cos(heading);
    const dy = 0.2, len = Math.hypot(dx, dy, dz), args = [x, 1.2, z, dx / len, dy / len, dz / len, dist, 0.5];
    assert.equal(clampDistance(...args, win(boxes, x, z)), clampDistance(...args, boxes), `step ${i}`);
  }
});

test('the window is only rebuilt after the car moves, or when the box list changes or the car teleports', () => {
  const a = [box(0, 0), box(500, 500)], win = makeBoxWindow(60, 40);
  const first = win(a, 0, 0);
  assert.equal(first.length, 1);
  assert.strictEqual(win(a, 10, -10), first);
  assert.equal(win(a, 500, 500).length, 1);
  assert.equal(win(a, 500, 500)[0], a[1]);
  const b = [box(0, 0)];
  assert.notStrictEqual(win(b, 500, 500), first);
  assert.equal(win(b, 500, 500).length, 0);
});
