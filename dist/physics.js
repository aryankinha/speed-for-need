/**
 * Planar driving built on the established Planck.js / Box2D contact solver.
 * World metres and seconds; THREE world (x,z) maps to Box2D (x,y).
 * Heading 0 faces -z. Positive heading steers left.
 *
 * Primary references used for the implementation:
 * https://piqnt.com/planck.js/docs/world/simulation.html (fixed steps)
 * https://piqnt.com/planck.js/docs/body.html (CCD/bullet bodies, forces)
 * https://piqnt.com/planck.js/docs/core-concepts.html (TOI/contact solver)
 * https://box2d.org/documentation/md_collision.html (convex manifolds/broadphase)
 * https://box2d.org/files/ErinCatto_ContinuousCollision_GDC2013.pdf (TOI)
 * https://github.com/piqnt/planck.js (MIT engine source)
 * https://www.mathworks.com/help/robotics/ug/mobile-robot-kinematics-equations.html
 * (bicycle yaw = speed / wheelbase * tan(front steering angle))
 *
 * The engine supplies dynamic AABB broadphase, oriented polygon/circle narrowphase,
 * continuous time-of-impact collision detection, friction/restitution and coupled
 * impulse/position solving. No center-point tests, padded obstacle boxes, scalar
 * speed reversals, or traffic teleports are involved in normal simulation.
 */
import {World, Vec2, Box, Circle, Chain, PolygonShape, testOverlap, WorldManifold} from './vendor/planck.mjs';

const clamp=(v,min,max)=>Math.max(min,Math.min(max,v));
const finite=(value,fallback)=>Number.isFinite(value)?value:fallback;
const wrap=a=>Math.atan2(Math.sin(a),Math.cos(a));
const BASE={width:1.9,length:4.5,mass:1450,wheelbase:2.7,maxSpeed:55,boostSpeed:69,reverseSpeed:10,acceleration:8.2,boostAcceleration:12.5,brakeAcceleration:23,grip:22,steerAngle:.62};

export function createDrivingWorld({fixedStep=1/120,maxFrameTime=.25}={}){
  const rawWorld=new World({gravity:Vec2(0,0),allowSleep:true});
  rawWorld.setContinuousPhysics(true);
  let accumulator=0,simulationTime=0,nextId=1;
  const vehicles=[],objects=[],byRaw=new Map();
  const api={rawWorld,vehicles,objects,lastImpacts:[],fixedStep,simulationTime:0,alpha:0};
  // Scratch vectors for the 120 Hz control step (planck copies forces), so stepping allocates nothing per vehicle.
  const impactPool=Array.from({length:512},()=>({a:null,b:null,impulse:0,speed:0,x:0,z:0})),contactPoint=new WorldManifold();
  const forward=Vec2(0,0),right=Vec2(0,0),force=Vec2(0,0);

  function register(body,fixture,data,type){
    const actor={id:nextId++,body,fixture,userData:data,type,minY:0,maxY:Infinity};
    Object.defineProperty(actor,'x',{get(){return body.getPosition().x;}});
    Object.defineProperty(actor,'z',{get(){return body.getPosition().y;}});
    body.setUserData(actor);byRaw.set(body,actor);objects.push(actor);return actor;
  }
  api.addBox=({x=0,z=0,width,length,heading=0,friction=.25,restitution=.06,userData}={})=>{
    if(!(width>0&&length>0))throw new RangeError('Collider dimensions must be positive.');
    const b=rawWorld.createBody({position:Vec2(x,z),angle:-heading});
    return register(b,b.createFixture(Box(width/2,length/2),{friction,restitution}),userData,'box');
  };
  // Convex outline in body-local metres (heading applied like addBox). Used for chamfered ramp toes.
  api.addPolygon=({x=0,z=0,heading=0,vertices,friction=.25,restitution=.06,userData}={})=>{
    if(!(Array.isArray(vertices)&&vertices.length>=3))throw new RangeError('Collider needs at least three vertices.');
    const b=rawWorld.createBody({position:Vec2(x,z),angle:-heading});
    return register(b,b.createFixture(PolygonShape(vertices.map(([a,c])=>Vec2(a,c))),{friction,restitution}),userData,'box');
  };
  // Compound static building surfaces: one body, separate height-aware fixtures.
  api.addCompound=({x=0,z=0,heading=0,parts,userData}={})=>{
    if(!parts?.length||parts.some(p=>!(p.width>0&&p.length>0&&Number.isFinite(p.minY)&&p.maxY>=p.minY)))throw new RangeError('Compound collider needs valid parts.');
    const body=rawWorld.createBody({position:Vec2(x,z),angle:-heading});
    const fixtures=parts.map(p=>body.createFixture(Box(p.width/2,p.length/2,Vec2(p.x,p.z)),{friction:.15,restitution:.02,userData:{minY:p.minY,maxY:p.maxY}}));
    const actor=register(body,fixtures[0],userData,'box');actor.fixtures=fixtures;actor.minY=Math.min(...parts.map(p=>p.minY));actor.maxY=Math.max(...parts.map(p=>p.maxY));return actor;
  };
  api.addCircle=({x=0,z=0,radius,friction=.3,userData}={})=>{
    if(!(radius>0))throw new RangeError('Collider radius must be positive.');
    const b=rawWorld.createBody({position:Vec2(x,z)});
    return register(b,b.createFixture(Circle(radius),{friction,restitution:.04}),userData,'circle');
  };
  // Connected static edges carry adjacent ghost vertices, so curved imported
  // guardrails do not behave like hundreds of separate snagging box corners.
  api.addChain=({points,loop=true,friction=.15,restitution=.04,userData}={})=>{
    if(!points||points.length<(loop?3:2))throw new RangeError('Chain needs connected vertices.');
    const vertices=points.map(p=>Vec2(p[0],p[1]));
    for(let i=1;i<vertices.length;i++)if(Math.hypot(vertices[i].x-vertices[i-1].x,vertices[i].y-vertices[i-1].y)<.005)throw new RangeError('Chain edges must exceed linear slop.');
    const body=rawWorld.createBody();return register(body,body.createFixture(new Chain(vertices,loop),{friction,restitution}),userData,'chain');
  };

  // Ground-plane furniture uses the same contact solver as cars. Vertical tipping remains visual.
  api.addProp=({x=0,z=0,width=.8,length=.8,heading=0,mass=80,height=1,userData}={})=>{
    if(!(width>0&&length>0&&mass>0))throw new RangeError('Prop dimensions and mass must be positive.');
    const b=rawWorld.createDynamicBody({position:Vec2(x,z),angle:-heading,allowSleep:true,linearDamping:3.8,angularDamping:4});
    const a=register(b,b.createFixture(Box(width/2,length/2),{density:mass/(width*length),friction:.5,restitution:.03}),userData,'prop');a.minY=0;a.maxY=height;return a;
  };
  api.addVehicle=(options={})=>{
    const config={...BASE,...options};
    const {width,length,mass}=config;
    if(!(width>0&&length>0&&mass>0))throw new RangeError('Vehicle dimensions and mass must be positive.');
    const body=rawWorld.createDynamicBody({position:Vec2(options.x||0,options.z||0),angle:-(options.heading||0),bullet:true,allowSleep:false,angularDamping:.65});
    const fixture=body.createFixture(Box(width/2,length/2),{density:mass/(width*length),friction:.22,restitution:.07});
    const actor=register(body,fixture,options.userData,'vehicle');
    Object.assign(actor,{config,width,length,minY:0,maxY:options.height||1.6,elevation:0,isAirborne:false,landGrip:1,controls:{throttle:0,reverse:0,brake:0,steer:0,handbrake:false,boost:false},target:null});
    actor.setControls=(controls={})=>{actor.target=null;Object.assign(actor.controls,controls);};
    const ownTarget={vx:0,vz:0,heading:0,maxAcceleration:undefined};
    actor.setTarget=target=>{ownTarget.vx=target.vx;ownTarget.vz=target.vz;ownTarget.heading=target.heading;ownTarget.maxAcceleration=target.maxAcceleration;actor.target=ownTarget;};
    actor.setPose=({x=0,z=0,heading=0,vx=0,vz=0}={})=>{
      body.setTransform(Vec2(x,z),-heading);body.setLinearVelocity(Vec2(vx,vz));body.setAngularVelocity(0);body.setAwake(true);actor.target=null;
      Object.assign(actor.controls,{throttle:0,reverse:0,brake:0,steer:0,handbrake:false,boost:false});
    };
    Object.defineProperty(actor,'heading',{get(){return -body.getAngle();}});
    Object.defineProperty(actor,'vx',{get(){return body.getLinearVelocity().x;}});
    Object.defineProperty(actor,'vz',{get(){return body.getLinearVelocity().y;}});
    Object.defineProperty(actor,'speed',{get(){const v=body.getLinearVelocity();return Math.hypot(v.x,v.y);}});
    Object.defineProperty(actor,'forwardSpeed',{get(){const v=body.getLinearVelocity(),h=-body.getAngle();return -v.x*Math.sin(h)-v.y*Math.cos(h);}});
    Object.defineProperty(actor,'lateralSpeed',{get(){const v=body.getLinearVelocity(),h=-body.getAngle();return v.x*Math.cos(h)-v.y*Math.sin(h);}});
    Object.defineProperty(actor,'yawRate',{get(){return -body.getAngularVelocity();}});
    actor.copyState=(target={})=>{
      const p=body.getPosition(),v=body.getLinearVelocity(),h=-body.getAngle(),s=Math.sin(h),c=Math.cos(h);
      target.x=p.x;target.z=p.y;target.heading=h;target.vx=v.x;target.vz=v.y;
      target.speed=Math.hypot(v.x,v.y);target.forwardSpeed=-v.x*s-v.y*c;target.lateralSpeed=v.x*c-v.y*s;target.yawRate=-body.getAngularVelocity();
      return target;
    };
    Object.defineProperty(actor,'state',{get(){const p=body.getPosition(),v=body.getLinearVelocity(),h=-body.getAngle(),s=Math.sin(h),c=Math.cos(h);return {x:p.x,z:p.y,heading:h,vx:v.x,vz:v.y,speed:Math.hypot(v.x,v.y),forwardSpeed:-v.x*s-v.y*c,lateralSpeed:v.x*c-v.y*s,yawRate:-body.getAngularVelocity()};}});
    vehicles.push(actor);return actor;
  };
  const fixturesOf=a=>a.fixtures||[a.fixture];
  const heightOf=(a,f)=>a.fixtures?f.getUserData():a;
  const pairAtHeight=(a,fa,b,fb)=>{const ha=heightOf(a,fa),hb=heightOf(b,fb),ay=(a.elevation||0)+(a.groundElevation||0),by=(b.elevation||0)+(b.groundElevation||0);return ay+ha.minY<=by+hb.maxY+.025&&by+hb.minY<=ay+ha.maxY+.025;};
  const overlapFixtures=(a,b,atHeight)=>fixturesOf(a).some(fa=>fixturesOf(b).some(fb=>(!atHeight||pairAtHeight(a,fa,b,fb))&&testOverlap(fa.getShape(),0,fb.getShape(),0,a.body.getTransform(),b.body.getTransform())));
  api.overlaps=(a,b)=>overlapFixtures(a,b,false);
  api.remove=actor=>{rawWorld.destroyBody(actor.body);byRaw.delete(actor.body);const i=vehicles.indexOf(actor);if(i>=0)vehicles.splice(i,1);objects.splice(objects.indexOf(actor),1);};
  // Spawn/ride-change safety must test the same vertical intervals as contacts.
  api.overlapsAtHeight=(a,b)=>overlapFixtures(a,b,true);
  rawWorld.on('pre-solve',contact=>{
    const a=byRaw.get(contact.getFixtureA().getBody()),b=byRaw.get(contact.getFixtureB().getBody());if(!a||!b)return;
    // Only filter this pair. An airborne player must never disable traffic/traffic contacts.
    if((a.rampId&&a.rampId===b.userData?.rampId)||(b.rampId&&b.rampId===a.userData?.rampId)||(a.isAirborne&&a.ignoreRampId&&a.ignoreRampId===b.userData?.rampId)||(b.isAirborne&&b.ignoreRampId&&b.ignoreRampId===a.userData?.rampId)){contact.setEnabled(false);return;}
    // Stunts use a relative height. Map support layers add their world height
    // so a channel vehicle cannot hit street traffic passing over its bridge.
    if(!pairAtHeight(a,contact.getFixtureA(),b,contact.getFixtureB()))contact.setEnabled(false);
  });
  rawWorld.on('post-solve',(contact,impulses)=>{
    const a=byRaw.get(contact.getFixtureA().getBody()),b=byRaw.get(contact.getFixtureB().getBody());
    let impulse=0;for(let i=0;i<impulses.normalImpulses.length;i++)impulse+=impulses.normalImpulses[i];
    if(impulse>30&&api.lastImpacts.length<impactPool.length){const out=impactPool[api.lastImpacts.length];out.a=a;out.b=b;out.impulse=impulse;out.speed=impulse/Math.max(1,a.type==='vehicle'?a.body.getMass():b.body.getMass());contact.getWorldManifold(contactPoint);out.x=contactPoint.points[0].x;out.z=contactPoint.points[0].y;api.lastImpacts.push(out);}
  });

  function controlVehicle(actor,dt){
    const {body,config:c,controls:k,target}=actor;
    if(!body.isActive())return;
    // A flank exit held on the ground (groundHold) keeps the driver's throttle, brake and steer.
    if(actor.isAirborne&&!actor.groundHold){body.applyTorque(body.getInertia()*clamp(-body.getAngularVelocity()*2,-1.5,1.5),true);return;}
    const h=-body.getAngle(),sin=Math.sin(h),cos=Math.cos(h);forward.setNum(-sin,-cos);right.setNum(cos,-sin);
    const velocity=body.getLinearVelocity(),mass=body.getMass();
    if(target){
      // Traffic is a dynamic body. Its route follower supplies a desired velocity,
      // not a new transform. Bounded acceleration lets a player impact displace it.
      const ax=(finite(target.vx,0)-velocity.x)*2.5,az=(finite(target.vz,0)-velocity.y)*2.5;
      const norm=Math.hypot(ax,az),maxA=finite(target.maxAcceleration,4);
      const scale=norm>maxA?maxA/norm:1;
      body.applyForceToCenter(force.setNum(ax*scale*mass,az*scale*mass),true);
      const desired=finite(target.heading,h),error=wrap(desired-h);
      const yaw=clamp(error*3,-1.2,1.2);
      body.applyTorque(body.getInertia()*clamp((-yaw-body.getAngularVelocity())*6,-5,5),true);
      return;
    }
    const vf=velocity.x*forward.x+velocity.y*forward.y,vr=velocity.x*right.x+velocity.y*right.y;
    const throttle=clamp(finite(k.throttle,0),0,1),reverse=clamp(finite(k.reverse,0),0,1),brake=clamp(finite(k.brake,0),0,1);
    let acceleration=0;
    if(throttle){if(vf<-.3)acceleration+=c.brakeAcceleration*throttle;else{const limit=k.boost?c.boostSpeed:c.maxSpeed;acceleration+=(k.boost?c.boostAcceleration:c.acceleration)*throttle*Math.max(0,1-(vf/limit)**2);}}
    if(reverse){if(vf>.4)acceleration-=c.brakeAcceleration*reverse;else acceleration-=c.acceleration*.65*reverse*Math.max(0,1-(vf/c.reverseSpeed)**2);}
    if(brake&&Math.abs(vf)>.01)acceleration-=Math.sign(vf)*Math.min(c.brakeAcceleration*brake,Math.abs(vf)/dt);
    // Rolling/aerodynamic resistance decelerates gradually: releasing boost never
    // clamps speed to a different cap in one frame.
    acceleration-=Math.sign(vf)*Math.min(.22+(actor.surfaceDrag||0)+vf*vf*.0012*(actor.dragMultiplier??1),Math.abs(vf)/dt);
    if(k.handbrake&&Math.abs(vf)>.01)acceleration-=Math.sign(vf)*Math.min(6,Math.abs(vf)/dt);
    const lateralAccel=clamp(-vr*(k.handbrake?1.5:14),-(k.handbrake?3.0:c.grip)*(actor.landGrip??1)*(actor.surfaceGrip??1),(k.handbrake?3.0:c.grip)*(actor.landGrip??1)*(actor.surfaceGrip??1));
    body.applyForceToCenter(force.setNum(mass*(forward.x*acceleration+right.x*lateralAccel),mass*(forward.y*acceleration+right.y*lateralAccel)),true);
    // Kinematic bicycle yaw target with bidirectional low-speed assist and arcade grip authority.
    const steer=clamp(finite(k.steer,0),-1,1);
    const steerAngle=c.steerAngle/(1+Math.abs(vf)/44);
    const dir=vf!==0?Math.sign(vf):(k.throttle?1:(k.reverse?-1:0));
    const effSpeed=dir*Math.max(Math.abs(vf),(k.throttle||k.reverse)?4.5:0);
    const desiredYaw=effSpeed/c.wheelbase*Math.tan(steer*steerAngle);
    const yawLimit=(k.handbrake?28:c.grip)/Math.max(Math.abs(vf),4.5)+(k.handbrake?1.2:0.85);
    const targetYaw=clamp(desiredYaw,-yawLimit,yawLimit);
    body.applyTorque(body.getInertia()*clamp((-targetYaw-body.getAngularVelocity())*(k.handbrake?5.5:8.5),-9.5,9.5),true);
  }

  api.step=(frameDt,beforeStep,afterStep)=>{
    // A bounded backlog prevents a tab-resume spiral; normal 30/60/120 Hz input
    // is accumulated into identical 120 Hz physics steps.
    accumulator+=clamp(finite(frameDt,0),0,maxFrameTime);api.lastImpacts.length=0;
    let steps=0;
    while(accumulator+1e-10>=fixedStep){
      beforeStep?.(fixedStep,simulationTime);
      for(let i=0;i<vehicles.length;i++)controlVehicle(vehicles[i],fixedStep);
      rawWorld.step(fixedStep,8,4);afterStep?.(fixedStep,simulationTime+fixedStep);accumulator-=fixedStep;simulationTime+=fixedStep;steps++;
    }
    api.alpha=clamp(accumulator/fixedStep,0,1);api.simulationTime=simulationTime;return steps;
  };
  return api;
}
