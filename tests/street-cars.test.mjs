import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';
import {planParkedCars,kerbLayout,STREET_CAR_MODELS,STREET_CAR_ASSETS,TRAFFIC_EXTRA,trafficPerRoute} from '../dist/street-cars.js';
import {STUNT_AREA} from '../dist/stunts.js';
import {DESTINATIONS,sunsetDistance,SUNSET} from '../dist/map-layout.js';

const seeded=s=>()=>{s=(s*1664525+1013904223)>>>0;return s/4294967296;};
const roads={grid:{x:[-450,-300,-150,0,150,300,450],z:[-600,-450,-300,-150,0,150,300,450,600]}};
// Oriented-rectangle overlap via separating axis test (cars are boxes in the ground plane).
function corners(c){const s=Math.sin(c.heading),k=Math.cos(c.heading),f=[-s,-k],r=[k,-s];return [[1,1],[1,-1],[-1,-1],[-1,1]].map(([a,b])=>[c.x+f[0]*a*c.length/2+r[0]*b*c.width/2,c.z+f[1]*a*c.length/2+r[1]*b*c.width/2]);}
function overlap(a,b){const A=corners(a),B=corners(b);for(const poly of [A,B])for(let i=0;i<4;i++){const p=poly[i],q=poly[(i+1)%4],n=[q[1]-p[1],p[0]-q[0]];const pa=A.map(v=>v[0]*n[0]+v[1]*n[1]),pb=B.map(v=>v[0]*n[0]+v[1]*n[1]);if(Math.max(...pa)<=Math.min(...pb)||Math.max(...pb)<=Math.min(...pa))return false;}return true;}

for(const map of ['coast'])test(`${map}: parked cars stay on kerbs, clear of intersections, spawns, gates, stunt park and each other`,()=>{
 const grid=roads.grid,layout=kerbLayout(map);
 for(let seed=1;seed<=25;seed++){
  const cars=planParkedCars({map,random:seeded(seed*7919)});
  assert.ok(cars.length>=120&&cars.length<=250,`${map} count ${cars.length}`);
  for(const c of cars){
   assert.ok(Number.isFinite(c.x)&&Number.isFinite(c.z)&&Number.isFinite(c.heading));
   const k=c.kerb,lateral=(k.axis==='z'?c.x:c.z)-k.c,along=k.axis==='z'?c.z:c.x;
   // Inside the road, against the kerb, outside the travel lanes (traffic runs at ±4.3 m).
   assert.ok(Math.abs(lateral)+c.width/2<=k.half+1e-9,'not on the sidewalk');assert.ok(Math.abs(lateral)-c.width/2>=4.3+1.3,'clear of the traffic lane');
   assert.ok(along-c.length/2>=k.from-1e-9&&along+c.length/2<=k.to+1e-9,'inside its kerb stretch');
   // No intersection box (crossing road half-width + crosswalk band).
   for(const x of grid.x)for(const z of grid.z){const hx=map==='coast'&&x===0?17:12,hz=map==='coast'&&z===-300?17:12;assert.ok(!(Math.abs(c.x-x)<hx+10&&Math.abs(c.z-z)<hz+10),`car at ${c.x.toFixed(1)},${c.z.toFixed(1)} inside intersection ${x},${z}`);}
   for(const a of layout.avoid)assert.ok(Math.hypot(c.x-a.x,c.z-a.z)>=a.r,`${a.why} too close`);
   {assert.ok(!(c.x>STUNT_AREA.left-4&&c.x<STUNT_AREA.right+4&&c.z>STUNT_AREA.top-4&&c.z<STUNT_AREA.bottom+4),'stunt park');for(const d of DESTINATIONS)assert.ok(Math.hypot(c.x-d.x,c.z-d.z)>=30,'spawn point');}
   if(map==='coast')assert.ok(sunsetDistance(c.x,c.z)>SUNSET.width/2+SUNSET.sidewalk,'sunset diagonal');
  }
  const bins=new Map();for(const c of cars){const key=Math.floor(c.x/20)+','+Math.floor(c.z/20);(bins.get(key)||bins.set(key,[]).get(key)).push(c);}
  for(const c of cars){const cx=Math.floor(c.x/20),cz=Math.floor(c.z/20);for(let i=-1;i<=1;i++)for(let j=-1;j<=1;j++)for(const o of bins.get((cx+i)+','+(cz+j))||[])if(o!==c)assert.ok(!overlap(c,o),'parked cars overlap');}
 }
});

test('the game seed places 150-250 parked cars on the big maps and is deterministic',()=>{
 for(const map of ['coast']){const a=planParkedCars({map,random:seeded(5279)}),b=planParkedCars({map,random:seeded(5279)});assert.ok(a.length>=150&&a.length<=250,`${map}: ${a.length}`);assert.deepEqual(a.map(c=>[c.x,c.z,c.model]),b.map(c=>[c.x,c.z,c.model]));}
});

test('parked cars face along the road (right-hand kerbside)',()=>{
 for(const c of planParkedCars({map:'coast',random:seeded(3)})){const want=c.kerb.axis==='z'?(c.kerb.side>0?0:Math.PI):(c.kerb.side>0?-Math.PI/2:Math.PI/2);assert.ok(Math.abs(Math.atan2(Math.sin(c.heading-want),Math.cos(c.heading-want)))<.03);}
});

test('car kit assets ship with provenance; traffic density rises ~1.5x',()=>{
 const source=JSON.parse(fs.readFileSync(new URL('../dist/assets/cars/cars-source.json',import.meta.url)));assert.equal(source.license,'CC0-1.0');
 for(const name of STREET_CAR_ASSETS){const file=name.replace('cars/','')+'.glb';assert.ok(fs.existsSync(new URL(`../dist/assets/${name}.glb`,import.meta.url)),file);assert.ok(source.assets.some(a=>a.file===file),`${file} recorded`);}
 assert.ok(fs.existsSync(new URL('../dist/assets/cars/Textures/colormap.png',import.meta.url)),'shared colormap present');
 assert.ok(STREET_CAR_MODELS.length>=8&&TRAFFIC_EXTRA.every(([,l])=>l>=4&&l<=5.6));
 const before=2*9+2*6+2*4,after=[0,1,2,3,4,5].reduce((s,r)=>s+trafficPerRoute(r),0);assert.ok(after/before>=1.4&&after/before<=1.6);
 assert.ok(1+after+4<=96,'render-state slots');
});

test('a parked car is a light dynamic body: asleep at rest, shoved by the player, settles again',async()=>{
 const {createDrivingWorld}=await import('../dist/physics.js');const {makeShoveable}=await import('../dist/street-cars.js');
 const world=createDrivingWorld();const car={width:2,length:4.3};const parked=world.addBox({x:0,z:-12,width:car.width,length:car.length,userData:{kind:'parked-car'}});parked.maxY=1.6;makeShoveable(parked,car);
 assert.equal(parked.body.isDynamic(),true);assert.ok(Math.abs(parked.body.getMass()-1150)<1);assert.equal(parked.body.isAwake(),false);
 const player=world.addVehicle({x:0,z:0,heading:0,width:1.9,length:4.5,mass:1450});player.setControls({throttle:1});
 for(let i=0;i<240;i++)world.step(1/120);
 assert.ok(parked.z<-12.5,`shoved forward (z=${parked.z.toFixed(2)})`);
 player.setControls({throttle:0,brake:1});player.setPose({x:30,z:30,heading:0});for(let i=0;i<120*6;i++)world.step(1/120);
 assert.equal(parked.body.isAwake(),false,'sleeps once it stops');
});
