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
export const WHEEL_STYLES=Object.freeze([{id:'stock',name:'Factory'},{id:'touring',name:'Satin alloy'},{id:'mesh',name:'Graphite'}].map(Object.freeze));
const KEY='speed-for-need-customization';
const valid=(items,id)=>items.some(item=>item.id===id);
export class CustomizationStore{
  constructor(storage){this.storage=storage;this.values={};try{const data=JSON.parse(storage?.getItem(KEY)||'{}');if(data&&typeof data==='object'&&!Array.isArray(data))for(const [id,value]of Object.entries(data))if(getVehicle(id)&&value&&typeof value==='object')this.values[id]={paint:valid(PAINTS,value.paint)?value.paint:'stock',wheels:valid(WHEEL_STYLES,value.wheels)?value.wheels:'stock'};}catch{}}
  get(id){const value=this.values[id];return {paint:value?.paint||'stock',wheels:value?.wheels||'stock'};}
  set(id,patch){if(!getVehicle(id)||!patch||Object.keys(patch).some(key=>!['paint','wheels'].includes(key))||('paint'in patch&&!valid(PAINTS,patch.paint))||('wheels'in patch&&!valid(WHEEL_STYLES,patch.wheels)))return false;this.values[id]={...this.get(id),...patch};try{this.storage?.setItem(KEY,JSON.stringify(this.values));}catch{}return true;}
}
export class VehicleAppearance{
  constructor(rides,storage){
    this.rides=rides;this.store=new CustomizationStore(storage);this.roots={};this.paint={};this.targets={};this.cache={};
    for(const [id,ride]of Object.entries(rides)){
      ride.group.updateWorldMatrix(true,true);this.roots[id]=[ride.group];this.cache[id]={};
      const definition=getVehicle(id),names=ride.paintMaterialNames||definition.paintMaterialNames||[],meshNames=definition.paintMeshNames;const cloned=new Map();
      ride.group.traverse(node=>{if(!node.isMesh||(meshNames&&!meshNames.includes(node.name)&&!node.userData.paint))return;const replace=material=>{if(!names.includes(material.name)&&!material.userData.bodyPaint)return material;if(!cloned.has(material)){const copy=material.clone();cloned.set(material,{material:copy,color:copy.color.clone()});}return cloned.get(material).material;};node.material=Array.isArray(node.material)?node.material.map(replace):replace(node.material);});
      this.paint[id]=[...cloned.values()];
      this.targets[id]=ride.wheels.map(wheel=>{
        for(const child of wheel.node.children)child.userData.wheelStyle='stock';
        return {name:wheel.node.name};
      });
    }
    for(const id of Object.keys(rides))this.apply(id,{});
  }
  get(id){return this.store.get(id);}
  registerRoot(id,root){if(!this.roots[id].includes(root))this.roots[id].push(root);this.applyWheels(id,this.get(id).wheels);}
  createStyle(id,style){
    if(this.cache[id][style])return this.cache[id][style];
    // Finish each car's own assembly, including its distinct front/rear fitment.
    // Never substitute another vehicle's wheels or recolour tyre rubber.
    const groups=this.rides[id].wheels.map((wheel,index)=>{
      const target=this.targets[id][index],group=new THREE.Group();group.userData.wheelStyle=style;group.name=`${target.name}_${style}`;
      for(const child of wheel.node.children.filter(c=>c.userData.wheelStyle==='stock')){
        const copy=child.clone(true);copy.visible=true;delete copy.userData.wheelStyle;
        copy.traverse(node=>{if(!node.isMesh)return;const finish=material=>{
          const name=material.name||'';if(/tyre|tire|rubber|tread|brake|disc/i.test(name)||(!/rim|alloy|chrome|wheel/i.test(name)&&!(material.metalness>.45)))return material;
          const m=material.clone();m.color.set(style==='touring'?'#aab2bb':'#454c55');m.metalness=.75;m.roughness=style==='touring'?.34:.46;return m;
        };node.material=Array.isArray(node.material)?node.material.map(finish):finish(node.material);});group.add(copy);
      }return group;
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
