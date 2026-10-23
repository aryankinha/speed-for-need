import test from 'node:test';
import assert from 'node:assert/strict';
import {LA_CHANNEL,LA_BRIDGES,getChannelHeight,getDeckHeight,getDeckPose} from '../dist/la-decks.js';
import {createDrivingWorld} from '../dist/physics.js';
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);

test('channel entrances and banks meet street level continuously',()=>{
  const c=LA_CHANNEL;
  for(const [z,height] of [[150,0],[225,-2.5],[300,-5],[1050,-5],[1100,-2.5],[1150,0]])near(getChannelHeight(c.x,z),height);
  for(const direction of [-1,1])for(const [distance,height] of [[0,-5],[50,-5],[65,-2.5],[80,0],[81,0]])near(getChannelHeight(c.x+direction*distance,600),height);
  near(getChannelHeight(-535,225),-1.25);
  for(const z of [0,149,1151,1200])near(getDeckHeight(c.x,z),0);
});

test('both river bridges retain channel and street layers in either direction',()=>{
  for(const b of LA_BRIDGES){
    for(const heading of [0,Math.PI]){
      let groundElevation=-5;
      for(let i=-30;i<=30;i++){
        const z=b.z+i*(heading===0?-1:1);
        groundElevation=getDeckHeight(b.x,z,{heading,groundElevation});near(groundElevation,-5);
      }
    }
    for(const heading of [Math.PI/2,-Math.PI/2]){
      let groundElevation=0;
      for(let i=-90;i<=90;i++){
        const x=b.x+i*(heading>0?-1:1);
        groundElevation=getDeckHeight(x,b.z,{heading,groundElevation});near(groundElevation,0);
      }
    }
    near(getDeckHeight(b.x,b.z,{heading:Math.PI/2,groundElevation:-5}),-5);
    near(getDeckHeight(b.x,b.z,{heading:0,groundElevation:0}),0);
    near(getDeckHeight(b.x,b.z),0);
    near(getDeckHeight(b.x,b.z,{heading:0}),-5);
    near(getDeckHeight(b.x,b.z,{heading:Math.PI/2}),0);
  }
});

test('explicit spawn layer and previous support select the correct bridge surface',()=>{
  const b=LA_BRIDGES[0];
  near(getDeckHeight(b.x,b.z,{groundLayer:'channel',groundElevation:0}),-5);
  near(getDeckHeight(b.x,b.z,{groundLayer:'street',groundElevation:-5}),0);
  near(getDeckHeight(b.x,b.z,{prevGroundElevation:-5}),-5);
});

test('deck pose follows the real slope and is flat above and below bridges',()=>{
  const actor={x:-600,z:225,heading:Math.PI,length:4.5,width:1.9};
  near(getDeckPose(actor).pitch,-Math.atan(5/150));
  actor.heading=0;near(getDeckPose(actor).pitch,Math.atan(5/150));
  for(const b of LA_BRIDGES)for(const groundElevation of [0,-5]){
    const pose=getDeckPose({...actor,z:b.z,groundElevation});near(pose.height,groundElevation);near(pose.pitch,0);near(pose.roll,0);
  }
});

function bridgeSlabRun(bridge,groundElevation,elevation=0){
  const world=createDrivingWorld();
  const slab=world.addBox({x:bridge.x,z:bridge.z,width:160,length:36});slab.minY=-.7;slab.maxY=-.1;
  const car=world.addVehicle({x:bridge.x,z:bridge.z+35,height:1.6});car.groundElevation=groundElevation;car.elevation=elevation;
  car.setPose({x:car.x,z:car.z,vz:-20});
  for(let i=0;i<240;i++)world.step(1/120);
  return car;
}
test('height-filter clears bridge volumes above and below, but catches intersecting bodies',()=>{
  for(const b of LA_BRIDGES){
    assert.ok(bridgeSlabRun(b,-5).z<b.z-3);
    assert.ok(bridgeSlabRun(b,0).z<b.z-3);
    assert.ok(bridgeSlabRun(b,-1).z>b.z+18);
    // Relative stunt elevation must be added to the channel ground height.
    assert.ok(bridgeSlabRun(b,-5,4).z>b.z+18);
  }
});

test('vehicles on separated bridge levels pass and vehicles on the same level collide',()=>{
  for(const b of LA_BRIDGES)for(const sameLayer of [false,true]){
    const world=createDrivingWorld(),street=world.addVehicle({x:b.x,z:b.z,height:1.6}),river=world.addVehicle({x:b.x,z:b.z+12,height:1.6});
    street.groundElevation=0;river.groundElevation=sameLayer?0:-5;river.setPose({x:river.x,z:river.z,vz:-15});
    for(let i=0;i<240;i++)world.step(1/120);
    if(sameLayer){assert.ok(street.z<b.z-1);assert.ok(river.z-street.z>4.3);}else{near(street.z,b.z);assert.ok(river.z<b.z-8);}
  }
});

// A car swap reuses this world-height test before deciding an arrival is unsafe.
test('ride replacement below bridge keeps safe support while a true same-level overlap is rejected',()=>{
 const p=createDrivingWorld(),deck=p.addBox({x:-600,z:450,width:180,length:36});deck.minY=-.7;deck.maxY=-.1;
 const car=p.addVehicle({x:-600,z:450});car.groundElevation=-5;
 assert.equal(p.overlaps(car,deck),true);assert.equal(p.overlapsAtHeight(car,deck),false);
 const wall=p.addBox({x:-600,z:450,width:2,length:2});wall.minY=-5;wall.maxY=0;assert.equal(p.overlapsAtHeight(car,wall),true);
});
