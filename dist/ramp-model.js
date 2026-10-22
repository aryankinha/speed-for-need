import * as THREE from './vendor/three.module.js';

// Measured from Kenney's original ramp.glb (CC0), not an invented curve.
// Its deck is one straight incline followed by a short horizontal lip.
const slopeRun = 10 * (0.6604167819023132 / 0.7300000190734863);
export const RAMP_SHAPE = Object.freeze({
  width: 4.6,
  length: 10,
  height: 3.4,
  slopeRun,
  angle: Math.atan2(3.4, slopeRun),
});

// Returns an independent transform with shared source geometry/materials.
// The toe is (0, 0, 0), the high edge is (0, height, -length).
// Keeping a neutral outer group lets world placement replace position safely.
export function prepareRampModel(source) {
  const outer = new THREE.Group();
  outer.name = 'Kenney stunt ramp';
  const normalized = new THREE.Group();
  normalized.add(source.clone(true));
  const box = new THREE.Box3().setFromObject(normalized, true);
  const size = box.getSize(new THREE.Vector3());
  if (!(size.x > 0 && size.y > 0 && size.z > 0)) {
    throw new Error('Stunt ramp asset has invalid bounds');
  }
  normalized.scale.set(RAMP_SHAPE.width / size.x, RAMP_SHAPE.height / size.y, RAMP_SHAPE.length / size.z);
  normalized.updateMatrixWorld(true);
  box.setFromObject(normalized, true);
  normalized.position.set(-(box.min.x + box.max.x) / 2, -box.min.y, -box.max.z);
  normalized.traverse(node => {
    if (node.isMesh) {
      node.castShadow = true;
      node.receiveShadow = true;
    }
  });
  outer.add(normalized);
  outer.updateMatrixWorld(true);
  return outer;
}
