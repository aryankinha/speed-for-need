import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as THREE from '../dist/vendor/three.module.js';
import {prepareRampModel, RAMP_SHAPE} from '../dist/ramp-model.js';

// Read the actual downloaded GLB positions, including its authored node offset.
// No browser texture loader is needed: this model has no texture dependencies.
function sourceRamp() {
  const bytes = readFileSync(new URL('../dist/assets/stunt-ramp.glb', import.meta.url));
  const jsonLength = bytes.readUInt32LE(12);
  const gltf = JSON.parse(bytes.subarray(20, 20 + jsonLength));
  const binStart = 28 + jsonLength;
  const primitive = gltf.meshes[0].primitives[0];
  const accessor = gltf.accessors[primitive.attributes.POSITION];
  const view = gltf.bufferViews[accessor.bufferView];
  const start = binStart + (view.byteOffset || 0) + (accessor.byteOffset || 0);
  const positions = new Float32Array(accessor.count * 3);
  for (let i = 0; i < positions.length; i++) positions[i] = bytes.readFloatLE(start + i * 4);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial());
  mesh.position.fromArray(gltf.nodes[0].translation);
  const source = new THREE.Group();
  source.add(mesh);
  return {source, mesh, positions};
}

const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-5, `${a} should equal ${b}`);

test('authored ramp normalizes real source offsets to a neutral toe transform', () => {
  const {source, mesh} = sourceRamp();
  const original = mesh.position.clone();
  const model = prepareRampModel(source);
  const bounds = new THREE.Box3().setFromObject(model, true);
  near(bounds.min.x, -RAMP_SHAPE.width / 2);
  near(bounds.max.x, RAMP_SHAPE.width / 2);
  near(bounds.min.y, 0);
  near(bounds.max.y, RAMP_SHAPE.height);
  near(bounds.min.z, -RAMP_SHAPE.length);
  near(bounds.max.z, 0);
  assert.deepEqual(model.position.toArray(), [0, 0, 0]);
  assert.deepEqual(model.scale.toArray(), [1, 1, 1]);
  assert.ok(mesh.position.equals(original));
  const clone = model.children[0].children[0].children[0];
  assert.equal(clone.geometry, mesh.geometry);
  assert.equal(clone.material, mesh.material);
});

test('ramp physics incline agrees with the downloaded deck and its horizontal lip', () => {
  const {positions} = sourceRamp();
  let lipStart = Infinity;
  let sourceLength = 0;
  for (let i = 0; i < positions.length; i += 3) {
    if (positions[i + 1] > .32999) lipStart = Math.min(lipStart, -positions[i + 2]);
    sourceLength = Math.max(sourceLength, -positions[i + 2]);
  }
  near(RAMP_SHAPE.slopeRun, lipStart / sourceLength * RAMP_SHAPE.length);
  near(Math.tan(RAMP_SHAPE.angle), RAMP_SHAPE.height / RAMP_SHAPE.slopeRun);
  assert.ok(RAMP_SHAPE.slopeRun < RAMP_SHAPE.length);
});
