import * as THREE from './vendor/three.module.js';
// The existing presentation platform, now staged inside the garage.
export function addVehiclePlatform(root,turntable){
 const base=new THREE.Mesh(new THREE.CylinderGeometry(3.5,3.65,.22,48),new THREE.MeshStandardMaterial({color:0x273636,metalness:.65,roughness:.36}));base.position.y=.04;base.receiveShadow=true;root.add(base);
 const deck=new THREE.Mesh(new THREE.CylinderGeometry(3.25,3.25,.1,48),new THREE.MeshPhysicalMaterial({color:0x3d4a48,metalness:.4,roughness:.34,clearcoat:.35}));deck.position.y=.2;deck.receiveShadow=true;turntable.add(deck);
 const material=new THREE.MeshBasicMaterial({color:0xfcaf17,toneMapped:false});for(const r of [3.3,3.52]){const ring=new THREE.Mesh(new THREE.TorusGeometry(r,.022,5,64),material);ring.rotation.x=Math.PI/2;ring.position.y=.17;root.add(ring);}
}
