import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import crypto from 'node:crypto';
import * as T from '../dist/vendor/three.module.js';import {createDrivingWorld} from '../dist/physics.js';import {RaceMode} from '../dist/race-mode.js';import {CircuitPath} from '../dist/race-track.js';import {VEHICLES} from '../dist/vehicles.js';import {prepareVehicleGeometry} from '../dist/vehicle-models.js';import {loadVehicleGeometry} from './helpers/vehicle-glb.mjs';import {PickupField} from '../dist/nitro.js';
import {DRIFT_PATH,DRIFT_WORLD,DRIFT_GATES,DRIFT_DESTINATIONS,DRIFT_TRACK_DATA as DATA,driftSurfaceAt,addDriftColliders} from '../dist/drift-layout.js';import {MAPS,readSelectedMap,mapUrl} from '../dist/map-selection.js';
const root=new URL('../dist/assets/drift-track/',import.meta.url),source=fs.readFileSync(new URL('../source-assets/drift-track/drift_race_track_free.glb',import.meta.url)),optimized=fs.readFileSync(new URL('drift-race-track.meshopt.glb',root));const json=b=>JSON.parse(b.subarray(20,20+b.readUInt32LE(12))),original=json(source),packed=json(optimized);
test('optimized authored track retains every triangle, PBR texture role and native resolution',()=>{
 const triangles=j=>j.meshes.reduce((s,m)=>s+m.primitives.reduce((n,p)=>n+j.accessors[p.indices].count/3,0),0);
 assert.equal(triangles(original),314141);assert.equal(triangles(packed),triangles(original));assert.equal(packed.meshes.length,5);assert.equal(packed.materials.length,5);assert.equal(packed.images.length,9);assert.ok(packed.extensionsRequired.includes('EXT_meshopt_compression'));assert.ok(packed.images.every(i=>i.mimeType==='image/webp'));assert.ok(optimized.length<source.length*.6);
 for(const m of original.materials){const output=packed.materials.find(v=>v.name===m.name);assert.ok(output);assert.equal(output.doubleSided,m.doubleSided);assert.equal(output.alphaMode,m.alphaMode);assert.equal(output.pbrMetallicRoughness?.roughnessFactor??1,m.pbrMetallicRoughness?.roughnessFactor??1);for(const key of ['baseColorTexture','metallicRoughnessTexture'])assert.equal(!!output.pbrMetallicRoughness?.[key],!!m.pbrMetallicRoughness?.[key]);assert.equal(!!output.normalTexture,!!m.normalTexture);}
 for(let i=0;i<packed.images.length;i++){const view=packed.bufferViews[packed.images[i].bufferView],start=28+optimized.readUInt32LE(12)+view.byteOffset,bytes=optimized.subarray(start,start+view.byteLength),type=bytes.toString('ascii',12,16);let w,h;if(type==='VP8X'){w=bytes.readUIntLE(24,3)+1;h=bytes.readUIntLE(27,3)+1;}else if(type==='VP8L'){const bits=bytes.readUInt32LE(21);w=(bits&16383)+1;h=((bits>>>14)&16383)+1;}else{assert.equal(type,'VP8 ');w=bytes.readUInt16LE(26)&16383;h=bytes.readUInt16LE(28)&16383;}assert.equal(w,i<6?2048:1024);assert.equal(h,w);}assert.deepEqual(packed.asset.extras,original.asset.extras);
 assert.equal(crypto.createHash('sha256').update(source).digest('hex'),DATA.sourceSha256);assert.match(original.asset.extras.author,/Nicholas/);assert.equal(DATA.scale,1);
});
test('closed imported route, spawn, all gates and fixed nitro placements lie on authored tarmac',()=>{
 const p={};assert.ok(DRIFT_PATH.length>1100&&DRIFT_PATH.length<1300);assert.equal(DRIFT_GATES.length,12);assert.ok(Math.abs(DATA.roadY-.002518)<.0001);
 for(let i=0;i<DRIFT_PATH.count;i++){DRIFT_PATH.sampleAtDistance(i*DRIFT_PATH.ds,p);assert.equal(driftSurfaceAt(p.x,p.z).kind,'road','off-road route sample '+i);}
 assert.equal(driftSurfaceAt(DRIFT_WORLD.spawn.x,DRIFT_WORLD.spawn.z).kind,'road');for(const d of DRIFT_DESTINATIONS)assert.equal(driftSurfaceAt(d.x,d.z).kind,'road');const field=new PickupField({path:DRIFT_PATH,count:18});for(const b of field.items)assert.equal(driftSurfaceAt(b.x,b.z).kind,'road');
 const item=field.items[0],x=item.x,z=item.z;assert.equal(field.collectAt({x,z},40),20);field.update(16,{x:999,z:999});assert.ok(item.active);assert.equal(item.x,x);assert.equal(item.z,z);
});
test('traced guardrail chains stop bullet cars from either side using actual Planck contacts',()=>{
 const physics=createDrivingWorld();const walls=addDriftColliders(physics);assert.equal(walls.length,DATA.walls.length+1);assert.ok(walls.every(a=>a.body.getType()==='static'));let ax=0,az=0,bx=0,bz=0,best=0;
 for(const wall of DATA.walls)if(wall.source.startsWith('Rails'))for(let i=0;i<wall.points.length;i++){const a=wall.points[i],b=wall.points[(i+1)%wall.points.length],d=Math.hypot(b[0]-a[0],b[1]-a[1]);if(d>best){best=d;ax=a[0];az=a[1];bx=b[0];bz=b[1];}}
 assert.ok(best>2);const mx=(ax+bx)/2,mz=(az+bz)/2,nx=-(bz-az)/best,nz=(bx-ax)/best;
 for(const side of [-1,1]){const car=physics.addVehicle({x:mx+nx*4*side,z:mz+nz*4*side});car.setPose({x:car.x,z:car.z,heading:Math.atan2(nx*side,nz*side),vx:-nx*22*side,vz:-nz*22*side});let hit=false;for(let i=0;i<120;i++){physics.step(1/120);if(physics.lastImpacts.some(v=>v.a===car||v.b===car))hit=true;}assert.ok(hit);assert.ok(((car.x-mx)*nx+(car.z-mz)*nz)*side>.6,'car crossed guardrail');physics.remove(car);}
});
test('all five measured garage cars complete three imported-track laps without rail following or teleporting',async()=>{
 const rides={};for(const def of VEHICLES){const root=await loadVehicleGeometry(def.asset);prepareVehicleGeometry(root,def.id);const size=new T.Box3().setFromObject(root,true).getSize(new T.Vector3());size.multiplyScalar(def.length/size.z);rides[def.id]={size};}
 const physics=createDrivingWorld();addDriftColliders(physics);const player=physics.addVehicle({...VEHICLES[0].tuning,width:rides.concept.size.x,length:rides.concept.size.z}),race=new RaceMode({physics,path:DRIFT_PATH,rides,groundY:DATA.roadY});race.start('concept',player);for(const e of race.entries){assert.equal(e.actor.groundElevation,DATA.roadY);e.actor.setPose=()=>{throw Error('race teleport');};e.actor.setTarget=()=>{throw Error('rail follower');};}
 const input={throttle:0,reverse:0,steer:0,boost:false,handbrake:false};function before(dt){if(race.phase==='racing'){const e=race.entries[0];race.driveAI(e,dt);input.throttle=e.controls.throttle;input.steer=e.controls.steer;input.reverse=Math.max(e.controls.reverse,e.controls.brake);}race.beforeStep(dt,input);}function after(dt){race.afterStep(dt);}
 for(let i=0;i<120*600&&race.phase!=='finished';i++)physics.step(1/120,before,after);assert.equal(race.phase,'finished');for(const e of race.entries){assert.equal(e.lap,3,e.def.id+' missed gate '+e.nextGate);assert.ok(Number.isFinite(e.finishTime));assert.ok(e.finishTime<165,e.def.id+' must race competitively, not crawl through corners');assert.equal(e.actor.target,null);}
});
test('close track branches cannot jump a checkpoint or strand its ordered gate sequence',()=>{
 const path=new CircuitPath({x:0,z:0,waypoints:[{x:0,z:0},{x:0,z:-20},{x:5,z:-20},{x:5,z:0}]}),physics=createDrivingWorld(),player=physics.addVehicle(),race=new RaceMode({physics,path});race.start('concept',player);race.phase='racing';const e=race.entries[1],p={};path.sampleAtDistance(6,p);e.progress=6;e.nextGate=2;e.actor.setPose({x:p.x+4,z:p.z,heading:p.heading,vx:1});e.lastX=e.actor.x;e.lastZ=e.actor.z;assert.ok(Math.abs(path.nearest(e.actor.x,e.actor.z,e.progress)-e.progress)>5,'fixture must actually reproduce an ambiguous adjacent branch');physics.step(1/120);race.afterStep(1/120);assert.ok(Math.abs(e.progress-6)<.1);assert.equal(e.nextGate,2);race.stop();
});
test('Drift is a selectable map without changing existing URL defaults or Electron navigation',()=>{assert.equal(MAPS.length,2);assert.equal(readSelectedMap('?map=drift'),'drift');assert.equal(readSelectedMap(''),'coast');assert.equal(mapUrl('file:///game/dist/index.html?debug#home','drift'),'file:///game/dist/index.html?debug=&map=drift#home');});

test('closed facility safety rail contains boosted cars at every reachable perimeter edge',()=>{
 const ring=DATA.perimeter,physics=createDrivingWorld(),boundary=physics.addChain({points:ring,userData:{kind:'boundary'}});
 const car=physics.addVehicle({width:2.53,length:4.8});
 function inside(x,z){let hit=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],b=ring[j];if((a[1]>z)!==(b[1]>z)&&x<(b[0]-a[0])*(z-a[1])/(b[1]-a[1])+a[0])hit=!hit;}return hit;}
 let tested=0;
 for(let i=0;i<ring.length;i++){
  const a=ring[i],b=ring[(i+1)%ring.length],dx=b[0]-a[0],dz=b[1]-a[1],length=Math.hypot(dx,dz),mx=(a[0]+b[0])/2,mz=(a[1]+b[1])/2;
  let nx=-dz/length,nz=dx/length;if(!inside(mx+nx*.05,mz+nz*.05)){nx=-nx;nz=-nz;}
  if(!inside(mx+nx*5,mz+nz*5))continue;
  car.setPose({x:mx+nx*5,z:mz+nz*5,heading:Math.atan2(nx,nz),vx:-nx*65,vz:-nz*65});let contact=false;
  for(let step=0;step<90;step++){physics.step(1/120);if(physics.lastImpacts.some(h=>h.a===boundary||h.b===boundary))contact=true;assert.ok(inside(car.x,car.z),'escaped edge '+i);}
  assert.ok(contact,'no physical contact at edge '+i);tested++;
 }
 assert.ok(tested>220,'must cover the complete facility, not one straight');
 const [left,top,right,bottom]=DATA.terrainBounds;
 for(const [x,z]of ring){assert.ok(x>=left&&x<=right&&z>=top&&z<=bottom,'perimeter outside authored terrain');}
});

test('safety rail is visible geometry using the exact physical perimeter, leaving authored meshes intact',async()=>{
 const {buildDriftPerimeter}=await import('../dist/world-drift.js');const root=new T.Group(),authored=new T.Mesh(new T.BoxGeometry(),new T.MeshStandardMaterial({name:'Metal'}));root.add(authored);
 const rail=buildDriftPerimeter(root);assert.ok(root.children.includes(authored));assert.equal(authored.visible,true);assert.equal(rail.children.length,2);
 const positions=rail.children[0].geometry.getAttribute('position');assert.equal(positions.count,DATA.perimeter.length*5);
 for(let i=0;i<DATA.perimeter.length;i++){const q=DATA.perimeter[i];assert.ok(Math.hypot(positions.getX(i*5)-q[0],positions.getZ(i*5)-q[1])<.08);}
 assert.ok(rail.children[1].isInstancedMesh);
});

test('every garage grid can pass a stationary player rather than queue indefinitely',async()=>{
 const rides={};for(const def of VEHICLES){const root=await loadVehicleGeometry(def.asset);prepareVehicleGeometry(root,def.id);const size=new T.Box3().setFromObject(root,true).getSize(new T.Vector3());size.multiplyScalar(def.length/size.z);rides[def.id]={size};}
 for(const chosen of VEHICLES){
  const physics=createDrivingWorld();addDriftColliders(physics);const player=physics.addVehicle({...chosen.tuning,width:rides[chosen.id].size.x,length:chosen.length}),race=new RaceMode({physics,path:DRIFT_PATH,rides});race.start(chosen.id,player);
  for(const e of race.opponents){e.actor.setPose=()=>{throw Error('teleport');};e.actor.setTarget=()=>{throw Error('kinematic target');};}
  const held={throttle:0,reverse:0,steer:0,boost:false,handbrake:true};function before(dt){race.beforeStep(dt,held);}function after(dt){race.afterStep(dt);}
  for(let i=0;i<120*40;i++)physics.step(1/120,before,after);
  for(const e of race.opponents)assert.ok(e.progress>150,chosen.id+' grid stranded '+e.def.id+' behind a parked car');race.stop();
 }
});
