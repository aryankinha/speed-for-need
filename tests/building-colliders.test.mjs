import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../dist/vendor/three.module.js';
import {addBuildingColliders} from '../dist/building-colliders.js';
import {createDrivingWorld} from '../dist/physics.js';
import {PhysicsCells} from '../dist/physics-cells.js';
import {loadVehicleGeometry} from './helpers/vehicle-glb.mjs';
const material=new THREE.MeshStandardMaterial();
function box(root,w,h,l,x,y,z){const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,l),material);m.position.set(x,y,z);root.add(m);return m;}
function setup(root){const physics=createDrivingWorld(),obstacles=[];const bounds=addBuildingColliders(root,physics,obstacles);return {physics,obstacles,bounds};}
function drive(physics,x,z,speed,seconds=1,elevation=0){const car=physics.addVehicle({x,z});car.elevation=elevation;car.setPose({x,z,vz:speed});for(let i=0;i<seconds*120;i++)physics.step(1/120,()=>car.setTarget({vx:0,vz:speed,heading:speed<0?0:Math.PI,maxAcceleration:25}));return car;}

test('open arcade remains driveable beneath a roof; real supports and elevated roof still collide',()=>{
 const root=new THREE.Group();box(root,1,4,1,-4,2,0);box(root,1,4,1,4,2,0);box(root,10,.5,8,0,4.25,0);
 const {physics,obstacles,bounds}=setup(root);assert.equal(bounds.max.x,5);
 const car=drive(physics,0,12,-25);assert.ok(car.z<-8,`empty arcade blocked at ${car.z}`);
 const support=drive(physics,-4,12,-25);assert.ok(support.z>2,'visible support must stop car');
 const flying=drive(physics,0,12,-25,1,4);assert.ok(flying.z>5,'roof retains its actual elevated collision');
 assert.ok(obstacles.every(o=>o.box.min.y>=.18));assert.equal(physics.objects.filter(a=>a.userData?.kind==='building').length,1);
});

test('disconnected sections, concave recess and low decorative slab never become a full lot box',()=>{
 const root=new THREE.Group();box(root,3,8,16,-6,4,0);box(root,9,8,3,0,4,-6);box(root,24,.12,24,0,.06,0);
 // A single exported mesh can contain the entire L-shaped shell and slab.
 root.updateMatrixWorld(true);const values=[];root.traverse(m=>{if(!m.isMesh)return;const g=m.geometry.toNonIndexed().applyMatrix4(m.matrixWorld);values.push(...g.attributes.position.array);});
 root.clear();const combined=new THREE.BufferGeometry();combined.setAttribute('position',new THREE.Float32BufferAttribute(values,3));root.add(new THREE.Mesh(combined,material));
 const {physics}=setup(root),car=drive(physics,4,14,-20,.8);assert.ok(car.z<-1,'open recess is driveable');
 const blocker=drive(physics,-6,14,-20,.8);assert.ok(blocker.z>9,'solid wall remains blocked');
});

test('invisible meshes and materials do not create blockers',()=>{
 const root=new THREE.Group();box(root,2,5,2,-8,2.5,0);const hidden=box(root,12,5,12,0,2.5,0);hidden.visible=false;
 const ghost=box(root,12,5,12,0,2.5,0);ghost.material=new THREE.MeshStandardMaterial({transparent:true,opacity:0});
 const {physics}=setup(root),car=drive(physics,0,12,-25);assert.ok(car.z<-8);
});

test('nested transforms, rotated placement and non-unit scale align collider with visible walls',()=>{
 const root=new THREE.Group(),nested=new THREE.Group();root.add(nested);nested.position.set(3,0,-2);box(nested,2,6,8,0,3,0);
 root.position.set(35,0,40);root.rotation.y=Math.PI/2;root.scale.setScalar(1.5);
 const {physics}=setup(root),probe=physics.addVehicle({x:32,z:35.5});assert.ok(physics.objects.some(a=>a!==probe&&physics.overlapsAtHeight(probe,a)));
 probe.setPose({x:42,z:40});assert.ok(physics.objects.every(a=>a===probe||!physics.overlapsAtHeight(probe,a)));
});

test('thin visible walls stop fast cars in both directions without filling adjacent space',()=>{
 for(const direction of [-1,1]){const root=new THREE.Group();box(root,10,6,.12,0,3,0);const {physics}=setup(root),car=drive(physics,0,-direction*15,direction*65,.6);assert.ok(direction*car.z<-1.8,`wall tunnel at ${car.z}`);}
});

test('compound activation indexes every fixture; height-aware overlap checks do not reject open clearance',()=>{
 const physics=createDrivingWorld(),actor=physics.addCompound({parts:[{x:0,z:0,width:2,length:2,minY:4,maxY:5},{x:1000,z:0,width:2,length:2,minY:0,maxY:5}],userData:{kind:'building'}}),car=physics.addVehicle({x:1000});
 const cells=new PhysicsCells(physics.objects);cells.update([car]);assert.ok(actor.body.isActive(),'far fixture must keep building enabled');
 assert.ok(physics.overlapsAtHeight(car,actor));car.setPose({x:0});assert.ok(physics.overlaps(car,actor));assert.equal(physics.overlapsAtHeight(car,actor),false);
 car.elevation=4;assert.ok(physics.overlapsAtHeight(car,actor));
});

test('downloaded architecture compiles to cached surface fixtures, not one envelope',async t=>{
 for(const name of ['building-a','building-skyscraper-a','la-real/la-building-small','la-real/la-building-medium']){
  const root=await loadVehicleGeometry(name),size=new THREE.Box3().setFromObject(root).getSize(new THREE.Vector3());
  if(size.y>150)root.scale.setScalar(30/size.y);
  const start=performance.now(),{physics,obstacles,bounds}=setup(root),ms=performance.now()-start;
  assert.ok(obstacles.length>1,`${name} needs separate surface parts`);assert.ok(obstacles.every(o=>o.box.min.y>=.17*root.scale.y));
  const second=setup(root.clone(true));assert.equal(second.obstacles.length,obstacles.length);
  assert.equal(physics.objects.length,1);assert.ok(bounds.max.y>bounds.min.y);
  t.diagnostic(`${name}: ${obstacles.length} fixtures, first compile ${Math.round(ms)} ms`);
 }
});

test('car slides along a compound wall and can reverse away after an impact',()=>{
 const root=new THREE.Group();box(root,2,6,60,0,3,0);box(root,2,6,60,0,9,0);const {physics}=setup(root);
 const car=physics.addVehicle({x:2.1,z:22});car.setPose({x:2.1,z:22,vz:-20});
 for(let i=0;i<240;i++)physics.step(1/120,()=>car.setTarget({vx:-1,vz:-20,heading:0,maxAcceleration:20}));
 assert.ok(car.z<-10,`car snagged on wall seam at ${car.z}`);assert.ok(car.x>1.7);
 car.setPose({x:8,z:0,heading:Math.PI/2,vx:-20});
 for(let i=0;i<100;i++)physics.step(1/120,()=>car.setControls({throttle:1}));const stoppedX=car.x;
 for(let i=0;i<180;i++)physics.step(1/120,()=>car.setControls({throttle:0,reverse:1}));
 assert.ok(car.x>stoppedX+3,'car must be able to reverse out of a wall contact');
});

test('City Street Study uses authored building surfaces instead of three filled city blocks',async()=>{
 const {registerHooks}=await import('node:module');
 const hooks=registerHooks({resolve(specifier,context,next){if(specifier==='three')return {url:new URL('../dist/vendor/three.module.js',import.meta.url).href,shortCircuit:true};if(specifier==='three/addons/utils/BufferGeometryUtils.js')return {url:new URL('../dist/vendor/utils/BufferGeometryUtils.js',import.meta.url).href,shortCircuit:true};return next(specifier,context);}});
 let buildStreetWorld;try{({buildStreetWorld}=await import('../dist/world-street.js'));}finally{hooks.deregister();}
 const {STREET_MODELS,STREET_DESTINATIONS}=await import('../dist/street-layout.js');
 const models=Object.fromEntries(await Promise.all(STREET_MODELS.map(async n=>[n,await loadVehicleGeometry(n)])));
 const original=THREE.TextureLoader.prototype.loadAsync;THREE.TextureLoader.prototype.loadAsync=async()=>new THREE.Texture();
 try{
  const physics=createDrivingWorld(),world=await buildStreetWorld({scene:new THREE.Scene(),physics,models});
  const buildings=physics.objects.filter(a=>a.userData?.kind==='building');assert.ok(buildings.length>3);assert.ok(buildings.every(a=>a.fixtures?.length>0));
  for(const dest of STREET_DESTINATIONS){const probe=physics.addVehicle(dest);assert.ok(buildings.every(a=>!physics.overlapsAtHeight(probe,a)),'street arrival must stay clear');physics.remove(probe);}
  const probe=physics.addVehicle({width:.1,length:.1});let gaps=0;
  for(const [x,w]of [[-33,36],[35,40],[103,36]])for(let xx=x-w/2+2;xx<x+w/2;xx+=3)for(let z=-95;z<99;z+=8){probe.setPose({x:xx,z});if(buildings.every(a=>!physics.overlapsAtHeight(probe,a)))gaps++;}
  assert.ok(gaps>50,'authored gaps must no longer collide with the former block envelopes');
 }finally{THREE.TextureLoader.prototype.loadAsync=original;}
});
