import * as T from './vendor/three.module.js';
import {VEHICLES} from './vehicles.js';
import {CircuitPath,buildCircuit} from './race-track.js';
import {BoostPadTimer} from './boost-pads.js';
import {nextBoost,fillNitro} from './nitro.js';
import {wrapAngle} from './interpolation.js';
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
export class RaceMode{
 constructor({physics,scene=null,rides=null,renderState=null,slotOffset=1,path=null,asphalt=null,laps=3,keepVisible=[],trackFactory=buildCircuit,name='Solana Raceway',padFractions=null,groundY=0}={}){
  this.groundY=groundY;this.trackFactory=trackFactory;this.name=name;this.padFractions=padFractions;this.keepVisible=keepVisible;this.physics=physics;this.scene=scene;this.rides=rides;this.renderState=renderState;this.slotOffset=slotOffset;this.path=path||new CircuitPath();this.asphalt=asphalt;this.laps=laps;this.active=false;this.phase='idle';this.entries=[];this.opponents=[];this.order=new Int8Array(5);this.scratch={x:0,z:0,dx:0,dz:0,heading:0,curvature:0};this.look={x:0,z:0,dx:0,dz:0,heading:0,curvature:0};this.pose={x:0,z:0,heading:0};this.spinQ=new T.Quaternion();this.steerQ=new T.Quaternion();this.time=0;this.countdown=3;this.pickups=[];this.pads=[];this.revision=0;
 }
 start(playerCarId,player){
  if(this.active)this.stop();this.savedPose=player.copyState({});this.savedActors=this.physics.objects.slice();this.savedActive=this.savedActors.map(a=>a.body.isActive());for(const a of this.savedActors)if(a!==player&&a.body.getType()!=='static')a.body.setActive(false);
  this.savedVisuals=[];this.savedVisibility=[];if(this.scene)for(const node of this.scene.children)if(!node.isLight&&!node.isCamera&&!this.keepVisible.includes(node)){this.savedVisuals.push(node);this.savedVisibility.push(node.visible);node.visible=false;}
  this.player=player;this.active=true;this.phase='countdown';this.time=0;this.countdown=3;this.finishWait=0;this.entries=[];this.opponents=[];this.order.set([0,1,2,3,4]);this.revision++;
  this.ownedAsphalt=this.asphalt?.clone()||null;if(this.ownedAsphalt){this.ownedAsphalt.repeat.set(1,1);this.ownedAsphalt.needsUpdate=true;}this.track=this.scene?this.trackFactory(this.scene,this.physics,this.path,this.ownedAsphalt):null;
  this.pads=[];for(const at of [[50,-160],[-90,230],[-210,-110]]){let best=0,error=Infinity;for(let i=0;i<this.path.count;i++){const d=(this.path.x[i]-this.path.originX-at[0])**2+(this.path.z[i]-this.path.originZ-at[1])**2;if(d<error){error=d;best=i*this.path.ds;}}const p=this.path.sampleAtDistance(best,this.scratch);if(this.padFractions)this.path.sampleAtDistance(this.padFractions[this.pads.length]*this.path.length,this.scratch);this.pads.push({id:'circuit-'+this.pads.length,x:p.x,z:p.z,heading:p.heading,width:6,length:6});}
  this.pickups=Array.from({length:10},(_,i)=>{const p=this.path.sampleAtDistance((i+.5)*this.path.length/10,this.scratch);return {id:i,x:p.x,z:p.z,active:true,cooldown:0};});
  const definitions=[VEHICLES.find(v=>v.id===playerCarId),...VEHICLES.filter(v=>v.id!==playerCarId)];
  for(let i=0;i<5;i++){const def=definitions[i],ride=this.rides?.[def.id],grid=-i*12,p=this.path.sampleAtDistance(grid,this.scratch),lane=i?(i%2?2.5:-2.5):0,x=p.x+lane*Math.cos(p.heading),z=p.z-lane*Math.sin(p.heading);let actor=player,mesh=null,wheels=[];
   if(i){actor=this.physics.addVehicle({x,z,heading:p.heading,width:ride?.size.x||1.9,length:ride?.size.z||def.length,height:ride?.size.y||1.5,...def.tuning,userData:{kind:'opponent',id:def.id,index:i-1}});if(ride&&this.scene){mesh=ride.group.clone(true);mesh.visible=true;this.scene.add(mesh);for(const w of ride.wheels)wheels.push({node:mesh.getObjectByName(w.node.name),front:w.front,base:w.base.clone(),radius:w.radius||.35,spinAxis:w.spinAxis,steerAxis:w.steerAxis,rollSign:w.rollSign??1});const instrument=mesh.getObjectByName('Cockpit instruments');if(instrument)instrument.visible=false;mesh.traverse(n=>{if(n.isLight)n.visible=false;});}}
   actor.setPose({x,z,heading:p.heading});actor.elevation=actor.groundPitch=actor.groundRoll=0;actor.groundElevation=actor.prevGroundElevation=this.groundY;actor.isAirborne=false;actor.rampId=null;actor.surfaceGrip=1;actor.surfaceDrag=0;actor.dragMultiplier=1;
   const splitTimes=new Float64Array(this.laps*12+1);splitTimes.fill(NaN);if(i===0)splitTimes[0]=0;
   const entry={splitTimes,def,actor,mesh,wheels,index:i,progress:grid,rankProgress:grid,lap:0,nextGate:i?0:1,lapStart:0,lapTime:0,bestLap:Infinity,finishTime:Infinity,nitro:40,boostGate:{boosting:false,locked:false},pad:new BoostPadTimer(this.pads),lastX:x,lastZ:z,controls:{throttle:0,reverse:0,brake:1,steer:0,boost:false,handbrake:false},exhaust:0,stuckTimer:0,recovery:0,recoveryTime:0,lane:lane,steering:0,wheelDistance:0,drafting:false,targetSpeed:0};
   this.entries.push(entry);if(i){this.opponents.push(entry);if(this.renderState)this.renderState.setActor(this.slotOffset+i-1,actor);}this.renderState?.snapSlot(0);
  }
  this.buildMarkers();return this;
 }
 buildMarkers(){if(!this.scene)return;this.markers=new T.Group();this.scene.add(this.markers);const material=new T.MeshBasicMaterial({color:0xfcaf17}),geometry=new T.BoxGeometry(5,.035,.3),strips=new T.InstancedMesh(geometry,material,9),dummy=new T.Object3D();let i=0;for(const p of this.pads)for(const z of [-2,0,2]){dummy.position.set(p.x+Math.sin(p.heading)*z,.05,p.z+Math.cos(p.heading)*z);dummy.rotation.y=p.heading;dummy.updateMatrix();strips.setMatrixAt(i++,dummy.matrix);}this.markers.add(strips);}

 beforeStep(dt,input){
  if(!this.active)return;
  if(this.phase==='countdown'){this.countdown-=dt;if(this.countdown<=0){this.phase='racing';this.countdown=0;this.revision++;}}
  const running=this.phase==='racing'||this.phase==='finishing';
  for(let i=0;i<5;i++){const e=this.entries[i],a=e.actor,k=e.controls;
   if(!running){k.throttle=k.reverse=k.steer=0;k.brake=1;k.boost=false;a.setControls(k);continue;}
   if(Number.isFinite(e.finishTime)){this.driveAI(e,dt);k.boost=false;k.throttle=a.speed<20?k.throttle:0;k.brake=a.speed>22?.3:0;a.setControls(k);continue;}
   if(i)this.driveAI(e,dt);else{k.throttle=input.throttle;k.reverse=input.reverse;k.brake=0;k.handbrake=input.handbrake;k.steer=T.MathUtils.damp(k.steer,input.steer,12,dt);this.draft(e);}
   e.nitro=nextBoost(e.boostGate,e.nitro,i?this.aiBoost:!!input.boost&&a.forwardSpeed>2&&k.throttle>0&&!k.reverse,dt);e.pad.step(a,dt);k.boost=e.boostGate.boosting||e.pad.active;
   if(!i&&e.pad.active&&!k.reverse)k.throttle=1;
   a.setControls(k);
  }
 }
 draft(e){const a=e.actor,s=Math.sin(a.heading),c=Math.cos(a.heading);e.drafting=false;for(let j=0;j<5;j++){const b=this.entries[j].actor;if(a===b)continue;const dx=b.x-a.x,dz=b.z-a.z,ahead=-dx*s-dz*c,lat=Math.abs(dx*c-dz*s);if(ahead>4&&ahead<25&&lat<2.2&&Math.cos(b.heading-a.heading)>.85){e.drafting=true;break;}}a.dragMultiplier=e.drafting?.65:1;}
 driveAI(e,dt){const a=e.actor,k=e.controls,path=this.path,speed=a.forwardSpeed,abs=Math.abs(speed);path.sampleAtDistance(e.progress,this.scratch);this.draft(e);let desiredLane=0;
  for(let j=0;j<5;j++){const other=this.entries[j];if(other===e)continue;const dx=other.actor.x-a.x,dz=other.actor.z-a.z,ahead=dx*this.scratch.dx+dz*this.scratch.dz,lateral=dx*Math.cos(this.scratch.heading)-dz*Math.sin(this.scratch.heading);if(ahead>3&&ahead<20&&Math.abs(lateral)<2.5){desiredLane=e.index%2?3.3:-3.3;break;}}
  // Do not merge into an occupied passing lane.
  for(let j=0;j<5;j++){const b=this.entries[j];if(b===e)continue;if(Math.abs(b.progress-e.progress)<8&&Math.abs(b.lane-desiredLane)<2.2)desiredLane=0;}
  e.lane=T.MathUtils.damp(e.lane,desiredLane,1.8,dt);const L=clamp(abs*.35,4,16);path.sampleAtDistance(e.progress+L,this.look);const tx=this.look.x+Math.cos(this.look.heading)*e.lane-a.x,tz=this.look.z-Math.sin(this.look.heading)*e.lane-a.z,error=wrapAngle(Math.atan2(-tx,-tz)-a.heading);
  let target=a.config.maxSpeed*.96,maxCurv=0;const preview=12+abs*abs/20;for(let d=0;d<=preview;d+=4){path.sampleAtDistance(e.progress+d,this.scratch);const curv=Math.abs(this.scratch.curvature);maxCurv=Math.max(maxCurv,curv);const corner=Math.sqrt(a.config.grip*.40/(curv+1e-4));target=Math.min(target,Math.sqrt(corner*corner+20*d));}e.targetSpeed=target;
  if(e.recovery===0){if(abs<1.2&&k.throttle>.8)e.stuckTimer+=dt;else e.stuckTimer=0;if(Math.abs(error)>Math.PI*.65||e.stuckTimer>1.2){e.recovery=1;e.recoveryTime=0;e.stuckTimer=0;}}
  if(e.recovery===1){e.recoveryTime+=dt;k.throttle=0;k.reverse=1;k.brake=0;k.steer=-Math.sign(error);k.handbrake=false;this.aiBoost=false;if(e.recoveryTime>1.1||(Math.abs(error)<.65&&e.recoveryTime>.4)){e.recovery=2;e.recoveryTime=0;}return;}
  if(e.recovery===2){e.recoveryTime+=dt;if(e.recoveryTime>1){e.recovery=0;e.recoveryTime=0;}}
  const gap=this.entries[0].rankProgress-e.rankProgress,assist=Math.abs(gap)>250?1:1+clamp(gap/250,-1,1)*.08;
  k.throttle=clamp((target-speed)*.3,0,1)*assist;k.throttle=clamp(k.throttle,0,1);k.reverse=0;k.brake=clamp((speed-target)*.28,0,1);k.steer=clamp(error*2.8,-1,1);k.handbrake=false;
  this.aiBoost=e.recovery===0&&e.nitro>=30&&speed>16&&k.brake===0&&Math.abs(error)<.18&&(maxCurv<.006||e.drafting)&&target>speed+2;
 }
 project(e){const a=e.actor,moved=Math.hypot(a.x-e.lastX,a.z-e.lastZ);e.lastX=a.x;e.lastZ=a.z;if(moved<1e-9)return e.progress;const limit=moved*2+.02;return clamp(this.path.nearest(a.x,a.z,e.progress,Math.min(35,Math.max(.75,moved*3+.25))),e.progress-limit,e.progress+limit);}
 afterStep(dt){
  if(!this.active||!(this.phase==='racing'||this.phase==='finishing'))return;this.time+=dt;const spacing=this.path.length/12;
  for(let i=0;i<10;i++){const p=this.pickups[i];if(!p.active){p.cooldown-=dt;if(p.cooldown<=0)p.active=true;}}
  for(let i=0;i<5;i++){const e=this.entries[i],a=e.actor;if(Number.isFinite(e.finishTime)){e.progress=this.project(e);continue;}const old=e.progress;e.progress=this.project(e);e.lapTime=this.time-e.lapStart;
   const gate=e.nextGate*spacing;if(old<=gate&&e.progress>=gate&&e.progress-old<5){this.path.sampleAtDistance(gate,this.scratch);if(Math.hypot(a.x-this.scratch.x,a.z-this.scratch.z)<10&&a.forwardSpeed>0){e.splitTimes[e.nextGate]=this.time;if(e.nextGate>0&&e.nextGate%12===0){e.lap++;e.bestLap=Math.min(e.bestLap,e.lapTime);e.lapStart=this.time;e.lapTime=0;if(e.lap>=this.laps){e.finishTime=this.time;this.revision++;if(i===0){this.phase='finishing';this.finishWait=0;}}}e.nextGate++;}}
   e.rankProgress=Math.min(e.progress,e.nextGate*spacing);
   for(let j=0;j<10;j++){const p=this.pickups[j];if(p.active&&e.nitro<=80&&(a.x-p.x)**2+(a.z-p.z)**2<10){e.nitro=fillNitro(e.nitro,20);p.active=false;p.cooldown=12;}}
  }
  // Stable insertion sort of five indices, no callback/temporary array.
  for(let i=1;i<5;i++){const id=this.order[i],e=this.entries[id];let j=i-1;while(j>=0){const b=this.entries[this.order[j]],ahead=Number.isFinite(e.finishTime)?(!Number.isFinite(b.finishTime)||e.finishTime<b.finishTime):(!Number.isFinite(b.finishTime)&&e.rankProgress>b.rankProgress);if(!ahead)break;this.order[j+1]=this.order[j];j--;}this.order[j+1]=id;}
  if(this.phase==='finishing'){this.finishWait+=dt;let finished=0;for(let i=0;i<5;i++)if(Number.isFinite(this.entries[i].finishTime))finished++;if(finished===5||this.finishWait>45){this.phase='finished';this.revision++;}}
 }
 render(alpha,dt){if(!this.active||!this.scene)return;const next=this.entries[0].nextGate%12;for(let i=0;i<this.track.gates.length;i++){const m=this.track.gates[i].children[0].material;m.opacity=i===next?.85:.18;} for(let i=0;i<this.opponents.length;i++){const e=this.opponents[i];if(!e.mesh)continue;if(this.renderState)this.renderState.sample(this.slotOffset+i,alpha,this.pose);else{this.pose.x=e.actor.x;this.pose.z=e.actor.z;this.pose.heading=e.actor.heading;}e.mesh.position.set(this.pose.x,this.groundY,this.pose.z);e.mesh.rotation.y=this.pose.heading;e.wheelDistance+=e.actor.forwardSpeed*dt;for(let j=0;j<e.wheels.length;j++){const w=e.wheels[j];this.spinQ.setFromAxisAngle(w.spinAxis||T.Object3D.DEFAULT_UP,e.wheelDistance/w.radius*w.rollSign);w.node.quaternion.copy(w.base).multiply(this.spinQ);if(w.front){this.steerQ.setFromAxisAngle(w.steerAxis||T.Object3D.DEFAULT_UP,e.controls.steer*e.actor.config.steerAngle/(1+Math.abs(e.actor.forwardSpeed)/44));w.node.quaternion.premultiply(this.steerQ);}}}if(this.pickupMeshes)for(let i=0;i<10;i++){this.pickupMeshes[i].visible=this.pickups[i].active;this.pickupMeshes[i].rotation.y+=dt;}}
 stop(){if(!this.active)return;for(const e of this.entries)e.actor.dragMultiplier=1;for(let i=0;i<this.opponents.length;i++){const e=this.opponents[i];e.mesh?.removeFromParent();if(this.renderState)this.renderState.clearActor(this.slotOffset+i);this.physics.remove(e.actor);}this.track?.dispose();this.ownedAsphalt?.dispose();if(this.markers){this.markers.removeFromParent();const gs=new Set(),ms=new Set();this.markers.traverse(n=>{if(n.isMesh){gs.add(n.geometry);ms.add(n.material);}});for(const g of gs)g.dispose();for(const m of ms)m.dispose();}for(let i=0;i<this.savedActors.length;i++)if(this.savedActors[i].body.isActive()!==this.savedActive[i])this.savedActors[i].body.setActive(this.savedActive[i]);for(let i=0;i<this.savedVisuals.length;i++)this.savedVisuals[i].visible=this.savedVisibility[i];this.player.setPose(this.savedPose);this.player.groundElevation=0;this.renderState?.snapSlot(0);this.entries=[];this.opponents=[];this.active=false;this.phase='idle';}
}
