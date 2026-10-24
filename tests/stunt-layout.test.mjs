import test from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import * as THREE from '../dist/vendor/three.module.js';
import {loadVehicleGeometry} from './helpers/vehicle-glb.mjs';
import {createDrivingWorld} from '../dist/physics.js';
import {SUNSET,DESTINATIONS,CITY_MODELS} from '../dist/map-layout.js';
import {STUNT_AREA,RAMPS} from '../dist/stunts.js';

// Resolve the browser import map in Node; exercise the real world builder and
// downloaded GLB geometry rather than a second hand-written obstacle layout.
const hooks=registerHooks({resolve(specifier,context,next){
  if(specifier==='three')return {url:new URL('../dist/vendor/three.module.js',import.meta.url).href,shortCircuit:true};
  if(specifier==='three/addons/utils/BufferGeometryUtils.js')return {url:new URL('../dist/vendor/utils/BufferGeometryUtils.js',import.meta.url).href,shortCircuit:true};
  return next(specifier,context);
}});
const {buildWorld}=await import('../dist/world.js');
hooks.deregister();

test('real stunt park has no cone colliders or perimeter obstacles and keeps construction cones elsewhere',async t=>{
  const names=Array.from({length:14},(_,i)=>`building-${String.fromCharCode(97+i)}`).concat(['stunt-ramp','tree-palmdetailedtall','light-curved','traffic-light','bench','planter','dumpster','construction-cone','construction-barrier','road-sign-stop','sign-highway-detailed','rock-largea',...CITY_MODELS]);
  const models=Object.fromEntries(await Promise.all(names.map(async name=>[name,await loadVehicleGeometry(name)])));
  const originalDocument=globalThis.document,originalLoad=THREE.TextureLoader.prototype.loadAsync;
  globalThis.document={createElement:()=>({width:0,height:0,getContext:()=>({createImageData:(w,h)=>({data:new Uint8ClampedArray(w*h*4)}),putImageData(){},fillText(){},beginPath(){},moveTo(){},lineTo(){},closePath(){},fill(){}})})};
  THREE.TextureLoader.prototype.loadAsync=async()=>new THREE.Texture();
  try{
    const physics=createDrivingWorld();
    const world=await buildWorld({scene:new THREE.Scene(),physics,models,random:()=>.4});
    t.diagnostic('Coast lot fill: '+JSON.stringify(world.lotFill.stats));
    assert.equal(world.lots.length,172);assert.equal(world.lots.filter(l=>l.dropped).length,12);
    assert.equal(world.lotFill.cars.length,65);assert.ok(world.lotFill.stats.trees>100);
    assert.equal(physics.objects.filter(o=>o.userData?.kind==='stunt-cone').length,0);
    assert.equal(physics.objects.filter(o=>o.userData?.kind==='cone').length,0,'construction cones no longer stop the car like walls');
    assert.equal(world.interactiveProps.filter(o=>o.type==='cone').length,5,'construction cones remain present as knockable props');
    const parkObstacles=world.obstacles.filter(o=>o.actor.x>STUNT_AREA.left&&o.actor.x<STUNT_AREA.right&&o.actor.z>STUNT_AREA.top&&o.actor.z<STUNT_AREA.bottom);
    assert.equal(parkObstacles.length,RAMPS.filter(r=>r.x>STUNT_AREA.left&&r.x<STUNT_AREA.right&&r.z>STUNT_AREA.top&&r.z<STUNT_AREA.bottom).length);
    assert.ok(parkObstacles.every(o=>o.actor.userData?.kind==='stunt-ramp'));
    // Verify the actual new road and every arrival using the real collision world.
    for(let d=24;d<612;d+=8){const t=d/Math.hypot(SUNSET.bx-SUNSET.ax,SUNSET.bz-SUNSET.az),probe=physics.addVehicle({x:SUNSET.ax+(SUNSET.bx-SUNSET.ax)*t,z:SUNSET.az+(SUNSET.bz-SUNSET.az)*t,heading:-Math.PI/4});const blockers=physics.objects.filter(o=>o!==probe&&physics.overlaps(probe,o));physics.remove(probe);assert.deepEqual(blockers.map(o=>o.userData?.kind),[],`Sunset blocked at ${d} m`);}
    for(const destination of DESTINATIONS){const probe=physics.addVehicle(destination),blockers=physics.objects.filter(o=>o!==probe&&physics.overlaps(probe,o));physics.remove(probe);assert.deepEqual(blockers.map(o=>o.userData?.kind),[],destination.name+' arrival is blocked');}
    assert.ok(physics.objects.filter(o=>o.userData?.kind==='sunset-palm').length>=4,'diagonal promenade has authored palm trees');
    assert.ok(world.stats.districtBuildings['Palm Gardens']>12);
    assert.ok(world.stats.districtBuildings['Downtown Solana']>12);
    assert.ok(world.stats.districtBuildings['Arts & Warehouse']>12);

  }finally{globalThis.document=originalDocument;THREE.TextureLoader.prototype.loadAsync=originalLoad;}
});

test('boost pads and their approaches sit clear of every collider in the real world',async()=>{
  const {BOOST_PADS}=await import('../dist/boost-pads.js');
  const names=Array.from({length:14},(_,i)=>`building-${String.fromCharCode(97+i)}`).concat(['stunt-ramp','tree-palmdetailedtall','light-curved','traffic-light','bench','planter','dumpster','construction-cone','construction-barrier','road-sign-stop','sign-highway-detailed','rock-largea',...CITY_MODELS]);
  const models=Object.fromEntries(await Promise.all(names.map(async name=>[name,await loadVehicleGeometry(name)])));
  const originalDocument=globalThis.document,originalLoad=THREE.TextureLoader.prototype.loadAsync;
  globalThis.document={createElement:()=>({width:0,height:0,getContext:()=>({createImageData:(w,h)=>({data:new Uint8ClampedArray(w*h*4)}),putImageData(){},fillText(){},beginPath(){},moveTo(){},lineTo(){},closePath(){},fill(){}})})};
  THREE.TextureLoader.prototype.loadAsync=async()=>new THREE.Texture();
  try{
    const physics=createDrivingWorld();
    await buildWorld({scene:new THREE.Scene(),physics,models,random:()=>.4});
    for(const pad of BOOST_PADS){
      // A probe with the car's footprint, centred on the pad, must overlap nothing solid.
      const probe=physics.addVehicle({x:pad.x,z:pad.z,heading:pad.heading});
      const blockers=physics.objects.filter(o=>o!==probe&&physics.overlaps(probe,o));
      physics.remove(probe);
      assert.deepEqual(blockers.map(o=>o.userData?.kind),[],`${pad.id} is blocked`);
    }
  }finally{globalThis.document=originalDocument;THREE.TextureLoader.prototype.loadAsync=originalLoad;}
});
