import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,statSync} from 'node:fs';
import {PROP_TYPES,PROP_CONFIG,layoutStreetProps,roadClearance,PropGrid,carOverlapsProp,makeBody,knockBody,stepBody,maybeRespawn,seeded} from '../dist/street-props.js';
import {createDrivingWorld} from '../dist/physics.js';

for(const map of ['coast'])test(`${map}: props sit on sidewalks, clear of asphalt and of each other`,()=>{
  const items=layoutStreetProps(map);
  assert.ok(items.length>500,`only ${items.length} props`);
  for(const it of items){
    const r=PROP_TYPES[it.type].r;
    assert.ok(roadClearance(map,it.x,it.z)>=r,`${it.type} at ${it.x.toFixed(1)},${it.z.toFixed(1)} is on the road`);
    assert.ok(Number.isFinite(it.rot));
  }
  const grid=new PropGrid(items,8);
  items.forEach((a,i)=>grid.forNear(a.x,a.z,8,j=>{if(j<=i)return;const b=items[j];assert.ok(Math.hypot(a.x-b.x,a.z-b.z)>=PROP_TYPES[a.type].r+PROP_TYPES[b.type].r,`${a.type} overlaps ${b.type}`);}));
  for(const type of ['hydrant','trashcan','cone','fence'])assert.ok(items.some(i=>i.type===type),`${map} has ${type}`);
  assert.ok(items.some(i=>i.type==='pole'),'suburban edges get power poles');
});

test('layout is deterministic and honours the world blocker',()=>{
  assert.deepEqual(layoutStreetProps('coast'),layoutStreetProps('coast'));
  const blocked=(x,z)=>x>0;// pretend the whole east half is full of buildings
  assert.ok(layoutStreetProps('coast',{blocked}).every(i=>i.x<=0));
});

test('every prop asset ships in dist/assets and the new ones stay small',()=>{
  let bytes=0;
  for(const t of Object.values(PROP_TYPES)){const file=new URL(`../dist/assets/${t.asset}.glb`,import.meta.url);assert.ok(existsSync(file),t.asset);if(t.asset.startsWith('props/'))bytes+=statSync(file).size;}
  assert.ok(bytes<1.5e6,`props weigh ${bytes} bytes`);
});

test('the car rectangle overlaps only nearby props',()=>{
  const car={x:0,z:0,heading:0,width:2,length:4.5};
  assert.ok(carOverlapsProp(car,0,-2.4,.3));// just ahead of the bumper
  assert.ok(!carOverlapsProp(car,0,-2.8,.3));
  assert.ok(carOverlapsProp(car,1.2,0,.3));
  assert.ok(!carOverlapsProp(car,1.5,0,.3));
  // Rotated 90°: the long axis now runs along x.
  assert.ok(carOverlapsProp({...car,heading:Math.PI/2},-2.4,0,.3));
});

test('a knocked prop flies, bounces, settles within the loose window and respawns once away',()=>{
  const b=makeBody({type:'trashcan',x:10,z:0,rot:0});b.half=.47;b.y=.47;
  const speed=knockBody(b,{x:8,z:0,vx:18,vz:0},seeded(3));
  assert.equal(speed,18);assert.equal(b.state,'loose');assert.ok(b.vx>15&&b.vy>2,'launched forward and up');
  let t=0,peak=0,dt=1/60;while(stepBody(b,dt)){t+=dt;peak=Math.max(peak,b.y);assert.ok(b.y>0,'never sinks through the ground');assert.ok(t<10);}
  assert.equal(b.state,'settled');assert.ok(t>=PROP_CONFIG.minLoose-dt&&t<=PROP_CONFIG.maxLoose+dt,`settled after ${t.toFixed(2)} s`);
  assert.ok(peak>1,'it got airborne');assert.ok(b.x>14,'it travelled with the car');
  // Waits the full delay, and never pops back in view of a nearby player.
  assert.equal(maybeRespawn(b,PROP_CONFIG.respawnDelay-1,200),false);
  assert.equal(maybeRespawn(b,2,10,true),false);
  assert.equal(maybeRespawn(b,.1,200,true),true);
  assert.equal(b.state,'rest');assert.deepEqual([b.x,b.z],[10,0]);
});

test('light props fly further than heavy ones from the same hit',()=>{
  const fly=type=>{const b=makeBody({type,x:0,z:0,rot:0});knockBody(b,{x:-2,z:0,vx:20,vz:0},()=>.5);while(stepBody(b,1/60));return b.x;};
  assert.ok(fly('cone')>fly('hydrant'));
});

test('power poles are solid colliders a car cannot drive through',()=>{
  const physics=createDrivingWorld({fixedStep:1/120});
  physics.addBox({x:0,z:-8,width:.5,length:.5,userData:{kind:'power-pole'}});
  const car=physics.addVehicle({x:0,z:0,heading:0,width:1.9,length:4.5});
  car.setPose({x:0,z:0,heading:0,vx:0,vz:-20});
  for(let i=0;i<120;i++)physics.step(1/120,()=>car.setControls({throttle:1}));
  assert.ok(car.z>-8,`car passed the pole (z=${car.z.toFixed(2)})`);
});
