// This is game balancing, not claimed manufacturer performance data.
// Car geometry, origin, license and node observations: GARAGE_RESEARCH.md.
export const VEHICLES=Object.freeze([
  {id:'concept',asset:'concept-gt',name:'Concept GT',category:'TOURING',era:'MODERN CONCEPT',description:'The original coastal all-rounder. Smooth launch, settled grip, and a generous overdrive.',length:4.7,rotationY:Math.PI,profile:'concept',tuning:{mass:1450,wheelbase:2.7,maxSpeed:48,boostSpeed:61,acceleration:8.2,grip:22,steerAngle:.62}},
  {id:'roadster',asset:'roadster',name:'Tesla Roadster',category:'ELECTRIC',era:'ORIGINAL RIDE',description:'The car that started it. A heavier, planted chassis with the longest overdrive stride.',length:4.8,rotationY:-Math.PI/2,profile:'static',tuning:{mass:1700,wheelbase:2.7,maxSpeed:51,boostSpeed:65,acceleration:8.2,grip:22,steerAngle:.62}},
  {id:'bmw',asset:'bmw-e36-m3',name:'BMW E36 M3',category:'STREET CLASSIC',era:'CLASSIC COUPE',description:'A compact classic for the city grid. Progressive power and responsive cornering.',length:4.43,rotationY:Math.PI,profile:'bmw',tuning:{mass:1450,wheelbase:2.7,maxSpeed:45,boostSpeed:58,acceleration:7.6,grip:22,steerAngle:.64}},
  {id:'nsx',asset:'honda-nsx',name:'Honda NSX 1990',category:'ANALOG SPORT',era:'NINETIES ICON',description:'Low, light on its feet, and eager through the bends. Built for a quick coastal sprint.',length:4.43,rotationY:Math.PI,profile:'nsx',tuning:{mass:1370,wheelbase:2.53,maxSpeed:49,boostSpeed:62,acceleration:8.5,grip:23,steerAngle:.62}},
].map(v=>Object.freeze({...v,tuning:Object.freeze(v.tuning)})));
export const VEHICLE_STORAGE_KEY='speed-for-need-vehicle';
export function getVehicle(id){return VEHICLES.find(v=>v.id===id)||null;}
export function restoreVehicle(storage){try{const id=storage?.getItem(VEHICLE_STORAGE_KEY);return getVehicle(id)?id:'concept';}catch{return'concept';}}
export class GarageSelection {
  constructor(storage){this.storage=storage;this.equipped=restoreVehicle(storage);this.preview=this.equipped;}
  browse(id){if(!getVehicle(id))return false;this.preview=id;return true;}
  cancel(){this.preview=this.equipped;}
  equip(id=this.preview){if(!getVehicle(id))return false;this.equipped=this.preview=id;try{this.storage?.setItem(VEHICLE_STORAGE_KEY,id);}catch{}return true;}
}
export function tuningBars(definition){const max=key=>Math.max(...VEHICLES.map(v=>v.tuning[key]));return {pace:Math.round(definition.tuning.maxSpeed/max('maxSpeed')*100),launch:Math.round(definition.tuning.acceleration/max('acceleration')*100),agility:Math.round((definition.tuning.grip/definition.tuning.wheelbase)/Math.max(...VEHICLES.map(v=>v.tuning.grip/v.tuning.wheelbase))*100)};}
