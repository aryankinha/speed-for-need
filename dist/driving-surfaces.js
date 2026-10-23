import {sunsetDistance,SUNSET} from './map-layout.js';
export function surfaceAt(map,world,x,z){
 const roads=map==='la'?{roadsX:[0,70],roadsZ:[-110,110]}:{roadsX:[-450,-300,-150,0,150,300,450],roadsZ:[-600,-450,-300,-150,0,150,300,450,600]};
 const halfX=c=>map==='la'?8:map==='coast'&&c===0?17:12,halfZ=c=>map==='la'?8:map==='coast'&&c===-300?17:12;
 if(roads.roadsX.some(c=>Math.abs(x-c)<halfX(c))||roads.roadsZ.some(c=>Math.abs(z-c)<halfZ(c))||(map==='coast'&&sunsetDistance(x,z)<SUNSET.width/2))return {kind:'road',height:.027,grip:1,drag:0};
 for(const p of world.parkPlots||[])if(Math.abs(x-p.x)<p.width/2&&Math.abs(z-p.z)<p.length/2){if(Math.abs(x-p.x)<3.6||Math.abs(z-p.z)<3.6)return {kind:'concrete',height:.145,grip:1,drag:0};return {kind:'grass',height:(p.ground??.105)+.018,grip:.78,drag:1.1};}
 if(map==='la')return {kind:'concrete',height:.03,grip:1,drag:0};
 return {kind:'concrete',height:.08,grip:1,drag:0};
}
