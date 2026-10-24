import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import crypto from 'node:crypto';
import * as T from '../dist/vendor/three.module.js';
import {createDrivingWorld} from '../dist/physics.js';import {updateTrafficBudget} from '../dist/traffic-budget.js';import {followTraffic,roundedRoute} from '../dist/traffic.js';import {PropGrid,StreetProps} from '../dist/street-props.js';
import {addBuildingColliders,exportBuildingProfiles} from '../dist/building-colliders.js';

test('traffic sleeps outside the local budget and resumes at its saved pose; racers retain bullet CCD',()=>{
 const physics=createDrivingWorld(),player=physics.addVehicle({userData:{kind:'player'}}),racer=physics.addVehicle({x:10,userData:{kind:'opponent'}}),actor=physics.addVehicle({x:300,userData:{kind:'traffic'}}),car={actor,mesh:{visible:true}},traffic=[car];
 assert.equal(player.body.isBullet(),true);assert.equal(racer.body.isBullet(),true);assert.equal(actor.body.isBullet(),false);
 updateTrafficBudget(traffic,player);assert.equal(actor.body.isActive(),false);assert.equal(car.mesh.visible,false);
 const x=actor.x,z=actor.z;physics.step(.1);assert.equal(actor.x,x);assert.equal(actor.z,z);
 player.setPose({x:90});updateTrafficBudget(traffic,player);assert.equal(actor.body.isActive(),true);assert.equal(actor.x,x);assert.equal(actor.z,z);assert.equal(car.mesh.visible,true);
 player.setPose({x:65});updateTrafficBudget(traffic,player);assert.equal(actor.body.isActive(),true,'activation hysteresis');
 player.setPose({x:240});updateTrafficBudget(traffic,player);assert.equal(actor.body.isBullet(),true,'nearby traffic retains swept dynamic contacts');
 player.setPose({x:0});updateTrafficBudget(traffic,player);assert.equal(actor.body.isActive(),false);
});
test('inactive traffic does not evaluate route following',()=>{const physics=createDrivingWorld(),actor=physics.addVehicle({userData:{kind:'traffic'}});actor.body.setActive(false);actor.setTarget=()=>{throw Error('inactive traffic stepped');};followTraffic([{actor,route:roundedRoute({left:0,right:40,top:0,bottom:40}),progress:0,cruise:10}],{x:300,z:300},1/60);});
test('movable prop grid reindexes displaced objects without duplicates or stale home hits',()=>{const grid=new PropGrid([{x:0,z:0}],20),hits=[];const visit=i=>hits.push(i);grid.move(0,180,180);grid.forNear(0,0,20,visit);assert.deepEqual(hits,[]);grid.forNear(180,180,5,visit);assert.deepEqual(hits,[0]);grid.move(0,181,181);hits.length=0;grid.forNear(180,180,5,visit);assert.deepEqual(hits,[0]);});
test('slideable furniture deactivates far away and reactivates at its displaced location',()=>{
 const physics=createDrivingWorld(),world={obstacles:[],interactiveProps:[{type:'bench',x:0,z:0,rot:0},{type:'bench',x:900,z:900,rot:0}]},props=new StreetProps({scene:new T.Scene(),physics,world,blocked:()=>true});
 const model=new T.Mesh(new T.BoxGeometry(1,.8,2),new T.MeshStandardMaterial());model.position.y=.4;props.build('bench',model);props.ready=true;const car=physics.addVehicle({x:5,z:0});props.beforeStep(car,1/60);
 const [near,far]=props.bodies;assert.equal(near.actor.body.isActive(),true);assert.equal(far.actor.body.isActive(),false);assert.equal(props.activeSlides.size,1);
 near.actor.body.setTransform({x:65,y:0},0);props.update(1/60,car);car.setPose({x:400,z:400});props.beforeStep(car,1/60);assert.equal(near.actor.body.isActive(),false);
 car.setPose({x:65,z:5});props.beforeStep(car,1/60);assert.equal(near.actor.body.isActive(),true);assert.equal(near.actor.x,65);
});
test('serialized height-aware profiles reproduce actual fixtures in an independent cache and reject stale schemas',async()=>{
 const root=new T.Group();for(const x of [-4,4]){const m=new T.Mesh(new T.BoxGeometry(1,4,2),new T.MeshStandardMaterial());m.position.set(x,2,0);root.add(m);}const physics=createDrivingWorld(),obstacles=[];addBuildingColliders(root,physics,obstacles);
 const data=JSON.parse(JSON.stringify(exportBuildingProfiles())),fresh=await import('../dist/building-colliders.js?prebaked-test');fresh.seedBuildingProfiles(data);const second=createDrivingWorld(),copies=[];fresh.addBuildingColliders(root.clone(true),second,copies);
 assert.equal(fresh.buildingProfileStats.compiled,0);assert.equal(fresh.buildingProfileStats.cacheHits,1);assert.deepEqual(copies.map(o=>[...o.box.min.toArray(),...o.box.max.toArray()]),obstacles.map(o=>[...o.box.min.toArray(),...o.box.max.toArray()]));
 const changed=await import('../dist/building-colliders.js?stale-cache-test');changed.seedBuildingProfiles({...data,schema:'outdated'});changed.addBuildingColliders(root.clone(true),createDrivingWorld(),[]);assert.equal(changed.buildingProfileStats.compiled,1);
});
test('optimized hero cars and baked thumbnails match their actual source files',()=>{
 const reports=JSON.parse(fs.readFileSync(new URL('../dist/assets/hero-cars-optimization.json',import.meta.url))),thumbnails=JSON.parse(fs.readFileSync(new URL('../dist/assets/car-thumbnails/source.json',import.meta.url)));
 for(const report of reports){const bytes=fs.readFileSync(new URL('../dist/assets/'+report.asset+'.glb',import.meta.url)),gltf=JSON.parse(bytes.subarray(20,20+bytes.readUInt32LE(12)));assert.ok(gltf.extensionsRequired.includes('EXT_meshopt_compression'));assert.ok(report.triangles<report.beforeTriangles*.4);assert.equal(bytes.length,report.bytes);assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),thumbnails[report.asset]);}
 for(const id of ['concept','roadster','bmw','nsx','porsche']){const bytes=fs.readFileSync(new URL('../dist/assets/car-thumbnails/'+id+'.webp',import.meta.url));assert.equal(bytes.toString('ascii',8,12),'WEBP');assert.ok(bytes.length<10000);}
 const sky=fs.readFileSync(new URL('../dist/assets/sky-midday/kloofendal-puresky-1k.hdr',import.meta.url));assert.match(sky.subarray(0,90).toString(),/-Y 512 \+X 1024/);assert.ok(sky.length<1600000);
});

test('parked-car contact tracking updates the rendered instance after a physical shove',async()=>{
 const {STREET_CAR_ASSETS,buildStreetCars}=await import('../dist/street-cars.js'),{loadVehicleGeometry}=await import('./helpers/vehicle-glb.mjs');const models={};for(const name of STREET_CAR_ASSETS)models[name]=await loadVehicleGeometry(name);
 const physics=createDrivingWorld(),scene=new T.Scene(),world={obstacles:[],lotFill:{courts:[]}},cars=buildStreetCars({scene,physics,models,map:'drift',world,extraCars:[{model:STREET_CAR_ASSETS[0],x:0,z:-12,heading:0,width:2,length:4.3,height:1.5,paint:null}]}),car=cars.cars[0],sin=Math.sin(car.heading),cos=Math.cos(car.heading);
 const player=physics.addVehicle({x:car.x+sin*10,z:car.z+cos*10,heading:car.heading});player.setControls({throttle:1});let tracked=false;
 for(let i=0;i<300;i++){physics.step(1/120);tracked||=cars.awake.size>0;cars.update(player);}
 assert.ok(tracked,'physical contact must enqueue render updates');assert.ok(car.moved,'the visible parked car must move with its body');const matrix=new T.Matrix4();cars.mesh.getMatrixAt(car.instance,matrix);assert.ok(Math.hypot(matrix.elements[12]-car.actor.x,matrix.elements[14]-car.actor.z)<.001);cars.dispose();
});
