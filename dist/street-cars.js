// Busy streets: kerbside parked cars (one BatchedMesh, per-instance frustum + distance culling, light
// shove-able Planck bodies that sleep) and extra Kenney Car Kit traffic templates. Placement is pure and
// tested (tests/street-cars.test.mjs). Assets: assets/cars/*.glb, Kenney Car Kit 3.1, CC0 (cars-source.json).
import * as THREE from './vendor/three.module.js';
import {STUNT_AREA} from './stunts.js';
import {SUNSET,sunsetDistance,DESTINATIONS} from './map-layout.js';
import {BOOST_PADS} from './boost-pads.js';

// size = authored Kenney units [width,height,length]. paint = [uv cell column,row (8x4 colormap swatches), mean linear luminance].
export const STREET_CAR_MODELS=Object.freeze([
 {name:'cars/sedan-sports',size:[1.3,1.1,2.55],paint:[6,1,.230],weight:3,traffic:true},
 {name:'cars/hatchback-sports',size:[1.3,1.1,2.85],paint:[3,1,.388],weight:3,traffic:true},
 {name:'cars/suv-luxury',size:[1.5,1.3,2.85],paint:[4,1,.571],weight:3,traffic:true},
 {name:'cars/van',size:[1.5,1.35,2.75],paint:[7,1,.244],weight:2,traffic:true},
 {name:'cars/truck',size:[1.5,1.3,2.95],paint:[3,1,.388],weight:2,traffic:true},
 {name:'cars/delivery',size:[1.5,1.65,3.25],paint:[3,1,.388],weight:1.2,traffic:true},
 {name:'cars/police',size:[1.5,1.3,3.1],paint:null,weight:.5,traffic:true},
 {name:'cars/ambulance',size:[1.5,1.8,3.25],paint:null,weight:.3,traffic:true},
 {name:'cars/garbage-truck',size:[1.6,1.6,3.45],paint:null,weight:.4},
]);
export const STREET_CAR_ASSETS=STREET_CAR_MODELS.map(m=>m.name);
// Same 1.65 game-metres per Kenney unit as the existing sedan/suv/taxi traffic (4.4 m / 2.55 units ≈ 1.7).
export const TRAFFIC_EXTRA=STREET_CAR_MODELS.filter(m=>m.traffic).map(m=>[m.name,+(m.size[2]*1.65).toFixed(2)]);
/** Traffic cars per route: ~1.5x the original 9/6/4 on the Coast. */
export const trafficPerRoute=r=>r<2?14:r<4?9:6;
// Coastal street palette (sRGB). null keeps the authored Kenney paint.
export const PAINTS=Object.freeze([null,null,null,0xe9e9e4,0xe9e9e4,0xa8acb2,0xa8acb2,0x1c1e21,0x1c1e21,0x4a4e55,0x9e1f1b,0x203658,0x6b96c0,0xc6b28d,0x2e4a3b,0x5a1a25,0xd5ae3a]);

const GRID={roadsX:[-450,-300,-150,0,150,300,450],roadsZ:[-600,-450,-300,-150,0,150,300,450,600]};
const GATES={grid:[[-450,-450],[-300,-600],[0,-450],[450,-150],[300,450],[-450,450]]};

/** Kerb stretches (road edge segments clear of intersections/crosswalks), avoid zones and per-map tuning. */
export function kerbLayout(map){
 const kerbs=[],avoid=[];
 const coast=map==='coast',{roadsX,roadsZ}=GRID;
 const halfX=x=>coast&&x===0?17:12,halfZ=z=>coast&&z===-300?17:12,CLEAR=12;
 for(const x of roadsX)for(let j=0;j<roadsZ.length-1;j++)for(const side of [-1,1]){
  if((x===roadsX[0]&&side<0)||(x===roadsX[roadsX.length-1]&&side>0))continue; // shoreline / outer promenade
  kerbs.push({axis:'z',c:x,side,half:halfX(x),from:roadsZ[j]+halfZ(roadsZ[j])+CLEAR,to:roadsZ[j+1]-halfZ(roadsZ[j+1])-CLEAR});
 }
 for(const z of roadsZ)for(let i=0;i<roadsX.length-1;i++)for(const side of [-1,1]){
  if((z===roadsZ[0]&&side<0)||(z===roadsZ[roadsZ.length-1]&&side>0))continue;
  kerbs.push({axis:'x',c:z,side,half:halfZ(z),from:roadsX[i]+halfX(roadsX[i])+CLEAR,to:roadsX[i+1]-halfX(roadsX[i+1])-CLEAR});
 }
 for(const d of DESTINATIONS)avoid.push({x:d.x,z:d.z,r:30,why:'spawn'});
 for(const [x,z] of GATES.grid)avoid.push({x,z,r:20,why:'gate'});
 for(const p of BOOST_PADS)avoid.push({x:p.x,z:p.z,r:16,why:'boost-pad'});
 avoid.push({x:171,z:165,r:12,why:'roadworks'});
 const m=6,rects=[{minX:STUNT_AREA.left-m,maxX:STUNT_AREA.right+m,minZ:STUNT_AREA.top-m,maxZ:STUNT_AREA.bottom+m,why:'stunt-park'}];
 return {map,kerbs,avoid,rects,sunset:coast,scale:1.5,inset:.2,occupancy:.4,maxCars:250,gap:[18,34],cullDistance:420};
}

function pickModel(models,random){let total=0;for(const m of models)total+=m.weight;let t=random()*total;for(const m of models){t-=m.weight;if(t<=0)return m;}return models[models.length-1];}

/** Pure placement. Returns [{x,z,heading,width,length,height,model,paint}] in world metres (heading 0 faces -z). */
export function planParkedCars({map='coast',random=Math.random,extraAvoid=[]}={}){
 if(map!=='coast')return [];const layout=kerbLayout(map),models=STREET_CAR_MODELS,cars=[];
 const avoid=[...layout.avoid,...extraAvoid];
 const blocked=(x,z,l)=>avoid.some(a=>Math.hypot(x-a.x,z-a.z)<a.r+l/2)||layout.rects.some(r=>x>r.minX-l/2&&x<r.maxX+l/2&&z>r.minZ-l/2&&z<r.maxZ+l/2)||(layout.sunset&&sunsetDistance(x,z)<SUNSET.width/2+SUNSET.sidewalk+8+l/2);
 for(const k of layout.kerbs){
  if(random()>=layout.occupancy)continue;
  let s=k.from+random()*8;
  while(cars.length<layout.maxCars){
   const model=pickModel(models,random),[w,h,l]=model.size.map(v=>v*layout.scale);
   if(s+l>k.to)break;
   const along=s+l/2,off=k.c+k.side*(k.half-layout.inset-w/2-random()*.12);
   const x=k.axis==='z'?off:along,z=k.axis==='z'?along:off;
   // Right-hand traffic: park facing the flow of the nearside lane.
   const heading=(k.axis==='z'?(k.side>0?0:Math.PI):(k.side>0?-Math.PI/2:Math.PI/2))+(random()-.5)*.05;
   if(!blocked(x,z,l))cars.push({x,z,heading,width:w,length:l,height:h,model:model.name,paint:model.paint?PAINTS[Math.floor(random()*PAINTS.length)]:null,kerb:k});
   s+=l+layout.gap[0]+random()*layout.gap[1];
  }
 }
 return cars;
}

// ---- Rendering + physics (browser) ----
/** Turns a static physics.addBox actor into a light dynamic body (≈1150 kg, heavy damping) that sleeps at rest. */
export function makeShoveable(actor,{width,length},mass=1150){const body=actor.body;body.setDynamic();actor.fixture.setDensity(mass/(width*length));body.resetMassData();body.setLinearDamping(2.4);body.setAngularDamping(3.2);body.setSleepingAllowed(true);body.setAwake(false);return actor;}
const PAINT_SHADER_KEY='street-car-paint-v1';
function paintMaterial(source){
 const material=new THREE.MeshStandardMaterial({map:source.map,roughness:.5,metalness:.15});
 material.onBeforeCompile=shader=>{
  shader.vertexShader=shader.vertexShader.replace('#include <color_pars_vertex>','#include <color_pars_vertex>\nattribute float paintMask;\nvarying float vPaintMask;').replace('#include <color_vertex>','#include <color_vertex>\nvPaintMask=paintMask;');
  // Recolour only body-paint swatch texels: keep the swatch's shading gradient (luminance), swap the hue.
  shader.fragmentShader=shader.fragmentShader.replace('#include <color_pars_fragment>','#include <color_pars_fragment>\nvarying float vPaintMask;').replace('#include <color_fragment>',`#if defined( USE_COLOR )
  if(vPaintMask>0.0&&dot(vColor,vec3(1.0))<2.995){float lum=dot(diffuseColor.rgb,vec3(.2126,.7152,.0722));diffuseColor.rgb=vColor*clamp(lum*vPaintMask,.35,1.6);}
#endif`);
 };
 material.customProgramCacheKey=()=>PAINT_SHADER_KEY;
 return material;
}
// Bake one model (body + static wheels + parts) into a single indexed geometry facing -z, centred, base at y=0.
function bakeModel(root,def,scale){
 root.updateMatrixWorld(true);const inverse=new THREE.Matrix4().copy(root.matrixWorld).invert(),parts=[];let map=null;
 root.traverse(o=>{if(!o.isMesh)return;map=map||o.material?.map||null;const g=o.geometry,rel=new THREE.Matrix4().multiplyMatrices(inverse,o.matrixWorld);parts.push({g,rel});});
 let vertices=0,indices=0;for(const {g} of parts){vertices+=g.attributes.position.count;indices+=g.index?g.index.count:g.attributes.position.count;}
 const pos=new Float32Array(vertices*3),nor=new Float32Array(vertices*3),uv=new Float32Array(vertices*2),mask=new Float32Array(vertices),index=new Uint32Array(indices),v=new THREE.Vector3(),nm=new THREE.Matrix3();
 let vo=0,io=0;
 for(const {g,rel} of parts){
  nm.getNormalMatrix(rel);const P=g.attributes.position,N=g.attributes.normal,U=g.attributes.uv;
  for(let i=0;i<P.count;i++){
   v.fromBufferAttribute(P,i).applyMatrix4(rel);pos.set([v.x,v.y,v.z],(vo+i)*3);
   if(N){v.fromBufferAttribute(N,i).applyMatrix3(nm).normalize();nor.set([v.x,v.y,v.z],(vo+i)*3);}
   if(U){const u=U.getX(i),w=U.getY(i);uv[(vo+i)*2]=u;uv[(vo+i)*2+1]=w;if(def.paint&&Math.floor(u*8)===def.paint[0]&&Math.floor(w*4)===def.paint[1])mask[vo+i]=1/def.paint[2];}
  }
  if(g.index)for(let i=0;i<g.index.count;i++)index[io+i]=g.index.getX(i)+vo;else for(let i=0;i<P.count;i++)index[io+i]=i+vo;
  io+=g.index?g.index.count:P.count;vo+=P.count;
 }
 const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(pos,3));geometry.setAttribute('normal',new THREE.BufferAttribute(nor,3));geometry.setAttribute('uv',new THREE.BufferAttribute(uv,2));geometry.setAttribute('paintMask',new THREE.BufferAttribute(mask,1));geometry.setIndex(new THREE.BufferAttribute(index,1));
 geometry.computeBoundingBox();const b=geometry.boundingBox,c=b.getCenter(new THREE.Vector3());
 // Kenney cars face +z; gameplay forward is -z.
 geometry.translate(-c.x,-b.min.y,-c.z);geometry.rotateY(Math.PI);geometry.scale(scale,scale,scale);geometry.computeBoundingBox();geometry.computeBoundingSphere();
 return {geometry,map};
}

/**
 * Builds parked cars for Solana Coast. Returns {mesh,cars,update(cameraPosition),stats}.
 * Physics: light dynamic Planck boxes (sleep when still) so the player can shove them; static if dynamic=false.
 */
export function buildStreetCars({scene,physics,models,map,random=Math.random,world,extraAvoid=[],extraCars=[],dynamic=true}){
 const layout=kerbLayout(map),plan=[...planParkedCars({map,random,extraAvoid}),...extraCars];
 const used=[...new Set(plan.map(c=>c.model))].filter(n=>models[n]);
 const baked=new Map(used.map(name=>[name,bakeModel(models[name],STREET_CAR_MODELS.find(m=>m.name===name),layout.scale)]));
 const cars=plan.filter(c=>baked.has(c.model));
 if(!cars.length)return {mesh:null,cars,update(){},stats:{parked:0}};
 let vertexCount=0,indexCount=0,triangles=0;for(const {geometry} of baked.values()){vertexCount+=geometry.attributes.position.count;indexCount+=geometry.index.count;}
 const material=paintMaterial({map:[...baked.values()].find(b=>b.map)?.map||null});
 const mesh=new THREE.BatchedMesh(cars.length,vertexCount,indexCount,material);mesh.name='ParkedCars';mesh.castShadow=true;mesh.receiveShadow=true;mesh.sortObjects=false;
 const geometryIds=new Map();for(const [name,{geometry}] of baked)geometryIds.set(name,mesh.addGeometry(geometry));
 const matrix=new THREE.Matrix4(),quat=new THREE.Quaternion(),posV=new THREE.Vector3(),one=new THREE.Vector3(1,1,1),yAxis=new THREE.Vector3(0,1,0),color=new THREE.Color();
 const write=(id,x,z,heading,y=.02)=>{posV.set(x,y,z);quat.setFromAxisAngle(yAxis,heading);mesh.setMatrixAt(id,matrix.compose(posV,quat,one));};
 const obstacles=world?.obstacles;
 for(const car of cars){
  const id=mesh.addInstance(geometryIds.get(car.model));car.instance=id;write(id,car.x,car.z,car.heading,car.ground??.02);
  if(car.paint==null)color.setRGB(1,1,1);else color.set(car.paint);mesh.setColorAt(id,color);
  triangles+=baked.get(car.model).geometry.index.count/3;
  const actor=physics.addBox({x:car.x,z:car.z,heading:car.heading,width:car.width*.96,length:car.length*.97,friction:.4,restitution:.05,userData:{kind:'parked-car'}});
  actor.minY=car.ground||0;actor.maxY=car.height+(car.ground||0);car.actor=actor;
  if(dynamic)makeShoveable(actor,car);
  obstacles?.push({box:new THREE.Box3(new THREE.Vector3(car.x-car.length/2,0,car.z-car.length/2),new THREE.Vector3(car.x+car.length/2,car.height,car.z+car.length/2)),actor});
 }
 scene.add(mesh);
 const cull=layout.cullDistance,cull2=cull*cull;let frame=0;const shown=cars.map(()=>true);
 function update(cameraPosition){
  if(dynamic)for(const car of cars){const body=car.actor.body;if(!body.isAwake())continue;const p=body.getPosition();const onCourt=car.lot&&world?.lotFill?.courts.some(c=>p.x>=c.minX&&p.x<=c.maxX&&p.y>=c.minZ&&p.y<=c.maxZ),ground=onCourt?.14:.02;write(car.instance,p.x,p.y,-body.getAngle(),ground);car.actor.minY=ground;car.actor.maxY=ground+car.height;car.moved=true;}
  // Distance cull (fog hides them anyway) every 12 frames; BatchedMesh already frustum-culls per instance.
  if(cameraPosition&&cull<Infinity&&++frame%12===0)for(let i=0;i<cars.length;i++){const car=cars[i],p=dynamic&&car.moved?car.actor.body.getPosition():null,x=p?p.x:car.x,z=p?p.y:car.z,vis=(x-cameraPosition.x)**2+(z-cameraPosition.z)**2<cull2;if(vis!==shown[i]){shown[i]=vis;mesh.setVisibleAt(car.instance,vis);}}
 }
 return {mesh,cars,update,stats:{parked:cars.length,models:baked.size,trianglesTotal:triangles,dynamic}};
}
