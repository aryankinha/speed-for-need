import test from 'node:test';
import assert from 'node:assert/strict';
import {createDrivingWorld} from '../dist/physics.js';

const frames=(world,seconds,dt=1/60)=>{for(let i=0;i<Math.round(seconds/dt);i++)world.step(dt);};
const near=(a,b,eps=1e-6)=>assert.ok(Math.abs(a-b)<eps,`${a} != ${b}`);
const finite=car=>{for(const v of Object.values(car.state))assert.ok(Number.isFinite(v));};

test('full vehicle footprint stops at a wall before the center enters it',()=>{
 const w=createDrivingWorld(),wall=w.addBox({x:0,z:-15,width:30,length:.15});
 const car=w.addVehicle({x:0,z:0});car.setControls({throttle:1});frames(w,4);
 assert.ok(car.state.z>-12.9,JSON.stringify(car.state));assert.ok(car.state.speed<.25);finite(car);
});

test('CCD stops a 140 m/s car at a 5 cm wall rather than tunnelling',()=>{
 const w=createDrivingWorld();w.addBox({x:0,z:-8,width:30,length:.05});
 const car=w.addVehicle({x:0,z:0});car.setPose({x:0,z:0,vz:-140});frames(w,.3);
 assert.ok(car.state.z>-5.8,JSON.stringify(car.state));finite(car);
});

test('glancing wall collision preserves travel along the wall',()=>{
 const w=createDrivingWorld();w.addBox({x:0,z:0,width:.2,length:150,friction:0});
 const car=w.addVehicle({x:-4,z:10,heading:-.15});car.setPose({x:-4,z:10,heading:-.15,vx:10,vz:-30});frames(w,.6);
 assert.ok(car.state.x<-.9,JSON.stringify(car.state));assert.ok(car.state.z<-2,JSON.stringify(car.state));assert.ok(car.state.vz<-10);finite(car);
});

test('oriented corner contact stays outside a building and settles without jitter explosion',()=>{
 const w=createDrivingWorld();w.addBox({x:0,z:0,width:10,length:10,heading:.25});
 const car=w.addVehicle({x:-12,z:12,heading:-Math.PI/4});car.setControls({throttle:1,steer:0});frames(w,6);
 finite(car);assert.ok(Math.hypot(car.state.x,car.state.z)>4);assert.ok(car.state.speed<55);
});

test('moving traffic collides with a stationary player and transfers momentum',()=>{
 const w=createDrivingWorld(),player=w.addVehicle({x:0,z:0}),traffic=w.addVehicle({x:0,z:14});
 traffic.setTarget({vx:0,vz:-12,heading:0,maxAcceleration:5});frames(w,4);
 assert.ok(player.state.z<-1,JSON.stringify(player.state));
 assert.ok(traffic.state.z-player.state.z>4.3,JSON.stringify({a:player.state,b:traffic.state}));finite(player);finite(traffic);
});

test('thin pole circle uses a physical collision instead of being drive-through',()=>{
 const w=createDrivingWorld();w.addCircle({x:0,z:-10,radius:.15});const car=w.addVehicle();
 car.setPose({x:0,z:0,vz:-90});frames(w,.5);assert.ok(car.state.z>-7.8,JSON.stringify(car.state));finite(car);
});

test('touching is allowed: a genuine near miss does not hit oversized boxes',()=>{
 const w=createDrivingWorld();w.addBox({x:0,z:-10,width:2,length:4});const car=w.addVehicle({x:2.1,z:0,width:1.9});
 car.setControls({throttle:1});frames(w,3);assert.ok(car.state.z<-15);assert.ok(car.state.speed>10);
});

test('simulation is independent of 30 / 60 / 120 Hz render rates',()=>{
 const states=[1/30,1/60,1/120].map(dt=>{const w=createDrivingWorld(),car=w.addVehicle();car.setControls({throttle:1,steer:.2});frames(w,5,dt);return car.state;});
 for(const s of states.slice(1))for(const key of ['x','z','heading','vx','vz'])near(s[key],states[0][key],1e-6);
});

test('releasing boost decelerates smoothly without an instant speed cap',()=>{
 const w=createDrivingWorld(),car=w.addVehicle();car.setPose({x:0,z:0,vz:-65});car.setControls({throttle:1,boost:false});w.step(1/60);
 assert.ok(car.state.speed>64.5,JSON.stringify(car.state));
});

test('reset clears both collision velocity and steering controls',()=>{
 const w=createDrivingWorld(),car=w.addVehicle();car.setControls({throttle:1,steer:1});frames(w,2);car.setPose({x:20,z:20,heading:1});frames(w,.5);
 near(car.state.x,20);near(car.state.z,20);near(car.state.heading,1);near(car.state.speed,0);
});

// Independently project the actual rectangular footprints (without Box2D's
// intentional contact skin), checking physical penetration rather than whether
// the engine correctly reports a touching contact as "overlapping".
function penetration(a,b){
 const corners=({x,z,heading,width,length})=>{const c=Math.cos(heading),s=Math.sin(heading);return [[-1,-1],[1,-1],[1,1],[-1,1]].map(([u,v])=>({x:x+c*u*width/2-s*v*length/2,z:z+s*u*width/2+c*v*length/2}));};
 const aa=corners(a),bb=corners(b);let depth=Infinity;
 for(const points of [aa,bb])for(let i=0;i<2;i++){const edge={x:points[i+1].x-points[i].x,z:points[i+1].z-points[i].z};const length=Math.hypot(edge.x,edge.z),n={x:-edge.z/length,z:edge.x/length};const pa=aa.map(p=>p.x*n.x+p.z*n.z),pb=bb.map(p=>p.x*n.x+p.z*n.z);const overlap=Math.min(Math.max(...pa),Math.max(...pb))-Math.max(Math.min(...pa),Math.min(...pb));if(overlap<0)return 0;depth=Math.min(depth,overlap);}
 return depth;
}
test('sustained throttle against a wall leaves no visible footprint penetration',()=>{
 const w=createDrivingWorld();const wall={x:0,z:-15,width:30,length:.15,heading:0};w.addBox(wall);const car=w.addVehicle();car.setControls({throttle:1});
 for(let i=0;i<1200;i++){w.step(1/120);assert.ok(penetration({...car.state,heading:-car.state.heading,width:car.width,length:car.length},wall)<.015);}
});
test('reverse and forward commands brake before changing travel direction',()=>{
 const w=createDrivingWorld(),car=w.addVehicle();car.setControls({throttle:1});frames(w,2);assert.ok(car.state.forwardSpeed>10);car.setControls({throttle:0,reverse:1});frames(w,3);assert.ok(car.state.forwardSpeed< -3);car.setControls({throttle:1,reverse:0});frames(w,3);assert.ok(car.state.forwardSpeed>10);
});
