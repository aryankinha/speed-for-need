import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {WantedSystem,WANTED_DEFAULTS,HEAT,starsForHeat,copSeesPlayer,pursuitTarget,spawnCandidates,addHeat,setActiveWanted,readPoliceSetting,writePoliceSetting,POLICE_KEY} from '../dist/wanted.js';
import {readFileSync as readSource} from 'node:fs';
// world.js imports three; read its WORLD literal instead of importing it.
const WORLD=Function('return '+readSource(new URL('../dist/world.js',import.meta.url),'utf8').match(/export const WORLD=(\{.*?\}\});/)[1])();

const roads={roadsX:WORLD.roadsX,roadsZ:WORLD.roadsZ};
const out=()=>({vx:0,vz:0,heading:0,maxAcceleration:0,wx:0,wz:0,mode:''});
const player=(x,z,speed=20)=>({x,z,vx:0,vz:-speed,speed,heading:0});

test('stars follow heat thresholds and never exceed 3',()=>{
  assert.equal(starsForHeat(0),0);assert.equal(starsForHeat(1),1);assert.equal(starsForHeat(3.5),2);assert.equal(starsForHeat(99),3);
  const w=new WantedSystem();for(let i=0;i<50;i++)w.addHeat(HEAT.police);assert.equal(w.stars,3);assert.equal(w.desiredCops,3);
});

test('one traffic bump is forgiven; repeated hits and trap speeding raise the level and post one event',()=>{
  const w=new WantedSystem();w.addHeat(HEAT.traffic);assert.equal(w.stars,0);
  for(let i=0;i<60;i++)w.update(1/10,player(0,0),[],roads);assert.ok(w.heat<HEAT.traffic,'idle heat decays');
  w.addHeat(HEAT.traffic);w.addHeat(HEAT.trap);assert.equal(w.stars,1);
  const e=w.update(1/60,player(0,0),[],roads);assert.equal(e.type,'wanted');assert.equal(e.stars,1);assert.equal(e.previous,0);
  assert.equal(w.update(1/60,player(0,0),[{x:5,z:30}],roads),null);
});

test('switched off: addHeat is ignored and the module-level hook forwards to the active system',()=>{
  const w=new WantedSystem({enabled:false});assert.equal(w.addHeat(10),0);
  const on=new WantedSystem();setActiveWanted(on);assert.equal(addHeat(1.2),1);on.setEnabled(false);assert.equal(on.stars,0);assert.equal(addHeat(5),0);
  setActiveWanted(null);assert.equal(addHeat(5),0);
});

test('police setting persists and defaults to on',()=>{
  const m=new Map(),s={getItem:k=>m.get(k)??null,setItem:(k,v)=>m.set(k,v)};
  assert.equal(readPoliceSetting(s),true);writePoliceSetting(s,false);assert.equal(m.get(POLICE_KEY),'off');assert.equal(readPoliceSetting(s),false);
  assert.equal(readPoliceSetting({getItem(){throw new Error('x');}}),true);
});

test('sight: within the lose radius always, beyond it only on the same straight road',()=>{
  assert.equal(copSeesPlayer({x:0,z:0},{x:0,z:-200},roads),true);
  assert.equal(copSeesPlayer({x:0,z:0},{x:0,z:-300},roads),true,'same road x=0');
  assert.equal(copSeesPlayer({x:0,z:75},{x:300,z:-120},roads),false,'different roads, 360 m');
  assert.equal(copSeesPlayer({x:0,z:0},{x:0,z:-500},roads),false,'beyond sight distance');
});

test('escape: every cop out of sight for 8 s clears the stars',()=>{
  const w=new WantedSystem();w.addHeat(4);w.update(0,player(0,0),[],roads);assert.equal(w.stars,2);
  const far=[{x:300,z:450}];let e=null;
  for(let t=0;t<7.9;t+=.1){e=w.update(.1,player(-150,-160),far,roads);assert.equal(e,null);}
  assert.ok(w.escaping);
  // Being spotted resets the timer.
  w.update(.1,player(-150,-160),[{x:-150,z:-100}],roads);assert.equal(w.escape,0);
  for(let t=0;t<8.2&&!e;t+=.1)e=w.update(.1,player(-150,-160),far,roads);
  assert.equal(e.type,'escaped');assert.equal(e.previous,2);assert.equal(w.stars,0);assert.equal(w.heat,0);
});

test('busted: boxed in below 5 km/h for 3 s; moving or no cop alongside resets the timer',()=>{
  const w=new WantedSystem();w.addHeat(1);w.update(0,player(0,0),[],roads);
  const cop=[{x:3,z:2}];let e=null;
  for(let t=0;t<2;t+=.1)e=w.update(.1,player(0,0,.5),cop,roads);
  w.update(.1,player(0,0,10),cop,roads);assert.equal(w.bust,0,'driving away resets');
  for(let t=0;t<3.2&&!e;t+=.1)e=w.update(.1,player(0,0,.5),cop,roads);
  assert.equal(e.type,'busted');assert.equal(w.stars,0);
  const w2=new WantedSystem();w2.addHeat(1);w2.update(0,player(0,0),[],roads);for(let t=0;t<5;t+=.1)assert.notEqual(w2.update(.1,player(0,0,0),[{x:20,z:0}],roads)?.type,'busted');
});

test('pursuit: grid routing turns at the player row, then drives straight; direct mode up close',()=>{
  const o=out();
  // Cop on vertical road x=150 heading north; player on road z=-300 far to the west.
  pursuitTarget({x:150,z:100,heading:0,speed:30},player(-300,-300),roads,40,o);
  assert.equal(o.mode,'grid');assert.equal(o.wx,150);assert.equal(o.wz,-300);assert.ok(o.vz<0&&Math.abs(o.vx)<1e-9);
  // Approaching the turn slows below the cap.
  pursuitTarget({x:150,z:-290,heading:0,speed:30},player(-300,-300),roads,40,o);assert.ok(Math.hypot(o.vx,o.vz)<WANTED_DEFAULTS.turnSpeed+6);
  // At the intersection: drive along the player's row.
  pursuitTarget({x:150,z:-300,heading:0,speed:12},player(-300,-300),roads,40,o);assert.equal(o.wz,-300);assert.ok(o.vx<0);
  // Same road: straight at the player at full speed.
  pursuitTarget({x:0,z:200,heading:0,speed:30},player(0,-100),roads,40,o);assert.ok(Math.abs(Math.hypot(o.vx,o.vz)-40)<1e-9);assert.ok(Math.abs(o.heading)<1e-9);
  // Close: predictive pursuit, capped speed, finite output.
  pursuitTarget({x:0,z:30,heading:0,speed:25},player(0,0,25),roads,40,o);assert.equal(o.mode,'direct');assert.ok(o.vz<0&&Math.hypot(o.vx,o.vz)<=40);
  pursuitTarget({x:0,z:0,heading:1,speed:0},{x:0,z:0,vx:0,vz:0},roads,40,o);for(const k of ['vx','vz','heading'])assert.ok(Number.isFinite(o[k]),k);
});

test('pursuit stays allocation-free in shape: writes into the given object and returns it',()=>{
  const o=out();assert.equal(pursuitTarget({x:0,z:0,heading:0,speed:0},player(300,300),roads,40,o),o);
});

test('spawn candidates: on roads, inside bounds, about the radius away, behind the player first',()=>{
  const p={x:0,z:0,heading:0};const c=spawnCandidates(p,roads,WORLD,130);
  assert.ok(c.length>=4);
  for(const s of c){assert.ok(Math.abs(Math.hypot(s.x,s.z)-130)<1e-6);assert.ok(roads.roadsX.includes(s.x)||roads.roadsZ.includes(s.z));assert.ok(s.x>WORLD.left&&s.x<WORLD.right&&s.z>WORLD.top&&s.z<WORLD.bottom);}
  assert.ok(c[0].z>0,'heading 0 faces -z, so behind is +z');
  for(let i=1;i<c.length;i++)assert.ok(c[i].score>=c[i-1].score);
});

test('pursuers chase a moving player through the Planck driving world',async()=>{
  const {createDrivingWorld}=await import('../dist/physics.js');
  const physics=createDrivingWorld();const target=physics.addVehicle({x:0,z:-150,heading:0}),cop=physics.addVehicle({x:0,z:150,heading:0,userData:{kind:'police'}});
  const o=out();let start=Math.hypot(cop.x-target.x,cop.z-target.z);
  for(let i=0;i<60*12;i++){target.setControls({throttle:.3});pursuitTarget(cop,{x:target.x,z:target.z,vx:target.vx,vz:target.vz},roads,40,o);cop.setTarget(o);physics.step(1/60);}
  assert.ok(Math.hypot(cop.x-target.x,cop.z-target.z)<start/4,"closes the gap");
});

test('game wiring: open-world glue is hooked into game.js and respects pause by living in update()',()=>{
  const src=readFileSync(new URL('../dist/game.js',import.meta.url),'utf8');
  assert.match(src,/import \{OpenWorldActivities\} from '\.\/open-world\.js'/);
  assert.match(src,/openWorld\?\.update\(dt,playerActor,physics\.lastImpacts/);
  const update=src.slice(src.indexOf('function update(dt)'),src.indexOf('function animate('));assert.ok(update.includes('openWorld?.update('),'only runs from the unpaused driving update');
  assert.match(src,/openWorld\?\.drawRadar\(radarCtx,zoom\)/);
});
