import * as THREE from 'three';
// CC0 PBR ground surfaces (sources: assets/surfaces/surfaces-source.json). One shared material per surface type;
// colour = target albedo, the photo map only supplies normalised detail. Fetches per pixel: map (x2 when antiTile) + normalMap.
// uvMetres: metres per UV unit of the geometry (world tiled slabs use x/3, the beach ring x/6). tile: metres per texture repeat.
// avg: mean sRGB of each colour map (used to normalise detail around 1.0). noise: metres per macro variation blob.
const SURFACES={
  lawn:{map:'surfaces/lawn-color.jpg',normal:'surfaces/lawn-normal.jpg',avg:[101,132,44],tile:3.5,uvMetres:3,color:0x5a6b3a,dry:0x948d55,dryAmount:.5,contrast:1.6,saturation:.5,variation:.25,noise:26,antiTile:true,normalScale:.8,roughness:.96},
  sidewalk:{map:'surfaces/sidewalk-color.jpg',normal:'surfaces/sidewalk-normal.jpg',avg:[128,117,102],tile:4,uvMetres:3,color:0xa29e94,dry:0x948e82,dryAmount:.25,contrast:1.7,saturation:.3,variation:.12,noise:18,antiTile:false,normalScale:1.3,roughness:.88},
  plaza:{map:'la-real/concrete-diffuse.jpg',normal:'la-real/concrete-normal.jpg',avg:[120,110,91],tile:6,uvMetres:3,color:0x99968e,dry:0x8c877c,dryAmount:.3,contrast:.9,saturation:.3,variation:.18,noise:24,antiTile:true,normalScale:.7,roughness:.85},
  sand:{map:'surfaces/sand-color.jpg',normal:'surfaces/sand-normal.jpg',avg:[148,128,99],tile:5,uvMetres:6,color:0xcfbc95,dry:0xe0d3b2,dryAmount:.35,contrast:1.3,saturation:.5,variation:.15,noise:30,antiTile:true,normalScale:.6,roughness:.97,side:THREE.DoubleSide}
};
const NOISE=`float surfaceHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float surfaceNoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(surfaceHash(i),surfaceHash(i+vec2(1,0)),f.x),mix(surfaceHash(i+vec2(0,1)),surfaceHash(i+1.),f.x),f.y);}
uniform vec3 surfaceAvg,surfaceDry,surfaceDetail;uniform vec2 surfaceNoiseDry;
void main(){`;
// vMapUv is in texture tiles; noise coordinates are tiles * (tile/noise metres). A second rotated, non-integer-scaled map
// sample is cross-faded by noise on organic surfaces so the 3-5 m tile never reads as a grid at distance.
const MAP_FRAGMENT=`#ifdef USE_MAP
vec2 surfaceUv=vMapUv*surfaceNoiseDry.x;float surfaceN=surfaceNoise(surfaceUv)*.65+surfaceNoise(surfaceUv*3.7+17.)*.35;
vec3 surfaceTex=texture2D(map,vMapUv).rgb;
#ifdef SURFACE_ANTI_TILE
surfaceTex=mix(surfaceTex,texture2D(map,mat2(.8,-.6,.6,.8)*vMapUv*.71+vec2(.31,.57)).rgb,smoothstep(.3,.7,surfaceNoise(surfaceUv*2.3+5.)));
#endif
vec3 surfaceD=surfaceTex/surfaceAvg;surfaceD=mix(vec3(dot(surfaceD,vec3(.2126,.7152,.0722))),surfaceD,surfaceDetail.y);surfaceD=mix(vec3(1.),surfaceD,surfaceDetail.x);
diffuseColor.rgb=mix(diffuseColor.rgb,surfaceDry,smoothstep(.45,.85,surfaceN)*surfaceNoiseDry.y)*surfaceD*(1.+(surfaceN-.5)*surfaceDetail.z);
#endif`;
const linear=c=>new THREE.Color().setRGB(c[0]/255,c[1]/255,c[2]/255,THREE.SRGBColorSpace);
const cache=new Map();let loader;
async function create(name,anisotropy){
  const s=SURFACES[name];loader??=new THREE.TextureLoader();
  const [map,normalMap]=await Promise.all([s.map,s.normal].map(file=>loader.loadAsync(`assets/${file}`)));
  map.colorSpace=THREE.SRGBColorSpace;
  for(const t of [map,normalMap]){t.wrapS=t.wrapT=THREE.RepeatWrapping;t.repeat.setScalar(s.uvMetres/s.tile);t.anisotropy=anisotropy;t.generateMipmaps=true;t.minFilter=THREE.LinearMipmapLinearFilter;}
  const material=new THREE.MeshStandardMaterial({map,normalMap,normalScale:new THREE.Vector2(s.normalScale,s.normalScale),color:s.color,roughness:s.roughness,metalness:0,side:s.side??THREE.FrontSide});
  const avg=linear(s.avg),dry=new THREE.Color(s.dry);
  const uniforms={surfaceAvg:{value:new THREE.Vector3(avg.r,avg.g,avg.b)},surfaceDry:{value:new THREE.Vector3(dry.r,dry.g,dry.b)},surfaceDetail:{value:new THREE.Vector3(s.contrast,s.saturation,s.variation)},surfaceNoiseDry:{value:new THREE.Vector2(s.tile/s.noise,s.dryAmount)}};
  material.onBeforeCompile=shader=>{Object.assign(shader.uniforms,uniforms);shader.fragmentShader=shader.fragmentShader.replace('void main() {',NOISE).replace('#include <map_fragment>',MAP_FRAGMENT);};
  // All surfaces share one program per anti-tile variant; uniforms stay per material.
  material.customProgramCacheKey=()=>'roadster-surface-'+s.antiTile;
  if(s.antiTile)material.defines={SURFACE_ANTI_TILE:''};
  material.name='surface-'+name;material.userData.worldTiled=s.uvMetres===3;material.userData.surfaceType=name;material.userData.surfaceUniforms=uniforms;
  return material;
}
// Cached per page: every mesh of a surface type shares this one material (and its two textures).
export function surfaceMaterial(name,anisotropy=8){if(!SURFACES[name])throw new Error(`Unknown surface ${name}`);if(!cache.has(name))cache.set(name,create(name,anisotropy).catch(error=>{cache.delete(name);throw error;}));return cache.get(name);}
export const SURFACE_TYPES=Object.keys(SURFACES);
