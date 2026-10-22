import test from 'node:test';
import assert from 'node:assert/strict';
import {createDrivingWorld} from '../dist/physics.js';
import {StuntSystem,RAMPS,rampProgress,rampLateral} from '../dist/stunts.js';
import {RAMP_SHAPE} from '../dist/ramp-model.js';

const near=(a,b,tolerance=1e-6)=>assert.ok(Math.abs(a-b)<tolerance,`${a} != ${b}`);
const storage=()=>{const values=new Map();return {getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)};};
function setup(ramp=RAMPS[0]){
  const world=createDrivingWorld();
  for(const r of RAMPS){const obstacle=world.addBox({x:r.x+r.fx*RAMP_SHAPE.length/2,z:r.z+r.fz*RAMP_SHAPE.length/2,width:RAMP_SHAPE.width,length:RAMP_SHAPE.length,heading:r.heading,userData:{rampId:r.id}});obstacle.maxY=RAMP_SHAPE.height;}
  const car=world.addVehicle({x:ramp.x-ramp.fx*8,z:ramp.z-ramp.fz*8,heading:ramp.heading,height:1.3});
  const saved=storage(),stunts=new StuntSystem(RAMP_SHAPE,saved);stunts.reset(car);
  const advance=(seconds,hz=60,inspect=()=>{})=>{for(let i=0;i<seconds*hz;i++)world.step(1/hz,()=>stunts.beginStep(car),dt=>{stunts.step(car,dt);inspect();});};
  return {world,car,stunts,saved,advance};
}
function finite(car){const values={...car.state};for(const key of ['elevation','pitch','verticalSpeed'])if(key in car)values[key]=car[key];for(const [key,value] of Object.entries(values))assert.ok(Number.isFinite(value),`${key}: ${value}`);}

test('every placed ramp accepts a forward toe entry and completes a recorded jump',()=>{
  for(const r of RAMPS){
    const {car,stunts,saved,advance}=setup(r);car.setPose({x:car.x,z:car.z,heading:r.heading,vx:r.fx*28,vz:r.fz*28});car.setControls({throttle:1});
    let maximum=0,airborne=false,impact=0;advance(5,60,()=>{maximum=Math.max(maximum,car.elevation);airborne ||= car.isAirborne;impact=Math.max(impact,stunts.landingImpact);finite(car);});
    assert.ok(airborne,r.id);assert.ok(maximum>RAMP_SHAPE.height,r.id);assert.equal(car.isAirborne,false);near(car.elevation,0);assert.equal(stunts.landings,1);assert.ok(stunts.lastDistance>10);assert.ok(impact>0);near(Number(saved.getItem('speed-for-need-jump-best')),stunts.best);
  }
});

test('ramp entry rejects sideways, reverse and high-lip approaches',()=>{
  const r=RAMPS[0];
  for(const pose of [
    {x:r.x,z:r.z,heading:Math.PI/2,vx:-20,vz:0},
    {x:r.x,z:r.z,heading:0,vx:0,vz:10},
    {x:r.x+r.fx*(RAMP_SHAPE.length+2),z:r.z+r.fz*(RAMP_SHAPE.length+2),heading:Math.PI,vx:0,vz:20},
    {x:r.x+RAMP_SHAPE.width/2,z:r.z,heading:0,vx:0,vz:-20},
  ]){const {car,stunts}=setup(r);car.setPose(pose);stunts.beginStep(car);assert.equal(car.rampId,null,JSON.stringify(pose));assert.equal(car.isAirborne,false);}
});

test('ramp coordinates measure the authored toe and direction for both orientations',()=>{
  for(const r of RAMPS){near(rampProgress(r,r.x,r.z),0);near(rampProgress(r,r.x+r.fx*10,r.z+r.fz*10),10);near(rampLateral(r,r.x+r.fx*10,r.z+r.fz*10),0);}
});

test('30, 60 and 144 Hz render rates produce the same finite jump and landing',()=>{
  const results=[30,60,144].map(hz=>{const {car,stunts,advance}=setup();car.setPose({x:car.x,z:car.z,vz:-28});car.setControls({throttle:1});advance(5,hz,()=>finite(car));return {...car.state,elevation:car.elevation,pitch:car.pitch,best:stunts.best,landings:stunts.landings};});
  for(const result of results.slice(1))for(const key of Object.keys(results[0]))near(result[key],results[0][key]);
});

test('reset cancels a jump without awarding a landing and retains the personal best',()=>{
  const {car,stunts,advance}=setup();stunts.best=24;car.setPose({x:car.x,z:car.z,vz:-28});advance(.9);assert.equal(car.isAirborne,true);
  car.setPose({x:20,z:20});stunts.reset(car);advance(1);near(car.elevation,0);near(car.prevElevation,0);near(car.pitch,0);near(car.verticalSpeed,0);assert.equal(car.rampId,null);assert.equal(car.qualifiedJump,false);assert.equal(stunts.landings,0);assert.equal(stunts.best,24);
});

test('storage denial and malformed saved records do not break jump simulation',()=>{
  for(const saved of [{getItem:()=>{throw Error('denied');},setItem:()=>{throw Error('denied');}},{getItem:()=> 'Infinity'},{getItem:()=> '-12'}]){const stunts=new StuntSystem(RAMP_SHAPE,saved);assert.equal(stunts.best,0);const world=createDrivingWorld(),car=world.addVehicle();stunts.reset(car);stunts.fall(car,-1);car.elevation=.001;car.qualifiedJump=true;car.launchZ=20;stunts.step(car,1/120);assert.equal(stunts.landings,1);assert.ok(stunts.best>0);finite(car);}
});

function barrierRun(elevation,height){
  const world=createDrivingWorld(),barrier=world.addBox({x:0,z:-10,width:30,length:.15});barrier.maxY=height;
  const car=world.addVehicle({height:1.3});car.setPose({x:0,z:0,vz:-40});car.elevation=elevation;car.isAirborne=elevation>0;
  for(let i=0;i<120;i++)world.step(1/120);finite(car);return car;
}
test('a low barrier is cleared only when the whole vehicle is above it',()=>{
  assert.ok(barrierRun(3,1).z<-25);assert.ok(barrierRun(0,1).z>-8);assert.ok(barrierRun(.5,1).z>-8);
});
test('an airborne vehicle still hits a tall wall',()=>{assert.ok(barrierRun(3,10).z>-8);});

test('an airborne player does not disable unrelated traffic collisions',()=>{
  const world=createDrivingWorld(),player=world.addVehicle({x:100,z:100});player.elevation=5;player.isAirborne=true;
  const parked=world.addVehicle({x:0,z:0}),moving=world.addVehicle({x:0,z:14});moving.setTarget({vx:0,vz:-12,heading:0,maxAcceleration:5});
  for(let i=0;i<480;i++)world.step(1/120);
  assert.ok(parked.z<-1);assert.ok(moving.z-parked.z>4.3);finite(parked);finite(moving);
});
test('airborne and ground vehicles collide when their height ranges overlap',()=>{
  const world=createDrivingWorld(),ground=world.addVehicle({height:2}),air=world.addVehicle({z:12,height:1.3});air.elevation=1;air.isAirborne=true;air.setPose({z:12,vz:-20});
  for(let i=0;i<120;i++)world.step(1/120);
  assert.ok(ground.z<-1);assert.ok(air.z-ground.z>4.3);finite(ground);finite(air);
});

test('rejected side and high-lip entries remain solid ramp collisions',()=>{
  const r=RAMPS[0];
  for(const approach of [
    {pose:{x:r.x-10,z:r.z-5,heading:-Math.PI/2,vx:30,vz:0},stopped:car=>car.x<r.x-RAMP_SHAPE.width/2-2},
    {pose:{x:r.x,z:r.z-18,heading:Math.PI,vx:0,vz:30},stopped:car=>car.z<r.z-RAMP_SHAPE.length-2},
  ]){const {car,stunts,advance}=setup(r);car.setPose(approach.pose);advance(1,60,()=>{assert.equal(car.rampId,null);near(car.elevation,0);finite(car);});assert.ok(approach.stopped(car),JSON.stringify(car.state));assert.equal(stunts.landings,0);}
});
