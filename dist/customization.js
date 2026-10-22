import * as THREE from './vendor/three.module.js';
import {getVehicle} from './vehicles.js';
export const PAINTS=Object.freeze([
  {id:'stock',name:'Factory finish',color:null},
  {id:'red',name:'Signal red',color:'#c72932'},
  {id:'blue',name:'Atlantic blue',color:'#1c5ca7'},
  {id:'green',name:'Racing green',color:'#205e43'},
  {id:'silver',name:'Silver',color:'#aab4c0'},
  {id:'white',name:'Pearl white',color:'#e5e7e5'},
  {id:'black',name:'Obsidian',color:'#14171d'},
].map(Object.freeze));
export const WHEEL_STYLES=Object.freeze([{id:'stock',name:'Factory'},{id:'touring',name:'GT alloy'},{id:'mesh',name:'Classic mesh'}].map(Object.freeze));
const KEY='speed-for-need-customization';
const valid=(items,id)=>items.some(item=>item.id===id);
export class CustomizationStore{
  constructor(storage){this.storage=storage;this.values={};try{const data=JSON.parse(storage?.getItem(KEY)||'{}');if(data&&typeof data==='object'&&!Array.isArray(data))for(const [id,value]of Object.entries(data))if(getVehicle(id)&&value&&typeof value==='object')this.values[id]={paint:valid(PAINTS,value.paint)?value.paint:'stock',wheels:valid(WHEEL_STYLES,value.wheels)?value.wheels:'stock'};}catch{}}
  get(id){const value=this.values[id];return {paint:value?.paint||'stock',wheels:value?.wheels||'stock'};}
  set(id,patch){if(!getVehicle(id)||!patch||Object.keys(patch).some(key=>!['paint','wheels'].includes(key))||('paint'in patch&&!valid(PAINTS,patch.paint))||('wheels'in patch&&!valid(WHEEL_STYLES,patch.wheels)))return false;this.values[id]={...this.get(id),...patch};try{this.storage?.setItem(KEY,JSON.stringify(this.values));}catch{}return true;}
}
function transformedGeometry(source,matrix){
  const geometry=source.clone().applyMatrix4(matrix);
  if(matrix.determinant()<0){
    if(geometry.index){const array=geometry.index.array;for(let i=0;i<array.length;i+=3){const b=array[i+1];array[i+1]=array[i+2];array[i+2]=b;}}
    else for(const attribute of Object.values(geometry.attributes))for(let i=0;i<attribute.count;i+=3)for(let c=0;c<attribute.itemSize;c++){const a=(i+1)*attribute.itemSize+c,b=(i+2)*attribute.itemSize+c;const value=attribute.array[a];attribute.array[a]=attribute.array[b];attribute.array[b]=value;}
  }
  return geometry;
}
function wheelBounds(wheel){return new THREE.Box3().setFromObject(wheel.node,true);}
function bakeDonor(ride,wheel){
  const bounds=wheelBounds(wheel),center=bounds.getCenter(new THREE.Vector3()),size=bounds.getSize(new THREE.Vector3()),radius=Math.max(size.y,size.z)/2;
  const toUnit=new THREE.Matrix4().makeScale(1/radius,1/radius,1/radius).multiply(new THREE.Matrix4().makeTranslation(-center.x,-center.y,-center.z));
  const meshes=[];wheel.node.traverse(node=>{if(node.isMesh){const matrix=new THREE.Matrix4().multiplyMatrices(toUnit,node.matrixWorld);meshes.push({geometry:transformedGeometry(node.geometry,matrix),material:node.material,castShadow:node.castShadow,receiveShadow:node.receiveShadow});}});
  return {meshes,width:size.x/radius};
}
export class VehicleAppearance{
  constructor(rides,storage){
    this.rides=rides;this.store=new CustomizationStore(storage);this.roots={};this.paint={};this.targets={};this.donors={};this.cache={};
    for(const [id,ride]of Object.entries(rides)){
      ride.group.updateWorldMatrix(true,true);this.roots[id]=[ride.group];this.cache[id]={};
      const definition=getVehicle(id),names=ride.paintMaterialNames||definition.paintMaterialNames||[],meshNames=definition.paintMeshNames;const cloned=new Map();
      ride.group.traverse(node=>{if(!node.isMesh||(meshNames&&!meshNames.includes(node.name)&&!node.userData.paint))return;const replace=material=>{if(!names.includes(material.name)&&!material.userData.bodyPaint)return material;if(!cloned.has(material)){const copy=material.clone();cloned.set(material,{material:copy,color:copy.color.clone()});}return cloned.get(material).material;};node.material=Array.isArray(node.material)?node.material.map(replace):replace(node.material);});
      this.paint[id]=[...cloned.values()];
      this.targets[id]=ride.wheels.map(wheel=>{
        wheel.node.updateWorldMatrix(true,true);const bounds=wheelBounds(wheel),center=bounds.getCenter(new THREE.Vector3()),size=bounds.getSize(new THREE.Vector3());
        const side=ride.group.worldToLocal(center.clone()).x<0?-1:1;
        for(const child of wheel.node.children)child.userData.wheelStyle='stock';
        return {name:wheel.node.name,inverse:wheel.node.matrixWorld.clone().invert(),center,size,side};
      });
    }
    for(const [style,id]of [['touring','concept'],['mesh','nsx']]){
      const ride=rides[id];ride.group.updateWorldMatrix(true,true);this.donors[style]={};
      for(const side of [-1,1]){const wheel=ride.wheels.find(w=>w.front&&Math.sign(ride.group.worldToLocal(w.node.getWorldPosition(new THREE.Vector3())).x)===side);if(!wheel)throw new Error(`Missing ${id} donor wheel`);this.donors[style][side]=bakeDonor(ride,wheel);}
    }
    for(const id of Object.keys(rides))this.apply(id,{});
  }
  get(id){return this.store.get(id);}
  registerRoot(id,root){if(!this.roots[id].includes(root))this.roots[id].push(root);this.applyWheels(id,this.get(id).wheels);}
  createStyle(id,style){
    if(this.cache[id][style])return this.cache[id][style];
    const groups=this.targets[id].map(target=>{
      const donor=this.donors[style][target.side],radius=Math.max(target.size.y,target.size.z)/2;
      const placement=target.inverse.clone().multiply(new THREE.Matrix4().makeTranslation(target.center.x,target.center.y,target.center.z)).multiply(new THREE.Matrix4().makeScale(target.size.x/donor.width,radius,radius));
      const group=new THREE.Group();group.userData.wheelStyle=style;group.name=`${target.name}_${style}`;
      for(const part of donor.meshes){const mesh=new THREE.Mesh(transformedGeometry(part.geometry,placement),part.material);mesh.castShadow=part.castShadow;mesh.receiveShadow=part.receiveShadow;group.add(mesh);}return group;
    });this.cache[id][style]=groups;return groups;
  }
  applyWheels(id,style){
    const groups=style==='stock'?null:this.createStyle(id,style);
    for(const root of this.roots[id])for(let i=0;i<this.targets[id].length;i++){
      const target=this.targets[id][i],pivot=root.getObjectByName(target.name);if(!pivot)throw new Error(`Missing wheel pivot ${target.name}`);
      if(groups&&!pivot.children.some(child=>child.userData.wheelStyle===style))pivot.add(groups[i].clone(true));
      for(const child of pivot.children)if(child.userData.wheelStyle)child.visible=child.userData.wheelStyle===style;
    }
  }
  apply(id,patch){
    if(!this.store.set(id,patch))return false;const options=this.get(id),finish=PAINTS.find(p=>p.id===options.paint);
    for(const entry of this.paint[id])entry.material.color.copy(finish.color?new THREE.Color(finish.color):entry.color);
    this.applyWheels(id,options.wheels);return true;
  }
}
