import {CircuitPath} from './race-track.js';
import {DRIFT_TRACK_DATA as DATA} from './drift-track-data.js';
export {DRIFT_TRACK_DATA} from './drift-track-data.js';
// glTF linear units are metres. No fit-to-box normalisation is applied.
export const DRIFT_PATH=new CircuitPath({x:0,z:0,waypoints:DATA.route,width:12});
const spawn=DRIFT_PATH.sampleAtDistance(0,{});
export const DRIFT_WORLD=Object.freeze({left:-237,right:270,top:-235,bottom:273,shore:-237,roadsX:[-100,0,100],roadsZ:[-120,0,120,200],spawn:{x:spawn.x,z:spawn.z,heading:spawn.heading}});
export const DRIFT_GATES=Object.freeze(Array.from({length:12},(_,i)=>{const p=DRIFT_PATH.sampleAtDistance(i*DRIFT_PATH.length/12,{});return [p.x,p.z];}));
export const DRIFT_DESTINATIONS=[{id:'grid',name:'Start / Finish Straight',...DRIFT_WORLD.spawn},...['North Sweep','Technical Infield','South Hairpin'].map((name,i)=>{const p=DRIFT_PATH.sampleAtDistance([.25,.55,.88][i]*DRIFT_PATH.length,{});return {id:'drift-'+i,name,x:p.x,z:p.z,heading:p.heading};})];
const ROAD={kind:'road',height:DATA.roadY,grip:1,drag:0},OFFROAD={kind:'gravel',height:0,grip:.78,drag:1.1};
function inside(ring,x,z){let hit=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],b=ring[j];if((a[1]>z)!==(b[1]>z)&&x<(b[0]-a[0])*(z-a[1])/(b[1]-a[1])+a[0])hit=!hit;}return hit;}
export function driftSurfaceAt(x,z){let on=false;for(let i=0;i<DATA.roadContours.length;i++)if(inside(DATA.roadContours[i],x,z))on=!on;return on?ROAD:OFFROAD;}
export function drawDriftMap(ctx){ctx.fillStyle='#474c3c';ctx.fillRect(DRIFT_WORLD.left,DRIFT_WORLD.top,507,508);ctx.beginPath();for(const ring of DATA.roadContours){ctx.moveTo(ring[0][0],ring[0][1]);for(let i=1;i<ring.length;i++)ctx.lineTo(ring[i][0],ring[i][1]);ctx.closePath();}ctx.fillStyle='#a2a4a0';ctx.fill('evenodd');}
export function addDriftColliders(physics){const actors=[];for(const wall of DATA.walls){const points=[];for(const p of wall.points){const last=points.at(-1);if(!last||Math.hypot(p[0]-last[0],p[1]-last[1])>.015)points.push(p);}if(points.length>2&&Math.hypot(points[0][0]-points.at(-1)[0],points[0][1]-points.at(-1)[1])<.015)points.pop();if(points.length<3)continue;const a=physics.addChain({points,friction:.12,userData:{kind:'drift-wall',source:wall.source}});a.maxY=1.5;actors.push(a);}
 // The authored terrain ends here. Keep vehicles on its visible ground rather
 // than installing an invisible road-width box around the entire circuit.
 actors.push(physics.addChain({points:[[-237,-235],[270,-235],[270,273],[-237,273]],userData:{kind:'boundary'}}));return actors;}
