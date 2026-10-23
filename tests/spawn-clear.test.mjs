import test from 'node:test';
import assert from 'node:assert/strict';
import {createDrivingWorld} from '../dist/physics.js';
import {spawnBlocked} from '../dist/spawn-clear.js';

const box=(x,z,w,l)=>({min:{x:x-w/2,z:z-l/2},max:{x:x+w/2,z:z+l/2}});
function scene(){
 const w=createDrivingWorld(),obstacles=[];
 // A compound "building" with many fixtures, a plain wall, and a loose prop that can be shoved around.
 const parts=Array.from({length:60},(_,i)=>({x:(i%10)*2-9,z:Math.floor(i/10)*2-5,width:2,length:2,minY:0,maxY:20}));
 const building=w.addCompound({x:100,z:100,parts,userData:{kind:'building'}});
 for(const p of parts)obstacles.push({actor:building,box:box(100+p.x,100+p.z,p.width,p.length)});
 const wall=w.addBox({x:-40,z:0,width:2,length:30});wall.minY=0;wall.maxY=4;obstacles.push({actor:wall,box:box(-40,0,2,30)});
 const prop=w.addProp({x:0,z:50,width:1,length:1});obstacles.push({actor:prop,box:box(0,50,1,1)});
 return {w,obstacles,prop};
}
const exact=(w,obstacles,car)=>obstacles.some(o=>w.overlapsAtHeight(car,o.actor));

test('spawnBlocked agrees with testing every obstacle exactly',()=>{
 const {w,obstacles}=scene();
 for(const [x,z] of [[100,100],[103,98],[90,95],[200,200],[-40,0],[-38.5,12],[-30,0],[0,0],[100,120]]){
  const car=w.addVehicle({x,z,width:2,length:4.5,height:1.5});
  assert.equal(spawnBlocked(w,obstacles,car),exact(w,obstacles,car),`pose ${x},${z}`);w.remove(car);
 }
});

test('movable obstacles are always tested at their current pose, not their original box',()=>{
 const {w,obstacles,prop}=scene();
 const car=w.addVehicle({x:60,z:60,width:2,length:4.5,height:1.5});
 assert.equal(spawnBlocked(w,obstacles,car),false);
 prop.body.setTransform({x:60,y:60},0);
 assert.equal(spawnBlocked(w,obstacles,car),true);
 assert.equal(exact(w,obstacles,car),true);
});

test('a broad world with ~87k fixtures is checked without testing far away buildings',()=>{
 const w=createDrivingWorld(),obstacles=[];
 for(let b=0;b<160;b++){
  const parts=Array.from({length:540},(_,i)=>({x:(i%27)*.5-6,z:Math.floor(i/27)*.5-5,width:.5,length:.5,minY:0,maxY:10}));
  const actor=w.addCompound({x:(b%16)*60,z:Math.floor(b/16)*60,parts,userData:{kind:'building'}});
  for(const p of parts)obstacles.push({actor,box:box((b%16)*60+p.x,Math.floor(b/16)*60+p.z,p.width,p.length)});
 }
 const car=w.addVehicle({x:30,z:30,width:2,length:4.5,height:1.5});
 let calls=0;const counted={overlapsAtHeight:(a,b)=>{calls++;return w.overlapsAtHeight(a,b);}};
 assert.equal(spawnBlocked(counted,obstacles,car),false);
 assert.ok(calls<=4,`expected only neighbouring buildings to be tested, saw ${calls}`);
});
