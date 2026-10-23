import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,statSync,readFileSync} from 'node:fs';
import {sidewalkPaths,roadGap,CrowdSim,SidewalkIndex,lodTier,mixerDue,carThreat,knockPed,stepKnocked,downExpired,PED,ANIM,CROWD_SIZES,seeded} from '../dist/pedestrian-sim.js';
import {GRAPHICS_PRESETS} from '../dist/graphics-presets.js';
import {STUNT_AREA} from '../dist/stunts.js';
import {clearOfSunset} from '../dist/map-layout.js';

const lane=(path,i)=>({x:path.x[i],z:path.z[i]});
// Building footprints as world.js / world-default.js place them: lots at block centre ±32/33, buildings fitted to ≤46 m at ≤0.97 scale.
function buildingFootprints(map){
  const xs=[-450,-300,-150,0,150,300,450],zs=[-600,-450,-300,-150,0,150,300,450,600],out=[],d=map==='coast'?32:33;
  for(let i=0;i<6;i++)for(let j=0;j<8;j++){const bx=(xs[i]+xs[i+1])/2,bz=(zs[j]+zs[j+1])/2;for(const dx of [-d,d])for(const dz of [-d,d])if(map!=='coast'||clearOfSunset({minX:bx+dx-24,maxX:bx+dx+24,minZ:bz+dz-24,maxZ:bz+dz+24},1))out.push({minX:bx+dx-22.4,maxX:bx+dx+22.4,minZ:bz+dz-22.4,maxZ:bz+dz+22.4});}
  return out;
}

for(const map of ['default','coast','la'])test(`${map}: sidewalk lanes stay off asphalt, out of buildings and the stunt park`,()=>{
  const {paths}=sidewalkPaths(map),blocks=map==='la'?[{minX:15,maxX:55,minZ:-99,maxZ:99},{minX:-51,maxX:-15,minZ:-99,maxZ:99},{minX:85,maxX:121,minZ:-99,maxZ:99}]:buildingFootprints(map);
  assert.ok(paths.filter(p=>p.kind==='street').length>=(map==='la'?3:40));
  for(const p of paths){if(p.kind!=='street')continue;
    for(let i=0;i<p.len.length;i++){const {x,z}=lane(p,i);
      for(const lat of [p.latMin,0,p.latMax]){const px=x+p.nx[i]*lat,pz=z+p.nz[i]*lat;
        assert.ok(roadGap(map,px,pz)>=-.05,`${map} lane point ${px.toFixed(1)},${pz.toFixed(1)} (lat ${lat}) is on the road`);
        assert.ok(!blocks.some(b=>px>b.minX&&px<b.maxX&&pz>b.minZ&&pz<b.maxZ),`${map} lane point ${px.toFixed(1)},${pz.toFixed(1)} is inside a building`);}
      if(map!=='la')assert.ok(!(x>STUNT_AREA.left&&x<STUNT_AREA.right&&z>STUNT_AREA.top&&z<STUNT_AREA.bottom),'lane inside the stunt park');}}
  if(map!=='la'){assert.ok(paths.some(p=>p.kind==='beach'),'beach strollers');assert.ok(sidewalkPaths(map).seats.length>100,'sea-wall seats');}
});

// Positions are checked after the spawn frame's first walking step, hence 0.2 m / 0.5 m slack.
test('spawns land on sidewalks 40–120 m away and never inside the camera view up close',()=>{
  for(const map of ['coast','default','la']){
    const view={x:map==='la'?11:-436,z:map==='la'?40:-60,inFrustum:(x,y,z)=>z<view.z&&Math.abs(x-view.x)<(view.z-z)};// looking toward -z, 90° cone
    const sim=new CrowdSim(map,{random:seeded(7)});sim.setCount(60);sim.step(1/60,null,view);// fresh fill (nothing on screen yet)
    assert.ok(sim.active>=(map==='la'?30:50),`${map} filled ${sim.active}`);
    sim.reset();sim.fresh=false;sim.lastX=view.x;sim.lastZ=view.z;
    for(let f=0;f<120;f++){const before=new Set(sim.peds.filter(p=>p.active));sim.step(1/60,null,view);
      for(const p of sim.peds){if(!p.active||before.has(p))continue;const d=Math.hypot(p.x-view.x,p.z-view.z),seen=p.z<view.z-.5&&Math.abs(p.x-view.x)<(view.z-p.z)-.5;
        assert.ok(d>=PED.spawnMin-.2&&d<=PED.spawnMax+.2,`${map} spawn at ${d.toFixed(1)} m`);
        assert.ok(seen?d>=PED.farSpawn-.2:d<=PED.nearView+.2,`${map} spawn visible at ${d.toFixed(1)} m`);
        if(p.state!=='sit')assert.ok(roadGap(map,p.x,p.z)>=0,`${map} spawn on asphalt`);}}
    assert.ok(sim.active>0);
  }
});

test('walkers keep to the lane for a simulated minute and teleports repopulate',()=>{
  const sim=new CrowdSim('coast',{random:seeded(3)}),view={x:-300,z:0,inFrustum:()=>true};sim.setCount(28);
  for(let f=0;f<3600;f++){sim.step(1/60,null,view);if(f%60===0)for(const p of sim.peds)if(p.active&&p.state==='walk'){const path=sim.layout.paths[p.p];if(path.kind==='street')assert.ok(roadGap('coast',p.x,p.z)>=-.05,'walked onto the road');}}
  assert.ok(sim.peds.some(p=>p.active&&p.state==='walk'));
  view.x=300;view.z=400;sim.step(1/60,null,view);assert.ok(sim.peds.filter(p=>p.active).every(p=>Math.hypot(p.x-300,p.z-400)<=PED.spawnMax+1),'old crowd dropped after a teleport');
});

test('LOD tiers and mixer cadence',()=>{
  assert.deepEqual([10,34.9,35,69.9,70,109,110,200].map(lodTier),[0,0,1,1,2,2,3,3]);
  const due=t=>Array.from({length:8},(_,f)=>mixerDue(t,f,0)).filter(Boolean).length;
  assert.equal(due(0),8);assert.equal(due(1),4);assert.equal(due(2),2);assert.equal(due(3),0);
  // Staggered by slot so the every-4th tier spreads its work.
  assert.notDeepEqual(Array.from({length:4},(_,s)=>mixerDue(2,0,s)),[true,true,true,true]);
});

test('crowd size per graphics preset',()=>{
  for(const [name,n] of Object.entries(CROWD_SIZES))assert.equal(GRAPHICS_PRESETS[name].crowd,n);
});

test('knock state machine: flee, dive, hit at speed, tumble, land, recycle out of view',()=>{
  const ped={x:0,y:.06,z:0,groundY:.06,state:'walk'},car={x:0,z:20,heading:0,vx:0,vz:-12,width:1.9,length:4.5};
  assert.equal(carThreat(ped,{...car,vz:-2}),0,'slow cars are ignored');
  assert.equal(carThreat(ped,{...car,z:-20,vz:12}),0,'cars moving away are ignored');
  assert.equal(carThreat(ped,{...car,z:12}),1,'fast approach within 14 m: flee');
  assert.equal(carThreat(ped,{...car,z:5}),2,'imminent: dive');
  assert.equal(carThreat(ped,{...car,x:8,z:5}),0,'off the car line');
  assert.equal(carThreat(ped,{...car,z:2}),3,'overlap at speed: hit');
  assert.equal(carThreat(ped,{...car,z:2,vz:-1}),4,'overlap while crawling: shove');
  assert.equal(carThreat(ped,{...car,z:2,elevation:2}),0,'airborne car flies over');
  knockPed(ped,{...car,z:2},seeded(1));assert.equal(ped.state,'knocked');assert.ok(ped.vy>3&&ped.vz<-8,'launched along the car velocity and up');
  let peak=0;for(let i=0;i<600&&ped.state==='knocked';i++){stepKnocked(ped,1/60);peak=Math.max(peak,ped.y);}
  assert.equal(ped.state,'down');assert.ok(peak>.8);assert.equal(ped.y,ped.groundY);assert.equal(ped.anim,ANIM.DEATH);
  ped.t=1;assert.equal(downExpired(ped,false),false,'stays a moment');ped.t=4;assert.equal(downExpired(ped,true),false,'not while watched');assert.equal(downExpired(ped,false),true);ped.t=30;assert.equal(downExpired(ped,true),true,'hard cap');
});

test('CrowdSim knocks a walker once, reports it and recycles it after it leaves view',()=>{
  const sim=new CrowdSim('default',{random:seeded(11)});let knocked=0;sim.onKnock=()=>knocked++;sim.setCount(1);
  let seen=true;const view={x:-436,z:-60,inFrustum:()=>seen};sim.step(1/60,null,view);const p=sim.peds[0];assert.ok(p.active);
  const path=sim.layout.paths[p.p],j=(p.s+1)%path.n,tx=(path.x[j]-path.x[p.s])/path.len[p.s],tz=(path.z[j]-path.z[p.s])/path.len[p.s];
  const car={x:p.x-tx*1.5,z:p.z-tz*1.5,heading:Math.atan2(-tx,-tz),vx:tx*20,vz:tz*20,width:1.9,length:4.5};
  sim.step(1/60,car,view);assert.equal(p.state,'knocked');assert.equal(knocked,1);sim.step(1/60,car,view);assert.equal(knocked,1,'one knock per hit');
  for(let i=0;i<300;i++)sim.step(1/60,null,view);assert.equal(p.state,'down');assert.ok(p.active,'still lying there while watched');
  seen=false;for(let i=0;i<300;i++)sim.step(1/60,null,view);assert.ok(!p.active||p.state!=='down','recycled once out of view');
});

test('ped assets ship within budget and are credited',()=>{
  let bytes=0;for(const f of ['ped-male','ped-female','ped-anims']){const u=new URL(`../dist/assets/peds/${f}.glb`,import.meta.url);assert.ok(existsSync(u),f);bytes+=statSync(u).size;}
  assert.ok(bytes<4e6,`peds weigh ${bytes} bytes`);
  assert.ok(existsSync(new URL('../dist/vendor/utils/SkeletonUtils.js',import.meta.url)));
  assert.match(readFileSync(new URL('../dist/CREDITS.md',import.meta.url),'utf8'),/Quaternius/);
  assert.equal(JSON.parse(readFileSync(new URL('../dist/assets/peds/peds-source.json',import.meta.url),'utf8')).license,'CC0-1.0');
});
