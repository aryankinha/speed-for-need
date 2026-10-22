import test from 'node:test';
import assert from 'node:assert/strict';
import {ballisticFlightTime,FULL_TURN,resetAerialTrick,startAerialTrick,stepAerialTrick,finishAerialTrick} from '../dist/aerial-tricks.js';
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);
test('airtime solves the same constant-gravity height equation as the jump layer',()=>{
  for(const h of [0,3.4,12])for(const vy of [-2,5,22]){const g=18.5,t=ballisticFlightTime(h,vy,g);near(h+vy*t-.5*g*t*t,0);}
  for(const args of [[-1,5,18.5],[3,NaN,18.5],[3,5,0]])assert.equal(ballisticFlightTime(...args),0);
});
test('each maneuver completes one unwrapped turn at 30,60 and144Hz without touching physical pose',()=>{
  for(const kind of ['spin','roll'])for(const hz of [30,60,144]){
    const a={isAirborne:true,qualifiedJump:true,elevation:3.4,verticalSpeed:10,heading:.7,x:8,z:12};
    assert.ok(startAerialTrick(a,kind,18.5));let previous=0;
    for(let i=0;i<Math.ceil(2*hz);i++){stepAerialTrick(a,1/hz);const angle=kind==='spin'?a.trickYaw:a.trickRoll;assert.ok(angle>=previous);assert.ok(angle<=FULL_TURN);previous=angle;}
    near(previous,FULL_TURN);assert.equal(a.heading,.7);assert.equal(a.x,8);assert.equal(a.z,12);
    const last=finishAerialTrick(a);assert.equal(last,kind);assert.equal(a.completedTricks,1);near(kind==='spin'?a.trickYaw:a.trickRoll,FULL_TURN);
  }
});
test('small falls do not start tricks; pause does not advance them; reset and interrupted landing clear all orientation',()=>{
  const a={isAirborne:true,qualifiedJump:false,elevation:3.4,verticalSpeed:10};assert.equal(startAerialTrick(a,'spin',18.5),false);
  a.qualifiedJump=true;a.elevation=.01;a.verticalSpeed=0;assert.equal(startAerialTrick(a,'roll',18.5),false);
  a.elevation=3.4;a.verticalSpeed=10;startAerialTrick(a,'roll',18.5);stepAerialTrick(a,.2);const snapshot={...a};stepAerialTrick(a,0);assert.deepEqual(a,snapshot);
  assert.equal(finishAerialTrick(a),null);for(const key of ['trickYaw','prevTrickYaw','trickRoll','prevTrickRoll'])near(a[key],0);assert.equal(a.activeTrick,null);
  startAerialTrick(a,'spin',18.5);stepAerialTrick(a,.2);resetAerialTrick(a);assert.equal(a.activeTrick,null);near(a.trickYaw,0);near(a.prevTrickYaw,0);
});
