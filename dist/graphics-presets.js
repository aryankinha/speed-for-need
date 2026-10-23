import * as THREE from './vendor/three.module.js';

// Graphics presets. Budget target: 60 FPS on integrated laptop GPUs at 'medium'.
// ratio = max render pixel ratio (RenderQuality adapts below it), smaa = postprocessing SMAAPreset (0 low .. 3 ultra), sharpen = CAS strength that restores detail lost to upscaling and SMAA, ao = N8AO mode (null, 'half', 'full'), crowd = pedestrian pool size (pedestrians.js).
export const GRAPHICS_PRESETS={
  low:{label:'Low',ratio:1,minRatio:.75,shadowMap:1024,ao:null,bloom:false,smaa:1,anisotropy:4,clearcoat:false,sharpen:.3,crowd:12},
  medium:{label:'Medium',ratio:1.5,minRatio:1,shadowMap:2048,ao:'half',aoQuality:'Performance',bloom:true,smaa:2,anisotropy:8,clearcoat:true,sharpen:.35,crowd:28},
  high:{label:'High',ratio:2,minRatio:1.25,shadowMap:2048,ao:'full',aoQuality:'Medium',bloom:true,smaa:2,anisotropy:16,clearcoat:true,sharpen:.25,crowd:44},
  ultra:{label:'Ultra',ratio:2,minRatio:1.5,shadowMap:4096,ao:'full',aoQuality:'High',bloom:true,smaa:3,anisotropy:16,clearcoat:true,sharpen:.2,crowd:60}
};
export const GRAPHICS_KEY='speed-for-need-graphics';
const WEAK_GPU=/swiftshader|llvmpipe|software|mali|adreno|powervr|videocore|intel\(r\) (hd|uhd) graphics [2-6]\d\d\b|intel.*hd graphics/i;
const INTEGRATED_GPU=/intel|apple|iris|uhd|vega \d|radeon\(tm\) graphics|radeon graphics/i;
const DISCRETE_GPU=/nvidia|geforce|rtx|gtx|quadro|radeon rx|radeon pro|arc a\d/i;

/** Picks a preset from the unmasked GPU name and screen size. Pure, so tests can cover it. */
export function detectPreset({gpu='',cores=4,memory=4,mobile=false,pixels=1920*1080}={}){
  const name=String(gpu);
  if(mobile||WEAK_GPU.test(name)||cores<=2||memory<=2)return 'low';
  if(DISCRETE_GPU.test(name))return pixels>2560*1440?'high':'ultra';
  if(/apple m\d (pro|max|ultra)/i.test(name))return 'high';
  if(INTEGRATED_GPU.test(name))return 'medium';
  return 'medium';
}
export function readGpuName(gl){try{const ext=gl.getExtension('WEBGL_debug_renderer_info');return ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER);}catch{return '';}}
export function resolvePreset(stored,detected){return stored&&GRAPHICS_PRESETS[stored]?stored:detected;}

/** Upgrades a car-body material to a clear-coated physical paint in place of the original instance list. */
export function toCarPaint(material){
  if(!material?.isMeshStandardMaterial||material.isMeshPhysicalMaterial)return material;
  const paint=new THREE.MeshPhysicalMaterial();THREE.MeshStandardMaterial.prototype.copy.call(paint,material);paint.defines={STANDARD:'',PHYSICAL:''};
  paint.clearcoat=1;paint.clearcoatRoughness=.06;paint.roughness=THREE.MathUtils.clamp(paint.roughness,.28,.5);paint.metalness=Math.max(paint.metalness,.35);paint.envMapIntensity=1.15;paint.userData.carPaint=true;return paint;
}
