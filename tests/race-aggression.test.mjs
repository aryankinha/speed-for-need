import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../dist/vendor/three.module.js';
import {RaceMode} from '../dist/race-mode.js';
import {CircuitPath,buildCircuit} from '../dist/race-track.js';
import {createDrivingWorld} from '../dist/physics.js';
import {buildDriftRaceMarkers} from '../dist/world-drift.js';
import {DRIFT_PATH,addDriftColliders} from '../dist/drift-layout.js';
import {GATE_COLORS,raceGateState,updateRaceGates} from '../dist/race-gates.js';
function fixture(drift=false){
 const physics=createDrivingWorld(),path=drift?DRIFT_PATH:new CircuitPath({x:0,z:0,waypoints:[{x:0,z:0},{x:0,z:-1200},{x:1200,z:-1200},{x:1200,z:0}]}),player=physics.addVehicle(),race=new RaceMode({physics,path});if(drift)addDriftColliders(physics);race.start('concept',player);race.phase='racing';
 const e=race.opponents[0],p={},progress=drift?184:500;path.sampleAtDistance(progress,p);const rx=Math.cos(p.heading),rz=-Math.sin(p.heading);
 for(const entry of race.entries){entry.progress=entry.rankProgress=progress;entry.nextGate=2;entry.actor.setPose({x:3000+entry.index*10,z:3000});}
 function place(actor,lane,ahead,speed){actor.setPose({x:p.x+lane*rx+ahead*p.dx,z:p.z+lane*rz+ahead*p.dz,heading:p.heading,vx:p.dx*speed,vz:p.dz*speed});}
 place(e.actor,0,0,28);place(player,1.3,-12,31);e.lane=0;
 return {physics,path,player,race,e,p,place};
}
test('AI blocks the closing player within track limits and releases after a brief maneuver',()=>{
 const {race,e}=fixture();race.driveAI(e,1/120);assert.equal(e.tacticalMode,'block');assert.ok(e.pressureLane>1);assert.ok(Number.isFinite(e.controls.steer));
 for(let i=0;i<120;i++)race.driveAI(e,1/120);
 assert.equal(e.pressureMode,0);assert.ok(e.pressureCooldown>2);race.stop();
});
for(const drift of [false,true])test((drift?'Drift: ':'Raceway: ')+'side-by-side contest produces real Planck contact without teleporting or changing car tuning',()=>{
 const {physics,race,e,player,place}=fixture(drift);place(e.actor,-2.2,0,28);place(player,0,0,28);e.lane=-2.2;
 const original=e.actor.setPose;e.actor.setPose=()=>{throw Error('AI teleport');};const maxSpeed=e.actor.config.maxSpeed;
 let touched=false,contested=false,released=false;
 physics.rawWorld.on('begin-contact',contact=>{const a=contact.getFixtureA().getBody(),b=contact.getFixtureB().getBody();if((a===player.body&&b===e.actor.body)||(a===e.actor.body&&b===player.body))touched=true;});
 const input={throttle:.5,reverse:0,steer:0,boost:false,handbrake:false};
 function before(dt){race.beforeStep(dt,input);contested||=e.pressureMode===2;released||=e.pressureCooldown>0;}
 function after(dt){race.afterStep(dt);}
 for(let i=0;i<240;i++)physics.step(1/120,before,after);
 assert.ok(contested,'AI must deliberately contest the adjacent player');assert.ok(touched,'body contact must reach the real solver');assert.ok(released,'pressure must not last forever');assert.equal(e.actor.config.maxSpeed,maxSpeed);assert.equal(e.actor.target,null);e.actor.setPose=original;race.stop();
});
test('pressure is disabled for stopped, wrong-way, narrow, and cornering situations',()=>{
 for(const mode of ['stopped','wrong-way','narrow','corner']){
  const {race,e,player,path,place}=fixture();
  if(mode==='stopped')place(player,0,8,0);
  if(mode==='wrong-way')player.setPose({x:player.x,z:player.z,heading:player.heading+Math.PI,vx:player.vx,vz:player.vz});
  if(mode==='narrow')path.laneLimit=()=>.5;
  if(mode==='corner'){e.progress=0;path.curvature.fill(.08);}
  race.driveAI(e,1/120);assert.equal(e.pressureMode,0,mode);assert.ok(Number.isFinite(e.controls.steer));race.stop();
 }
});
test('both circuit builders create broader visible gates with consistent red/yellow/green state through laps',()=>{
 for(const drift of [false,true]){
  const scene=new T.Scene(),physics=createDrivingWorld(),path=drift?DRIFT_PATH:new CircuitPath(),track=drift?buildDriftRaceMarkers(scene,physics,path):buildCircuit(scene,physics,path);
  assert.equal(track.gates.length,12);const g=track.gates[1];assert.ok(g.userData.width>=(drift?16:20));assert.equal(g.children[0].count,4);
  updateRaceGates(track.gates,1,3);assert.equal(g.userData.state,'target');assert.equal(g.children[0].material.color.getHex(),GATE_COLORS.target);assert.equal(track.gates[2].userData.state,'next');
  updateRaceGates(track.gates,2,3);assert.equal(g.userData.state,'cleared');assert.equal(g.children[0].material.color.getHex(),GATE_COLORS.cleared);
  updateRaceGates(track.gates,12,3);assert.equal(track.gates[0].userData.state,'target');assert.equal(track.gates[1].userData.state,'next');
  updateRaceGates(track.gates,13,3);assert.equal(track.gates[0].userData.state,'cleared');assert.equal(track.gates[1].userData.state,'target');assert.equal(track.gates[2].userData.state,'next');assert.equal(track.gates[3].userData.state,'next');
  updateRaceGates(track.gates,37,3);assert.ok(track.gates.every(g=>g.userData.state==='cleared'));track.dispose();assert.equal(scene.children.length,0);
 }
 assert.equal(raceGateState(11,12),'cleared');
});
