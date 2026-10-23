// Coast-only lot dressing. Own RNG: never consumes the world/building RNG.
// Rendering reuses StreetProps instances and the existing parked-car BatchedMesh.
import {seeded,roadClearance,PROP_TYPES} from './street-props.js';
import {clearOfSunset,DESTINATIONS} from './map-layout.js';
import {STUNT_AREA} from './stunts.js';
import {BOOST_PADS} from './boost-pads.js';
import {layoutFor} from './activities.js';
import {STREET_CAR_MODELS,PAINTS} from './street-cars.js';
export const LOT_TREE_TYPES=['lot-palm','lot-palm-short'];
export const lotRect=(x,z,width,length)=>({minX:x-width/2,maxX:x+width/2,minZ:z-length/2,maxZ:z+length/2});
const overlaps=(a,b,m=0)=>a.maxX+m>b.minX&&a.minX-m<b.maxX&&a.maxZ+m>b.minZ&&a.minZ-m<b.maxZ;
const boundsOf=b=>({minX:b.min.x,maxX:b.max.x,minZ:b.min.z,maxZ:b.max.z});
const within=(b,r,m=0)=>b.minX>=r.minX+m&&b.maxX<=r.maxX-m&&b.minZ>=r.minZ+m&&b.maxZ<=r.maxZ-m;
export function planLotFill({map='coast',lots=[],obstacles=[],interactiveProps=[],parkPlots=[],targetCars=65,random=seeded(28611)}={}){
 const items=[],cars=[],surfaces=[],containers=[],occupied=[],courts=[];
 if(map!=='coast')return {items,cars,surfaces,containers,courts,stats:{trees:0,props:0,cars:0}};
 const activity=layoutFor(map),noGo=[...activity.zones,{minX:STUNT_AREA.left-6,maxX:STUNT_AREA.right+6,minZ:STUNT_AREA.top-6,maxZ:STUNT_AREA.bottom+6},...parkPlots.map(p=>lotRect(p.x,p.z,p.width+8,p.length+8))];
 const circles=[...DESTINATIONS.map(d=>({...d,r:30})),...BOOST_PADS.map(p=>({...p,r:16})),...activity.packages.map(p=>({...p,r:8})),{x:171,z:165,r:12}];
 const buildingBoxes=lots.filter(l=>l.bounds).map(l=>boundsOf(l.bounds));
 // Group compound actors once; never scan tens of thousands of building fixtures per candidate.
 const staticBoxes=[];for(const o of obstacles)if(o.actor?.userData?.kind!=='building'&&o.box.min.y<3)staticBoxes.push(boundsOf(o.box));
 const existing=interactiveProps.map(p=>lotRect(p.x,p.z,(PROP_TYPES[p.type]?.r||.6)*2+1,(PROP_TYPES[p.type]?.r||.6)*2+1));
 function safe(b,lot){
  const x=(b.minX+b.maxX)/2,z=(b.minZ+b.maxZ)/2,r=Math.hypot(b.maxX-b.minX,b.maxZ-b.minZ)/2;
  if(!within(b,lot,2)||roadClearance(map,x,z)<6+r||!clearOfSunset(b,2))return false;
  if(Math.abs(x-lot.blockX)<8+(b.maxX-b.minX)/2||Math.abs(z-lot.blockZ)<8+(b.maxZ-b.minZ)/2)return false;
  return !noGo.some(a=>overlaps(b,a))&&!circles.some(a=>Math.hypot(x-a.x,z-a.z)<a.r+r)&&!buildingBoxes.some(a=>overlaps(b,a,3))&&!staticBoxes.some(a=>overlaps(b,a,1))&&!existing.some(a=>overlaps(b,a,.5))&&!occupied.some(a=>overlaps(b,a,.6));
 }
 const order=lots.map(l=>({l,key:random()})).sort((a,b)=>a.key-b.key).map(o=>o.l);
 const points=(l,inset)=>{const out=[];for(const x of [l.minX+inset,l.maxX-inset])for(const z of [l.minZ+inset,l.maxZ-inset])out.push({x,z});return out;};
 const defs=STREET_CAR_MODELS.filter(m=>m.paint&&m.traffic&&m.name!=='cars/truck');
 for(const lot of order){
  if(cars.length>=targetCars)break;
  for(const heading of [0,Math.PI/2]){let placed=false;
   for(const p of points(lot,8)){
    const turned=heading!==0,b=lotRect(p.x,p.z,turned?10.5:8.6,turned?8.6:10.5);if(!safe(b,lot))continue;
    const count=Math.min(2,targetCars-cars.length),court={...b,lot,district:lot.district,heading};courts.push(court);occupied.push(b);surfaces.push({...b,material:'asphalt',kind:'court'});
    for(let i=0;i<count;i++){const def=defs[Math.floor(random()*defs.length)],[width,height,length]=def.size.map(n=>n*1.5),side=(i-(count-1)/2)*3.5,c=Math.cos(heading),s=Math.sin(heading);
     cars.push({x:p.x+c*side+s*1.1,z:p.z-s*side+c*1.1,heading,width,height,length,model:def.name,paint:PAINTS[Math.floor(random()*PAINTS.length)],lot:true,ground:.14,district:lot.district});
    }
    // Flush bay lines, no raised kerbs or row-sized invisible collider.
    for(const side of [-3.5,0,3.5]){const x=p.x+Math.cos(heading)*side,z=p.z-Math.sin(heading)*side;surfaces.push({...lotRect(x,z,turned?6:.10,turned?.10:6),material:'white',kind:'paint'});}
    placed=true;break;
   }if(placed)break;
  }
 }
 function add(type,p,lot,w,l=w,extra={}){const b=lotRect(p.x,p.z,w,l);if(!safe(b,lot))return false;occupied.push(b);items.push({type,x:p.x,z:p.z,rot:random()*Math.PI*2,ground:.105,lot:true,district:lot.district,...extra});return true;}
 for(const lot of lots){
  const green=lot.district!=='Arts & Warehouse',target=green?4:2;
  const candidates=[...points(lot,6),...points(lot,14),{x:(lot.minX+lot.maxX)/2,z:lot.minZ+6},{x:(lot.minX+lot.maxX)/2,z:lot.maxZ-6}];
  let trees=0;for(const p of candidates)if(trees<target&&add(LOT_TREE_TYPES[trees%2],p,lot,5.4))trees++;
  // A small seating/yard cluster per lot: authored props remain shoveable/knockable.
  const types=lot.district==='Arts & Warehouse'?['dumpster','fence','barrier','cone']:lot.district==='Palm Gardens'?['bench','chair','trashcan']:['bench','planter','trashcan'];
  let count=0;for(const p of points(lot,11).concat(points(lot,17))){if(count>=types.length)break;const type=types[count];if(add(type,p,lot,type==='bench'?2.2:type==='dumpster'?2.4:2.1,2.1,{rot:0}))count++;}
  if(lot.district==='Arts & Warehouse'&&containers.length<18){
   for(const p of points(lot,8)){const b=lotRect(p.x,p.z,4,8);if(!safe(b,lot))continue;occupied.push(b);containers.push({...p,rot:0,lot});surfaces.push({...lotRect(p.x,p.z,5,9),material:'plaza',kind:'yard'});break;}
  }else if(green&&count){
   const item=items[items.length-1];if(item?.lot)surfaces.push({...lotRect(item.x,item.z,4,4),material:lot.district==='Pacific Boardwalk'?'sand':'plaza',kind:'seating'});
  }
 }
 return {items,cars,surfaces,containers,courts,stats:{trees:items.filter(i=>LOT_TREE_TYPES.includes(i.type)).length,props:items.filter(i=>!LOT_TREE_TYPES.includes(i.type)).length,cars:cars.length,containers:containers.length,lots:lots.length}};
}
