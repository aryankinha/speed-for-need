import * as THREE from './vendor/three.module.js';
import {getVehicle} from './vehicles.js';
import {findSourceNode as sourceNode,centeredWheel,splitBMWheels} from './wheel-rigs.js';
export function prepareVehicleGeometry(root,id){
  const definition=getVehicle(id);if(!definition)throw new RangeError(`Unknown vehicle ${id}`);
  const wheels=[];
  if(definition.profile==='bmw'){
    const plinth=sourceNode(root,'Object_18');
    if(!plinth)throw new Error('BMW authored display plinth was not found; refusing unsafe collision bounds.');
    plinth.removeFromParent();
    wheels.push(...splitBMWheels(root));
  }
  if(definition.profile==='concept'){
    for(const name of ['WheelFrontL','WheelFrontR','WheelRearL','WheelRearR']){const node=sourceNode(root,name);if(!node)throw new Error(`Missing Concept GT wheel ${name}`);const front=name.startsWith('WheelFront');if(front)node.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,0,1),Math.PI/6));wheels.push({node,front,base:node.quaternion.clone(),spinAxis:new THREE.Vector3(1,0,0),steerAxis:new THREE.Vector3(0,0,1),radius:.4142,rollSign:1});}
  }
  if(definition.profile==='nsx'||definition.profile==='porsche'){
    const entries=definition.profile==='nsx'?[['Circle.001_9',true],['Circle.002_19',false],['Circle.003_20',false],['Circle.004_21',true]]:[['Circle002_12',true],['Circle003_13',false],['Circle004_14',false],['Circle001_16',true]];
    for(const [name,front] of entries){const node=sourceNode(root,name);if(!node)throw new Error(`Missing ${id} wheel ${name}`);wheels.push(centeredWheel(root,[node],name.replaceAll('.',''),front));}
  }
  if(definition.profile==='roadster'){
    for(const [name,front]of [['TRDEF-WheelFtR',true],['TRDEF-WheelFtL',true],['TRDEF-WheelBkR',false],['TRDEF-WheelBkL',false]]){
      const node=sourceNode(root,name);if(!node)throw new Error(`Missing Tesla wheel ${name}`);wheels.push(centeredWheel(root,[node],name,front));
    }
  }
  root.rotation.y=definition.rotationY;root.updateMatrixWorld(true);
  const sourceSize=new THREE.Box3().setFromObject(root,true).getSize(new THREE.Vector3());
  const scale=definition.length/sourceSize.z;
  for(const wheel of wheels)if(wheel.sourceRadius)wheel.radius=wheel.sourceRadius*scale;
  root.traverse(node=>{if(node.isMesh&&definition.paintMeshNames?.includes(node.name))node.userData.paint=true;});
  return {definition,wheels,paintMaterialNames:definition.paintMaterialNames,pinnedNames:wheels.map(w=>w.node.name)};
}
