import * as THREE from './vendor/three.module.js';
// Stationary collection lineup. Geometry/materials are shared with the garage;
// only the equipped car advances toward the camera, with no auto rotation.
export class CarShowroom{
 constructor({scene,camera,rides}){
  this.camera=camera;this.position=new THREE.Vector3(-478,0,75);this.root=new THREE.Group();this.root.name='Home vehicle lineup';this.root.position.copy(this.position);scene.add(this.root);this.cars={};this.selected=null;this.angle=0;this.reduced=globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches??false;
  const ids=Object.keys(rides);this.span=(ids.length-1)*2.9+2.8;ids.forEach((id,i)=>{const car=rides[id].group.clone(true);car.position.set((i-(ids.length-1)/2)*2.9,.015,0);car.visible=true;this.root.add(car);this.cars[id]=car;});
  this.fill=new THREE.DirectionalLight(0xd7ecff,1.5);this.fill.position.set(-12,7,-9);this.fill.target.position.set(0,1,0);this.root.add(this.fill,this.fill.target);this.target=new THREE.Vector3();this.root.visible=false;
 }
 select(id){if(!this.cars[id])return false;this.selected=id;for(const [name,car]of Object.entries(this.cars)){car.visible=true;if(this.reduced)car.position.z=name===id?-1.35:0;}return true;}
 show(id){this.root.visible=true;this.select(id);for(const [name,car]of Object.entries(this.cars))car.position.z=name===id?-1.35:0;this.frame();}
 hide(){this.root.visible=false;}
 frame(){const portrait=this.camera.aspect<1,fov=portrait?54:48,distance=Math.max(12,this.span*.57/(Math.tan(THREE.MathUtils.degToRad(fov/2))*this.camera.aspect));this.camera.position.set(this.position.x-2.2,2.8+distance*.12,this.position.z-distance);this.target.set(this.position.x,.1,this.position.z);this.camera.up.set(0,1,0);this.camera.lookAt(this.target);this.camera.fov=fov;this.camera.near=.12;this.camera.updateProjectionMatrix();}
 update(dt){if(!this.root.visible)return;for(const [id,car]of Object.entries(this.cars))car.position.z=this.reduced?(id===this.selected?-1.35:0):THREE.MathUtils.damp(car.position.z,id===this.selected?-1.35:0,7,Math.max(0,Math.min(dt,.1)));this.frame();}
}
