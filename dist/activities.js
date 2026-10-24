// Open-world activities: speed traps (Forza Horizon), drift zones (Forza/NFS) and hidden packages (GTA).
// Pure logic: no three.js, no DOM. Inputs are positions and speeds; outputs are plain event objects.
// Every update reuses its event objects, so the driving loop allocates nothing per frame.
// World metres, physics heading convention (0 faces -z). Positions come from map-layout.js road grid.
const S2=Math.SQRT1_2;
const trap=(id,name,x,z,dx,dz)=>Object.freeze({id,name,x,z,dx,dz});
const zone=(id,name,minX,maxX,minZ,maxZ)=>Object.freeze({id,name,minX,maxX,minZ,maxZ});
const pkg=(x,z,y=1.3)=>Object.freeze({x,z,y});
export const TRAP_HALF_WIDTH=15;            // metres either side of the road centre that a pass counts
export const TRAP_STARS=Object.freeze([110,150,190]); // km/h for 1, 2 and 3 stars
export const TRAP_HEAT_KMH=160;             // passing a camera faster than this raises the wanted level
export const DRIFT_MIN_ANGLE=12*Math.PI/180,DRIFT_MIN_SPEED=9,DRIFT_GRACE=1.4,DRIFT_COMBO_STEP=2.5,DRIFT_MAX_MULT=5;
export const PICKUP_RADIUS=3.6,PICKUP_HEIGHT=2.8;

// Shared Solana road grid (roads every 150 m, 28 m wide; sidewalks 10-14 m off the centre line).
const GRID_TRAPS=[trap('boardwalk','Boardwalk Straight',-450,-230,0,-1),trap('east','Harbor Boulevard',450,200,0,1),trap('gardens','Palm Gardens Run',-75,-600,1,0),trap('arts','Warehouse Mile',75,600,-1,0),trap('central','Central Avenue',0,-225,0,1)];
const GRID_ZONES=[zone('nw','Gardens Hairpin',-466,-360,-616,-520),zone('ne','Harbor Hairpin',360,466,-616,-520),zone('se','Arts Hairpin',360,466,520,616)];
const GRID_PACKAGES=[
  // Beach between the shoreline and the boardwalk road.
  pkg(-474,-560),pkg(-474,-200),pkg(-474,260),
  // Ramp lips (collected on the deck or in the air just above it).
  pkg(-410,535.5,4.5),pkg(-355,485,6.1),pkg(-455,-104.5,4.5),
  // Stunt park floor.
  pkg(-330,340),pkg(-420,345),
  // Sidewalks and kerbs, mid-block in every district.
  pkg(161,-540),pkg(-306,-75),pkg(311,225),pkg(-161,375),pkg(11,525),pkg(439,-375),pkg(-75,461),pkg(225,-161),
  pkg(375,311),pkg(-225,139),pkg(75,-289),pkg(-375,11),pkg(225,11),pkg(439,525),pkg(-439,-525),
];
export const ACTIVITY_LAYOUTS=Object.freeze({
  coast:Object.freeze({
    traps:Object.freeze([...GRID_TRAPS,trap('sunset','Sunset Mile',-75,-375,S2,-S2)]),
    zones:Object.freeze(GRID_ZONES),
    // The diagonal Sunset Mile only exists on the Coast map.
    packages:Object.freeze([...GRID_PACKAGES,pkg(-200,-250),pkg(50,-500)]),
  }),

});
export function layoutFor(map){return ACTIVITY_LAYOUTS[map]||ACTIVITY_LAYOUTS.coast;}
export function trapStars(kmh){let s=0;for(const t of TRAP_STARS)if(kmh>=t)s++;return s;}
export function starString(n,max=3){return '★'.repeat(n)+'☆'.repeat(Math.max(0,max-n));}

/** Persistent per-map progress in one localStorage JSON entry. Survives a blocked or missing storage. */
export class ActivityStore{
  constructor(map,storage){this.key='speed-for-need-activities-'+map;this.storage=storage;this.data={traps:{},zones:{},packages:[]};
    try{const raw=storage?.getItem(this.key);if(raw){const d=JSON.parse(raw);if(d&&typeof d==='object'){this.data.traps=d.traps&&typeof d.traps==='object'?d.traps:{};this.data.zones=d.zones&&typeof d.zones==='object'?d.zones:{};this.data.packages=Array.isArray(d.packages)?d.packages.filter(Number.isInteger):[];}}}catch{}}
  save(){try{this.storage?.setItem(this.key,JSON.stringify(this.data));}catch{}}
}

/** Camera lines across a road. A pass is a sign change of the along-road offset while within the road width. */
export class SpeedTraps{
  constructor(traps,store){this.traps=traps;this.store=store;this.side=new Float64Array(traps.length);this.armed=false;
    this.event={type:'trap',id:'',name:'',index:-1,kmh:0,stars:0,best:0,newBest:false};}
  reset(){this.armed=false;}
  best(id){return Number(this.store?.data.traps[id])||0;}
  /** Returns the shared event object on the frame the car crosses a camera line, else null. */
  update(x,z,speed){
    let hit=null;
    for(let i=0;i<this.traps.length;i++){
      const t=this.traps[i],rx=x-t.x,rz=z-t.z,along=rx*t.dx+rz*t.dz,lateral=Math.abs(rx*t.dz-rz*t.dx),prev=this.side[i];this.side[i]=along;
      if(!this.armed||hit||lateral>TRAP_HALF_WIDTH||Math.abs(along)>40)continue;
      if((prev<0&&along>=0)||(prev>0&&along<=0)){
        const e=this.event,kmh=Math.round(speed*3.6),best=this.best(t.id);
        e.id=t.id;e.name=t.name;e.index=i;e.kmh=kmh;e.stars=trapStars(kmh);e.newBest=kmh>best;e.best=Math.max(best,kmh);
        if(e.newBest&&this.store){this.store.data.traps[t.id]=kmh;this.store.save();}
        hit=e;
      }
    }
    this.armed=true;return hit;
  }
}

export function inZone(z,x,zz){return x>=z.minX&&x<=z.maxX&&zz>=z.minZ&&zz<=z.maxZ;}
/** Slip angle between the heading and the velocity, folded to 0..90 degrees (reverse slides count). */
export function driftAngle(forwardSpeed,lateralSpeed){return Math.atan2(Math.abs(lateralSpeed),Math.abs(forwardSpeed));}

/**
 * Drift zones. Inside a zone, points accrue at angle(deg) x speed(m/s) per second times the combo multiplier.
 * The multiplier climbs every DRIFT_COMBO_STEP seconds of unbroken drift. Straightening up for longer than
 * DRIFT_GRACE banks the chain; a crash throws the unbanked chain away. Leaving the zone posts the result.
 */
export class DriftZones{
  constructor(zones,store){this.zones=zones;this.store=store;this.active=-1;this.banked=0;this.chain=0;this.mult=1;this.drifting=0;this.idle=0;this.live=false;
    this.event={type:'drift',id:'',name:'',score:0,best:0,newBest:false,crash:false};this.state={type:'drift-live',id:'',name:'',score:0,chain:0,mult:1,drifting:false};}
  best(id){return Number(this.store?.data.zones[id])||0;}
  get total(){return Math.round(this.banked+this.chain);}
  reset(){this.active=-1;this.banked=this.chain=0;this.mult=1;this.drifting=this.idle=0;}
  bank(){this.banked+=this.chain;this.chain=0;this.mult=1;this.drifting=0;}
  /** Returns a result event on zone exit or a crash, the live state while inside, or null outside. */
  update(dt,x,z,forwardSpeed,lateralSpeed,crashed=false){
    let index=-1;for(let i=0;i<this.zones.length;i++)if(inZone(this.zones[i],x,z)){index=i;break;}
    if(index!==this.active){
      const leaving=this.active,e=this.event;
      if(leaving>=0){this.bank();const zn=this.zones[leaving],score=Math.round(this.banked),best=this.best(zn.id);
        e.id=zn.id;e.name=zn.name;e.score=score;e.crash=false;e.newBest=score>best&&score>0;e.best=Math.max(best,score);
        if(e.newBest&&this.store){this.store.data.zones[zn.id]=score;this.store.save();}}
      this.reset();this.active=index;if(leaving>=0)return e;
    }
    if(index<0)return null;
    const speed=Math.hypot(forwardSpeed,lateralSpeed),angle=driftAngle(forwardSpeed,lateralSpeed),on=speed>=DRIFT_MIN_SPEED&&angle>=DRIFT_MIN_ANGLE;
    const zn=this.zones[index];
    if(crashed&&(this.chain>0||this.drifting>0)){this.chain=0;this.mult=1;this.drifting=0;this.idle=0;const e=this.event;e.id=zn.id;e.name=zn.name;e.score=Math.round(this.banked);e.best=this.best(zn.id);e.newBest=false;e.crash=true;return e;}
    if(on){this.idle=0;this.drifting+=dt;this.mult=Math.min(DRIFT_MAX_MULT,1+Math.floor(this.drifting/DRIFT_COMBO_STEP));this.chain+=Math.min(angle,Math.PI/2)*180/Math.PI*speed*dt*this.mult*.5;}
    else if(this.chain>0){this.idle+=dt;if(this.idle>DRIFT_GRACE)this.bank();}
    const s=this.state;s.id=zn.id;s.name=zn.name;s.score=this.total;s.chain=Math.round(this.chain);s.mult=this.mult;s.drifting=on;return s;
  }
}

const NUDGES=[[0,0],[0,8],[0,-8],[8,0],[-8,0],[0,16],[0,-16],[16,0],[-16,0],[6,6],[-6,-6],[6,-6],[-6,6],[0,24],[0,-24],[24,0],[-24,0]];
/**
 * Moves any package that landed inside a collider (parked cars and street props vary by build) to the nearest
 * free spot among fixed nudges. Index order is preserved, so saved progress stays valid. Run once at load.
 */
export function placePackages(packages,isBlocked){
  return Object.freeze(packages.map(p=>{if(!isBlocked)return p;for(const [dx,dz] of NUDGES)if(!isBlocked(p.x+dx,p.z+dz,p.y))return dx||dz?Object.freeze({...p,x:p.x+dx,z:p.z+dz}):p;return p;}));
}

/** Hidden packages. Collected indices persist per map. */
export class Collectibles{
  constructor(packages,store){this.packages=packages;this.store=store;this.collected=new Uint8Array(packages.length);
    for(const i of store?.data.packages||[])if(i>=0&&i<packages.length)this.collected[i]=1;
    this.event={type:'package',index:-1,count:0,total:packages.length};}
  get count(){let n=0;for(const c of this.collected)n+=c;return n;}
  get total(){return this.packages.length;}
  /** y is the car's height above the ground plane (stunt decks and jumps). */
  update(x,y,z){
    for(let i=0;i<this.packages.length;i++){
      if(this.collected[i])continue;const p=this.packages[i],dx=x-p.x,dz=z-p.z;
      if(dx*dx+dz*dz<=PICKUP_RADIUS*PICKUP_RADIUS&&Math.abs(y+.6-p.y)<=PICKUP_HEIGHT){
        this.collected[i]=1;if(this.store){this.store.data.packages.push(i);this.store.save();}
        const e=this.event;e.index=i;e.count=this.count;return e;
      }
    }
    return null;
  }
}

/** Formats an event as the one-line toast the HUD shows. */
export function describeEvent(e){
  if(!e)return '';
  if(e.type==='trap')return `${e.name.toUpperCase()} · ${e.kmh} KM/H ${starString(e.stars)}${e.newBest?' · NEW BEST':` · BEST ${e.best}`}`;
  if(e.type==='drift')return e.crash?`DRIFT CHAIN LOST · ${e.score.toLocaleString('en-US')}`:`${e.name.toUpperCase()} · ${e.score.toLocaleString('en-US')} PTS${e.newBest?' · NEW BEST':` · BEST ${e.best.toLocaleString('en-US')}`}`;
  if(e.type==='drift-live')return `DRIFT ZONE · ${e.score.toLocaleString('en-US')}${e.mult>1?` ×${e.mult}`:''}`;
  if(e.type==='package')return `HIDDEN PACKAGE ${e.count}/${e.total}${e.count===e.total?' · ALL FOUND!':''}`;
  return '';
}
