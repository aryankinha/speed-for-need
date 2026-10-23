// Ride-change safety check ("is the new car's footprint inside a world obstacle?").
// It used to run the exact Box2D overlap test against every fixture in the world. Buildings are compound colliders with
// ~540 fixtures each (86,800 in total on the coast map), so one car switch blocked the main thread for ~11 s.
// Static actors get a cached world footprint (union of their obstacle boxes) and are only tested exactly when the new car
// is within reach of that footprint. Anything that can move, or has no box, is still tested exactly every time.
const footprints=new WeakMap();
function footprintsFor(obstacles){
  let entry=footprints.get(obstacles);
  if(entry&&entry.length===obstacles.length)return entry.map;
  const map=new Map();
  for(const {actor,box} of obstacles){
    let info=map.get(actor);
    if(!info){info={always:!(actor.body?.isStatic?.()),minX:Infinity,maxX:-Infinity,minZ:Infinity,maxZ:-Infinity};map.set(actor,info);}
    if(!box){info.always=true;continue;}
    if(box.min.x<info.minX)info.minX=box.min.x;if(box.max.x>info.maxX)info.maxX=box.max.x;
    if(box.min.z<info.minZ)info.minZ=box.min.z;if(box.max.z>info.maxZ)info.maxZ=box.max.z;
  }
  footprints.set(obstacles,{length:obstacles.length,map});return map;
}
/** True when `actor` (a freshly posed vehicle) overlaps any obstacle actor at its height. Same answer as testing them all. */
export function spawnBlocked(physics,obstacles,actor,margin=1){
  const p=actor.body.getPosition(),reach=Math.hypot(actor.width,actor.length)/2+margin;
  for(const [other,info] of footprintsFor(obstacles)){
    if(!info.always&&(info.maxX<p.x-reach||info.minX>p.x+reach||info.maxZ<p.y-reach||info.minZ>p.y+reach))continue;
    if(physics.overlapsAtHeight(actor,other))return true;
  }
  return false;
}
