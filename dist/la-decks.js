/**
 * Analytical 2.5D support surfaces, in metres, for the LA river channel.
 * This selects a support layer; it is not a 3D rigid-body solver. The caller
 * tracks groundElevation separately from StuntSystem's relative elevation.
 */
export const LA_CHANNEL=Object.freeze({x:-600,halfWidth:80,bedHalfWidth:50,depth:5,start:150,entryEnd:300,exitStart:1050,end:1150});
export const LA_BRIDGES=Object.freeze([450,750].map(z=>Object.freeze({x:LA_CHANNEL.x,z,halfWidth:18,left:LA_CHANNEL.x-LA_CHANNEL.halfWidth,right:LA_CHANNEL.x+LA_CHANNEL.halfWidth,height:0})));
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

/** The continuous channel floor/bank profile, without bridge decks. */
export function getChannelHeight(x,z){
  const c=LA_CHANNEL;
  if(!Number.isFinite(x)||!Number.isFinite(z)||z<=c.start||z>=c.end)return 0;
  const lateral=clamp((c.halfWidth-Math.abs(x-c.x))/(c.halfWidth-c.bedHalfWidth),0,1);
  const longitudinal=Math.min(clamp((z-c.start)/(c.entryEnd-c.start),0,1),clamp((c.end-z)/(c.end-c.exitStart),0,1));
  return -c.depth*lateral*longitudinal;
}

function channelLayer(actor){
  if(actor?.groundLayer==='channel')return true;
  if(actor?.groundLayer==='street')return false;
  // Preserve the already selected layer under a bridge, including a stopped
  // car or one that changes heading. Position alone cannot distinguish layers.
  const previous=Number.isFinite(actor?.groundElevation)?actor.groundElevation:actor?.prevGroundElevation;
  if(Number.isFinite(previous))return previous < -1;
  // For a fresh placement with no height history, the crossing road runs E/W.
  // Heading 0 faces -z; pi/2 and -pi/2 follow the bridge road.
  return Number.isFinite(actor?.heading)&&Math.abs(Math.cos(actor.heading))>Math.abs(Math.sin(actor.heading));
}

/**
 * Highest support if actor is omitted. With an actor, current/previous
 * groundElevation retains the chosen deck; heading resolves fresh placements.
 * Passing groundLayer explicitly is useful for spawn points. No actor mutation.
 */
export function getDeckHeight(x,z,actor){
  const floor=getChannelHeight(x,z);
  if(floor===0)return 0;
  for(const bridge of LA_BRIDGES){
    if(Math.abs(z-bridge.z)<=bridge.halfWidth&&x>=bridge.left&&x<=bridge.right)return channelLayer(actor)?floor:bridge.height;
  }
  return floor;
}

/** Body pitch/roll from its four support samples; no allocations beyond result. */
export function getDeckPose(actor){
  const {x=0,z=0,heading=0}=actor||{},halfLength=(actor?.length||4.5)/2,halfWidth=(actor?.width||1.9)/2;
  const fx=-Math.sin(heading),fz=-Math.cos(heading),rx=Math.cos(heading),rz=-Math.sin(heading);
  const front=getDeckHeight(x+fx*halfLength,z+fz*halfLength,actor),rear=getDeckHeight(x-fx*halfLength,z-fz*halfLength,actor);
  const left=getDeckHeight(x-rx*halfWidth,z-rz*halfWidth,actor),right=getDeckHeight(x+rx*halfWidth,z+rz*halfWidth,actor);
  return {height:getDeckHeight(x,z,actor),pitch:Math.atan2(front-rear,halfLength*2),roll:Math.atan2(left-right,halfWidth*2)};
}
