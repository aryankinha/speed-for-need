import test from 'node:test';import assert from 'node:assert/strict';
import * as THREE from '../dist/vendor/three.module.js';
import {planLotFill,lotRect,LOT_TREE_TYPES} from '../dist/lot-fill.js';
import {roadClearance,PROP_TYPES,StreetProps,seeded} from '../dist/street-props.js';
import {mapDistrict,clearOfSunset,DESTINATIONS} from '../dist/map-layout.js';
import {layoutFor} from '../dist/activities.js';
import {createDrivingWorld} from '../dist/physics.js';
import {buildStreetCars,STREET_CAR_ASSETS} from '../dist/street-cars.js';
import {loadVehicleGeometry} from './helpers/vehicle-glb.mjs';
const lots=[];
for(let x=-375;x<450;x+=150)for(let z=-525;z<600;z+=150)for(const dx of [-32,32])for(const dz of [-33,33]){const cx=x+dx,cz=z+dz;lots.push({...lotRect(cx,cz,48,48),blockX:x,blockZ:z,district:mapDistrict(x,z),bounds:new THREE.Box3(new THREE.Vector3(cx-6,0,cz-6),new THREE.Vector3(cx+6,15,cz+6))});}
const input={lots,parkPlots:[{x:-225,z:75,width:106,length:106},{x:225,z:-225,width:106,length:106},{x:-75,z:525,width:106,length:106}]};
test('Coast lot planner adds exactly 65 cars with deterministic bounded greenery; other maps are untouched',()=>{
 const plan=planLotFill(input);assert.equal(plan.cars.length,65);assert.deepEqual(planLotFill(input),plan);
 assert.ok(plan.stats.trees>200&&plan.stats.trees<700);assert.ok(plan.items.every(i=>PROP_TYPES[i.type]));assert.ok(plan.containers.length<=18);
 assert.equal(planLotFill({...input,map:'default'}).items.length,0);assert.equal(planLotFill({...input,map:'la'}).cars.length,0);
 for(const p of plan.items){for(const d of DESTINATIONS)assert.ok(Math.hypot(p.x-d.x,p.z-d.z)>30);for(const pkg of layoutFor('coast').packages)assert.ok(Math.hypot(p.x-pkg.x,p.z-pkg.z)>8);assert.ok(roadClearance('coast',p.x,p.z)>8);assert.ok(clearOfSunset(lotRect(p.x,p.z,2,2),2));for(const z of layoutFor('coast').zones)assert.ok(!(p.x>z.minX&&p.x<z.maxX&&p.z>z.minZ&&p.z<z.maxZ));}
 for(const car of plan.cars){assert.ok(roadClearance('coast',car.x,car.z)>8);assert.ok(car.lot);}
});
test('new items and court footprints avoid expanded buildings and leave internal circulation corridors open',()=>{
 const p=planLotFill(input),rects=[...p.courts,...p.items.map(i=>lotRect(i.x,i.z,1,1)),...p.containers.map(i=>lotRect(i.x,i.z,4,8))];
 for(const b of rects){assert.ok(lots.every(l=>b.maxX+2<=l.bounds.min.x||b.minX-2>=l.bounds.max.x||b.maxZ+2<=l.bounds.min.z||b.minZ-2>=l.bounds.max.z));}
 for(const court of p.courts){const l=court.lot;assert.ok(court.minX>=l.minX+2&&court.maxX<=l.maxX-2);assert.ok(court.minZ>=l.minZ+2&&court.maxZ<=l.maxZ-2);}
 const occupied=lots.map(l=>({box:new THREE.Box3(new THREE.Vector3(l.minX,0,l.minZ),new THREE.Vector3(l.maxX,20,l.maxZ)),actor:{userData:{kind:'solid'}}}));
 assert.equal(planLotFill({...input,obstacles:occupied}).items.length,0);assert.equal(planLotFill({...input,obstacles:occupied}).cars.length,0);
});
test('actual repo palm is instanced at 280m, resists a nudge and breaks away under a fast car',async()=>{
 const scene=new THREE.Scene(),physics=createDrivingWorld(),world={obstacles:[],interactiveProps:[{type:'lot-palm',x:0,z:-5,rot:0}],parkPlots:[]};
 const props=new StreetProps({scene,physics,world,map:'coast',blocked:()=>true});props.build('lot-palm',await loadVehicleGeometry('tree-palmtall'));props.ready=true;
 const tree=props.bodies[0],car=physics.addVehicle();props.refresh(200,-5);assert.ok(props.slots[0]>=0,'tree silhouettes remain visible beyond street-detail radius');
 car.setPose({x:0,z:0,vz:-2});props.beforeStep(car,.1);assert.equal(tree.state,'rest');assert.ok(tree.actor.body.isActive());
 car.setPose({x:0,z:-2,vz:-25});props.beforeStep(car,.1);assert.equal(tree.state,'loose');assert.equal(tree.actor.body.isActive(),false);
});
test('65 lot cars extend the existing batch without replacing kerb cars and remain shoveable',async()=>{
 const models=Object.fromEntries(await Promise.all(STREET_CAR_ASSETS.map(async n=>[n,await loadVehicleGeometry(n)])));
 const options={scene:new THREE.Scene(),physics:createDrivingWorld(),models,map:'coast',random:seeded(5279),world:{obstacles:[]}},baseline=buildStreetCars(options),extra=planLotFill(input).cars;
 const combined=buildStreetCars({...options,scene:new THREE.Scene(),physics:createDrivingWorld(),random:seeded(5279),world:{obstacles:[]},extraCars:extra});
 assert.equal(combined.cars.length,baseline.cars.length+65);assert.equal(combined.mesh.isBatchedMesh,true);assert.ok(combined.cars.slice(-65).every(c=>c.actor.body.isDynamic()&&!c.actor.body.isAwake()));
});
