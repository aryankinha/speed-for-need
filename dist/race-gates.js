import * as T from './vendor/three.module.js';
export const GATE_COLORS=Object.freeze({target:0xff4545,next:0xffd447,cleared:0x56ed92});
export function raceGateState(index,nextGate,laps=3){
 if(nextGate>laps*12)return 'cleared';
 const current=nextGate%12;
 if(index===current)return 'target';
 if(index===(current+1)%12)return 'next';
 return index===0||current===0||index<current?'cleared':'next';
}
export function buildRaceGate(path,index,y=0){
 const p=path.sampleAtDistance(index*path.length/12,{}),gate=new T.Group(),width=Math.max(16,path.width+4),height=5.2;
 gate.position.set(p.x,y,p.z);gate.rotation.y=p.heading;
 const material=new T.MeshBasicMaterial({color:GATE_COLORS.next,transparent:true,opacity:.75,toneMapped:false,depthWrite:false});
 const parts=new T.InstancedMesh(new T.BoxGeometry(1,1,1),material,4),dummy=new T.Object3D();
 for(let j=0;j<4;j++){
  dummy.position.set(j<2?(j===0?-width/2:width/2):0,j<2?height/2:j===2?height:.025,0);
  dummy.scale.set(j<2?.28:width,j<2?height:j===2?.32:.045,j===3?1.1:.28);dummy.updateMatrix();parts.setMatrixAt(j,dummy.matrix);
 }
 gate.add(parts);gate.userData.width=width;gate.userData.state='';
 // Numbers supplement color; textures are created once, never during racing.
 if(typeof document!=='undefined'){
  const canvas=document.createElement('canvas');canvas.width=128;canvas.height=64;const ctx=canvas.getContext('2d');ctx.font='bold 44px sans-serif';ctx.textAlign='center';ctx.fillStyle='#ffffff';ctx.fillText(String(index||12).padStart(2,'0'),64,48);
  const label=new T.Mesh(new T.PlaneGeometry(2.2,1.1),new T.MeshBasicMaterial({map:new T.CanvasTexture(canvas),transparent:true,side:T.DoubleSide,toneMapped:false,depthWrite:false}));label.userData.raceGateLabel=true;label.position.set(0,height+.7,0);gate.add(label);
 }
 return gate;
}
export function updateRaceGates(gates,nextGate,laps=3){
 const active=nextGate%12;
 for(let i=0;i<gates.length;i++){
  const gate=gates[i],state=raceGateState(i,nextGate,laps),opacity=state==='target'?1:state==='cleared'?.6:i===(active+1)%12?.95:.3;
  if(gate.userData.state===state&&gate.children[0].material.opacity===opacity)continue;
  gate.userData.state=state;
  for(let j=0;j<gate.children.length;j++){const m=gate.children[j].material;m.color.setHex(GATE_COLORS[state]);m.opacity=opacity;}
 }
}
