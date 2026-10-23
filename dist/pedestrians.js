import * as THREE from 'three';
import {clone as cloneSkinned} from 'three/addons/utils/SkeletonUtils.js';
import {CrowdSim,ANIM,ANIM_CLIPS,lodTier,mixerDue,PED} from './pedestrian-sim.js';
// GTA-style sidewalk crowd renderer. Simulation lives in pedestrian-sim.js (pure, tested in node).
// Each ped: SkeletonUtils clone of a merged Quaternius body (one skinned draw call), its own mixer over shared clips,
// one material whose onBeforeCompile paints casual clothes from bind-pose height (no extra textures).
// LOD: own frustum + distance culling, mixers every frame <35 m, every 2nd <70 m, every 4th beyond, hidden >110 m; shadows <30 m.
const ASSETS={male:'peds/ped-male',female:'peds/ped-female',anims:'peds/ped-anims'};
export const PED_ASSETS=Object.freeze(Object.values(ASSETS));
// Bind-pose landmarks (metres, model space) measured from the shipped meshes: waist, ankle/shoe top, knee, shoulder |x|, elbow |x|, collar height.
const BODY={male:{waist:1.0,shoe:.115,knee:.56,shoulder:.212,elbow:.463,wrist:.706,collar:1.47,crop:1.16},female:{waist:.985,shoe:.105,knee:.55,shoulder:.152,elbow:.392,wrist:.641,collar:1.43,crop:1.14}};
// Hair variants by _PART id (0 body, 1 eyes, 2 brows, 3.. hair): male parted / buzzed / beard combos, female long / buns.
const VARIANTS={male:[[3],[4],[3,5],[4,5],[5]],female:[[3],[4]]};
const LA={
  shirts:[0xf2f2ee,0x1d1f22,0x9aa0a6,0x24324f,0x86b5d9,0xd9442f,0xd8a838,0x6b7445,0xb8333a,0x7fc8a9,0x2f8f8a,0xa996c9,0xffffff,0xe8dcc0],
  pants:[0x2f4a6d,0x3d5f8c,0x1f2b3d,0xc2ad86,0x2a2a2c,0xe9e6dd,0x6f7377,0x56603e,0x1d2a44,0x7d8fa8],
  shoes:[0xf4f4f0,0xf4f4f0,0x1c1c1e,0x8a8f96,0xc23b32,0x2d4a7a,0xd9c9a8],
  hair:[0x16110d,0x2b1d14,0x3e2a1b,0x5b3c22,0x8a6238,0xc9a464,0x6e2f1c,0x9b9b98],
  skin:[[1.18,1.08,1.02],[1.08,1.0,.95],[1,1,1],[.84,.76,.68],[.66,.55,.47],[.46,.36,.3]],
};
const _v=new THREE.Vector3(),_axis=new THREE.Vector3(),_sphere=new THREE.Sphere(new THREE.Vector3(),1.2),_m=new THREE.Matrix4();

function clothingMaterial(map,body){
  const u={uShirt:{value:new THREE.Color()},uPants:{value:new THREE.Color()},uShoes:{value:new THREE.Color()},uHair:{value:new THREE.Color()},uSkin:{value:new THREE.Color(1,1,1)},
    uTop:{value:new THREE.Vector4(body.shoulder+.08,body.waist,body.collar,0)},uBottom:{value:new THREE.Vector4(body.knee+.05,body.shoe,0,0)}};
  const m=new THREE.MeshStandardMaterial({map,roughness:.82,metalness:0});m.name='ped-clothing';m.userData.ped=u;
  m.customProgramCacheKey=()=>'ped-clothing-v1';
  m.onBeforeCompile=shader=>{Object.assign(shader.uniforms,u);
    shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nattribute float _part;varying vec3 vBind;varying float vPart;varying float vArm;')
      .replace('#include <begin_vertex>',`#include <begin_vertex>
vBind=position;vPart=_part;vArm=0.;
#ifdef USE_SKINNING
for(int k=0;k<4;k++){float j=skinIndex[k];if((j>7.5&&j<30.5)||(j>31.5&&j<54.5))vArm+=skinWeight[k];}
#endif`);
    shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\nuniform vec3 uShirt,uPants,uShoes,uHair,uSkin;uniform vec4 uTop,uBottom;varying vec3 vBind;varying float vPart;varying float vArm;')
      .replace('#include <map_fragment>',`#include <map_fragment>
{float lum=dot(diffuseColor.rgb,vec3(.299,.587,.114));float shade=clamp(.45+lum*1.25,.62,1.18);vec3 col=diffuseColor.rgb*uSkin;
if(vPart>1.5)col=uHair*(vPart<2.5?.75:1.);else if(vPart>.5)col=vec3(.03,.026,.024);
else{float y=vBind.y,ax=abs(vBind.x),aa=.007,arm=step(.5,vArm);
 float sleeve=arm*(1.-smoothstep(uTop.x-aa,uTop.x+aa,ax));
 float torso=(1.-arm)*smoothstep(uTop.y-aa,uTop.y+aa,y)*(1.-smoothstep(uTop.z-aa,uTop.z+aa,y));
 float hem=(1.-arm)*smoothstep(uTop.w-aa,uTop.w+aa,y)*step(.01,uTop.w);
 float legs=(1.-arm)*smoothstep(uBottom.x-aa,uBottom.x+aa,y)*(1.-smoothstep(uTop.y-aa,uTop.y+aa,y));
 float shoe=1.-smoothstep(uBottom.y-aa,uBottom.y+aa,y);
 col=mix(col,uPants*shade,legs);col=mix(col,uShirt*shade,max(sleeve,torso)*(1.-hem));
 col=mix(col,mix(uShoes*shade,vec3(.82,.8,.76),step(y,.026)),shoe);}
diffuseColor.rgb=col;}`);};
  return m;
}

export class Pedestrians{
  /** models: loaded GLB scenes keyed by asset name (PED_ASSETS); world: built world (obstacles); blockers: street-prop items [{x,z}]. */
  constructor({scene,world,map,models,blockers=[]}){
    this.scene=scene;this.root=new THREE.Group();this.root.name='pedestrians';scene.add(this.root);this.frame=0;this.slots=[];this.visible=true;this.drawn=0;this.addHeat=null;
    this.frustum=new THREE.Frustum();this.projView=new THREE.Matrix4();
    const obstacles=[],buildings=[];
    for(const o of world?.obstacles||[]){const b=o.box,kind=o.actor?.userData?.kind;if(!b||kind==='boundary')continue;const w=b.max.x-b.min.x,l=b.max.z-b.min.z;
      if(kind==='building'||w>4||l>4)buildings.push({minX:b.min.x,maxX:b.max.x,minZ:b.min.z,maxZ:b.max.z});else obstacles.push({x:(b.min.x+b.max.x)/2,z:(b.min.z+b.max.z)/2,r:Math.max(w,l)/2});}
    for(const it of blockers||[])obstacles.push({x:it.x,z:it.z,r:.45});
    this.sim=new CrowdSim(map,{obstacles,buildings,onKnock:(p,car)=>this.onKnock(p,car)});
    this.templates={male:this.prepare(models[ASSETS.male],BODY.male,VARIANTS.male),female:this.prepare(models[ASSETS.female],BODY.female,VARIANTS.female)};
    const animRoot=models[ASSETS.anims],clips=animRoot?.animations||[];const mannequinPelvis=animRoot?.getObjectByName('pelvis')?.position||new THREE.Vector3();
    for(const t of Object.values(this.templates))t.clips=ANIM_CLIPS.map(name=>{const clip=clips.find(c=>c.name===name);if(!clip)throw new Error('missing ped clip '+name);return this.retarget(clip,t.pelvis,mannequinPelvis);});
    import('./wanted.js').then(m=>{this.addHeat=m.addHeat;}).catch(()=>{});// optional: heat only when the wanted module ships
    if(typeof window!=='undefined')window.pedestriansDebug=this;
  }
  prepare(root,body,variants){
    if(!root)throw new Error('ped model missing');let mesh=null;root.traverse(o=>{if(o.isSkinnedMesh&&!mesh)mesh=o;});
    const g=mesh.geometry,part=g.getAttribute('_part'),index=g.index.array;
    // One shared index buffer per hair variant over the same vertex buffers: hidden hair never reaches the GPU.
    const geometries=variants.map(keep=>{const out=[];for(let i=0;i<index.length;i+=3){const p=part.getX(index[i]);if(p<3||keep.includes(p))out.push(index[i],index[i+1],index[i+2]);}
      const v=new THREE.BufferGeometry();for(const [k,a] of Object.entries(g.attributes))v.setAttribute(k,a);v.setIndex(out);v.boundingSphere=new THREE.Sphere(new THREE.Vector3(0,.9,0),1.3);v.boundingBox=new THREE.Box3(new THREE.Vector3(-1,0,-1),new THREE.Vector3(1,1.9,1));return v;});
    let tris=0;for(let i=0;i<index.length;i+=3)if(part.getX(index[i])<3)tris++;
    return {root,mesh,map:mesh.material.map,body,geometries,pelvis:root.getObjectByName('pelvis').position.clone(),bodyTris:tris};
  }
  retarget(clip,pelvis,mannequin){
    // Same universal rig by bone name; only the pelvis height differs, so shift its translation keys by the rest-pose delta.
    const c=clip.clone();for(const t of c.tracks)if(t.name==='pelvis.position'){const v=t.values;for(let i=0;i<v.length;i+=3){v[i]+=pelvis.x-mannequin.x;v[i+1]+=pelvis.y-mannequin.y;v[i+2]+=pelvis.z-mannequin.z;}}
    c.tracks=c.tracks.filter(t=>!t.name.endsWith('.scale'));return c;
  }
  makeSlot(i){
    const sex=i&1?'female':'male',t=this.templates[sex],holder=new THREE.Group(),spin=new THREE.Group(),model=cloneSkinned(t.root);
    spin.position.y=.9;model.position.y=-.9;spin.add(model);holder.add(spin);holder.visible=false;holder.matrixWorldAutoUpdate=false;this.root.add(holder);
    let mesh=null;model.traverse(o=>{if(o.isSkinnedMesh)mesh=o;else if(o.isMesh)o.visible=false;});
    mesh.material=clothingMaterial(t.map,t.body);mesh.frustumCulled=false;mesh.castShadow=false;mesh.receiveShadow=true;
    const mixer=new THREE.AnimationMixer(model),actions=t.clips.map((clip,k)=>{const a=mixer.clipAction(clip);if(k===ANIM.ROLL||k===ANIM.HIT||k===ANIM.DEATH){a.setLoop(THREE.LoopOnce,1);a.clampWhenFinished=true;}return a;});
    return {sex,t,holder,spin,model,mesh,mixer,actions,anim:-1,serial:-1,mixDt:0,shadow:false};
  }
  setCrowd(n){n=Math.max(0,n|0);while(this.slots.length<n)this.slots.push(this.makeSlot(this.slots.length));this.sim.setCount(n);this.count=n;}
  dress(slot,ped){
    // Deterministic per-spawn look from ped.look: palette picks, outfit cut and hair variant.
    let s=ped.look>>>0;const r=()=>{s=(Math.imul(s^s>>>15,2246822507)+0x9e3779b9)>>>0;return s/4294967296;},pick=a=>a[Math.floor(r()*a.length)];
    const u=slot.mesh.material.userData.ped,b=slot.t.body,female=slot.sex==='female';
    u.uShirt.value.setHex(pick(LA.shirts));u.uPants.value.setHex(pick(LA.pants));u.uShoes.value.setHex(pick(LA.shoes));u.uHair.value.setHex(pick(LA.hair));u.uSkin.value.setRGB(...pick(LA.skin));
    const top=r(),bottom=r();
    u.uTop.value.set(top<.18?b.shoulder-.03:top<.9?b.shoulder+(b.elbow-b.shoulder)*(.3+r()*.15):b.wrist-.03,b.waist+(r()-.5)*.03,b.collar-(top<.18?.04:0),female&&r()<.2?b.crop:0);
    if(female&&bottom<.22){u.uPants.value.copy(u.uShirt.value);u.uBottom.value.set(b.knee+.02+r()*.08,b.shoe,0,0);}// sundress
    else u.uBottom.value.set(bottom<.55?b.knee+.03+r()*.07:bottom<.7&&female?b.knee+.05:b.shoe+.02,b.shoe,0,0);// shorts / skirt / jeans
    const geos=slot.t.geometries;slot.mesh.geometry=geos[Math.floor(r()*geos.length)];
  }
  play(slot,code,ped){
    const next=slot.actions[code],prev=slot.anim>=0?slot.actions[slot.anim]:null,fade=code===ANIM.AIR||code===ANIM.ROLL?.12:.3;
    next.reset();next.setEffectiveWeight(1);if(ped.animStart)next.time=ped.animStart;
    if(prev&&prev!==next){next.crossFadeFrom(prev,fade,false);}next.play();slot.anim=code;
  }
  onKnock(ped,car){
    this.addHeat?.(1);// wanted.js: hitting a pedestrian is a crime
    if(car?.body){const v=car.body.getLinearVelocity();car.body.setLinearVelocity({x:v.x*.9,y:v.y*.9});}// small arcade slowdown per ped
    this.audio?.onImpact?.(5.5);
  }
  hide(){this.visible=false;this.root.visible=false;}
  reset(){this.sim.reset();for(const s of this.slots){s.holder.visible=false;s.holder.matrixWorldAutoUpdate=false;}}
  dispose(){this.reset();this.scene.remove(this.root);for(const s of this.slots){s.mixer.stopAllAction();s.mixer.uncacheRoot(s.model);s.mesh.material.dispose();}for(const t of Object.values(this.templates))for(const g of t.geometries)g.dispose();this.slots.length=0;}
  /** Per frame while driving. car: player actor; camera: the render camera. */
  update(dt,car,{camera,audio}={}){
    if(!camera||!this.slots.length)return 0;this.audio=audio;this.frame++;
    if(!this.visible){this.visible=true;this.root.visible=true;}
    this.projView.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse);this.frustum.setFromProjectionMatrix(this.projView);
    const view=this.view||(this.view={x:0,z:0,inFrustum:(x,y,z)=>this.frustum.containsPoint(_v.set(x,y,z))});view.x=camera.position.x;view.z=camera.position.z;
    const knocks=this.sim.step(dt,car,view);let drawn=0;
    const peds=this.sim.peds;
    for(let i=0;i<this.slots.length;i++){
      const slot=this.slots[i],ped=peds[i],h=slot.holder;
      if(!ped||!ped.active){if(h.visible){h.visible=false;h.matrixWorldAutoUpdate=false;}continue;}
      if(slot.serial!==ped.serial){slot.serial=ped.serial;this.dress(slot,ped);slot.anim=-1;slot.mixer.stopAllAction();slot.mixDt=0;}
      if(slot.anim!==ped.anim)this.play(slot,ped.anim,ped);
      const a=slot.actions[slot.anim];if(a.timeScale!==ped.animRate)a.timeScale=ped.animRate;
      const d=ped.dist,tier=lodTier(d);_sphere.center.set(ped.x,ped.y+.9,ped.z);
      const vis=tier<3&&this.frustum.intersectsSphere(_sphere);slot.mixDt+=dt;
      if(vis!==h.visible){h.visible=vis;h.matrixWorldAutoUpdate=vis;}
      if(!vis){if(slot.mixDt>1)slot.mixDt=1;continue;}
      drawn++;h.position.set(ped.x,ped.y,ped.z);h.rotation.y=ped.yaw;
      if(ped.state==='knocked'||ped.spin){// tumble about the hip, axis horizontal and across the flight path (world → holder local)
        const c=Math.cos(-ped.yaw),s=Math.sin(-ped.yaw);_axis.set(ped.ax*c+ped.az*s,0,-ped.ax*s+ped.az*c);slot.spin.quaternion.setFromAxisAngle(_axis,ped.spin);
        if(ped.state!=='knocked'){ped.spin*=Math.max(0,1-dt*14);if(Math.abs(ped.spin)<.01)ped.spin=0;}}
      else if(slot.spin.quaternion.w!==1)slot.spin.quaternion.identity();
      const shadow=d<30;if(shadow!==slot.shadow){slot.shadow=shadow;slot.mesh.castShadow=shadow;}
      if(ped.state==='knocked'||mixerDue(tier,this.frame,i)){slot.mixer.update(slot.mixDt);slot.mixDt=0;}
    }
    this.drawn=drawn;return knocks;
  }
  get stats(){const s=this.sim;let states={};for(const p of s.peds)if(p.active)states[p.state]=(states[p.state]||0)+1;return {crowd:this.count,active:s.active,drawn:this.drawn,knocks:s.knocks,states,bodyTris:{male:this.templates.male.bodyTris,female:this.templates.female.bodyTris}};}
}
export {PED};
