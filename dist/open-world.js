// Rendering, HUD and audio glue for activities.js (speed traps, drift zones, hidden packages) and
// wanted.js (wanted level + police pursuit). game.js calls: constructor once after the world is built,
// update() once per driving frame, drawRadar()/drawMap() inside the map transforms and syncMenu() on pause.
// Everything per-frame reuses scratch objects; allocation happens only on spawn, load and events.
import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {placePackages,layoutFor,ActivityStore,SpeedTraps,DriftZones,Collectibles,describeEvent,TRAP_HEAT_KMH,starString} from './activities.js';
import {WantedSystem,HEAT,pursuitTarget,spawnCandidates,readPoliceSetting,writePoliceSetting,setActiveWanted,addHeat} from './wanted.js';
import {TACTICS,DriftSighting,pitEnabled,flankEnabled,blockEnabled,pitCandidate,pitYawImpulse,pitAim,flankSide,flankPoint,roadblockPoint,blockTarget} from './police-tactics.js';
import {buildLightBar,lightBarY,makeLightBarShared,lightBarState,FLASH_HZ} from './police-lights.js';

const TOAST_SECONDS=3,COP_LENGTH=4.7,MAX_COPS=3;

/** Two-tone wail: sawtooth carrier with a slow triangle LFO on its pitch, through a low-pass, on the dry FX bus. */
class Siren{
  constructor(audio){this.audio=audio;this.nodes=null;this.level=-1;}
  ensure(){const a=this.audio;if(this.nodes||!a?.ctx||!a.nodes)return !!this.nodes;try{const c=a.ctx,osc=c.createOscillator(),lfo=c.createOscillator(),depth=c.createGain(),filter=c.createBiquadFilter(),gain=c.createGain();
    osc.type='sawtooth';osc.frequency.value=820;lfo.type='triangle';lfo.frequency.value=.42;depth.gain.value=260;filter.type='lowpass';filter.frequency.value=1900;filter.Q.value=.7;gain.gain.value=0;
    lfo.connect(depth).connect(osc.frequency);osc.connect(filter).connect(gain).connect(a.nodes.busFx||a.nodes.master);osc.start();lfo.start();this.nodes={osc,lfo,gain};}catch{this.nodes=null;}return !!this.nodes;}
  set(level){if(Math.abs(level-this.level)<.004)return;if(level>0&&!this.ensure())return;this.level=level;if(!this.nodes)return;const t=this.audio.ctx.currentTime;this.nodes.gain.gain.setTargetAtTime(level,t,.12);}
}

export class OpenWorldActivities{
  constructor({scene,physics,world,models,loader,normalize,bounds,map,audio,storage}){
    Object.assign(this,{scene,physics,world,bounds,map,audio,storage,normalize});
    this.layout=layoutFor(map);this.store=new ActivityStore(map,storage);
    this.traps=new SpeedTraps(this.layout.traps,this.store);this.zones=new DriftZones(this.layout.zones,this.store);this.packages=new Collectibles(placePackages(this.layout.packages,this.blockedAt.bind(this)),this.store);
    // This system is only instantiated for the Coast.
    this.policeAllowed=map==='coast';this.policeOn=readPoliceSetting(storage);
    this.wanted=new WantedSystem({enabled:this.policeAllowed&&this.policeOn});setActiveWanted(this.wanted);
    this.cops=[];this.copPool=[];this.copStates=[];this.copTarget={vx:0,vz:0,heading:0,maxAcceleration:10,wx:0,wz:0,mode:''};this.playerState={x:0,z:0,vx:0,vz:0,heading:0,speed:0};
    this.spawnClock=0;this.flash=0;this.time=0;this.heatClock=0;this.lastX=NaN;this.lastZ=NaN;this.toastUntil=0;this.toastText='';this.toastKind='';this.liveClock=0;this.liveText='';this.trapFlash=new Float32Array(this.layout.traps.length);
    this.siren=new Siren(audio);this.policeTemplate=null;this.blocked=[];
    this.buildTraps(models);this.buildZones();this.buildPackages();this.buildPoliceMaterials();this.buildDom();this.validate();
    loader?.loadAsync('assets/cars/police-david-holiday.glb').then(g=>this.preparePolice(g.scene)).catch(error=>console.warn('Police model unavailable',error));
    if(typeof window!=='undefined'){window.gameActivities=this;window.addHeat=addHeat;}
  }
  // ---------- scene ----------
  buildTraps(models){
    const group=new THREE.Group();group.name='speed-traps';this.scene.add(group);
    const lineMat=new THREE.MeshBasicMaterial({color:0x6fc8ff,transparent:true,opacity:.42,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-2});
    const housingMat=new THREE.MeshStandardMaterial({color:0x23272e,roughness:.5,metalness:.4});
    this.lensMat=new THREE.MeshBasicMaterial({color:new THREE.Color(2.4,.25,.2)});this.flashMat=new THREE.MeshBasicMaterial({color:new THREE.Color(9,9,8)});
    const line=new THREE.PlaneGeometry(1,1),housing=new THREE.BoxGeometry(.55,.5,.95),lens=new THREE.CircleGeometry(.16,12);
    // Camera mast: one merged pole + arm reaching over the kerb lane (models' street-light meshes are baked into world batches, so a clone is not reusable).
    const mastParts=[new THREE.CylinderGeometry(.11,.15,6.2,10).translate(0,3.1,0),new THREE.BoxGeometry(.14,.14,3.2).translate(0,6.05,1.5),new THREE.BoxGeometry(.5,.08,.5).translate(0,.04,0)];const mast=mergeGeometries(mastParts);for(const g of mastParts)g.dispose();
    const mastMat=new THREE.MeshStandardMaterial({color:0x8a96a6,roughness:.45,metalness:.6});
    this.trapLenses=[];
    for(const t of this.layout.traps){
      const heading=Math.atan2(-t.dx,-t.dz),side=12.6,px=t.x+t.dz*side,pz=t.z-t.dx*side; // right-hand kerb
      const strip=new THREE.Mesh(line,lineMat);strip.rotation.set(-Math.PI/2,0,heading);strip.scale.set(26,.7,1);strip.position.set(t.x,.035,t.z);group.add(strip);
      // unit local +z faces the carriageway (Object3D.lookAt points +z at the target).
      const unit=new THREE.Group();unit.position.set(px,0,pz);group.add(unit);unit.lookAt(t.x,0,t.z);
      const m=new THREE.Mesh(mast,mastMat);m.castShadow=true;unit.add(m);
      const cam=new THREE.Mesh(housing,housingMat);cam.position.set(0,5.7,2.9);cam.rotation.y=Math.PI/2;cam.castShadow=true;unit.add(cam);
      // Lenses face both directions along the road; one shared material flashes on a pass.
      for(const side of [-1,1]){const l=new THREE.Mesh(lens,this.lensMat);l.position.set(side*.49,5.7,2.9);l.rotation.y=side*Math.PI/2;unit.add(l);this.trapLenses.push(l);}
      try{this.physics.addCircle({x:px,z:pz,radius:.22,userData:{kind:'trap-pole'}});}catch{}
    }
    this.trapGroup=group;
  }
  buildZones(){
    const parts=[],w=1.1;
    for(const z of this.layout.zones){const W=z.maxX-z.minX,L=z.maxZ-z.minZ,cx=(z.minX+z.maxX)/2,cz=(z.minZ+z.maxZ)/2;
      for(const [x,zz,sx,sz] of [[cx,z.minZ,W,w],[cx,z.maxZ,W,w],[z.minX,cz,w,L],[z.maxX,cz,w,L]]){
        // Dashed edges: 6 m paint, 4 m gap.
        const len=Math.max(sx,sz),horizontal=sx>sz;for(let s=-len/2;s<len/2;s+=10){const g=new THREE.PlaneGeometry(horizontal?Math.min(6,len/2-s):w,horizontal?w:Math.min(6,len/2-s));g.rotateX(-Math.PI/2);g.translate(horizontal?x+s+Math.min(6,len/2-s)/2:x,0,horizontal?zz:zz+s+Math.min(6,len/2-s)/2);parts.push(g);}
      }}
    if(!parts.length)return;
    const mat=new THREE.MeshBasicMaterial({color:0xff7a1a,transparent:true,opacity:.6,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-2});
    const mesh=new THREE.Mesh(mergeGeometries(parts),mat);mesh.position.y=.04;mesh.name='drift-zones';mesh.renderOrder=1;this.scene.add(mesh);for(const g of parts)g.dispose();this.zoneMesh=mesh;
  }
  buildPackages(){
    const n=this.layout.packages.length,geo=new THREE.OctahedronGeometry(.62,0),mat=new THREE.MeshStandardMaterial({color:0x3bd16f,emissive:new THREE.Color(0x52ff7a),emissiveIntensity:2.6,roughness:.3,metalness:.1});
    const mesh=new THREE.InstancedMesh(geo,mat,n);mesh.frustumCulled=false;mesh.castShadow=false;mesh.name='hidden-packages';this.scene.add(mesh);this.packageMesh=mesh;this.dummy=new THREE.Object3D();this.updatePackages(0);
  }
  updatePackages(t){
    const d=this.dummy,m=this.packageMesh;
    for(let i=0;i<this.packages.packages.length;i++){const p=this.packages.packages[i],on=!this.packages.collected[i];d.position.set(p.x,p.y+Math.sin(t*2.2+i)*.18,p.z);d.rotation.set(0,t*2+i,0);d.scale.setScalar(on?1:0);d.updateMatrix();m.setMatrixAt(i,d.matrix);}
    m.instanceMatrix.needsUpdate=true;
  }
  buildPoliceMaterials(){this.redMat=new THREE.MeshBasicMaterial({color:new THREE.Color(.3,0,0)});this.blueMat=new THREE.MeshBasicMaterial({color:new THREE.Color(0,0,.3)});this.lightBar=makeLightBarShared(THREE,this.redMat,this.blueMat);}
  preparePolice(root){
    root.rotation.y=Math.PI;const group=this.normalize(root,COP_LENGTH,'z');let ownBar=false;
    // A model with its own light bar keeps it: its red and blue lenses (Giro_rouge/Giro_glass) share the flashing redMat/blueMat.
    group.traverse(o=>{if(!o.isMesh)return;o.castShadow=true;o.receiveShadow=true;if(/light|siren|lightbar/i.test(o.name))ownBar=true;const lens=o.material?.name;if(lens==='Giro_rouge'){o.material=this.redMat;ownBar=true;}else if(lens==='Giro_glass'){o.material=this.blueMat;ownBar=true;}});
    const size=new THREE.Box3().setFromObject(group,true).getSize(new THREE.Vector3());this.policeTemplate={group,size,ownBar};
    for(const cop of this.copPool)this.dressCop(cop);
  }
  dressCop(cop){
    if(cop.dressed||!this.policeTemplate)return;cop.dressed=true;const {group,size,ownBar}=this.policeTemplate,body=group.clone(true);cop.mesh.add(body);cop.mesh.remove(cop.placeholder);
    cop.wheels=[];body.traverse(o=>{if(/^wheel/.test(o.name))cop.wheels.push(o);});
    if(ownBar)return;
    const bar=buildLightBar(THREE,this.lightBar);bar.position.set(0,lightBarY(size.y),.15);cop.mesh.add(bar);
  }
  makeCop(){
    const mesh=new THREE.Group();mesh.name='police';const placeholder=new THREE.Mesh(new THREE.BoxGeometry(1.9,1.3,COP_LENGTH),new THREE.MeshStandardMaterial({color:0x111418}));placeholder.position.y=.65;mesh.add(placeholder);
    const cop={mesh,placeholder,actor:null,wheels:[],dressed:false,stuck:0,leaving:0,roll:0,x:0,z:0};this.scene.add(mesh);mesh.visible=false;this.dressCop(cop);return cop;
  }
  /** True when a point (and height) sits inside or within 2 m of a static collider. */
  blockedAt(x,z,y=1){for(const o of this.world?.obstacles||[]){const b=o.box;if(b&&x>b.min.x-2&&x<b.max.x+2&&z>b.min.z-2&&z<b.max.z+2&&y>b.min.y-1&&y<b.max.y+1&&!o.actor?.userData?.rampId&&o.actor?.userData?.kind!=='stunt-ramp')return true;}return false;}
  validate(){
    // Authoring check: report pickups or camera poles that land inside a building collider.
    const inside=(x,z,y)=>this.blockedAt(x,z,y);
    this.packages.packages.forEach((p,i)=>{if(inside(p.x,p.z,p.y))this.blocked.push('package '+i);});
    if(this.blocked.length)console.warn('Activities: blocked placements',this.blocked);
  }
  // ---------- DOM ----------
  buildDom(){
    if(typeof document==='undefined')return;
    if(!document.querySelector('link[data-activities]')){const link=document.createElement('link');link.rel='stylesheet';link.href='activities.css';link.dataset.activities='1';document.head.append(link);}
    const toast=document.createElement('div');toast.id='activity-toast';toast.className='activity-toast';toast.setAttribute('role','status');toast.setAttribute('aria-live','polite');toast.hidden=true;document.body.append(toast);this.toastEl=toast;
    const wanted=document.createElement('div');wanted.id='wanted-hud';wanted.className='wanted-hud';wanted.hidden=true;wanted.setAttribute('aria-label','Wanted level');wanted.innerHTML='<span>★</span><span>★</span><span>★</span>';
    const radar=document.getElementById('radar-hud');if(radar)radar.prepend(wanted);else document.body.append(wanted);this.wantedEl=wanted;this.starEls=[...wanted.children];this.shownStars=-1;this.shownEscaping=null;
    const pill=document.querySelector('.telemetry-pill');
    if(pill){const div=document.createElement('div');div.className='telemetry-divider';const item=document.createElement('div');item.className='telemetry-item';item.innerHTML='<span class="telemetry-label">PACKAGES</span><strong id="session-packages">0<small>/0</small></strong>';pill.append(div,item);this.packagesEl=item.querySelector('strong');}
    const status=document.createElement('p');status.id='activity-status';status.className='pause-race-info';const race=document.getElementById('race-status');if(race)race.after(status);this.statusEl=status;
    const row=document.querySelector('#pause-drawer .pause-toggle-row');
    if(row&&this.policeAllowed){const item=document.createElement('div');item.className='pause-toggle-item';item.innerHTML='<span>Police chases</span><button id="police-toggle" class="toggle" aria-pressed="false">Off</button>';row.append(item);
      const button=item.querySelector('button');this.policeButton=button;button.onclick=()=>this.setPolice(!this.policeOn);this.syncPoliceButton();}
  }
  syncPoliceButton(){if(!this.policeButton)return;this.policeButton.textContent=this.policeOn?'On':'Off';this.policeButton.setAttribute('aria-pressed',String(this.policeOn));}
  setPolice(on){this.policeOn=!!on;writePoliceSetting(this.storage,this.policeOn);this.wanted.setEnabled(this.policeAllowed&&this.policeOn);if(!this.wanted.enabled)this.clearCops(true);this.syncPoliceButton();this.syncStars();}
  toast(text,kind){this.toastText=text;this.toastKind=kind;this.toastUntil=this.time+TOAST_SECONDS;this.writeToast(text,kind);}
  writeToast(text,kind){const el=this.toastEl;if(!el)return;if(el.textContent!==text)el.textContent=text;if(el.dataset.kind!==kind)el.dataset.kind=kind;if(el.hidden)el.hidden=false;}
  hideToast(){if(this.toastEl&&!this.toastEl.hidden)this.toastEl.hidden=true;}
  syncStars(){
    const s=this.wanted.stars,esc=this.wanted.escaping;if(!this.wantedEl||(s===this.shownStars&&esc===this.shownEscaping))return;this.shownStars=s;this.shownEscaping=esc;
    this.wantedEl.hidden=s===0;this.wantedEl.classList.toggle('escaping',esc);this.starEls.forEach((el,i)=>el.classList.toggle('on',i<s));
  }
  syncMenu(){
    const c=this.packages.count,t=this.packages.total;if(this.packagesEl)this.packagesEl.innerHTML=`${c}<small>/${t}</small>`;
    if(!this.statusEl)return;let stars=0,rated=0;for(const trap of this.layout.traps){const b=this.traps.best(trap.id);if(b){rated++;stars+=Math.min(3,[110,150,190].filter(v=>b>=v).length);}}
    let drift=0;for(const z of this.layout.zones)drift=Math.max(drift,this.zones.best(z.id));
    this.statusEl.textContent=`OPEN WORLD · Speed traps ${rated}/${this.layout.traps.length} (${stars}/${this.layout.traps.length*3} ★) · Drift best ${drift.toLocaleString('en-US')} · Hidden packages ${c}/${t}${this.policeAllowed?` · Police ${this.policeOn?'on':'off'}`:''}`;
  }
  // ---------- frame ----------
  /** player: physics actor; height: rendered car height above the ground plane. */
  update(dt,player,impacts,height=0){
    this.time+=dt;const t=this.time,x=player.x,z=player.z,ps=this.playerState;
    player.copyState?player.copyState(ps):Object.assign(ps,player.state);
    // Teleports (reset, map travel) re-arm the camera lines so a jump across one does not count.
    if(!(Math.abs(x-this.lastX)<25&&Math.abs(z-this.lastZ)<25))this.traps.reset();this.lastX=x;this.lastZ=z;
    // Impacts: crashes break drift chains; hitting traffic or police raises heat.
    let crashed=false;this.heatClock-=dt;
    for(const im of impacts){const other=im.a===player?im.b:im.b===player?im.a:null;if(!other)continue;if(im.speed>2.5)crashed=true;const kind=other.userData?.kind;
      if(this.heatClock<=0&&im.speed>3&&(kind==='traffic'||kind==='police')){this.heatClock=1;this.wanted.addHeat(kind==='police'?HEAT.police:HEAT.traffic);}}
    const trap=this.traps.update(x,z,ps.speed);
    if(trap){this.trapFlash[trap.index]=.18;this.toast(describeEvent(trap),'trap');if(trap.kmh>TRAP_HEAT_KMH)this.wanted.addHeat(HEAT.trap);}
    const drift=this.zones.update(dt,x,z,ps.forwardSpeed,ps.lateralSpeed,crashed);
    if(drift&&drift.type==='drift'){if(drift.score>0||drift.crash)this.toast(describeEvent(drift),drift.crash?'busted':'drift');this.liveText='';}
    const pkg=this.packages.update(x,height,z);if(pkg){this.toast(describeEvent(pkg),'package');this.audio?.onPickup?.();}
    // Toast: event results win; the live drift counter fills the gaps while inside a zone.
    if(t<this.toastUntil){}else if(drift&&drift.type==='drift-live'){this.liveClock-=dt;if(this.liveClock<=0){this.liveClock=.12;const text=describeEvent(drift);this.liveText=text;this.writeToast(text,'drift');}}else this.hideToast();
    // Lens flash and package spin.
    for(let i=0;i<this.trapFlash.length;i++){if(this.trapFlash[i]>0){this.trapFlash[i]-=dt;const m=this.trapFlash[i]>0?this.flashMat:this.lensMat;this.trapLenses[i*2].material=m;this.trapLenses[i*2+1].material=m;}}
    this.updatePackages(t);
    this.updatePolice(dt,player);
  }
  updatePolice(dt,player){
    const w=this.wanted,ps=this.playerState,T=this.tacticsFrame(dt,ps);
    const event=w.update(dt,ps,this.copStates,this.bounds);
    if(event){if(event.type==='wanted')this.toast(`WANTED ${starString(event.stars)}`,'busted');else if(event.type==='escaped'){this.toast('YOU LOST THE COPS','package');this.clearCops(false);}else if(event.type==='busted'){this.toast('BUSTED!','busted');this.clearCops(false);}}
    const want=w.desiredCops;let active=0;for(const c of this.cops)if(!c.leaving)active++;
    this.spawnClock-=dt;if(active<want&&this.spawnClock<=0){this.spawnClock=1.2;this.spawnCop(player);}
    // Light bar: alternating red/blue, 5 Hz, bright enough to bloom.
    this.flash+=dt*FLASH_HZ;const lb=lightBarState(this.flash/FLASH_HZ,w.stars>0);this.redMat.color.setRGB(lb.red,lb.red*.02,lb.red*.015);this.blueMat.color.setRGB(lb.blue*.015,lb.blue*.035,lb.blue);
    const speed=w.copSpeed();let nearest=Infinity;
    for(let i=this.cops.length-1;i>=0;i--){
      const cop=this.cops[i],a=cop.actor,d=Math.hypot(a.x-ps.x,a.z-ps.z);
      if(cop.leaving>0){cop.leaving-=dt;a.setTarget(this.stopTarget(a));if(cop.leaving<=0||d>160){this.despawn(i);continue;}}
      else{
        nearest=Math.min(nearest,d);
        if(!(cop.block>0))this.copTactics(cop,a,player,T);
        if(cop.block>0){cop.block-=dt;if(cop.block<=0&&T.blockCop===cop)T.blockCop=null;a.setTarget(blockTarget(cop.blockHeading,this.copTarget));} // roadblock: hold across the road
        else{
          pursuitTarget(a,cop===T.flankCop?T.flankPlayer:ps,this.bounds,speed,this.copTarget);
          if(this.time<cop.pitUntil)pitAim(a,ps,this.copTarget);
          a.setTarget(this.copTarget);
          cop.stuck=a.speed<1.5&&d>25?cop.stuck+dt:0;if(cop.stuck>4||d>650){this.despawn(i);continue;}
        }
      }
      cop.x=a.x;cop.z=a.z;cop.mesh.position.set(a.x,a.groundElevation||0,a.z);cop.mesh.rotation.y=a.heading;cop.roll+=a.forwardSpeed*dt/.34;for(const wheel of cop.wheels)wheel.rotation.x=-cop.roll;
    }
    this.syncStars();
    this.siren.set(w.stars>0&&nearest<Infinity&&this.audio?.canPlay?.()?.11*Math.max(0,1-nearest/260):0);
  }
  stopTarget(a){const s=this.copTarget;s.vx=0;s.vz=0;s.heading=a.heading;s.maxAcceleration=8;return s;}
  // ---------- tactics (police-tactics.js holds the decision logic; this applies it) ----------
  makeTactics(){return {pitCooldown:0,grace:1,lastX:NaN,lastZ:NaN,blockCop:null,flankCop:null,flankSide:1,flankClock:0,flankPlayer:{x:0,z:0,vx:0,vz:0,speed:0,heading:0},blockPose:{x:0,z:0,heading:0},drift:new DriftSighting(),blockedFn:(x,z,m)=>this.obstacleNear(x,z,m)};}
  /** Static obstacle (not vehicles) within m metres of a point; the same box test spawnCop uses. */
  obstacleNear(x,z,m){const o=this.world?.obstacles;if(o)for(let i=0;i<o.length;i++){const b=o[i].box;if(b&&x>b.min.x-m&&x<b.max.x+m&&z>b.min.z-m&&z<b.max.z+m&&b.max.y>.3)return true;}return false;}
  /** Once per frame, before cops move: teleport grace, PIT cooldown, flank assignment and the drift-in-sight heat trigger. */
  tacticsFrame(dt,ps){
    const T=this.tac||(this.tac=this.makeTactics()),w=this.wanted;
    // A jump (reset, map travel) disarms PIT and roadblocks for a second and drops any roadblock, as traps ignore the jump.
    if(!(Math.abs(ps.x-T.lastX)<25&&Math.abs(ps.z-T.lastZ)<25)){T.grace=1;this.endBlock(T);T.drift.reset();}else if(T.grace>0)T.grace-=dt;
    T.lastX=ps.x;T.lastZ=ps.z;if(T.pitCooldown>0)T.pitCooldown-=dt;
    T.flankCop=null;
    if(flankEnabled(w.stars)&&T.grace<=0){
      let n=0;for(let i=0;i<this.cops.length;i++){const c=this.cops[i];if(c.leaving>0||c.block>0)continue;if(++n===2){T.flankCop=c;break;}}
      if(T.flankCop){T.flankClock-=dt;if(T.flankClock<=0){T.flankClock=TACTICS.flank.holdTime;T.flankSide=flankSide(ps,this.bounds);}
        const f=T.flankPlayer;flankPoint(ps,T.flankSide,f);f.vx=ps.vx;f.vz=ps.vz;f.speed=ps.speed;f.heading=ps.heading;}
    }
    if(T.drift.update(dt,ps,this.cops))w.addHeat(HEAT.drift);
    return T;
  }
  endBlock(T){if(T.blockCop){T.blockCop.block=0;T.blockCop=null;}}
  /** P.I.T. and roadblock triggers for one pursuing cop. The player body is only ever touched through an angular impulse. */
  copTactics(cop,a,player,T){
    const ps=this.playerState,stars=this.wanted.stars;
    if(T.grace>0||player.isAirborne)return;
    if(pitEnabled(stars)&&T.pitCooldown<=0){
      const side=pitCandidate(ps,a,stars,T.pitCooldown),body=player.body;
      if(side&&body){const impulse=pitYawImpulse(body.getInertia(),side,ps.speed);
        if(impulse){body.applyAngularImpulse(impulse,true);T.pitCooldown=TACTICS.pit.cooldown;cop.pitUntil=this.time+TACTICS.pit.aimTime;this.toast('P.I.T.!','busted');}}
    }
    if(!T.blockCop&&blockEnabled(stars)){
      const p=roadblockPoint(a,ps,this.bounds,T.blockedFn,T.blockPose);
      if(p){cop.block=TACTICS.block.duration;cop.blockHeading=p.heading;T.blockCop=cop;}
    }
  }
  spawnCop(player){
    const ps=this.playerState,boxes=this.world?.obstacles||[];
    const free=(x,z)=>!boxes.some(o=>o.box&&x>o.box.min.x-3&&x<o.box.max.x+3&&z>o.box.min.z-3&&z<o.box.max.z+3&&o.box.max.y>.3)&&!this.physics.vehicles.some(v=>Math.hypot(v.x-x,v.z-z)<8);
    for(const radius of [140,110,170]){
      for(const c of spawnCandidates(ps,this.bounds,this.bounds,radius)){
        if(!free(c.x,c.z))continue;
        const cop=this.copPool.pop()||this.makeCop();this.dressCop(cop);
        const size=this.policeTemplate?.size;cop.actor=this.physics.addVehicle({x:c.x,z:c.z,heading:c.heading,width:size?.x||1.95,length:size?.z||COP_LENGTH,height:size?.y||1.5,mass:1700,userData:{kind:'police'}});
        cop.actor.setPose({x:c.x,z:c.z,heading:c.heading,vx:-Math.sin(c.heading)*15,vz:-Math.cos(c.heading)*15});
        cop.stuck=0;cop.leaving=0;cop.block=0;cop.pitUntil=0;cop.x=c.x;cop.z=c.z;cop.mesh.visible=true;this.cops.push(cop);this.copStates.push(cop);return cop;
      }
    }
    return null;
  }
  despawn(i){const cop=this.cops[i];if(this.tac?.blockCop===cop)this.tac.blockCop=null;cop.block=0;this.cops.splice(i,1);const j=this.copStates.indexOf(cop);if(j>=0)this.copStates.splice(j,1);if(cop.actor){this.physics.remove(cop.actor);cop.actor=null;}cop.mesh.visible=false;this.copPool.push(cop);}
  /** Stand the pursuers down: they stop where they are and are removed a few seconds later (now = immediately). */
  clearCops(now){if(now){for(let i=this.cops.length-1;i>=0;i--)this.despawn(i);this.siren.set(0);return;}for(const c of this.cops){c.leaving=4;c.block=0;}if(this.tac)this.tac.blockCop=null;this.copStates.length=0;}
  // ---------- maps ----------
  /** Inside drawRadar's world transform (rotated, scaled by zoom, centred on the player). */
  drawRadar(ctx,zoom){
    const k=1/zoom;
    ctx.lineWidth=2*k;
    for(const z of this.layout.zones){ctx.fillStyle='rgba(255,122,26,.22)';ctx.fillRect(z.minX,z.minZ,z.maxX-z.minX,z.maxZ-z.minZ);ctx.strokeStyle='#ff7a1a';ctx.strokeRect(z.minX,z.minZ,z.maxX-z.minX,z.maxZ-z.minZ);}
    for(const t of this.layout.traps){ctx.fillStyle='#2f8cff';ctx.strokeStyle='#ffffff';ctx.beginPath();ctx.arc(t.x,t.z,6.5*k,0,Math.PI*2);ctx.fill();ctx.stroke();ctx.fillStyle='#ffffff';ctx.fillRect(t.x-2.5*k,t.z-2*k,5*k,4*k);}
    const phase=(this.flash|0)%2===0;
    for(const c of this.cops){if(c.leaving>0)continue;ctx.fillStyle=phase?'#ff2a3a':'#2f6bff';ctx.strokeStyle='#000000';ctx.beginPath();ctx.arc(c.x,c.z,6*k,0,Math.PI*2);ctx.fill();ctx.stroke();}
  }
  /** Pause-menu minimap (fixed world scale). */
  drawMap(ctx){
    ctx.lineWidth=4;
    for(const z of this.layout.zones){ctx.strokeStyle='#ff7a1a';ctx.strokeRect(z.minX,z.minZ,z.maxX-z.minX,z.maxZ-z.minZ);}
    for(const t of this.layout.traps){ctx.fillStyle='#2f8cff';ctx.strokeStyle='#ffffff';ctx.beginPath();ctx.arc(t.x,t.z,16,0,Math.PI*2);ctx.fill();ctx.stroke();}
    for(const c of this.cops){if(c.leaving>0)continue;ctx.fillStyle='#ff2a3a';ctx.beginPath();ctx.arc(c.x,c.z,14,0,Math.PI*2);ctx.fill();}
  }
}
export {addHeat};
