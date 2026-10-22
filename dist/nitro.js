/**
 * Lightweight boost VFX: pooled GPU points, camera-relative line segments, and
 * world collectibles. The pool reuses typed buffers rather than allocating
 * particles/meshes during driving.
 * References: https://threejs.org/docs/pages/BufferAttribute.html
 * https://threejs.org/docs/pages/Points.html
 * https://gameprogrammingpatterns.com/object-pool.html
 * Particle sprite: Kenney Particle Pack, CC0, light_01.png
 * https://kenney.nl/assets/particle-pack
 */
import * as THREE from './vendor/three.module.js';

const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));

/** Nitro tank: one continuous bar of NITRO_MAX. Each bottle gives a fixed 20%. Pure, no DOM or three.js. */
export const NITRO_MAX=100,NITRO_BOTTLE=20,NITRO_DRAIN=14,NITRO_REGEN=4,NITRO_INITIAL=40,NITRO_BOOST_MIN=5,NITRO_PICKUP_MAX=NITRO_MAX-NITRO_BOTTLE,NITRO_PICKUP_COUNT=18;
/** collectAt result when a bottle is in reach but the tank is too full to take it. */
export const PICKUP_BLOCKED=-1;
/** Stores a collected bottle's charge; the tank never exceeds NITRO_MAX. */
export function fillNitro(amount,added){return clamp(amount+Math.max(0,added),0,NITRO_MAX);}
/** Burns charge while Shift is held. Snaps to exactly 0 so boosting cannot hover on residue. */
export function drainNitro(amount,dt,rate=NITRO_DRAIN){const step=Number.isFinite(dt)?Math.max(0,dt):0;const next=clamp(amount-step*rate,0,NITRO_MAX);return next<1e-6?0:next;}
/** Passive trickle while not burning: empty to full in NITRO_MAX/NITRO_REGEN seconds (25 s). */
export function regenNitro(amount,dt,rate=NITRO_REGEN){const step=Number.isFinite(dt)?Math.max(0,dt):0;return clamp(amount+step*rate,0,NITRO_MAX);}
/**
 * One fixed step of the Shift gate, with hysteresis so a near-empty tank cannot chatter on and off.
 * A burn starts only from NITRO_BOOST_MIN or more, then runs down to exactly 0 once started. Running dry
 * locks the gate until Shift is released or the tank refills to a whole bottle (NITRO_BOTTLE). A gate that cannot start
 * refills instead, so holding Shift at low charge shows regen rather than a frozen bar. gate={boosting,locked} is owned by the caller and mutated in place,
 * so the 120 Hz step allocates nothing. Returns the new amount.
 */
export function nextBoost(gate,amount,wantsBoost,dt){
  const wasBoosting=gate.boosting;
  if(!wantsBoost){gate.boosting=false;gate.locked=false;return regenNitro(amount,dt);}
  if(gate.locked&&amount>=NITRO_BOTTLE)gate.locked=false;
  if(gate.locked||(!wasBoosting&&amount<NITRO_BOOST_MIN)){gate.boosting=false;return regenNitro(amount,dt);}
  const next=drainNitro(amount,dt);
  gate.boosting=next>0;gate.locked=next===0;
  return next;
}
/** Fill ratio 0..1 of the whole tank, for the HUD. */
export function nitroFraction(amount){return clamp(amount/NITRO_MAX,0,1);}

/** Pure, deterministic collectible state; render objects never affect gameplay. */
export class PickupField {
  constructor({roadsX,roadsZ,random=Math.random,count=NITRO_PICKUP_COUNT,cooldown=15,recharge=NITRO_BOTTLE}={}){
    if(!roadsX?.length||!roadsZ?.length)throw new Error('PickupField needs road center lines.');
    this.roadsX=roadsX;this.roadsZ=roadsZ;this.random=random;this.cooldown=cooldown;this.recharge=recharge;this.collected=0;
    this.items=Array.from({length:count},(_,id)=>({id,x:0,z:0,active:false,cooldown:0}));
    for(const item of this.items)this.spawn(item);
  }
  spawn(item,avoid){
    let x=0,z=0;
    for(let trial=0;trial<80;trial++){
      const vertical=this.random()<.5,lane=this.random()<.5?-4.3:4.3;
      if(vertical){x=this.roadsX[Math.floor(this.random()*this.roadsX.length)]+lane;const i=Math.floor(this.random()*(this.roadsZ.length-1));z=this.roadsZ[i]+28+this.random()*(this.roadsZ[i+1]-this.roadsZ[i]-56);}
      else{z=this.roadsZ[Math.floor(this.random()*this.roadsZ.length)]+lane;const i=Math.floor(this.random()*(this.roadsX.length-1));x=this.roadsX[i]+28+this.random()*(this.roadsX[i+1]-this.roadsX[i]-56);}
      if(avoid&&[].concat(avoid).some(point=>Math.hypot(x-point.x,z-point.z)<35))continue;
      if(this.items.some(other=>other!==item&&other.active&&Math.hypot(x-other.x,z-other.z)<30))continue;
      Object.assign(item,{x,z,active:true,cooldown:0});return;
    }
    // A pathological supplied RNG must not create overlapping pickups. Retry on
    // a future tick rather than putting a collider-blocking collectible anywhere.
    item.active=false;item.cooldown=1;
  }
  update(dt,avoid){for(const item of this.items)if(!item.active){item.cooldown-=Math.max(0,dt);if(item.cooldown<=0)this.spawn(item,avoid);}}
  /**
   * Returns the charge taken, 0 when no bottle is in reach, or PICKUP_BLOCKED when one is in reach but the tank
   * is above NITRO_PICKUP_MAX. A blocked bottle stays in place, so every bottle taken gives exactly one bottle of charge.
   */
  collectAt(position,tankAmount=0){
    let amount=0,inReach=false;
    for(const item of this.items){
      if(!item.active||Math.hypot(item.x-position.x,item.z-position.z)>=3.5)continue;
      inReach=true;if(tankAmount>NITRO_PICKUP_MAX)continue;
      item.active=false;item.cooldown=this.cooldown;amount+=this.recharge;this.collected++;
    }
    return amount>0||!inReach?amount:PICKUP_BLOCKED;
  }
}

/** Shared low-poly bottle parts; every bottle reuses these geometries and materials. */
/** Oversized so bottles read from a distance like arcade pickups. */
const BOTTLE_SCALE=2.4;
function createBottleParts(){
  const body=new THREE.LatheGeometry([new THREE.Vector2(0,0),new THREE.Vector2(.13,0),new THREE.Vector2(.19,.07),new THREE.Vector2(.2,.16),new THREE.Vector2(.2,.66),new THREE.Vector2(.17,.74),new THREE.Vector2(.09,.8),new THREE.Vector2(.075,.84),new THREE.Vector2(0,.84)],14);
  return{body,band:new THREE.CylinderGeometry(.21,.21,.13,14,1,true),valve:new THREE.CylinderGeometry(.045,.06,.12,8),
    metal:new THREE.MeshStandardMaterial({color:0xc4d0d6,metalness:.85,roughness:.3}),
    bandMaterial:new THREE.MeshStandardMaterial({color:0x2fd6ff,emissive:0x1290b8,emissiveIntensity:.8,metalness:.2,roughness:.35}),
    valveMaterial:new THREE.MeshStandardMaterial({color:0x6b777d,metalness:.9,roughness:.25})};
}
export class NitroEffects {
  constructor({scene,camera,player,worldBounds,roadsX,roadsZ,random=Math.random,count=NITRO_PICKUP_COUNT}){
    this.scene=scene;this.camera=camera;this.player=player;this.random=random;
    this.field=new PickupField({roadsX:roadsX||worldBounds.roadsX,roadsZ:roadsZ||worldBounds.roadsZ,random,count});this.pickups=this.field.items;
    this.intensity=0;this.cursor=0;this.emission=0;this.capacity=128;
    this.life=new Float32Array(this.capacity);this.lifetime=new Float32Array(this.capacity);this.vx=new Float32Array(this.capacity);this.vy=new Float32Array(this.capacity);this.vz=new Float32Array(this.capacity);
    this.positions=new Float32Array(this.capacity*3);this.alpha=new Float32Array(this.capacity);this.sizes=new Float32Array(this.capacity);
    this.positions.fill(0);this.geometry=new THREE.BufferGeometry();
    this.geometry.setAttribute('position',new THREE.BufferAttribute(this.positions,3).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('alpha',new THREE.BufferAttribute(this.alpha,1).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('particleSize',new THREE.BufferAttribute(this.sizes,1).setUsage(THREE.DynamicDrawUsage));
    this.texture=new THREE.TextureLoader().load('assets/nitro-light.png');this.texture.colorSpace=THREE.SRGBColorSpace;
    this.material=new THREE.ShaderMaterial({uniforms:{sprite:{value:this.texture},pixelScale:{value:500}},transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,toneMapped:false,
      vertexShader:`attribute float alpha;attribute float particleSize;varying float opacity;void main(){opacity=alpha;vec4 p=modelViewMatrix*vec4(position,1.);gl_Position=projectionMatrix*p;gl_PointSize=clamp(particleSize*500./max(.3,-p.z),1.,100.);}`,
      fragmentShader:`uniform sampler2D sprite;varying float opacity;void main(){vec4 tex=texture2D(sprite,gl_PointCoord);gl_FragColor=vec4(vec3(.25,.82,1.25)*tex.rgb,tex.a*opacity);}`});
    this.points=new THREE.Points(this.geometry,this.material);this.points.frustumCulled=false;this.points.renderOrder=4;scene.add(this.points);
    this.group=new THREE.Group();scene.add(this.group);
    const bottleParts=createBottleParts();
    const glowMaterial=new THREE.SpriteMaterial({map:this.texture,color:0x73e6ff,transparent:true,opacity:.7,depthWrite:false,blending:THREE.AdditiveBlending,toneMapped:false});
    // One InstancedMesh per bottle part: 3 draw calls for all pickups, with per-bottle matrices written in update().
    const pickupCount=this.pickups.length;
    this.bottleParts=[
      {mesh:new THREE.InstancedMesh(bottleParts.body,bottleParts.metal,pickupCount),offset:new THREE.Matrix4()},
      {mesh:new THREE.InstancedMesh(bottleParts.band,bottleParts.bandMaterial,pickupCount),offset:new THREE.Matrix4().makeTranslation(0,.38,0)},
      {mesh:new THREE.InstancedMesh(bottleParts.valve,bottleParts.valveMaterial,pickupCount),offset:new THREE.Matrix4().makeTranslation(0,.9,0)}];
    for(const part of this.bottleParts){part.mesh.frustumCulled=false;part.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);this.group.add(part.mesh);}
    this.glows=this.pickups.map(()=>{const sprite=new THREE.Sprite(glowMaterial);sprite.scale.set(1.6*BOTTLE_SCALE,1.6*BOTTLE_SCALE,1);this.group.add(sprite);return sprite;});
    this.bottleTransform=new THREE.Object3D();this.partMatrix=new THREE.Matrix4();
    this.lineCount=32;this.linePositions=new Float32Array(this.lineCount*6);this.lineGeometry=new THREE.BufferGeometry();this.lineGeometry.setAttribute('position',new THREE.BufferAttribute(this.linePositions,3).setUsage(THREE.DynamicDrawUsage));this.lineMaterial=new THREE.LineBasicMaterial({color:0xc6efff,transparent:true,opacity:0,depthTest:false,depthWrite:false,blending:THREE.AdditiveBlending,toneMapped:false});this.lines=new THREE.LineSegments(this.lineGeometry,this.lineMaterial);this.lines.frustumCulled=false;this.lines.renderOrder=10;camera.add(this.lines);if(!camera.parent)scene.add(camera);
  }
  /** Returns charge stored in the tank. Collecting never bursts; the player spends it with Shift. */
  collectAt(position,tankAmount=0){return this.field.collectAt(position,tankAmount);}
  emit(position,heading,speed){
    const id=this.cursor++%this.capacity,index=id*3,side=id%2?1:-1,s=Math.sin(heading),c=Math.cos(heading),spread=(this.random()-.5)*.14;
    this.positions[index]=position.x+s*2.15+c*side*.69;this.positions[index+1]=.42+(this.random()-.5)*.04;this.positions[index+2]=position.z+c*2.15-s*side*.69;
    // Car exhaust remains a stylized electric overdrive trail, without claiming
    // combustion hardware on the original electric Roadster.
    const rearSpeed=4+this.random()*6;this.vx[id]=s*rearSpeed+c*spread;this.vz[id]=c*rearSpeed-s*spread;this.vy[id]=(this.random()-.4)*.25;
    this.life[id]=this.lifetime[id]=.16+this.random()*.16;this.sizes[id]=.35+this.random()*.35;
  }
  update(dt,{active=false,speed=0,time=0,position,heading=0,paused=false}={}){
    this.group.visible=!paused;this.points.visible=!paused;this.lines.visible=!paused;
    if(paused)return this.intensity;
    // Gameplay timers consume the complete bounded simulation interval, even
    // when expensive visual integration is capped after a slow frame.
    const simulationDt=clamp(dt,0,.25);this.field.update(simulationDt,position);dt=Math.min(simulationDt,.1);
    // Intensity eases up while burning and drops to zero the moment the burn ends, so exhaust and speed lines stop with the bar. The camera eases its own copy (updateCamera).
    const target=active&&speed>2?1:0;this.intensity=target?this.intensity+(1-this.intensity)*(1-Math.exp(-dt*9)):0;
    // Inactive bottles get a zero-scale matrix, so they vanish without per-object visibility flags.
    const transform=this.bottleTransform,base=.5*BOTTLE_SCALE;
    for(let i=0;i<this.pickups.length;i++){
      const item=this.pickups[i],y=base+Math.sin(time*2+i)*.2;
      transform.position.set(item.x,y,item.z);transform.rotation.set(0,time*1.1+i,0);transform.scale.setScalar(item.active?BOTTLE_SCALE:0);transform.updateMatrix();
      for(let p=0;p<this.bottleParts.length;p++){const part=this.bottleParts[p];part.mesh.setMatrixAt(i,this.partMatrix.multiplyMatrices(transform.matrix,part.offset));}
      this.glows[i].visible=item.active;this.glows[i].position.set(item.x,y+.42*BOTTLE_SCALE,item.z);
    }
    for(let p=0;p<this.bottleParts.length;p++)this.bottleParts[p].mesh.instanceMatrix.needsUpdate=true;
    this.emission+=this.intensity*150*dt;while(this.emission>=1){this.emit(position,heading,speed);this.emission--;}
    for(let i=0;i<this.capacity;i++){if(this.life[i]>0){this.life[i]=Math.max(0,this.life[i]-dt);const index=i*3;this.positions[index]+=this.vx[i]*dt;this.positions[index+1]+=this.vy[i]*dt;this.positions[index+2]+=this.vz[i]*dt;this.alpha[i]=Math.min(1,this.life[i]/.05)*(this.life[i]/this.lifetime[i])*.85;}else this.alpha[i]=0;}
    this.geometry.attributes.position.needsUpdate=true;this.geometry.attributes.alpha.needsUpdate=true;this.geometry.attributes.particleSize.needsUpdate=true;
    const half=Math.tan(this.camera.fov*Math.PI/360)*1.6,aspect=this.camera.aspect;
    for(let i=0;i<this.lineCount;i++){const angle=i*2.39996323,phase=(time*(1.6+Math.min(1,speed/50))+i*.173)%1,inner=.67+phase*.5,outer=inner+.07+.09*this.intensity,cs=Math.cos(angle),sn=Math.sin(angle),index=i*6;this.linePositions[index]=cs*inner*half*aspect;this.linePositions[index+1]=sn*inner*half;this.linePositions[index+2]=-1.6;this.linePositions[index+3]=cs*outer*half*aspect;this.linePositions[index+4]=sn*outer*half;this.linePositions[index+5]=-1.6;}
    this.lineGeometry.attributes.position.needsUpdate=true;this.lineMaterial.opacity=this.intensity*.34;
    return this.intensity;
  }
}

/** DOM view of the nitro tank: one bar, a percent label and a burning flag. Writes only when a value changes. */
export class NitroHud{
  constructor(root){
    this.root=root;this.fill=root?.querySelector('.nitro-fill')||null;this.percent=root?.querySelector('.nitro-pct')||null;
    this.shown=-1;this.shownPercent=-1;this.burning=false;this.full=false;this.locked=false;this.visible=false;this.pulseTimer=0;this.flashTimer=0;
  }
  show(){if(this.root&&!this.visible){this.visible=true;this.root.hidden=false;}}
  hide(){this.visible=false;this.pulseTimer=0;this.flashTimer=0;this.burning=false;this.full=false;this.locked=false;if(this.root){this.root.hidden=true;this.root.classList.remove('pulse','burning','full','locked','flash');}}
  /** Brief bar pulse to confirm a bottle was stored. Restarts the CSS animation so back-to-back pickups replay it. */
  pulse(){this.pulseTimer=.4;if(!this.root)return;this.root.classList.remove('pulse');void this.root.offsetWidth;this.root.classList.add('pulse');}
  /** Short FULL tag for a bottle refused at a high tank. Debounced: staying in reach does not restart it. */
  flash(){if(this.flashTimer>0)return;this.flashTimer=.8;this.root?.classList.add('flash');}
  update(amount,dt=0,burning=false,locked=false){
    this.show();
    if(this.pulseTimer>0){this.pulseTimer=Math.max(0,this.pulseTimer-Math.max(0,dt));if(this.pulseTimer===0)this.root?.classList.remove('pulse');}
    if(this.flashTimer>0){this.flashTimer=Math.max(0,this.flashTimer-Math.max(0,dt));if(this.flashTimer===0)this.root?.classList.remove('flash');}
    if(burning!==this.burning){this.burning=burning;this.root?.classList.toggle('burning',burning);}
    if(locked!==this.locked){this.locked=locked;this.root?.classList.toggle('locked',locked);}
    const f=nitroFraction(amount),full=f>=1;
    if(full!==this.full){this.full=full;this.root?.classList.toggle('full',full);}
    if(f!==this.shown&&(Math.abs(f-this.shown)>.001||f===0||f===1)){this.shown=f;if(this.fill)this.fill.style.width=`calc(${(f*100).toFixed(2)}% - 4px)`;}
    const percent=Math.round(f*100);
    if(percent!==this.shownPercent){this.shownPercent=percent;this.root?.setAttribute('aria-valuenow',String(percent));if(this.percent)this.percent.textContent=`${percent}%`;}
  }
}
