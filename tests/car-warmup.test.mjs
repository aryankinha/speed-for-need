import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../dist/vendor/three.module.js';
import {warmVehicleRenderPaths} from '../dist/car-warmup.js';

function setup({failAt=-1}={}){
 const ids=['a','b','c'],mk=()=>({visible:false});
 const rides=Object.fromEntries(ids.map(id=>[id,{group:mk()}]));rides.b.group.visible=true;
 const showroom={root:{visible:true},cars:Object.fromEntries(ids.map(id=>[id,{visible:id==='a'}])),frames:0,frame(){this.frames++;camera.position.set(9,9,9);}};
 const garageScene={root:{visible:false},cars:Object.fromEntries(ids.map(id=>[id,mk()])),frames:0,frame(){this.frames++;camera.fov=99;}};
 const player={visible:true};
 const camera=new THREE.PerspectiveCamera(57,1.6,.1,100);camera.position.set(1,2,3);
 const seen=[];let target='screen',renders=0;
 const renderer={getRenderTarget:()=>target,setRenderTarget:t=>{target=t;},shadowMap:{needsUpdate:false},
  render:()=>{if(renders++===failAt)throw new Error('boom');
   seen.push({target:target!=='screen',player:player.visible,showroom:showroom.root.visible,garage:garageScene.root.visible,
    rides:ids.filter(id=>rides[id].group.visible),showroomCars:ids.filter(id=>showroom.cars[id].visible),garageCars:ids.filter(id=>garageScene.cars[id].visible),shadow:renderer.shadowMap.needsUpdate});}};
 return {renderer,scene:{},camera,rides,player,showroom,garageScene,seen,state:()=>({target,player:player.visible,showroom:showroom.root.visible,garage:garageScene.root.visible,rides:ids.map(id=>rides[id].group.visible),showroomCars:ids.map(id=>showroom.cars[id].visible),garageCars:ids.map(id=>garageScene.cars[id].visible),cam:camera.position.toArray(),fov:camera.fov})};
}

test('renders every car once in the driving, showroom and garage light setups, one car at a time',()=>{
 const s=setup();assert.equal(warmVehicleRenderPaths(s),true);
 assert.equal(s.seen.length,9);assert.ok(s.seen.every(r=>r.target&&r.shadow));
 const driving=s.seen.slice(0,3),showroom=s.seen.slice(3,6),garage=s.seen.slice(6);
 assert.deepEqual(driving.map(r=>r.rides),[['a'],['b'],['c']]);assert.ok(driving.every(r=>r.player&&!r.showroom&&!r.garage&&!r.showroomCars.length&&!r.garageCars.length));
 assert.deepEqual(showroom.map(r=>r.showroomCars),[['a'],['b'],['c']]);assert.ok(showroom.every(r=>!r.player&&r.showroom&&!r.garage&&!r.rides.length));
 assert.deepEqual(garage.map(r=>r.garageCars),[['a'],['b'],['c']]);assert.ok(garage.every(r=>!r.player&&!r.showroom&&r.garage&&!r.rides.length));
});

test('every visibility flag, the camera pose and the render target are restored afterwards',()=>{
 const s=setup(),before=s.state();warmVehicleRenderPaths(s);assert.deepEqual(s.state(),before);
 assert.equal(s.showroom.frames,1);assert.equal(s.garageScene.frames,1);
});

test('a failing render never leaves the scene in a warm-up state',()=>{
 const s=setup({failAt:4}),before=s.state();
 const warn=console.warn;console.warn=()=>{};try{warmVehicleRenderPaths(s);}finally{console.warn=warn;}
 assert.deepEqual(s.state(),before);
});
