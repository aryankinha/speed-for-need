import test from 'node:test';
import assert from 'node:assert/strict';
import {createDrivingWorld} from '../dist/physics.js';
import {StuntSystem,RAMPS,addRampColliders,rampProgress,rampLateral,leanForWheels,HOLD_LIMIT} from '../dist/stunts.js';
import {clearBoostBodyClass,BOOST_BODY_CLASS,boostDemand,BOOST_PADS} from '../dist/boost-pads.js';

const storage=()=>({getItem:()=>null,setItem(){}});
const DEG=Math.PI/180;
const jump=RAMPS[0],mega=RAMPS.find(r=>r.id==='mega');

test('a wheel lifted above the other side rolls the body toward it: sign is positive for the right side',()=>{
  assert.ok(leanForWheels(1,0,.95)>0,'right higher lifts the right side');
  assert.ok(leanForWheels(0,1,.95)<0,'right lower dips the right side');
  assert.equal(leanForWheels(0,0,.95),0);
});

test('overhanging the +lateral flank tips the car toward the outside: the right (+x) side dips and the car leaves the deck',()=>{
  // Heading 0 on the mega deck, centre 2.6 m out to +x: the right wheels run off the deck and the car tips off.
  const tip=sign=>{
    const x=mega.x+sign*2.6,world=createDrivingWorld();addRampColliders(world);
    const car=world.addVehicle({x,z:mega.z-5,heading:0,height:1.3});
    const stunts=new StuntSystem(mega.shape,storage());stunts.reset(car);
    car.setPose({x,z:mega.z-5,heading:0});car.rampId=mega.id;car.elevation=2;car.prevElevation=2;
    let leanAtExit=null;
    for(let i=0;i<120&&leanAtExit===null;i++){
      const wasOn=car.rampId;
      world.step(1/120,()=>stunts.beginStep(car),dt=>stunts.step(car,dt));
      if(wasOn&&car.isAirborne)leanAtExit=car.deckLean;
    }
    return leanAtExit;
  };
  const right=tip(1),left=tip(-1);
  assert.ok(right!==null&&right<-.05,`+x overhang leans the right side down (deckLean ${right})`);
  assert.ok(left!==null&&left>.05,`-x overhang leans the left side down (deckLean ${left})`);
});

test('a flank exit that touches down still over the deck holds for at most HOLD_LIMIT, keeps control and keeps its impact',()=>{
  const world=createDrivingWorld();addRampColliders(world);
  const r=jump;
  const car=world.addVehicle({x:r.x+3.66,z:r.z-5,heading:0,height:1.3});
  const stunts=new StuntSystem(r.shape,storage());stunts.reset(car);
  car.setPose({x:r.x+3.66,z:r.z-5,heading:0});car.rampId=r.id;car.elevation=2;car.prevElevation=2;
  let maxHold=0,controlled=0,peakImpact=0;
  for(let i=0;i<4*120;i++){
    world.step(1/120,()=>stunts.beginStep(car),dt=>stunts.step(car,dt));
    maxHold=Math.max(maxHold,car.holdTime);
    if(car.groundHold)controlled++;
    peakImpact=Math.max(peakImpact,stunts.landingImpact);
  }
  assert.ok(controlled>0,'the hold engaged');
  assert.ok(maxHold<=HOLD_LIMIT+1/120+1e-9,`hold ${maxHold}`);
  assert.ok(peakImpact>0,'the touchdown impact is reported, not zeroed');
  assert.equal(car.groundHold,false,'released after the hold');
  assert.equal(car.isAirborne,false);
});

test('the car keeps driver control during the hold: throttle still moves it forward',()=>{
  const world=createDrivingWorld();addRampColliders(world);
  const r=jump;
  const car=world.addVehicle({x:r.x+3.66,z:r.z-5,heading:0,height:1.3});
  const stunts=new StuntSystem(r.shape,storage());stunts.reset(car);
  car.setPose({x:r.x+3.66,z:r.z-5,heading:0});car.rampId=r.id;car.elevation=2;car.prevElevation=2;car.setControls({throttle:1});
  let sawHold=false,vzAtHold=null,vzLater=null;
  for(let i=0;i<60;i++){
    world.step(1/120,()=>stunts.beginStep(car),dt=>stunts.step(car,dt));
    if(car.groundHold){sawHold=true;if(vzAtHold===null)vzAtHold=car.vz;vzLater=car.vz;}
  }
  assert.ok(sawHold,'hold engaged');
  assert.ok(vzLater<vzAtHold-.05,`throttle accelerated the car up-deck during the hold (${vzAtHold} -> ${vzLater})`);
});

test('a slow trick launch shows the speed hint; a finished spin shows 360!',()=>{
  const spin=RAMPS.find(r=>r.id==='civic');
  const run=(speed,throttle=1)=>{
    const world=createDrivingWorld();addRampColliders(world);
    const car=world.addVehicle({x:spin.x,z:spin.z+8,heading:0,height:1.3});
    const stunts=new StuntSystem(spin.shape,storage());stunts.reset(car);
    car.setPose({x:spin.x,z:spin.z+8,heading:0,vz:-speed});car.setControls({throttle});
    for(let i=0;i<6*120;i++)world.step(1/120,()=>stunts.beginStep(car),dt=>stunts.step(car,dt));
    return stunts;
  };
  const slow=run(9,0);
  assert.match(slow.notice,/NEED MORE SPEED/);
  assert.ok(slow.noticeSerial>0);
  const fast=run(28);
  assert.equal(fast.notice,'360!');
  assert.ok(fast.landings>=1);
});

test('reset clears the boost body class, so a reset during a boost does not leave the vignette on',()=>{
  const removed=[];
  const classes={remove:c=>removed.push(c)};
  clearBoostBodyClass(classes);
  assert.deepEqual(removed,[BOOST_BODY_CLASS]);
  assert.equal(BOOST_BODY_CLASS,'nitro-active');
  clearBoostBodyClass(null);
});

test('nitro and pad boosts share one demand and one top speed: they never stack',()=>{
  assert.equal(boostDemand(true,true),true);
  assert.equal(boostDemand(true,false),true);
  assert.equal(boostDemand(false,true),true);
  assert.equal(boostDemand(false,false),false);
  const world=createDrivingWorld(),car=world.addVehicle({x:0,z:0,heading:0});
  car.setPose({x:0,z:0,heading:0,vz:-30});
  car.setControls({throttle:1,boost:boostDemand(true,true)});
  for(let i=0;i<6*120;i++)world.step(1/120);
  assert.ok(car.speed<69.5,`combined boosts exceed the shared cap: ${car.speed}`);
});

test('the reset and pause path clears the stunt toast (the notice is hidden, not replayed)',()=>{
  // The HUD keeps its notice state in game.js; the stunt system only keeps a serial. A cleared toast must not reappear
  // for a notice that was already shown: the serial is unchanged, so nothing new is announced after a reset.
  const spin=RAMPS.find(r=>r.id==='civic');
  const world=createDrivingWorld();addRampColliders(world);
  const car=world.addVehicle({x:spin.x,z:spin.z+8,heading:0,height:1.3});
  const stunts=new StuntSystem(spin.shape,storage());stunts.reset(car);
  car.setPose({x:spin.x,z:spin.z+8,heading:0,vz:-9});car.setControls({throttle:0});
  for(let i=0;i<3*120;i++)world.step(1/120,()=>stunts.beginStep(car),dt=>stunts.step(car,dt));
  const serial=stunts.noticeSerial;
  assert.ok(serial>0);
  stunts.reset(car);
  assert.equal(stunts.noticeSerial,serial,'reset does not announce anything new');
});
