import test from 'node:test';
import assert from 'node:assert/strict';
import {placePackages,ACTIVITY_LAYOUTS,layoutFor,ActivityStore,SpeedTraps,DriftZones,Collectibles,trapStars,describeEvent,inZone,driftAngle,TRAP_STARS,PICKUP_RADIUS} from '../dist/activities.js';
import {readFileSync as readSource} from 'node:fs';
import {WORLD} from '../dist/coast-config.js';
import {STUNT_AREA} from '../dist/stunts.js';

const memory=()=>{const m=new Map();return {getItem:k=>m.has(k)?m.get(k):null,setItem:(k,v)=>m.set(k,String(v)),removeItem:k=>m.delete(k),m};};
const trap=layoutFor('coast').traps[0];
// Drive straight along a trap's road axis through its line at constant speed.
function driveThrough(traps,t,speed,{lateral=0,from=-30,to=30,step=1}={}){
  let hit=null;for(let s=from;step>0?s<=to:s>=to;s+=step){const e=traps.update(t.x+t.dx*s+t.dz*lateral,t.z+t.dz*s-t.dx*lateral,speed);if(e)hit={...e};}return hit;
}

test('Coast retains its six traps, three drift zones and 25 packages',()=>{
  for(const map of ['coast']){const l=ACTIVITY_LAYOUTS[map];assert.equal(l.traps.length,6,map);assert.equal(l.zones.length,3,map);assert.equal(l.packages.length,25,map);}
  assert.equal(layoutFor('unknown'),ACTIVITY_LAYOUTS.coast);
});

test('layouts: every point lies inside its map bounds, trap axes are unit vectors and ids are unique',()=>{
  for(const [map,l] of Object.entries(ACTIVITY_LAYOUTS)){
    const b=WORLD;
    for(const p of [...l.traps,...l.packages])assert.ok(p.x>b.left&&p.x<b.right&&p.z>b.top&&p.z<b.bottom,`${map} ${p.x},${p.z}`);
    for(const z of l.zones)assert.ok(z.minX<z.maxX&&z.minZ<z.maxZ&&z.minX>=b.left-20&&z.maxX<=b.right+20,`${map} zone ${z.id}`);
    for(const t of l.traps)assert.ok(Math.abs(Math.hypot(t.dx,t.dz)-1)<1e-9,t.id);
    assert.equal(new Set(l.traps.map(t=>t.id)).size,l.traps.length);
    // Packages are spread out: no two within 20 m.
    for(let i=0;i<l.packages.length;i++)for(let j=i+1;j<l.packages.length;j++)assert.ok(Math.hypot(l.packages[i].x-l.packages[j].x,l.packages[i].z-l.packages[j].z)>20,`${map} ${i}/${j}`);
  }
});

test('layouts: grid-map traps sit on a road and drift zones do not overlap the stunt park',()=>{
  for(const t of ACTIVITY_LAYOUTS.coast.traps.filter(t=>t.id!=='sunset'))assert.ok(WORLD.roadsX.some(x=>Math.abs(t.x-x)<1&&t.dx===0)||WORLD.roadsZ.some(z=>Math.abs(t.z-z)<1&&t.dz===0),t.id);
  for(const z of ACTIVITY_LAYOUTS.coast.zones)assert.ok(z.maxX<STUNT_AREA.left||z.minX>STUNT_AREA.right||z.maxZ<STUNT_AREA.top||z.minZ>STUNT_AREA.bottom,z.id);
});

test('speed trap: star rating thresholds',()=>{
  assert.equal(trapStars(TRAP_STARS[0]-1),0);assert.equal(trapStars(TRAP_STARS[0]),1);assert.equal(trapStars(TRAP_STARS[1]),2);assert.equal(trapStars(400),3);
});

test('speed trap: crossing records km/h, stars and a per-map personal best',()=>{
  const storage=memory(),store=new ActivityStore('coast',storage),traps=new SpeedTraps([trap],store);
  const first=driveThrough(traps,trap,45);
  assert.equal(first.kmh,162);assert.equal(first.stars,2);assert.equal(first.newBest,true);assert.equal(first.best,162);
  const slower=driveThrough(traps,trap,30,{from:30,to:-30,step:-1});
  assert.equal(slower.kmh,108);assert.equal(slower.newBest,false);assert.equal(slower.best,162);
  assert.match(describeEvent(slower),/BEST 162/);
  // Saved under a map-specific key and reloaded.
  assert.ok(storage.getItem('speed-for-need-activities-coast'));assert.equal(storage.getItem('speed-for-need-activities-default'),null);
  assert.equal(new SpeedTraps([trap],new ActivityStore('coast',storage)).best(trap.id),162);
});

test('speed trap: no trigger off the road, on the first frame or after a reset (teleport)',()=>{
  const traps=new SpeedTraps([trap],null);
  assert.equal(driveThrough(traps,trap,40,{lateral:30}),null);
  const fresh=new SpeedTraps([trap],null);assert.equal(fresh.update(trap.x,trap.z+1,40),null);
  const t2=new SpeedTraps([trap],null);t2.update(trap.x-trap.dx*5,trap.z-trap.dz*5,40);t2.reset();assert.equal(t2.update(trap.x+trap.dx*5,trap.z+trap.dz*5,40),null);
});

test('drift zone: angle x speed scoring, combo multiplier, best saved on exit',()=>{
  const zone=layoutFor('coast').zones[0],store=new ActivityStore('coast',memory()),dz=new DriftZones([zone],store);
  const cx=(zone.minX+zone.maxX)/2,cz=(zone.minZ+zone.maxZ)/2;
  assert.ok(inZone(zone,cx,cz));assert.ok(Math.abs(driftAngle(10,10)-Math.PI/4)<1e-9);
  let live;for(let i=0;i<60*6;i++)live=dz.update(1/60,cx,cz,15,10,false);
  assert.equal(live.type,'drift-live');assert.ok(live.mult>=3,`mult ${live.mult}`);assert.ok(live.score>1000,`score ${live.score}`);
  // Gripping (no slip) earns nothing.
  const before=dz.total;for(let i=0;i<30;i++)dz.update(1/60,cx,cz,20,0,false);assert.equal(dz.total,before);
  const result=dz.update(1/60,zone.maxX+50,cz,20,0,false);
  assert.equal(result.type,'drift');assert.equal(result.score,before);assert.equal(result.newBest,true);assert.equal(dz.best(zone.id),before);
  assert.equal(dz.update(1/60,zone.maxX+60,cz,20,0,false),null);
});

test('drift zone: a crash throws away the unbanked chain and resets the multiplier',()=>{
  const zone=layoutFor('coast').zones[1],dz=new DriftZones([zone],null),cx=(zone.minX+zone.maxX)/2,cz=(zone.minZ+zone.maxZ)/2;
  for(let i=0;i<240;i++)dz.update(1/60,cx,cz,15,10,false);
  assert.ok(dz.chain>0);
  const e=dz.update(1/60,cx,cz,15,10,true);
  assert.equal(e.crash,true);assert.equal(e.score,0);assert.equal(dz.chain,0);assert.equal(dz.mult,1);
  // Slow sliding does not count.
  for(let i=0;i<120;i++)dz.update(1/60,cx,cz,3,3,false);assert.equal(dz.total,0);
});

test('hidden packages: pickup radius, height window, persistence and count',()=>{
  const storage=memory(),pk=layoutFor('coast').packages,c=new Collectibles(pk,new ActivityStore('coast',storage));
  assert.equal(c.count,0);assert.equal(c.total,25);
  assert.equal(c.update(pk[0].x+PICKUP_RADIUS+1,0,pk[0].z),null);
  const e={...c.update(pk[0].x+1,0,pk[0].z)};assert.equal(e.count,1);assert.equal(e.index,0);
  assert.equal(c.update(pk[0].x,0,pk[0].z),null,'collected once only');
  // A ramp-lip package needs the car up on the deck.
  const lip=pk.findIndex(p=>p.y>4);assert.ok(lip>=0);
  assert.equal(c.update(pk[lip].x,0,pk[lip].z),null);assert.equal(c.update(pk[lip].x,pk[lip].y-.6,pk[lip].z).count,2);
  const reloaded=new Collectibles(pk,new ActivityStore('coast',storage));assert.equal(reloaded.count,2);
  assert.match(describeEvent(e),/1\/25/);
});

test('store survives broken or missing storage',()=>{
  const bad={getItem(){throw new Error('denied');},setItem(){throw new Error('denied');}};
  const s=new ActivityStore('coast',bad);s.data.traps.x=1;s.save();
  const junk=memory();junk.setItem('speed-for-need-activities-coast','{not json');assert.deepEqual(new ActivityStore('coast',junk).data.packages,[]);
  assert.equal(new Collectibles(layoutFor('coast').packages,null).count,0);
});

test('package placement nudges blocked pickups to a free spot and keeps index order',()=>{
  const pk=layoutFor('coast').packages,blocked=(x,z)=>Math.abs(x-pk[3].x)<5&&Math.abs(z-pk[3].z)<5;
  const placed=placePackages(pk,blocked);assert.equal(placed.length,pk.length);
  assert.equal(placed[0],pk[0]);assert.ok(!blocked(placed[3].x,placed[3].z));assert.ok(Math.hypot(placed[3].x-pk[3].x,placed[3].z-pk[3].z)<=24);assert.equal(placed[3].y,pk[3].y);
  assert.deepEqual(placePackages(pk,()=>true).map(p=>p.x),pk.map(p=>p.x),'nowhere free: unchanged');
});
