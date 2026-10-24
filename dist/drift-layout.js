import {CircuitPath} from './race-track.js';
import {DRIFT_TRACK_DATA as DATA} from './drift-track-data.js';
export {DRIFT_TRACK_DATA} from './drift-track-data.js';
// glTF linear units are metres. No fit-to-box normalisation is applied.
export const DRIFT_PATH=new CircuitPath({x:0,z:0,waypoints:DATA.route,width:12});
const spawn=DRIFT_PATH.sampleAtDistance(0,{});
export const DRIFT_WORLD=Object.freeze({left:DATA.terrainBounds[0],right:DATA.terrainBounds[2],top:DATA.terrainBounds[1],bottom:DATA.terrainBounds[3],shore:DATA.terrainBounds[0],roadsX:[-100,0,100],roadsZ:[-120,0,120,200],spawn:{x:spawn.x,z:spawn.z,heading:spawn.heading}});
export const DRIFT_GATES=Object.freeze(Array.from({length:12},(_,i)=>{const p=DRIFT_PATH.sampleAtDistance(i*DRIFT_PATH.length/12,{});return [p.x,p.z];}));
export const DRIFT_DESTINATIONS=[{id:'grid',name:'Start / Finish Straight',...DRIFT_WORLD.spawn},...['North Sweep','Technical Infield','South Hairpin'].map((name,i)=>{const p=DRIFT_PATH.sampleAtDistance([.25,.55,.88][i]*DRIFT_PATH.length,{});return {id:'drift-'+i,name,x:p.x,z:p.z,heading:p.heading};})];
const ROAD={kind:'road',height:DATA.roadY,grip:1,drag:0},OFFROAD={kind:'gravel',height:0,grip:.78,drag:1.1};
function inside(ring,x,z){let hit=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],b=ring[j];if((a[1]>z)!==(b[1]>z)&&x<(b[0]-a[0])*(z-a[1])/(b[1]-a[1])+a[0])hit=!hit;}return hit;}
export function driftSurfaceAt(x,z){let on=false;for(let i=0;i<DATA.roadContours.length;i++)if(inside(DATA.roadContours[i],x,z))on=!on;return on?ROAD:OFFROAD;}
DRIFT_PATH.surfaceAt=driftSurfaceAt;
export function drawDriftMap(ctx){ctx.fillStyle='#474c3c';ctx.fillRect(DRIFT_WORLD.left,DRIFT_WORLD.top,DRIFT_WORLD.right-DRIFT_WORLD.left,DRIFT_WORLD.bottom-DRIFT_WORLD.top);ctx.beginPath();for(const ring of DATA.roadContours){ctx.moveTo(ring[0][0],ring[0][1]);for(let i=1;i<ring.length;i++)ctx.lineTo(ring[i][0],ring[i][1]);ctx.closePath();}ctx.fillStyle='#a2a4a0';ctx.fill('evenodd');}
export function addDriftColliders(physics){const actors=[];for(const wall of DATA.walls){const points=[];for(const p of wall.points){const last=points.at(-1);if(!last||Math.hypot(p[0]-last[0],p[1]-last[1])>.015)points.push(p);}if(points.length>2&&Math.hypot(points[0][0]-points.at(-1)[0],points[0][1]-points.at(-1)[1])<.015)points.pop();if(points.length<3)continue;const a=physics.addChain({points,friction:.12,userData:{kind:'drift-wall',source:wall.source}});a.maxY=1.5;actors.push(a);}
 // Close the outer shoulder and pit access tail before the visible terrain ends.
 // This exact contour also supplies the visible safety rail; no invisible box.
 actors.push(physics.addChain({points:DATA.perimeter,friction:.12,userData:{kind:'boundary',source:'Drift facility safety rail'}}));return actors;}

// Precompute safe lateral intervals for the largest garage car (4.8 x 2.53 m),
// plus 25 cm margin. Clip each wall/road edge to the car's longitudinal slab;
// the two sides are independent, so a near left wall does not forbid a right pass.
const lanesMin=new Float32Array(DRIFT_PATH.count),lanesMax=new Float32Array(DRIFT_PATH.count),rings=[...DATA.roadContours,...DATA.walls.map(w=>w.points)],sample={};
for(let n=0;n<DRIFT_PATH.count;n++){
 DRIFT_PATH.sampleAtDistance(n*DRIFT_PATH.ds,sample);const rx=Math.cos(sample.heading),rz=-Math.sin(sample.heading),fx=sample.dx,fz=sample.dz;let low=-5,high=5;
 for(const ring of rings)for(let i=0,j=ring.length-1;i<ring.length;j=i++){
  const a=ring[j],b=ring[i],ax=a[0]-sample.x,az=a[1]-sample.z,bx=b[0]-sample.x,bz=b[1]-sample.z;
  const fa=ax*fx+az*fz,fb=bx*fx+bz*fz,delta=fb-fa;let start=0,end=1;
  if(Math.abs(delta)<1e-8){if(Math.abs(fa)>2.65)continue;}else{const t1=(-2.65-fa)/delta,t2=(2.65-fa)/delta;start=Math.max(0,Math.min(t1,t2));end=Math.min(1,Math.max(t1,t2));if(start>end)continue;}
  const ra=ax*rx+az*rz,rb=bx*rx+bz*rz,first=ra+(rb-ra)*start,last=ra+(rb-ra)*end,min=Math.min(first,last)-1.515,max=Math.max(first,last)+1.515;
  if(min>0)high=Math.min(high,min);else if(max<0)low=Math.max(low,max);else{low=high=0;}
 }
 lanesMin[n]=low;lanesMax[n]=high;
}
DRIFT_PATH.laneBounds=function(s,out){
 out.min=-5;out.max=5;
 for(let d=0;d<=24;d+=4){const raw=Math.floor((s+d)/this.ds),i=((raw%this.count)+this.count)%this.count;out.min=Math.max(out.min,lanesMin[i]);out.max=Math.min(out.max,lanesMax[i]);}
 return out;
};
