import * as THREE from './vendor/three.module.js';

// Profiles live in ramp-shapes.js (measured from Kenney's ramp.glb, CC0).
// RAMP_SHAPE stays exported as the standard profile for existing callers.
import {RAMP_SHAPE} from './ramp-shapes.js';
export {RAMP_SHAPE};

// Returns an independent transform with shared source geometry/materials.
// The toe is (0, 0, 0), the high edge is (0, height, -length).
// Keeping a neutral outer group lets world placement replace position safely.
export function prepareRampModel(source, shape = RAMP_SHAPE) {
  const outer = new THREE.Group();
  outer.name = 'Kenney stunt ramp';
  const normalized = new THREE.Group();
  normalized.add(source.clone(true));
  const box = new THREE.Box3().setFromObject(normalized, true);
  const size = box.getSize(new THREE.Vector3());
  if (!(size.x > 0 && size.y > 0 && size.z > 0)) {
    throw new Error('Stunt ramp asset has invalid bounds');
  }
  normalized.scale.set(shape.width / size.x, shape.height / size.y, shape.length / size.z);
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
