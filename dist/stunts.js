// Fixed-step arcade jump layer over the existing planar solver. Gravity is game
// tuning; trajectory uses the constant-acceleration equations (NASA Glenn).
export const STUNT_GRAVITY=18.5;
// A reserved two-block strip with no buildings or traffic routes through it.
export const STUNT_AREA=Object.freeze({left:-438,right:-312,top:312,bottom:588,entry:Object.freeze({x:-375,z:580,heading:0})});
export const RAMPS=Object.freeze([
  {id:'ocean',name:'Stunt Park / West',x:-410,z:545,heading:0},
  {id:'civic',name:'Stunt Park / Centre',x:-375,z:545,heading:0},
  {id:'east',name:'Stunt Park / East',x:-340,z:545,heading:0},
].map(r=>Object.freeze({...r,fx:-Math.sin(r.heading),fz:-Math.cos(r.heading)})));
export function rampSurface(shape,progress){return Math.max(0,Math.min(1,progress/shape.slopeRun))*shape.height;}
export function rampProgress(r,x,z){return (x-r.x)*r.fx+(z-r.z)*r.fz;}
export function rampLateral(r,x,z){return (x-r.x)*Math.cos(r.heading)-(z-r.z)*Math.sin(r.heading);}
export class StuntSystem {
  constructor(shape,storage){this.shape=shape;this.storage=storage;this.best=0;this.lastDistance=0;this.landings=0;this.landingImpact=0;try{const value=Number(storage?.getItem('speed-for-need-jump-best'));if(Number.isFinite(value)&&value>0)this.best=value;}catch{}}
  reset(a){Object.assign(a,{elevation:0,prevElevation:0,pitch:0,prevPitch:0,verticalSpeed:0,isAirborne:false,rampId:null,ignoreRampId:null,landGrip:1,landingAge:1,launchX:0,launchZ:0,qualifiedJump:false});this.landingImpact=0;}
  fits(a,r){
    const relative=a.heading-r.heading;
    const halfWidth=(Math.abs(Math.cos(relative))*a.width+Math.abs(Math.sin(relative))*a.length)/2;
    return Math.abs(rampLateral(r,a.x,a.z))+halfWidth<=this.shape.width/2+.025;
  }
  beginStep(a){
    a.prevElevation=a.elevation;a.prevPitch=a.pitch;
    const s=this.shape;
    if(a.isAirborne){
      // Descending onto a deck must ignore its planar solid volume before the
      // solver runs. The vertical step below then resolves the actual surface.
      for(const r of RAMPS){const u=rampProgress(r,a.x,a.z);
        if(u>=0&&u<=s.length&&this.fits(a,r)&&a.elevation>=rampSurface(s,u)-.08){a.ignoreRampId=r.id;break;}
      }
      return;
    }
    if(a.rampId)return;
    for(const r of RAMPS){const u=rampProgress(r,a.x,a.z);
      // The toe works when reversing as well as driving forward. Entry through
      // the elevated back or side remains solid, rather than teleporting up.
      if(u>=-a.length/2-.6&&u<=.5&&Math.abs(Math.cos(a.heading-r.heading))>.82&&this.fits(a,r)){a.rampId=r.id;break;}
    }
  }
  finishLanding(a,height,rampId){
    this.landingImpact=-a.verticalSpeed;a.elevation=height;a.verticalSpeed=0;a.isAirborne=false;a.rampId=rampId;a.ignoreRampId=null;a.landingAge=0;a.landGrip=.2;
    if(a.qualifiedJump){this.lastDistance=Math.hypot(a.x-a.launchX,a.z-a.launchZ);this.landings++;if(this.lastDistance>this.best){this.best=this.lastDistance;try{this.storage?.setItem('speed-for-need-jump-best',String(this.best));}catch{}}}a.qualifiedJump=false;
  }
  step(a,dt){
    if(!(dt>0&&Number.isFinite(dt)))return;
    this.landingImpact=0;a.landingAge+=dt;a.landGrip=Math.min(1,.2+.8*a.landingAge/.12);
    const s=this.shape;
    if(a.isAirborne){
      const previous=a.elevation;
      a.elevation+=a.verticalSpeed*dt-.5*STUNT_GRAVITY*dt*dt;a.verticalSpeed-=STUNT_GRAVITY*dt;
      const target=Math.atan2(a.verticalSpeed,Math.max(a.speed,1));a.pitch+=(target-a.pitch)*(1-Math.exp(-dt*9));
      if(a.verticalSpeed<0){
        for(const r of RAMPS){const u=rampProgress(r,a.x,a.z),height=rampSurface(s,u);
          if(u>=0&&u<=s.length&&this.fits(a,r)&&previous>=height-.08&&a.elevation<=height){this.finishLanding(a,height,r.id);return;}
        }
        if(a.elevation<=0)this.finishLanding(a,0,null);
      }
      return;
    }
    const r=RAMPS.find(r=>r.id===a.rampId);
    if(r){
      const u=rampProgress(r,a.x,a.z);
      if(u<-a.length/2-.7){a.rampId=null;a.ignoreRampId=null;a.elevation=0;}
      else if(!this.fits(a,r)){this.fall(a,0);}
      else if(u>s.length){
        // Traverse the authored flat lip before release. Using velocity along
        // the ramp avoids a backwards vehicle launching in the wrong direction.
        const along=a.vx*r.fx+a.vz*r.fz;
        a.elevation=s.height;
        if(along>0){const cosine=Math.cos(s.angle);a.body.setLinearVelocity({x:a.vx*cosine,y:a.vz*cosine});this.fall(a,along*Math.sin(s.angle));a.qualifiedJump=along>=14;}
      }else{
        a.elevation=rampSurface(s,u);
        const facing=Math.cos(a.heading-r.heading);
        const target=u>0&&u<s.slopeRun?s.angle*facing*Math.min(1,u/1.8):0;
        a.pitch+=(target-a.pitch)*(1-Math.exp(-dt*18));
      }
    }else{a.elevation=0;a.pitch+=(0-a.pitch)*(1-Math.exp(-dt*12));}
  }
  fall(a,vy){a.ignoreRampId=a.rampId;a.isAirborne=true;a.verticalSpeed=vy;a.rampId=null;a.launchX=a.x;a.launchZ=a.z;a.qualifiedJump=false;}
}
