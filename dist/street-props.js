import * as THREE from './vendor/three.module.js';
import {STUNT_AREA} from './stunts.js';
import {SUNSET,sunsetDistance,mapDistrict} from './map-layout.js';
import {PropObstacles} from './prop-obstacles.js';
// GTA-style knockable street furniture: hydrants, bins, news boxes, bags, chairs, cones, barriers, works fences, warning signs, plus static power poles.
// Layout and knock physics are pure (tested in node); rendering is one InstancedMesh per prop part holding only the props near the car.
// Props are cheap arcade bodies, never Planck bodies: the car sweeps a spatial grid each frame and only loose props are integrated.
const ISLAND={left:-490,right:490,top:-670,bottom:670,roadsX:[-450,-300,-150,0,150,300,450],roadsZ:[-600,-450,-300,-150,0,150,300,450,600]};// mirrors world.js WORLD
// h: target height (m) or len: target length along z; r: knock radius; mass 0..1 drives car slowdown and fling; static: solid collider, never knocked.
export const PROP_TYPES=Object.freeze({
  'lot-palm':{asset:'tree-palmtall',h:6.5,r:.22,mass:.7,breakSpeed:11,viewRadius:280},
  'lot-palm-short':{asset:'tree-palmshort',h:4.5,r:.22,mass:.6,breakSpeed:10,viewRadius:280},
  hydrant:{asset:'props/rusty-fire-hydrant',h:.82,r:.3,mass:.55,spray:true},
  trashcan:{asset:'props/metal-trash-can',h:.95,r:.42,mass:.3},
  newsbox:{asset:'props/utility-box-01',h:1.15,r:.36,mass:.45},
  trashbag:{asset:'props/trashbag',h:.6,r:.3,mass:.08},
  chair:{asset:'props/plastic-monobloc-chair-01',h:.86,r:.34,mass:.06},
  cone:{asset:'construction-cone',h:.75,r:.26,mass:.04},
  barrier:{asset:'construction-barrier',len:2.4,r:.6,mass:.3},
  fence:{asset:'props/construction-fence',len:2.2,r:.55,mass:.25},
  worklight:{asset:'props/construction-light',h:1.1,r:.25,mass:.1},
  warning:{asset:'props/road-sign-warning',h:2.3,r:.3,mass:.22},
  planter:{asset:'planter',len:2,r:.9,mass:.9,slide:true,kg:280},
  bench:{asset:'park/bench',native:true,r:.6,mass:.65,slide:true,kg:90},
  dumpster:{asset:'dumpster',len:1.8,r:.8,mass:.95,slide:true,kg:350},
  signal:{asset:'traffic-light',h:4.8,r:.23,mass:.75,breakSpeed:8},
  lamp:{asset:'light-curved',h:7,r:.23,mass:.85,breakSpeed:12},
  'stop-sign':{asset:'road-sign-stop',h:2.8,r:.18,mass:.4,breakSpeed:5},
  picnic:{asset:'park/picnic',native:true,r:1.4,mass:.8,slide:true,kg:180},
  pot:{asset:'park/pot',h:.65,r:.3,mass:.2},
  pole:{asset:'props/electricity-pole-single',h:9.5,slim:.3,tint:0x6f5a45,r:.25,mass:1,static:true},
});
const HEAVY=.4;// at or above this mass the car loses speed on impact
export const PROP_CONFIG=Object.freeze({gravity:-19,restitution:.32,groundFriction:5.5,spinDamping:3,settleSpeed:.35,minLoose:3,maxLoose:6,respawnDelay:30,respawnDistance:70,knockSpeed:1.2,rehitCooldown:.35,cell:20,viewRadius:120,maxActive:40,sprayTime:10,sprayParticles:300});
/** Roads as infinite bands: {axis:'x'|'z', c: centre coordinate, half: half width, from,to: extent along the road}. */
export function mapRoads(map){
  if(map!=='coast')return [];const wide=true;
  return ISLAND.roadsX.map(c=>({axis:'x',c,half:wide&&c===0?17:12,from:ISLAND.top,to:ISLAND.bottom})).concat(ISLAND.roadsZ.map(c=>({axis:'z',c,half:wide&&c===-300?17:12,from:ISLAND.left,to:ISLAND.right})));
}
/** Distance from a point to the nearest drivable asphalt edge (negative = on the road). */
export function roadClearance(map,x,z,roads=mapRoads(map)){
  let best=Infinity;
  for(const r of roads){const across=r.axis==='x'?x-r.c:z-r.c,along=r.axis==='x'?z:x;if(along<r.from||along>r.to)continue;best=Math.min(best,Math.abs(across)-r.half);}
  if(map==='coast')best=Math.min(best,sunsetDistance(x,z)-SUNSET.width/2);
  return best;
}
const inStunt=(x,z,m=4)=>x>STUNT_AREA.left-m&&x<STUNT_AREA.right+m&&z>STUNT_AREA.top-m&&z<STUNT_AREA.bottom+m;
/**
 * Deterministic sidewalk scatter. blocked(x,z,r) lets the caller reject spots that hit world colliders (lamps, palms, signals, buildings).
 * Returns [{type,x,z,rot}]; rot is the yaw. Every item clears asphalt and every other item.
 */
export function layoutStreetProps(map,{random=seeded(9157),blocked=()=>false}={}){
  const roads=mapRoads(map),items=[],grid=new Map(),G=8;
  const key=(x,z)=>`${Math.floor(x/G)},${Math.floor(z/G)}`;
  const fits=(type,x,z)=>{const r=PROP_TYPES[type].r;if(roadClearance(map,x,z,roads)<r+.35)return false;if((inStunt(x,z)||x<ISLAND.left+3||x>ISLAND.right-3||z<ISLAND.top+3||z>ISLAND.bottom-3))return false;if(map==='coast'&&sunsetDistance(x,z)<SUNSET.width/2+SUNSET.sidewalk+r)return false;
    const gx=Math.floor(x/G),gz=Math.floor(z/G);for(let i=-1;i<=1;i++)for(let j=-1;j<=1;j++)for(const o of grid.get(`${gx+i},${gz+j}`)||[])if(Math.hypot(o.x-x,o.z-z)<r+PROP_TYPES[o.type].r+.25)return false;
    return !blocked(x,z,r+.2);};
  const add=(type,x,z,rot)=>{if(!fits(type,x,z))return false;const item={type,x,z,rot};items.push(item);const k=key(x,z);if(!grid.has(k))grid.set(k,[]);grid.get(k).push(item);return true;};
  // Point on the sidewalk of road r: `along` the road, `off` metres beyond the asphalt edge on `side`.
  const at=(r,along,side,off)=>r.axis==='x'?[r.c+side*(r.half+off),along]:[along,r.c+side*(r.half+off)];
  const yawFacing=(r,side)=>r.axis==='x'?(side>0?Math.PI/2:-Math.PI/2):(side>0?0:Math.PI);
  const cross=roads.filter(r=>r.axis==='x'),cross2=roads.filter(r=>r.axis==='z');
  const stops=r=>(r.axis==='x'?cross2:cross).map(o=>({c:o.c,half:o.half})).sort((a,b)=>a.c-b.c);
  const district=mapDistrict;
  const runs=[];
  for(const r of roads){const s=stops(r),edges=[r.from,...s.flatMap(o=>[o.c-o.half,o.c+o.half]),r.to];for(let i=0;i<edges.length;i+=2){const a=edges[i],b=edges[i+1];if(b-a>30)runs.push({r,a,b});}}
  // Hydrants: one per corner on alternating sides, just past the crosswalk.
  for(const {r,a,b} of runs)for(const side of [-1,1]){if(random()<.45)continue;const along=random()<.5?a+(9):b-(9),[x,z]=at(r,along,side,1.5);add('hydrant',x,z,random()*6.28);}
  // Furniture clusters every ~26 m: bins, news boxes, bag piles, café chairs.
  for(const {r,a,b} of runs)for(const side of [-1,1])for(let t=a+18+random()*8;t<b-18;t+=22+random()*10){
    const [x,z]=at(r,t,side,2.1),d=district(x,z),u=random(),yaw=yawFacing(r,side);
    if(u<.3)add('trashcan',x,z,random()*6.28);
    else if(u<.48&&d!=='Palm Gardens'){add('newsbox',x,z,yaw);const [x2,z2]=at(r,t+.85,side,2.1);add('newsbox',x2,z2,yaw);}
    else if(u<.62){for(let k=0;k<3;k++){const [bx,bz]=at(r,t+(k-1)*.62,side,(2.5)+(k%2)*.45);add('trashbag',bx,bz,random()*6.28);}add('trashcan',...at(r,t+1.5,side,2.1),0);}
    else if(u<.72&&(d==='Downtown Solana'||d==='Sunset Mile'||d==='Pacific Boardwalk')){for(let k=0;k<2;k++)add('chair',...at(r,t+k*1.1,side,3.2),yaw+Math.PI+(random()-.5)*.6);}
  }
  // Construction spots: a sidewalk works pit fenced off, cones and a barrier along the curb, a work light and a warning sign.
  const spots=map==='coast'?9:0;for(let n=0,tries=0;n<spots&&tries<80;tries++){const {r,a,b}=runs[Math.floor(random()*runs.length)];if(b-a<60)continue;const t=a+20+random()*(b-a-55),side=random()<.5?-1:1;if(!fits('fence',...at(r,t,side,3))||!fits('fence',...at(r,t+20,side,3)))continue;const yaw=r.axis==='x'?0:Math.PI/2;
    let placed=0;for(let k=0;k<4;k++)placed+=add('fence',...at(r,t+2+k*2.4,side,3.6),yaw);for(let k=0;k<6;k++)placed+=add('cone',...at(r,t+k*2.3,side,.75),0);placed+=add('barrier',...at(r,t+14.5,side,1.05),yaw);placed+=add('worklight',...at(r,t+12.2,side,1.6),0);placed+=add('warning',...at(r,t-2.4,side,1.2),yawFacing(r,side)+Math.PI/2);if(placed>6)n++;}
  // Power poles: suburban/outer edges only (Palm Gardens, outer boulevards). Solid colliders; never knocked.
  for(const r of roads){const outer=r.c===ISLAND.roadsX[0]||r.c===ISLAND.roadsX[6]||r.c===ISLAND.roadsZ[0]||r.c===ISLAND.roadsZ[8];const suburb=map==='coast'&&r.axis==='z'&&r.c<-300;if(!outer&&!suburb)continue;const side=outer?(r.c<0?-1:1):1;
    for(let t=r.from+40;t<r.to-40;t+=38){const [x,z]=at(r,t,side,map==='coast'&&!outer?2.6:4.2);if(roadClearance(map,x,z,roads)<3)continue;add('pole',x,z,r.axis==='x'?Math.PI/2:0);}}
  return items;
}
export function seeded(seed){let s=seed>>>0;return ()=>{s=(s*1664525+1013904223)>>>0;return s/4294967296;};}
/** Uniform grid of item indices keyed by home position. query() visits the 3×3 cells around a point. */
export class PropGrid{
  constructor(items,cell=PROP_CONFIG.cell){this.cell=cell;this.cells=new Map();this.locations=new Int32Array(items.length);items.forEach((it,i)=>{const k=this.key(Math.floor(it.x/cell),Math.floor(it.z/cell));this.locations[i]=k;let list=this.cells.get(k);if(!list)this.cells.set(k,list=[]);list.push(i);});}
  key(i,j){return i*73856093^j*19349663;}
  move(index,x,z){const key=this.key(Math.floor(x/this.cell),Math.floor(z/this.cell)),old=this.locations[index];if(key===old)return;const previous=this.cells.get(old),at=previous?.indexOf(index)??-1;if(at>=0)previous.splice(at,1);let list=this.cells.get(key);if(!list)this.cells.set(key,list=[]);list.push(index);this.locations[index]=key;}
  forNear(x,z,radius,fn){const c=this.cell,n=Math.ceil(radius/c),gi=Math.floor(x/c),gj=Math.floor(z/c);for(let i=-n;i<=n;i++)for(let j=-n;j<=n;j++){const list=this.cells.get(this.key(gi+i,gj+j));if(list)for(const k of list)fn(k);}}
}
/** Small curated garden clusters leave the two 7 m park paths and entrances open. */
export function layoutParkProps(plots,blocked=()=>false){
 const items=[];for(const plot of plots)for(const sx of [-1,1])for(const sz of [-1,1]){
  const x=plot.x+sx*27,z=plot.z+sz*26;
  for(const [type,dx,dz,rot]of [['bench',0,0,sz>0?Math.PI:0],['chair',-3,4,0],['chair',3,4,Math.PI],['picnic',0,7,Math.PI/2],['pot',-6,-3,0],['pot',6,-3,0],['trashcan',7,5,0]]){
   if(!blocked(x+dx,z+dz,PROP_TYPES[type].r))items.push({type,x:x+dx,z:z+dz,rot,ground:plot.ground||.1});
  }
 }return items;
}
/** Sweep the moving car rectangle against a prop circle. Teleports intentionally produce no path. */
export function sweptCarOverlapsProp(car,previous,px,pz,r){
 if(carOverlapsProp(car,px,pz,r))return true;if(!previous)return false;
 const dx=car.x-previous.x,dz=car.z-previous.z,travel=Math.hypot(dx,dz);if(travel>20)return false;
 const n=Math.max(1,Math.ceil(travel/Math.max(.15,r*.7))),dh=Math.atan2(Math.sin(car.heading-previous.heading),Math.cos(car.heading-previous.heading));
 for(let i=0;i<n;i++){const t=i/n;if(carOverlapsProp({...car,x:previous.x+dx*t,z:previous.z+dz*t,heading:previous.heading+dh*t},px,pz,r))return true;}return false;
}
/** Circle (prop) vs oriented car rectangle in the car's frame. Heading 0 faces -z (physics.js convention). */
export function carOverlapsProp(car,px,pz,r){const dx=px-car.x,dz=pz-car.z,s=Math.sin(car.heading),c=Math.cos(car.heading),lateral=dx*c-dz*s,along=-dx*s-dz*c,hw=(car.width||1.9)/2,hl=(car.length||4.5)/2;const qx=Math.max(Math.abs(lateral)-hw,0),qz=Math.max(Math.abs(along)-hl,0);return qx*qx+qz*qz<r*r;}
/** Loose-body state for one prop. Position is the centre of mass; half/r are its half height and radius for ground contact. */
export function makeBody(item,type){const t=PROP_TYPES[item.type];return {index:0,type:item.type,home:item,half:type?.half??(t.h||1)/2,r:t.r,mass:t.mass,state:'rest',x:item.x,y:(type?.half??(t.h||1)/2),z:item.z,vx:0,vy:0,vz:0,wx:0,wy:0,wz:0,q:new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),item.rot),age:0,settledFor:0,lastHit:-1e9};}
const _w=new THREE.Quaternion(),_t=new THREE.Quaternion(),_id=new THREE.Quaternion(),_up=new THREE.Vector3(),_flat=new THREE.Vector3();
/** Launch a prop from the car's velocity plus an outward and upward kick. Returns the impact speed (m/s). */
export function knockBody(b,car,random=Math.random){
  const speed=Math.hypot(car.vx,car.vz),dx=b.x-car.x,dz=b.z-car.z,d=Math.hypot(dx,dz)||1,light=1.25-b.mass*.6;
  b.vx=(car.vx*1.05+dx/d*speed*.35)*light+(random()-.5)*1.2;b.vz=(car.vz*1.05+dz/d*speed*.35)*light+(random()-.5)*1.2;b.vy=(2.2+speed*.22)*light;
  const spin=(3+speed*.35)*light;b.wx=(random()-.5)*2*spin;b.wy=(random()-.5)*spin;b.wz=(random()-.5)*2*spin;
  b.state='loose';b.age=0;b.settledFor=0;return speed;
}
/** Arcade rigid motion: gravity, bounce with restitution, ground friction and spin damping. Returns true while the body still moves. */
export function stepBody(b,dt,cfg=PROP_CONFIG,ground=0){
  if(b.state!=='loose')return false;b.age+=dt;
  b.vy+=cfg.gravity*dt;b.x+=b.vx*dt;b.y+=b.vy*dt;b.z+=b.vz*dt;
  // Integrate orientation: q += ½ ω q dt.
  _w.set(b.wx*dt*.5,b.wy*dt*.5,b.wz*dt*.5,0).multiply(b.q);b.q.set(b.q.x+_w.x,b.q.y+_w.y,b.q.z+_w.z,b.q.w+_w.w).normalize();
  // Lowest point of an upright-capsule-ish body: half height along its up axis plus radius across it.
  _up.set(0,1,0).applyQuaternion(b.q);const uy=Math.abs(_up.y),extent=b.half*uy+b.r*Math.sqrt(Math.max(0,1-uy*uy)),floor=ground+extent;
  let grounded=false;if(b.y<=floor){b.y=floor;grounded=true;if(b.vy<-1.2){b.vy=-b.vy*cfg.restitution;b.wx*=.7;b.wz*=.7;}else b.vy=0;}
  if(grounded){const f=Math.exp(-cfg.groundFriction*dt);b.vx*=f;b.vz*=f;const g=Math.exp(-cfg.spinDamping*2*dt);b.wx*=g;b.wy*=g;b.wz*=g;
    // Topple: a tilted body falls onto its side instead of balancing on an edge.
    if(uy>.08&&uy<.97){_t.setFromUnitVectors(_up,_flat.set(_up.x,0,_up.z).normalize());b.q.premultiply(_w.copy(_id).slerp(_t,Math.min(1,dt*4)));}}
  else{const g=Math.exp(-cfg.spinDamping*.15*dt);b.wx*=g;b.wy*=g;b.wz*=g;}
  const still=grounded&&Math.hypot(b.vx,b.vy,b.vz)<cfg.settleSpeed&&Math.hypot(b.wx,b.wy,b.wz)<1.2;
  if((still&&b.age>=cfg.minLoose)||b.age>=cfg.maxLoose){b.state='settled';b.vx=b.vy=b.vz=b.wx=b.wy=b.wz=0;b.y=Math.max(b.y,floor);b.settledFor=0;return false;}
  return true;
}
/** A settled prop returns home after respawnDelay, but only once the player is far away or cannot see either spot. */
export function maybeRespawn(b,dt,carDistance,visible=false,cfg=PROP_CONFIG){
  if(b.state!=='settled')return false;b.settledFor+=dt;if(b.settledFor<cfg.respawnDelay)return false;if(carDistance<cfg.respawnDistance&&visible)return false;
  b.state='rest';b.x=b.home.x;b.z=b.home.z;b.y=b.half;b.q.setFromAxisAngle(_up.set(0,1,0),b.home.rot);b.vx=b.vy=b.vz=b.wx=b.wy=b.wz=0;b.age=b.settledFor=0;return true;
}
// Small pooled water fountain (≤300 particles) for a knocked hydrant; turns itself off after sprayTime.
class WaterSpray{
  constructor(scene,count){
    this.count=count;this.pos=new Float32Array(count*3);this.vel=new Float32Array(count*3);this.life=new Float32Array(count);this.sources=[];this.cursor=0;
    const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.BufferAttribute(this.pos,3).setUsage(THREE.DynamicDrawUsage));
    const c=document.createElement('canvas');c.width=c.height=32;const g=c.getContext('2d'),grad=g.createRadialGradient(16,16,1,16,16,15);grad.addColorStop(0,'rgba(255,255,255,1)');grad.addColorStop(.5,'rgba(220,240,255,.55)');grad.addColorStop(1,'rgba(220,240,255,0)');g.fillStyle=grad;g.fillRect(0,0,32,32);
    this.points=new THREE.Points(geo,new THREE.PointsMaterial({size:.13,map:new THREE.CanvasTexture(c),color:0xd8ecff,transparent:true,opacity:.6,depthWrite:false,sizeAttenuation:true}));this.points.frustumCulled=false;this.points.visible=false;scene.add(this.points);this.life.fill(0);
    for(let i=0;i<count;i++)this.pos[i*3+1]=-50;
  }
  start(x,y,z,time){if(this.sources.length>=3)this.sources.shift();this.sources.push({x,y,z,until:time});}
  update(dt,now){
    this.sources=this.sources.filter(s=>s.until>now);let alive=0;const rate=this.sources.length?Math.min(this.count/1.25/this.sources.length,200):0;
    for(const s of this.sources){s.acc=(s.acc||0)+rate*dt;while(s.acc>=1){s.acc--;const i=this.cursor;this.cursor=(this.cursor+1)%this.count;const a=Math.random()*6.283,sp=.6+Math.random()*1.1;this.pos[i*3]=s.x;this.pos[i*3+1]=s.y;this.pos[i*3+2]=s.z;this.vel[i*3]=Math.cos(a)*sp;this.vel[i*3+1]=6.5+Math.random()*2.5;this.vel[i*3+2]=Math.sin(a)*sp;this.life[i]=1.25;}}
    for(let i=0;i<this.count;i++){if(this.life[i]<=0)continue;this.life[i]-=dt;if(this.life[i]<=0||this.pos[i*3+1]<0){this.life[i]=0;this.pos[i*3+1]=-50;continue;}alive++;this.vel[i*3+1]-=12*dt;this.pos[i*3]+=this.vel[i*3]*dt;this.pos[i*3+1]+=this.vel[i*3+1]*dt;this.pos[i*3+2]+=this.vel[i*3+2]*dt;}
    this.points.visible=alive>0;if(alive)this.points.geometry.attributes.position.needsUpdate=true;return alive;
  }
}
/** Scene + physics glue. Construct after the world is built; await load(loader) before driving; call update() once per frame. */
export class StreetProps{
  constructor({scene,physics,world,map,blocked}){
    this.scene=scene;this.physics=physics;this.world=world;this.templates=world?.interactiveTemplates||{};this.map=map;this.time=0;this.knocks=0;this.ready=false;this.previous=null;this.before=null;this.activeSlides=new Set();this.beforePose={x:0,z:0,heading:0};this.previousPose={x:0,z:0,heading:0};this.predicted={x:0,z:0,heading:0,width:0,length:0,vx:0,vz:0};
    const obstacles=world?.obstacles||[],near=(x,z,r)=>obstacles.some(o=>x+r>o.box.min.x&&x-r<o.box.max.x&&z+r>o.box.min.z&&z-r<o.box.max.z);
    const placed=world?.interactiveProps||[],garden=layoutParkProps(world?.parkPlots||[],blocked||near);
    this.obstacleGrid=new PropObstacles(obstacles);
    this.items=[...placed,...garden,...layoutStreetProps(map,{blocked:(x,z,r)=>(blocked||near)(x,z,r)||[...placed,...garden].some(p=>Math.hypot(p.x-x,p.z-z)<PROP_TYPES[p.type].r+r+.2)})];
    // Poles are plain static Planck boxes, exactly like the world's lamps and signals.
    for(const it of this.items)if(PROP_TYPES[it.type].static)physics?.addBox({x:it.x,z:it.z,width:.5,length:.5,userData:{kind:'power-pole'}});
    this.bodies=this.items.map(it=>makeBody(it));this.bodies.forEach((b,i)=>b.index=i);
    this.grid=new PropGrid(this.items);this.displaced=new Set();this.loose=new Set();this.counts={};for(const it of this.items)this.counts[it.type]=(this.counts[it.type]||0)+1;
    this.meshes={};this.frustum=new THREE.Frustum();this.projView=new THREE.Matrix4();this.refreshClock=1;this.slots=new Int32Array(this.items.length).fill(-1);
    this.visitNear=i=>{const b=this.bodies[i],t=PROP_TYPES[b.type],car=this.queryCar;if(!b.actor)return;
      if(t.slide){if((b.x-car.x)**2+(b.z-car.z)**2<85*85){if(!b.actor.body.isActive())b.actor.body.setActive(true);this.activeSlides.add(b);}}
      if(t.breakSpeed&&Math.hypot(b.x-car.x,b.z-car.z)<car.length+car.speed*this.queryDt+2&&b.state==='rest'&&car.speed>=t.breakSpeed&&!car.isAirborne&&(car.groundElevation||0)<1&&sweptCarOverlapsProp(this.predicted,this.before,b.x,b.z,b.r)){b.actor.body.setActive(false);this.launch(b,this.predicted);}
    };
    this.spray=typeof document!=='undefined'?new WaterSpray(scene,PROP_CONFIG.sprayParticles):null;
    if(typeof window!=='undefined')window.streetPropsDebug=this;
  }
  async load(loader){
    const types=Object.keys(this.counts);
    await Promise.all(types.map(async name=>{try{const t=PROP_TYPES[name],root=(name==='bench'?null:this.templates[name])|| (await loader.loadAsync(`assets/${t.asset}.glb`)).scene;this.build(name,root);}catch(error){console.warn('street prop failed to load',name,error);}}));
    this.ready=true;
  }
  build(name,root){
    const t=PROP_TYPES[name];root.updateMatrixWorld(true);const box=new THREE.Box3().setFromObject(root,true),size=box.getSize(new THREE.Vector3());
    const scale=t.native?1:t.len?t.len/Math.max(size.z,size.x):t.h/size.y,height=size.y*scale,center=box.getCenter(new THREE.Vector3());
    // Bake: centre in x/z, centre of mass at origin (loose bodies rotate about it).
    // slim: horizontal-only factor for stylised kit parts that are too chunky at real height (Kenney pole is ~1.5 m thick at 9.5 m).
    const xz=scale*(t.slim||1),bake=new THREE.Matrix4().makeScale(xz,scale,xz).multiply(new THREE.Matrix4().makeTranslation(-center.x,-(box.min.y+size.y/2),-center.z));
    const parts=[],max=this.counts[name];
    root.traverse(o=>{if(!o.isMesh)return;const geometry=o.geometry.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(bake,o.matrixWorld));let material=o.material;if(t.tint){material=material.clone();material.color.setHex(t.tint);}const mesh=new THREE.InstancedMesh(geometry,material,max);mesh.count=0;mesh.frustumCulled=false;mesh.castShadow=height>=2.5;mesh.receiveShadow=true;mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);mesh.name='street-prop-'+name;this.scene.add(mesh);parts.push(mesh);});
    for(const b of this.bodies)if(b.type===name){const k=b.home.scale||1;b.half=height*k/2;b.r=t.r*k;b.ground=b.home.ground??.06;b.y=b.half+b.ground;
      if(t.slide&&this.physics){b.actor=this.physics.addProp({x:b.x,z:b.z,width:size.x*xz*k,length:size.z*xz*k,heading:-b.home.rot,mass:t.kg,height:height*k,userData:{kind:'movable-'+name}});b.actor.body.setAwake(false);b.actor.body.setActive(false);}
      else if(t.breakSpeed&&this.physics){b.actor=this.physics.addCircle({x:b.x,z:b.z,radius:t.r,userData:{kind:'breakable-'+name,managedActivation:true}});b.actor.minY=b.ground;b.actor.maxY=height;}
    }
    this.meshes[name]={parts,max,height};
  }
  writeMatrix(b){const m=this.meshes[b.type],slot=this.slots[b.index];if(!m||slot<0)return;_m.compose(_p.set(b.x,b.y,b.z),b.q,_s.setScalar(b.home.scale||1));for(const part of m.parts){part.setMatrixAt(slot,_m);part.instanceMatrix.needsUpdate=true;}}
  // Rebuilds each type's instance list from props within viewRadius of the car (a few hundred matrices, 4×/s).
  refresh(x,z){
    const R=PROP_CONFIG.viewRadius,queryR=Math.max(R,...Object.keys(this.meshes).map(name=>PROP_TYPES[name].viewRadius||R)),fill={};this.slots.fill(-1);
    const take=b=>{const m=this.meshes[b.type];if(!m)return;const n=fill[b.type]||0;if(n>=m.max)return;this.slots[b.index]=n;fill[b.type]=n+1;this.writeMatrix(b);};
    for(const b of this.activeSlides)if(Math.hypot(b.x-x,b.z-z)<R)take(b);
    for(const b of this.displaced)if(Math.hypot(b.x-x,b.z-z)<(PROP_TYPES[b.type].viewRadius||R))take(b);
    this.grid.forNear(x,z,queryR,i=>{const b=this.bodies[i],radius=PROP_TYPES[b.type].viewRadius||R;if(!PROP_TYPES[b.type].slide&&b.state==='rest'&&Math.hypot(b.x-x,b.z-z)<radius)take(b);});
    for(const [name,m] of Object.entries(this.meshes))for(const part of m.parts){part.count=fill[name]||0;part.instanceMatrix.needsUpdate=true;}
  }
  // Called before the physics step: remove a breakaway pole's solid base before a high-speed hit.
  beforeStep(car,dt){
    if(!this.ready)return;
    this.before=this.beforePose;this.before.x=car.x;this.before.z=car.z;this.before.heading=car.heading;
    const predicted=this.predicted;predicted.x=car.x+car.vx*dt;predicted.z=car.z+car.vz*dt;predicted.heading=car.heading;predicted.width=car.width;predicted.length=car.length;predicted.vx=car.vx;predicted.vz=car.vz;
    for(const b of this.activeSlides)if((b.x-car.x)**2+(b.z-car.z)**2>=85*85){b.actor.body.setActive(false);this.activeSlides.delete(b);}
    this.queryCar=car;this.queryDt=dt;this.grid.forNear(car.x,car.z,Math.max(85,car.length+car.speed*dt+2),this.visitNear);
  }

  launch(b,car){const t=PROP_TYPES[b.type];if(t.slide||t.static)return 0;if(b.state==='rest'&&t.spray)this.spray?.start(b.x,.25,b.z,this.time+PROP_CONFIG.sprayTime);
    b.lastHit=this.time;const impact=knockBody(b,car);if(t.breakSpeed){b.vx*=.28;b.vz*=.28;b.vy=Math.min(b.vy,2);}
    this.loose.add(b);this.displaced.add(b);this.knocks++;if(this.slots[b.index]<0)this.refreshClock=1;return impact;
  }
  /** car: the player actor (x,z,heading,vx,vz,width,length,elevation,body). Returns the number of knocks this frame. */
  update(dt,car,{camera,audio}={}){
    if(!this.ready||!car)return 0;this.time+=dt;let knocks=0,heavy=0,impact=0;
    const elevated=(car.elevation||0)+(car.groundElevation||0)>1.1;
    if(!elevated&&car.speed>PROP_CONFIG.knockSpeed){const state={x:car.x,z:car.z,heading:car.heading,width:car.width,length:car.length,vx:car.vx,vz:car.vz};
      const hit=b=>{if(PROP_TYPES[b.type].static||PROP_TYPES[b.type].slide||(PROP_TYPES[b.type].breakSpeed&&b.state==='rest')||this.time-b.lastHit<PROP_CONFIG.rehitCooldown||b.y-b.half>1.2||!sweptCarOverlapsProp(state,this.before||this.previous,b.x,b.z,b.r))return;
        impact=Math.max(impact,this.launch(b,state));heavy=Math.max(heavy,b.mass);knocks++;};
      this.grid.forNear(car.x,car.z,PROP_CONFIG.cell+Math.min(20,Math.hypot(car.x-(this.before?.x??car.x),car.z-(this.before?.z??car.z))),i=>{const b=this.bodies[i];if(b.state==='rest')hit(b);});
      for(const b of this.displaced)hit(b);}
    if(knocks){
      // Heavy props bleed some speed (planck velocity, scaled once per hit frame); light ones are free to plough through.
      if(heavy>=HEAVY&&car.body){const v=car.body.getLinearVelocity(),f=1-heavy*.16;car.body.setLinearVelocity({x:v.x*f,y:v.y*f});}
      audio?.onImpact?.(Math.min(14,impact*(.25+heavy*.5)));}
    if(this.loose.size>PROP_CONFIG.maxActive)for(const b of this.loose){if(this.loose.size<=PROP_CONFIG.maxActive)break;b.age=PROP_CONFIG.maxLoose;}
    for(const b of this.loose){let remaining=Math.min(dt,.1),moving=true;while(remaining>1e-6&&moving){const step=Math.min(remaining,1/120),old={x:b.x,z:b.z};moving=stepBody(b,step,PROP_CONFIG,b.ground??.06);const hit=this.obstacleGrid.sweep(old,b,b.r,Math.max(0,b.y-b.half),b.y+b.half);if(hit){const t=Math.max(0,hit.t-.001);b.x=old.x+(b.x-old.x)*t;b.z=old.z+(b.z-old.z)*t;const dot=b.vx*hit.nx+b.vz*hit.nz;if(dot<0){b.vx-=1.25*dot*hit.nx;b.vz-=1.25*dot*hit.nz;}}remaining-=step;}this.writeMatrix(b);if(!moving)this.loose.delete(b);}
    if(this.displaced.size){let visibleTest=null;if(camera){this.projView.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse);this.frustum.setFromProjectionMatrix(this.projView);visibleTest=(x,z)=>this.frustum.containsPoint(_p.set(x,.5,z));}
      for(const b of this.displaced){if(b.state!=='settled')continue;const d=Math.hypot(b.x-car.x,b.z-car.z),seen=visibleTest?visibleTest(b.x,b.z)||visibleTest(b.home.x,b.home.z):d<PROP_CONFIG.respawnDistance;if(maybeRespawn(b,dt,Math.min(d,Math.hypot(b.home.x-car.x,b.home.z-car.z)),seen)){this.displaced.delete(b);b.y=b.half+(b.ground??.06);if(b.actor)b.actor.body.setActive(true);this.writeMatrix(b);}}}
    this.refreshClock+=dt;if(this.refreshClock>.25){this.refreshClock=0;this.refresh(car.x,car.z);}
    for(const b of this.activeSlides)if(b.actor.body.isActive()){const p=b.actor.body.getPosition();b.x=p.x;b.z=p.y;this.grid.move(b.index,b.x,b.z);b.q.setFromAxisAngle(_up.set(0,1,0),b.actor.body.getAngle());this.writeMatrix(b);}
    this.previous=this.previousPose;this.previous.x=car.x;this.previous.z=car.z;this.previous.heading=car.heading;this.before=null;this.spray?.update(dt,this.time);return knocks;
  }
  get stats(){return {props:this.items.length,counts:this.counts,loose:this.loose.size,displaced:this.displaced.size,knocks:this.knocks,drawn:Object.fromEntries(Object.entries(this.meshes).map(([k,m])=>[k,m.parts[0]?.count||0])),spray:this.spray?.points.visible||false};}
}
const _m=new THREE.Matrix4(),_p=new THREE.Vector3(),_s=new THREE.Vector3(1,1,1);
