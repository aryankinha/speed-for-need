import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from '../dist/vendor/three.module.js';
import {GRAPHICS_PRESETS,detectPreset,resolvePreset,toCarPaint} from '../dist/graphics-presets.js';
import {RenderQuality} from '../dist/driving-input.js';

test('GPU auto-detect keeps integrated laptop GPUs on the 60 FPS medium budget',()=>{
  assert.equal(detectPreset({gpu:'ANGLE (Apple, ANGLE Metal Renderer: Apple M1, Unspecified Version)'}),'medium');
  assert.equal(detectPreset({gpu:'ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)'}),'medium');
  assert.equal(detectPreset({gpu:'ANGLE (Intel, Intel(R) HD Graphics 520 Direct3D11 vs_5_0 ps_5_0, D3D11)'}),'low');
  assert.equal(detectPreset({gpu:'Google SwiftShader'}),'low');
  assert.equal(detectPreset({gpu:'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)'}),'ultra');
  assert.equal(detectPreset({gpu:'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060)',pixels:3840*2160}),'high');
  assert.equal(detectPreset({gpu:'Apple M3 Max'}),'high');
  assert.equal(detectPreset({gpu:'NVIDIA GeForce RTX 4090',mobile:true}),'low');
  assert.equal(detectPreset({gpu:''}),'medium');
});

test('saved graphics choice wins over detection; unknown values fall back to detection',()=>{
  assert.equal(resolvePreset('ultra','medium'),'ultra');
  assert.equal(resolvePreset(null,'low'),'low');
  assert.equal(resolvePreset('bogus','high'),'high');
});

test('presets scale cost monotonically and the low preset skips AO and bloom',()=>{
  const order=['low','medium','high','ultra'].map(n=>GRAPHICS_PRESETS[n]);
  for(let i=1;i<order.length;i++){assert.ok(order[i].ratio>=order[i-1].ratio);assert.ok(order[i].shadowMap>=order[i-1].shadowMap);assert.ok(order[i].smaa>=order[i-1].smaa);}
  assert.equal(GRAPHICS_PRESETS.low.ao,null);assert.equal(GRAPHICS_PRESETS.low.bloom,false);
  for(const preset of order)assert.ok(preset.minRatio<=preset.ratio);
  assert.deepEqual(order.map(p=>p.crowd),[12,28,44,60],'pedestrian pool per preset');
});

test('car paint becomes clear-coated physical paint and keeps colour, name and maps',()=>{
  const map=new THREE.Texture(),source=new THREE.MeshStandardMaterial({color:0xc72932,roughness:.9,metalness:0,map});source.name='Paint';source.userData.bodyPaint=true;
  const paint=toCarPaint(source);
  assert.ok(paint.isMeshPhysicalMaterial);assert.equal(paint.name,'Paint');assert.equal(paint.map,map);assert.equal(paint.color.getHex(),0xc72932);
  assert.equal(paint.clearcoat,1);assert.ok(paint.roughness<=.5);assert.equal(paint.userData.carPaint,true);assert.equal(paint.userData.bodyPaint,true);
  assert.deepEqual(paint.defines,{STANDARD:'',PHYSICAL:''});
  assert.equal(toCarPaint(paint),paint,'already physical materials are left alone');
  const basic=new THREE.MeshBasicMaterial();assert.equal(toCarPaint(basic),basic);
  const clone=paint.clone();assert.ok(clone.isMeshPhysicalMaterial);assert.equal(clone.userData.carPaint,true,'garage paint clones keep the flag');
});

test('render quality respects the preset pixel-ratio range and reports starvation at the floor',()=>{
  const q=new RenderQuality(1.25,1);assert.equal(q.ratio,1.25);
  for(let i=0;i<200;i++)q.update(30,1/60);assert.equal(q.ratio,1);
  for(let i=0;i<200;i++)q.update(30,1/60);assert.equal(q.starved,true);
  q.setRange(2,1.25);assert.equal(q.ratio,1.25);assert.equal(q.starved,false);
  for(let i=0;i<2000;i++)q.update(8,1/60);assert.equal(q.ratio,2);
});

test('game renders through the post-processing pipeline and the import map serves vendored libraries',()=>{
  const game=fs.readFileSync(new URL('../dist/game.js',import.meta.url),'utf8'),html=fs.readFileSync(new URL('../dist/index.html',import.meta.url),'utf8');
  assert.ok(!game.includes('renderer.render(scene,camera)'),'all scene renders go through graphics.render');
  assert.ok(game.includes('graphics.render(dt)'));
  for(const specifier of ['"postprocessing":"./vendor/postprocessing.module.js"','"n8ao":"./vendor/n8ao.module.js"','"three/examples/jsm/":"./vendor/"'])assert.ok(html.includes(specifier),specifier);
  for(const file of ['postprocessing.module.js','n8ao.module.js','postprocessing/Pass.js'])assert.ok(fs.existsSync(new URL('../dist/vendor/'+file,import.meta.url)),file);
  assert.equal((html.match(/class="pause-select graphics-select"/g)||[]).length,2,'graphics select in options and pause menu');
});

test('adaptive quality requires substantial headroom to increase resolution at a sustained 30 FPS',()=>{const q=new RenderQuality(1.5,1);q.ratio=1;for(let i=0;i<1500;i++)q.update(33.3,1/30,8);assert.equal(q.ratio,1);});
test('adaptive quality responds when measured work exceeds headroom and frames miss 60 Hz',()=>{const q=new RenderQuality(1.5,1);for(let i=0;i<100;i++)q.update(33.3,1/30,15);assert.equal(q.ratio,1.25);const idle=new RenderQuality(1.5,1);for(let i=0;i<100;i++)idle.update(33.3,1/30,3);assert.equal(idle.ratio,1.5,'cheap throttled work must not trigger degradation');});
