import * as THREE from './vendor/three.module.js';
import {floatGeometry,centeredWheel} from './wheel-rigs.js';
function findSourceNode(root,name){const key=name.replace(/[^a-zA-Z0-9]/g,'');let found=null;root.traverse(o=>{if(o.name.replace(/[^a-zA-Z0-9]/g,'')===key)found=o;});return found;}
const UP=new THREE.Vector3(0,1,0),spin=new THREE.Quaternion(),worldQ=new THREE.Quaternion();
// Verified against connected components of the shipped GLBs, in normalized metres.
const ISLANDS={bmw:{mesh:'Object_10',center:[-.327,.834,-.572]},porsche:{mesh:'Object_40',center:[-.314,.835,-.312]}};
function normalizer(root,length){root.updateMatrixWorld(true);const b=new THREE.Box3().setFromObject(root,true),c=b.getCenter(new THREE.Vector3()),k=length/(b.max.z-b.min.z);return v=>v.set((v.x-c.x)*k,(v.y-b.min.y)*k,(v.z-c.z)*k);}
function extractIsland(root,spec,normalize){
 const mesh=findSourceNode(root,spec.mesh);if(!mesh?.isMesh)throw Error('Missing cabin mesh '+spec.mesh);
 const g=mesh.geometry,p=g.attributes.position,ix=g.index,n=ix?.count||p.count,parent=new Int32Array(p.count),weld=new Map(),points=[];
 for(let i=0;i<p.count;i++){const v=normalize(new THREE.Vector3().fromBufferAttribute(p,i).applyMatrix4(mesh.matrixWorld));points.push(v);const key=v.toArray().map(x=>Math.round(x*10000)).join(',');parent[i]=weld.get(key)??i;if(!weld.has(key))weld.set(key,i);}
 const find=i=>{while(parent[i]!==i){parent[i]=parent[parent[i]];i=parent[i];}return i;};
 for(let i=0;i<n;i+=3){const a=ix?ix.getX(i):i;for(let k=1;k<3;k++)parent[find(ix?ix.getX(i+k):i+k)]=find(a);}
 const bounds=new Map();for(let i=0;i<p.count;i++){const id=find(i);if(!bounds.has(id))bounds.set(id,new THREE.Box3());bounds.get(id).expandByPoint(points[i]);}
 const target=new THREE.Vector3(...spec.center);let selected=-1,error=.06;for(const [id,b]of bounds){const d=b.getCenter(new THREE.Vector3()).distanceTo(target);if(d<error){selected=id;error=d;}}
 if(selected<0)throw Error('Authored steering component not found in '+spec.mesh);
 const moving=[],fixed=[];for(let i=0;i<n;i+=3){const a=ix?ix.getX(i):i,b=ix?ix.getX(i+1):i+1,c=ix?ix.getX(i+2):i+2;(find(a)===selected?moving:fixed).push(a,b,c);}
 const part=new THREE.Mesh(floatGeometry(g,moving),mesh.material);part.name='AuthoredSteering_'+spec.mesh;mesh.add(part);mesh.geometry=floatGeometry(g,fixed);return part;
}
// Smallest covariance eigenvector: the authored wheel's column axis, including tilt.
export function wheelColumn(points){
 const mean=new THREE.Vector3();for(const p of points)mean.add(p);mean.multiplyScalar(1/points.length);const a=Array.from({length:3},()=>[0,0,0]),v=[[1,0,0],[0,1,0],[0,0,1]];
 for(const p of points){const d=[p.x-mean.x,p.y-mean.y,p.z-mean.z];for(let i=0;i<3;i++)for(let j=0;j<3;j++)a[i][j]+=d[i]*d[j];}
 for(let it=0;it<24;it++){let p=0,q=1;for(let i=0;i<3;i++)for(let j=i+1;j<3;j++)if(Math.abs(a[i][j])>Math.abs(a[p][q])){p=i;q=j;}if(Math.abs(a[p][q])<1e-12)break;const tau=(a[q][q]-a[p][p])/(2*a[p][q]),t=(tau>=0?1:-1)/(Math.abs(tau)+Math.sqrt(1+tau*tau)),c=1/Math.sqrt(1+t*t),s=t*c,ap=a[p][p],aq=a[q][q],off=a[p][q];a[p][p]=ap-t*off;a[q][q]=aq+t*off;a[p][q]=a[q][p]=0;for(let k=0;k<3;k++){if(k!==p&&k!==q){const x=a[k][p],y=a[k][q];a[k][p]=a[p][k]=c*x-s*y;a[k][q]=a[q][k]=s*x+c*y;}const x=v[k][p],y=v[k][q];v[k][p]=c*x-s*y;v[k][q]=s*x+c*y;}}
 let index=0;for(let i=1;i<3;i++)if(a[i][i]<a[index][index])index=i;const axis=new THREE.Vector3(v[0][index],v[1][index],v[2][index]).normalize();if(axis.z<0)axis.negate();return axis;
}
export function prepareCockpit(root,definition,fallback){
 const normalize=normalizer(root,definition.length);let parts;
 if(definition.id==='concept')parts=['InteriorSteeringWheel01','InteriorSteeringWheel02','InteriorSteeringWheel03','InteriorSteeringWheel04','InteriorSteeringEmblem'].map(n=>findSourceNode(root,n));
 else if(definition.id==='roadster')parts=[findSourceNode(root,'roadster.014_Metal - Black rough_0')];
 else if(ISLANDS[definition.id])parts=[extractIsland(root,ISLANDS[definition.id],normalize)];
 else {if(!fallback)throw Error('NSX requires its sourced CC0 steering wheel');const part=fallback.clone(true);part.name='SavinoNSXSteering';root.updateMatrixWorld(true);const box=new THREE.Box3().setFromObject(root,true),scale=definition.length/(box.max.z-box.min.z),center=box.getCenter(new THREE.Vector3());part.position.set(center.x-.333/scale,box.min.y+.76/scale,center.z-.46/scale);part.scale.setScalar(1/scale);part.updateMatrixWorld(true);root.attach(part);parts=[part];}
 if(parts.some(p=>!p))throw Error('Missing authored steering wheel for '+definition.id);
 root.updateMatrixWorld(true);const points=[];for(const part of parts)part.traverse(o=>{if(o.isMesh)for(let i=0;i<o.geometry.attributes.position.count;i++)points.push(new THREE.Vector3().fromBufferAttribute(o.geometry.attributes.position,i).applyMatrix4(o.matrixWorld));});
 const column=wheelColumn(points),rig=centeredWheel(root,parts,'Cockpit_'+definition.id,false);
 // The Roadster source has its yoke lying almost flat (column Y=-.979).
 // Correct only that authored assembly's neutral mount for a usable driver view.
 if(definition.id==='roadster'){const mount=new THREE.Quaternion().setFromUnitVectors(column,new THREE.Vector3(0,.3,Math.sqrt(.91)));rig.node.quaternion.multiply(mount);rig.base.copy(rig.node.quaternion);}
 const glassNames={concept:['BodyWindshield','BodyDoorLWindow','BodyDoorRWindow'],roadster:['roadster.007_Glass mid tint_0','roadster.019_Glass mid tint_0'],bmw:['Object_17'],nsx:['Object_5','Object_6'],porsche:['Object_18']};
 const glass=(glassNames[definition.id]||[]).map(n=>findSourceNode(root,n)).filter(Boolean);
 return {rig,column,glass,eye:new THREE.Vector3(),aim:new THREE.Vector3(),up:new THREE.Vector3(),angle:0,pinnedNames:[rig.node.name,...glass.map(n=>n.name)]};
}
export function finishCockpit(group,cockpit){group.updateMatrixWorld(true);const center=new THREE.Box3().setFromObject(cockpit.rig.node,true).getCenter(new THREE.Vector3());group.worldToLocal(center);cockpit.eye.copy(center).add(new THREE.Vector3(0,.24,.64));cockpit.aim.copy(cockpit.eye).add(new THREE.Vector3(0,-.025,-25));}
export function animateSteering(cockpit,steering,dt){const target=THREE.MathUtils.clamp(steering,-1,1)*Math.PI*1.15;cockpit.angle=THREE.MathUtils.damp(cockpit.angle,target,14,Math.max(0,dt));spin.setFromAxisAngle(cockpit.column,cockpit.angle);cockpit.rig.node.quaternion.copy(cockpit.rig.base).multiply(spin);}
export function cockpitCamera(camera,ride){ride.group.updateWorldMatrix(true,false);camera.position.copy(ride.cockpit.eye);ride.group.localToWorld(camera.position);const c=ride.cockpit;c.up.copy(UP).applyQuaternion(ride.group.getWorldQuaternion(worldQ));camera.up.copy(c.up);c.up.copy(c.aim);ride.group.localToWorld(c.up);camera.lookAt(c.up);}
export function showCockpitGlass(cockpit,inside){for(const glass of cockpit.glass)glass.visible=!inside;}
