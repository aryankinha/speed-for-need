import test from 'node:test';
import assert from 'node:assert/strict';
import {BEACH,beachSpots,createFlocks,stepFlocks,sandHeight} from '../dist/ambient.js';
const rng=(seed=7)=>()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};

test('beach umbrellas stay on the sand, spaced apart and off the beach access roads',()=>{
  const roadsZ=[-600,-450,-300,-150,0,150,300,450,600],spots=beachSpots(rng(),{count:90,roadsZ});
  assert.ok(spots.length>=60);
  for(const s of spots){assert.ok(Math.abs(s.x)>BEACH.inner&&Math.abs(s.x)<BEACH.outer);assert.ok(s.z>=BEACH.zMin&&s.z<=BEACH.zMax);assert.ok(roadsZ.every(r=>Math.abs(s.z-r)>=9));}
  for(let i=0;i<spots.length;i++)for(let j=i+1;j<spots.length;j++)assert.ok(Math.hypot(spots[i].x-spots[j].x,spots[i].z-spots[j].z)>=4.5);
  assert.ok(sandHeight(520)<sandHeight(495),'sand slopes down toward the sea');
});

test('gull flocks fly over the water edge and drift without leaving the coast',()=>{
  const state=createFlocks(rng(3));assert.equal(state.birds.length,42);
  for(let i=0;i<3600;i++)stepFlocks(state,1/30);
  for(const c of state.centres){assert.ok(Math.abs(c.x)>BEACH.outer);assert.ok(c.z>BEACH.zMin+60&&c.z<BEACH.zMax-60);assert.ok(c.y>=16&&c.y<=30);}
  for(const b of state.birds)assert.ok(Number.isFinite(b.angle));
});
