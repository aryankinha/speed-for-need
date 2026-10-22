import test from 'node:test';import assert from 'node:assert/strict';import {smoothSteering,RenderQuality} from '../dist/driving-input.js';
test('steering damping gives equal response at 30,60,120 Hz',()=>{const results=[30,60,120].map(hz=>{let v=0;for(let i=0;i<hz;i++)v=smoothSteering(v,1,30,1/hz);return v;});assert.ok(Math.max(...results)-Math.min(...results)<1e-10);});
test('steering turns in progressively at speed and recenters promptly',()=>{const low=smoothSteering(0,1,5,.1),high=smoothSteering(0,1,50,.1);assert.ok(low>high&&high>0);assert.ok(smoothSteering(1,0,50,.3)<.06);});
test('quality only drops after sustained slow rendering and recovers with hysteresis',()=>{const q=new RenderQuality();for(let i=0;i<60;i++)q.update(30,1/60);assert.equal(q.ratio,1.5);for(let i=0;i<120;i++)q.update(30,1/60);assert.equal(q.ratio,1.25);for(let i=0;i<660;i++)q.update(16,1/60);assert.equal(q.ratio,1.5);});

test('measured render work preserves sharpness on a 30 Hz presentation cadence',()=>{
  const q=new RenderQuality();for(let i=0;i<600;i++)q.update(33.33,1/30,7);assert.equal(q.ratio,1.5);
  for(let i=0;i<180;i++)q.update(33.33,1/30,29);assert.equal(q.ratio,1);
  for(let i=0;i<660;i++)q.update(33.33,1/30,7);assert.equal(q.ratio,1.5);
  const ratio=q.ratio;assert.equal(q.update(NaN,NaN,NaN),false);assert.equal(q.ratio,ratio);
});
