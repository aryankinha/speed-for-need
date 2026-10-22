import test from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import * as THREE from '../dist/vendor/three.module.js';
import {loadVehicleGeometry} from './helpers/vehicle-glb.mjs';
import {createDrivingWorld} from '../dist/physics.js';
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

test('real stunt park has no cone colliders or perimeter obstacles and keeps construction cones elsewhere',async()=>{
  const names=Array.from({length:14},(_,i)=>`building-${String.fromCharCode(97+i)}`).concat(['building-skyscraper-a','building-skyscraper-b','building-skyscraper-c','building-skyscraper-d','building-skyscraper-e','stunt-ramp','tree-palmdetailedtall','light-curved','traffic-light','bench','planter','dumpster','construction-cone','construction-barrier','road-sign-stop','sign-highway-detailed','rock-largea']);
  const models=Object.fromEntries(await Promise.all(names.map(async name=>[name,await loadVehicleGeometry(name)])));
  const originalDocument=globalThis.document,originalLoad=THREE.TextureLoader.prototype.loadAsync;
  globalThis.document={createElement:()=>({width:0,height:0,getContext:()=>({createImageData:(w,h)=>({data:new Uint8ClampedArray(w*h*4)}),putImageData(){},fillText(){}})})};
  THREE.TextureLoader.prototype.loadAsync=async()=>new THREE.Texture();
  try{
    const physics=createDrivingWorld();
    const world=await buildWorld({scene:new THREE.Scene(),physics,models,random:()=>.4});
    assert.equal(physics.objects.filter(o=>o.userData?.kind==='stunt-cone').length,0);
    assert.equal(physics.objects.filter(o=>o.userData?.kind==='cone').length,5);
    const parkObstacles=world.obstacles.filter(o=>o.actor.x>STUNT_AREA.left&&o.actor.x<STUNT_AREA.right&&o.actor.z>STUNT_AREA.top&&o.actor.z<STUNT_AREA.bottom);
    assert.equal(parkObstacles.length,RAMPS.length);
    assert.ok(parkObstacles.every(o=>o.actor.userData?.kind==='stunt-ramp'));
  }finally{globalThis.document=originalDocument;THREE.TextureLoader.prototype.loadAsync=originalLoad;}
});
