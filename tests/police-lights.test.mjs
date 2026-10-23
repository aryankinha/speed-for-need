import test from 'node:test';
import assert from 'node:assert/strict';
import {lightBarState,lightBarY,buildLightBar,makeLightBarShared,LIGHT_BAR,FLASH_HZ} from '../dist/police-lights.js';

// Minimal THREE stand-in: police-lights.js takes THREE as an argument, so no WebGL or three import is needed here.
class Vec3{constructor(){this.x=0;this.y=0;this.z=0;}set(x,y,z){this.x=x;this.y=y;this.z=z;return this;}}
class Obj3{constructor(){this.position=new Vec3();this.children=[];this.name='';}add(c){this.children.push(c);return this;}}
class Group extends Obj3{}
class Mesh extends Obj3{constructor(geometry,material){super();this.geometry=geometry;this.material=material;}}
class Geo{constructor(...args){this.args=args;}}
class Mat{constructor(opts={}){Object.assign(this,opts);}}
class Color{constructor(r,g,b){this.r=r;this.g=g;this.b=b;}}
const THREE={Group,Mesh,BoxGeometry:Geo,MeshBasicMaterial:Mat,MeshStandardMaterial:Mat,Color};

const sample=(from,to,n)=>Array.from({length:n},(_,i)=>from+(to-from)*i/n);

test('lightBarState: unlit bars are off at every time', ()=>{
  for(const t of [-3,0,0.1,0.25,1,42.7]) assert.deepEqual(lightBarState(t,false),{red:0,blue:0});
});

test('lightBarState: lit bar alternates red and blue at FLASH_HZ (5 Hz)', ()=>{
  assert.equal(FLASH_HZ,5);
  const half=1/FLASH_HZ;
  // Window [0.05, 1.05) holds exactly five swap instants (0.2, 0.4, 0.6, 0.8, 1.0).
  const states=sample(0.05,1.05,10000).map(t=>{const s=lightBarState(t,true);return s.red>s.blue;});
  let toggles=0;for(let i=1;i<states.length;i++) if(states[i]!==states[i-1]) toggles++;
  assert.equal(toggles,FLASH_HZ,'one second must contain FLASH_HZ swaps');
  // The state holds for one swap interval (0.2 s) and then flips.
  const a=lightBarState(0.01,true),b=lightBarState(0.01+half,true),c=lightBarState(0.01+2*half,true);
  assert.notDeepEqual(a,b);
  assert.deepEqual(a,c);
});

test('lightBarState: exactly one lens is bright at any moment, the other is dim', ()=>{
  for(const t of sample(-2,2,400)){
    const s=lightBarState(t,true);
    assert.ok((s.red>1)!==(s.blue>1),`t=${t}: exactly one lens should be bright`);
    assert.ok(Math.min(s.red,s.blue)>0,'the dim lens stays visible while lit');
  }
});

test('lightBarState: values stay within [0, 7] and are finite', ()=>{
  for(const t of sample(-5,5,500)){
    const s=lightBarState(t,true);
    for(const v of [s.red,s.blue]){
      assert.ok(Number.isFinite(v));
      assert.ok(v>=0&&v<=7,`value ${v} out of range`);
    }
  }
});

test('lightBarY: housing sits just into the roof of a body this tall', ()=>{
  const roof=1.4;
  const y=lightBarY(roof);
  assert.ok(y>roof-LIGHT_BAR.sink-1e-9 && y<roof+LIGHT_BAR.housingHeight,'centre within the roof band');
  assert.equal(lightBarY(0)<lightBarY(roof),true);
});

test('buildLightBar: one group with four meshes sharing geometry and materials', ()=>{
  const red=new Mat({name:'red'}),blue=new Mat({name:'blue'});
  const shared=makeLightBarShared(THREE,red,blue);
  const a=buildLightBar(THREE,shared),b=buildLightBar(THREE,shared);
  assert.ok(a instanceof Group);
  assert.equal(a.name,'light-bar');
  assert.equal(a.children.length,4);
  assert.equal(a.children[1].material,red,'left lens is red');
  assert.equal(a.children[2].material,blue,'right lens is blue');
  assert.equal(a.children[0].geometry,b.children[0].geometry,'housing geometry shared across cops');
  assert.equal(a.children[1].material,b.children[1].material,'lens materials shared across cops');
  assert.equal(a.children[1].geometry,a.children[2].geometry,'lens geometry shared');
});
