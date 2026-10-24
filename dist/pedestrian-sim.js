// GTA-style sidewalk crowd: pure simulation (no three.js, no DOM) so node tests cover it. pedestrians.js renders it.
// Sidewalk lanes are derived from the same layout constants world.js build from:
// every city block gets a lane ring 1.85 m inside its kerb, split wherever it would touch asphalt (Sunset Mile, stunt park).
// Peds walk the lanes with lateral avoidance, stop to idle, sprint or dive away from a fast car and get knocked about by it.
import {SUNSET,sunsetDistance} from './map-layout.js';
import {STUNT_AREA} from './stunts.js';

const ISLAND={left:-490,right:490,top:-670,bottom:670,roadsX:[-450,-300,-150,0,150,300,450],roadsZ:[-600,-450,-300,-150,0,150,300,450,600]};// mirrors world.js WORLD
export const CROWD_SIZES=Object.freeze({low:12,medium:28,high:44,ultra:60});
export const PED=Object.freeze({
  inset:1.85,step:2,sampleStep:6,cell:30,
  spawnMin:40,spawnMax:120,nearView:80,hideDist:110,farSpawn:112,despawn:125,behindDespawn:85,freshMin:12,
  radius:.35,walkMin:1.0,walkMax:1.4,fleeSpeed:6.2,diveSpeed:3.4,diveTime:1.25,
  threatSpeed:15/3.6,threatRange:14,threatLateral:3.2,diveTti:.55,diveLateral:1.9,knockSpeed:15/3.6,
  gravity:-18,downMin:3,downMax:25,teleport:150,
});
// Animation ids; pedestrians.js maps them to clips in ped-anims.glb.
export const ANIM=Object.freeze({IDLE:0,TALK:1,WALK:2,WALK_FORMAL:3,JOG:4,SPRINT:5,ROLL:6,HIT:7,DEATH:8,SIT:9,AIR:10});
export const ANIM_CLIPS=Object.freeze(['Idle_Loop','Idle_Talking_Loop','Walk_Loop','Walk_Formal_Loop','Jog_Fwd_Loop','Sprint_Loop','Roll','Hit_Chest','Death01','Sitting_Idle_Loop','Jump_Loop']);
// Ground speed (m/s) of each locomotion clip at timeScale 1, measured from the root-motion export of the same library.
export const CLIP_SPEED=Object.freeze({[ANIM.WALK]:.97,[ANIM.WALK_FORMAL]:.97,[ANIM.JOG]:5.36,[ANIM.SPRINT]:8.25});

/** Mulberry32: small deterministic RNG. */
export function seeded(seed=1){let s=seed>>>0;return()=>{s=(s+0x6D2B79F5)>>>0;let t=s;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return((t^t>>>14)>>>0)/4294967296;};}

/** Roads as bands: {axis:'x'|'z', c, half, from, to}. */
export function pedRoads(map){
  if(map!=='coast')return [];const wide=true;
  return ISLAND.roadsX.map(c=>({axis:'x',c,half:wide&&c===0?17:12,from:ISLAND.top+10,to:ISLAND.bottom-10})).concat(ISLAND.roadsZ.map(c=>({axis:'z',c,half:wide&&c===-300?17:12,from:ISLAND.left+12,to:ISLAND.right-12})));
}
/** Distance from (x,z) to the nearest asphalt edge; negative on the road. */
export function roadGap(map,x,z,roads=pedRoads(map)){
  let best=Infinity;
  for(const r of roads){const across=r.axis==='x'?x-r.c:z-r.c,along=r.axis==='x'?z:x;if(along<r.from||along>r.to)continue;const d=Math.abs(across)-r.half;if(d<best)best=d;}
  if(map==='coast'){const d=sunsetDistance(x,z)-SUNSET.width/2;if(d<best)best=d;}
  return best;
}
const inStunt=(x,z,m=3)=>x>STUNT_AREA.left-m&&x<STUNT_AREA.right+m&&z>STUNT_AREA.top-m&&z<STUNT_AREA.bottom+m;

/**
 * Walkable lanes for a map: [{x,z (Float32Array points), n, closed, nx,nz,len (per segment), y, kind:'street'|'beach', latMin, latMax}].
 * nx/nz is the unit normal pointing away from traffic, lat offsets are along it. Also returns seats (sea-wall sitting spots).
 */
export function sidewalkPaths(map){
  const roads=pedRoads(map),paths=[],seats=[];if(map!=='coast')return {paths,seats};
  const add=(corners,{closed=false,y=.06,kind='street',toward=null,away=null,latMin=-.9,latMax=2,valid=()=>true})=>{
    // Resample the polyline every PED.step metres, then split it wherever a point is invalid (asphalt, stunt park, sea).
    const px=[],pz=[];const m=corners.length,edges=closed?m:m-1;
    for(let i=0;i<edges;i++){const [ax,az]=corners[i],[bx,bz]=corners[(i+1)%m],L=Math.hypot(bx-ax,bz-az),k=Math.max(1,Math.round(L/PED.step));for(let j=0;j<k;j++){px.push(ax+(bx-ax)*j/k);pz.push(az+(bz-az)*j/k);}}
    if(!closed){px.push(corners[m-1][0]);pz.push(corners[m-1][1]);}
    const ok=px.map((x,i)=>valid(x,pz[i]));const N=px.length;
    const runs=[];if(ok.every(Boolean)&&closed)runs.push({idx:[...Array(N).keys()],closed:true});
    else{let start=ok.findIndex(v=>!v);if(start<0)start=0;// rotate so a closed loop's wrap-around run stays in one piece
      const order=closed?[...Array(N).keys()].map(i=>(i+start)%N):[...Array(N).keys()];let cur=[];
      for(const i of order){if(ok[i])cur.push(i);else{if(cur.length)runs.push({idx:cur,closed:false});cur=[];}}if(cur.length)runs.push({idx:cur,closed:false});}
    for(const run of runs){const n=run.idx.length;if(n<4)continue;
      const x=new Float32Array(n),z=new Float32Array(n);run.idx.forEach((k,i)=>{x[i]=px[k];z[i]=pz[k];});
      const segs=run.closed?n:n-1,nx=new Float32Array(segs),nz=new Float32Array(segs),len=new Float32Array(segs);
      for(let i=0;i<segs;i++){const j=(i+1)%n,dx=x[j]-x[i],dz=z[j]-z[i],L=Math.hypot(dx,dz)||1;len[i]=L;let ux=-dz/L,uz=dx/L;const mx=(x[i]+x[j])/2,mz=(z[i]+z[j])/2;
        let s=1;if(toward)s=(toward[0]-mx)*ux+(toward[1]-mz)*uz>=0?1:-1;else if(away)s=typeof away==='function'?away(mx,mz,ux,uz):((mx-away[0])*ux+(mz-away[1])*uz>=0?1:-1);nx[i]=ux*s;nz[i]=uz*s;}
      paths.push({x,z,n,closed:run.closed,nx,nz,len,y,kind,latMin,latMax});}
  };
  const coast=map==='coast',half=c=>roads.find(r=>r.c===c&&r.axis==='x').half,halfZ=c=>roads.find(r=>r.c===c&&r.axis==='z').half;
  const ok=(x,z,gap=1)=>roadGap(map,x,z,roads)>=gap&&!inStunt(x,z)&&x>ISLAND.left+1&&x<ISLAND.right-1&&z>ISLAND.top+1&&z<ISLAND.bottom-1;
  const blockValid=(x,z)=>ok(x,z)&&(!coast||sunsetDistance(x,z)>=SUNSET.width/2+2.6);
  const {roadsX,roadsZ}=ISLAND,inset=PED.inset;
  for(let i=0;i<roadsX.length-1;i++)for(let j=0;j<roadsZ.length-1;j++){
    const bx=(roadsX[i]+roadsX[i+1])/2,bz=(roadsZ[j]+roadsZ[j+1])/2;if(inStunt(bx,bz,0))continue;
    const x0=roadsX[i]+half(roadsX[i])+inset,x1=roadsX[i+1]-half(roadsX[i+1])-inset,z0=roadsZ[j]+halfZ(roadsZ[j])+inset,z1=roadsZ[j+1]-halfZ(roadsZ[j+1])-inset;
    add([[x0,z0],[x1,z0],[x1,z1],[x0,z1]],{closed:true,toward:[bx,bz],latMax:coast?1.2:2,valid:blockValid});// coast lots reach 54.3 m from the block centre
  }
  if(coast){// Sunset Mile's own 5 m sidewalks, 2.5 m off its kerbs, away from the diagonal.
    const dx=SUNSET.bx-SUNSET.ax,dz=SUNSET.bz-SUNSET.az,L=Math.hypot(dx,dz),px=-dz/L,pz=dx/L,o=SUNSET.width/2+2.5;
    for(const s of [-1,1])add([[SUNSET.ax+px*o*s,SUNSET.az+pz*o*s],[SUNSET.bx+px*o*s,SUNSET.bz+pz*o*s]],{away:(mx,mz,ux,uz)=>((mx-SUNSET.ax)*px+(mz-SUNSET.az)*pz)*(ux*px+uz*pz)>=0?1:-1,latMin:-1.2,latMax:1.8,valid:(x,z)=>ok(x,z,1.5)});
  }
  // Waterfront: a lane beside the outer roads and a promenade lane along the sea wall, both all the way round.
  const e=ISLAND.roadsX.at(-1)+12+inset,f=ISLAND.roadsZ.at(-1)+12+inset;
  add([[-e,-f],[e,-f],[e,f],[-e,f]],{closed:true,y:0,away:[0,0],latMin:-.6,latMax:2,valid:(x,z)=>ok(x,z)});
  add([[-485.5,-664.5],[485.5,-664.5],[485.5,664.5],[-485.5,664.5]],{closed:true,y:.03,toward:[0,0],latMin:-1.5,latMax:2,valid:(x,z)=>!inStunt(x,z)});
  // Beach strollers on the west and east sand (outside the drivable island), seated people on the sea wall facing the ocean.
  for(const s of [-1,1])for(const off of [23,29]){const x=s*(490+off);add([[x,-630],[x,630]],{y:.02-off*.009,kind:'beach',away:[0,0],latMin:-1.5,latMax:1.5});}
  for(const s of [-1,1])for(let z=-640;z<=640;z+=7){if(ISLAND.roadsZ.some(r=>Math.abs(z-r)<6))continue;seats.push({x:s*490.15,z,y:0,yaw:s<0?-Math.PI/2:Math.PI/2});}
  return {paths,seats};
}

/** Spawn samples on a coarse grid for allocation-free annulus queries. */
export class SidewalkIndex{
  constructor({paths,seats}){
    this.paths=paths;this.seats=seats;const P=[],S=[],cells=new Map();
    for(let p=0;p<paths.length;p++){const path=paths[p];let acc=PED.sampleStep;for(let s=0;s<path.len.length;s++){acc+=path.len[s];if(acc<PED.sampleStep)continue;acc=0;const i=P.length;P.push(p);S.push(s);const k=this.key(path.x[s],path.z[s]);if(!cells.has(k))cells.set(k,[]);cells.get(k).push(i);}}
    this.sp=Int32Array.from(P);this.ss=Int32Array.from(S);this.cells=new Map([...cells].map(([k,v])=>[k,Int32Array.from(v)]));
  }
  key(x,z){return (Math.floor(x/PED.cell)+512)*4096+Math.floor(z/PED.cell)+512;}
  get count(){return this.sp.length;}
}

/** LOD tier from camera distance: 0 every frame, 1 every 2nd, 2 every 4th, 3 hidden. */
export function lodTier(d){return d<35?0:d<70?1:d<PED.hideDist?2:3;}
export function mixerDue(tier,frame,slot){return tier===0||(tier===1&&((frame+slot)&1)===0)||(tier===2&&((frame+slot)&3)===0);}

/** Car-local overlap of the car box with a ped circle. car: {x,z,heading,width,length}. */
export function carOverlapsPed(car,x,z,r=PED.radius){
  const dx=x-car.x,dz=z-car.z,s=Math.sin(car.heading),c=Math.cos(car.heading);
  const lz=-dx*s-dz*c,lx=dx*c-dz*s;return Math.abs(lz)<(car.length||4.4)/2+r&&Math.abs(lx)<(car.width||1.9)/2+r;
}
/** 0 none, 1 flee, 2 dive, 3 hit (overlap at speed), 4 shove (overlap, slow). */
export function carThreat(ped,car){
  if(!car||(car.elevation||0)+(car.groundElevation||0)>1.2-ped.y)return 0;
  const vx=car.vx||0,vz=car.vz||0,sp=Math.hypot(vx,vz),dx=ped.x-car.x,dz=ped.z-car.z;
  if(Math.abs(dx)>PED.threatRange+3||Math.abs(dz)>PED.threatRange+3)return 0;
  if(carOverlapsPed(car,ped.x,ped.z))return sp>=PED.knockSpeed?3:4;
  if(sp<PED.threatSpeed)return 0;
  const along=(dx*vx+dz*vz)/sp,lateral=Math.abs(dx*vz-dz*vx)/sp,d=Math.hypot(dx,dz);
  if(along<=0||d>PED.threatRange||lateral>PED.threatLateral+(car.width||1.9)/2)return 0;
  return along/sp<PED.diveTti&&lateral<PED.diveLateral+(car.width||1.9)/2?2:1;
}
/** Launch a ped along the car's velocity, up, with a tumble. Returns impact speed. */
export function knockPed(ped,car,random=Math.random){
  const vx=car.vx||0,vz=car.vz||0,sp=Math.hypot(vx,vz)||1,side=((ped.x-car.x)*vz-(ped.z-car.z)*vx)>=0?1:-1,kick=1.5+sp*.12;
  ped.vx=vx*.85+(vz/sp)*side*kick;ped.vz=vz*.85-(vx/sp)*side*kick;ped.vy=Math.min(9,3.2+sp*.2);
  const hs=Math.hypot(ped.vx,ped.vz)||1;ped.ax=ped.vz/hs;ped.az=-ped.vx/hs;ped.spin=0;ped.spinRate=(6+random()*5)*(random()<.5?-1:1);
  ped.state='knocked';ped.t=0;ped.anim=ANIM.AIR;ped.animRate=1;ped.bounced=false;ped.yaw=Math.atan2(-vx,-vz);return sp;
}
/** Ballistic tumble until landing, one small bounce, then down. */
export function stepKnocked(ped,dt){
  ped.t+=dt;ped.vy+=PED.gravity*dt;ped.x+=ped.vx*dt;ped.z+=ped.vz*dt;ped.y+=ped.vy*dt;ped.spin+=ped.spinRate*dt;
  const drag=Math.exp(-dt*.6);ped.vx*=drag;ped.vz*=drag;
  if(ped.y<=ped.groundY&&ped.vy<0&&ped.t>.12){ped.y=ped.groundY;
    if(!ped.bounced&&ped.vy<-5){ped.bounced=true;ped.vy*=-.28;ped.vx*=.45;ped.vz*=.45;ped.spinRate*=.4;}
    else{ped.state='down';ped.t=0;ped.vx=ped.vz=ped.vy=0;ped.anim=ANIM.DEATH;ped.animStart=1.35;ped.animRate=1;}}
}
/** Lying peds recycle a few seconds after the camera stops seeing them (hard cap downMax). */
export function downExpired(ped,seen){return (ped.t>PED.downMin&&!seen)||ped.t>PED.downMax;}

function newPed(slot){return {slot,active:false,serial:0,sex:slot&1,look:0,state:'idle',t:0,x:0,y:0,z:0,groundY:0,yaw:0,p:0,s:0,u:0,dir:1,lat:0,latHome:0,latTarget:0,avoidT:0,speed:1.2,walkAnim:ANIM.WALK,nextStop:10,anim:ANIM.IDLE,animRate:1,animStart:0,vx:0,vy:0,vz:0,ax:1,az:0,spin:0,spinRate:0,bounced:false,dist:1e9,seat:-1,fleeDir:1};}

/**
 * Crowd simulation around a viewer. step(dt,car,view) — view: {x,z, inFrustum(x,y,z)->bool}.
 * obstacles: [{x,z,r}] static circles (lamps, palms, props) the walkers sidestep; buildings: [{minX,maxX,minZ,maxZ}] spawn blockers.
 */
export class CrowdSim{
  constructor(map,{obstacles=[],buildings=[],random=seeded(4242),onKnock=null}={}){
    this.map=map;this.random=random;this.onKnock=onKnock;this.layout=sidewalkPaths(map);this.index=new SidewalkIndex(this.layout);this.roads=pedRoads(map);
    this.buildings=buildings;this.peds=[];this.target=0;this.frame=0;this.fresh=true;this.lastX=NaN;this.lastZ=NaN;this.knocks=0;this.seatUsed=new Uint8Array(this.layout.seats.length);
    // Obstacle circles in an 8 m hash grid.
    const G=8,cells=new Map();this.ox=Float32Array.from(obstacles.map(o=>o.x));this.oz=Float32Array.from(obstacles.map(o=>o.z));this.or=Float32Array.from(obstacles.map(o=>o.r));
    obstacles.forEach((o,i)=>{const k=this.okey(o.x,o.z);if(!cells.has(k))cells.set(k,[]);cells.get(k).push(i);});this.ocells=new Map([...cells].map(([k,v])=>[k,Int32Array.from(v)]));this.G=G;
  }
  okey(x,z){return (Math.floor(x/8)+1024)*8192+Math.floor(z/8)+1024;}
  setCount(n){this.target=Math.max(0,n|0);while(this.peds.length<this.target)this.peds.push(newPed(this.peds.length));for(let i=this.target;i<this.peds.length;i++)this.deactivate(this.peds[i]);}
  reset(){for(const p of this.peds)this.deactivate(p);this.fresh=true;}
  deactivate(p){if(p.seat>=0)this.seatUsed[p.seat]=0;p.seat=-1;p.active=false;p.state='idle';}
  get active(){let n=0;for(const p of this.peds)if(p.active)n++;return n;}
  insideBuilding(x,z,m=.6){for(const b of this.buildings)if(x>b.minX-m&&x<b.maxX+m&&z>b.minZ-m&&z<b.maxZ+m)return true;return false;}
  crowded(x,z,r=2.2){for(const p of this.peds)if(p.active&&Math.abs(p.x-x)<r&&Math.abs(p.z-z)<r)return true;return false;}
  /** Lane point (no lateral offset) for path p, segment s, distance u along it. */
  lane(path,s,u,out){const j=(s+1)%path.n,t=u/path.len[s];out.x=path.x[s]+(path.x[j]-path.x[s])*t;out.z=path.z[s]+(path.z[j]-path.z[s])*t;return out;}
  spawnOk(x,z,d,view){
    if(this.fresh)return d>=PED.freshMin&&d<=PED.spawnMax;
    if(d<PED.spawnMin||d>PED.spawnMax)return false;const seen=view.inFrustum(x,1,z);
    return seen?d>=PED.farSpawn:d<=PED.nearView;
  }
  trySpawn(p,view){
    const R=this.random,seats=this.layout.seats;
    if(seats.length&&R()<.14){for(let a=0;a<6;a++){const k=Math.floor(R()*seats.length),st=seats[k];if(this.seatUsed[k])continue;const d=Math.hypot(st.x-view.x,st.z-view.z);if(!this.spawnOk(st.x,st.z,d,view))continue;
      this.seatUsed[k]=1;p.seat=k;this.place(p,st.x,st.y,st.z,st.yaw);p.state='sit';p.anim=ANIM.SIT;p.animRate=.8+R()*.4;return true;}}
    const idx=this.index;
    for(let a=0;a<24;a++){
      const ang=R()*Math.PI*2,r=(this.fresh?PED.freshMin:PED.spawnMin)+R()*(PED.spawnMax-(this.fresh?PED.freshMin:PED.spawnMin)),list=idx.cells.get(idx.key(view.x+Math.cos(ang)*r,view.z+Math.sin(ang)*r));
      if(!list)continue;const i=list[Math.floor(R()*list.length)],path=this.layout.paths[idx.sp[i]],s=idx.ss[i],u=R()*path.len[s];
      const pt=this.lane(path,s,u,_pt),lat=path.latMin*.4+R()*(path.latMax*.7-path.latMin*.4),x=pt.x+path.nx[s]*lat,z=pt.z+path.nz[s]*lat,d=Math.hypot(x-view.x,z-view.z);
      if(!this.spawnOk(x,z,d,view)||this.crowded(x,z)||this.insideBuilding(x,z))continue;
      p.p=idx.sp[i];p.s=s;p.u=u;p.dir=R()<.5?1:-1;p.lat=p.latHome=p.latTarget=lat;p.avoidT=0;
      p.speed=PED.walkMin+R()*(PED.walkMax-PED.walkMin);if(path.kind==='beach')p.speed*=.8;p.walkAnim=R()<.3?ANIM.WALK_FORMAL:ANIM.WALK;
      const tx=(path.x[(s+1)%path.n]-path.x[s])*p.dir,tz=(path.z[(s+1)%path.n]-path.z[s])*p.dir;this.place(p,x,path.y,z,Math.atan2(tx,tz));
      p.nextStop=6+R()*26;if(R()<.18){p.state='idle';p.t=-(2+R()*5);p.anim=R()<.5?ANIM.TALK:ANIM.IDLE;p.animRate=.9+R()*.2;}else this.walk(p);
      return true;
    }
    return false;
  }
  place(p,x,y,z,yaw){p.active=true;p.serial++;p.look=Math.floor(this.random()*1e9);p.x=x;p.y=p.groundY=y;p.z=z;p.yaw=yaw;p.t=0;p.spin=0;p.vx=p.vy=p.vz=0;p.dist=0;p.animStart=0;}
  walk(p){p.state='walk';p.t=0;p.anim=p.walkAnim;p.animRate=p.speed/CLIP_SPEED[p.walkAnim];}
  step(dt,car,view){
    this.frame++;let knocks=0;const R=this.random;
    if(Number.isFinite(this.lastX)&&Math.hypot(view.x-this.lastX,view.z-this.lastZ)>PED.teleport)this.reset();this.lastX=view.x;this.lastZ=view.z;
    // Recycle peds that drifted out of range or are behind the camera; lying peds once nobody sees them.
    for(const p of this.peds){if(!p.active)continue;const d=Math.hypot(p.x-view.x,p.z-view.z);p.dist=d;
      if(p.state==='down'){p.t+=dt;if(downExpired(p,d<PED.hideDist&&view.inFrustum(p.x,.5,p.z)))this.deactivate(p);continue;}
      if(p.state==='knocked')continue;
      if(d>PED.despawn||(d>PED.behindDespawn&&!view.inFrustum(p.x,1,p.z)))this.deactivate(p);}
    let budget=this.fresh?this.target:2;
    for(let i=0;i<this.target&&budget>0;i++){const p=this.peds[i];if(p.active)continue;budget--;this.trySpawn(p,view);}
    this.fresh=false;
    for(let i=0;i<this.target;i++){const p=this.peds[i];if(!p.active)continue;
      if(p.state==='knocked'){stepKnocked(p,dt);continue;}if(p.state==='down')continue;
      if(car&&p.state!=='sit'){const threat=carThreat(p,car);
        if(threat===3){knockPed(p,car,R);knocks++;this.knocks++;this.lastKnock=Math.hypot(car.vx||0,car.vz||0);this.onKnock?.(p,car);continue;}
        if(threat===4&&p.state!=='hit'){p.state='hit';p.t=0;p.anim=ANIM.HIT;p.animRate=1;this.flee(p,car,1.1);}
        else if(threat===2&&p.state!=='dive')this.dive(p,car);
        else if(threat===1&&p.state!=='flee'&&p.state!=='dive')this.flee(p,car,2.5+R()*1.5);}
      this.move(p,dt);
    }
    return knocks;
  }
  flee(p,car,time){const path=this.layout.paths[p.p],s=p.s,tx=path.x[(s+1)%path.n]-path.x[s],tz=path.z[(s+1)%path.n]-path.z[s];
    p.dir=(p.x-car.x)*tx+(p.z-car.z)*tz>=0?1:-1;if(p.state!=='hit'){p.state='flee';p.anim=ANIM.SPRINT;}p.fleeT=time;p.t=0;p.latTarget=path.latMax+.6;p.avoidT=time;
    p.runSpeed=PED.fleeSpeed*(.85+this.random()*.3);if(p.state==='flee')p.animRate=p.runSpeed/CLIP_SPEED[ANIM.SPRINT];}
  dive(p,car){// Roll sideways away from the car's line when that is away from traffic, otherwise straight along the lane.
    const path=this.layout.paths[p.p],s=p.s,vx=car.vx||0,vz=car.vz||0,side=((p.x-car.x)*vz-(p.z-car.z)*vx)>=0?1:-1,awayX=vz*side,awayZ=-vx*side;
    const inward=awayX*path.nx[s]+awayZ*path.nz[s]>0;p.state='dive';p.t=0;p.anim=ANIM.ROLL;p.animRate=1.47/PED.diveTime;p.diveLat=inward?1:0;p.latTarget=path.latMax+.6;p.avoidT=3;
    const tx=path.x[(s+1)%path.n]-path.x[s],tz=path.z[(s+1)%path.n]-path.z[s];p.dir=(p.x-car.x)*tx+(p.z-car.z)*tz>=0?1:-1;
    if(inward){const h=Math.hypot(awayX,awayZ)||1;p.yaw=Math.atan2(awayX/h,awayZ/h);}}
  move(p,dt){
    const path=this.layout.paths[p.p];if(!path||p.state==='sit')return;p.t+=dt;const R=this.random;let v=0;
    switch(p.state){
      case 'walk':v=p.speed;p.nextStop-=dt;if(p.nextStop<=0){p.state='idle';p.t=-(2+R()*5);p.anim=R()<.45?ANIM.TALK:ANIM.IDLE;p.animRate=.9+R()*.2;p.nextStop=8+R()*28;}break;
      case 'idle':if(p.t>=0){if(R()<.3)p.dir=-p.dir;this.walk(p);}break;
      case 'hit':v=p.t<.35?0:p.runSpeed*.6;if(p.t>.35&&p.anim===ANIM.HIT){p.anim=ANIM.JOG;p.animRate=v/CLIP_SPEED[ANIM.JOG];}if(p.t>p.fleeT){p.latTarget=p.latHome;this.walk(p);}break;
      case 'flee':v=p.runSpeed;if(p.t>p.fleeT){p.latTarget=p.latHome;this.walk(p);}break;
      case 'dive':v=p.diveLat?0:PED.diveSpeed;if(p.diveLat)p.lat=Math.min(path.latMax+2.5,p.lat+PED.diveSpeed*dt);if(p.t>PED.diveTime){p.state='flee';p.anim=ANIM.SPRINT;p.fleeT=p.t+1.2+R();p.runSpeed=PED.fleeSpeed*.8;p.animRate=p.runSpeed/CLIP_SPEED[ANIM.SPRINT];}break;
    }
    if(v>0)this.advance(p,path,v*dt);
    // Lateral: drift toward the target offset; avoidance retargets it every 4th frame per ped (staggered).
    if(p.state==='walk'&&((this.frame+p.slot)&3)===0)this.avoid(p,path);
    if(p.avoidT>0){p.avoidT-=dt;if(p.avoidT<=0)p.latTarget=p.latHome;}
    if(p.state!=='dive'){const dl=p.latTarget-p.lat,maxStep=(p.state==='walk'?.9:2.6)*dt;p.lat+=Math.abs(dl)<maxStep?dl:Math.sign(dl)*maxStep;}
    const s=p.s,pt=this.lane(path,s,p.u,_pt);p.x=pt.x+path.nx[s]*p.lat;p.z=pt.z+path.nz[s]*p.lat;p.y=p.groundY=path.y;
    if(p.state!=='dive'||!p.diveLat){const j=(s+1)%path.n,tx=(path.x[j]-path.x[s])*p.dir,tz=(path.z[j]-path.z[s])*p.dir,want=Math.atan2(tx,tz);let da=want-p.yaw;da-=Math.round(da/(Math.PI*2))*Math.PI*2;p.yaw+=da*Math.min(1,dt*(p.state==='walk'?6:12));}
  }
  advance(p,path,ds){
    const segs=path.len.length;p.u+=ds*p.dir;
    while(p.u>path.len[p.s]){if(p.s+1<segs){p.u-=path.len[p.s];p.s++;}else if(path.closed){p.u-=path.len[p.s];p.s=0;}else{p.u=path.len[p.s];p.dir=-1;break;}}
    while(p.u<0){if(p.s>0){p.s--;p.u+=path.len[p.s];}else if(path.closed){p.s=segs-1;p.u+=path.len[p.s];}else{p.u=0;p.dir=1;break;}}
  }
  avoid(p,path){
    const s=p.s,j=(s+1)%path.n,tx=(path.x[j]-path.x[s])*p.dir/path.len[s],tz=(path.z[j]-path.z[s])*p.dir/path.len[s],nx=path.nx[s],nz=path.nz[s];
    const lx=p.x+tx*1.6,lz=p.z+tz*1.6;let want=p.latHome,hit=false;
    // Static circles (lamps, palms, signals, street props).
    for(let ci=-1;ci<=1;ci++)for(let cj=-1;cj<=1;cj++){const list=this.ocells.get(this.okey(lx+ci*8,lz+cj*8));if(!list)continue;
      for(let k=0;k<list.length;k++){const o=list[k],dx=this.ox[o]-lx,dz=this.oz[o]-lz,r=this.or[o]+PED.radius+.2;if(dx*dx+dz*dz>(r+1.2)*(r+1.2))continue;
        const along=dx*tx+dz*tz;if(along<-1.4||along>1.2)continue;const olat=p.lat+dx*nx+dz*nz;if(Math.abs(olat-want)>=r)continue;
        const a=olat-r,b=olat+r,canA=a>=path.latMin,canB=b<=path.latMax;want=canA&&(!canB||Math.abs(a-p.lat)<=Math.abs(b-p.lat))?a:canB?b:want;hit=true;}}
    // Oncoming or slower peds ahead: keep right (relative to travel).
    const right=(tz*nx-tx*nz)>=0?1:-1;
    for(const q of this.peds){if(q===p||!q.active||q.state==='sit')continue;const dx=q.x-p.x,dz=q.z-p.z;if(dx*dx+dz*dz>2.6)continue;const along=dx*tx+dz*tz;if(along<=0)continue;
      const side=Math.abs(dx*nx+dz*nz);if(side<.75){want=Math.max(path.latMin,Math.min(path.latMax,want+right*.8));hit=true;}}
    if(hit){p.latTarget=want;p.avoidT=1.1;}
  }
}
const _pt={x:0,z:0};
