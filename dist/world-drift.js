import * as T from './vendor/three.module.js';
import {DRIFT_PATH,DRIFT_WORLD,DRIFT_TRACK_DATA,driftSurfaceAt,addDriftColliders} from './drift-layout.js';
export async function buildDriftWorld({scene,physics,loader,anisotropy=4}){
 const gltf=await loader.loadAsync('assets/drift-track/drift-race-track.meshopt.glb');
 const root=gltf.scene;root.name='Nicholas-3D Drift Race Track';root.updateMatrixWorld(true);
 root.traverse(n=>{if(!n.isMesh)return;n.receiveShadow=true;n.castShadow=!['Ground','Asphalt'].includes(n.material.name);n.geometry.computeBoundingBox();n.geometry.computeBoundingSphere();for(const value of Object.values(n.material))if(value?.isTexture)value.anisotropy=anisotropy;});
 const deck={height:DRIFT_TRACK_DATA.roadY,pitch:0,roll:0};scene.add(root);const actors=addDriftColliders(physics);
 return {root,groundY:DRIFT_TRACK_DATA.roadY,path:DRIFT_PATH,obstacles:[],buildingLots:[],parkPlots:[],ramps:[],stuntArea:null,surfaceAt:driftSurfaceAt,getDeckHeight(){return DRIFT_TRACK_DATA.roadY;},getDeckPose(){return deck;},stats:{map:'Drift Race Track',buildings:0,props:DRIFT_TRACK_DATA.walls.length,colliders:actors.length,areaKm2:((DRIFT_WORLD.right-DRIFT_WORLD.left)*(DRIFT_WORLD.bottom-DRIFT_WORLD.top)/1e6).toFixed(2),placementErrors:0}};
}
// Only checkpoint light frames are added during racing. The source track,
// guardrails, foliage, decals and road material are never substituted.
export function buildDriftRaceMarkers(scene,physics,path){
 const root=new T.Group();root.name='Drift timing gates';scene.add(root);const gates=[],geo=new T.BoxGeometry(1,1,1),dummy=new T.Object3D(),p={};
 for(let i=0;i<12;i++){path.sampleAtDistance(i*path.length/12,p);const gate=new T.Group(),material=new T.MeshBasicMaterial({color:0xfcaf17,transparent:true,opacity:.2}),parts=new T.InstancedMesh(geo,material,3);gate.position.set(p.x,.03,p.z);gate.rotation.y=p.heading;for(let j=0;j<3;j++){dummy.position.set(j===2?0:j===0?-5.5:5.5,j===2?4:2,0);dummy.scale.set(j===2?11:.08,j===2?.08:4,.08);dummy.updateMatrix();parts.setMatrixAt(j,dummy.matrix);}gate.add(parts);root.add(gate);gates.push(gate);}
 return {root,gates,dispose(){root.removeFromParent();geo.dispose();for(const gate of gates)gate.children[0].material.dispose();}};
}

export {DRIFT_WORLD,DRIFT_PATH,DRIFT_GATES,DRIFT_DESTINATIONS,drawDriftMap} from './drift-layout.js';
