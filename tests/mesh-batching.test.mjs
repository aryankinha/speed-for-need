import test from 'node:test';import assert from 'node:assert/strict';
import * as THREE from '../dist/vendor/three.module.js';
import {batchStaticMeshes}from '../dist/mesh-batching.js';
import {VEHICLES}from '../dist/vehicles.js';
import {prepareVehicleGeometry}from '../dist/vehicle-models.js';
import {loadVehicleGeometry}from './helpers/vehicle-glb.mjs';
const box=root=>new THREE.Box3().setFromObject(root,true);
const triangles=root=>{let count=0;root.traverse(node=>{if(node.isMesh)count+=(node.geometry.index?.count??node.geometry.attributes.position.count)/3;});return count;};
for(const definition of VEHICLES)test(`${definition.name}: static batching preserves actual car geometry, wheel rigs and body-paint selection`,async()=>{
 const root=await loadVehicleGeometry(definition.asset);root.traverse(node=>{if(node.isMesh&&node.material.name==='Glass')node.material.transparent=true;});const prepared=prepareVehicleGeometry(root,definition.id);root.position.set(31,2,-14);root.rotation.y+=.27;root.scale.multiplyScalar(1.3);root.updateWorldMatrix(true,true);
 const before=box(root),beforeTriangles=triangles(root),wheelMatrices=prepared.wheels.map(w=>w.node.matrixWorld.clone()),paintNodes=(definition.paintMeshNames||[]).map(name=>root.getObjectByName(name)),materials=new Set();root.traverse(node=>{if(node.isMesh)materials.add(node.material);});
 const stats=batchStaticMeshes(root,{pinnedNames:prepared.pinnedNames,preserveNames:definition.paintMeshNames||[]});
 const after=box(root);assert.ok(before.min.distanceTo(after.min)<1e-4&&before.max.distanceTo(after.max)<1e-4,'static vertices retain world bounds');assert.equal(triangles(root),beforeTriangles,'no triangles added or dropped');
 for(const wheel of prepared.wheels){assert.equal(root.getObjectByName(wheel.node.name),wheel.node);const matrix=wheelMatrices[prepared.wheels.indexOf(wheel)];assert.ok(wheel.node.matrixWorld.elements.every((value,i)=>Math.abs(value-matrix.elements[i])<1e-8));}
 for(const paint of paintNodes){assert.equal(root.getObjectByName(paint.name),paint);assert.equal(paint.userData.paint,true);}
 root.traverse(node=>{if(node.isMesh)assert.ok(materials.has(node.material),'batch retains exact shared materials for color changes');});
 if(['concept','roadster','nsx','porsche'].includes(definition.id))assert.ok(stats.after<stats.before,`batching should measurably help ${definition.id}`);
 console.log(`${definition.id}: ${stats.before} → ${stats.after} meshes (${stats.before-stats.after} fewer)`);
});
test('nested quantized, mirrored and interleaved meshes retain world vertices and correct winding',()=>{
 const root=new THREE.Group(),material=new THREE.MeshStandardMaterial(),parent=new THREE.Mesh(new THREE.BoxGeometry(2,2,2),material);parent.geometry.deleteAttribute('normal');parent.geometry.deleteAttribute('uv');parent.geometry.clearGroups();parent.position.set(2,3,4);parent.rotation.set(.2,.3,.4);parent.scale.set(-2,1,1);root.add(parent);
 const geometry=new THREE.BufferGeometry(),interleaved=new THREE.InterleavedBuffer(new Int16Array([0,0,0,7,32767,0,0,7,0,32767,0,7]),4);geometry.setAttribute('position',new THREE.InterleavedBufferAttribute(interleaved,3,0,true));geometry.setIndex([0,1,2]);const child=new THREE.Mesh(geometry,material);child.position.set(1,-2,.5);parent.add(child);
 const pinned=new THREE.Group();pinned.name='Wheel';pinned.position.set(1,2,3);child.add(pinned);root.updateWorldMatrix(true,true);const wheelMatrix=pinned.matrixWorld.clone(),before=box(root);const stats=batchStaticMeshes(root,{pinnedNames:['Wheel']});assert.equal(stats.after,1);assert.ok(before.min.distanceTo(box(root).min)<1e-5&&before.max.distanceTo(box(root).max)<1e-5);assert.ok(pinned.matrixWorld.elements.every((v,i)=>Math.abs(v-wheelMatrix.elements[i])<1e-8));const merged=root.children.find(n=>n.isMesh);assert.equal(merged.geometry.attributes.position.normalized,false);assert.ok(merged.geometry.attributes.position.array instanceof Float32Array);assert.deepEqual([...merged.geometry.index.array.slice(-3)],[24,26,25]);
});
test('transparent objects keep independent depth sorting and protected nodes keep stable names',()=>{
 const root=new THREE.Group(),glass=new THREE.MeshStandardMaterial({transparent:true}),paint=new THREE.MeshStandardMaterial();for(let i=0;i<2;i++)root.add(new THREE.Mesh(new THREE.BoxGeometry(),glass));for(const name of ['PaintA','PaintB']){const mesh=new THREE.Mesh(new THREE.BoxGeometry(),paint);mesh.name=name;root.add(mesh);}const stats=batchStaticMeshes(root,{preserveNames:['PaintA','PaintB']});assert.equal(stats.before,stats.after);assert.ok(root.getObjectByName('PaintA'));assert.ok(root.getObjectByName('PaintB'));
});
