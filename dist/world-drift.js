import {buildRaceGate} from './race-gates.js';
import * as T from './vendor/three.module.js';
import {DRIFT_PATH,DRIFT_WORLD,DRIFT_TRACK_DATA,driftSurfaceAt,addDriftColliders} from './drift-layout.js';
export async function buildDriftWorld({scene,physics,loader,anisotropy=4}){
 const gltf=await loader.loadAsync('assets/drift-track/drift-race-track.meshopt.glb');
 const root=gltf.scene;root.name='Nicholas-3D Drift Race Track';root.updateMatrixWorld(true);
 root.traverse(n=>{if(!n.isMesh)return;n.receiveShadow=true;n.castShadow=!['Ground','Asphalt'].includes(n.material.name);n.geometry.computeBoundingBox();n.geometry.computeBoundingSphere();for(const value of Object.values(n.material))if(value?.isTexture)value.anisotropy=anisotropy;});
 const perimeter=buildDriftPerimeter(root);const deck={height:DRIFT_TRACK_DATA.roadY,pitch:0,roll:0};scene.add(root);const actors=addDriftColliders(physics);
 return {root,perimeter,groundY:DRIFT_TRACK_DATA.roadY,path:DRIFT_PATH,obstacles:[],buildingLots:[],parkPlots:[],ramps:[],stuntArea:null,surfaceAt:driftSurfaceAt,getDeckHeight(){return DRIFT_TRACK_DATA.roadY;},getDeckPose(){return deck;},stats:{map:'Drift Race Track',buildings:0,props:DRIFT_TRACK_DATA.walls.length,colliders:actors.length,areaKm2:((DRIFT_WORLD.right-DRIFT_WORLD.left)*(DRIFT_WORLD.bottom-DRIFT_WORLD.top)/1e6).toFixed(2),placementErrors:0}};
}
// Only checkpoint light frames are added during racing. The source track,
// guardrails, foliage, decals and road material are never substituted.
export function buildDriftRaceMarkers(scene,physics,path){
 const root=new T.Group();root.name='Drift timing gates';scene.add(root);const gates=[];
 for(let i=0;i<12;i++){const gate=buildRaceGate(path,i,.03);root.add(gate);gates.push(gate);}
 return {root,gates,dispose(){root.removeFromParent();root.traverse(n=>{if(n.isMesh){n.geometry.dispose();n.material.map?.dispose();n.material.dispose();}});}};
}

export {DRIFT_WORLD,DRIFT_PATH,DRIFT_GATES,DRIFT_DESTINATIONS,drawDriftMap} from './drift-layout.js';

// A continuous W-profile guardrail closes authored access gaps around the
// facility. Its collision and visual centerline share the same traced contour.
export function buildDriftPerimeter(root){
 const points=DRIFT_TRACK_DATA.perimeter,vertices=[],indices=[],posts=[];
 const shape=[[-.07,.56],[.04,.65],[-.07,.76],[.04,.87],[-.07,.96]];
 let sourceMaterial;root.traverse(n=>{if(n.isMesh&&n.material.name==='Metal')sourceMaterial=n.material;});
 const material=sourceMaterial?sourceMaterial.clone():new T.MeshStandardMaterial();
 material.name='Facility safety rail';material.color.setHex(0xaeb6bc);material.metalness=.65;material.roughness=.5;material.side=T.DoubleSide;
 for(let i=0;i<points.length;i++){
  const a=points[(i+points.length-1)%points.length],b=points[i],c=points[(i+1)%points.length];
  const ax=b[0]-a[0],az=b[1]-a[1],bx=c[0]-b[0],bz=c[1]-b[1],al=Math.hypot(ax,az),bl=Math.hypot(bx,bz);
  let nx=-az/al-bz/bl,nz=ax/al+bx/bl;const length=Math.hypot(nx,nz);nx/=length;nz/=length;
  for(const q of shape)vertices.push(b[0]+nx*q[0],q[1],b[1]+nz*q[0]);
  const count=Math.max(1,Math.ceil(bl/5));for(let j=0;j<count;j++)posts.push([b[0]+bx*j/count,b[1]+bz*j/count,Math.atan2(-bx,-bz)]);
 }
 for(let i=0;i<points.length;i++)for(let j=0;j<shape.length-1;j++){const a=i*shape.length+j,b=((i+1)%points.length)*shape.length+j;indices.push(a,a+1,b,a+1,b+1,b);}
 const geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.Float32BufferAttribute(vertices,3));geometry.setIndex(indices);geometry.computeVertexNormals();geometry.computeBoundingSphere();
 const group=new T.Group();group.name='Closed facility safety perimeter';const rail=new T.Mesh(geometry,material);rail.castShadow=true;rail.receiveShadow=true;group.add(rail);
 const supports=new T.InstancedMesh(new T.BoxGeometry(.12,1,.14),material,posts.length),dummy=new T.Object3D();for(let i=0;i<posts.length;i++){dummy.position.set(posts[i][0],.5,posts[i][1]);dummy.rotation.y=posts[i][2];dummy.updateMatrix();supports.setMatrixAt(i,dummy.matrix);}supports.instanceMatrix.needsUpdate=true;supports.castShadow=true;group.add(supports);root.add(group);return group;
}
