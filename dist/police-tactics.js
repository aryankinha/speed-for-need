// Police tactics: pure decision logic (no three.js, no DOM, no physics import). open-world.js applies the results.
// P.I.T. (star 2+), flanking (star 2+), roadblock (star 3), and the drift-in-sight heat trigger.
// Frame: heading h faces (-sin h, -cos h); right is (cos h, -sin h). Every function writes into caller-owned
// scratch objects or returns numbers, so nothing here allocates per frame.
export const TACTICS=Object.freeze({
  roadHalf:14,
  pit:Object.freeze({
    minStars:2,minPlayerSpeed:12,                 // m/s
    latMin:1.6,latMax:3,lonMin:-2.5,lonMax:.5,    // cop offset from the player: sideways |m|, along-heading m (negative = behind)
    speedDelta:6,cooldown:6,                      // cop speed must be within 6 m/s of the player's; global cooldown (s)
    yawPerSpeed:.16,yawMin:2.5,yawMax:5.2,        // added yaw rate (rad/s) = clamp(.16*speed): a roughly 1 s spin-out, never a flip
    aimTime:.8,pushSpeed:4,copAccel:14,           // the PIT cop drives into the player for aimTime s
  }),
  flank:Object.freeze({minStars:2,side:6,ahead:4,holdTime:1.5}),
  block:Object.freeze({minStars:3,minPlayerSpeed:50/3.6,minAhead:55,maxAhead:110,duration:15,clearance:3,brakeAccel:20}),
  drift:Object.freeze({minLateral:4,minSpeed:15,range:60,facing:.5,interval:3}),
});
const clamp=(v,a,b)=>v<a?a:v>b?b:v;

export const pitEnabled=(stars,cfg=TACTICS.pit)=>stars>=cfg.minStars;
export const flankEnabled=(stars,cfg=TACTICS.flank)=>stars>=cfg.minStars;
export const blockEnabled=(stars,cfg=TACTICS.block)=>stars>=cfg.minStars;

/**
 * P.I.T. check. player {x,z,heading,speed}, cop {x,z,speed}, cooldown = seconds left (<=0 is ready).
 * Returns the side of the player the cop is on (+1 right, -1 left) or 0 when no PIT is available.
 */
export function pitCandidate(player,cop,stars,cooldown,cfg=TACTICS.pit){
  if(stars<cfg.minStars||!(cooldown<=0)||!(player.speed>cfg.minPlayerSpeed))return 0;
  if(!(Math.abs((cop.speed||0)-player.speed)<=cfg.speedDelta))return 0;
  const s=Math.sin(player.heading||0),c=Math.cos(player.heading||0),dx=cop.x-player.x,dz=cop.z-player.z;
  const lon=-dx*s-dz*c,lat=dx*c-dz*s,a=Math.abs(lat);
  if(!(lon>=cfg.lonMin&&lon<=cfg.lonMax&&a>=cfg.latMin&&a<=cfg.latMax))return 0;
  return lat>0?1:-1;
}

/**
 * Angular impulse for a P.I.T.: inertia * added yaw rate, signed so the player's nose swings toward the cop.
 * Planck angle is -heading, so a cop on the right (side +1) gives a positive impulse (heading decreases = right turn).
 */
export function pitYawImpulse(inertia,side,speed,cfg=TACTICS.pit){
  if(!(inertia>0)||!side)return 0;
  return (side>0?1:-1)*inertia*clamp(cfg.yawPerSpeed*(speed||0),cfg.yawMin,cfg.yawMax);
}

/** Aim the PIT cop into the player: player's velocity plus a push toward the player, parallel heading. Writes `out`. */
export function pitAim(cop,player,out,cfg=TACTICS.pit){
  let dx=player.x-cop.x,dz=player.z-cop.z;const n=Math.hypot(dx,dz)||1;dx/=n;dz/=n;
  out.vx=(player.vx||0)+dx*cfg.pushSpeed;out.vz=(player.vz||0)+dz*cfg.pushSpeed;out.heading=player.heading||0;out.maxAcceleration=cfg.copAccel;out.mode='pit';
  return out;
}

/** Signed road margin (m) of a point: roadHalf minus the distance to the nearest road centre line (higher = more road). */
export function roadMargin(x,z,roads,half=TACTICS.roadHalf){
  let dx=Infinity,dz=Infinity;
  for(let i=0;i<roads.roadsX.length;i++){const d=Math.abs(x-roads.roadsX[i]);if(d<dx)dx=d;}
  for(let i=0;i<roads.roadsZ.length;i++){const d=Math.abs(z-roads.roadsZ[i]);if(d<dz)dz=d;}
  return half-Math.min(dx,dz);
}

/** Side (+1 right, -1 left) of the player with more road at the flank point; right on a tie. */
export function flankSide(player,roads,cfg=TACTICS.flank,half=TACTICS.roadHalf){
  const h=player.heading||0,s=Math.sin(h),c=Math.cos(h),fx=-s*cfg.ahead,fz=-c*cfg.ahead,rx=c*cfg.side,rz=-s*cfg.side;
  const right=roadMargin(player.x+fx+rx,player.z+fz+rz,roads,half),left=roadMargin(player.x+fx-rx,player.z+fz-rz,roads,half);
  return left>right?-1:1;
}

/** Point `ahead` m in front of the player and `side` m to the requested side (+1 right, -1 left). Writes out.x/out.z. */
export function flankPoint(player,side,out,cfg=TACTICS.flank){
  const h=player.heading||0,s=Math.sin(h),c=Math.cos(h),k=side<0?-cfg.side:cfg.side;
  out.x=player.x-s*cfg.ahead+c*k;out.z=player.z-c*cfg.ahead-s*k;
  return out;
}

/** True when (x,z) lies on a road segment (within roadHalf-2 of a road centre line, as pursuitTarget treats "on road"). */
export function onRoad(x,z,roads,half=TACTICS.roadHalf){
  const h=half-2;
  for(let i=0;i<roads.roadsX.length;i++)if(Math.abs(x-roads.roadsX[i])<h)return true;
  for(let i=0;i<roads.roadsZ.length;i++)if(Math.abs(z-roads.roadsZ[i])<h)return true;
  return false;
}

/**
 * Roadblock check for a pursuing cop. Allowed only when the player is above 50 km/h, the cop is 55-110 m ahead along the
 * player's heading (within a road width sideways), sits on a road, and `isBlocked(x,z)` (static obstacle within 3 m) is false.
 * Writes {x,z,heading} (the cop's own position, heading across the player's) into `out` and returns it, or returns null.
 */
export function roadblockPoint(cop,player,roads,isBlocked,out,cfg=TACTICS.block){
  if(!(player.speed>cfg.minPlayerSpeed))return null;
  const h=player.heading||0,s=Math.sin(h),c=Math.cos(h),dx=cop.x-player.x,dz=cop.z-player.z;
  const ahead=-dx*s-dz*c,lat=dx*c-dz*s;
  if(!(ahead>=cfg.minAhead&&ahead<=cfg.maxAhead&&Math.abs(lat)<=TACTICS.roadHalf))return null;
  if(!onRoad(cop.x,cop.z,roads)||(isBlocked&&isBlocked(cop.x,cop.z,cfg.clearance)))return null;
  out.x=cop.x;out.z=cop.z;out.heading=h+Math.PI/2;
  return out;
}

/** Hold-still target for a blocking cop. Writes `out`. */
export function blockTarget(heading,out,cfg=TACTICS.block){
  out.vx=0;out.vz=0;out.heading=heading;out.maxAcceleration=cfg.brakeAccel;out.mode='block';
  return out;
}

/**
 * Drift-in-sight heat trigger. update() returns true (once per `interval` s) when the player is drifting
 * (lateral speed above 4 m/s at over 15 m/s) and a stood-down cop (`leaving>0`, i.e. not pursuing) is within 60 m
 * and ahead of the player (normalised offset . heading > .5).
 */
export class DriftSighting{
  constructor(){this.clock=0;}
  reset(){this.clock=0;}
  update(dt,player,cops,cfg=TACTICS.drift){
    if(this.clock>0)this.clock-=dt;
    if(this.clock>0||!(Math.abs(player.lateralSpeed||0)>cfg.minLateral&&(player.speed||0)>cfg.minSpeed))return false;
    const h=player.heading||0,fx=-Math.sin(h),fz=-Math.cos(h);
    for(let i=0;i<cops.length;i++){
      const cop=cops[i];if(!(cop.leaving>0))continue;
      const dx=cop.x-player.x,dz=cop.z-player.z,d=Math.hypot(dx,dz);
      if(d>0&&d<=cfg.range&&(dx*fx+dz*fz)/d>cfg.facing){this.clock=cfg.interval;return true;}
    }
    return false;
  }
}
