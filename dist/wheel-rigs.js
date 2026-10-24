import * as THREE from './vendor/three.module.js';
export function findSourceNode(root,name){const key=name.replace(/[^a-zA-Z0-9_]/g,'');let found=null;root.traverse(node=>{if(node.name===name||node.name.replace(/[^a-zA-Z0-9_]/g,'')===key)found=node;});return found;}
// Reparent authored geometry without moving a vertex. Each neutral wrapper has
// source-world axes even when the model's original hierarchy is nested/rotated.
export function floatGeometry(source,indices=null){
  const geometry=new THREE.BufferGeometry(),used=indices?[...new Set(indices)]:null,remap=used?new Map(used.map((n,i)=>[n,i])):null;
  for(const [name,attribute]of Object.entries(source.attributes)){const count=used?.length??attribute.count,values=new Float32Array(count*attribute.itemSize);for(let i=0;i<count;i++)for(let k=0;k<attribute.itemSize;k++)values[i*attribute.itemSize+k]=attribute.getComponent(used?used[i]:i,k);geometry.setAttribute(name,new THREE.BufferAttribute(values,attribute.itemSize));}
  if(indices)geometry.setIndex(indices.map(i=>remap.get(i)));else if(source.index)geometry.setIndex(source.index.clone());
  return geometry;
}
export function centeredWheel(root,nodes,name,front){
  root.updateMatrixWorld(true);const bounds=new THREE.Box3();for(const n of nodes)bounds.union(new THREE.Box3().setFromObject(n,true));
  if(bounds.isEmpty())throw new Error(`Wheel ${name} has no geometry`);
  const size=bounds.getSize(new THREE.Vector3()),center=bounds.getCenter(new THREE.Vector3()),pivot=new THREE.Group();pivot.name=`WheelPivot_${name}`;pivot.position.copy(center);pivot.updateMatrixWorld();root.attach(pivot);
  // Bake only the wheel's existing vertices. This avoids decomposition shear
  // in quantized GLTF hierarchies and does not generate replacement geometry.
  for(const n of nodes){n.traverse(mesh=>{if(!mesh.isMesh)return;const geometry=floatGeometry(mesh.geometry);geometry.applyMatrix4(mesh.matrixWorld);geometry.translate(-center.x,-center.y,-center.z);const part=new THREE.Mesh(geometry,mesh.material);part.name=mesh.name;part.castShadow=mesh.castShadow;part.receiveShadow=mesh.receiveShadow;pivot.add(part);});n.removeFromParent();}
  root.updateMatrixWorld(true);const inverseParent=root.getWorldQuaternion(new THREE.Quaternion()).invert();
  return {node:pivot,front,base:pivot.quaternion.clone(),spinAxis:new THREE.Vector3(1,0,0),steerAxis:new THREE.Vector3(0,1,0).applyQuaternion(inverseParent),sourceRadius:Math.max(size.y,size.z)/2,rollSign:1};
}
// BMW's author merged the four wheels by material. Split only those verified
// wheel meshes by axle/side; preserve every original triangle and attribute.
export function splitBMWheels(root){
  root.updateMatrixWorld(true);const groups=Array.from({length:4},(_,i)=>{const g=new THREE.Group();g.name=`BMWAuthoredWheel_${i}`;root.add(g);return g;});
  for(const name of ['Object_6','Object_7','Object_8','Object_13','Object_14']){
    const mesh=findSourceNode(root,name);if(!mesh?.isMesh)throw new Error(`Missing BMW wheel geometry ${name}`);
    const geometry=mesh.geometry,position=geometry.attributes.position,index=geometry.index,buckets=[[],[],[],[]],a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3();
    for(let i=0;i<(index?.count??position.count);i+=3){const ids=[0,1,2].map(k=>index?index.getX(i+k):i+k);a.fromBufferAttribute(position,ids[0]).applyMatrix4(mesh.matrixWorld);b.fromBufferAttribute(position,ids[1]).applyMatrix4(mesh.matrixWorld);c.fromBufferAttribute(position,ids[2]).applyMatrix4(mesh.matrixWorld);const x=(a.x+b.x+c.x)/3,z=(a.z+b.z+c.z)/3;buckets[(x>0?1:0)+(z>0?2:0)].push(...ids);}
    for(let i=0;i<4;i++){if(!buckets[i].length)throw new Error(`BMW ${name} missing quadrant ${i}`);const g=floatGeometry(geometry,buckets[i]);g.applyMatrix4(mesh.matrixWorld);const part=new THREE.Mesh(g,mesh.material);part.name=`${name}_wheel${i}`;part.matrixAutoUpdate=false;part.matrix.copy(new THREE.Matrix4().copy(root.matrixWorld).invert());groups[i].add(part);}
    mesh.removeFromParent();
  }
  return groups.map((node,i)=>centeredWheel(root,[node],`BMW_${i}`,i>=2));
}
