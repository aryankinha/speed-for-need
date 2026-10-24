import test from 'node:test';
import assert from 'node:assert/strict';
import {roundedRoute,followTraffic} from '../dist/traffic.js';
import {createDrivingWorld} from '../dist/physics.js';

const angleError=(a,b)=>Math.abs(Math.atan2(Math.sin(a-b),Math.cos(a-b)));
const separation=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);
const options={left:-180,right:180,top:-270,bottom:270,radius:11,lane:4.3};
const addCar=(world,route,progress=0,cruise=13)=>{const p=route.sample(progress);return {route,progress,cruise,actor:world.addVehicle({x:p.x,z:p.z,heading:p.heading,width:1.9,length:4.5})};};

for(const clockwise of [true,false]){
 test(`rounded ${clockwise?'clockwise':'counterclockwise'} route is continuous in position/tangent including loop seam`,()=>{
  const route=roundedRoute({...options,clockwise});const step=.25;
  for(let s=0;s<route.length;s+=step){const a=route.sample(s),b=route.sample(s+step);assert.ok(separation(a,b)<=step+1e-6);assert.ok(angleError(a.heading,b.heading)<.025);assert.ok(Math.abs(Math.hypot(a.dx,a.dz)-1)<1e-10);}
  const a=route.sample(route.length-.0001),b=route.sample(.0001);assert.ok(separation(a,b)<.00021);assert.ok(angleError(a.heading,b.heading)<.0001);
  const p=route.sample(-17),q=route.sample(route.length-17);assert.ok(separation(p,q)<1e-9);
 });
 test(`60-second dynamic ${clockwise?'clockwise':'counterclockwise'} traffic stays on its lane without spinning`,()=>{
  const world=createDrivingWorld(),route=roundedRoute({...options,clockwise});
  // Starting vehicles at four parts of the loop exercises all four rounded
  // junctions during the 60-second test instead of just the initial north turn.
  const cars=[0,.25,.5,.75].map(t=>addCar(world,route,t*route.length));
  const player=world.addVehicle({x:2000,z:2000});let maxDeviation=0,maxAngularError=0,maxYaw=0,maxFrameMovement=0;
  for(let i=0;i<7200;i++){
   const before=cars.map(c=>c.actor.state);world.step(1/120,dt=>followTraffic(cars,player,dt));
   cars.forEach((car,j)=>{const state=car.actor.state,nearest=route.sample(route.nearest(state.x,state.z,car.progress));maxDeviation=Math.max(maxDeviation,separation(state,nearest));maxAngularError=Math.max(maxAngularError,angleError(state.heading,nearest.heading));maxYaw=Math.max(maxYaw,Math.abs(state.yawRate));maxFrameMovement=Math.max(maxFrameMovement,separation(state,before[j]));});
  }
  assert.ok(maxDeviation<.65,`Max lane deviation ${maxDeviation} m`);assert.ok(maxAngularError<.2,`Max heading error ${maxAngularError} rad`);assert.ok(maxYaw<.85,`Max yaw ${maxYaw} rad/s`);assert.ok(maxFrameMovement<.13,`Detected possible teleport: ${maxFrameMovement} m/step`);
  console.log(`Traffic ${clockwise?'CW':'CCW'} 60s: max deviation ${maxDeviation.toFixed(3)}m; heading ${(maxAngularError*180/Math.PI).toFixed(2)}deg; yaw ${maxYaw.toFixed(3)}rad/s`);
 });
}

test('opposing traffic uses separated lanes and opposite tangents',()=>{
 const cw=roundedRoute({...options,clockwise:true}),ccw=roundedRoute({...options,clockwise:false});
 const findLeft=r=>{let best;for(let s=0;s<r.length;s+=.5){const p=r.sample(s);if(p.x<options.left+6&&Math.abs(p.z)<.3){best=p;break;}}return best;};
 const a=findLeft(cw),b=findLeft(ccw);assert.ok(a&&b);assert.ok(Math.abs(a.x-b.x)>=8.59);assert.ok(a.dx*b.dx+a.dz*b.dz<-.999);
 // Sample the opposing path densely around every turn; even the closest point
 // must leave room for two 1.9m-wide vehicle footprints.
 let min=Infinity;for(let s=0;s<cw.length;s+=6){const a=cw.sample(s);for(let t=0;t<ccw.length;t+=3)min=Math.min(min,separation(a,ccw.sample(t)));}assert.ok(min>6.5,`Opposite lane gap ${min}m`);
});

test('nearest route progress is continuous below the old two-metre quantization',()=>{
 const route=roundedRoute(options),point=route.sample(12.37),found=route.nearest(point.x,point.z,12);
 assert.ok(Math.abs(found-12.37)<.01,`Nearest error ${found-12.37}`);
});

test('traffic brakes behind a parked player instead of driving through it',()=>{
 const world=createDrivingWorld(),route=roundedRoute(options),car=addCar(world,route),target=route.sample(30),player=world.addVehicle({x:target.x,z:target.z,heading:target.heading});let minGap=Infinity;
 for(let i=0;i<2400;i++){world.step(1/120,dt=>followTraffic([car],player,dt));minGap=Math.min(minGap,separation(car.actor.state,player.state));}
 assert.ok(minGap>5.3,`Following gap too small ${minGap}m`);assert.ok(car.actor.state.speed<.2);assert.ok(separation(player.state,target)<.05,'Parked player was pushed by route following');
});

test('same-route traffic keeps a safe following distance through corners',()=>{
 const world=createDrivingWorld(),route=roundedRoute(options),cars=[addCar(world,route,0,15),addCar(world,route,13,8)],player=world.addVehicle({x:2000,z:2000});let minGap=Infinity;
 for(let i=0;i<7200;i++){world.step(1/120,dt=>followTraffic(cars,player,dt));minGap=Math.min(minGap,separation(cars[0].actor.state,cars[1].actor.state));}
 assert.ok(minGap>5.5,`Following gap ${minGap}m`);
});

for(const clockwise of [true,false])test(`analytic nearest matches a dense local oracle on lines, arcs and seam (${clockwise})`,()=>{
 const r=roundedRoute({...options,clockwise});
 for(let i=-20;i<250;i++){const around=i*r.length/250,p=r.sample(around+1.37),x=p.x+Math.sin(i)*1.5,z=p.z+Math.cos(i)*1.5;
  const found=r.nearest(x,z,around),point=r.sample(found),d=separation(point,{x,z});let oracle=Infinity;
  for(let s=around-18;s<=around+18;s+=.03)oracle=Math.min(oracle,separation(r.sample(s),{x,z}));
  assert.ok(d<=oracle+.0001,`${i}: ${d} > ${oracle}`);assert.ok(Math.abs(found-around)<=18.000001);
 }
});
