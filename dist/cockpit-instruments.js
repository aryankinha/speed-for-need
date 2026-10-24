import * as T from './vendor/three.module.js';
import {engineSpeedRpm,engineRpm,gearFromSpeed} from './audio.js';
const clamp=T.MathUtils.clamp;
function canvasTexture(draw,width=256,height=256){
 if(!globalThis.document?.createElement)return null;
 const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;const ctx=canvas.getContext('2d');if(!ctx)return null;draw(ctx,canvas);const texture=new T.CanvasTexture(canvas);texture.colorSpace=T.SRGBColorSpace;return texture;
}
function dialFace(label,max,accent){return canvasTexture(ctx=>{
 ctx.fillStyle='#101419';ctx.fillRect(0,0,256,256);ctx.strokeStyle=accent;ctx.fillStyle=accent;
 for(let i=0;i<=40;i++){const a=(-220+i*6.5)*Math.PI/180,major=i%5===0;ctx.lineWidth=major?3:1;ctx.beginPath();ctx.moveTo(128+Math.cos(a)*(major?86:94),128+Math.sin(a)*(major?86:94));ctx.lineTo(128+Math.cos(a)*103,128+Math.sin(a)*103);ctx.stroke();if(major){ctx.font='16px sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(String(Math.round(i/40*max)),128+Math.cos(a)*69,128+Math.sin(a)*69);}}
 ctx.textAlign='center';ctx.font='13px sans-serif';ctx.fillText(label,128,167);
 });}
// Depth-tested, car-space meshes: no HUD layer and no second camera/render pass.
export function createInstruments(group,profile){
 const root=new T.Group();root.name='Cockpit instruments';root.position.fromArray(profile.cluster);root.quaternion.setFromUnitVectors(new T.Vector3(0,0,1),new T.Vector3(...profile.normal).normalize());group.add(root);
 const w=profile.width+.025,h=profile.height+.025,r=.015,shape=new T.Shape();
 shape.moveTo(-w/2+r,-h/2);shape.lineTo(w/2-r,-h/2);shape.quadraticCurveTo(w/2,-h/2,w/2,-h/2+r);shape.lineTo(w/2,h/2-r);shape.quadraticCurveTo(w/2,h/2,w/2-r,h/2);shape.lineTo(-w/2+r,h/2);shape.quadraticCurveTo(-w/2,h/2,-w/2,h/2-r);shape.lineTo(-w/2,-h/2+r);shape.quadraticCurveTo(-w/2,-h/2,-w/2+r,-h/2);
 const shell=new T.ExtrudeGeometry(shape,{depth:.045,steps:1,bevelEnabled:true,bevelSize:.003,bevelThickness:.003,bevelSegments:2,curveSegments:5});shell.translate(0,0,-.052);
 const housing=new T.Mesh(shell,new T.MeshStandardMaterial({color:0x20252b,roughness:.78}));root.add(housing);
 const result={root,needles:[],speed:0,rpm:900,gear:'N',clock:0,lastText:'',profile,display:null};
 if(profile.style==='analog'){
  const trim=new T.MeshStandardMaterial({color:0x4b5055,metalness:.55,roughness:.38}),needleMat=new T.MeshBasicMaterial({color:0xe26140,toneMapped:false});
  for(const [x,y,r,label,max]of profile.dials){
   const face=new T.Mesh(new T.CircleGeometry(r,40),new T.MeshStandardMaterial({color:0xffffff,map:dialFace(label,max,profile.accent),roughness:.9,emissive:0x303030,emissiveIntensity:.35}));face.position.set(x,y,.001);root.add(face);
   const ring=new T.Mesh(new T.TorusGeometry(r+.001,.0018,4,40),trim);ring.position.copy(face.position);root.add(ring);
   const pivot=new T.Group();pivot.position.set(x,y,.004);const needle=new T.Mesh(new T.BoxGeometry(.0018,r*.78,.001),needleMat);needle.position.y=r*.28;pivot.add(needle);root.add(pivot);result.needles.push({pivot,label,max});
  }
 }else{
  const texture=canvasTexture(()=>{},512,192),face=new T.Mesh(new T.PlaneGeometry(profile.width,profile.height),new T.MeshBasicMaterial({map:texture,color:0xffffff,toneMapped:false}));face.position.z=.001;root.add(face);result.display=texture;
 }
 root.visible=false;return result;
}
export function updateInstruments(cluster,signedSpeed,dt){
 const speed=Math.abs(Number.isFinite(signedSpeed)?signedSpeed:0),step=clamp(Number.isFinite(dt)?dt:0,0,.05);
 cluster.speed=T.MathUtils.damp(cluster.speed,speed*3.6,16,step);cluster.rpm=T.MathUtils.damp(cluster.rpm,engineRpm(engineSpeedRpm(speed,signedSpeed)),12,step);cluster.gear=signedSpeed<-.5?'R':speed<.3?'N':String(cluster.profile.style==='electric'?1:gearFromSpeed(speed));
 for(const {pivot,label,max}of cluster.needles){const value=label==='KM/H'?cluster.speed:label==='RPM'?cluster.rpm/1000:label==='FUEL'?.75:label==='TEMP'?85:3;/* clockwise sweep; initial pointer points +Y */pivot.rotation.z=(130-clamp(value/max,0,1)*260)*Math.PI/180;}
 cluster.clock+=step;if(!cluster.display||cluster.clock<.1)return;cluster.clock=0;
 const text=`${Math.round(cluster.speed)} / ${cluster.gear}`;if(text===cluster.lastText)return;cluster.lastText=text;
 const canvas=cluster.display.image,ctx=canvas.getContext('2d');ctx.fillStyle='#0d151a';ctx.fillRect(0,0,512,192);ctx.fillStyle=cluster.profile.accent;ctx.textAlign='center';ctx.font='bold 80px sans-serif';ctx.fillText(String(Math.round(cluster.speed)),256,119);ctx.font='18px sans-serif';ctx.fillText('KM/H',256,155);ctx.textAlign='left';ctx.font='30px sans-serif';ctx.fillText(cluster.gear,24,54);ctx.strokeStyle='#4b636c';ctx.strokeRect(1,1,510,190);cluster.display.needsUpdate=true;
}
