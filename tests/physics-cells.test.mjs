import test from 'node:test';
import assert from 'node:assert/strict';
import {createDrivingWorld} from '../dist/physics.js';
import {PhysicsCells} from '../dist/physics-cells.js';

test('real Planck static bodies activate within the vehicle neighbour cells',()=>{
  const world=createDrivingWorld(),near=world.addBox({x:20,width:3,length:3}),far=world.addCircle({x:1000,radius:2}),car=world.addVehicle();
  const cells=new PhysicsCells(world.objects);assert.equal(cells.totalCount,2);
  assert.deepEqual(cells.update(world.vehicles),{activeCount:1,totalCount:2});
  assert.equal(near.body.isActive(),true);assert.equal(far.body.isActive(),false);assert.equal(car.body.isActive(),true);
  car.setPose({x:1000});cells.update(world.vehicles);
  assert.equal(near.body.isActive(),false);assert.equal(far.body.isActive(),true);
});

test('a distant traffic car retains its own nearby colliders',()=>{
  const world=createDrivingWorld(),player=world.addVehicle(),traffic=world.addVehicle({x:1000});
  const a=world.addBox({width:2,length:2}),b=world.addBox({x:1020,width:2,length:2}),unused=world.addBox({x:2000,width:2,length:2});
  const cells=new PhysicsCells(world.objects);cells.update([player,traffic]);
  assert.equal(a.body.isActive(),true);assert.equal(b.body.isActive(),true);assert.equal(unused.body.isActive(),false);
  traffic.body.setActive(false);cells.update([player,traffic]);assert.equal(b.body.isActive(),false);
});

test('map boundaries and explicit always-active colliders remain enabled without vehicles',()=>{
  const world=createDrivingWorld(),boundary=world.addBox({x:2000,width:2,length:2400,userData:{kind:'boundary'}}),pinned=world.addBox({x:-2000,width:2,length:2,userData:{alwaysActive:true}}),ordinary=world.addBox({width:2,length:2});
  const cells=new PhysicsCells(world.objects);cells.update([]);
  assert.equal(boundary.body.isActive(),true);assert.equal(pinned.body.isActive(),true);assert.equal(ordinary.body.isActive(),false);assert.equal(cells.activeCount,2);
});

test('activation runs before movement and collision proxies are ready immediately',()=>{
  const world=createDrivingWorld(),car=world.addVehicle(),wall=world.addBox({x:1000,z:-10,width:30,length:.15});
  const cells=new PhysicsCells(world.objects);cells.update(world.vehicles);assert.equal(wall.body.isActive(),false);
  car.setPose({x:1000,z:0,vz:-40});cells.update(world.vehicles);assert.equal(wall.body.isActive(),true);
  for(let i=0;i<120;i++)world.step(1/120);
  assert.ok(car.z>-8,`car passed through wall: ${car.z}`);
});

test('colliders crossing cell boundaries are indexed by their whole footprint',()=>{
  const world=createDrivingWorld(),car=world.addVehicle({x:0}),wide=world.addBox({x:650,width:200,length:5});
  const cells=new PhysicsCells(world.objects);cells.update([car]);
  // Player cell 0 sees cells -1..1. The box extends into cell 1, despite its
  // centre being in cell 2, so its approaching edge must already be active.
  assert.equal(wide.body.isActive(),true);
});

test('unchanged activation state never invokes setActive redundantly',()=>{
  const world=createDrivingWorld(),car=world.addVehicle(),near=world.addBox({width:3,length:3}),far=world.addBox({x:1000,width:3,length:3});
  let nearCalls=0,farCalls=0,dynamicCalls=0;
  for(const [actor,count] of [[near,()=>nearCalls++],[far,()=>farCalls++],[car,()=>dynamicCalls++]]){const original=actor.body.setActive;actor.body.setActive=function(value){count();return original.call(this,value);};}
  const cells=new PhysicsCells([...world.objects,far]);cells.update(world.vehicles);cells.update(world.vehicles);cells.update(world.vehicles);
  assert.equal(nearCalls,0);assert.equal(farCalls,1);assert.equal(dynamicCalls,0);assert.equal(cells.totalCount,2);
  car.setPose({x:1000});cells.update(world.vehicles);cells.update(world.vehicles);
  assert.equal(nearCalls,1);assert.equal(farCalls,2);assert.equal(dynamicCalls,0);
});

test('invalid cell options fail clearly',()=>{
  assert.throws(()=>new PhysicsCells([],{cellSize:0}),RangeError);
  assert.throws(()=>new PhysicsCells([],{radiusCells:-1}),RangeError);
  assert.throws(()=>new PhysicsCells([],{radiusCells:.5}),RangeError);
});
