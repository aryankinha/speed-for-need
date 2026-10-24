// A short optional score attack. Pure simulation logic; no rendering, DOM or network.
// Scores use simulated time, not rendered frame count. No economy, unlock wall or account.
export const RUN_SECONDS=60,COUNTDOWN_SECONDS=3,CHAIN_GRACE=2.5;
export const RUN_RULES=Object.freeze({
 coast:Object.freeze({pace:20,medals:[1500,4500,9000]}),
 drift:Object.freeze({pace:20,medals:[1500,4500,9000]}),
});
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
export function medalFor(score,thresholds){return score>=thresholds[2]?'GOLD':score>=thresholds[1]?'SILVER':score>=thresholds[0]?'BRONZE':'ROOKIE';}
export class RunRecords{
 constructor(storage){this.storage=storage;this.data={};try{const d=JSON.parse(storage?.getItem('speed-for-need-rush-v1')||'{}');if(d&&typeof d==='object'&&!Array.isArray(d))for(const [k,v]of Object.entries(d))if(Number.isFinite(v)&&v>=0)this.data[k]=Math.floor(v);}catch{}}
 best(map,car){return this.data[map+':'+car]||0;}
 save(map,car,score){const key=map+':'+car,best=this.best(map,car);if(!Number.isFinite(score)||score<=best)return false;this.data[key]=Math.floor(score);try{this.storage?.setItem('speed-for-need-rush-v1',JSON.stringify(this.data));}catch{}return true;}
}
export class SkillRun{
 constructor({map='coast',storage}={}){this.map=map;this.rules=RUN_RULES[map]||RUN_RULES.coast;this.records=new RunRecords(storage);this.phase='idle';this.entries=[];this.result=null;}
 get active(){return this.phase==='countdown'||this.phase==='running';}
 start(car,traffic=[]){
  this.car=car;this.phase='countdown';this.countdown=COUNTDOWN_SECONDS;this.remaining=RUN_SECONDS;this.time=0;this.score=0;this.chain=0;this.mult=1;this.chainTime=0;this.idle=0;this.cooldown=0;this.air=0;this.wasAirborne=false;this.lastX=NaN;this.lastZ=NaN;
  this.driftSeconds=0;this.nearMisses=0;this.jumps=0;this.crashes=0;this.topSpeed=0;this.maxChain=0;this.peakMult=1;this.result=null;this.notice='GET READY';this.noticeUntil=0;
  this.entries=traffic.map(c=>({actor:c.actor||c,armed:false,along:NaN,last:-10}));
 }
 cancel(){this.phase='idle';this.chain=0;this.entries.length=0;this.result=null;}
 announce(text){this.notice=text;this.noticeUntil=this.time+1.5;}
 bank(){if(this.chain<=0)return;const points=Math.round(this.chain*this.mult);this.score+=points;this.maxChain=Math.max(this.maxChain,points);this.announce('BANKED +'+points.toLocaleString('en-US'));this.chain=0;this.chainTime=0;this.mult=1;this.idle=0;}
 finish(){this.bank();const previous=this.records.best(this.map,this.car),score=this.score;this.phase='finished';this.result=Object.freeze({score,previous,newBest:this.records.save(this.map,this.car,score),best:Math.max(previous,score),medal:medalFor(score,this.rules.medals),nearMisses:this.nearMisses,driftSeconds:this.driftSeconds,jumps:this.jumps,crashes:this.crashes,topSpeed:Math.round(this.topSpeed*3.6),maxChain:this.maxChain,peakMult:this.peakMult});this.entries.length=0;return this.result;}
 /** f: current physical pose/velocities; elapsed time is supplied by physics steps. */
 update(dt,f){
  if(!this.active||!(dt>0&&Number.isFinite(dt)))return null;
  if(this.phase==='countdown'){this.countdown=Math.max(0,this.countdown-dt);if(this.countdown>1e-8)return null;this.phase='running';this.announce('GO · BUILD A CLEAN CHAIN');return null;}
  dt=Math.min(dt,this.remaining);this.remaining=Math.max(0,this.remaining-dt);this.time+=dt;this.cooldown=Math.max(0,this.cooldown-dt);
  const speed=Math.abs(f.speed||0),forward=f.forwardSpeed||0,lateral=f.lateralSpeed||0,airborne=!!f.airborne;
  const moved=Number.isFinite(this.lastX)?Math.hypot(f.x-this.lastX,f.z-this.lastZ):0;
  this.lastX=f.x;this.lastZ=f.z;this.topSpeed=Math.max(this.topSpeed,speed);
  // Map travel/reset is never a scoring shortcut. The run is abandoned, not saved.
  if(moved>30){this.cancel();return null;}
  if(f.crashed){if(this.cooldown===0){this.crashes++;this.announce('IMPACT · CHAIN LOST');}this.chain=0;this.mult=1;this.chainTime=0;this.idle=0;this.cooldown=1;this.air=0;for(const e of this.entries){e.armed=false;e.along=NaN;}}
  let points=0,label='';
  if(this.cooldown===0){
   const angle=Math.atan2(Math.abs(lateral),Math.abs(forward));
   // Driving backwards or spinning on the spot cannot farm pace or drift points.
   if(!airborne&&forward>this.rules.pace){points+=(forward-this.rules.pace)*4*dt;label='CLEAN SPEED';}
   if(!airborne&&forward>6&&speed>9&&angle>=Math.PI/15&&angle<1.25){points+=Math.min(angle*180/Math.PI,60)*speed*.18*dt;this.driftSeconds+=dt;label='DRIFT';}
   if(airborne){this.air+=dt;for(const e of this.entries){e.armed=false;e.along=NaN;}}else if(this.wasAirborne){if(this.air>=.35){points+=Math.min(this.air,3)*250;this.jumps++;label='CLEAN LANDING';}this.air=0;}
   // A near miss is a clean pass across the traffic car's centre plane with a
   // small side gap. Vehicle widths are physical widths, not arbitrary centres.
   if(!airborne)for(const e of this.entries){const a=e.actor,dx=f.x-a.x,dz=f.z-a.z,sin=Math.sin(a.heading),cos=Math.cos(a.heading),along=-dx*sin-dz*cos,side=dx*cos-dz*sin;
    const gap=(f.width+(a.width||1.9))*.5,near=Math.abs((f.height||0)-(a.groundElevation||0))<2&&side*side<(gap+2.2)**2&&side*side>(gap+.15)**2;
    if(Math.abs(along)>8&&Math.abs(along)<40)e.armed=true;
    if(e.armed&&near&&Number.isFinite(e.along)&&e.along*along<=0&&Math.abs(e.along-along)<20&&speed>14&&Math.hypot((f.vx||0)-(a.vx||0),(f.vz||0)-(a.vz||0))>4&&this.time-e.last>5){points+=250;this.nearMisses++;label='NEAR MISS';e.last=this.time;e.armed=false;}
    e.along=along;
   }
  }
  this.wasAirborne=airborne;
  if(points>0){this.chain+=points;this.idle=0;this.chainTime+=dt;this.mult=Math.min(5,1+Math.floor(this.chainTime/4));this.peakMult=Math.max(this.peakMult,this.mult);if(label!==this.notice&&this.time>=this.noticeUntil){this.notice=label;}}
  else if(this.chain>0){this.idle+=dt;if(this.idle>=CHAIN_GRACE)this.bank();}
  if(this.remaining<=1e-8)return this.finish();return null;
 }
}
