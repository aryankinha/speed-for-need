import {sunsetDistance,SUNSET} from './map-layout.js';
import {WORLD} from './coast-config.js';
const road=Object.freeze({kind:'road',height:.027,grip:1,drag:0}),concrete=Object.freeze({kind:'concrete',height:.08,grip:1,drag:0});
// Reused output: callers consume the values immediately, never retain a park sample.
const park={kind:'grass',height:.123,grip:.78,drag:1.1};
export function surfaceAt(map,world,x,z){
 if(world.surfaceAt)return world.surfaceAt(x,z);
 for(let i=0;i<WORLD.roadsX.length;i++){const c=WORLD.roadsX[i];if(Math.abs(x-c)<(c===0?17:12))return road;}
 for(let i=0;i<WORLD.roadsZ.length;i++){const c=WORLD.roadsZ[i];if(Math.abs(z-c)<(c===-300?17:12))return road;}
 if(sunsetDistance(x,z)<SUNSET.width/2)return road;
 const plots=world.parkPlots;
 if(plots)for(let i=0;i<plots.length;i++){const p=plots[i];if(Math.abs(x-p.x)<p.width/2&&Math.abs(z-p.z)<p.length/2){const path=Math.abs(x-p.x)<3.6||Math.abs(z-p.z)<3.6;park.kind=path?'concrete':'grass';park.height=path?.145:(p.ground??.105)+.018;park.grip=path?1:.78;park.drag=path?0:1.1;return park;}}
 return concrete;
}
