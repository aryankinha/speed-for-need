import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createDrivingWorld} from '../dist/physics.js';
import {BOOST_PADS,PAD_BOOST_SECONDS,padHit,BoostPadTimer,clearBoostBodyClass,BOOST_BODY_CLASS,boostDemand} from '../dist/boost-pads.js';
import {RAMPS,rampProgress,rampLateral} from '../dist/stunts.js';

const pad=BOOST_PADS[0];
const at=(x,z,extra={})=>({x,z,elevation:0,isAirborne:false,...extra});
// Local (along, lateral) offsets from the pad centre, using the same convention as padHit.
const local=(p,x,z)=>{const dx=x-p.x,dz=z-p.z,c=Math.cos(p.heading),s=Math.sin(p.heading);return {along:-dx*s-dz*c,lateral:dx*c-dz*s};};

test('a grounded car centred on a pad is detected, from either driving direction',()=>{
  for(const p of BOOST_PADS){
    const index=BOOST_PADS.indexOf(p);
    assert.equal(padHit(at(p.x,p.z),BOOST_PADS),index,p.id);
    // Approach from both ends of the strip: the trigger does not depend on heading.
    const fx=-Math.sin(p.heading),fz=-Math.cos(p.heading);
    assert.equal(padHit(at(p.x+fx*(p.length/2-.2),p.z+fz*(p.length/2-.2)),BOOST_PADS),index,`${p.id} front`);
    assert.equal(padHit(at(p.x-fx*(p.length/2-.2),p.z-fz*(p.length/2-.2)),BOOST_PADS),index,`${p.id} back`);
  }
});

test('pads ignore airborne cars, raised cars and cars beside the strip',()=>{
  assert.equal(padHit(at(pad.x,pad.z,{isAirborne:true}),BOOST_PADS),-1);
  assert.equal(padHit(at(pad.x,pad.z,{elevation:1.2}),BOOST_PADS),-1);
  const fx=-Math.sin(pad.heading),fz=-Math.cos(pad.heading);
  assert.equal(padHit(at(pad.x+Math.cos(pad.heading)*(pad.width/2+1.2),pad.z-Math.sin(pad.heading)*(pad.width/2+1.2)),BOOST_PADS),-1);
  assert.equal(padHit(at(pad.x+fx*(pad.length/2+1),pad.z+fz*(pad.length/2+1)),BOOST_PADS),-1);
  assert.equal(padHit(null,BOOST_PADS),-1);
});

test('the boost timer fires once on entry, lasts two seconds and re-triggers after leaving and re-entering',()=>{
  const timer=new BoostPadTimer(BOOST_PADS);
  const inside=at(pad.x,pad.z),outside=at(pad.x+40,pad.z);
  assert.equal(timer.step(outside,1/120),false);
  assert.equal(timer.active,false);
  assert.equal(timer.step(inside,1/120),true,'entry fires');
  assert.equal(timer.timeLeft,PAD_BOOST_SECONDS);
  // Sitting on the pad does not restart the timer every step.
  for(let i=0;i<60;i++)assert.equal(timer.step(inside,1/120),false);
  assert.ok(timer.timeLeft<PAD_BOOST_SECONDS-.4);
  // Two seconds from entry, 0.5 s of which were spent on the pad.
  for(let i=0;i<200;i++)timer.step(outside,1/120);
  assert.equal(timer.active,false,'expires after two seconds');
  assert.equal(timer.triggers,1);
  assert.equal(timer.step(inside,1/120),true,'re-entry re-triggers');
  assert.equal(timer.triggers,2);
  assert.equal(timer.timeLeft,PAD_BOOST_SECONDS);
});

test('a non-finite or negative step never extends or corrupts the timer',()=>{
  const timer=new BoostPadTimer(BOOST_PADS);
  timer.step(at(pad.x,pad.z),1/120);
  timer.step(at(pad.x,pad.z),NaN);timer.step(at(pad.x,pad.z),-5);
  assert.equal(timer.timeLeft,PAD_BOOST_SECONDS);
  timer.reset();assert.equal(timer.active,false);assert.equal(timer.current,-1);
});

test('the pad boost module is pure: no nitro tank import and no DOM use',()=>{
  const source=readFileSync(new URL('../dist/boost-pads.js',import.meta.url),'utf8');
  assert.ok(!/from\s+['"]\.\/nitro/.test(source),'must not import nitro.js');
  assert.ok(!/NITRO_|NitroEffects|nitroHud/.test(source),'must not touch the nitro tank');
  assert.ok(!/\bdocument\b|\bwindow\b/.test(source),'no DOM access');
});

test('a pad boost is a real speed gain: a car on throttle with the boost flag outruns one without',()=>{
  const run=boost=>{
    const world=createDrivingWorld(),car=world.addVehicle({x:0,z:0,heading:0});
    car.setPose({x:0,z:0,heading:0,vz:-15});car.setControls({throttle:1,boost});
    for(let i=0;i<PAD_BOOST_SECONDS*120;i++)world.step(1/120);
    return car.speed;
  };
  const plain=run(false),padded=run(true);
  assert.ok(padded>plain+5,`boosted ${padded.toFixed(1)} vs plain ${plain.toFixed(1)}`);
  assert.ok(padded<69.5,'the boost stays under the boosted speed cap');
});

test('pads are flat strips on the road or the stunt park, and never sit on a ramp deck',()=>{
  for(const p of BOOST_PADS){
    assert.ok(p.width>0&&p.length>0);
    const onRoad=Math.abs(p.x)>440&&Math.abs(p.x)<460;
    const inPark=p.x>-438&&p.x<-312&&p.z>312&&p.z<588;
    assert.ok(onRoad||inPark,p.id);
    for(const r of RAMPS){
      const u=rampProgress(r,p.x,p.z),l=rampLateral(r,p.x,p.z);
      const onDeck=u>=-p.length/2&&u<=r.shape.length+p.length/2&&Math.abs(l)<=r.shape.width/2+p.width/2;
      assert.ok(!onDeck,`${p.id} overlaps ramp ${r.id}`);
    }
  }
});
