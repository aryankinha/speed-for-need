// Fixed-step arcade jump layer over the existing planar solver. Gravity is game
// tuning; trajectory uses the constant-acceleration equations (NASA Glenn).
export const STUNT_GRAVITY=18.5;
export const RAMPS=Object.freeze([
  {id:'ocean',name:'Ocean Drive',x:-450,z:-80,heading:0},
  {id:'civic',name:'Civic Boulevard',x:0,z:100,heading:Math.PI},
  {id:'east',name:'East Boulevard',x:150,z:250,heading:0},
].map(r=>Object.freeze({...r,fx:-Math.sin(r.heading),fz:-Math.cos(r.heading)})));
export function rampProgress(r,x,z){return (x-r.x)*r.fx+(z-r.z)*r.fz;}
export function rampLateral(r,x,z){return (x-r.x)*Math.cos(r.heading)-(z-r.z)*Math.sin(r.heading);}
export class StuntSystem {
  constructor(shape,storage){this.shape=shape;this.storage=storage;this.best=0;this.lastDistance=0;this.landings=0;this.landingImpact=0;try{const value=Number(storage?.getItem('speed-for-need-jump-best'));if(Number.isFinite(value)&&value>0)this.best=value;}catch{}}
  reset(a){Object.assign(a,{elevation:0,prevElevation:0,pitch:0,prevPitch:0,verticalSpeed:0,isAirborne:false,rampId:null,ignoreRampId:null,landGrip:1,landingAge:1,launchX:0,launchZ:0,qualifiedJump:false});this.landingImpact=0;}
  beginStep(a){
    a.prevElevation=a.elevation;a.prevPitch=a.pitch;
    if(a.isAirborne||a.rampId)return;
    const s=this.shape,fh=-Math.sin(a.heading),fz=-Math.cos(a.heading);
    for(const r of RAMPS){const u=rampProgress(r,a.x,a.z),w=Math.abs(rampLateral(r,a.x,a.z));
      // Arm as the nose reaches the toe, before Planck sees the ramp volume.
      // Full vehicle width must fit, and entry from the high lip is disallowed.
      if(u>=-a.length/2-.6&&u<=s.slopeRun*.25&&w<=(s.width-a.width)/2&&fh*r.fx+fz*r.fz>.82&&a.forwardSpeed>=-.1){a.rampId=r.id;break;}
    }
  }
  step(a,dt){
    if(!(dt>0&&Number.isFinite(dt)))return;
    this.landingImpact=0;a.landingAge+=dt;a.landGrip=Math.min(1,.2+.8*a.landingAge/.12);
    const s=this.shape;
    if(a.isAirborne){
      // Exact constant-acceleration integration, independent of render rate.
      a.elevation+=a.verticalSpeed*dt-.5*STUNT_GRAVITY*dt*dt;a.verticalSpeed-=STUNT_GRAVITY*dt;
      const target=Math.atan2(a.verticalSpeed,Math.max(a.speed,1));a.pitch+=(target-a.pitch)*(1-Math.exp(-dt*9));
      if(a.elevation<=0&&a.verticalSpeed<0){
        this.landingImpact=-a.verticalSpeed;a.elevation=0;a.verticalSpeed=0;a.isAirborne=false;a.rampId=null;a.ignoreRampId=null;a.landingAge=0;a.landGrip=.2;
        if(a.qualifiedJump){this.lastDistance=Math.hypot(a.x-a.launchX,a.z-a.launchZ);this.landings++;if(this.lastDistance>this.best){this.best=this.lastDistance;try{this.storage?.setItem('speed-for-need-jump-best',String(this.best));}catch{}}}a.qualifiedJump=false;
      }
      return;
    }
    const r=RAMPS.find(r=>r.id===a.rampId);
    if(r){
      const u=rampProgress(r,a.x,a.z),w=Math.abs(rampLateral(r,a.x,a.z));
      if(u<-a.length/2-.7){a.rampId=null;a.elevation=0;}
      else if(w>(s.width-a.width)/2+.1){this.fall(a,0);}
      else if(u>=s.slopeRun){
        const speed=a.speed,along=a.vx*r.fx+a.vz*r.fz,angle=Math.atan2(s.height,s.slopeRun);
        a.elevation=s.height;
        if(along>0){const cosine=Math.cos(angle);a.body.setLinearVelocity({x:a.vx*cosine,y:a.vz*cosine});this.fall(a,speed*Math.sin(angle));a.qualifiedJump=along>=14;}
        else a.pitch+=(0-a.pitch)*(1-Math.exp(-dt*12));
      }else{a.elevation=Math.max(0,u)/s.slopeRun*s.height;a.pitch=Math.atan2(s.height,s.slopeRun)*Math.min(1,Math.max(0,u)/1.8);}
    }else{a.elevation=0;a.pitch+=(0-a.pitch)*(1-Math.exp(-dt*12));}
  }
  fall(a,vy){a.ignoreRampId=a.rampId;a.isAirborne=true;a.verticalSpeed=vy;a.rampId=null;a.launchX=a.x;a.launchZ=a.z;a.qualifiedJump=false;}
}
