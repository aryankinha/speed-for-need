// Reuses the downloaded vehicle and city. Platform meshes use Three.js built-in
// Cylinder/RingGeometry; this is scenery staging, not a replacement car model.
import * as THREE from 'three';
export class CarShowroom {
  constructor({scene,camera,rides}){
    this.camera=camera;this.position=new THREE.Vector3(-478,0,75);this.root=new THREE.Group();this.root.position.copy(this.position);scene.add(this.root);this.turntable=new THREE.Group();this.root.add(this.turntable);this.cars={};
    const base=new THREE.Mesh(new THREE.CylinderGeometry(4.5,4.7,.28,64),new THREE.MeshStandardMaterial({color:0x273636,metalness:.65,roughness:.36}));base.position.y=.04;base.receiveShadow=true;this.root.add(base);
    const deck=new THREE.Mesh(new THREE.CylinderGeometry(3.95,3.95,.12,64),new THREE.MeshPhysicalMaterial({color:0x3d4a48,metalness:.4,roughness:.34,clearcoat:.35}));deck.position.y=.24;deck.receiveShadow=true;this.turntable.add(deck);
    const trimMat=new THREE.MeshBasicMaterial({color:0xfcaf17,toneMapped:false});for(const r of [4.02,4.4]){const trim=new THREE.Mesh(new THREE.TorusGeometry(r,.025,5,80),trimMat);trim.rotation.x=Math.PI/2;trim.position.y=.19;this.root.add(trim);}
    for(const [name,ride] of Object.entries(rides)){const clone=ride.group.clone(true);clone.position.y=.31;clone.scale.multiplyScalar(1.15);clone.visible=name==='concept';this.turntable.add(clone);this.cars[name]=clone;}
    this.fill=new THREE.DirectionalLight(0xd7ecff,1.5);this.fill.position.set(-12,5,9);this.fill.target.position.set(0,1,0);this.root.add(this.fill,this.fill.target);
    this.reduced=globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches??false;this.angle=1.4;this.root.visible=false;
  }
  select(name){for(const [id,car] of Object.entries(this.cars))car.visible=id===name;}
  show(name){this.root.visible=true;this.select(name);this.frame();}
  hide(){this.root.visible=false;}
  frame(){
    // A low three-quarter camera from the beach: the real city fills the horizon.
    const portrait=this.camera.aspect<1;
    this.camera.position.set(this.position.x-(portrait?10.5:9.3),portrait?4.2:3.4,this.position.z+(portrait?8.8:7.6));
    const target=(this.target??=new THREE.Vector3()).set(this.position.x+(portrait?0:-1.8),1.1,this.position.z+(portrait?0:1.2));this.camera.lookAt(target);this.camera.fov=portrait?52:48;this.camera.updateProjectionMatrix();
  }
  update(dt){if(!this.root.visible)return;if(!this.reduced)this.angle+=Math.min(dt,.05)*.18;this.turntable.rotation.y=this.angle;this.frame();}
}
