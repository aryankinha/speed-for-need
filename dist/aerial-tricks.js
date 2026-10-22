// Arcade presentation over the unchanged planar collider. Keep an unwrapped
// angle: quaternions at 0 and 2π are identical, so slerping them loses a full turn.
export const FULL_TURN=Math.PI*2;
export function ballisticFlightTime(height,verticalSpeed,gravity){
  if(!(Number.isFinite(height)&&height>=0&&Number.isFinite(verticalSpeed)&&gravity>0&&Number.isFinite(gravity)))return 0;
  return Math.max(0,(verticalSpeed+Math.sqrt(verticalSpeed*verticalSpeed+2*gravity*height))/gravity);
}
export function resetAerialTrick(a){
  Object.assign(a,{prevTrickYaw:0,trickYaw:0,prevTrickRoll:0,trickRoll:0,activeTrick:null,trickElapsed:0,trickDuration:0});
}
export function startAerialTrick(a,kind,gravity){
  resetAerialTrick(a);
  if(!a.isAirborne||!a.qualifiedJump||!['spin','roll'].includes(kind))return false;
  const flight=ballisticFlightTime(a.elevation,a.verticalSpeed,gravity);
  if(flight<.6)return false;
  a.activeTrick=kind;a.trickDuration=flight*.8;
  return true;
}
export function stepAerialTrick(a,dt){
  if(!a.activeTrick||!(Number.isFinite(dt)&&dt>0))return;
  a.trickElapsed=Math.min(a.trickDuration,a.trickElapsed+dt);
  const t=a.trickElapsed/a.trickDuration,angle=FULL_TURN*t*t*(3-2*t);
  if(a.activeTrick==='spin')a.trickYaw=angle;else a.trickRoll=angle;
}
export function finishAerialTrick(a){
  const completed=a.activeTrick&&a.trickElapsed>=a.trickDuration-1e-9?a.activeTrick:null;
  a.lastTrick=completed;
  if(completed){a.completedTricks=(a.completedTricks||0)+1;a.activeTrick=null;}
  else resetAerialTrick(a);
  // Completed angles remain 2π through landing. Resetting them to zero here
  // would interpolate backwards through an entire revolution for one frame.
  return completed;
}
