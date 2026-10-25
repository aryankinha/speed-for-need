import * as THREE from 'three';
import {SkillRun} from './skill-run.js';
import {SkillRunUI} from './skill-run-ui.js';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {DRACOLoader} from 'three/addons/loaders/DRACOLoader.js';
import {RGBELoader} from 'three/addons/loaders/RGBELoader.js';
import {createDrivingWorld} from './physics.js';
import {WORLD as COAST_WORLD} from './coast-config.js';
import {normalize} from './model-utils.js';
import {readSelectedMap,bindMapSelection,mapUrl,MAPS} from './map-selection.js';
import {CITY_MODELS,mapDistrict,DESTINATIONS,drawMapDistricts,drawSunsetMap} from './map-layout.js';
import {updateTrafficBudget} from './traffic-budget.js';
import {roundedRoute,followTraffic} from './traffic.js';
import {NitroEffects,NitroHud,fillNitro,nextBoost,NITRO_INITIAL} from './nitro.js';
import {GameAudio} from './audio.js';
import {RaceMode} from './race-mode.js';
import {RaceHud} from './race-hud.js';
import {SparksParticleEmitter} from './sparks.js';
import {CarShowroom} from './showroom.js';
import {loadShowcaseTextures} from './coastal-showcase.js';
import {prepareCockpit,finishCockpit,animateSteering,cockpitCamera,showCockpitGlass,cockpitFov} from './cockpit.js';
import {smoothSteering,RenderQuality} from './driving-input.js';
import {TouchDriving,drivingControls} from './touch-driving.js';
import {chaseAim,chaseLead,stepChaseCamera,makeBoxWindow,CHASE_ROAD_R} from './camera-aim.js';
import {RenderState} from './interpolation.js';
import {snapShadowAnchor} from './shadow-snap.js';
import {MeshoptDecoder} from 'three/addons/libs/meshopt_decoder.module.js';
import {initialModelNames} from './model-catalog.js';
import {VEHICLES,getVehicle,GarageSelection,tuningBars} from './vehicles.js';
import {DriveHint,DRIVE_HINT_HTML} from './drive-hint.js';
import {bindCreditsModal} from './credits-modal.js';
import {crazyGames as sdk} from './crazygames.js';
import {prepareVehicleGeometry} from './vehicle-models.js';
import {GarageScene} from './garage-scene.js';
import {vehicleThumbnails} from './vehicle-thumbnails.js';
import {StuntSystem,RAMPS,STUNT_AREA} from './stunts.js';
import {initElectron} from './electron-bridge.js';
import {BoostPadTimer,drawBoostPadMarks,clearBoostBodyClass,boostDemand} from './boost-pads.js';
import {VehicleAppearance,PAINTS,WHEEL_STYLES} from './customization.js';
import {RAMP_SHAPE} from './ramp-model.js';
import {FrameMetrics,GpuTimer} from './render-metrics.js';
import {batchStaticMeshes} from './mesh-batching.js';
import {spawnBlocked} from './spawn-clear.js';
import {warmVehicleRenderPaths} from './car-warmup.js';
let buildStreetCars,STREET_CAR_ASSETS=[],TRAFFIC_EXTRA=[],trafficPerRoute,streetCars=null;
import {GraphicsPipeline,GRAPHICS_PRESETS,GRAPHICS_KEY,detectPreset,readGpuName,resolvePreset,toCarPaint} from './graphics.js';
let StreetProps,streetProps=null;
let ParkLife;
import {TyreMarks} from './tyre-marks.js';
import {surfaceAt} from './driving-surfaces.js';
let parkLife=null,tyreMarks=null;const rearTyres=[new THREE.Vector3(),new THREE.Vector3()];
let CoastalAmbient,ambient=null;// seagulls + beach umbrellas (ambient.js)// knockable street furniture (street-props.js)
let OpenWorldActivities,openWorld=null;// speed traps, drift zones, hidden packages, wanted level (open-world.js)
let Pedestrians,PED_ASSETS=[],pedestrians=null;// GTA-style sidewalk crowd (pedestrians.js + pedestrian-sim.js)

const telemetryEnabled=new URLSearchParams(location.search).has('debug');
let mapStorage;try{mapStorage=localStorage;}catch{}
const selectedMap=readSelectedMap(location.search,mapStorage),isDrift=selectedMap==='drift',isCoast=!isDrift,mapDefinition=MAPS.find(m=>m.id===selectedMap);
// Only the selected world is imported. Drift never downloads/parses the Coast
// builder, crowds, street furniture, ambient beach or police/activity modules.
const driftRuntime=isDrift?await import('./world-drift.js'):null;
const {DRIFT_WORLD,DRIFT_PATH,DRIFT_GATES,DRIFT_DESTINATIONS,drawDriftMap,buildDriftRaceMarkers}=driftRuntime||{};
const WORLD=isDrift?DRIFT_WORLD:COAST_WORLD,mapDestinations=isDrift?DRIFT_DESTINATIONS:DESTINATIONS;
const worldModule=isDrift?Promise.resolve(driftRuntime):import('./world.js');
const rush=new SkillRun({map:selectedMap,storage:mapStorage});let rushUI=null;const rushFrame={};
const BEST_KEY='speed-for-need-best'+(selectedMap==='coast'?'':'-'+selectedMap);
const $=s=>document.querySelector(s),clamp=THREE.MathUtils.clamp,lerp=THREE.MathUtils.lerp;
const scene=new THREE.Scene();scene.fog=new THREE.Fog(0xb9c6d6,isDrift?260:190,isDrift?1100:1120);
let renderer;
try{renderer=new THREE.WebGLRenderer({antialias:false,stencil:false,powerPreference:'high-performance'});}catch(error){$('#loadtext').textContent='Enable browser hardware acceleration, then reload.';$('#retry').hidden=false;throw error;}
renderer.domElement.className='webgl';renderer.setSize(innerWidth,innerHeight);renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;renderer.shadowMap.autoUpdate=false;renderer.shadowMap.needsUpdate=true;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=.82;$('#game').append(renderer.domElement);
const frameMetrics=new FrameMetrics(180),gpuTimer=new GpuTimer(renderer.getContext());
// Graphics preset: saved choice or GPU auto-detect. 'auto' is stored as no choice.
const graphics=new GraphicsPipeline(renderer,scene,null);let graphicsChoice='auto';try{graphicsChoice=localStorage.getItem(GRAPHICS_KEY)||'auto';}catch{}
const detectedPreset=detectPreset({gpu:readGpuName(renderer.getContext()),cores:navigator.hardwareConcurrency||4,memory:navigator.deviceMemory||4,mobile:matchMedia('(pointer:coarse)').matches&&innerWidth<1000,pixels:screen.width*screen.height*devicePixelRatio**2});
const quality=new RenderQuality(GRAPHICS_PRESETS[resolvePreset(graphicsChoice,detectedPreset)].ratio);let shadowClock=0,shadowRenders=0,radarRedraws=0,homeTime=0,renderInvalid=true;
const camera=new THREE.PerspectiveCamera(57,innerWidth/innerHeight,.12,1200);const cameraAim=new THREE.Vector3();
graphics.camera=camera;const SUN={x:-140,y:212,z:-130};
scene.add(new THREE.HemisphereLight(0xd3e4ff,0x9a8a70,.55));const sun=new THREE.DirectionalLight(0xfff0dc,3.4);sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);Object.assign(sun.shadow.camera,{left:-52,right:52,top:52,bottom:-52,near:1,far:430});sun.shadow.bias=-.0005;sun.shadow.normalBias=.06;scene.add(sun,sun.target);
// Reuse startup image requests (world/showcase asphalt); release raw cache once ready.
THREE.Cache.enabled=true;
const draco=new DRACOLoader().setDecoderPath('vendor/draco/');const loader=new GLTFLoader().setDRACOLoader(draco).setMeshoptDecoder(MeshoptDecoder);
const storage=mapStorage;bindMapSelection({selected:selectedMap,storage});const stunts=new StuntSystem(RAMP_SHAPE,storage);let carShadow;const garageSelection=new GarageSelection(storage);let appearance,garageScene,garageOpen=false;
let circuit=null,circuitHud=null,raceSparks=null,savedNitroField=null,savedNitroPickups=null,savedCircuitBoost=40,raceCountSound=-1;
const circuitPickupView={update(){}};
let nitro,showroom,inShowroom=true;const padBoost=new BoostPadTimer();let lastNoticeSerial=0,stuntToast='',stuntToastUntil=0;
// Driving-HUD toast for stunt notices (speed hint, 360!). Writes the DOM only when the notice or visibility changes.
const driveHint=new DriveHint(document.getElementById('drive-hint'));if(driveHint.element)driveHint.element.innerHTML=DRIVE_HINT_HTML;bindCreditsModal();sdk.loadingStart();
const stuntToastEl=document.getElementById('stunt-toast');let stuntToastShown=false;
function clearStuntToast(){stuntToastUntil=0;stuntToastShown=false;if(stuntToastEl)stuntToastEl.hidden=true;}
function updateStuntToast(){if(stunts.noticeSerial!==lastNoticeSerial){lastNoticeSerial=stunts.noticeSerial;stuntToast=stunts.notice;stuntToastUntil=elapsed+2.5;}const show=elapsed<stuntToastUntil;if(show!==stuntToastShown){stuntToastShown=show;if(stuntToastEl)stuntToastEl.hidden=!show;}if(show&&stuntToastEl&&stuntToastEl.textContent!==stuntToast)stuntToastEl.textContent=stuntToast;}const nitroFrame={active:false,speed:0,time:0,position:null,heading:0,paused:false},simControls={throttle:0,reverse:0,steer:0,handbrake:false,boost:false};
const physics=createDrivingWorld({fixedStep:1/120});const nitroHud=new NitroHud(document.getElementById('nitro-hud'));const keys=new Set(),traffic=[],rides={};let playerActor,world,ready=false,paused=true,camMode=0,touchEnabled=matchMedia('(pointer:coarse)').matches,chosen='concept',boost=NITRO_INITIAL,boosting=false,boostGate={boosting:false,locked:false},steer=0,distance=0,elapsed=0,raceActive=false,checkpoint=0,raceTime=0,best=0,lastImpact=0,firstDrive=true;
try{best=Number(localStorage.getItem(BEST_KEY)||(isCoast&&localStorage.getItem('afterlight-v2-best'))||0);}catch{}
let seed=5279;const random=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};
// Render poses: slot 0 = player, slots 1..n = traffic. Rendering interpolates between physics steps (see interpolation.js).
const renderState=new RenderState(96),renderPose={x:0,z:0,heading:0},trafficPose={x:0,z:0,heading:0},shadowAnchor={x:0,y:0,z:0};
const player=new THREE.Group(),visual=new THREE.Group(),trickRig=new THREE.Group();player.add(trickRig);trickRig.add(visual);scene.add(player);const pos=new THREE.Vector3(WORLD.spawn.x,0,WORLD.spawn.z),forward=new THREE.Vector3(0,0,-1);let currentRide,wheelDistance=0;
const gates=isDrift?DRIFT_GATES:[[-450,-450],[-300,-600],[0,-450],[450,-150],[300,450],[-450,450]];const gate=new THREE.Group();scene.add(gate);gate.visible=false;
const gateMaterial=new THREE.MeshBasicMaterial({color:0xdafa9b,transparent:true,opacity:.7});for(const side of [-1,1]){const m=new THREE.Mesh(new THREE.CylinderGeometry(.1,.1,6,8),gateMaterial);m.position.set(side*9,3,0);gate.add(m);}const gateTop=new THREE.Mesh(new THREE.BoxGeometry(18,.1,.1),gateMaterial);gateTop.position.y=6;gate.add(gateTop);
const gateBase=new THREE.Mesh(new THREE.PlaneGeometry(18,6),new THREE.MeshBasicMaterial({color:0xdcfc8b,transparent:true,opacity:.12,side:THREE.DoubleSide}));gateBase.rotation.x=-Math.PI/2;gateBase.position.y=.015;gate.add(gateBase);
let progressCount=0,trafficBudgetClock=1;
async function loadModel(name,total){const gltf=await loader.loadAsync(`assets/${name}.glb`);if(gltf.animations.length)gltf.scene.animations=gltf.animations;gltf.scene.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true;}});progressCount++;$('#loadbar').style.width=`${Math.round(progressCount/total*95)}%`;$('#loadtext').textContent=`Opening ${mapDefinition.name} · ${Math.round(progressCount/total*100)}%`;return gltf.scene;}
const wheelNodeNames=['WheelFrontL','WheelFrontR','WheelRearL','WheelRearR'];
// Folds static meshes that share one material and vertex layout into one mesh, so each material costs one draw call.
// Subtrees named in pinnedNames (animated wheels) are left untouched so their node transforms still drive them.
function batchStatic(root,pinnedNames=[]){
  root.updateMatrixWorld(true);const pinned=new Set();for(const name of pinnedNames)root.getObjectByName(name)?.traverse(o=>pinned.add(o));
  const inverse=new THREE.Matrix4().copy(root.matrixWorld).invert(),groups=new Map();
  root.traverse(o=>{
    if(!o.isMesh||o.isSkinnedMesh||o.isInstancedMesh||!o.visible||Array.isArray(o.material)||Object.keys(o.geometry.morphAttributes).length)return;
    for(let p=o;p;p=p.parent)if(pinned.has(p))return;
    const relative=new THREE.Matrix4().multiplyMatrices(inverse,o.matrixWorld);if(relative.determinant()<0)return;
    const key=`${o.material.uuid}|${o.geometry.index?'indexed':'flat'}|${Object.keys(o.geometry.attributes).sort().join(',')}`;
    if(!groups.has(key))groups.set(key,[]);groups.get(key).push({o,relative});
  });
  for(const list of groups.values()){
    if(list.length<2)continue;
    const geometry=mergeGeometries(list.map(({o,relative})=>o.geometry.clone().applyMatrix4(relative)),false);if(!geometry)continue;
    const merged=new THREE.Mesh(geometry,list[0].o.material);merged.castShadow=list[0].o.castShadow;merged.receiveShadow=list[0].o.receiveShadow;root.add(merged);
    // A merged mesh can parent other nodes (nested GLTF parts); keep them attached through an empty group with the same transform.
    for(const {o} of list){const parent=o.parent;if(o.children.length){const holder=new THREE.Group();holder.position.copy(o.position);holder.quaternion.copy(o.quaternion);holder.scale.copy(o.scale);while(o.children.length)holder.add(o.children[0]);parent.add(holder);}parent.remove(o);}
  }
  return root;
}
function prepareRide(root,type,fallbackSteering){
  const wheels=[];
  // Opaque-path glass: transmission forces an extra full-scene render pass in three.js.
  root.traverse(o=>{if(o.isMesh&&o.material?.name==='Glass'){o.material.transmission=0;o.material.transparent=true;o.material.opacity=0.62;o.material.color?.setHex(0x0c1116);o.material.roughness=0.04;o.material.metalness=0.25;o.material.envMapIntensity=1.6;}});
  root.traverse(node=>{if(node.isMesh)for(const material of Array.isArray(node.material)?node.material:[node.material])if(material.transmission>0){material.transmission=0;material.transparent=true;material.opacity=.62;material.color?.setHex(0x0c1116);material.roughness=Math.min(.06,material.roughness);material.envMapIntensity=1.6;}});
  const geometry=prepareVehicleGeometry(root,type);
  const cockpit=prepareCockpit(root,geometry.definition,fallbackSteering);
  // Car-body paint becomes clear-coated physical paint (one converted instance per source material, so batching still merges).
  const paintNames=geometry.paintMaterialNames||geometry.definition.paintMaterialNames||[],paints=new Map(),paint=m=>paintNames.includes(m.name)||m.userData.bodyPaint?(paints.get(m)||paints.set(m,toCarPaint(m)).get(m)):m;
  root.traverse(o=>{if(o.isMesh)o.material=Array.isArray(o.material)?o.material.map(paint):paint(o.material);});
  // Bake static float geometry safely while preserving wheel pivots and selectable paint meshes.
  const batching=batchStaticMeshes(root,{pinnedNames:[...geometry.pinnedNames,...cockpit.pinnedNames],preserveNames:geometry.definition.paintMeshNames||[]});
  const group=normalize(root,geometry.definition.length,'z');const size=new THREE.Box3().setFromObject(group,true).getSize(new THREE.Vector3());group.visible=false;visual.add(group);finishCockpit(group,cockpit);return {group,cockpit,wheels:geometry.wheels,rearWheels:geometry.wheels.filter(w=>!w.front).slice(0,2),size,type,paintMaterialNames:geometry.paintMaterialNames||geometry.definition.paintMaterialNames||[],batching};
}
function setRide(type,{initial=false}={}){
  const definition=getVehicle(type);if(!definition||!rides[type])return false;
  const old=playerActor?.state??{...WORLD.spawn,vx:0,vz:0},support={groundElevation:playerActor?.groundElevation||0,groundLayer:playerActor?.groundLayer},ride=rides[type];
  const replacement=physics.addVehicle({x:old.x,z:old.z,heading:old.heading,width:ride.size.x,length:ride.size.z,height:ride.size.y,...definition.tuning,userData:{kind:'player'}});
  replacement.setPose(old);Object.assign(replacement,support);stunts.reset(replacement);supportGround(replacement,true);if(!initial&&spawnBlocked(physics,world.obstacles,replacement)){replacement.setPose(WORLD.spawn);replacement.groundElevation=0;supportGround(replacement,true);}
  if(currentRide)showCockpitGlass(currentRide.cockpit,false);if(playerActor)physics.remove(playerActor);playerActor=replacement;supportGround(playerActor,true);chosen=type;currentRide=ride;audio.setVehicle(definition);garageSelection.equip(type);
  for(const r of Object.values(rides))r.group.visible=r.type===type;renderState.setActor(0,playerActor);
  showroom?.select(type);garageScene?.select(type);$('#showcase-car').textContent=definition.name.toUpperCase();$('#showcase-number').textContent=`YOUR RIDE / ${String(VEHICLES.indexOf(definition)+1).padStart(2,'0')}`;
  trickRig.position.y=ride.size.y/2;visual.position.y=-ride.size.y/2;renderInvalid=true;wheelDistance=0;tyreMarks?.breakTrail();updateTransforms(0);renderer.shadowMap.needsUpdate=true;syncMenu();if(ready)syncGarage();return true;
}
// Applies a graphics preset: post-processing chain, pixel-ratio range, shadow resolution, texture filtering and car clear coat.
function applyGraphics(choice=graphicsChoice){
  graphicsChoice=GRAPHICS_PRESETS[choice]?choice:'auto';const name=resolvePreset(graphicsChoice==='auto'?null:graphicsChoice,detectedPreset),preset=GRAPHICS_PRESETS[name];
  const shadowType=preset.softShadows?THREE.PCFSoftShadowMap:THREE.PCFShadowMap,shadowChanged=renderer.shadowMap.type!==shadowType;renderer.shadowMap.type=shadowType;quality.setRange(preset.ratio,preset.minRatio);renderer.setPixelRatio(Math.min(devicePixelRatio,quality.ratio));
  if(sun.shadow.mapSize.x!==preset.shadowMap){sun.shadow.mapSize.set(preset.shadowMap,preset.shadowMap);sun.shadow.map?.dispose();sun.shadow.map=null;}
  const anisotropy=Math.min(preset.anisotropy,renderer.capabilities.getMaxAnisotropy()),seen=new Set();
  scene.traverse(o=>{if(!o.isMesh)return;for(const m of Array.isArray(o.material)?o.material:[o.material]){if(!m||seen.has(m))continue;seen.add(m);if(shadowChanged)m.needsUpdate=true;if(m.userData.carPaint)m.clearcoat=preset.clearcoat?1:0;for(const t of [m.map,m.normalMap,m.roughnessMap])if(t&&t.anisotropy!==anisotropy){t.anisotropy=anisotropy;t.needsUpdate=true;}}});
  graphics.apply(name);pedestrians?.setCrowd(preset.crowd);graphics.setSize(innerWidth,innerHeight);renderer.shadowMap.needsUpdate=true;renderInvalid=true;
  for(const select of document.querySelectorAll('.graphics-select'))select.value=graphicsChoice;
  const label=$('#graphics-active');if(label)label.textContent=graphicsChoice==='auto'?`Auto · ${preset.label}`:preset.label;
  try{if(graphicsChoice==='auto')localStorage.removeItem(GRAPHICS_KEY);else localStorage.setItem(GRAPHICS_KEY,graphicsChoice);}catch{}
}
for(const select of document.querySelectorAll('.graphics-select'))select.onchange=e=>applyGraphics(e.target.value);
function anchorShowcase(){const stage=garageOpen?garageScene:showroom;if(!stage)return;sun.position.set(stage.position.x+SUN.x,SUN.y,stage.position.z+SUN.z);sun.target.position.copy(stage.position);sun.target.updateMatrixWorld();renderer.shadowMap.needsUpdate=true;}
const thumbnailSignatures=new Map();
function refreshGarageThumbnail(id){const value=appearance.get(id),signature=value.paint+':'+value.wheels;if(signature==='stock:stock'||thumbnailSignatures.get(id)===signature)return;const image=$(`[data-ride="${id}"] img`);if(image)image.src=vehicleThumbnails(renderer,{[id]:rides[id]},scene.environment)[id];thumbnailSignatures.set(id,signature);}
function syncGarage(){const def=getVehicle(garageSelection.preview),index=VEHICLES.indexOf(def);$('#garage-count').textContent=String(VEHICLES.length).padStart(2,'0');$('#garage-title').textContent=def.name;$('#garage-category').textContent=def.category+' / '+def.era;$('#garage-description').textContent=def.description;$('#garage-position').textContent=`${String(index+1).padStart(2,'0')} / ${String(VEHICLES.length).padStart(2,'0')}`;const equipped=chosen===def.id;$('#garage-equipped').textContent=equipped?'CURRENT RIDE':'PREVIEW';$('#garage-equipped').classList.toggle('current',equipped);$('#garage-equip').textContent=equipped?'CAR SELECTED':'SELECT CAR';$('#garage-equip').disabled=equipped;for(const [name,value]of Object.entries(tuningBars(def)))$('#tune-'+name).style.width=value+'%';for(const button of document.querySelectorAll('[data-ride]')){const selected=button.dataset.ride===def.id;button.classList.toggle('selected',selected);button.classList.toggle('equipped',button.dataset.ride===chosen);button.setAttribute('aria-pressed',String(selected));}syncCustomization();if(garageOpen)refreshGarageThumbnail(def.id);writeTelemetry();}
function previewGarage(id){if(!garageSelection.browse(id))return;garageScene.select(id);syncGarage();}
function openGarage(){if(!ready||!inShowroom)return;garageSelection.cancel();garageOpen=true;showroom.hide();garageScene.show(garageSelection.preview);$('#home').classList.add('garage-open');$('#garage-panel').hidden=false;$('#options-panel').hidden=true;anchorShowcase();syncGarage();$('#garage-back').focus();}
function closeGarage(){garageOpen=false;garageSelection.cancel();garageScene?.hide();$('#garage-panel').hidden=true;$('#home').classList.remove('garage-open');if(inShowroom)showroom?.show(chosen);anchorShowcase();writeTelemetry();}
function driveGarage(){if(!setRide(garageSelection.preview))return;closeGarage();audio.unlock();setPause(false);}
function syncCustomization(){if(!appearance)return;const options=appearance.get(garageSelection.preview);for(const button of document.querySelectorAll('[data-paint]'))button.setAttribute('aria-pressed',String(button.dataset.paint===options.paint));for(const button of document.querySelectorAll('[data-wheel-style]'))button.setAttribute('aria-pressed',String(button.dataset.wheelStyle===options.wheels));$('#paint-name').textContent=PAINTS.find(p=>p.id===options.paint).name;$('#wheel-name').textContent=WHEEL_STYLES.find(w=>w.id===options.wheels).name;}
function customize(patch){const id=garageSelection.preview;if(!appearance.apply(id,patch))return;syncCustomization();const image=$(`[data-ride="${id}"] img`);if(image)image.src=vehicleThumbnails(renderer,{[id]:rides[id]},scene.environment)[id];renderer.shadowMap.needsUpdate=true;$('#garage-save-status').textContent='SAVED FOR THIS CAR';writeTelemetry();}
function buildCustomControls(){for(const paint of PAINTS){const button=document.createElement('button');button.type='button';button.dataset.paint=paint.id;button.className='paint-swatch';button.setAttribute('aria-label',paint.name);button.title=paint.name;if(paint.color)button.style.setProperty('--swatch',paint.color);else button.classList.add('factory-swatch');button.onclick=()=>customize({paint:paint.id});$('#paint-options').append(button);}for(const wheel of WHEEL_STYLES){const button=document.createElement('button');button.type='button';button.dataset.wheelStyle=wheel.id;button.className='wheel-option';button.textContent=wheel.name;button.onclick=()=>customize({wheels:wheel.id});$('#wheel-options').append(button);}}
function buildGarage(){buildCustomControls();const pictures=new URLSearchParams(location.search).has('bake-thumbnails')?vehicleThumbnails(renderer,rides,scene.environment):null;$('#garage-list').replaceChildren();for(const definition of VEHICLES){const button=document.createElement('button');button.className='garage-car';button.dataset.ride=definition.id;button.setAttribute('aria-label',definition.name);const image=document.createElement('img');image.src=pictures?pictures[definition.id]:'assets/car-thumbnails/'+definition.id+'.webp';image.loading='lazy';image.alt='';const label=document.createElement('strong');label.textContent=definition.name;const category=document.createElement('small');category.textContent=definition.category;const copy=document.createElement('span');copy.className='car-card-copy';copy.append(label,category);button.append(image,copy);button.onclick=()=>previewGarage(definition.id);$('#garage-list').append(button);}syncGarage();}

async function init(){try{
  if(isCoast){const [props,parks,ambience,activities,crowd,cars]=await Promise.all([import('./street-props.js'),import('./park-life.js'),import('./ambient.js'),import('./open-world.js'),import('./pedestrians.js'),import('./street-cars.js')]);StreetProps=props.StreetProps;ParkLife=parks.ParkLife;CoastalAmbient=ambience.CoastalAmbient;OpenWorldActivities=activities.OpenWorldActivities;Pedestrians=crowd.Pedestrians;PED_ASSETS=crowd.PED_ASSETS;buildStreetCars=cars.buildStreetCars;STREET_CAR_ASSETS=cars.STREET_CAR_ASSETS;TRAFFIC_EXTRA=cars.TRAFFIC_EXTRA;trafficPerRoute=cars.trafficPerRoute;}
  const buildWorld=isDrift?(await worldModule).buildDriftWorld:(await worldModule).buildWorld;
  const names=initialModelNames(selectedMap,isCoast?[...STREET_CAR_ASSETS,...PED_ASSETS]:[]);
  const skyLoad=new RGBELoader().loadAsync('assets/sky-midday/kloofendal-puresky-1k.hdr').then(t=>{t.mapping=THREE.EquirectangularReflectionMapping;scene.background=t;scene.backgroundIntensity=1.25;scene.backgroundRotation.y=scene.environmentRotation.y=174*Math.PI/180;scene.environment=t;scene.environmentIntensity=isDrift?.8:.58;if(isDrift){renderer.toneMappingExposure=.95;sun.intensity=3;scene.backgroundIntensity=1.05;}});
  const showcaseTexturesLoad=loadShowcaseTextures();
  const colliderProfilesLoad=isCoast?fetch('assets/building-colliders.json').then(r=>{if(!r.ok)throw Error('Collider cache unavailable');return r.json();}).catch(error=>{console.warn(error);return null;}):null;
  const loaded=await Promise.all(names.map(async n=>[n,await loadModel(n,names.length)]));const models=Object.fromEntries(loaded);
  // Skyline towers ship metalness 1 and a baked AO map from Sketchfab; with N8AO on top they read black when backlit. Treat them as lighter dielectric facades without the baked AO.
  for(const [n,m] of loaded)if(n.startsWith('la-real/la-tower-'))m.traverse(o=>{if(o.isMesh&&o.material){o.material.metalness=Math.min(o.material.metalness,.25);o.material.roughness=Math.max(o.material.roughness,.45);o.material.envMapIntensity=1.5;o.material.aoMap=null;o.material.color.multiplyScalar(1.35);}});await skyLoad;
  for(const definition of VEHICLES)rides[definition.id]=prepareRide(models[definition.asset],definition.id,models['cockpit/savino-wheel']);
  appearance=new VehicleAppearance(rides,storage);
  world=await buildWorld({scene,physics,models,loader,random,colliderProfiles:await colliderProfilesLoad,anisotropy:Math.min(8,renderer.capabilities.getMaxAnisotropy())});if(!isDrift){streetProps=new StreetProps({scene,physics,world,map:selectedMap});await streetProps.load(loader);parkLife=new ParkLife({scene,plots:world.parkPlots||[]});await parkLife.load(loader);}tyreMarks=new TyreMarks(scene);if(isCoast)ambient=new CoastalAmbient(scene,{random,roadsZ:WORLD.roadsZ});
  if(!isDrift)try{pedestrians=new Pedestrians({scene,world,map:selectedMap,models,blockers:streetProps?.items||[]});}catch(error){console.warn('Pedestrians disabled',error);}
  // Maps without a stunt park must not offer an out-of-bounds teleport.
  if(!world.stuntArea)for(const el of [$('#stunt-section-title'),$('#stunt-tour'),$('#stunt-lane').closest('.pause-travel-block'),$('#trick-status'),$('#stunt-status')])el.hidden=true;
  setRide(garageSelection.equipped,{initial:true});
  const templates=(isDrift?[]:[['sedan',4.4],['suv',4.6],['taxi',4.4],...TRAFFIC_EXTRA]).map(([name,length])=>{batchStatic(models[name]);models[name].rotation.y=Math.PI;const t=normalize(models[name],length,'z');return {template:t,size:new THREE.Box3().setFromObject(t,true).getSize(new THREE.Vector3())};});
  const routes=[];for(const bounds of (isDrift?[]:[{left:-450,right:450,top:-600,bottom:600},{left:-300,right:300,top:-450,bottom:450},{left:-150,right:150,top:-300,bottom:300}]))for(const clockwise of [true,false])routes.push(roundedRoute({...bounds,clockwise,radius:11}));
  routes.forEach((route,r)=>{const count=trafficPerRoute(r);for(let i=0;i<count;i++){const progress=(i+.3)*route.length/count,at=route.sample(progress),t=templates[(i*3+r)%templates.length],mesh=t.template.clone(true);scene.add(mesh);const actor=physics.addVehicle({x:at.x,z:at.z,heading:at.heading,width:t.size.x,length:t.size.z,height:t.size.y,mass:1600,userData:{kind:'traffic'}});traffic.push({actor,mesh,route,progress,cruise:10+random()*4.5});}});
  traffic.forEach((car,i)=>renderState.setActor(i+1,car.actor));
  if(!isDrift)streetCars=buildStreetCars({scene,physics,models,map:selectedMap,random,world,extraCars:world.lotFill?.cars||[]});
  nitro=new NitroEffects({scene,camera,player,worldBounds:WORLD,roadsX:WORLD.roadsX,roadsZ:WORLD.roadsZ,random:Math.random,path:isDrift?DRIFT_PATH:null});if(!isDrift){const welcome=nitro.pickups[0];welcome.x=WORLD.spawn.x;welcome.z=36+Math.random()*32;const spawnPoint={x:WORLD.spawn.x,z:WORLD.spawn.z};for(const pickup of nitro.pickups.slice(1))if(Math.hypot(pickup.x-welcome.x,pickup.z-welcome.z)<30||Math.hypot(pickup.x-spawnPoint.x,pickup.z-spawnPoint.z)<35)nitro.field.spawn(pickup,[welcome,spawnPoint]);}showroom=new CarShowroom({scene,camera,rides,textures:await showcaseTexturesLoad,palm:models['tree-palmdetailedtall'],lamp:models['light-curved']});garageScene=new GarageScene({scene,camera,rides,interior:models['garage-interior']});garageScene.bindInteraction($('#garage-spin'));for(const id of Object.keys(rides)){appearance.registerRoot(id,showroom.cars[id]);appearance.registerRoot(id,garageScene.cars[id]);}buildGarage();for(const place of mapDestinations){const option=document.createElement('option');option.value=place.id;option.textContent=place.name;$('#map-destination').append(option);}for(const target of MAPS)if(target.id!==selectedMap){const option=document.createElement('option');option.value='map:'+target.id;option.textContent='Switch map · '+target.name;$('#map-destination').append(option);}addVehicleLights();updateTransforms(0);camera.position.set(pos.x+7,3.9,pos.z+9.5);cameraAim.set(pos.x,.8,pos.z-3);camera.lookAt(cameraAim);applyGraphics();warmVehicleRenderPaths({renderer,scene,camera,rides,player,showroom,garageScene});if(!isDrift)try{openWorld=new OpenWorldActivities({scene,physics,world,models,loader,normalize,bounds:WORLD,map:selectedMap,audio,storage});}catch(error){console.warn('Open-world activities disabled',error);}$('#game').dataset.ready='true';$('#game').dataset.map=selectedMap;THREE.Cache.clear();THREE.Cache.enabled=false;ready=true;circuitHud=new RaceHud({onStart:startCircuit,onRestart:restartCircuit,onExit:exitCircuit});
  if(isDrift){$('.home-title>span').textContent='OWN THE APEX.';$('.ld-kicker-title').textContent='DRIFT RACE TRACK';}for(const label of document.querySelectorAll('.home-top>span:last-child,.pause-badge'))label.textContent=mapDefinition.name.toUpperCase();const mapMeta=document.querySelector('.map-caption>span:last-child');if(mapMeta)mapMeta.textContent=world.stats.areaKm2+' KM² '+mapDefinition.name.toUpperCase();
  $('#loadbar').style.width='100%';$('#loadtext').textContent='Ready when you are.';showHome();sdk.loadingStop();syncMenu();$('#loader').style.opacity=0;setTimeout(()=>{$('#loader').hidden=true;},550);
  if(telemetryEnabled)window.gameDebug={scene,camera,physics,player,traffic,world,audio,renderer,nitro,getRenderTime:()=>renderState.time,get state(){const s=playerActor.state;return {ready,paused,chosen,camMode,boost,distance,raceActive,checkpoint,time:elapsed,state:s,world:world.stats,traffic:traffic.length,drawCalls:renderer.info.render.calls,triangles:renderer.info.render.triangles,impacts:physics.lastImpacts.length,nitroIntensity:nitro.intensity,pickups:nitro.pickups,showroom:inShowroom};},setPose:pose=>{playerActor.setPose(pose);renderState.snapSlot(0);camSnap=true;updateTransforms(0);},reset};
 }catch(error){console.error(error);$('#loadtext').textContent='An asset could not load. Reload to retry.';$('#retry').hidden=false;}}
function addVehicleLights(){
 const shadowCanvas=document.createElement('canvas');shadowCanvas.width=shadowCanvas.height=128;const c=shadowCanvas.getContext('2d'),g=c.createRadialGradient(64,64,5,64,64,60);g.addColorStop(0,'rgba(0,0,0,.55)');g.addColorStop(1,'rgba(0,0,0,0)');c.fillStyle=g;c.fillRect(0,0,128,128);const shadow=new THREE.Mesh(new THREE.PlaneGeometry(3.6,6),new THREE.MeshBasicMaterial({map:new THREE.CanvasTexture(shadowCanvas),transparent:true,depthWrite:false}));shadow.rotation.x=-Math.PI/2;shadow.position.y=.018;carShadow=shadow;player.add(shadow);
 for(const side of [-1,1]){const light=new THREE.SpotLight(0xf3f5ec,11,42,.42,.7,1.5);light.position.set(side*.7,.55,-1.9);light.target.position.set(side,0,-30);player.add(light,light.target);}
}
function district(s=playerActor){if(circuit?.active)return circuit.name;if(isDrift)return 'Drift Race Track';const x=s.x,z=s.z;if(x>STUNT_AREA.left&&x<STUNT_AREA.right&&z>STUNT_AREA.top&&z<STUNT_AREA.bottom)return'Stunt Park';return mapDistrict(x,z);}
function formatTime(t){return `${Math.floor(t/60).toString().padStart(2,'0')}:${(t%60).toFixed(2).padStart(5,'0')}`;}
function syncMenu(){if(!playerActor)return;$('#district').textContent=district().toUpperCase();$('#stunt-status').textContent=`BEST JUMP · ${stunts.best.toFixed(1)} M — Stunt Park: Kicker · Jump · Mega · 360 Spin · Barrel Roll. Boost pads sit on the approach to the Spin and Mega.`;if(stunts.noticeSerial!==lastNoticeSerial){lastNoticeSerial=stunts.noticeSerial;stuntToast=stunts.notice;stuntToastUntil=elapsed+2.5;}$('#trick-status').textContent=elapsed<stuntToastUntil?stuntToast:playerActor.lastTrick?`LAST STUNT · ${playerActor.lastTrick==='spin'?'360 SPIN':'BARREL ROLL'} — ${playerActor.completedTricks} completed`:'Build speed and take a marked ramp. Aerial moves finish before touchdown.';$('#resume').innerHTML=`${firstDrive?'Take the wheel':'Keep driving'} <span>↗</span>`;$('#menu-status').textContent=raceActive?`COASTAL SPRINT · CHECKPOINT ${checkpoint+1} / ${gates.length}`:'';$('#race').textContent=circuit?.active?'Return to free roam ↗':(isDrift?'Race Drift Track ↗':'Race Solana Raceway ↗');if(raceActive)$('#race-status').textContent=`${formatTime(raceTime)} · Checkpoint ${checkpoint+1} of ${gates.length}`;else if(best)$('#race-status').textContent=`Coastal sprint best · ${formatTime(best)}`;openWorld?.syncMenu();if(circuit?.active){$('#menu-status').textContent=circuit.name.toUpperCase()+' · LAP '+Math.min(3,circuit.entries[0].lap+1)+' / 3';$('#race-status').textContent='Race paused · '+formatTime(circuit.time);}drawMap();}
function cancelRush(){rush.cancel();rushUI?.hideResult();rushUI?.update(0,true);}
function startRush(){if(!ready)return;if(circuit?.active)exitCircuit(false);cancelRush();raceActive=false;gate.visible=false;reset();boost=100;rush.start(chosen,traffic);audio.unlock();setPause(false);rushUI?.update(1,false);}
function cruiseRush(){cancelRush();setPause(false);}
function showHome(){
  if(circuit?.active)exitCircuit(false);
  cancelRush();
  touchDriving.setActive(false);document.body.classList.remove('touch-driving');
  sdk.gameplayStop();garageOpen=false;garageSelection.cancel();garageScene?.hide();$('#garage-panel').hidden=true;$('#home').classList.remove('garage-open');paused=true;inShowroom=true;keys.clear();player.visible=false;gate.visible=false;$('#home').hidden=false;$('#menu').hidden=true;$('#pause').hidden=true;$('#touch').hidden=true;$('#radar-hud').hidden=true;$('#pause-drawer').hidden=true;
  if(nitro){nitro.update(0,{paused:true});nitro.intensity=0;nitro.life.fill(0);}clearBoost();nitroHud.hide();document.body.classList.remove('nitro-active');
  pedestrians?.hide();showroom.show(chosen);sun.position.set(showroom.position.x+SUN.x,SUN.y,showroom.position.z+SUN.z);sun.target.position.copy(showroom.position);sun.target.updateMatrixWorld();renderer.shadowMap.needsUpdate=true;audio.setPaused(true);writeTelemetry();
}
function setPause(value,fromFocus=false){
  if(!ready)return;if(!value&&garageOpen){driveGarage();return;}if(value&&inShowroom)return;
  if(!value&&inShowroom){inShowroom=false;showroom.hide();$('#home').hidden=true;player.visible=true;gate.visible=raceActive;updateTransforms(0);camera.position.set(pos.x+4,3.6,pos.z+10);cameraAim.set(pos.x,.9,pos.z-7);camera.lookAt(cameraAim);renderer.shadowMap.needsUpdate=true;}
  paused=value;renderInvalid=true;keys.clear();if(value){driveHint.hide();if(!fromFocus)sdk.gameplayStop();}else{sdk.gameplayStart();if(firstDrive&&!touchEnabled)driveHint.show();}$('#menu').hidden=!value;$('#pause').hidden=value;$('#touch').hidden=value||!touchEnabled;touchDriving.setActive(!value&&touchEnabled);document.body.classList.toggle('touch-driving',!value&&touchEnabled);$('#radar-hud').hidden=value;if(!value)$('#pause-drawer').hidden=true;if(value){clearBoost();nitro.intensity=0;nitroView=0;syncMenu();nitro.update(0,{paused:true});nitroHud.hide();document.body.classList.remove('nitro-active');}else{firstDrive=false;renderer.shadowMap.needsUpdate=true;}writeTelemetry();audio.setPaused(value);rushUI?.update(1,value);circuitHud?.render(1,circuit,value);
}
/** Drops any in-progress burn so a reset, pause or home visit cannot resume it. The tank itself is untouched. */
function clearBoost(){boosting=false;boostGate.boosting=false;boostGate.locked=false;nitroBodyClass=false;padBoost.reset();clearBoostBodyClass(document.body.classList);clearStuntToast();}
function reset(){if(circuit?.active){restartCircuit();return;}cancelRush();touchDriving.clear();tyreMarks?.breakTrail();clearBoost();pedestrians?.reset();playerActor.setPose(WORLD.spawn);stunts.reset(playerActor);frameMetrics.reset();supportGround(playerActor,true);renderState.snapSlot(0);steer=0;updateTransforms(0);renderer.shadowMap.needsUpdate=true;camera.position.set(pos.x+5,3.8,pos.z+10);cameraAim.set(pos.x,.8,pos.z-4);if(camMode!==2)camSnap=true;if(paused){if(!inShowroom){updateCamera(0.1);graphics.render(0);}syncMenu();}}
function changeCamera(value=(camMode+1)%3){const prevMode=camMode;camMode=Number(value);$('#camera').value=String(camMode);if(prevMode!==2&&camMode===2){cameraAim.copy(pos).addScaledVector(forward,28);cameraAim.y=pos.y+1;}if(prevMode===2&&camMode!==2)camSnap=true;if(paused&&!inShowroom){updateCamera(0.1);graphics.render(0);}}
function startCircuit(){
 if(!ready||circuit?.active)return;savedCircuitBoost=boost;cancelRush();raceActive=false;gate.visible=false;keys.clear();touchDriving.clear();clearBoost();stunts.reset(playerActor);tyreMarks?.breakTrail();
 circuit=new RaceMode({physics,scene,rides,renderState,slotOffset:traffic.length+1,...(isDrift?{path:DRIFT_PATH,groundY:world.groundY,trackFactory:buildDriftRaceMarkers,name:'Drift Race Track',padFractions:[.02,.21,.81]}:{}),keepVisible:[player,camera,nitro.group,nitro.points,...(isDrift?[world.root]:[])],asphalt:showroom.backdrop.root.getObjectByName('Five lane asphalt').material.map});circuit.start(chosen,playerActor);
 savedNitroField=nitro.field;savedNitroPickups=nitro.pickups;nitro.field=circuitPickupView;nitro.pickups=circuit.pickups;for(let i=0;i<nitro.glows.length;i++)nitro.glows[i].visible=false;
 raceSparks=new SparksParticleEmitter(scene);raceCountSound=-1;pedestrians?.hide();setPause(false);renderState.snapSlot(0);updateTransforms(0);camera.position.set(playerActor.x+7,3.9,playerActor.z+10);camSnap=true;renderer.shadowMap.needsUpdate=true;circuitHud.render(1,circuit,false);writeTelemetry();
}
function exitCircuit(resume=true){if(!circuit?.active)return;circuit.stop();showroom.hide();garageScene.hide();boost=savedCircuitBoost;nitro.field=savedNitroField;nitro.pickups=savedNitroPickups;nitro.life.fill(0);nitro.intensity=0;raceSparks?.dispose();raceSparks=null;circuitHud.render(1,circuit,true);stunts.reset(playerActor);supportGround(playerActor,true);renderState.snapSlot(0);steer=0;clearBoost();updateTransforms(0);camSnap=true;renderer.shadowMap.needsUpdate=true;if(resume)setPause(false);writeTelemetry();}
function restartCircuit(){if(!circuit?.active){startCircuit();return;}const snapshot=circuit.savedPose;exitCircuit(false);playerActor.setPose(snapshot);startCircuit();}
function circuitBeforeStep(fixed){renderState.beginStep();circuit.beforeStep(fixed,driveInput);elapsed+=fixed;}
function circuitAfterStep(fixed){circuit.afterStep(fixed);}
function updateCircuit(dt){
 const previousX=playerActor.x,previousZ=playerActor.z;renderState.advance(dt);drivingControls(keys,touchDriving.state,driveInput);const count=Math.ceil(circuit.countdown);if(count!==raceCountSound&&circuit.phase==='countdown'){raceCountSound=count;audio.onRaceCount(false);}const phase=circuit.phase;
 physics.step(dt,circuitBeforeStep,circuitAfterStep);if(phase==='countdown'&&circuit.phase==='racing')audio.onRaceCount(true);renderState.endStep();distance+=Math.hypot(playerActor.x-previousX,playerActor.z-previousZ);
 steer=circuit.entries[0].controls.steer;boost=circuit.entries[0].nitro;boosting=circuit.entries[0].boostGate.boosting;updateTransforms(dt);circuit.render(physics.alpha,dt);raceSparks.update(dt);
 for(let i=0;i<physics.lastImpacts.length;i++){const impact=physics.lastImpacts[i];if(impact.speed>2&&elapsed-lastImpact>.08&&(impact.a===playerActor||impact.b===playerActor||Math.hypot(impact.x-playerActor.x,impact.z-playerActor.z)<30)){lastImpact=elapsed;raceSparks.emit(impact.x,impact.z,impact.speed);audio.onImpact(impact.speed);impactShake=Math.min(.2,impact.speed*.012);}}
 nitroFrame.active=boosting||circuit.entries[0].pad.active;nitroFrame.speed=playerActor.speed;nitroFrame.time=renderState.time;nitroFrame.position=pos;nitroFrame.heading=playerActor.heading;nitroFrame.paused=false;nitro.update(dt,nitroFrame);if(nitroFrame.active!==nitroBodyClass){nitroBodyClass=nitroFrame.active;document.body.classList.toggle('nitro-active',nitroBodyClass);}for(let i=0;i<circuit.opponents.length;i++){const e=circuit.opponents[i];if(e.mesh&&(e.boostGate.boosting||e.pad.active)){e.exhaust+=dt*60;while(e.exhaust>=1){nitro.emit(e.mesh.position,e.actor.heading,e.actor.speed);e.exhaust--;}}}nitroHud.update(boost,dt,boosting,circuit.entries[0].boostGate.locked);updateCamera(dt);audio.update(playerActor,circuit.phase==='countdown'?.6:driveInput.throttle,driveInput.handbrake,nitroFrame.active,dt);audio.updateTraffic(circuit.opponents,playerActor,dt);circuitHud.render(dt,circuit,paused);drawCircuitRadar(dt);debugClock+=dt;if(debugClock>.1){debugClock=0;writeTelemetry();}
}
function drawCircuitRadar(dt=0){if(!radarDue(dt))return;if(!radarCtx||!circuit?.active)return;const ctx=radarCtx,path=circuit.path;ctx.clearRect(0,0,320,320);ctx.save();ctx.beginPath();ctx.arc(160,160,155,0,Math.PI*2);ctx.clip();ctx.fillStyle='#111b25';ctx.fillRect(0,0,320,320);ctx.translate(160,160);ctx.rotate(playerActor.heading);ctx.scale(.22,.22);ctx.translate(-playerActor.x,-playerActor.z);const layer=raceRadarLayer(path);ctx.drawImage(layer.canvas,layer.x,layer.z,layer.width,layer.height);for(let i=4;i>=0;i--){const e=circuit.entries[i];ctx.fillStyle=i?'#fcaf17':'#ffffff';ctx.beginPath();ctx.arc(e.actor.x,e.actor.z,i?8:10,0,Math.PI*2);ctx.fill();}ctx.restore();radarDistrict.textContent=circuit.name.toUpperCase();radarSpeed.textContent=Math.round(playerActor.speed*3.6)+' KM/H';}
function startRace(){startCircuit();}
function moveGate(){const point=gates[checkpoint],prev=checkpoint?gates[checkpoint-1]:[WORLD.spawn.x,WORLD.spawn.z];gate.position.set(point[0],0,point[1]);gate.rotation.y=Math.abs(point[0]-prev[0])>Math.abs(point[1]-prev[1])?Math.PI/2:0;}
// Every visible HUD element lives in the pause menu. No notifications obscure driving.
const inputKeys=['w','a','s','d','z','q','arrowup','arrowdown','arrowleft','arrowright',' ','shift'];
addEventListener('keydown',event=>{const key=event.key.toLowerCase();if((garageOpen||paused)&&['enter',' '].includes(key)&&event.target?.closest('button,a,select,input,summary'))return;if(garageOpen&&['escape','enter','arrowleft','arrowright'].includes(key)){event.preventDefault();if(!event.repeat){if(key==='escape')closeGarage();else if(key==='enter')driveGarage();else{const i=VEHICLES.findIndex(v=>v.id===garageSelection.preview);previewGarage(VEHICLES[(i+(key==='arrowleft'?-1:1)+VEHICLES.length)%VEHICLES.length].id);}}return;}if(inputKeys.includes(key)||['escape','enter'].includes(key))event.preventDefault();if(!event.repeat){if(key==='escape'||key==='?'||key==='p'){if(paused&&!$('#pause-drawer').hidden){$('#pause-drawer').hidden=true;}else{setPause(!paused);}}if(key==='enter'&&paused&&inShowroom){setPause(false);return;}if(key==='c'&&(!paused||!inShowroom))changeCamera();if(key==='r'&&(!paused||!inShowroom))reset();if(key==='enter'&&(!paused||!inShowroom)){startRace();if(paused&&raceActive)setPause(false);}}if(!paused){keys.add(key);if(inputKeys.includes(key))driveHint.dismiss();}});addEventListener('keyup',e=>{const k=e.key.toLowerCase();if(k==='meta')keys.clear();else keys.delete(k);});addEventListener('blur',()=>{keys.clear();if(ready)setPause(true,true);});document.addEventListener('visibilitychange',()=>{if(document.hidden&&ready)setPause(true,true);});
$('#home-drive').onclick=()=>{audio.unlock();setPause(false);};$('#home-garage').onclick=openGarage;$('#garage-back').onclick=closeGarage;$('#garage-equip').onclick=()=>setRide(garageSelection.preview);$('#garage-drive').onclick=driveGarage;$('#home-options').onclick=()=>{const panel=$('#options-panel');panel.hidden=!panel.hidden;$('#garage-panel').hidden=true;};for(const button of document.querySelectorAll('.close-drawer'))button.onclick=()=>{button.closest('.home-drawer').hidden=true;};for(const button of document.querySelectorAll('[data-ride]'))button.onclick=()=>setRide(button.dataset.ride);$('#showroom').onclick=showHome;
$('#pause').onclick=()=>setPause(true);$('#resume').onclick=()=>setPause(false);$('#quick-resume').onclick=()=>setPause(false);$('#pause-settings-btn').onclick=()=>{const d=$('#pause-drawer');d.hidden=!d.hidden;};$('#close-pause-drawer').onclick=()=>{$('#pause-drawer').hidden=true;};$('#back-pause-drawer').onclick=()=>{$('#pause-drawer').hidden=true;};for(const tab of document.querySelectorAll('.pause-tab-btn'))tab.onclick=()=>{for(const b of document.querySelectorAll('.pause-tab-btn')){const on=b===tab;b.classList.toggle('is-active',on);b.setAttribute('aria-selected',String(on));}for(const p of document.querySelectorAll('.pause-tab-panel'))p.hidden=p.id!==`tab-${tab.dataset.tab}`;};$('#menu').onclick=e=>{if(e.target===$('#menu')||e.target.classList.contains('pause-center')){if(!$('#pause-drawer').hidden){$('#pause-drawer').hidden=true;}else{setPause(false);}}};$('#camera').onchange=e=>changeCamera(e.target.value);$('#reset').onclick=reset;$('#stunt-tour').onclick=()=>{if(circuit?.active)exitCircuit(false);if(!world?.stuntArea)return;cancelRush();clearBoost();const lane=RAMPS.find(r=>r.id===$('#stunt-lane').value);playerActor.setPose({...STUNT_AREA.entry,x:lane?.x??STUNT_AREA.entry.x});stunts.reset(playerActor);frameMetrics.reset();supportGround(playerActor,true);renderState.snapSlot(0);steer=0;camSnap=true;setPause(false);};$('#race').onclick=()=>{if(circuit?.active)exitCircuit();else startRace();};$('#map-travel').onclick=()=>{if(circuit?.active)exitCircuit(false);const destination=$('#map-destination').value;if(destination.startsWith('map:')){const id=destination.slice(4);try{mapStorage?.setItem('speed-for-need-map',id);}catch{}location.assign(mapUrl(location.href,id));return;}const place=mapDestinations.find(d=>d.id===$('#map-destination').value);if(!place)return;cancelRush();clearBoost();playerActor.setPose(place);stunts.reset(playerActor);frameMetrics.reset();supportGround(playerActor,true);renderState.snapSlot(0);steer=0;camSnap=true;setPause(false);};$('#retry').onclick=()=>location.reload();const touchDriving=new TouchDriving({stick:$('#drive-stick'),buttons:document.querySelectorAll('#touch [data-action]')}),driveInput={};
function syncTouch(){for(const id of ['#touch-toggle','#home-touch']){$(id).textContent=touchEnabled?'On':'Off';$(id).setAttribute('aria-pressed',String(touchEnabled));}const active=!paused&&touchEnabled;$('#touch').hidden=!active;touchDriving.setActive(active);document.body.classList.toggle('touch-driving',active);}
$('#touch-toggle').onclick=()=>{touchEnabled=!touchEnabled;syncTouch();};syncTouch();
$('#home-touch').onclick=()=>$('#touch-toggle').click();
const audio=new GameAudio();let soundOn=true;const syncSound=()=>{const on=audio.setEnabled(soundOn&&!sdk.muted);if(!sdk.muted)soundOn=on;for(const id of ['#sound','#home-sound']){$(id).textContent=soundOn?'On':'Off';$(id).setAttribute('aria-pressed',String(soundOn));}};$('#sound').onclick=()=>{if(sdk.muted)return;soundOn=!soundOn;syncSound();};syncSound();sdk.onMuteChange(syncSound);
$('#home-sound').onclick=()=>$('#sound').click();
rushUI=new SkillRunUI({run:rush,onStart:startRush,onCruise:cruiseRush});
{const showRushResult=rushUI.showResult.bind(rushUI);rushUI.showResult=()=>{const first=!rushUI.resultShown;showRushResult();if(!first||!rushUI.resultShown)return;if(rush.result?.newBest&&rush.result.score>0)sdk.happytime();sdk.midgameAd({onStart:()=>audio.setPaused(true),onEnd:()=>audio.setPaused(paused)});};}
const map=$('#minimap'),ctx=map?map.getContext('2d'):null;
function drawDriftPauseMap(){ctx.fillStyle='#111b25';ctx.fillRect(0,0,map.width,map.height);ctx.save();const scale=Math.min(map.width/530,map.height/530);ctx.translate(map.width/2,map.height/2);ctx.scale(scale,scale);ctx.translate(-16,-19);drawDriftMap(ctx);ctx.fillStyle='#fcaf17';for(const p of DRIFT_GATES){ctx.beginPath();ctx.arc(p[0],p[1],3,0,Math.PI*2);ctx.fill();}ctx.fillStyle='#fff';ctx.beginPath();ctx.arc(playerActor.x,playerActor.z,7,0,Math.PI*2);ctx.fill();ctx.restore();map.setAttribute('aria-label','Drift Race Track circuit map');$('#map-caption-area').textContent=(DRIFT_PATH.length/1000).toFixed(2)+' KM DRIFT RACE TRACK';}
function drawCircuitMap(){const path=circuit.path,scale=Math.min((map.width-30)/480,(map.height-30)/500);ctx.fillStyle='#111b25';ctx.fillRect(0,0,map.width,map.height);ctx.save();ctx.translate(map.width/2,map.height/2);ctx.scale(scale,scale);ctx.translate(-path.originX+30,-path.originZ-25);if(isDrift)drawDriftMap(ctx);ctx.strokeStyle='#7c8b96';ctx.lineWidth=isDrift?2:16;ctx.beginPath();ctx.moveTo(path.x[0],path.z[0]);for(let i=4;i<=path.count;i+=4)ctx.lineTo(path.x[i],path.z[i]);ctx.closePath();ctx.stroke();for(let i=4;i>=0;i--){const e=circuit.entries[i];ctx.fillStyle=i?'#fcaf17':'#ffffff';ctx.beginPath();ctx.arc(e.actor.x,e.actor.z,i?7:10,0,Math.PI*2);ctx.fill();}ctx.restore();}
function drawMap(){
  if(!map||!ctx||!playerActor)return;
  if(circuit?.active){map.setAttribute('aria-label','Map of '+circuit.name);$('#map-caption-area').textContent=(circuit.path.length/1000).toFixed(2)+' KM '+circuit.name.toUpperCase();drawCircuitMap();return;}
  map.setAttribute('aria-label','Map of expanded Solana Coast');$('#map-caption-area').textContent='1.31 KM² SOLANA COAST';
  if(isDrift){drawDriftPauseMap();return;}
  ctx.fillStyle='#0a0e14';
  ctx.fillRect(0,0,map.width,map.height);
  const scale=.175,ox=map.width/2,oy=map.height/2;
  ctx.save();
  ctx.translate(ox,oy);
  ctx.scale(scale,scale);
  ctx.fillStyle='#161c24';
  ctx.fillRect(WORLD.left,WORLD.top,WORLD.right-WORLD.left,WORLD.bottom-WORLD.top);
  if(isCoast)drawMapDistricts(ctx);
  ctx.fillStyle='#242c38';
  for(const x of WORLD.roadsX)ctx.fillRect(x-14,WORLD.top,28,WORLD.bottom-WORLD.top);
  for(const z of WORLD.roadsZ)ctx.fillRect(WORLD.left,z-14,WORLD.right-WORLD.left,28);
  ctx.fillStyle='#f0f2f5';
  for(const x of WORLD.roadsX)ctx.fillRect(x-10,WORLD.top,20,WORLD.bottom-WORLD.top);
  for(const z of WORLD.roadsZ)ctx.fillRect(WORLD.left,z-10,WORLD.right-WORLD.left,20);
  if(isCoast)drawSunsetMap(ctx);
  if(world.stuntArea){ctx.fillStyle='#9b7635';ctx.fillRect(STUNT_AREA.left,STUNT_AREA.top,STUNT_AREA.right-STUNT_AREA.left,STUNT_AREA.bottom-STUNT_AREA.top);}
  ctx.fillStyle='#94a1b2';
  for(const c of traffic){const a=c.actor;ctx.fillRect(a.x-3,a.z-3,6,6);}
  if(raceActive){
    ctx.fillStyle='#f5c518';
    ctx.beginPath();
    ctx.arc(...gates[checkpoint],18,0,Math.PI*2);
    ctx.fill();
  }
  if(world.stuntArea){drawBoostPadMarks(ctx);ctx.fillStyle='#fcaf17';for(const r of RAMPS){ctx.save();ctx.translate(r.x,r.z);ctx.rotate(-r.heading);ctx.beginPath();ctx.moveTo(0,-23);ctx.lineTo(17,17);ctx.lineTo(-17,17);ctx.closePath();ctx.fill();ctx.restore();}}
  openWorld?.drawMap(ctx);
  ctx.translate(playerActor.x,playerActor.z);
  ctx.rotate(-playerActor.heading);
  ctx.fillStyle='#ffffff';
  ctx.strokeStyle='#000000';
  ctx.lineWidth=4;
  ctx.beginPath();
  ctx.moveTo(0,-34);
  ctx.lineTo(22,23);
  ctx.lineTo(0,10);
  ctx.lineTo(-22,23);
  ctx.closePath();
  ctx.stroke();
  ctx.fill();
  ctx.restore();
}

const radarCanvas=$('#radar'),radarCtx=radarCanvas?radarCanvas.getContext('2d'):null;
const radarHud=$('#radar-hud'),radarNorth=$('#radar-north'),radarDistrict=$('#radar-district'),radarSpeed=$('#radar-speed');
let lastRadarDistrict='',lastRadarSpeed=-1,radarTextClock=0;


let radarClock=1/30,freeRadarLayer=null,circuitRadarLayer=null,circuitRadarPath=null;
function radarDue(dt){radarClock+=dt;if(radarClock<1/30)return false;radarClock%=1/30;radarRedraws++;return true;}
function createRadarLayer(bounds,paint){const pad=20,x=bounds.left-pad,z=bounds.top-pad,width=bounds.right-bounds.left+2*pad,height=bounds.bottom-bounds.top+2*pad,canvas=document.createElement('canvas');canvas.width=Math.ceil(width);canvas.height=Math.ceil(height);const ctx=canvas.getContext('2d');ctx.translate(-x,-z);paint(ctx);return {canvas,x,z,width,height};}
function paintFreeRadar(ctx){
  ctx.fillStyle='#161c24';
  ctx.fillRect(WORLD.left,WORLD.top,WORLD.right-WORLD.left,WORLD.bottom-WORLD.top);
  if(isCoast)drawMapDistricts(ctx);
  ctx.fillStyle='#242c38';
  for(const x of WORLD.roadsX)ctx.fillRect(x-14,WORLD.top,28,WORLD.bottom-WORLD.top);
  for(const z of WORLD.roadsZ)ctx.fillRect(WORLD.left,z-14,WORLD.right-WORLD.left,28);
  ctx.fillStyle='#f0f2f5';
  for(const x of WORLD.roadsX)ctx.fillRect(x-10,WORLD.top,20,WORLD.bottom-WORLD.top);
  for(const z of WORLD.roadsZ)ctx.fillRect(WORLD.left,z-10,WORLD.right-WORLD.left,20);
  if(isCoast)drawSunsetMap(ctx);if(isDrift)drawDriftMap(ctx);
  if(world.stuntArea){ctx.fillStyle='#9b7635';ctx.fillRect(STUNT_AREA.left,STUNT_AREA.top,STUNT_AREA.right-STUNT_AREA.left,STUNT_AREA.bottom-STUNT_AREA.top);}
  if(world.stuntArea){drawBoostPadMarks(ctx);ctx.fillStyle='#fcaf17';for(const r of RAMPS){ctx.save();ctx.translate(r.x,r.z);ctx.rotate(-r.heading);ctx.beginPath();ctx.moveTo(0,-19);ctx.lineTo(13,13);ctx.lineTo(-13,13);ctx.closePath();ctx.fill();ctx.restore();}}
}
function raceRadarLayer(path){
 if(circuitRadarPath===path)return circuitRadarLayer;
 let left=Infinity,right=-Infinity,top=Infinity,bottom=-Infinity;
 for(let i=0;i<path.count;i++){left=Math.min(left,path.x[i]);right=Math.max(right,path.x[i]);top=Math.min(top,path.z[i]);bottom=Math.max(bottom,path.z[i]);}
 circuitRadarPath=path;circuitRadarLayer=createRadarLayer(isDrift?WORLD:{left,right,top,bottom},ctx=>{if(isDrift)drawDriftMap(ctx);ctx.strokeStyle='#657986';ctx.lineWidth=isDrift?2:16;ctx.beginPath();ctx.moveTo(path.x[0],path.z[0]);for(let i=4;i<=path.count;i+=4)ctx.lineTo(path.x[i],path.z[i]);ctx.closePath();ctx.stroke();});return circuitRadarLayer;
}
function drawRadar(dt){
  if(circuit?.active){drawCircuitRadar(dt);return;}
  if(!radarDue(dt))return;
  if(!radarCanvas||!radarCtx||!playerActor)return;
  const spd=playerActor.speed,px=renderPose.x,pz=renderPose.z,ph=renderPose.heading;
  const zoom=lerp(0.32,0.18,Math.min(1,spd/45));
  radarCtx.save();
  radarCtx.clearRect(0,0,320,320);
  radarCtx.beginPath();
  radarCtx.arc(160,160,156,0,Math.PI*2);
  radarCtx.clip();
  radarCtx.fillStyle='#0a0e14';
  radarCtx.fillRect(0,0,320,320);
  radarCtx.save();
  radarCtx.translate(160,160);
  radarCtx.rotate(ph);
  radarCtx.scale(zoom,zoom);
  radarCtx.translate(-px,-pz);
  const layer=freeRadarLayer||(freeRadarLayer=createRadarLayer(WORLD,paintFreeRadar));radarCtx.drawImage(layer.canvas,layer.x,layer.z,layer.width,layer.height);
  radarCtx.fillStyle='#94a1b2';for(const c of traffic){const a=c.actor;if(a.body.isActive())radarCtx.fillRect(a.x-3.5,a.z-3.5,7,7);}
  openWorld?.drawRadar(radarCtx,zoom);
  radarCtx.restore();
  if(raceActive){
    const gate=gates[checkpoint];
    const dx=gate[0]-px,dz=gate[1]-pz;
    const cos=Math.cos(ph),sin=Math.sin(ph);
    const rx=(dx*cos-dz*sin)*zoom,ry=(dx*sin+dz*cos)*zoom;
    const dist=Math.hypot(rx,ry);
    const maxR=142;
    if(dist>maxR){
      const cx=160+(rx/dist)*maxR,cy=160+(ry/dist)*maxR;
      radarCtx.fillStyle='#f5c518';
      radarCtx.beginPath();
      radarCtx.arc(cx,cy,6,0,Math.PI*2);
      radarCtx.fill();
      radarCtx.strokeStyle='#ffd000';
      radarCtx.lineWidth=2;
      radarCtx.beginPath();
      radarCtx.arc(cx,cy,9+Math.sin(renderState.time*6)*2,0,Math.PI*2);
      radarCtx.stroke();
    }else{
      const gx=160+rx,gy=160+ry;
      const beacon=(renderState.time*30)%20;
      radarCtx.strokeStyle=`rgba(245,197,24,${Math.max(0,1-beacon/20)})`;
      radarCtx.lineWidth=2.5;
      radarCtx.beginPath();
      radarCtx.arc(gx,gy,7+beacon,0,Math.PI*2);
      radarCtx.stroke();
      radarCtx.fillStyle='#f5c518';
      radarCtx.beginPath();
      radarCtx.arc(gx,gy,7,0,Math.PI*2);
      radarCtx.fill();
      radarCtx.fillStyle='#0a0e14';
      radarCtx.beginPath();
      radarCtx.arc(gx,gy,2.5,0,Math.PI*2);
      radarCtx.fill();
    }
  }
  radarCtx.fillStyle='#ffffff';
  radarCtx.strokeStyle='#000000';
  radarCtx.lineWidth=3;
  radarCtx.beginPath();
  radarCtx.moveTo(160,147);
  radarCtx.lineTo(169,169);
  radarCtx.lineTo(160,164);
  radarCtx.lineTo(151,169);
  radarCtx.closePath();
  radarCtx.stroke();
  radarCtx.fill();
  radarCtx.restore();
  if(radarNorth){
    radarNorth.style.left=(50+Math.sin(ph)*41).toFixed(2)+'%';
    radarNorth.style.top=(50-Math.cos(ph)*41).toFixed(2)+'%';
  }
  radarTextClock+=1/30;
  if(radarTextClock>0.08){
    radarTextClock=0;
    const dist=district();
    if(dist!==lastRadarDistrict){
      lastRadarDistrict=dist;
      if(radarDistrict)radarDistrict.textContent=dist.toUpperCase();
    }
    const spdKmh=Math.round(spd*3.6);
    if(spdKmh!==lastRadarSpeed){
      lastRadarSpeed=spdKmh;
      if(radarSpeed)radarSpeed.innerHTML=`${spdKmh} <small>KM/H</small>`;
    }
  }
}
const wheelAxis=new THREE.Vector3(1,0,0),steerAxis=new THREE.Vector3(0,0,1),wheelQuat=new THREE.Quaternion(),steerQuat=new THREE.Quaternion();
function updateTransforms(dt){const fwd=playerActor.forwardSpeed,yaw=playerActor.yawRate;renderState.sample(0,physics.alpha,renderPose);const px=renderPose.x,pz=renderPose.z,ph=renderPose.heading;pos.set(px,lerp((playerActor.prevElevation||0)+(playerActor.prevGroundElevation||0),(playerActor.elevation||0)+(playerActor.groundElevation||0),physics.alpha),pz);visual.rotation.x=lerp(playerActor.prevPitch||0,playerActor.pitch||0,physics.alpha)+(playerActor.groundPitch||0);trickRig.rotation.y=lerp(playerActor.prevTrickYaw||0,playerActor.trickYaw||0,physics.alpha);trickRig.rotation.z=lerp(playerActor.prevTrickRoll||0,playerActor.trickRoll||0,physics.alpha);if(carShadow){carShadow.position.y=.018-(playerActor.elevation||0);carShadow.material.opacity=Math.max(.12,1-(playerActor.elevation||0)*.055);}forward.set(-Math.sin(ph),0,-Math.cos(ph));player.position.copy(pos);player.rotation.y=ph;visual.rotation.z=lerp(visual.rotation.z,-yaw*fwd*.0012+(playerActor.deckLean||0)+(playerActor.groundRoll||0),1-Math.exp(-dt*6));if(currentRide){currentRide.group.visible=true;showCockpitGlass(currentRide.cockpit,camMode===2);animateSteering(currentRide.cockpit,steer,dt,fwd);wheelDistance+=fwd*dt;for(const w of currentRide.wheels){wheelQuat.setFromAxisAngle(w.spinAxis||wheelAxis,wheelDistance/(w.radius||.4142)*(w.rollSign??1));w.node.quaternion.copy(w.base).multiply(wheelQuat);if(w.front){steerQuat.setFromAxisAngle(w.steerAxis||steerAxis,steer*playerActor.config.steerAngle/(1+Math.abs(fwd)/44));w.node.quaternion.premultiply(steerQuat);}}}for(let i=0;i<traffic.length;i++){renderState.sample(i+1,physics.alpha,trafficPose);const m=traffic[i].mesh;if(!m.visible)continue;m.position.set(trafficPose.x,traffic[i].actor.groundElevation||0,trafficPose.z);m.rotation.y=trafficPose.heading;}
  // Shadow frustum follows the rendered car, snapped to whole shadow texels in light space so shadow edges do not shimmer.
  if(inShowroom)anchorShowcase();}
function updateSunShadow(){const px=pos.x,pz=pos.z,sc=sun.shadow.camera;snapShadowAnchor(shadowAnchor,px,pz,SUN.x,SUN.y,SUN.z,(sc.right-sc.left)/sun.shadow.mapSize.x);sun.position.set(shadowAnchor.x+SUN.x,SUN.y+shadowAnchor.y,shadowAnchor.z+SUN.z);sun.target.position.set(shadowAnchor.x,shadowAnchor.y,shadowAnchor.z);sun.target.updateMatrixWorld();}
let cameraBoxes=null,cameraBoxesWorld=null;const nearCameraBoxes=makeBoxWindow();const chaseParams={x:0,y:0,z:0,fx:0,fz:0,back:0,lead:0,height:0,boxes:null,spheres:null},shakeVec={x:0,y:0,z:0},trafficSpheres=[];let impactShake=0,nitroView=0,nitroBodyClass=false;
function updateCamera(dt){
  if(camMode===2){
    cockpitCamera(camera,currentRide,dt,playerActor.forwardSpeed,playerActor.yawRate);camera.near=.025;
    if(circuit?.active){const shake=shakeOffset(dt);camera.position.x+=shake.x*.35;camera.position.y+=shake.y*.35;}
    camera.fov=lerp(camera.fov,cockpitFov(currentRide.cockpit.profile,camera.aspect)+(nitro?.intensity||0)*1.5,1-Math.exp(-dt*8));camera.updateProjectionMatrix();return;
  }
  camera.up.set(0,1,0);camera.near=.12;nitroView=lerp(nitroView,nitro?.intensity||0,1-Math.exp(-dt*6));
  const intensity=nitroView,back=camMode===0?9.5+intensity*.9:16+intensity,height=camMode===0?3.1:5.1,lead=chaseLead(playerActor.forwardSpeed,dt);
  // Shorten chase camera against physical building volumes; cockpit uses its driver anchor instead.
  if(cameraBoxesWorld!==world){cameraBoxesWorld=world;cameraBoxes=world.obstacles.filter(o=>o.actor.userData?.kind==='building').map(o=>o.box);}for(let i=0;i<traffic.length;i++){const ta=traffic[i].actor,sp=trafficSpheres[i]||(trafficSpheres[i]={x:0,y:.6,z:0,r:CHASE_ROAD_R});sp.x=ta.x;sp.z=ta.z;}trafficSpheres.length=traffic.length;chaseParams.x=pos.x;chaseParams.y=pos.y;chaseParams.z=pos.z;chaseParams.fx=forward.x;chaseParams.fz=forward.z;chaseParams.back=back;chaseParams.lead=lead;chaseParams.height=height;chaseParams.boxes=nearCameraBoxes(cameraBoxes,pos.x,pos.z);chaseParams.spheres=trafficSpheres;stepChaseCamera(camera.position,pos,dt,chaseParams,camSnap,shakeOffset(dt));camSnap=false;
  camera.fov=lerp(camera.fov,(camMode===1?60:57)+intensity*10,1-Math.exp(-dt*6));camera.updateProjectionMatrix();aimChaseCamera();
}
// Chase cams: aim so the car's centre sits low and horizontally centred on screen (NDC y -0.5 = 75% down).
// Recomputed every frame from the live camera position and FOV, so speed, nitro FOV and shake cannot pull the car toward the middle.
let camSnap=false;const CHASE_CAR_NDC_Y=-.5,carAnchor=new THREE.Vector3();function shakeOffset(dt){const on=impactShake>.005;shakeVec.x=on?Math.sin(renderState.time*55)*impactShake:0;shakeVec.y=on?Math.cos(renderState.time*67)*impactShake*.4:0;if(on)impactShake*=Math.exp(-dt*10);return shakeVec;}
function aimChaseCamera(){chaseAim(camera.position,carAnchor.set(pos.x,pos.y+.6,pos.z),camera.fov,CHASE_CAR_NDC_Y,cameraAim);camera.lookAt(cameraAim);}
let cellClock=0;
function supportGround(a,snap=false){if(circuit?.active)return;if(!world?.getDeckHeight)return;const previous=a.groundElevation||0;a.prevGroundElevation=previous;if(!a.isAirborne){const pose=world.getDeckPose(a);a.groundElevation=pose.height;a.groundPitch=pose.pitch;a.groundRoll=pose.roll;}if(snap)a.prevGroundElevation=a.groundElevation;}

let last=performance.now(),debugClock=0,frameAverage=16.7,physicsStepCount=0;
function writeTelemetry(){if(!telemetryEnabled||!playerActor||!world)return;$('#game').dataset.telemetry=JSON.stringify({map:selectedMap,rush:{phase:rush.phase,remaining:rush.remaining,score:rush.score,chain:rush.chain,mult:rush.mult,result:rush.result},activeColliders:physics.objects.length,activeTraffic:traffic.filter(c=>c.actor.body.isActive()).length,shadowUpdates:shadowRenders,radarUpdates:radarRedraws,buildingProfiles:world.stats.colliderProfiles,worldArea:world.stats.areaKm2,groundElevation:playerActor.groundElevation||0,speed:playerActor.speed,x:pos.x,z:pos.z,heading:playerActor.heading,boost,checkpoint,camMode,ready,paused,car:chosen,circuit:circuit?.active?{phase:circuit.phase,time:circuit.time,countdown:circuit.countdown,lap:circuit.entries[0].lap,order:Array.from(circuit.order),cars:circuit.entries.map(e=>({id:e.def.id,s:e.progress,lap:e.lap,speed:e.actor.speed,nitro:e.nitro,drafting:e.drafting,recovery:e.recovery,finish:e.finishTime}))}:null,garageOpen,garagePreview:garageSelection.preview,elevation:pos.y,airborne:playerActor.isAirborne,ramp:playerActor.rampId,paint:appearance?.get(chosen).paint,wheelStyle:appearance?.get(chosen).wheels,wheelRotation:currentRide.wheels[0]?.node.quaternion.toArray(),cockpit:{visible:currentRide.group.visible,glassHidden:currentRide.cockpit.glass.every(g=>!g.visible),near:camera.near,angle:currentRide.cockpit.angle,instruments:{speed:currentRide.cockpit.instruments.speed,rpm:currentRide.cockpit.instruments.rpm,gear:currentRide.cockpit.instruments.gear,visible:currentRide.cockpit.instruments.root.visible},motion:currentRide.cockpit.motion.toArray(),eye:currentRide.cockpit.eye.toArray(),wheel:currentRide.cockpit.rig.node.name},lineupVisible:Object.values(showroom?.cars||{}).filter(c=>c.visible).length,jumpBest:stunts.best,padBoost:+padBoost.timeLeft.toFixed(2),padTriggers:padBoost.triggers,visualRoll:+visual.rotation.z.toFixed(3),deckLean:+(playerActor.deckLean||0).toFixed(3),noticeSerial:stunts.noticeSerial,stuntToastUntil:+stuntToastUntil.toFixed(2),elapsedNow:+elapsed.toFixed(2),jumpLast:stunts.lastDistance,jumpLandings:stunts.landings,activeTrick:playerActor.activeTrick,trickYaw:trickRig.rotation.y,trickRoll:trickRig.rotation.z,lastTrick:playerActor.lastTrick,completedTricks:playerActor.completedTricks,coneColliders:physics.objects.filter(o=>o.userData?.kind==='stunt-cone').length,collisionWidth:currentRide.size.x,collisionLength:currentRide.size.z,wheelCount:currentRide.wheels.length,buildings:world.stats.buildings,placementErrors:world.stats.placementErrors,frameMs:frameAverage,frameStats:frameMetrics.summary(),pixelRatio:renderer.getPixelRatio(),devicePixelRatio,canvasWidth:renderer.domElement.width,drawCalls:renderer.info.render.calls,triangles:renderer.info.render.triangles,inShowroom,nitroIntensity:nitro?.intensity||0,pickups:nitro?.pickups?.filter(p=>p.active).length,collected:nitro?.field.collected||0,showroomAngle:showroom?.angle||0,homeSet:showroom?.backdrop.stats,homeSetVisible:showroom?.root.visible,quality:quality.ratio,fov:camera.fov,propKnocks:streetProps?.knocks||0,looseProps:streetProps?.loose.size||0,tyreSegments:tyreMarks?.segments||0,tyreLast:tyreMarks?.last,parkCount:world.parkPlots?.length||0,lotFill:world.lotFill?.stats,parkedCars:streetCars?.stats.parked});}

function update(dt){if(circuit?.active){updateCircuit(dt);return;}renderState.advance(dt);streetProps?.beforeStep(playerActor,dt);
  const input=drivingControls(keys,touchDriving.state,driveInput),{throttle,reverse,handbrake,boost:boostPressed}=input,turn=input.steer;
  const beforeX=playerActor.x,beforeZ=playerActor.z;cellClock+=dt;if(cellClock>.25){cellClock=0;world.updateVisible?.(playerActor.x,playerActor.z);}
  trafficBudgetClock+=dt;if(trafficBudgetClock>=.2){trafficBudgetClock%=.2;updateTrafficBudget(traffic,playerActor);}
  const steps=physics.step(dt,(fixed)=>{renderState.beginStep();supportGround(playerActor);const surface=surfaceAt(selectedMap,world,playerActor.x,playerActor.z);playerActor.surfaceGrip=surface.grip;playerActor.surfaceDrag=surface.drag;for(const car of traffic)if(car.actor.body.isActive())supportGround(car.actor);stunts.beginStep(playerActor);
    elapsed+=fixed;const forwardSpeed=playerActor.forwardSpeed;steer=smoothSteering(steer,turn,playerActor.speed,fixed);
    const recharge=nitro.collectAt(playerActor,boost);if(recharge>0){boost=fillNitro(boost,recharge);nitroHud.pulse();audio.onPickup();}else if(recharge<0)nitroHud.flash();
    boost=nextBoost(boostGate,boost,!playerActor.isAirborne&&!reverse&&forwardSpeed>2&&boostPressed&&throttle>0,fixed);boosting=boostGate.boosting;if(padBoost.step(playerActor,fixed))audio.onBoostPad?.();const padOn=padBoost.active;
    simControls.throttle=padOn&&!reverse?Math.max(throttle,1):throttle;simControls.reverse=reverse;simControls.steer=steer;simControls.handbrake=handbrake;simControls.boost=boostDemand(boosting,padOn);playerActor.setControls(simControls);
    if(++physicsStepCount%2===0)followTraffic(traffic,playerActor,fixed);
  },fixed=>{stunts.step(playerActor,fixed);supportGround(playerActor);if(stunts.landingImpact>2){impactShake=Math.min(.18,stunts.landingImpact*.009);audio.onImpact(stunts.landingImpact);}});
  renderState.endStep();const simDt=steps*physics.fixedStep;distance+=Math.hypot(playerActor.x-beforeX,playerActor.z-beforeZ);updateTransforms(dt);streetProps?.update(dt,playerActor,{camera,audio});pedestrians?.update(dt,playerActor,{camera,audio});ambient?.update(dt);parkLife?.update(playerActor);
  player.updateMatrixWorld(true);const rear=currentRide.rearWheels;for(let i=0;i<rear.length;i++)rear[i].node.getWorldPosition(rearTyres[i]);if(rear.length===2)tyreMarks?.update(dt,playerActor,rearTyres,handbrake,(x,z)=>surfaceAt(selectedMap,world,x,z));
  nitroFrame.active=boosting||padBoost.active;nitroFrame.speed=playerActor.speed;nitroFrame.time=renderState.time;nitroFrame.position=pos;nitroFrame.heading=player.rotation.y;nitro.update(dt,nitroFrame);nitroHud.update(boost,dt,boosting,boostGate.locked);updateStuntToast();const fxBoost=boosting||padBoost.active;if(fxBoost!==nitroBodyClass){nitroBodyClass=fxBoost;document.body.classList.toggle('nitro-active',fxBoost);}
  updateCamera(dt);if(world.sea)world.sea.material.uniforms.time.value=renderState.time;streetCars?.update(camera.position);
  for(const impact of physics.lastImpacts)if((impact.a===playerActor||impact.b===playerActor)&&impact.speed>2&&elapsed-lastImpact>.15){lastImpact=elapsed;impactShake=Math.min(.13,impact.speed*.009);audio.onImpact(impact.speed);}
  openWorld?.update(dt,playerActor,physics.lastImpacts,pos.y);
  if(rush.active){playerActor.copyState(rushFrame);rushFrame.height=pos.y;rushFrame.width=playerActor.width;rushFrame.airborne=playerActor.isAirborne;rushFrame.crashed=false;for(const impact of physics.lastImpacts)if((impact.a===playerActor||impact.b===playerActor)&&impact.speed>2.5){rushFrame.crashed=true;break;}const result=rush.update(simDt,rushFrame);rushUI.update(dt,paused);if(result){setPause(true);rushUI.showResult();}}
  audio.update(playerActor,throttle,handbrake,boosting||padBoost.active,dt);audio.updateTraffic(traffic,playerActor,dt);
  drawRadar(dt);
  debugClock+=dt;if(debugClock>.1){debugClock=0;writeTelemetry();}
}
function animate(now){
  requestAnimationFrame(animate);const interval=now-last,workStart=performance.now();const dt=Math.min(interval/1000,.25);last=now;if(document.hidden)return;frameAverage=lerp(frameAverage,dt*1000,.04);
  if(ready&&!document.hidden){
    if(!paused)update(dt);else if(inShowroom){homeTime+=dt;ambient?.update(dt);if(garageOpen)garageScene.update(dt);else showroom.update(dt);if(world.sea)world.sea.material.uniforms.time.value=homeTime;}
    // Shadow map is only re-rendered while the world moves (driving or showroom turntable); paused world is static.
    if(!paused||inShowroom){shadowClock+=dt;if(shadowClock>=1/30||renderer.shadowMap.needsUpdate){shadowClock%=1/30;if(!inShowroom)updateSunShadow();renderer.shadowMap.needsUpdate=true;}}
    if((!paused||inShowroom)&&quality.update(frameAverage,dt,gpuTimer.value===null?frameAverage:Math.max(frameMetrics.workMs,gpuTimer.value))){renderInvalid=true;renderer.setPixelRatio(Math.min(devicePixelRatio,quality.ratio));graphics.setSize(innerWidth,innerHeight);}if(quality.starved&&!paused&&graphics.degrade())quality.starved=false;
    if(inShowroom){debugClock+=dt;if(debugClock>.2){debugClock=0;writeTelemetry();}}
  }
  if(ready&&paused&&!inShowroom&&!renderInvalid)return;renderInvalid=false;gpuTimer.poll();gpuTimer.begin();if(renderer.shadowMap.needsUpdate)shadowRenders++;graphics.render(dt);gpuTimer.end();if(ready&&!paused&&!document.hidden)frameMetrics.record(interval,performance.now()-workStart,gpuTimer.value);
}requestAnimationFrame(animate);init();
// ?debug exposes internals for profiling (draw calls, triangles) from the console or automated checks.
if(new URLSearchParams(location.search).has('debug'))window.__game={renderer,scene,camera,graphics};
initElectron({getStats:()=>({map:selectedMap,car:chosen,raceBest:best,jumpBest:stunts.best,jumpLast:stunts.lastDistance,landings:stunts.landings,distanceM:distance}),getState:()=>({ready,paused,home:inShowroom}),setPause,reset});
addEventListener('resize',()=>{renderInvalid=true;camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);renderer.setPixelRatio(Math.min(devicePixelRatio,quality.ratio));graphics.setSize(innerWidth,innerHeight);if(inShowroom&&showroom){if(garageOpen)garageScene.frame();else showroom.frame();}});
