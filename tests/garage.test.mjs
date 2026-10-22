import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from '../dist/vendor/three.module.js';
import {VEHICLES,VEHICLE_STORAGE_KEY,getVehicle,restoreVehicle,GarageSelection,tuningBars} from '../dist/vehicles.js';
import {GarageScene} from '../dist/garage-scene.js';
import {prepareVehicleGeometry} from '../dist/vehicle-models.js';

function memoryStorage(value=null){
  return {value,writes:0,getItem(key){assert.equal(key,VEHICLE_STORAGE_KEY);return this.value;},setItem(key,next){assert.equal(key,VEHICLE_STORAGE_KEY);this.value=next;this.writes++;}};
}

test('garage catalog preserves both original cars and adds exactly two usable, locally bundled cars',()=>{
  assert.deepEqual(VEHICLES.map(v=>v.id),['concept','roadster','bmw','nsx']);
  assert.equal(new Set(VEHICLES.map(v=>v.asset)).size,4);
  for(const definition of VEHICLES){
    assert.equal(getVehicle(definition.id),definition);
    assert.ok(definition.length>3&&definition.length<6);
    assert.ok(Number.isFinite(definition.rotationY));
    assert.ok(definition.tuning.boostSpeed>definition.tuning.maxSpeed);
    for(const value of Object.values(definition.tuning))assert.ok(Number.isFinite(value)&&value>0);
    for(const value of Object.values(tuningBars(definition)))assert.ok(value>0&&value<=100);
    const model=fs.readFileSync(new URL(`../dist/assets/${definition.asset}.glb`,import.meta.url));
    assert.equal(model.toString('ascii',0,4),'glTF');
    assert.equal(model.readUInt32LE(8),model.length);
  }
  assert.equal(getVehicle('unknown'),null);
});

test('saved selection restores only catalog cars and survives blocked or corrupted storage',()=>{
  for(const definition of VEHICLES)assert.equal(restoreVehicle(memoryStorage(definition.id)),definition.id);
  for(const value of [null,'deleted-car','{"id":"bmw"}',''])assert.equal(restoreVehicle(memoryStorage(value)),'concept');
  const blocked={getItem(){throw new Error('Storage disabled');},setItem(){throw new Error('Storage disabled');}};
  assert.equal(restoreVehicle(blocked),'concept');
  const selection=new GarageSelection(blocked);
  assert.equal(selection.equip('nsx'),true);
  assert.equal(selection.equipped,'nsx');
});

test('browsing is a reversible preview; only equipping changes the persisted driving car',()=>{
  const storage=memoryStorage('roadster'),selection=new GarageSelection(storage);
  assert.equal(selection.preview,'roadster');
  assert.equal(selection.browse('bmw'),true);
  assert.equal(selection.preview,'bmw');
  assert.equal(selection.equipped,'roadster');
  assert.equal(storage.writes,0);
  selection.cancel();
  assert.equal(selection.preview,'roadster');
  selection.browse('nsx');
  assert.equal(selection.equip(),true);
  assert.equal(selection.equipped,'nsx');
  assert.equal(storage.value,'nsx');
  assert.equal(storage.writes,1);
  assert.equal(new GarageSelection(storage).equipped,'nsx');
  assert.equal(selection.browse('missing'),false);
  assert.equal(selection.equip('missing'),false);
  assert.equal(selection.preview,'nsx');
  assert.equal(selection.equipped,'nsx');
  assert.equal(storage.writes,1);
});

function makeGarage(){
  const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(45,16/9,.12,1900);
  const roomMaterial=new THREE.MeshStandardMaterial({emissive:0x334455});
  roomMaterial.emissiveMap=new THREE.Texture();
  const interior=new THREE.Mesh(new THREE.BoxGeometry(41,3.58,42),roomMaterial);
  interior.position.set(3,1.79,-2);
  const rides=Object.fromEntries(VEHICLES.map(({id})=>{
    const group=new THREE.Group(),mesh=new THREE.Mesh(new THREE.BoxGeometry(2,1.6,4.7),new THREE.MeshStandardMaterial());
    mesh.position.y=.8;group.add(mesh);return [id,{group}];
  }));
  return {garage:new GarageScene({scene,camera,rides,interior}),camera,rides,interior,roomMaterial};
}

test('garage stages exactly one preview without mutating or duplicating driving-car resources',()=>{
  const {garage,rides,interior,roomMaterial}=makeGarage();
  assert.equal(garage.count,4);
  assert.equal(garage.root.visible,false);
  for(const {id} of VEHICLES){
    assert.equal(garage.show(id),true);
    assert.equal(garage.selected,id);
    assert.deepEqual(Object.entries(garage.cars).filter(([,car])=>car.visible).map(([key])=>key),[id]);
    const preview=garage.cars[id].children[0],original=rides[id].group.children[0];
    assert.notEqual(preview,original);
    assert.equal(preview.geometry,original.geometry);
    assert.equal(preview.material,original.material);
    assert.deepEqual(rides[id].group.position.toArray(),[0,0,0]);
  }
  assert.equal(garage.select('missing'),false);
  assert.equal(garage.selected,'nsx');
  assert.equal(garage.cars.nsx.visible,true);
  assert.equal(interior.material,roomMaterial);
  assert.ok(interior.material.emissiveMap,'Baked garage emission must survive staging');
  assert.equal(interior.castShadow,false);
  garage.hide();
  assert.equal(garage.root.visible,false);
  assert.equal(garage.show('missing'),false);
  assert.equal(garage.root.visible,false);
});

test('garage camera frames the selected car on desktop and portrait and animation obeys visibility/reduced motion',()=>{
  const {garage,camera}=makeGarage();
  garage.show('concept');
  camera.updateMatrixWorld(true);
  const target=new THREE.Vector3(garage.position.x,.7,garage.position.z).project(camera);
  assert.ok(Math.abs(target.x)<1e-8&&Math.abs(target.y)<1e-8);
  assert.equal(camera.fov,45);
  assert.ok(camera.position.distanceTo(garage.position)<10);
  camera.aspect=.5;garage.frame();assert.equal(camera.fov,58);
  const original=garage.angle;garage.reduced=false;garage.update(1/60);assert.ok(garage.angle>original);
  const advanced=garage.angle;garage.update(NaN);garage.update(-1);assert.equal(garage.angle,advanced);
  garage.reduced=true;garage.update(.1);assert.equal(garage.angle,advanced);
  garage.reduced=false;garage.hide();garage.update(.1);assert.equal(garage.angle,advanced);
});

test('BMW display plinth is removed before driving bounds are measured and missing plinth fails safely',()=>{
  const root=new THREE.Group(),body=new THREE.Mesh(new THREE.BoxGeometry(2,1.5,4.4),new THREE.MeshBasicMaterial());
  body.position.y=.75;root.add(body);
  const plinth=new THREE.Mesh(new THREE.CylinderGeometry(10,10,1,16),new THREE.MeshBasicMaterial());
  plinth.name='Object_18';plinth.position.y=-.5;root.add(plinth);
  assert.ok(new THREE.Box3().setFromObject(root,true).getSize(new THREE.Vector3()).x>19);
  prepareVehicleGeometry(root,'bmw');
  assert.equal(plinth.parent,null);
  const bounds=new THREE.Box3().setFromObject(root,true).getSize(new THREE.Vector3());
  assert.ok(Math.abs(bounds.x-2)<1e-6&&Math.abs(bounds.z-4.4)<1e-6);
  assert.throws(()=>prepareVehicleGeometry(new THREE.Group(),'bmw'),/plinth/);
  assert.throws(()=>prepareVehicleGeometry(root,'missing'),/Unknown vehicle/);
});

test('NSX wheel pivots preserve authored wheel geometry in world space under nested transforms',()=>{
  const root=new THREE.Group();root.position.set(7,1,-3);
  // Isolate pivot reparenting from the catalog's intentional source-facing
  // correction: start at that orientation before capturing authored matrices.
  root.rotation.y=getVehicle('nsx').rotationY;
  const body=new THREE.Mesh(new THREE.BoxGeometry(1.8,1,4.43),new THREE.MeshBasicMaterial());body.position.y=.8;root.add(body);
  const nested=new THREE.Group();nested.rotation.set(.12,-.2,.08);nested.position.set(.1,.15,-.1);root.add(nested);
  const nodes=[];
  for(const [index,name]of ['Circle.001_9','Circle.002_19','Circle.003_20','Circle.004_21'].entries()){
    const node=new THREE.Group();node.name=name;node.position.set(index%2?-.8:.8,.3,index<2?-1.4:1.4);
    const mesh=new THREE.Mesh(new THREE.BoxGeometry(.2,.6,.6),new THREE.MeshBasicMaterial());mesh.position.set(.04,.07,-.03);node.add(mesh);nested.add(node);nodes.push(node);
  }
  root.updateMatrixWorld(true);
  const before=nodes.map(node=>({matrix:node.children[0].matrixWorld.clone(),center:new THREE.Box3().setFromObject(node,true).getCenter(new THREE.Vector3())}));
  const prepared=prepareVehicleGeometry(root,'nsx');root.updateMatrixWorld(true);
  assert.equal(prepared.wheels.length,4);
  assert.equal(prepared.wheels.filter(w=>w.front).length,2);
  for(let i=0;i<nodes.length;i++){
    const after=nodes[i].children[0].matrixWorld;
    for(let element=0;element<16;element++)assert.ok(Math.abs(after.elements[element]-before[i].matrix.elements[element])<1e-8);
    const pivot=prepared.wheels[i].node;
    assert.ok(pivot.getWorldPosition(new THREE.Vector3()).distanceTo(before[i].center)<1e-8);
    assert.ok(prepared.wheels[i].radius>0&&Number.isFinite(prepared.wheels[i].radius));
  }
});

test('NSX source front (+Z) is corrected to gameplay forward (-Z)',()=>{
  const sourceFront=new THREE.Vector3(0,0,1);
  sourceFront.applyAxisAngle(new THREE.Vector3(0,1,0),getVehicle('nsx').rotationY);
  assert.ok(Math.abs(sourceFront.x)<1e-8);
  assert.ok(Math.abs(sourceFront.z+1)<1e-8);
});
