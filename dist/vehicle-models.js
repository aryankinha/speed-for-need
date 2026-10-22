import * as THREE from './vendor/three.module.js';
import {getVehicle} from './vehicles.js';
function sourceNode(root,name){const key=name.replace(/[^a-zA-Z0-9_]/g,'');let found=null;root.traverse(node=>{if(node.name===name||node.name.replace(/[^a-zA-Z0-9_]/g,'')===key)found=node;});return found;}
export function prepareVehicleGeometry(root,id){
  const definition=getVehicle(id);if(!definition)throw new RangeError(`Unknown vehicle ${id}`);
  const wheels=[];
  if(definition.profile==='bmw'){
    const plinth=sourceNode(root,'Object_18');
    if(!plinth)throw new Error('BMW authored display plinth was not found; refusing unsafe collision bounds.');
    plinth.removeFromParent();
  }
  if(definition.profile==='concept'){
    for(const name of ['WheelFrontL','WheelFrontR','WheelRearL','WheelRearR']){const node=sourceNode(root,name);if(!node)throw new Error(`Missing Concept GT wheel ${name}`);const front=name.startsWith('WheelFront');if(front)node.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,0,1),Math.PI/6));wheels.push({node,front,base:node.quaternion.clone(),spinAxis:new THREE.Vector3(1,0,0),steerAxis:new THREE.Vector3(0,0,1),radius:.4142,rollSign:1});}
  }
  if(definition.profile==='nsx'){
    root.updateMatrixWorld(true);
    for(const [name,front] of [['Circle.001_9',false],['Circle.002_19',true],['Circle.003_20',true],['Circle.004_21',false]]){
      const node=sourceNode(root,name);if(!node)throw new Error(`Missing NSX wheel ${name}`);
      const bounds=new THREE.Box3().setFromObject(node,true),size=bounds.getSize(new THREE.Vector3());
      const pivot=new THREE.Group();pivot.name=`WheelPivot_${name.replaceAll('.','')}`;pivot.position.copy(bounds.getCenter(new THREE.Vector3()));pivot.updateMatrixWorld();
      root.attach(pivot);pivot.attach(node);root.updateMatrixWorld(true);
      // Wrappers use source-world axes. Convert world up into their parent's axes.
      const inverseParent=root.getWorldQuaternion(new THREE.Quaternion()).invert();
      wheels.push({node:pivot,front,base:pivot.quaternion.clone(),spinAxis:new THREE.Vector3(1,0,0),steerAxis:new THREE.Vector3(0,1,0).applyQuaternion(inverseParent),sourceRadius:Math.max(size.y,size.z)/2,rollSign:1});
    }
  }
  root.rotation.y=definition.rotationY;root.updateMatrixWorld(true);
  const sourceSize=new THREE.Box3().setFromObject(root,true).getSize(new THREE.Vector3());
  const scale=definition.length/sourceSize.z;
  for(const wheel of wheels)if(wheel.sourceRadius)wheel.radius=wheel.sourceRadius*scale;
  return {definition,wheels,pinnedNames:wheels.map(w=>w.node.name)};
}
