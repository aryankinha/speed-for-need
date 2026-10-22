import {resetAerialTrick,startAerialTrick,stepAerialTrick,finishAerialTrick} from './aerial-tricks.js';
import {RAMP_SHAPES,rampColliderVertices} from './ramp-shapes.js';
// A car is carried up the deck when its inner edge is at least this far over the deck. Anything less grazes the
// chamfered toe, which deflects it outward instead of stopping it. Outboard overhang is shown as a lean.
export const ENTRY_OVERLAP=.3;
// Fixed-step arcade jump layer over the existing planar solver. Gravity is game
// tuning; trajectory uses the constant-acceleration equations (NASA Glenn).
export const STUNT_GRAVITY=18.5;
// A reserved two-block strip with no buildings or traffic routes through it.
export const STUNT_AREA=Object.freeze({left:-438,right:-312,top:312,bottom:588,entry:Object.freeze({x:-375,z:580,heading:0})});
// Order is stable: the first three are the original jump, spin and roll lanes.
export const RAMPS=Object.freeze([
  {id:'ocean',name:'Stunt Park / Jump',label:'JUMP',x:-410,z:545,heading:0,trick:null,shape:RAMP_SHAPES.standard},
  {id:'civic',name:'Stunt Park / 360 Spin',label:'360 SPIN',x:-375,z:545,heading:0,trick:'spin',variant:'spin',hintPad:true,shape:RAMP_SHAPES.standard},
  {id:'east',name:'Stunt Park / Barrel Roll',label:'BARREL ROLL',x:-340,z:545,heading:0,trick:'roll',hintPad:true,shape:RAMP_SHAPES.standard},
  {id:'kicker',name:'Stunt Park / Kicker',label:'KICKER',x:-428,z:430,heading:0,trick:null,shape:RAMP_SHAPES.kicker},
  {id:'mega',name:'Stunt Park / Mega Ramp',label:'MEGA RAMP',x:-355,z:500,heading:0,trick:null,shape:RAMP_SHAPES.mega},
  // Perimeter road: sits in the lane traffic does not use (traffic runs at x=-445.7), 20 m past its boost pad.
  {id:'roadspin',name:'Perimeter Road / 360 Spin',label:'360 SPIN',x:-455,z:-95,heading:0,trick:'spin',variant:'spin',hintPad:true,shape:RAMP_SHAPES.standard},
].map(r=>Object.freeze({...r,fx:-Math.sin(r.heading),fz:-Math.cos(r.heading)})));
export function rampSurface(shape,progress){return Math.max(0,Math.min(1,progress/shape.slopeRun))*shape.height;}
export function rampProgress(r,x,z){return (x-r.x)*r.fx+(z-r.z)*r.fz;}
export function rampLateral(r,x,z){return (x-r.x)*Math.cos(r.heading)-(z-r.z)*Math.sin(r.heading);}
// Car geometry for the deck pose: wheelbase from the vehicle tuning, track is the car width.
const DEFAULT_WHEELBASE=2.7;
// A wheel running off the flank is only supported by asphalt. While the deck under it is above this height (metres)
// the car is not supported and tips off, so no wheel hovers over empty space.
export const HOVER_LIMIT=.15;
// Longest a flank exit may hold the car at ground height while it still overlaps the deck (seconds).
export const HOLD_LIMIT=.35;
// The outward push keeps going after the driver's control window, until the car clears the solid or this runs out.
const HOLD_FAILSAFE=1.5;
// Largest downward change of the body per 120 Hz step while settling on the deck (metres).
const DESCENT_PER_STEP=.1;
// Lean (radians) given to a car that tips off a flank. It eases back to level while airborne.
const TIP_LEAN=.25;
// Deck height under a ramp-frame point. Zero beside the deck (no shoulder support) and beyond its ends, except
// the lip band the front bumper may bridge before launch.
export function surfaceHeight(r,u,l,lip=0){if(u<0||u>r.shape.length+lip||Math.abs(l)>r.shape.width/2)return 0;return rampSurface(r.shape,Math.min(u,r.shape.length));}
// Roll (radians) from the mean heights under the right and left wheels. Positive lifts the right side, like visual.rotation.z.
export function leanForWheels(rightHeight,leftHeight,track){return Math.atan2(rightHeight-leftHeight,2*track);}
// Index of a ramp by id without a closure: the fixed step runs at 120 Hz.
export function rampIndexById(id){for(let i=0;i<RAMPS.length;i++)if(RAMPS[i].id===id)return i;return -1;}
// Reach of a car's footprint along the ramp's lateral and up-deck axes. Scalars, so the fixed step allocates nothing.
export function reachLateral(a,r){const relative=a.heading-r.heading;return (Math.abs(Math.cos(relative))*a.width+Math.abs(Math.sin(relative))*a.length)/2;}
export function reachProgress(a,r){const relative=a.heading-r.heading;return (Math.abs(Math.sin(relative))*a.width+Math.abs(Math.cos(relative))*a.length)/2;}
// Can the car be supported on this deck? A wheel running off the flank rests on asphalt, and that is only allowed
// while the deck beside it is below the hover limit. Used to settle on the deck and to accept a landing on it.
export function wheelsSupported(a,r){
  const rel=a.heading-r.heading,c=Math.cos(rel),sn=Math.sin(rel);
  const cu=rampProgress(r,a.x,a.z),cl=rampLateral(r,a.x,a.z);
  const fo=(a.config?.wheelbase??DEFAULT_WHEELBASE)/2,tw=a.width/2,half=r.shape.width/2,L=r.shape.length,lip=a.length/2;
  const fwdU=cu+fo*c,fwdL=cl-fo*sn,rearU=cu-fo*c,rearL=cl+fo*sn;
  for(let k=-1;k<=1;k+=2){
    const fu=fwdU+k*tw*sn,fl=fwdL+k*tw*c,ru=rearU+k*tw*sn,rl=rearL+k*tw*c;
    if(Math.abs(fl)>half&&fu>=0&&fu<=L+lip&&rampSurface(r.shape,Math.min(fu,L))>HOVER_LIMIT)return false;
    if(Math.abs(rl)>half&&ru>=0&&ru<=L+lip&&rampSurface(r.shape,Math.min(ru,L))>HOVER_LIMIT)return false;
  }
  return true;
}
// Body pose on the incline. Pitch comes from the front bumper and the rear axle, so the nose rises as soon as the
// bumper reaches the incline; roll comes from the wheels. The body is then lifted until every corner sits on the
// deck or, beside or beyond it, on asphalt. Returns false when a wheel running off the flank is over the limit: the
// car is no longer supported and must tip off. Writes a.elevation, a.pitch and a.deckLean only on success.
function settleOnDeck(a,r){
  const rel=a.heading-r.heading,c=Math.cos(rel),sn=Math.sin(rel);
  const cu=rampProgress(r,a.x,a.z),cl=rampLateral(r,a.x,a.z);
  const wb=a.config?.wheelbase??DEFAULT_WHEELBASE,fo=wb/2,tw=a.width/2,hl=a.length/2,hw=a.width/2;
  const L=r.shape.length,lip=hl,half=r.shape.width/2;
  // Car forward maps to (progress,lateral) = (c,-sn); car right maps to (sn,c).
  const fwdU=cu+fo*c,fwdL=cl-fo*sn,rearU=cu-fo*c,rearL=cl+fo*sn;
  const hFL=surfaceHeight(r,fwdU-tw*sn,fwdL-tw*c,lip),hFR=surfaceHeight(r,fwdU+tw*sn,fwdL+tw*c,lip);
  const hRL=surfaceHeight(r,rearU-tw*sn,rearL-tw*c,lip),hRR=surfaceHeight(r,rearU+tw*sn,rearL+tw*c,lip);
  // A wheel off the flank rests on asphalt; if the deck beside it is higher than the hover limit, the car tips off.
  if(!wheelsSupported(a,r))return false;
  // Pitch: front bumper corners against the rear axle.
  // The higher side carries each end, so a corner running off the flank does not halve the support in one step.
  const frontH=Math.max(surfaceHeight(r,cu+hl*c-hw*sn,cl-hl*sn-hw*c,lip),surfaceHeight(r,cu+hl*c+hw*sn,cl-hl*sn+hw*c,lip));
  const rearH=Math.max(hRL,hRR);
  const tanP=(frontH-rearH)/(hl+fo),pitch=Math.atan(tanP),e0=rearH+fo*tanP;
  // Roll from the rear axle: its two wheels then lie exactly on the body plane (the outer one on asphalt).
  const roll=leanForWheels(hRR,hRL,tw),tanR=Math.tan(roll);
  // Corners: over the deck they must stay on it; beside or beyond the deck they must stay above asphalt.
  let lift=0;
  for(let sf=-1;sf<=1;sf+=2)for(let sl=-1;sl<=1;sl+=2){
    const f=sf*hl,k=sl*hw;
    const cuC=cu+f*c+k*sn,clC=cl-f*sn+k*c;
    const required=(Math.abs(clC)<=half&&cuC>=0&&cuC<=L)?rampSurface(r.shape,cuC):0;
    lift=Math.max(lift,required-(e0+f*tanP+k*tanR));
  }
  // An outer wheel whose resting plane height is above the hover limit is unsupported: the car tips off.
  const eF=e0+lift;
  for(let sf=-1;sf<=1;sf+=2)for(let sk=-1;sk<=1;sk+=2){
    const f=sf*fo,k=sk*tw;
    const wu=cu+f*c+k*sn,wl=cl-f*sn+k*c;
    if(Math.abs(wl)>half&&wu>=0&&wu<=L+lip&&eF+f*tanP+k*tanR>HOVER_LIMIT)return false;
  }
  // Descent is rate-limited so the body eases down; ascent is never limited, so it cannot sink into the incline.
  const target=eF;
  a.elevation=target<a.elevation?Math.max(target,a.elevation-DESCENT_PER_STEP):target;a.pitch=pitch;a.deckLean=roll;
  return true;
}
// One convex, chamfered collider per ramp, sized from its own profile. The game world and the tests share this.
export function addRampColliders(physics,ramps=RAMPS){
  return ramps.map(r=>{const actor=physics.addPolygon({x:r.x,z:r.z,heading:r.heading,vertices:rampColliderVertices(r.shape),userData:{kind:'stunt-ramp',rampId:r.id}});actor.maxY=r.shape.height+.025;return actor;});
}
export class StuntSystem {
  constructor(shape,storage){this.shape=shape;this.storage=storage;this.best=0;this.lastDistance=0;this.landings=0;this.landingImpact=0;this.notice='';this.noticeSerial=0;try{const value=Number(storage?.getItem('speed-for-need-jump-best'));if(Number.isFinite(value)&&value>0)this.best=value;}catch{}}
  reset(a){Object.assign(a,{elevation:0,prevElevation:0,pitch:0,prevPitch:0,verticalSpeed:0,isAirborne:false,rampId:null,ignoreRampId:null,landGrip:1,landingAge:1,holdTime:0,holdImpact:0,groundHold:false,deckLean:0,launchX:0,launchZ:0,qualifiedJump:false,lastTrick:null,completedTricks:0});resetAerialTrick(a);this.landingImpact=0;}
  fits(a,r){
    const relative=a.heading-r.heading;
    const halfWidth=(Math.abs(Math.cos(relative))*a.width+Math.abs(Math.sin(relative))*a.length)/2;
    return Math.abs(rampLateral(r,a.x,a.z))-halfWidth<=(r.shape||this.shape).width/2-ENTRY_OVERLAP;
  }
  beginStep(a){
    a.prevElevation=a.elevation;a.prevPitch=a.pitch;a.prevTrickYaw=a.trickYaw;a.prevTrickRoll=a.trickRoll;
    const s=this.shape;
    if(a.isAirborne){
      // Descending onto a deck must ignore its planar solid volume before the
      // solver runs. The vertical step below then resolves the actual surface.
      for(let ri=0;ri<RAMPS.length;ri++){const r=RAMPS[ri];const u=rampProgress(r,a.x,a.z);
        if(u>=0&&u<=r.shape.length&&this.fits(a,r)&&a.elevation>=rampSurface(r.shape,u)-.08){a.ignoreRampId=r.id;break;}
      }
      return;
    }
    if(a.rampId)return;
    for(let ri=0;ri<RAMPS.length;ri++){const r=RAMPS[ri];const u=rampProgress(r,a.x,a.z);
      // The toe works when reversing as well as driving forward. Entry through
      // the elevated back or side remains solid, rather than teleporting up.
      if(u>=-a.length/2-.6&&u<=.5&&Math.abs(Math.cos(a.heading-r.heading))>.5&&this.fits(a,r)){a.rampId=r.id;if(r.trick&&a.speed<14)this.say(r.hintPad?'NEED MORE SPEED - USE A BOOST PAD':'NEED MORE SPEED');break;}
    }
  }
  finishLanding(a,height,rampId){
    const done=finishAerialTrick(a);if(done==='spin')this.say('360!');else if(done==='roll')this.say('BARREL ROLL!');
    this.landingImpact=Math.max(-a.verticalSpeed,a.holdImpact||0);a.holdImpact=0;a.groundHold=false;a.elevation=height;a.verticalSpeed=0;a.isAirborne=false;a.holdTime=0;a.rampId=rampId;a.ignoreRampId=null;a.landingAge=0;a.landGrip=.2;
    if(a.qualifiedJump){this.lastDistance=Math.hypot(a.x-a.launchX,a.z-a.launchZ);this.landings++;if(this.lastDistance>this.best){this.best=this.lastDistance;try{this.storage?.setItem('speed-for-need-jump-best',String(this.best));}catch{}}}a.qualifiedJump=false;
  }
  step(a,dt){
    if(!(dt>0&&Number.isFinite(dt)))return;
    this.landingImpact=0;a.landingAge+=dt;a.landGrip=Math.min(1,.2+.8*a.landingAge/.12);
    const s=this.shape;
    if(a.isAirborne){
      stepAerialTrick(a,dt);
      const previous=a.elevation;
      a.elevation+=a.verticalSpeed*dt-.5*STUNT_GRAVITY*dt*dt;a.verticalSpeed-=STUNT_GRAVITY*dt;
      const target=Math.atan2(a.verticalSpeed,Math.max(a.speed,1));a.pitch+=(target-a.pitch)*(1-Math.exp(-dt*9));a.deckLean+=(0-a.deckLean)*(1-Math.exp(-dt*4));
      if(a.verticalSpeed<0){
        for(let ri=0;ri<RAMPS.length;ri++){const r=RAMPS[ri];const u=rampProgress(r,a.x,a.z),height=rampSurface(r.shape,u);
          if(u>=0&&u<=r.shape.length&&this.fits(a,r)&&previous>=height-.08&&a.elevation<=height&&wheelsSupported(a,r)&&settleOnDeck(a,r)){this.finishLanding(a,a.elevation,r.id);return;}
        }
        if(a.elevation<=0)this.groundOrHold(a,dt);
      }
      return;
    }
    const ri=rampIndexById(a.rampId),r=ri>=0?RAMPS[ri]:null;
    if(r){
      const s=r.shape,u=rampProgress(r,a.x,a.z);
      if(u<-a.length/2-.7){a.rampId=null;a.ignoreRampId=null;a.elevation=0;}
      else if(!this.fits(a,r)){this.leaveDeck(a,r);}
      else if(u>s.length){
        // Traverse the authored flat lip before release. Using velocity along
        // the ramp avoids a backwards vehicle launching in the wrong direction.
        // The settled height carries into the flight; forcing the lip height here popped the body.
        const along=a.vx*r.fx+a.vz*r.fz;
        if(along>0){const cosine=Math.cos(s.angle);a.body.setLinearVelocity({x:a.vx*cosine,y:a.vz*cosine});this.fall(a,along*Math.sin(s.angle));a.qualifiedJump=along>=14;startAerialTrick(a,r.trick,STUNT_GRAVITY);if(r.trick&&along<14)this.say(r.hintPad?'NEED MORE SPEED - USE A BOOST PAD':'NEED MORE SPEED');}
      }else if(!settleOnDeck(a,r)){this.leaveDeck(a,r);}
    }else{a.elevation=0;a.deckLean=0;a.pitch+=(0-a.pitch)*(1-Math.exp(-dt*12));}
  }
  fall(a,vy){resetAerialTrick(a);a.ignoreRampId=a.rampId;a.isAirborne=true;a.verticalSpeed=vy;a.rampId=null;a.launchX=a.x;a.launchZ=a.z;a.qualifiedJump=false;a.holdTime=0;a.holdImpact=0;a.groundHold=false;}
  // Sliding off a flank keeps the current height and pitch. Along-slope speed becomes vertical speed,
  // so gravity continues the arc from where the car is instead of dropping it with zero speed.
  leaveDeck(a,r){
    const along=a.vx*r.fx+a.vz*r.fz;
    this.fall(a,along*Math.sin(r.shape.angle));
    // The car tips toward the side it was running off (right side dips for +lateral, as visual.rotation.z).
    a.deckLean=(rampLateral(r,a.x,a.z)>0?-1:1)*TIP_LEAN;
  }
  // Does the car's footprint still overlap the solid deck (rectangle, ignoring the chamfer)?
  overlapsDeck(a,r){
    const lateral=rampLateral(r,a.x,a.z),progress=rampProgress(r,a.x,a.z),half=r.shape.width/2,rl=reachLateral(a,r),rp=reachProgress(a,r);
    return lateral+rl>-half&&lateral-rl<half&&progress+rp>0&&progress-rp<r.shape.length;
  }
  // Short HUD notice; the game shows the latest one for a few seconds.
  say(text){this.notice=text;this.noticeSerial++;}
  // Touchdown while the car still overlaps a deck it has left. Hold it at ground height for at most HOLD_LIMIT
  // seconds with the driver in control (the physics step reads groundHold), and ease it outward by its lateral
  // velocity only. The impact is carried to finishLanding instead of being zeroed.
  groundOrHold(a,dt){
    const ri=rampIndexById(a.ignoreRampId),r=ri>=0?RAMPS[ri]:null;
    if(r&&a.holdTime<HOLD_FAILSAFE&&this.overlapsDeck(a,r)){
      if(a.holdTime===0)a.holdImpact=Math.max(a.holdImpact||0,-a.verticalSpeed);
      const c=Math.cos(r.heading),s=Math.sin(r.heading),side=rampLateral(r,a.x,a.z)>=0?1:-1,push=2.5;
      const along=a.vx*c-a.vz*s;
      a.holdTime+=Number.isFinite(dt)?Math.max(0,dt):0;a.groundHold=a.holdTime<HOLD_LIMIT;a.elevation=0;a.verticalSpeed=0;
      a.body.setLinearVelocity({x:a.vx-along*c+side*push*c,y:a.vz+along*s-side*push*s});
      return;
    }
    this.finishLanding(a,0,null);
  }
}
