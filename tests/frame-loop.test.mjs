import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import * as T from '../dist/vendor/three.module.js';
import {snapShadowAnchor} from '../dist/shadow-snap.js';

// Execute the actual browser entry point's frame and shadow functions together.
// A boot-only smoke test never reaches the driving branch that crashed here.
test('driving frames keep rendering when throttled sun shadows refresh after the car moves',()=>{
 const source=readFileSync(new URL('../dist/game.js',import.meta.url),'utf8');
 const shadow=source.slice(source.indexOf('function updateSunShadow(){'),source.indexOf('\nlet cameraBoxes='));
 const frame=source.slice(source.indexOf('function animate(now){'),source.indexOf('}requestAnimationFrame(animate);init();')+1);
 assert.ok(shadow.startsWith('function updateSunShadow()'));assert.ok(frame.endsWith('}'));
 let renders=0,updates=0,requests=0,recorded=0,shadows=0;
 const sun={position:new T.Vector3(),target:new T.Object3D(),shadow:{camera:{left:-50,right:50},mapSize:{x:2048}}};
 const context={snapShadowAnchor:(...args)=>{shadows++;return snapShadowAnchor(...args);},sun,pos:new T.Vector3(123,0,-47),SUN:{x:40,y:70,z:30},shadowAnchor:{x:0,y:0,z:0},requestAnimationFrame(){requests++;},performance:{now:()=>0},last:0,document:{hidden:false},frameAverage:16.7,lerp:T.MathUtils.lerp,ready:true,paused:false,inShowroom:false,update(){updates++;context.pos.x+=2;},shadowClock:0,renderer:{shadowMap:{needsUpdate:false}},quality:{update:()=>false,starved:false},renderInvalid:false,gpuTimer:{poll(){},begin(){},end(){},value:null},shadowRenders:0,graphics:{render(){renders++;context.renderer.shadowMap.needsUpdate=false;}},frameMetrics:{record(){recorded++;},workMs:1}};
 runInNewContext(shadow+'\n'+frame+'\nfor(let i=1;i<=6;i++)animate(i*1000/60);',context);
 assert.equal(updates,6);assert.equal(renders,6);assert.equal(requests,6);assert.equal(recorded,6);assert.ok(shadows>=2&&shadows<=3,'shadow refresh remains throttled');
 assert.ok(sun.position.distanceTo(new T.Vector3(40,70,30))>50,'shadow anchor follows the real car position');
 assert.ok(Number.isFinite(sun.position.x)&&Number.isFinite(sun.position.z));
});
