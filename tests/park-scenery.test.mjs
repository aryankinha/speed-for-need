import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../dist/vendor/three.module.js';
import {ParkLife,parkPlants} from '../dist/park-life.js';
const plots=[{x:0,z:0,width:106,length:106,ground:.105},{x:200,z:0,width:106,length:106,ground:.105},{x:400,z:0,width:106,length:106,ground:.105}];
test('park scenery requests only shrubs and shares standard render resources across plots',async()=>{
 const scene=new THREE.Scene(),root=new THREE.Group();root.add(new THREE.Mesh(new THREE.BoxGeometry(.3,.4,.3),new THREE.MeshStandardMaterial()));
 const requests=[],park=new ParkLife({scene,plots});await park.load({async loadAsync(path){requests.push(path);return {scene:root};}});
 assert.deepEqual(requests,['assets/park/shrub.glb']);assert.equal(park.groups.length,3);
 const meshes=park.groups.map(p=>p.group.children[0]);assert.equal(meshes.reduce((n,m)=>n+m.count,0),84);
 assert.ok(meshes.every(m=>m.name==='park-shrubs'));assert.ok(meshes.every(m=>m.geometry===meshes[0].geometry&&m.material===meshes[0].material));
 assert.equal(meshes[0].material.onBeforeCompile,THREE.Material.prototype.onBeforeCompile,'no custom vegetation shader');
 const matrix=meshes[0].instanceMatrix.array.slice();park.update({x:0,z:0});assert.equal(park.groups[0].group.visible,true);assert.equal(park.groups[1].group.visible,false);
 park.update({x:400,z:0});assert.equal(park.groups[0].group.visible,false);assert.equal(park.groups[2].group.visible,true);assert.deepEqual(meshes[0].instanceMatrix.array,matrix,'updates only cull; instance transforms remain static');
});
test('empty maps do not request vegetation assets; shrub placement stays sparse and leaves paths clear',async()=>{
 const park=new ParkLife({scene:new THREE.Scene(),plots:[]});await park.load({loadAsync(){assert.fail('map without parks must not load shrubs');}});park.update({x:0,z:0});
 const layout=parkPlants(plots);assert.equal(layout.shrubs.length,84);assert.ok(!('grass' in layout));assert.deepEqual(parkPlants(plots),layout);
 for(const p of layout.shrubs)assert.ok(Math.abs(p.x-p.park.x)>5&&Math.abs(p.z-p.park.z)>5);
});
