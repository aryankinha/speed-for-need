import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {STREET_WORLD} from './street-layout.js';
// Downloads supply every facade, building, tree and lamp. Only street surfaces and markings are primitives.
export async function buildStreetWorld({scene,physics,models,anisotropy=4}){
 const root=new THREE.Group();root.name='FreeCityStreetStudy';scene.add(root);const obstacles=[],buildingLots=[],interactiveProps=[],interactiveTemplates={},bins=new Map();let buildings=0;
 const texture=async(name,srgb=false)=>{const t=await new THREE.TextureLoader().loadAsync('assets/'+name);t.wrapS=t.wrapT=THREE.RepeatWrapping;t.anisotropy=anisotropy;if(srgb)t.colorSpace=THREE.SRGBColorSpace;return t;};
 const [asphalt,normal,concrete,concreteNormal]=await Promise.all([texture('asphalt-diffuse.jpg',true),texture('asphalt-normal.jpg'),texture('la-real/concrete-diffuse.jpg',true),texture('la-real/concrete-normal.jpg')]);
 const road=new THREE.MeshStandardMaterial({map:asphalt,normalMap:normal,roughness:.91,normalScale:new THREE.Vector2(.23,.23),color:0xc2c6c9});
 const sidewalk=new THREE.MeshStandardMaterial({map:concrete,normalMap:concreteNormal,roughness:.94,normalScale:new THREE.Vector2(.3,.3)}),yellow=new THREE.MeshStandardMaterial({color:0xd1ae49,roughness:.9}),white=new THREE.MeshStandardMaterial({color:0xc9c9b9,roughness:.9});
 function bake(mesh){mesh.updateWorldMatrix(true,false);const g=mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);for(const k of Object.keys(g.attributes))if(!['position','normal','uv'].includes(k))g.deleteAttribute(k);for(const [k,a] of Object.entries(g.attributes)){const values=new Float32Array(a.count*a.itemSize);for(let i=0;i<a.count;i++)for(let j=0;j<a.itemSize;j++)values[i*a.itemSize+j]=[a.getX(i),a.getY(i),a.itemSize>2?a.getZ(i):0][j];g.setAttribute(k,new THREE.Float32BufferAttribute(values,a.itemSize));}if(!g.attributes.uv)g.setAttribute('uv',new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count*2),2));const key=mesh.material.uuid+'|'+!!g.index;if(!bins.has(key))bins.set(key,{material:mesh.material,geo:[]});bins.get(key).geo.push(g);}
 function surface(w,l,x,z,y,mat){const g=new THREE.PlaneGeometry(w,l);g.rotateX(-Math.PI/2);const uv=g.attributes.uv;for(let i=0;i<uv.count;i++)uv.setXY(i,uv.getX(i)*w/3,uv.getY(i)*l/3);const m=new THREE.Mesh(g,mat);m.position.set(x,y,z);bake(m);g.dispose();}
 function collider(box,kind='building'){const s=box.getSize(new THREE.Vector3()),c=box.getCenter(new THREE.Vector3());const actor=physics.addBox({x:c.x,z:c.z,width:s.x,length:s.z,userData:{kind}});actor.minY=box.min.y;actor.maxY=box.max.y;obstacles.push({actor,box});if(kind==='building')buildingLots.push({bounds:box,minX:box.min.x,maxX:box.max.x,minZ:box.min.z,maxZ:box.max.z});}
 function place(template,x,z,heading=0,scale=1,collide=false){const obj=template.clone(true),holder=new THREE.Group();holder.add(obj);holder.scale.setScalar(scale);holder.rotation.y=heading;holder.position.set(x,0,z);holder.updateMatrixWorld(true);obj.traverse(m=>{if(m.isMesh)bake(m);});if(collide)collider(new THREE.Box3().setFromObject(holder,true));return holder;}
 surface(210,270,35,0,-.035,sidewalk);
 for(const x of [0,70]){surface(16,236,x,0,.006,road);for(let z=-96;z<100;z+=10)for(const dx of [-.16,.16])surface(.1,6,x+dx,z,.013,yellow);}
 for(const z of [-110,110]){surface(86,16,35,z,.008,road);for(let x=12;x<62;x+=10)for(const dz of [-.16,.16])surface(6,.1,x,z+dz,.018,yellow);for(const x of [0,70])for(let k=-5;k<=5;k++)surface(.7,3,x+k*1.1,z+8.5,.02,white);}
 // Source is centimetre-scale FBX. 800 source units = 8 m facade; no car-relative resizing.
 const source=models['street-real/street-frontages'];source.updateMatrixWorld(true);const faces=[];
 for(const suffix of ['Store','Window','Door']){const part=new THREE.Group();source.traverse(m=>{if(m.isMesh&&!m.name.startsWith('Ground')&&(suffix==='Door'?['UpWallDoor_02_UpWall-Simple_0','WallDoor_02.001_Down-w-simpleDoor_0'].includes(m.name):m.name.includes(suffix))){const c=m.clone();c.applyMatrix4(m.parent.matrixWorld);part.add(c);}});part.scale.setScalar(.01);part.updateMatrixWorld(true);const b=new THREE.Box3().setFromObject(part,true);if(b.isEmpty())continue;const c=b.getCenter(new THREE.Vector3());const centered=new THREE.Group();part.position.set(2.4,0,-c.z);centered.add(part);faces.push(centered);}
 // Native 8 m modules form continuous frontage. Intersection approaches remain open.
 for(const [side,x]of [[-1,-13],[1,13],[-1,57],[1,83]])for(let i=0;i<24;i++){const z=-92+i*8;place(faces[i%faces.length],x,z,side===-1?0:Math.PI,1,false);buildings++;}
 // Full authored buildings close the backs of the facades; their original proportions are retained.
 const full=['small','medium'].map(n=>{const g=new THREE.Group(),o=models['la-real/la-building-'+n].clone();g.add(o);const b=new THREE.Box3().setFromObject(g,true),c=b.getCenter(new THREE.Vector3());o.position.sub(new THREE.Vector3(c.x,b.min.y,c.z));return g;});
 for(const x of [-26,35,96])for(let z=-84;z<=84;z+=28){place(full[Math.abs(Math.round(z/28))%2],x,z,Math.PI,1,false);buildings++;}
 // Broad simple collision envelopes cover solid blocks, not the driveable lanes or sidewalks.
 for(const [x,w]of [[-33,36],[35,40],[103,36]])collider(new THREE.Box3(new THREE.Vector3(x-w/2,0,-99),new THREE.Vector3(x+w/2,32,99)));
 const skyline=[];models['street-real/city-skyline'].traverse(m=>{if(m.isMesh){const o=m.clone(),g=new THREE.Group();o.applyMatrix4(m.parent.matrixWorld);g.add(o);g.updateMatrixWorld(true);const b=new THREE.Box3().setFromObject(g,true),c=b.getCenter(new THREE.Vector3());o.position.sub(new THREE.Vector3(c.x,b.min.y,c.z));skyline.push(g);}});
 skyline.forEach((t,i)=>place(t,-230+i*92,-250-(i%2)*85,0,1));
 const palm=models['la-real/la-palm'],lamp=models['la-real/la-street-lamp-lod'];interactiveTemplates['street-lamp']=lamp;
 for(const x of [-10.4,80.4])for(let z=-80;z<=88;z+=32){place(palm,x,z,0,1);interactiveProps.push({type:'street-lamp',x,z:z+12,rot:x<0?Math.PI/2:-Math.PI/2});}
 for(const [x,z,w,l]of [[-64,0,1,260],[134,0,1,260],[35,-129,200,1],[35,129,200,1]])collider(new THREE.Box3(new THREE.Vector3(x-w/2,0,z-l/2),new THREE.Vector3(x+w/2,5,z+l/2)),'boundary');
 for(const bin of bins.values()){const geometry=mergeGeometries(bin.geo,false);if(!geometry)throw new Error('Street geometry batching failed');const mesh=new THREE.Mesh(geometry,bin.material);mesh.castShadow=true;mesh.receiveShadow=true;root.add(mesh);for(const g of bin.geo)g.dispose();}
 // Same animation interface as the existing worlds, with no ocean geometry in this city study.
 const sea={material:{uniforms:{time:{value:0}}}};
 return {root,sea,obstacles,buildingLots,interactiveProps,interactiveTemplates,ramps:[],stuntArea:null,updateVisible(){},stats:{map:'City Street Study',buildings,props:24,colliders:physics.objects.length,areaKm2:'0.052',placementErrors:0}};
}
