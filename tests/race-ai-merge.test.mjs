import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../dist/vendor/three.module.js';
import {RaceMode,ensureRaceline} from '../dist/race-mode.js';
import {CircuitPath} from '../dist/race-track.js';
import {createDrivingWorld} from '../dist/physics.js';
import {VEHICLES} from '../dist/vehicles.js';
import {DRIFT_PATH,DRIFT_TRACK_DATA,addDriftColliders} from '../dist/drift-layout.js';
import {loadVehicleGeometry} from './helpers/vehicle-glb.mjs';
import {prepareVehicleGeometry} from '../dist/vehicle-models.js';

test('racing line stays inside measured Drift clearance throughout the loop and its seam',()=>{
 const rl=ensureRaceline(DRIFT_PATH),bounds={};
 assert.equal(ensureRaceline(DRIFT_PATH),rl,'reuse precomputed racing line');
 for(let i=0;i<DRIFT_PATH.count;i++){
  const s=i*DRIFT_PATH.ds,d=s/rl.step,k=Math.floor(d)%rl.M,j=(k+1)%rl.M,f=d-Math.floor(d),lane=rl.alpha[k]+(rl.alpha[j]-rl.alpha[k])*f;
  DRIFT_PATH.laneBounds(s,bounds);
  assert.ok(lane>=bounds.min-.05&&lane<=bounds.max+.05,'racing line outside safe bounds at '+s);
 }
});

test('AI honours asymmetric wall clearance even when a second lane limit is present',()=>{
 const physics=createDrivingWorld(),path=new CircuitPath(),player=physics.addVehicle(),race=new RaceMode({physics,path});
 path.laneBounds=(_s,out)=>{out.min=-.2;out.max=2;return out;};path.laneLimit=()=>3;
 race.start('concept',player);race.phase='racing';const e=race.opponents[0],p={};e.progress=300;path.sampleAtDistance(300,p);e.actor.setPose(p);
 for(const other of race.entries)if(other!==e)other.actor.setPose({x:10000+other.index*10,z:10000});
 race.driveAI(e,1/120);assert.equal(race.laneRange.min,-.2);assert.equal(race.laneRange.max,2);race.stop();
});

test('all five selected-car grids finish three Drift laps with real measured cars and unchanged tuning',async()=>{
 const rides={};
 for(const def of VEHICLES){const root=await loadVehicleGeometry(def.asset);prepareVehicleGeometry(root,def.id);const size=new T.Box3().setFromObject(root,true).getSize(new T.Vector3());size.multiplyScalar(def.length/size.z);rides[def.id]={size};}
 for(const selected of VEHICLES){
  const physics=createDrivingWorld();addDriftColliders(physics);
  const player=physics.addVehicle({...selected.tuning,width:rides[selected.id].size.x,length:selected.length}),race=new RaceMode({physics,path:DRIFT_PATH,rides,groundY:DRIFT_TRACK_DATA.roadY});
  race.start(selected.id,player);
  const originalSetPose=player.setPose;
  for(const e of race.entries){e.actor.setPose=()=>{throw Error('teleport');};e.actor.setTarget=()=>{throw Error('rail following');};}
  const input={throttle:0,reverse:0,steer:0,boost:false,handbrake:false};
  function before(dt){if(race.phase==='racing'){const e=race.entries[0];race.driveAI(e,dt);input.throttle=e.controls.throttle;input.steer=e.controls.steer;input.reverse=Math.max(e.controls.reverse,e.controls.brake);}race.beforeStep(dt,input);}
  function after(dt){race.afterStep(dt);}
  for(let i=0;i<120*210&&race.phase!=='finished';i++)physics.step(1/120,before,after);
  assert.equal(race.phase,'finished',selected.id+' grid stalled');
  for(const e of race.entries){assert.equal(e.lap,3,selected.id+' grid: '+e.def.id+' missed gates');assert.ok(e.finishTime<165,selected.id+' grid: '+e.def.id+' too slow ('+e.finishTime+')');assert.equal(e.actor.target,null);for(const [key,value]of Object.entries(e.def.tuning))assert.equal(e.actor.config[key],value);}
  player.setPose=originalSetPose;
  race.stop();assert.equal(physics.vehicles.length,1);
 }
});
