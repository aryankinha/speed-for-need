import test from 'node:test';import assert from 'node:assert/strict';import * as THREE from '../dist/vendor/three.module.js';import {makeBeachGeometry} from '../dist/coast.js';
const bounds={left:-490,right:490,top:-670,bottom:670};
const mesh=new THREE.Mesh(makeBeachGeometry(bounds),new THREE.MeshBasicMaterial({side:THREE.DoubleSide}));mesh.updateMatrixWorld();
function hit(x,z){return new THREE.Raycaster(new THREE.Vector3(x,10,z),new THREE.Vector3(0,-1,0)).intersectObject(mesh)[0];}
test('all four edges have continuous beach above sea level',()=>{for(const [x,z] of [[-510,0],[510,0],[0,-690],[0,690]]){const h=hit(x,z);assert.ok(h);assert.ok(h.point.y>-.3);}});
test('beach ring leaves the city center open and surrounds corners',()=>{assert.equal(hit(0,0),undefined);for(const [x,z] of [[-510,-690],[-510,690],[510,-690],[510,690]])assert.ok(hit(x,z));});
test('outer sand slopes below sea level instead of ending at a visible cliff',()=>{const p=mesh.geometry.attributes.position;for(let i=0;i<p.count;i++)if(Math.abs(p.getX(i))>550||Math.abs(p.getZ(i))>730)assert.ok(p.getY(i)<-.3);});
