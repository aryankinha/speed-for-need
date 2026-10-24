// Offline exact reproduction of the seeded Coast builder, using geometry only.
// ASSET_TOOLS must contain @napi-rs/canvas. No runtime canvas or Node dependency.
// node --loader ./scripts/offline-three-loader.mjs scripts/bake-building-colliders.mjs
import * as T from '../dist/vendor/three.module.js';
import {createRequire} from 'node:module';import {join} from 'node:path';import {fileURLToPath} from 'node:url';import {writeFile} from 'node:fs/promises';
import {loadVehicleGeometry} from '../tests/helpers/vehicle-glb.mjs';
import {COAST_MODELS,SHARED_MODELS} from '../dist/model-catalog.js';
import {buildWorld} from '../dist/world.js';import {exportBuildingProfiles,buildingProfileStats} from '../dist/building-colliders.js';
const require=createRequire(join(process.env.ASSET_TOOLS||'/tmp/roadster-perf-tools','package.json')),{createCanvas}=require('@napi-rs/canvas');
globalThis.document={createElement(type){if(type==='canvas')return createCanvas(1,1);throw Error('Unsupported offline element '+type);}};
T.TextureLoader.prototype.loadAsync=async function(){return new T.Texture();};
const models={};for(const name of [...new Set([...COAST_MODELS,...SHARED_MODELS])])models[name]=await loadVehicleGeometry(name);
const scene=new T.Scene(),objects=[];const physics={objects,addBox(options){const a={...options,userData:options.userData};objects.push(a);return a;},addPolygon(options){return this.addBox(options);},addCompound(options){return this.addBox(options);}};
let seed=5279;const random=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};
const start=performance.now(),world=await buildWorld({scene,physics,models,random});
const data=exportBuildingProfiles();data.stats={profiles:Object.keys(data.profiles).length,compiled:buildingProfileStats.compiled,buildings:world.stats.buildings,fixtures:objects.reduce((n,a)=>n+(a.parts?.length||0),0)};
const path=fileURLToPath(new URL('../dist/assets/building-colliders.json',import.meta.url));await writeFile(path,JSON.stringify(data)+'\n');console.log({seconds:(performance.now()-start)/1000,...data.stats});
