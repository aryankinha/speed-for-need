import test from 'node:test';
import assert from 'node:assert/strict';
import {createDrivingWorld} from '../dist/physics.js';
import {StuntSystem,RAMPS,addRampColliders,rampProgress,rampLateral,rampSurface} from '../dist/stunts.js';

// Worst corner that sits below the deck it is over, using the body's real elevation and pitch. Counted on every
// frame the car is on the ramp or on the ground over it (including rampId frames), so a buried nose fails here.
function worstCornerBelowDeck(ramp,car){
  const h=car.heading,fwx=-Math.sin(h),fwz=-Math.cos(h),rx=Math.cos(h),rz=-Math.sin(h),hl=car.length/2,hw=car.width/2,tanP=Math.tan(car.pitch);
  let worst=0;
  for(const sf of [-1,1])for(const sl of [-1,1]){
    const cx=car.x+fwx*sf*hl+rx*sl*hw,cz=car.z+fwz*sf*hl+rz*sl*hw;
    const cu=rampProgress(ramp,cx,cz),cl=rampLateral(ramp,cx,cz);
    if(cu>=0&&cu<=ramp.shape.length&&Math.abs(cl)<=ramp.shape.width/2){
      worst=Math.max(worst,rampSurface(ramp.shape,cu)-(car.elevation+sf*hl*tanP));
    }
  }
  return worst;
}

// Edge and diagonal entries through the real planck world, real ramp colliders and StuntSystem.
// Each run records what a player would feel: stalls, teleports, solid-volume intrusions and heading flips.
const storage=()=>({getItem:()=>null,setItem(){}});
const DEG=Math.PI/180;
// Outside wheels above the asphalt (round-2 hover metric): counted on frames the car is supported by the ramp.
function worstHoverWheel(ramp,car){
  if(!car.rampId||car.isAirborne)return 0;
  const h=car.heading,fwx=-Math.sin(h),fwz=-Math.cos(h),rx=Math.cos(h),rz=-Math.sin(h),fo=(car.config?.wheelbase??2.7)/2,tw=car.width/2;
  const tanP=Math.tan(car.pitch),tanR=Math.tan(car.deckLean||0);
  let worst=0;
  for(const sf of [-1,1])for(const sl of [-1,1]){
    const wx=car.x+fwx*sf*fo+rx*sl*tw,wz=car.z+fwz*sf*fo+rz*sl*tw;
    const wu=rampProgress(ramp,wx,wz),wl=rampLateral(ramp,wx,wz);
    if(wu>=0&&wu<=ramp.shape.length&&Math.abs(wl)>ramp.shape.width/2)worst=Math.max(worst,car.elevation+sf*fo*tanP+sl*tw*tanR);
  }
  return worst;
}
// Corners beside or beyond the deck that sit below the asphalt (round-2 ground metric).
function worstCornerBelowAsphalt(ramp,car){
  if(!car.rampId||car.isAirborne)return 0;
  const h=car.heading,fwx=-Math.sin(h),fwz=-Math.cos(h),rx=Math.cos(h),rz=-Math.sin(h),hl=car.length/2,hw=car.width/2;
  const tanP=Math.tan(car.pitch),tanR=Math.tan(car.deckLean||0);
  let worst=0;
  for(const sf of [-1,1])for(const sl of [-1,1]){
    const cx=car.x+fwx*sf*hl+rx*sl*hw,cz=car.z+fwz*sf*hl+rz*sl*hw;
    const cu=rampProgress(ramp,cx,cz),cl=rampLateral(ramp,cx,cz);
    if(!(cu>=0&&cu<=ramp.shape.length&&Math.abs(cl)<=ramp.shape.width/2))worst=Math.max(worst,-(car.elevation+sf*hl*tanP+sl*hw*tanR));
  }
  return worst;
}

function approach(ramp,{lateral=0,heading=0,speed=20,throttle=1,seconds=4,start=8,x,z,vx,vz,steer=0}={}){
  const world=createDrivingWorld();addRampColliders(world);
  const shape=ramp.shape,fx=-Math.sin(heading),fz=-Math.cos(heading);
  const px=x??ramp.x+Math.cos(ramp.heading)*lateral-fx*start,pz=z??ramp.z-Math.sin(ramp.heading)*lateral-fz*start;
  const car=world.addVehicle({x:px,z:pz,heading,height:1.3});const stunts=new StuntSystem(shape,storage());stunts.reset(car);
  car.setPose({x:px,z:pz,heading,vx:vx??fx*speed,vz:vz??fz*speed});car.setControls({throttle,steer});
  const run={rampSeen:false,maxHover:0,maxGroundPen:0,maxPitch:0,maxCornerPen:0,maxMove:0,maxJolt:0,maxElevStep:0,maxPitchStep:0,inside:0,onTop:0,stalledSteps:0,holdSteps:0,minSpeedAfterToe:Infinity,maxHeadChange:0,airborneSteps:0,landings:0,exitStep:null,samples:[]};
  let prev=null,stalled=0;const h0=heading;
  for(let i=0;i<seconds*120;i++){
    world.step(1/120,()=>stunts.beginStep(car),dt=>stunts.step(car,dt));
    const s={x:car.x,z:car.z,h:car.heading,e:car.elevation,p:car.pitch,air:car.isAirborne,rid:car.rampId,speed:car.speed,ign:car.ignoreRampId,hold:car.holdTime};
    if(s.rid)run.rampSeen=true;
    if(s.rid||!s.air){run.maxCornerPen=Math.max(run.maxCornerPen,worstCornerBelowDeck(ramp,car));run.maxHover=Math.max(run.maxHover,worstHoverWheel(ramp,car));run.maxGroundPen=Math.max(run.maxGroundPen,worstCornerBelowAsphalt(ramp,car));run.maxPitch=Math.max(run.maxPitch,Math.abs(car.pitch));}
    if(prev){
      const move=Math.hypot(s.x-prev.x,s.z-prev.z);run.maxMove=Math.max(run.maxMove,move);
      // Motion beyond what the car's own speed explains: a teleport, a solver shove or a stuck-then-released snap.
      run.maxJolt=Math.max(run.maxJolt,move-Math.max(prev.speed,s.speed)/120);
      run.maxElevStep=Math.max(run.maxElevStep,Math.abs(s.e-prev.e));
      run.maxPitchStep=Math.max(run.maxPitchStep,Math.abs(s.p-prev.p));
      if(prev.air&&!s.air)run.landings++;
      if(!prev.air&&s.air&&run.exitStep===null&&prev.rid)run.exitStep={i,prev,now:s};
    }
    if(s.air)run.airborneSteps++;
    if(s.hold>0)run.holdSteps++;
    run.maxHeadChange=Math.max(run.maxHeadChange,Math.abs(Math.atan2(Math.sin(s.h-h0),Math.cos(s.h-h0))));
    const u=rampProgress(ramp,s.x,s.z),l=rampLateral(ramp,s.x,s.z);
    if(!s.air&&!s.rid&&u>=0&&u<=shape.length&&Math.abs(l)<shape.width/2){if(s.e<shape.height-.2)run.inside++;else run.onTop++;}
    if(throttle>0&&!s.air&&s.speed<.5&&i>60)stalled++;else stalled=0;
    if(stalled>=60)run.stalledSteps=Math.max(run.stalledSteps,stalled);
    if(run.rampSeen&&!s.air&&!s.rid)run.minSpeedAfterToe=Math.min(run.minSpeedAfterToe,s.speed);
    prev=s;
  }
  run.car=car;run.stunts=stunts;run.final={x:car.x,z:car.z,e:car.elevation,air:car.isAirborne,speed:car.speed,heading:car.heading};
  run.finite=Number.isFinite(car.x)&&Number.isFinite(car.z)&&Number.isFinite(car.elevation)&&Number.isFinite(car.pitch);
  return run;
}

test('edge entries 0.5 to 2.5 m off centre are carried up the deck instead of stopping at the toe',()=>{
  const r=RAMPS[0];
  for(const lateral of [.5,1,1.5,2,2.5,-1.5,-2.5]){
    const run=approach(r,{lateral});
    assert.ok(run.rampSeen,`lateral ${lateral} accepted`);
    assert.equal(run.landings,1,`lateral ${lateral} completes the jump`);
    assert.equal(run.stalledSteps,0,`lateral ${lateral} never stalls at the toe`);
    assert.equal(run.inside+run.onTop,0,`lateral ${lateral} never intrudes into or sits on the solid`);
    assert.ok(run.maxCornerPen<.05,`lateral ${lateral} buries a corner by ${run.maxCornerPen}`);
    assert.ok(run.maxJolt<.03,`lateral ${lateral} has no teleport-like step (${run.maxJolt})`);
    assert.ok(run.finite);
  }
});

test('diagonal approaches of 10 to 45 degrees climb, or leave the flank smoothly, without stalling',()=>{
  const r=RAMPS[0];
  for(const deg of [10,20,30,45])for(const lateral of [0,.6,1.2]){
    const run=approach(r,{lateral,heading:deg*DEG,seconds:6});
    assert.equal(run.stalledSteps,0,`${deg} deg lateral ${lateral} stalled`);
    assert.equal(run.inside+run.onTop,0,`${deg} deg lateral ${lateral} intruded into the solid`);
    assert.ok(run.maxCornerPen<.05,`${deg} deg lateral ${lateral} buries a corner by ${run.maxCornerPen}`);
    assert.ok(run.maxJolt<.03,`${deg} deg lateral ${lateral} step ${run.maxJolt}`);
    assert.ok(run.final.speed>10,`${deg} deg lateral ${lateral} keeps moving (${run.final.speed})`);
  }
});

test('a toe corner clipped at 35 or 45 degrees slides past: no dead stop, no flip onto the box',()=>{
  const r=RAMPS[0];
  for(const deg of [35,45])for(const side of [1,-1]){
    const h=deg*DEG,fx=-Math.sin(h),fz=-Math.cos(h),halfW=(Math.abs(Math.cos(h))*1.9+Math.abs(Math.sin(h))*4.5)/2;
    // Inner edge 0.15 m beyond the flank: the corner grazes the chamfer.
    const lateral=side*(3-.15+halfW),ex=Math.cos(h),ez=-Math.sin(h);
    const run=approach(r,{heading:h,speed:20,seconds:3,x:r.x+ex*lateral-fx*9,z:r.z+ez*lateral-fz*9});
    assert.equal(run.stalledSteps,0,`${deg} deg side ${side} stalled`);
    assert.ok(run.minSpeedAfterToe>10||!run.rampSeen,`${deg} deg side ${side} slowed to ${run.minSpeedAfterToe}`);
    assert.ok(run.maxHeadChange<1,`${deg} deg side ${side} rotated ${run.maxHeadChange} rad`);
    assert.equal(run.inside+run.onTop,0,`${deg} deg side ${side} intruded`);
    assert.ok(run.maxCornerPen<.05,`${deg} deg side ${side} buries a corner by ${run.maxCornerPen}`);
    assert.ok(run.maxJolt<.03,`${deg} deg side ${side} step ${run.maxJolt}`);
  }
});

test('sliding off a flank mid-climb keeps height and pitch, then lands on asphalt without a jolt',()=>{
  const r=RAMPS[0];
  // A 30 degree drive up the middle leaves the flank partway up the incline.
  const run=approach(r,{heading:30*DEG,speed:20,seconds:4});
  assert.ok(run.rampSeen,'entered the deck');
  assert.ok(run.exitStep,'left the flank while airborne');
  const {prev,now}=run.exitStep;
  assert.ok(prev.e>.5,`left the incline at height ${prev.e.toFixed(2)}, not at the toe`);
  assert.ok(Math.abs(now.e-prev.e)<.05,`height continuous across the exit (${prev.e} -> ${now.e})`);
  assert.ok(Math.abs(now.p-prev.p)<.05,'pitch carried through the exit');
  assert.ok(run.maxElevStep<.12,`no vertical teleport (${run.maxElevStep})`);
  assert.ok(run.maxJolt<.03,`no lateral jolt (${run.maxJolt})`);
  assert.equal(run.final.air,false,'lands');
  assert.equal(run.final.e,0,'settles on asphalt');
  assert.equal(run.landings,1);
  assert.equal(run.inside+run.onTop,0);
  assert.ok(run.maxCornerPen<.05,`flank exit buries a corner by ${run.maxCornerPen}`);
  assert.ok(run.final.speed>5,'keeps rolling after landing');
});

test('a flank exit that touches down still over the deck is held and eased clear, never shoved through the solid',()=>{
  const r=RAMPS[0];
  // Set the car on the deck, then push its inner edge just past the entry limit so it leaves at height
  // while still overlapping the flank. With no lateral speed it is still overlapping when it lands.
  const world=createDrivingWorld();addRampColliders(world);
  const car=world.addVehicle({x:r.x+3.66,z:r.z-5,heading:0,height:1.3});const stunts=new StuntSystem(r.shape,storage());stunts.reset(car);
  car.setPose({x:r.x+3.66,z:r.z-5,heading:0});car.rampId=r.id;car.elevation=rampSurface(r.shape,5);car.prevElevation=car.elevation;car.pitch=0;
  let held=0,jolt=0,prev=null,airborne=false,landed=false,insideAfterLanding=0;
  for(let i=0;i<4*120;i++){
    world.step(1/120,()=>stunts.beginStep(car),dt=>stunts.step(car,dt));
    if(car.isAirborne)airborne=true;
    if(car.holdTime>0)held++;
    if(prev)jolt=Math.max(jolt,Math.hypot(car.x-prev.x,car.z-prev.z)-Math.max(prev.speed,car.speed)/120);
    if(airborne&&!car.isAirborne)landed=true;
    if(landed&&stunts.overlapsDeck(car,r))insideAfterLanding++;
    prev={x:car.x,z:car.z,speed:car.speed};
  }
  assert.ok(airborne,'left the deck');
  assert.ok(held>0,'the landing hold engaged while overlapping the deck');
  assert.ok(jolt<.03,`eased clear, not shoved (${jolt})`);
  assert.ok(landed&&car.isAirborne===false);
  assert.equal(car.elevation,0);
  assert.equal(insideAfterLanding,0,'ends clear of the solid footprint');
  assert.ok(Number.isFinite(car.x)&&Number.isFinite(car.z));
});

test('every ramp family (kicker, standard, mega) shares the same edge rules at their own width',()=>{
  for(const r of RAMPS){
    const half=r.shape.width/2;
    const run=approach(r,{lateral:half-1.2,seconds:5});
    assert.ok(run.rampSeen,r.id);
    assert.equal(run.stalledSteps,0,r.id);
    assert.equal(run.inside+run.onTop,0,r.id);
    assert.ok(run.maxCornerPen<.05,`${r.id} buries a corner by ${run.maxCornerPen}`);
    assert.ok(run.maxJolt<.03,r.id);
    assert.ok(rampSurface(r.shape,r.shape.length)===r.shape.height,r.id);
  }
});

test('a wheel running off the flank never hovers above the asphalt, at every edge offset and heading',()=>{
  for(const r of [RAMPS[0],RAMPS.find(r=>r.id==='mega')])for(const lateral of [2.5,2,1.5,-1.5,-2,-2.5])for(const deg of [0,20,35]){
    const run=approach(r,{lateral,heading:deg*DEG,seconds:5});
    assert.ok(run.maxHover<=.15,`${r.id} lateral ${lateral} heading ${deg}: a wheel hovers ${run.maxHover.toFixed(3)} m above the asphalt`);
    assert.ok(run.maxCornerPen<.05,`${r.id} lateral ${lateral} heading ${deg}: corner ${run.maxCornerPen.toFixed(3)} m below the deck`);
  }
});

test('no phantom ledge: beyond the lip the body is not pinned and no corner sinks below the asphalt',()=>{
  const mega=RAMPS.find(r=>r.id==='mega');
  for(const deg of [-35,-20,0,20,35])for(const lateral of [0,1.5]){
    const run=approach(mega,{lateral,heading:deg*DEG,speed:35,seconds:5});
    assert.ok(run.maxGroundPen<.05,`mega ${deg} deg lateral ${lateral}: corner ${run.maxGroundPen.toFixed(3)} m below asphalt`);
    assert.ok(run.maxPitch<.6,`mega ${deg} deg lateral ${lateral}: pitch pinned at ${run.maxPitch.toFixed(2)} rad`);
    assert.ok(run.maxElevStep<.35,`mega ${deg} deg lateral ${lateral}: elevation popped ${run.maxElevStep.toFixed(3)} m in one step`);
  }
});

test('elevation never pops more than 0.35 m in one 120 Hz step on any approach',()=>{
  for(const r of RAMPS)for(const lateral of [0,1,2.5,-2.5])for(const deg of [0,20,-20]){
    const run=approach(r,{lateral,heading:deg*DEG,speed:25,seconds:4});
    assert.ok(run.maxElevStep<.35,`${r.id} lateral ${lateral} heading ${deg}: ${run.maxElevStep.toFixed(3)} m step`);
  }
});
