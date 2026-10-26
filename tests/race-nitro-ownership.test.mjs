import test from 'node:test';
import assert from 'node:assert/strict';
import {RaceMode} from '../dist/race-mode.js';
import {createDrivingWorld} from '../dist/physics.js';
function setup(){
 const physics=createDrivingWorld(),player=physics.addVehicle(),race=new RaceMode({physics});race.start('concept',player);race.phase='racing';
 for(const e of race.entries)e.actor.setPose({x:10000+e.index*10,z:10000});
 return {race,player};
}
function atBottle(race,entry,index=0){const p=race.pickups[index];entry.actor.setPose({x:p.x,z:p.z});}
test('all five cars can independently collect the same nitro bottle without stealing',()=>{
 const {race}=setup(),bottle=race.pickups[0];
 for(const e of race.opponents){atBottle(race,e);race.afterStep(1/120);assert.equal(e.nitro,60);assert.equal(e.pickupCooldowns[0],12);assert.equal(bottle.active,true,'AI collection must leave player bottle visible');e.actor.setPose({x:10000+e.index*10,z:10000});}
 assert.equal(race.entries[0].nitro,40);atBottle(race,race.entries[0]);race.afterStep(1/120);assert.equal(race.entries[0].nitro,60);assert.equal(bottle.active,false);race.stop();
});
test('player collection does not hide nitro from AI and a waiting car cannot repeatedly refill',()=>{
 const {race}=setup(),player=race.entries[0],ai=race.opponents[0];atBottle(race,player);race.afterStep(1/120);assert.equal(race.pickups[0].active,false);
 atBottle(race,ai);race.afterStep(1/120);assert.equal(ai.nitro,60);assert.equal(player.nitro,60);
 for(let i=0;i<120;i++)race.afterStep(1/120);assert.equal(ai.nitro,60);assert.equal(player.nitro,60);assert.ok(ai.pickupCooldowns[0]>10);race.stop();
});
test('individual cooldowns respawn separately, pause with the race, and reset on restart',()=>{
 const {race,player}=setup(),me=race.entries[0],ai=race.opponents[0];
 atBottle(race,ai);race.afterStep(1/120);ai.actor.setPose({x:10000,z:10000});race.afterStep(5);
 atBottle(race,me);race.afterStep(1/120);me.actor.setPose({x:11000,z:10000});race.afterStep(7.1);
 assert.equal(ai.pickupCooldowns[0],0);assert.ok(me.pickupCooldowns[0]>4);assert.equal(race.pickups[0].active,false);
 race.phase='countdown';const remaining=me.pickupCooldowns[0];race.afterStep(3);assert.equal(me.pickupCooldowns[0],remaining);
 race.phase='racing';race.afterStep(5);assert.equal(race.pickups[0].active,true);assert.equal(race.pickups[0].cooldown,0);
 race.stop();race.start('concept',player);for(const e of race.entries){assert.equal(e.nitro,40);assert.ok(e.pickupCooldowns.every(t=>t===0));}assert.ok(race.pickups.every(p=>p.active));race.stop();
});
test('a full tank leaves that cars refill available for later',()=>{
 const {race}=setup(),e=race.opponents[0];e.nitro=90;atBottle(race,e);race.afterStep(1/120);assert.equal(e.nitro,90);assert.equal(e.pickupCooldowns[0],0);e.nitro=70;race.afterStep(1/120);assert.equal(e.nitro,90);assert.equal(e.pickupCooldowns[0],12);race.stop();
});
