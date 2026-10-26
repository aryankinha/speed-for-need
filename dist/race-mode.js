import {updateRaceGates} from './race-gates.js';
import * as T from './vendor/three.module.js';
import {VEHICLES} from './vehicles.js';
import {CircuitPath,buildCircuit} from './race-track.js';
import {BoostPadTimer} from './boost-pads.js';
import {nextBoost,fillNitro} from './nitro.js';
import {wrapAngle} from './interpolation.js';
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

// Per-car AI driver personas: distinct cornering aggression, braking depth, apex tightness,
// defensive blocking, slipstream seeking, pickup/pad hunting, and focus rhythm.
export const DRIVER_PROFILES=Object.freeze({
 concept:Object.freeze({name:'Tactician',gripUsage:.93,brakeUsage:.90,apexBias:1.00,defend:.85,draftSeek:.95,pickupSeek:1.00,nitroMin:6,lookScale:.36,freq:.41}),
 roadster:Object.freeze({name:'Slingshot',gripUsage:.91,brakeUsage:.88,apexBias:.96,defend:.75,draftSeek:1.15,pickupSeek:1.10,nitroMin:5,lookScale:.38,freq:.53}),
 bmw:Object.freeze({name:'Defender',gripUsage:.95,brakeUsage:.93,apexBias:1.04,defend:1.15,draftSeek:.90,pickupSeek:.95,nitroMin:7,lookScale:.34,freq:.67}),
 nsx:Object.freeze({name:'Apex Surgeon',gripUsage:.96,brakeUsage:.92,apexBias:1.06,defend:.80,draftSeek:1.00,pickupSeek:1.05,nitroMin:6,lookScale:.33,freq:.47}),
 porsche:Object.freeze({name:'Dive-Bomber',gripUsage:.94,brakeUsage:.94,apexBias:1.03,defend:1.00,draftSeek:1.05,pickupSeek:1.00,nitroMin:5,lookScale:.35,freq:.59}),
});
const DEFAULT_PROFILE=DRIVER_PROFILES.concept;

// Cache precomputed minimum-curvature Out-In-Out racing lines per CircuitPath instance.
const racelineCache=new WeakMap();
const _rlSample={x:0,z:0,dx:0,dz:0,heading:0,curvature:0},_rlBounds={min:0,max:0};

export function ensureRaceline(path){
 let cached=racelineCache.get(path);
 if(cached)return cached;
 const M=256,step=path.length/M;
 const x0=new Float64Array(M),z0=new Float64Array(M),rx=new Float64Array(M),rz=new Float64Array(M);
 const lo=new Float64Array(M),hi=new Float64Array(M),alpha=new Float64Array(M),nextAlpha=new Float64Array(M);
 const px=new Float64Array(M),pz=new Float64Array(M);
 const hasBounds=typeof path.laneBounds==='function';
 for(let k=0;k<M;k++){
  const d=k*step;path.sampleAtDistance(d,_rlSample);
  x0[k]=_rlSample.x;z0[k]=_rlSample.z;
  rx[k]=Math.cos(_rlSample.heading);rz[k]=-Math.sin(_rlSample.heading);
  if(hasBounds){
   path.laneBounds(d,_rlBounds);
   // Keep base racing line inside [-2.5, +2.5] m on walled technical tracks so barrier noses are never clipped.
   lo[k]=Math.min(0,Math.max(-2.5,_rlBounds.min+1.15));
   hi[k]=Math.max(0,Math.min(2.5,_rlBounds.max-1.15));
  }else{
   const lim=Math.min(4.6,Math.max(0,(path.width||16)/2-2.2));
   lo[k]=-lim;hi[k]=lim;
  }
 }
 // Iterative elastic-band curvature minimization (following TUMFTM / Braghin minimum-curvature relaxation).
 for(let iter=0;iter<72;iter++){
  for(let k=0;k<M;k++){px[k]=x0[k]+alpha[k]*rx[k];pz[k]=z0[k]+alpha[k]*rz[k];}
  for(let k=0;k<M;k++){
   const km1=(k-1+M)%M,kp1=(k+1)%M,km2=(k-2+M)%M,kp2=(k+2)%M;
   const mx=.5*(px[km1]+px[kp1])+.14*((px[km1]-px[km2])+(px[kp1]-px[kp2]))*.5;
   const mz=.5*(pz[km1]+pz[kp1])+.14*((pz[km1]-pz[km2])+(pz[kp1]-pz[kp2]))*.5;
   const proj=(mx-x0[k])*rx[k]+(mz-z0[k])*rz[k];
   nextAlpha[k]=alpha[k]*.32+clamp(proj,lo[k],hi[k])*.68;
  }
  alpha.set(nextAlpha);
 }
 // Keep gate crossings well inside the 10 m checkpoint validation circle.
 for(let g=0;g<12;g++){
  const center=Math.round(g*M/12)%M;
  for(let o=-2;o<=2;o++){const k=(center+o+M)%M;alpha[k]=clamp(alpha[k],-4.2,4.2);}
 }
 for(let k=0;k<M;k++){px[k]=x0[k]+alpha[k]*rx[k];pz[k]=z0[k]+alpha[k]*rz[k];}
 const heading=new Float64Array(M),rawCurv=new Float64Array(M),curv=new Float64Array(M),insideSide=new Float64Array(M);
 for(let k=0;k<M;k++){
  const km1=(k-1+M)%M,kp1=(k+1)%M;
  heading[k]=Math.atan2(-(px[kp1]-px[km1]),-(pz[kp1]-pz[km1]));
 }
 for(let k=0;k<M;k++){
  const km1=(k-1+M)%M,kp1=(k+1)%M;
  const ds=Math.hypot(px[kp1]-px[km1],pz[kp1]-pz[km1])||1;
  rawCurv[k]=wrapAngle(heading[kp1]-heading[km1])/ds;
 }
 for(let k=0;k<M;k++){
  const km1=(k-1+M)%M,kp1=(k+1)%M;
  curv[k]=.25*rawCurv[km1]+.5*rawCurv[k]+.25*rawCurv[kp1];
  // Look ahead 1..5 steps (~5..25 m) to find the dominant upcoming turn direction for inside-line defense/overtakes.
  let sumCurv=0;for(let n=1;n<=5;n++)sumCurv+=rawCurv[(k+n)%M];
  // Positive curvature = left turn (inside is negative lane); negative curvature = right turn (inside is positive lane).
  insideSide[k]=Math.abs(sumCurv)>.008?(sumCurv>0?-1:1):0;
 }
 cached={M,step,length:path.length,alpha,curv,insideSide};
 racelineCache.set(path,cached);
 return cached;
}

function sampleRaceline(rl,s,out){
 const len=rl.length,d=((s%len)+len)%len/rl.step,i=Math.min(rl.M-1,Math.floor(d)),j=(i+1)%rl.M,f=d-i;
 out.lane=rl.alpha[i]+(rl.alpha[j]-rl.alpha[i])*f;
 out.curv=rl.curv[i]+(rl.curv[j]-rl.curv[i])*f;
 out.insideSide=rl.insideSide[i];
 return out;
}

export class RaceMode{
 constructor({physics,scene=null,rides=null,renderState=null,slotOffset=1,path=null,asphalt=null,laps=3,keepVisible=[],trackFactory=buildCircuit,name='Solana Raceway',padFractions=null,groundY=0}={}){
  this.groundY=groundY;this.trackFactory=trackFactory;this.name=name;this.padFractions=padFractions;this.keepVisible=keepVisible;this.physics=physics;this.scene=scene;this.rides=rides;this.renderState=renderState;this.slotOffset=slotOffset;this.path=path||new CircuitPath();this.asphalt=asphalt;this.laps=laps;this.active=false;this.phase='idle';this.entries=[];this.opponents=[];this.order=new Int8Array(5);this.scratch={x:0,z:0,dx:0,dz:0,heading:0,curvature:0};this.look={x:0,z:0,dx:0,dz:0,heading:0,curvature:0};this.pose={x:0,z:0,heading:0};this.laneRange={min:0,max:0};this.lookBounds={min:0,max:0};this.rlNow={lane:0,curv:0,insideSide:0};this.rlLook={lane:0,curv:0,insideSide:0};this.spinQ=new T.Quaternion();this.steerQ=new T.Quaternion();this.time=0;this.countdown=3;this.pickups=[];this.pads=[];this.revision=0;
 }
 start(playerCarId,player){
  if(this.active)this.stop();this.savedPose=player.copyState({});this.savedActors=this.physics.objects.slice();this.savedActive=this.savedActors.map(a=>a.body.isActive());for(const a of this.savedActors)if(a!==player&&a.body.getType()!=='static')a.body.setActive(false);
  this.savedVisuals=[];this.savedVisibility=[];if(this.scene)for(const node of this.scene.children)if(!node.isLight&&!node.isCamera&&!this.keepVisible.includes(node)){this.savedVisuals.push(node);this.savedVisibility.push(node.visible);node.visible=false;}
  this.player=player;this.active=true;this.phase='countdown';this.time=0;this.countdown=3;this.finishWait=0;this.entries=[];this.opponents=[];this.order.set([0,1,2,3,4]);this.revision++;
  this.ownedAsphalt=this.asphalt?.clone()||null;if(this.ownedAsphalt){this.ownedAsphalt.repeat.set(1,1);this.ownedAsphalt.needsUpdate=true;}this.track=this.scene?this.trackFactory(this.scene,this.physics,this.path,this.ownedAsphalt):null;
  ensureRaceline(this.path);
  this.pads=[];for(const at of [[50,-160],[-90,230],[-210,-110]]){let best=0,error=Infinity;for(let i=0;i<this.path.count;i++){const d=(this.path.x[i]-this.path.originX-at[0])**2+(this.path.z[i]-this.path.originZ-at[1])**2;if(d<error){error=d;best=i*this.path.ds;}}const p=this.path.sampleAtDistance(best,this.scratch);if(this.padFractions)this.path.sampleAtDistance(this.padFractions[this.pads.length]*this.path.length,this.scratch);this.pads.push({id:'circuit-'+this.pads.length,x:p.x,z:p.z,heading:p.heading,width:6,length:6});}
  this.pickups=Array.from({length:10},(_,i)=>{const p=this.path.sampleAtDistance((i+.5)*this.path.length/10,this.scratch);return {id:i,x:p.x,z:p.z,active:true,cooldown:0};});
  const definitions=[VEHICLES.find(v=>v.id===playerCarId),...VEHICLES.filter(v=>v.id!==playerCarId)];
  for(let i=0;i<5;i++){const def=definitions[i],ride=this.rides?.[def.id],grid=-i*12,p=this.path.sampleAtDistance(grid,this.scratch),lane=i?(i%2?2.5:-2.5):0,x=p.x+lane*Math.cos(p.heading),z=p.z-lane*Math.sin(p.heading);let actor=player,mesh=null,wheels=[];
   if(i){actor=this.physics.addVehicle({x,z,heading:p.heading,width:ride?.size.x||1.9,length:ride?.size.z||def.length,height:ride?.size.y||1.5,...def.tuning,userData:{kind:'opponent',id:def.id,index:i-1}});if(ride&&this.scene){mesh=ride.group.clone(true);mesh.visible=true;this.scene.add(mesh);for(const w of ride.wheels)wheels.push({node:mesh.getObjectByName(w.node.name),front:w.front,base:w.base.clone(),radius:w.radius||.35,spinAxis:w.spinAxis,steerAxis:w.steerAxis,rollSign:w.rollSign??1});const instrument=mesh.getObjectByName('Cockpit instruments');if(instrument)instrument.visible=false;mesh.traverse(n=>{if(n.isLight)n.visible=false;});}}
   actor.setPose({x,z,heading:p.heading});actor.elevation=actor.groundPitch=actor.groundRoll=0;actor.groundElevation=actor.prevGroundElevation=this.groundY;actor.isAirborne=false;actor.rampId=null;actor.surfaceGrip=1;actor.surfaceDrag=0;actor.dragMultiplier=1;
   const splitTimes=new Float64Array(this.laps*12+1);splitTimes.fill(NaN);if(i===0)splitTimes[0]=0;
   const profile=DRIVER_PROFILES[def.id]||DEFAULT_PROFILE;
   const entry={splitTimes,def,profile,actor,mesh,wheels,index:i,progress:grid,rankProgress:grid,lap:0,nextGate:i?0:1,lapStart:0,lapTime:0,bestLap:Infinity,finishTime:Infinity,nitro:40,boostGate:{boosting:false,locked:false},pad:new BoostPadTimer(this.pads),lastX:x,lastZ:z,controls:{throttle:0,reverse:0,brake:1,steer:0,boost:false,handbrake:false},exhaust:0,stuckTimer:0,recovery:0,recoveryTime:0,lane:lane,steering:0,wheelDistance:0,drafting:false,targetSpeed:0,boostRequest:false,passIndex:-1,passLane:0,passSide:1,pressureMode:0,pressureTime:0,pressureCooldown:0,pressureLane:0,tacticalMode:'raceline'};
   this.entries.push(entry);if(i){this.opponents.push(entry);if(this.renderState)this.renderState.setActor(this.slotOffset+i-1,actor);}this.renderState?.snapSlot(0);
  }
  if(this.track)updateRaceGates(this.track.gates,1,this.laps);this.buildMarkers();return this;
 }
 buildMarkers(){if(!this.scene)return;this.markers=new T.Group();this.scene.add(this.markers);const material=new T.MeshBasicMaterial({color:0xfcaf17}),geometry=new T.BoxGeometry(5,.035,.3),strips=new T.InstancedMesh(geometry,material,9),dummy=new T.Object3D();let i=0;for(const p of this.pads)for(const z of [-2,0,2]){dummy.position.set(p.x+Math.sin(p.heading)*z,.05,p.z+Math.cos(p.heading)*z);dummy.rotation.y=p.heading;dummy.updateMatrix();strips.setMatrixAt(i++,dummy.matrix);}this.markers.add(strips);}

 beforeStep(dt,input){
  if(!this.active)return;
  if(this.phase==='countdown'){this.countdown-=dt;if(this.countdown<=0){this.phase='racing';this.countdown=0;this.revision++;}}
  const running=this.phase==='racing'||this.phase==='finishing';
  for(let i=0;i<5;i++){const e=this.entries[i],a=e.actor,k=e.controls;
   if(this.path.surfaceAt){const surface=this.path.surfaceAt(a.x,a.z);a.surfaceGrip=surface.grip;a.surfaceDrag=surface.drag;}
   if(!running){k.throttle=k.reverse=k.steer=0;k.brake=1;k.boost=false;a.setControls(k);continue;}
   if(Number.isFinite(e.finishTime)){this.driveAI(e,dt);k.boost=false;k.throttle=a.speed<20?k.throttle:0;k.brake=a.speed>22?.3:0;a.setControls(k);continue;}
   e.pad.step(a,dt);if(i)this.driveAI(e,dt);else{k.throttle=input.throttle;k.reverse=input.reverse;k.brake=0;k.handbrake=input.handbrake;k.steer=T.MathUtils.damp(k.steer,input.steer,12,dt);this.draft(e);}
   e.nitro=nextBoost(e.boostGate,e.nitro,i?e.boostRequest:!!input.boost&&a.forwardSpeed>2&&k.throttle>0&&!k.reverse,dt);k.boost=e.boostGate.boosting||e.pad.active;
   if(!i&&e.pad.active&&!k.reverse)k.throttle=1;
   a.setControls(k);
  }
 }
 draft(e){const a=e.actor,s=Math.sin(a.heading),c=Math.cos(a.heading);e.drafting=false;for(let j=0;j<5;j++){const b=this.entries[j].actor;if(a===b)continue;const dx=b.x-a.x,dz=b.z-a.z,ahead=-dx*s-dz*c,lat=Math.abs(dx*c-dz*s);if(ahead>4&&ahead<28&&lat<2.35&&Math.cos(b.heading-a.heading)>.82){e.drafting=true;break;}}a.dragMultiplier=e.drafting?.65:1;}


 // Shared lane-clearance query: no per-car callback allocation in the physics loop.
 isLaneClear(a,ignored,candidate,min,max,px,pz,rx,rz,fx,fz){
  if(candidate<min-.01||candidate>max+.01)return false;
  for(let n=0;n<this.entries.length;n++){
   const car=this.entries[n].actor;if(car===a||car===ignored)continue;
   const dist=(car.x-a.x)*fx+(car.z-a.z)*fz,lane=(car.x-px)*rx+(car.z-pz)*rz;
   if(dist>-(a.length+car.length)*.5-2.5&&dist<(a.length+car.length)*.5+6&&Math.abs(lane-candidate)<(a.width+car.width)*.5+.38)return false;
  }
  return true;
 }

 driveAI(e,dt){
  const a=e.actor,k=e.controls,path=this.path,speed=a.forwardSpeed,abs=Math.abs(speed),c=a.config,prof=e.profile||DEFAULT_PROFILE;
  const rl=ensureRaceline(path),isTechnical=typeof path.laneBounds==='function';
  path.sampleAtDistance(e.progress,this.scratch);this.draft(e);
  const localCurv=this.scratch.curvature,px=this.scratch.x,pz=this.scratch.z,rx=Math.cos(this.scratch.heading),rz=-Math.sin(this.scratch.heading),fx=this.scratch.dx,fz=this.scratch.dz;
  const currentLat=(a.x-px)*rx+(a.z-pz)*rz;

  // Dynamic human-like focus & pressure wave (deterministic, allocation-free).
  const focusWave=Math.sin(this.time*prof.freq+e.index*1.9)*.5+Math.cos(this.time*(prof.freq*1.63)+e.index*3.1)*.5;
  const playerGap=this.entries[0]?this.entries[0].rankProgress-e.rankProgress:0;
  // Chasing AI pushes harder when trailing the player within 250 m.
  const paceBoost=e.index>0&&playerGap>8&&playerGap<250?clamp(playerGap/140,0,1)*.035:0;

  // Sample precomputed Out-In-Out minimum-curvature racing line.
  sampleRaceline(rl,e.progress,this.rlNow);
  const curvFactor=1+Math.abs(this.rlNow.curv)*(isTechnical?24:18);
  const L=clamp(abs*(prof.lookScale/curvFactor),4.8,17.5);
  sampleRaceline(rl,e.progress+L*.75,this.rlLook);
  path.sampleAtDistance(e.progress+clamp(abs*.65,12,32),this.look);

  // Track safe lateral bounds across both current position and the Pure Pursuit lookahead point.
  const margin=Math.max(a.width/2+.4,a.length*.4);
  const laneLimit=path.laneLimit?path.laneLimit(e.progress,margin):path.width/2-a.width/2-1;
  const bounds=this.laneRange;
  if(isTechnical){
   path.laneBounds(e.progress,bounds);
   path.laneBounds(e.progress+L,this.lookBounds);
   bounds.min=Math.max(bounds.min,this.lookBounds.min);
   bounds.max=Math.min(bounds.max,this.lookBounds.max);
   if(path.laneLimit){bounds.min=Math.max(bounds.min,-laneLimit);bounds.max=Math.min(bounds.max,laneLimit);}
  }else{bounds.min=-laneLimit;bounds.max=laneLimit;}

  const tacticalMin=isTechnical?Math.max(bounds.min,-2.7):bounds.min;
  const tacticalMax=isTechnical?Math.min(bounds.max,2.7):bounds.max;
  // Blend current and preview raceline offsets for crisp apex entry and wide exit, plus subtle human micro-variation.
  let baseLane=clamp((this.rlNow.lane*.4+this.rlLook.lane*.6)*prof.apexBias+focusWave*.14,tacticalMin,tacticalMax);
  let desiredLane=baseLane;
  e.tacticalMode='raceline';

  // Opportunistic boost-pad and nitro-bottle seeking when not in a sharp corner.
  if(Math.abs(localCurv)<.018&&tacticalMax-tacticalMin>1.8){
   let bestBonus=0,bonusLane=baseLane;
   for(let p=0;p<this.pads.length;p++){
    const pad=this.pads[p],dx=pad.x-a.x,dz=pad.z-a.z,ahead=dx*fx+dz*fz;
    if(ahead<5||ahead>40)continue;
    const pLane=clamp((pad.x-px)*rx+(pad.z-pz)*rz,tacticalMin,tacticalMax);
    if(Math.min(Math.abs(pLane-baseLane),Math.abs(pLane-currentLat))<=2.4*prof.pickupSeek){
     const score=(1-ahead/40)*1.5;if(score>bestBonus){bestBonus=score;bonusLane=pLane;}
    }
   }
   if(e.nitro<=80){
    for(let p=0;p<this.pickups.length;p++){
     const pk=this.pickups[p];if(!pk.active)continue;
     const dx=pk.x-a.x,dz=pk.z-a.z,ahead=dx*fx+dz*fz;
     if(ahead<4||ahead>34)continue;
     const pLane=clamp((pk.x-px)*rx+(pk.z-pz)*rz,tacticalMin,tacticalMax);
     if(Math.min(Math.abs(pLane-baseLane),Math.abs(pLane-currentLat))<=2.0*prof.pickupSeek){
      const score=(1-ahead/34)*(e.nitro<40?1.35:.95);if(score>bestBonus){bestBonus=score;bonusLane=pLane;}
     }
    }
   }
   if(bestBonus>0){desiredLane=bonusLane;e.tacticalMode='pickup';}
  }

  // Slipstream seeking on straights: tuck into a fast leader's wake before slinging out to pass.
  if(Math.abs(localCurv)<.009&&Math.abs(this.look.curvature)<.011&&e.passIndex<0){
   for(let j=0;j<5;j++){
    const b=this.entries[j].actor;if(b===a)continue;
    const dx=b.x-a.x,dz=b.z-a.z,ahead=dx*fx+dz*fz;
    if(ahead>16&&ahead<34&&b.forwardSpeed>16&&b.forwardSpeed>=speed-2.5){
     const bLane=clamp((b.x-px)*rx+(b.z-pz)*rz,tacticalMin,tacticalMax);
     if(Math.min(Math.abs(bLane-desiredLane),Math.abs(bLane-currentLat))<2.2*prof.draftSeek){desiredLane=bLane;e.tacticalMode='draft';break;}
    }
   }
  }

  // Defensive inside-line protection when a faster attacker is closing from behind.
  if(e.passIndex<0&&tacticalMax-tacticalMin>2.2){
   for(let j=0;j<5;j++){
    const b=this.entries[j].actor;if(b===a)continue;
    const dx=b.x-a.x,dz=b.z-a.z,ahead=dx*fx+dz*fz;
    if(ahead<-3.8&&ahead>-18&&b.forwardSpeed>speed+1.0){
     const attLane=clamp((b.x-px)*rx+(b.z-pz)*rz,tacticalMin,tacticalMax);
     const inside=this.rlNow.insideSide||this.rlLook.insideSide;
     if(inside!==0){
      const insideTarget=inside<0?Math.max(tacticalMin,baseLane-1.2*prof.defend):Math.min(tacticalMax,baseLane+1.2*prof.defend);
      desiredLane=clamp(baseLane*.45+insideTarget*.55,tacticalMin,tacticalMax);
     }else if(Math.abs(attLane-currentLat)<2.2){
      desiredLane=clamp(currentLat+(attLane-currentLat)*Math.min(.75,prof.defend*.65),tacticalMin,tacticalMax);
     }
     e.tacticalMode='defend';break;
    }
   }
  }

  // Overtaking & Context Steering: maintain active pass or select highest-scoring clear lane around slower traffic.


  if(e.passIndex>=0){
   const b=this.entries[e.passIndex].actor,ahead=(b.x-a.x)*fx+(b.z-a.z)*fz;
   const bLane=(b.x-px)*rx+(b.z-pz)*rz,sep=(a.width+b.width)*.5+.65;
   const cand=bLane+e.passSide*sep;
   if(ahead>-(a.length+b.length)*.5-3.5&&ahead<30&&cand>=bounds.min&&cand<=bounds.max&&this.isLaneClear(a,b,cand,bounds.min,bounds.max,px,pz,rx,rz,fx,fz)){
    e.passLane=desiredLane=cand;e.tacticalMode='overtake';
   }else e.passIndex=-1;
  }

  if(e.passIndex<0&&e.tacticalMode!=='draft'){
   const inside=this.rlNow.insideSide||this.rlLook.insideSide||(e.index%2?1:-1);
   for(let j=0;j<5;j++){
    const b=this.entries[j].actor;if(b===a)continue;
    const dx=b.x-a.x,dz=b.z-a.z,ahead=dx*fx+dz*fz,lateral=dx*rx+dz*rz;
    const closing=speed-b.forwardSpeed;
    if(ahead<0||ahead>Math.max(20,13+closing*2.2)||Math.abs(lateral)>(a.width+b.width)*.5+.80||Math.cos(b.heading-a.heading)<.5)continue;
    const otherLane=(b.x-px)*rx+(b.z-pz)*rz,sep=(a.width+b.width)*.5+.65;
    let bestSide=0,bestCand=desiredLane,bestScore=-1e9;
    for(let sIdx=0;sIdx<2;sIdx++){
     const sign=sIdx===0?inside:-inside;
     const cand=clamp(otherLane+sign*sep,bounds.min,bounds.max);
     if(Math.abs(cand-otherLane)<(a.width+b.width)*.5+.42)continue;
     if(!this.isLaneClear(a,b,cand,bounds.min,bounds.max,px,pz,rx,rz,fx,fz))continue;
     // Context score: prefer inside of upcoming corner, closeness to optimal racing line, and minimal lateral swerve.
     const insideBonus=sign===inside?1.1:0;
     const score=insideBonus-Math.abs(cand-baseLane)*.35-Math.abs(cand-currentLat)*.25;
     if(score>bestScore){bestScore=score;bestSide=sign;bestCand=cand;}
    }
    if(bestSide!==0){
     e.passIndex=j;e.passSide=bestSide;e.passLane=desiredLane=bestCand;e.tacticalMode='overtake';break;
    }
   }
  }

  // Brief arcade pressure maneuvers use the same steering and collision solver.
  // Never chase a stopped/wrong-way car or squeeze a rival at a wall or hairpin.
  const rival=this.entries[0].actor,rdx=rival.x-a.x,rdz=rival.z-a.z;
  const rivalAhead=rdx*fx+rdz*fz,rivalLane=(rival.x-px)*rx+(rival.z-pz)*rz;
  const halfLength=(a.length+rival.length)*.5,halfWidth=(a.width+rival.width)*.5;
  e.pressureCooldown=Math.max(0,e.pressureCooldown-dt);
  const canPressure=e.index>0&&this.phase==='racing'&&e.recovery===0&&abs>12&&rival.forwardSpeed>10&&Math.abs(speed-rival.forwardSpeed)<7&&Math.cos(rival.heading-a.heading)>.94&&Math.abs(localCurv)<.012&&Math.abs(this.look.curvature)<.016&&bounds.max-bounds.min>3&&Math.abs(playerGap)<35;
  let pressure=0,pressureLane=currentLat;
  if(canPressure){
   if(rivalAhead< -halfLength-1&&rivalAhead>-23&&rival.forwardSpeed>speed+.4){
    const prediction=rivalLane+(rival.vx*rx+rival.vz*rz)*.25;
    pressureLane=clamp(prediction,Math.max(bounds.min+.25,currentLat-1.6),Math.min(bounds.max-.25,currentLat+1.6));pressure=1;
   }else if(Math.abs(rivalAhead)<halfLength*.7&&Math.abs(speed-rival.forwardSpeed)<4.5&&Math.abs(currentLat-rivalLane)>halfWidth-.3&&Math.abs(currentLat-rivalLane)<halfWidth+1.3){
    const side=currentLat>=rivalLane?1:-1;
    pressureLane=rivalLane+side*(halfWidth-.10);
    // Leave the player's outside lane open as well as respecting our own bounds.
    if(pressureLane>=bounds.min+.35&&pressureLane<=bounds.max-.35&&rivalLane>=bounds.min+.35&&rivalLane<=bounds.max-.35)pressure=2;
   }
  }
  if(pressure&&e.pressureCooldown===0&&this.isLaneClear(a,rival,pressureLane,bounds.min,bounds.max,px,pz,rx,rz,fx,fz)){
   e.pressureTime+=dt;
   if(e.pressureTime<=.9){e.pressureMode=pressure;e.pressureLane=pressureLane;desiredLane=pressureLane;e.passIndex=-1;e.tacticalMode=pressure===1?'block':'contest';}
   else{e.pressureMode=0;e.pressureTime=0;e.pressureCooldown=2.4;}
  }else{if(e.pressureMode)e.pressureCooldown=2.4;e.pressureMode=0;e.pressureTime=0;}

  // Side-by-side wheel-to-wheel awareness: prevent squeezing an overlapping car into the wall.
  for(let j=0;j<5;j++){
   const b=this.entries[j].actor;if(b===a||(b===rival&&e.pressureMode===2))continue;
   const dx=b.x-a.x,dz=b.z-a.z,ahead=dx*fx+dz*fz;
   if(Math.abs(ahead)<(a.length+b.length)*.5+1.2&&Math.cos(b.heading-a.heading)>.6){
    const bLane=(b.x-px)*rx+(b.z-pz)*rz,minSep=(a.width+b.width)*.5+.48;
    if(currentLat>=bLane&&desiredLane<bLane+minSep)desiredLane=Math.min(bounds.max,bLane+minSep);
    else if(currentLat<bLane&&desiredLane>bLane-minSep)desiredLane=Math.max(bounds.min,bLane-minSep);
   }
  }

  const laneRate=e.pressureMode?3.2:e.tacticalMode==='overtake'?3.4:(isTechnical?2.2:2.7);
  e.lane=T.MathUtils.damp(e.lane,desiredLane,laneRate,dt);

  path.sampleAtDistance(e.progress+L,this.look);
  const tx=this.look.x+Math.cos(this.look.heading)*e.lane-a.x,tz=this.look.z-Math.sin(this.look.heading)*e.lane-a.z,error=wrapAngle(Math.atan2(-tx,-tz)-a.heading);

  // Physics-calibrated cornering speed profile using the Out-In-Out raceline curvature when on line,
  // blending toward centerline curvature when displaced off-line during a pass.
  const offLine=clamp(Math.abs(e.lane-this.rlNow.lane)/(isTechnical?2.0:3.2),0,1);
  const brakeAccel=c.brakeAcceleration*(isTechnical?prof.brakeUsage*.93:prof.brakeUsage);
  const gripScale=isTechnical?Math.min(.88,prof.gripUsage*.93+paceBoost):Math.min(.97,prof.gripUsage+paceBoost);
  const grip=c.grip*(a.surfaceGrip??1)*gripScale;
  const preview=11+abs*abs/(2*brakeAccel);
  const cornerExit=Math.abs(this.rlLook.curv)<Math.abs(this.rlNow.curv)*.85&&Math.abs(this.rlNow.curv)<.022;
  let safeSpeed=c.boostSpeed;
  for(let d=0;d<=preview;d+=2.5){
   const sDist=e.progress+d;
   path.sampleAtDistance(sDist,this.scratch);
   sampleRaceline(rl,sDist,this.rlLook);
   const cCenter=Math.abs(this.scratch.curvature),cRace=Math.max(Math.abs(this.rlLook.curv),cCenter*(isTechnical?.88:.72));
   const effCurv=cRace+(cCenter-cRace)*offLine;
   const corner2=grip/(effCurv+1e-4);
   safeSpeed=Math.min(safeSpeed,Math.sqrt(corner2+2*brakeAccel*Math.max(0,d-abs*(isTechnical?.14:.09))));
  }

  // Match closing speed when a slower car blocks the lane ahead and no passing gap exists.
  for(let j=0;j<5;j++){
   const b=this.entries[j].actor;if(b===a)continue;const dx=b.x-a.x,dz=b.z-a.z,ahead=-dx*Math.sin(a.heading)-dz*Math.cos(a.heading);
   if(!(b===rival&&e.pressureMode===2&&ahead<halfLength*.7)&&ahead>0&&ahead<35&&Math.cos(b.heading-a.heading)>.5&&Math.abs((b.x-px)*rx+(b.z-pz)*rz-desiredLane)<(a.width+b.width)*.5+.35){
    const room=Math.max(0,ahead-(a.length+b.length)*.5-2-abs*.15),otherSpeed=Math.max(0,b.forwardSpeed);
    safeSpeed=Math.min(safeSpeed,Math.sqrt(otherSpeed*otherSpeed+2*brakeAccel*room));
   }
  }

  if(e.recovery===0){if(abs<1.2&&(k.throttle>.8||e.passIndex>=0))e.stuckTimer+=dt;else e.stuckTimer=0;if(Math.abs(error)>Math.PI*.65||e.stuckTimer>1.2){e.recovery=1;e.recoveryTime=0;e.stuckTimer=0;}}
  e.boostRequest=false;
  if(e.recovery===1){e.recoveryTime+=dt;k.throttle=0;k.reverse=1;k.brake=0;k.steer=-Math.sign(error);k.handbrake=false;if(e.recoveryTime>1.1||(Math.abs(error)<.65&&e.recoveryTime>.4)){e.recovery=2;e.recoveryTime=0;}return;}
  if(e.recovery===2){e.recoveryTime+=dt;if(e.recoveryTime>1){e.recovery=0;e.recoveryTime=0;}}

  const effLocalCurv=Math.abs(this.rlNow.curv)+(Math.abs(localCurv)-Math.abs(this.rlNow.curv))*offLine;
  const aligned=Math.abs(error)<.22&&Math.abs(a.lateralSpeed)<2.8;
  e.boostRequest=e.recovery===0&&e.nitro>(e.boostGate.boosting?0:prof.nitroMin)&&speed>11&&aligned&&safeSpeed>speed+(e.boostGate.boosting?.8:2.4)&&(effLocalCurv<.019||cornerExit||e.drafting||e.tacticalMode==='overtake');
  const boosting=e.pad.active||e.boostRequest;
  const target=Math.min(safeSpeed,boosting?c.boostSpeed:c.maxSpeed);e.targetSpeed=target;
  k.throttle=target-speed>.4?1:clamp((target-speed)*2.4,0,1);k.reverse=0;k.brake=clamp((speed-safeSpeed-.35)*.42,0,1);

  // Coulter pure pursuit with cross-track damping.
  const chord=Math.max(1,Math.hypot(tx,tz)),curvature=2*Math.sin(error)/chord;
  k.steer=clamp(Math.atan(c.wheelbase*curvature)/(c.steerAngle/(1+abs/44)),-1,1);
  k.handbrake=!isTechnical&&abs>20&&effLocalCurv>.040&&Math.abs(error)>.42&&speed>safeSpeed+3.5;
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
 render(alpha,dt){if(!this.active||!this.scene)return;updateRaceGates(this.track.gates,this.entries[0].nextGate,this.laps); for(let i=0;i<this.opponents.length;i++){const e=this.opponents[i];if(!e.mesh)continue;if(this.renderState)this.renderState.sample(this.slotOffset+i,alpha,this.pose);else{this.pose.x=e.actor.x;this.pose.z=e.actor.z;this.pose.heading=e.actor.heading;}e.mesh.position.set(this.pose.x,this.groundY,this.pose.z);e.mesh.rotation.y=this.pose.heading;e.wheelDistance+=e.actor.forwardSpeed*dt;for(let j=0;j<e.wheels.length;j++){const w=e.wheels[j];this.spinQ.setFromAxisAngle(w.spinAxis||T.Object3D.DEFAULT_UP,e.wheelDistance/w.radius*w.rollSign);w.node.quaternion.copy(w.base).multiply(this.spinQ);if(w.front){this.steerQ.setFromAxisAngle(w.steerAxis||T.Object3D.DEFAULT_UP,e.controls.steer*e.actor.config.steerAngle/(1+Math.abs(e.actor.forwardSpeed)/44));w.node.quaternion.premultiply(this.steerQ);}}}if(this.pickupMeshes)for(let i=0;i<10;i++){this.pickupMeshes[i].visible=this.pickups[i].active;this.pickupMeshes[i].rotation.y+=dt;}}
 stop(){if(!this.active)return;for(const e of this.entries)e.actor.dragMultiplier=1;for(let i=0;i<this.opponents.length;i++){const e=this.opponents[i];e.mesh?.removeFromParent();if(this.renderState)this.renderState.clearActor(this.slotOffset+i);this.physics.remove(e.actor);}this.track?.dispose();this.ownedAsphalt?.dispose();if(this.markers){this.markers.removeFromParent();const gs=new Set(),ms=new Set();this.markers.traverse(n=>{if(n.isMesh){gs.add(n.geometry);ms.add(n.material);}});for(const g of gs)g.dispose();for(const m of ms)m.dispose();}for(let i=0;i<this.savedActors.length;i++)if(this.savedActors[i].body.isActive()!==this.savedActive[i])this.savedActors[i].body.setActive(this.savedActive[i]);for(let i=0;i<this.savedVisuals.length;i++)this.savedVisuals[i].visible=this.savedVisibility[i];this.player.setPose(this.savedPose);this.player.groundElevation=0;this.renderState?.snapSlot(0);this.entries=[];this.opponents=[];this.active=false;this.phase='idle';}
}
