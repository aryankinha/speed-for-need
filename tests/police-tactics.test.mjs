import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {TACTICS,pitEnabled,flankEnabled,blockEnabled,pitCandidate,pitYawImpulse,pitAim,flankSide,flankPoint,roadMargin,onRoad,roadblockPoint,blockTarget,DriftSighting} from '../dist/police-tactics.js';
import {WantedSystem,HEAT} from '../dist/wanted.js';
import {createDrivingWorld} from '../dist/physics.js';
// world.js imports three; read its WORLD literal instead of importing it (same approach as wanted.test.mjs).
const WORLD=Function('return '+readFileSync(new URL('../dist/world.js',import.meta.url),'utf8').match(/export const WORLD=(\{.*?\}\});/)[1])();
const roads={roadsX:WORLD.roadsX,roadsZ:WORLD.roadsZ};

// Player heading 0 faces -z; right is +x. "behind" is +z.
const player=(o={})=>({x:0,z:0,heading:0,speed:25,vx:0,vz:-25,...o});
const cop=(x,z,speed=25)=>({x,z,speed});
const READY=0;

test('PIT window edges: lateral 1.6-3.0, longitudinal -2.5..+0.5, speed within 6 m/s, player above 12 m/s',()=>{
  const p=player();
  // cop on the right (x>0), 1 m behind the player (z>0 is behind)
  assert.equal(pitCandidate(p,cop(2.2,1),2,READY),1);
  assert.equal(pitCandidate(p,cop(-2.2,1),2,READY),-1,'left side');
  assert.equal(pitCandidate(p,cop(1.5,1),2,READY),0,'too close sideways');
  assert.equal(pitCandidate(p,cop(3.1,1),2,READY),0,'too far sideways');
  assert.equal(pitCandidate(p,cop(1.6,0),2,READY),1,'inner lateral bound');
  assert.equal(pitCandidate(p,cop(3,0),2,READY),1,'outer lateral bound');
  assert.equal(pitCandidate(p,cop(2.2,2.5),2,READY),1,'rear longitudinal bound (2.5 m behind)');
  assert.equal(pitCandidate(p,cop(2.2,2.6),2,READY),0,'further behind');
  assert.equal(pitCandidate(p,cop(2.2,-.5),2,READY),1,'front longitudinal bound (0.5 m ahead)');
  assert.equal(pitCandidate(p,cop(2.2,-.6),2,READY),0,'ahead of the player');
  assert.equal(pitCandidate(p,cop(2.2,1,31),2,READY),1,'speed delta 6 is allowed');
  assert.equal(pitCandidate(p,cop(2.2,1,31.5),2,READY),0,'speed delta over 6');
  assert.equal(pitCandidate(p,cop(2.2,1,18),2,READY),0,'cop much slower');
  assert.equal(pitCandidate(player({speed:12,vz:-12}),cop(2.2,1,12),2,READY),0,'player must be above 12 m/s');
  assert.equal(pitCandidate(player({speed:12.5}),cop(2.2,1,12.5),2,READY),1);
});

test('PIT window follows the player heading, not the world axes',()=>{
  const h=Math.PI/2,p=player({heading:h}); // faces -x; right is (cos h,-sin h)=(0,-1) so right is -z
  assert.equal(pitCandidate(p,cop(1,-2.2),2,READY),1,'1 m behind (x>0), 2.2 m to the right (-z)');
  assert.equal(pitCandidate(p,cop(1,2.2),2,READY),-1);
  assert.equal(pitCandidate(p,cop(2.2,1),2,READY),0,'world-axis offset is outside the rotated window');
});

test('PIT cooldown: unavailable while cooling down (6 s global), ready at 0',()=>{
  const p=player(),c=cop(2.2,1);
  assert.equal(TACTICS.pit.cooldown,6);
  assert.equal(pitCandidate(p,c,2,6),0);assert.equal(pitCandidate(p,c,2,.01),0);
  assert.equal(pitCandidate(p,c,2,0),1);assert.equal(pitCandidate(p,c,2,-.5),1);
  assert.equal(pitCandidate(p,c,2,NaN),0,'a corrupt cooldown never fires');
});

test('wanted stars 2+ enable PIT, stars 1 does not',()=>{
  const w=new WantedSystem();
  w.addHeat(1);assert.equal(w.stars,1);
  assert.equal(pitEnabled(w.stars),false);assert.equal(pitCandidate(player(),cop(2.2,1),w.stars,READY),0);
  assert.equal(flankEnabled(w.stars),false);assert.equal(blockEnabled(w.stars),false);
  w.addHeat(2.6);assert.equal(w.stars,2);
  assert.equal(pitEnabled(w.stars),true);assert.equal(pitCandidate(player(),cop(2.2,1),w.stars,READY),1);
  assert.equal(flankEnabled(w.stars),true);assert.equal(blockEnabled(w.stars),false,'roadblocks need 3 stars');
  w.addHeat(10);assert.equal(w.stars,3);assert.equal(blockEnabled(w.stars),true);
  assert.equal(pitCandidate(player(),cop(2.2,1),0,READY),0);
});

test('PIT yaw impulse: signed toward the cop, scaled with speed, clamped, zero on bad input',()=>{
  const I=2000;
  assert.ok(pitYawImpulse(I,1,25)>0);assert.ok(pitYawImpulse(I,-1,25)<0);
  assert.equal(pitYawImpulse(I,1,25),-pitYawImpulse(I,-1,25));
  const lo=pitYawImpulse(I,1,12),mid=pitYawImpulse(I,1,25),hi=pitYawImpulse(I,1,60),top=pitYawImpulse(I,1,500);
  assert.ok(lo<=mid&&mid<=hi);assert.equal(hi,top,'clamped');
  assert.equal(lo,I*TACTICS.pit.yawMin);assert.equal(top,I*TACTICS.pit.yawMax);
  assert.equal(pitYawImpulse(0,1,25),0);assert.equal(pitYawImpulse(I,0,25),0);assert.equal(pitYawImpulse(NaN,1,25),0);
});

test('PIT impulse on a real body spins the car toward the cop without a flip, and the driver recovers',()=>{
  for(const side of [1,-1]){
    const w=createDrivingWorld(),car=w.addVehicle({x:0,z:0,mass:1450});
    car.setPose({x:0,z:0,heading:0,vx:0,vz:-30});car.setControls({throttle:1});
    for(let i=0;i<30;i++)w.step(1/60);
    const h0=car.heading;
    car.body.applyAngularImpulse(pitYawImpulse(car.body.getInertia(),side,car.speed),true);
    assert.ok(Math.abs(car.body.getAngularVelocity())<=TACTICS.pit.yawMax+1.5,'angular velocity stays bounded');
    // Cop on the right (+1): nose swings right, so heading decreases; turn toward the cop is (h0-heading)*side > 0.
    let maxTurn=0;
    for(let i=0;i<60;i++){w.step(1/60);maxTurn=Math.max(maxTurn,(h0-car.heading)*side);assert.ok(Number.isFinite(car.x)&&Number.isFinite(car.speed));}
    assert.ok(maxTurn>.3,`spin-out large enough to matter (${maxTurn})`);
    assert.ok(maxTurn<Math.PI/2+.3,`a spin, not a flip or full rotation (${maxTurn})`);
  }
});

test('PIT aim steers the cop at the player, parallel heading, without allocating',()=>{
  const out={vx:0,vz:0,heading:0,maxAcceleration:0,mode:''},p=player({vx:0,vz:-25});
  const r=pitAim(cop(2.2,1),p,out);assert.equal(r,out);
  assert.ok(out.vx<0,'moves toward the player (-x)');assert.ok(out.vz<-25,'matches speed and closes in');
  assert.equal(out.heading,0);assert.equal(out.mode,'pit');
});

test('flankPoint: on the requested side, 4 m ahead, 6 m across, rotated with the heading',()=>{
  const out={x:0,z:0};
  flankPoint(player(),1,out);assert.ok(Math.abs(out.x-6)<1e-9&&Math.abs(out.z+4)<1e-9,JSON.stringify(out));
  flankPoint(player(),-1,out);assert.ok(Math.abs(out.x+6)<1e-9&&Math.abs(out.z+4)<1e-9);
  const p=player({x:100,z:50,heading:Math.PI/2}),f=[-Math.sin(p.heading),-Math.cos(p.heading)],r=[Math.cos(p.heading),-Math.sin(p.heading)];
  for(const side of [1,-1]){
    flankPoint(p,side,out);const dx=out.x-p.x,dz=out.z-p.z,ahead=dx*f[0]+dz*f[1],across=dx*r[0]+dz*r[1];
    assert.ok(ahead>=4-1e-9&&ahead<=6,`ahead ${ahead}`);assert.ok(Math.abs(across-6*side)<1e-9,`across ${across}`);
  }
  assert.equal(flankPoint(player(),1,out),out,'writes into the scratch object');
});

test('flank side is the side with more road',()=>{
  // Road x=0 is 28 m wide. Player near the right edge: more road on the left.
  assert.equal(flankSide(player({x:10,z:-500}),roads),-1);
  assert.equal(flankSide(player({x:-10,z:-500}),roads),1);
  assert.equal(flankSide(player({x:0,z:-500}),roads),1,'tie goes right');
  assert.ok(roadMargin(0,-500,roads)>roadMargin(20,-500,roads));
});

test('roadblock geometry: window 55-110 m ahead at over 50 km/h',()=>{
  const out={x:0,z:0,heading:0},free=()=>false;
  const at=(ahead,lat=0,sp=25)=>roadblockPoint({x:lat,z:-ahead},player({x:0,z:0,speed:sp}),roads,free,out);
  assert.equal(at(54),null,'too close');
  assert.ok(at(55),'inner bound');assert.ok(at(80));assert.ok(at(110),'outer bound');
  assert.equal(at(111),null,'too far');
  assert.equal(at(-80),null,'behind the player is not ahead');
  assert.equal(at(80,20),null,'too far to the side');
  assert.equal(at(80,0,13.8),null,'player at/below 50 km/h');
  assert.ok(at(80,0,13.9));
});

test('roadblockPoint: heading across the player, at the cop; refuses off-road and blocked points',()=>{
  const out={x:0,z:0,heading:0};
  const p=player({x:0,z:0,heading:0});
  const got=roadblockPoint({x:0,z:-80},p,roads,()=>false,out);
  assert.equal(got,out);assert.equal(out.x,0);assert.equal(out.z,-80);
  assert.ok(Math.abs(Math.cos(out.heading-p.heading))<1e-9,'perpendicular to the player heading');
  // Off-road: player on x=75 (75 m from any x road) and z far from a z road.
  assert.equal(onRoad(75,75,roads),false);assert.equal(onRoad(0,-80,roads),true);assert.equal(onRoad(5,75,roads),true);
  assert.equal(roadblockPoint({x:75,z:-75},player({x:75,z:5}),roads,()=>false,out),null,'off-road is refused');
  // Blocked by a static obstacle: the check receives the cop point and a 3 m clearance.
  const seen=[];
  assert.equal(roadblockPoint({x:0,z:-80},p,roads,(x,z,m)=>{seen.push([x,z,m]);return true;},out),null);
  assert.deepEqual(seen,[[0,-80,3]]);
  assert.equal(TACTICS.block.clearance,3);assert.equal(TACTICS.block.duration,15);
  // the obstacle check is last, so geometry misses never scan obstacles
  let calls=0;roadblockPoint({x:0,z:-20},p,roads,()=>{calls++;return false;},out);assert.equal(calls,0);
});

test('blockTarget holds the cop still across the road',()=>{
  const out={vx:9,vz:9,heading:0,maxAcceleration:0,mode:''};
  assert.equal(blockTarget(1.2,out),out);assert.equal(out.vx,0);assert.equal(out.vz,0);assert.equal(out.heading,1.2);assert.equal(out.mode,'block');assert.ok(out.maxAcceleration>0);
});

test('drift-in-sight: needs real drift, a stood-down cop within 60 m ahead, and fires at most once per 3 s',()=>{
  const d=new DriftSighting();
  const drifting=player({lateralSpeed:5,speed:20}),straight=player({lateralSpeed:1,speed:20}),slow=player({lateralSpeed:6,speed:14});
  const patrol={x:0,z:-40,leaving:2},chasing={x:0,z:-40,leaving:0},behind={x:0,z:40,leaving:2},far={x:0,z:-70,leaving:2},wide={x:40,z:-10,leaving:2};
  assert.equal(d.update(.016,straight,[patrol]),false,'not drifting');
  assert.equal(d.update(.016,slow,[patrol]),false,'too slow');
  assert.equal(d.update(.016,drifting,[chasing]),false,'pursuing cops do not count');
  assert.equal(d.update(.016,drifting,[behind]),false,'behind the player');
  assert.equal(d.update(.016,drifting,[far]),false,'beyond 60 m');
  assert.equal(d.update(.016,drifting,[wide]),false,'dot product 0.24 is not in front enough');
  assert.equal(d.update(.016,drifting,[]),false);
  assert.equal(d.update(.016,drifting,[patrol]),true,'fires');
  let fires=0;for(let t=0;t<2.9;t+=.1)if(d.update(.1,drifting,[patrol]))fires++;
  assert.equal(fires,0,'rate limited inside 3 s');
  assert.equal(d.update(.2,drifting,[patrol]),true,'fires again after 3 s');
  let n=0;const e=new DriftSighting();for(let t=0;t<10;t+=.05)if(e.update(.05,drifting,[patrol]))n++;
  assert.ok(n>=3&&n<=4,`about one per 3 s over 10 s (${n})`);
  assert.equal(TACTICS.drift.interval,3);assert.equal(HEAT.drift,.8);
  d.reset();assert.equal(d.update(.016,drifting,[patrol]),true,'reset re-arms');
});

test('drift heat alone is below one star; repeated drifts accumulate',()=>{
  const w=new WantedSystem();w.addHeat(HEAT.drift);assert.equal(w.stars,0);w.addHeat(HEAT.drift);assert.equal(w.stars,1);
});
