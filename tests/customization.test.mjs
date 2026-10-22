import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../dist/vendor/three.module.js';
import {CustomizationStore,VehicleAppearance,PAINTS,WHEEL_STYLES} from '../dist/customization.js';
import {VEHICLES} from '../dist/vehicles.js';
import {prepareVehicleGeometry} from '../dist/vehicle-models.js';
import {loadVehicleGeometry} from './helpers/vehicle-glb.mjs';
function storage(){let value=null;return {getItem:()=>value,setItem:(_,next)=>{value=next;}};}
function models(){
  const sharedPaint=new THREE.MeshStandardMaterial({color:'#cacaca'});sharedPaint.name='Body paint';
  const black=new THREE.MeshStandardMaterial({color:'#101010'});black.name='Tyre';
  const rides={};for(const {id}of VEHICLES){
    const group=new THREE.Group(),body=new THREE.Mesh(new THREE.BoxGeometry(1.8,1,4),sharedPaint);body.position.y=.8;if(id==='porsche'){body.name='Object_8';body.userData.paint=true;}group.add(body);
    const glass=new THREE.Mesh(new THREE.BoxGeometry(1.5,.4,1.5),black);glass.position.y=1.4;group.add(glass);
    const wheels=[];for(const [i,[x,z]]of [[.9,-1.3],[-.9,-1.3],[.9,1.3],[-.9,1.3]].entries()){
      const node=new THREE.Group();node.name=`wheel_${i}`;node.position.set(x,.35,z);const tyre=new THREE.Mesh(new THREE.BoxGeometry(.3,.7,.7),black);node.add(tyre);
      // Different source assemblies make style swaps measurable independently of colour.
      const count=id==='nsx'?2:1;for(let n=0;n<count;n++){const rim=new THREE.Mesh(new THREE.BoxGeometry(.32,.4-n*.1,.4-n*.1),new THREE.MeshStandardMaterial({color:0xaaaaaa}));node.add(rim);}
      group.add(node);wheels.push({node,front:i<2,base:node.quaternion.clone()});
    }
    rides[id]={group,wheels,paintMaterialNames:['Body paint']};
  }return {rides,sharedPaint,black};
}
test('customization validates choices, persists per car, and tolerates denied/corrupt storage',()=>{
  const saved=storage(),store=new CustomizationStore(saved);
  assert.equal(store.set('bmw',{paint:'blue',wheels:'mesh'}),true);
  assert.deepEqual(new CustomizationStore(saved).get('bmw'),{paint:'blue',wheels:'mesh'});
  assert.deepEqual(store.get('nsx'),{paint:'stock',wheels:'stock'});
  for(const [id,patch]of [['unknown',{paint:'blue'}],['bmw',{paint:'bad'}],['bmw',{wheels:'bad'}],['bmw',{mass:2}]])assert.equal(store.set(id,patch),false);
  const denied={getItem(){throw Error();},setItem(){throw Error();}};
  assert.equal(new CustomizationStore(denied).set('concept',{paint:'red'}),true);
  for(const value of ['null','[]','"bad"','{','{"nsx":{"paint":"bad","wheels":"bad"}}'])assert.deepEqual(new CustomizationStore({getItem:()=>value}).get('nsx'),{paint:'stock',wheels:'stock'});
});
test('paint changes the selected body, shares across its views, and preserves tyres, glass and other cars',()=>{
  const {rides,sharedPaint,black}=models(),manager=new VehicleAppearance(rides,storage());
  const clone=rides.bmw.group.clone(true);manager.registerRoot('bmw',clone);
  assert.ok(manager.paint.bmw.length>0);const factory=rides.bmw.group.children[0].material.color.clone();
  manager.apply('bmw',{paint:'blue'});
  assert.equal(rides.bmw.group.children[0].material.color.getHexString(),new THREE.Color(PAINTS.find(p=>p.id==='blue').color).getHexString());
  assert.equal(clone.children[0].material,rides.bmw.group.children[0].material);
  assert.ok(sharedPaint.color.equals(factory));assert.equal(black.color.getHexString(),'101010');
  assert.ok(rides.nsx.group.children[0].material.color.equals(factory));
  manager.apply('bmw',{paint:'stock'});assert.ok(rides.bmw.group.children[0].material.color.equals(factory));
});
test('fixture wheel assemblies swap on all views while fitting original bounds and preserving stock parts',()=>{
  const {rides}=models(),manager=new VehicleAppearance(rides,storage());const id='roadster',ride=rides[id];const preview=ride.group.clone(true);manager.registerRoot(id,preview);
  const stockBounds=ride.wheels.map(w=>new THREE.Box3().setFromObject(w.node,true));
  for(const style of WHEEL_STYLES){manager.apply(id,{wheels:style.id});
    for(const root of [ride.group,preview])for(let i=0;i<ride.wheels.length;i++){
      const pivot=root.getObjectByName(ride.wheels[i].node.name),visible=pivot.children.filter(n=>n.visible);
      assert.ok(visible.length>0);assert.ok(visible.every(n=>n.userData.wheelStyle===style.id));
      if(style.id!=='stock'){
        const box=new THREE.Box3().setFromObject(visible[0],true),original=stockBounds[i];
        assert.ok(box.getCenter(new THREE.Vector3()).distanceTo(original.getCenter(new THREE.Vector3()))<1e-6);
        assert.ok(box.getSize(new THREE.Vector3()).distanceTo(original.getSize(new THREE.Vector3()))<1e-6);
      }
    }
  }
  manager.apply(id,{wheels:'touring'});const touring=manager.cache[id].touring[0].children.length;
  manager.apply(id,{wheels:'mesh'});assert.notEqual(manager.cache[id].mesh[0].children.length,touring);
  const cached=manager.cache[id].mesh;manager.apply(id,{wheels:'stock'});manager.apply(id,{wheels:'mesh'});assert.equal(manager.cache[id].mesh,cached);
});

test('all five shipped GLBs support body-only paint and bounded authored wheel swaps',async()=>{
  const rides={};for(const def of VEHICLES){
    const source=await loadVehicleGeometry(def.asset),rig=prepareVehicleGeometry(source,def.id);let bounds=new THREE.Box3().setFromObject(source,true),size=bounds.getSize(new THREE.Vector3());
    const group=new THREE.Group();group.add(source);source.scale.multiplyScalar(def.length/size.z);source.updateMatrixWorld(true);bounds.setFromObject(source,true);const center=bounds.getCenter(new THREE.Vector3());source.position.x-=center.x;source.position.z-=center.z;source.position.y-=bounds.min.y;group.updateMatrixWorld(true);
    rides[def.id]={group,wheels:rig.wheels,paintMaterialNames:rig.paintMaterialNames};
  }
  const manager=new VehicleAppearance(rides,storage());
  for(const def of VEHICLES){const id=def.id,ride=rides[id];assert.ok(manager.paint[id].length>0,`${id} needs paint targets`);
    const paintMaterials=new Set(manager.paint[id].map(item=>item.material)),other=[];ride.group.traverse(node=>{if(node.isMesh)for(const material of Array.isArray(node.material)?node.material:[node.material])if(!paintMaterials.has(material))other.push([material,material.color.clone()]);});
    manager.apply(id,{paint:'blue'});for(const item of manager.paint[id])assert.equal(item.material.color.getHexString(),'1c5ca7');for(const [material,color]of other)assert.ok(material.color.equals(color),`${id} changed non-body material`);
    const view=ride.group.clone(true);manager.registerRoot(id,view);
    const original=ride.wheels.map(w=>new THREE.Box3().setFromObject(w.node,true));
    for(const style of ['touring','mesh']){manager.apply(id,{wheels:style});for(let i=0;i<ride.wheels.length;i++){
      const pivot=ride.wheels[i].node,part=pivot.children.find(c=>c.userData.wheelStyle===style),actual=new THREE.Box3().setFromObject(part,true);
      assert.ok(actual.getCenter(new THREE.Vector3()).distanceTo(original[i].getCenter(new THREE.Vector3()))<1e-4,`${id}/${style}/${i} off-center`);
      assert.ok(actual.getSize(new THREE.Vector3()).distanceTo(original[i].getSize(new THREE.Vector3()))<.02,`${id}/${style}/${i} changed wheel fit`);
      const cloned=view.getObjectByName(pivot.name);assert.ok(cloned.children.filter(c=>c.visible).every(c=>c.userData.wheelStyle===style));
    }}manager.apply(id,{wheels:'stock',paint:'stock'});
  }
});
