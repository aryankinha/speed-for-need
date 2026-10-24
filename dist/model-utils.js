import * as THREE from './vendor/three.module.js';
export function normalize(root,length,axis='z'){
  root.updateMatrixWorld(true);let b=new THREE.Box3().setFromObject(root,true);const dimensions=b.getSize(new THREE.Vector3());const group=new THREE.Group();group.add(root);root.scale.multiplyScalar(length/dimensions[axis]);root.updateMatrixWorld(true);b=new THREE.Box3().setFromObject(root,true);const center=b.getCenter(new THREE.Vector3());root.position.x-=center.x;root.position.z-=center.z;root.position.y-=b.min.y;group.updateMatrixWorld(true);return group;
}
