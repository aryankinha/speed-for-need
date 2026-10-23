// Wanted level and police pursuit (GTA / NFS Most Wanted). Pure logic: no three.js, no DOM.
// Heat rises from reckless driving; stars (0-3) follow fixed heat thresholds. Each star puts one pursuer
// on the road. Cops route along the road grid (Manhattan legs) and switch to predictive pursuit up close.
// Escape: every cop farther than LOSE_DISTANCE and out of sight for ESCAPE_TIME. Busted: nearly stopped
// with a cop alongside for BUST_TIME. Other modules raise heat through the exported addHeat().
export const WANTED_DEFAULTS=Object.freeze({
  thresholds:Object.freeze([1,3.5,7]), // heat for 1, 2 and 3 stars
  loseDistance:250,sightDistance:400,roadHalf:14,escapeTime:8,
  bustTime:3,bustSpeed:5/3.6,bustRadius:7.5,
  idleDecay:.08,                       // heat lost per second while not wanted, so stray bumps do not add up
  copSpeeds:Object.freeze([34,40,46]),  // pursuit speed cap (m/s) per star level
  directRange:70,turnSpeed:13,turnBrake:8,copAccel:10,
});
export const POLICE_KEY='speed-for-need-police';
export const HEAT=Object.freeze({traffic:.6,police:1.2,trap:1,prop:.25});

export function starsForHeat(heat,thresholds=WANTED_DEFAULTS.thresholds){let s=0;for(const t of thresholds)if(heat>=t)s++;return s;}
export function readPoliceSetting(storage){try{return storage?.getItem(POLICE_KEY)!=='off';}catch{return true;}}
export function writePoliceSetting(storage,on){try{storage?.setItem(POLICE_KEY,on?'on':'off');}catch{}}

function nearestLine(v,lines){let best=lines[0],d=Infinity;for(const l of lines){const dd=Math.abs(v-l);if(dd<d){d=dd;best=l;}}return best;}

/** True when a cop can see the player: close by, or on the same straight road within sight distance. */
export function copSeesPlayer(cop,player,roads,cfg=WANTED_DEFAULTS){
  const d=Math.hypot(cop.x-player.x,cop.z-player.z);
  if(d<=cfg.loseDistance)return true;if(d>cfg.sightDistance)return false;
  for(const x of roads.roadsX)if(Math.abs(cop.x-x)<cfg.roadHalf&&Math.abs(player.x-x)<cfg.roadHalf)return true;
  for(const z of roads.roadsZ)if(Math.abs(cop.z-z)<cfg.roadHalf&&Math.abs(player.z-z)<cfg.roadHalf)return true;
  return false;
}

/**
 * Desired velocity and heading for one pursuer (the physics target API, as traffic uses).
 * Writes into `out` and returns it: {vx,vz,heading,maxAcceleration,wx,wz,mode}.
 */
export function pursuitTarget(cop,player,roads,maxSpeed,out,cfg=WANTED_DEFAULTS){
  const cx=cop.x,cz=cop.z,px=player.x,pz=player.z,dist=Math.hypot(px-cx,pz-cz);
  let wx,wz,turn=false;
  if(dist<cfg.directRange){
    // Predictive pursuit: aim where the player will be, then match their speed once alongside.
    const lead=Math.min(1.2,dist/Math.max(8,cop.speed||0));wx=px+(player.vx||0)*lead;wz=pz+(player.vz||0)*lead;out.mode='direct';
  }else{
    const h=cfg.roadHalf-2,rxc=nearestLine(cx,roads.roadsX),rzc=nearestLine(cz,roads.roadsZ),rxp=nearestLine(px,roads.roadsX),rzp=nearestLine(pz,roads.roadsZ);
    const onV=Math.abs(cx-rxc)<h,onH=Math.abs(cz-rzc)<h;
    if(onV&&onH){
      if(rxc===rxp){wx=rxc;wz=pz;}else if(rzc===rzp){wx=px;wz=rzc;}
      else if(Math.abs(px-cx)>Math.abs(pz-cz)){wx=rxp;wz=rzc;turn=true;}else{wx=rxc;wz=rzp;turn=true;}
    }else if(onV){if(rxc===rxp){wx=rxc;wz=pz;}else{wx=rxc;wz=rzp;turn=true;}}
    else if(onH){if(rzc===rzp){wx=px;wz=rzc;}else{wx=rxp;wz=rzc;turn=true;}}
    else if(Math.abs(cx-rxc)<Math.abs(cz-rzc)){wx=rxc;wz=cz;}else{wx=cx;wz=rzc;}
    out.mode='grid';
  }
  let dx=wx-cx,dz=wz-cz,n=Math.hypot(dx,dz);if(n<.01){dx=-Math.sin(cop.heading||0);dz=-Math.cos(cop.heading||0);n=1;}
  let speed=maxSpeed;
  if(out.mode==='direct'){const ps=Math.hypot(player.vx||0,player.vz||0);speed=Math.min(maxSpeed,dist<12?ps+2:ps+6+dist*.35);}
  else if(turn)speed=Math.min(maxSpeed,Math.sqrt(cfg.turnSpeed*cfg.turnSpeed+2*cfg.turnBrake*Math.max(0,n-8)));
  // Sharp change of direction (a corner taken from inside the intersection, or a U-turn): corner speed.
  if(cop.speed>cfg.turnSpeed&&(dx*-Math.sin(cop.heading||0)+dz*-Math.cos(cop.heading||0))/n<.8)speed=Math.min(speed,cfg.turnSpeed);
  out.vx=dx/n*speed;out.vz=dz/n*speed;out.heading=Math.atan2(-dx,-dz);out.maxAcceleration=cfg.copAccel;out.wx=wx;out.wz=wz;
  return out;
}

/**
 * Road points about `radius` metres from the player, sorted so points behind the player come first.
 * Called only when a pursuer spawns, never per frame.
 */
export function spawnCandidates(player,roads,bounds,radius=130){
  const out=[],fx=-Math.sin(player.heading||0),fz=-Math.cos(player.heading||0),m=20;
  const add=(x,z)=>{if(x<bounds.left+m||x>bounds.right-m||z<bounds.top+m||z>bounds.bottom-m)return;const behind=(x-player.x)*fx+(z-player.z)*fz;out.push({x,z,heading:0,score:behind});};
  for(const x of roads.roadsX){const d=Math.abs(x-player.x);if(d>radius)continue;const s=Math.sqrt(radius*radius-d*d);add(x,player.z+s);add(x,player.z-s);}
  for(const z of roads.roadsZ){const d=Math.abs(z-player.z);if(d>radius)continue;const s=Math.sqrt(radius*radius-d*d);add(player.x+s,z);add(player.x-s,z);}
  for(const c of out)c.heading=Math.atan2(-(player.x-c.x),-(player.z-c.z));
  return out.sort((a,b)=>a.score-b.score);
}

export class WantedSystem{
  constructor({enabled=true,config={}}={}){this.cfg={...WANTED_DEFAULTS,...config};this.enabled=enabled;this.heat=0;this.stars=0;this.escape=0;this.bust=0;this.seen=false;this.pending=false;
    this.event={type:'',stars:0,previous:0};}
  get escaping(){return this.stars>0&&!this.seen&&this.escape>0;}
  get desiredCops(){return this.enabled?Math.min(3,this.stars):0;}
  copSpeed(){return this.cfg.copSpeeds[Math.max(0,Math.min(this.cfg.copSpeeds.length-1,this.stars-1))];}
  setEnabled(on){this.enabled=!!on;if(!this.enabled)this.clear();}
  clear(){this.heat=0;this.stars=0;this.escape=0;this.bust=0;this.seen=false;}
  /** Public: raise the wanted level. Ignored while chases are switched off. Returns the star count. */
  addHeat(amount){
    if(!this.enabled||!(amount>0))return this.stars;
    const before=this.stars;this.heat=Math.min(this.cfg.thresholds[this.cfg.thresholds.length-1]+3,this.heat+amount);this.stars=Math.max(this.stars,starsForHeat(this.heat,this.cfg.thresholds));
    if(this.stars>before){this.pending=true;this.event.previous=before;this.escape=0;}
    return this.stars;
  }
  /**
   * player {x,z,speed}; cops: array of {x,z}. Returns {type:'wanted'|'escaped'|'busted',stars,previous} or null.
   */
  update(dt,player,cops,roads){
    const e=this.event,c=this.cfg;
    if(this.pending){this.pending=false;e.type='wanted';e.stars=this.stars;return e;}
    if(!this.enabled||this.stars===0){this.heat=Math.max(0,this.heat-c.idleDecay*dt);this.seen=false;return null;}
    let seen=false,near=false;
    for(let i=0;i<cops.length;i++){const cop=cops[i];if(!seen&&copSeesPlayer(cop,player,roads,c))seen=true;if(Math.hypot(cop.x-player.x,cop.z-player.z)<=c.bustRadius)near=true;}
    this.seen=seen;
    this.escape=seen?0:this.escape+dt;
    this.bust=near&&player.speed<c.bustSpeed?this.bust+dt:0;
    if(this.bust>=c.bustTime){e.previous=this.stars;this.clear();e.type='busted';e.stars=0;return e;}
    if(this.escape>=c.escapeTime){e.previous=this.stars;this.clear();e.type='escaped';e.stars=0;return e;}
    return null;
  }
}

// Module-level hook so props, traffic or stunt code can raise heat without a reference to the game.
let active=null;
export function setActiveWanted(system){active=system;}
export function addHeat(amount){return active?active.addHeat(amount):0;}
