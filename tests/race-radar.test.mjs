import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const game=readFileSync(new URL('../dist/game.js',import.meta.url),'utf8');
const draw=game.slice(game.indexOf('function drawCircuitRadar(dt=0){'),game.indexOf('\nfunction startRace()'));
function render(speed=0,heading=0){
 const arcs=[],scales=[],playerActor={x:20,z:30,speed,heading};
 const radarCtx={save(){},restore(){},clearRect(){},beginPath(){},clip(){},fillRect(){},translate(){},rotate(){},scale(x,y){scales.push([x,y]);},drawImage(){},arc(x,y,r){arcs.push({x,y,r});},fill(){},stroke(){},moveTo(){},lineTo(){},closePath(){}};
 const actors=[playerActor,{x:20,z:80},{x:60,z:30},{x:20,z:-470},{x:-480,z:30}];
 const context={radarDue:()=>true,radarCtx,circuit:{active:true,path:{},entries:actors.map(actor=>({actor})),name:'Drift Race Track'},playerActor,lerp:(a,b,t)=>a+(b-a)*t,raceRadarLayer:()=>({canvas:{},x:0,z:0,width:500,height:500}),radarNorth:{style:{}},radarDistrict:{},radarSpeed:{}};
 runInNewContext(draw+'\ndrawCircuitRadar(1/30);',context);return {arcs,scales,context};
}
test('race radar uses a close local view and readable pixel-sized opponents, including behind the car',()=>{
 const {arcs,scales}=render();assert.deepEqual(scales,[[1.25,1.25]]);
 assert.ok(arcs.some(a=>a.x===160&&a.y===222.5&&a.r===7),'50m rear opponent visible below the player');
 assert.ok(arcs.some(a=>a.x===210&&a.y===160&&a.r===7),'nearby side opponent uses a 7px radius');
 const distant=arcs.filter(a=>a.r===5);assert.equal(distant.length,2);for(const a of distant)assert.ok(Math.abs(Math.hypot(a.x-160,a.y-160)-142)<1e-9,'distant opponent stays inside bezel');
});
test('race radar widens modestly at speed and rotates rear opponents with heading',()=>{
 assert.deepEqual(render(60).scales,[[1,1]]);
 const {arcs,context}=render(0,Math.PI/2);assert.ok(arcs.some(a=>Math.abs(a.x-97.5)<1e-8&&Math.abs(a.y-160)<1e-8&&a.r===7));assert.equal(context.radarNorth.style.left,'91.00%');
});
