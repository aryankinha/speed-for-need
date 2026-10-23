import * as THREE from './vendor/three.module.js';
import {seeded} from './street-props.js';

// Sparse authored shrubs frame the parks. The existing PBR lawn provides grass
// coverage; no extra grass instances, animation shader or tyre-trail field.
export function parkPlants(plots,random=seeded(7203)){
 const shrubs=[];
 for(const plot of plots)for(const sx of [-1,1])for(const sz of [-1,1])for(let i=0;i<7;i++){
  shrubs.push({x:plot.x+sx*(15+i*4),z:plot.z+sz*44,ground:plot.ground,scale:1.6+random()*.6,rot:random()*6.28,park:plot});
 }
 return {shrubs};
}
export class ParkLife{
 constructor({scene,plots}){this.scene=scene;this.plots=plots;this.groups=[];}
 async load(loader){
  if(!this.plots.length)return;
  const {shrubs}=parkPlants(this.plots),root=(await loader.loadAsync('assets/park/shrub.glb')).scene;
  root.updateMatrixWorld(true);
  const sources=[];
  root.traverse(o=>{if(!o.isMesh)return;const geometry=o.geometry.clone().applyMatrix4(o.matrixWorld),material=o.material.clone();material.roughness=1;material.aoMap=null;sources.push({geometry,material});});
  const dummy=new THREE.Object3D();
  for(const plot of this.plots){
   const items=shrubs.filter(p=>p.park===plot),group=new THREE.Group();this.scene.add(group);this.groups.push({plot,group});
   for(const {geometry,material}of sources){
    const mesh=new THREE.InstancedMesh(geometry,material,items.length);
    items.forEach((p,i)=>{dummy.position.set(p.x,p.ground??.105,p.z);dummy.rotation.y=p.rot;dummy.scale.setScalar(p.scale);dummy.updateMatrix();mesh.setMatrixAt(i,dummy.matrix);});
    mesh.computeBoundingSphere();mesh.castShadow=false;mesh.receiveShadow=true;mesh.name='park-shrubs';group.add(mesh);
   }
  }
 }
 update(car){for(const {plot,group}of this.groups)group.visible=Math.hypot(car.x-plot.x,car.z-plot.z)<145;}
}
