import * as THREE from 'three';

// Procedural downtown towers: stepped podium + curtain-wall shaft + setbacks + rooftop plant, built from boxes so the facade UVs
// are exact (metres / tile size). The tower pool is used by Solana Coast (world.js).
//
// Draw-call design: one shared material per facade style (4), one for the lit storefront podium and one flat trim material, so
// the static batcher (mergeGeometries per cell and material) merges every tower of a style into the same buffer. Variety comes from
// per-vertex colour tints, never from per-building materials. All geometry is indexed with position/normal/uv/color so the
// batch key (attribute list) is identical for every piece that shares a material.
//
// Textures are original generated work (scripts/make-facades.mjs, CC0). Tile = 12 m wide (3 bays of 4 m) x 14.4 m tall (4 floors
// of 3.6 m); the storefront tile is 12 x 7.2 m. Tower widths are multiples of 4 m and heights multiples of 3.6 m, so bays and floors
// close exactly at corners and roofs.
const TILE_W=12,TILE_H=14.4,STORE_H=7.2,FLOOR=3.6,BAY=4;
export const FACADE_STYLES=[
  {name:'glass-blue',metalness:.35,envMapIntensity:1.5,tints:[[1,1,1],[.92,1,1.08],[1.05,1.02,.98]]},
  {name:'glass-teal',metalness:.4,envMapIntensity:1.5,tints:[[1,1,1],[.95,1.08,1.02],[1.08,1.02,.95]]},
  {name:'concrete-warm',metalness:.04,envMapIntensity:1,tints:[[1,1,1],[.93,.92,.95],[1.05,.97,.88],[.9,.86,.8]]},
  {name:'stone-cream',metalness:.04,envMapIntensity:1,tints:[[1,1,1],[1.04,.94,.86],[.9,.93,.97],[.96,.9,.82]]},
];
const TRIM_COLOURS=[[.34,.35,.37],[.5,.48,.45],[.24,.25,.27],[.62,.6,.56]];
const cache=new Map();

async function loadMaterials(anisotropy){
  if(cache.has(anisotropy))return cache.get(anisotropy);
  const loader=new THREE.TextureLoader(),base='assets/facades/';
  const load=async(file,srgb)=>{const t=await loader.loadAsync(base+file);t.wrapS=t.wrapT=THREE.RepeatWrapping;t.anisotropy=anisotropy;if(srgb)t.colorSpace=THREE.SRGBColorSpace;return t;};
  const entries=await Promise.all(FACADE_STYLES.map(async s=>{const [map,rough]=await Promise.all([load(s.name+'-color.jpg',true),load(s.name+'-rough.jpg',false)]);return new THREE.MeshStandardMaterial({map,roughnessMap:rough,roughness:1,metalness:s.metalness,envMapIntensity:s.envMapIntensity,vertexColors:true});}));
  const [sMap,sRough,sEmit]=await Promise.all([load('storefront-color.jpg',true),load('storefront-rough.jpg',false),load('storefront-emissive.jpg',true)]);
  const store=new THREE.MeshStandardMaterial({map:sMap,roughnessMap:sRough,roughness:1,metalness:.1,emissiveMap:sEmit,emissive:new THREE.Color(1,1,1),emissiveIntensity:.8,vertexColors:true});
  const trim=new THREE.MeshStandardMaterial({roughness:.82,metalness:.05,vertexColors:true});
  const result={facade:entries,store,trim};cache.set(anisotropy,result);return result;
}

// Geometry accumulator for one material.
class Builder{
  constructor(){this.p=[];this.n=[];this.uv=[];this.c=[];this.i=[];}
  quad(a,b,c,d,normal,uvs,colour){const o=this.p.length/3;for(const v of [a,b,c,d]){this.p.push(v[0],v[1],v[2]);this.n.push(normal[0],normal[1],normal[2]);this.c.push(colour[0],colour[1],colour[2]);}for(const t of uvs)this.uv.push(t[0],t[1]);this.i.push(o,o+1,o+2,o,o+2,o+3);}
  geometry(){const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(this.p,3));g.setAttribute('normal',new THREE.Float32BufferAttribute(this.n,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(this.uv,2));g.setAttribute('color',new THREE.Float32BufferAttribute(this.c,3));g.setIndex(this.i);g.computeBoundingBox();g.computeBoundingSphere();return g;}
}

// Four wall quads (texture mapped in metres from each wall's left edge as seen from outside) plus a trim roof cap.
function box(sides,roof,{x,z,w,d,y0,y1,tint,roofColour,tileH}){
  const hx=w/2,hz=d/2,v0=y0/tileH,v1=y1/tileH,uw=w/TILE_W,ud=d/TILE_W;
  const walls=[
    [[x-hx,z+hz],[x+hx,z+hz],[0,0,1],uw],
    [[x+hx,z-hz],[x-hx,z-hz],[0,0,-1],uw],
    [[x+hx,z+hz],[x+hx,z-hz],[1,0,0],ud],
    [[x-hx,z-hz],[x-hx,z+hz],[-1,0,0],ud],
  ];
  for(const [l,r,n,u] of walls)sides.quad([l[0],y0,l[1]],[r[0],y0,r[1]],[r[0],y1,r[1]],[l[0],y1,l[1]],n,[[0,v0],[u,v0],[u,v1],[0,v1]],tint);
  if(roof)roof.quad([x-hx,y1,z+hz],[x+hx,y1,z+hz],[x+hx,y1,z-hz],[x-hx,y1,z-hz],[0,1,0],[[0,0],[0,0],[0,0],[0,0]],roofColour);
}

function design(rand,minH,maxH){
  const pick=a=>a[Math.floor(rand()*a.length)],int=(a,b)=>a+Math.floor(rand()*(b-a+1));
  const podW=pick([28,32,36,40]),podD=pick([28,32,36,40]);
  const floors=Math.max(12,Math.round((minH+rand()*(maxH-minH)-STORE_H)/FLOOR));
  const style=Math.floor(rand()*FACADE_STYLES.length),tints=FACADE_STYLES[style].tints,tint=pick(tints),trim=pick(TRIM_COLOURS);
  const kind=pick(['stepped','slab','twin','crown']);
  const tiers=[]; // each {x,z,w,d,f0,f1} in floors above the podium
  if(kind==='stepped'){const w=podW-4,d=podD-4,a=Math.round(floors*.55),b=Math.round(floors*.82);tiers.push({x:0,z:0,w,d,f0:0,f1:a},{x:0,z:0,w:w-8,d:d-8,f0:a,f1:b},{x:0,z:0,w:Math.max(12,w-16),d:Math.max(12,d-16),f0:b,f1:floors});}
  else if(kind==='slab'){const long=pick([32,36,40]),short=pick([16,20,24]),flip=rand()<.5;tiers.push({x:0,z:0,w:flip?long:short,d:flip?short:long,f0:0,f1:floors});}
  else if(kind==='twin'){const w=int(4,5)*4,d=int(4,5)*4;const h2=Math.round(floors*(.65+rand()*.15));tiers.push({x:-(podW/2-w/2-2),z:-(podD/2-d/2-2),w,d,f0:0,f1:floors},{x:podW/2-w/2-2,z:podD/2-d/2-2,w,d,f0:0,f1:h2});}
  else{const w=podW-4,d=podD-4,a=Math.round(floors*.8);tiers.push({x:0,z:0,w,d,f0:0,f1:a},{x:0,z:0,w:w-12,d:d-12,f0:a,f1:floors});}
  const roofBoxes=[],tops=tiers.filter(t=>t.f1===floors||t.f1===Math.max(...tiers.map(q=>q.f1)));
  for(const t of tops){const n=int(1,3);for(let k=0;k<n;k++){const bw=pick([4,6,8]),bd=pick([4,6]),bh=pick([2.4,3.2,4.8]);roofBoxes.push({x:t.x+(rand()-.5)*Math.max(0,t.w-bw-6),z:t.z+(rand()-.5)*Math.max(0,t.d-bd-6),w:bw,d:bd,h:bh,y:(t.f1)*FLOOR+STORE_H+.9});}}
  const mast=rand()<.6?{x:tops[0].x+(rand()-.5)*4,z:tops[0].z+(rand()-.5)*4,h:pick([10,16,24])}:null;
  return {style,tint,trim,kind,podW,podD,tiers,roofBoxes,mast,bandEvery:pick([8,10,12]),floors};
}

function build(spec,materials){
  const sides=new Builder(),store=new Builder(),trim=new Builder(),colour=spec.trim,dark=colour.map(v=>v*.7);
  // Lit double-height podium (storefront), cornice and podium roof.
  box(store,trim,{x:0,z:0,w:spec.podW,d:spec.podD,y0:0,y1:STORE_H,tint:[1,1,1],roofColour:dark,tileH:STORE_H});
  box(trim,trim,{x:0,z:0,w:spec.podW+1.4,d:spec.podD+1.4,y0:STORE_H,y1:STORE_H+.9,tint:colour,roofColour:dark,tileH:1});
  for(const t of spec.tiers){
    // The shaft starts at STORE_H (a floor boundary) so floors continue unbroken; the cornice sits just proud of the wall.
    const base=STORE_H+t.f0*FLOOR,top=STORE_H+t.f1*FLOOR;
    box(sides,trim,{x:t.x,z:t.z,w:t.w,d:t.d,y0:base,y1:top,tint:spec.tint,roofColour:dark,tileH:TILE_H});
    // Parapet lip and horizontal bands every N floors give each tier its stripes.
    box(trim,trim,{x:t.x,z:t.z,w:t.w+.8,d:t.d+.8,y0:top,y1:top+.9,tint:colour,roofColour:dark,tileH:1});
    for(let f=t.f0+spec.bandEvery;f<t.f1-2;f+=spec.bandEvery)box(trim,trim,{x:t.x,z:t.z,w:t.w+.8,d:t.d+.8,y0:STORE_H+f*FLOOR-.45,y1:STORE_H+f*FLOOR+.45,tint:colour,roofColour:colour,tileH:1});
  }
  for(const b of spec.roofBoxes)box(trim,trim,{x:b.x,z:b.z,w:b.w,d:b.d,y0:b.y,y1:b.y+b.h,tint:dark.map(v=>v*1.2),roofColour:dark,tileH:1});
  if(spec.mast){const top=Math.max(...spec.tiers.map(t=>STORE_H+t.f1*FLOOR))+.9;box(trim,trim,{x:spec.mast.x,z:spec.mast.z,w:.7,d:.7,y0:top,y1:top+spec.mast.h,tint:[.2,.2,.22],roofColour:[.2,.2,.22],tileH:1});}
  const group=new THREE.Group();
  for(const [builder,material] of [[sides,materials.facade[spec.style]],[store,materials.store],[trim,materials.trim]]){const mesh=new THREE.Mesh(builder.geometry(),material);mesh.castShadow=true;mesh.receiveShadow=true;group.add(mesh);}
  return group;
}

/** Returns {template,tall:true}[] ready to push into a world's building template list. Uses its own PRNG, so the world's seeded layout is untouched. */
export async function facadeTowerTemplates({count=8,minHeight=70,maxHeight=130,anisotropy=4,seed=90210}={}){
  const materials=await loadMaterials(anisotropy);
  let s=seed>>>0;const rand=()=>{s=(s+0x6D2B79F5)>>>0;let t=s;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return((t^(t>>>14))>>>0)/4294967296;};
  const out=[];
  for(let i=0;i<count;i++){const spec=design(rand,minHeight,maxHeight);spec.style=i%FACADE_STYLES.length; // guarantee every style appears
    spec.tint=FACADE_STYLES[spec.style].tints[Math.floor(rand()*FACADE_STYLES[spec.style].tints.length)];out.push({template:build(spec,materials),tall:true});}
  return out;
}
