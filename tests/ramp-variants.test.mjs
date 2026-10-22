import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as THREE from '../dist/vendor/three.module.js';
import {createDrivingWorld} from '../dist/physics.js';
import {RAMP_SHAPES,RAMP_SHAPE} from '../dist/ramp-shapes.js';
import {prepareRampModel} from '../dist/ramp-model.js';
import {RAMPS,STUNT_AREA,addRampColliders,rampSurface,StuntSystem} from '../dist/stunts.js';
import {BOOST_PADS} from '../dist/boost-pads.js';

const near=(a,b,t=1e-4)=>assert.ok(Math.abs(a-b)<t,`${a} != ${b}`);
const storage=()=>({getItem:()=>null,setItem(){}});

// Read the real Kenney ramp GLB positions, without any browser loader.
function sourceRamp(){
  const bytes=readFileSync(new URL('../dist/assets/stunt-ramp.glb',import.meta.url));
  const jsonLength=bytes.readUInt32LE(12),gltf=JSON.parse(bytes.subarray(20,20+jsonLength)),binStart=28+jsonLength;
  const accessor=gltf.accessors[gltf.meshes[0].primitives[0].attributes.POSITION],view=gltf.bufferViews[accessor.bufferView];
  const start=binStart+(view.byteOffset||0)+(accessor.byteOffset||0);
  const positions=new Float32Array(accessor.count*3);for(let i=0;i<positions.length;i++)positions[i]=bytes.readFloatLE(start+i*4);
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(positions,3));
  const source=new THREE.Group();source.add(new THREE.Mesh(geometry,new THREE.MeshStandardMaterial()));return source;
}

test('ramp profiles are distinct, authored data: kicker low and short, mega tall and long, standard unchanged',()=>{
  const {kicker,standard,mega}=RAMP_SHAPES;
  near(kicker.height,1.2);near(mega.height,5);near(standard.height,3.4);
  assert.ok(kicker.length<standard.length&&standard.length<mega.length);
  for(const s of Object.values(RAMP_SHAPES)){
    assert.ok(s.slopeRun<s.length&&s.slopeRun>0);
    near(Math.tan(s.angle),s.height/s.slopeRun,1e-9);
    assert.ok(s.width>=5&&s.chamfer>0&&s.chamfer<s.width/2);
  }
  assert.equal(RAMP_SHAPE,standard);
});

test('every placed ramp carries its own profile, and the three original lanes keep their ids and order',()=>{
  assert.deepEqual(RAMPS.slice(0,3).map(r=>r.id),['ocean','civic','east']);
  assert.equal(RAMPS.find(r=>r.id==='kicker').shape,RAMP_SHAPES.kicker);
  assert.equal(RAMPS.find(r=>r.id==='mega').shape,RAMP_SHAPES.mega);
  for(const r of RAMPS)assert.ok(r.label&&r.shape,r.id);
});

test('each ramp model is scaled to its own profile (bounds match width, height and length)',()=>{
  const source=sourceRamp();
  for(const shape of Object.values(RAMP_SHAPES)){
    const model=prepareRampModel(source,shape);
    const bounds=new THREE.Box3().setFromObject(model,true);
    near(bounds.max.x-bounds.min.x,shape.width);near(bounds.max.y,shape.height);near(-bounds.min.z,shape.length);
  }
});

test('the collider for each ramp is a chamfered convex deck whose top equals its profile height',()=>{
  const world=createDrivingWorld();const actors=addRampColliders(world);
  assert.equal(actors.length,RAMPS.length);
  actors.forEach((actor,i)=>{
    near(actor.maxY,RAMPS[i].shape.height+.025);
    assert.equal(actor.userData.rampId,RAMPS[i].id);
    assert.equal(actor.fixture.getShape().getChildCount(),1);
  });
});

test('ramps in the park never sit in the flight line of a neighbour (no chained launches)',()=>{
  for(const a of RAMPS)for(const b of RAMPS){
    if(a===b||Math.abs(a.z-b.z)>120)continue;
    const gap=Math.abs(a.x-b.x)-(a.shape.width+b.shape.width)/2;
    assert.ok(gap>2,`${a.id} and ${b.id} are ${gap.toFixed(1)} m apart across`);
  }
  for(const r of RAMPS.filter(r=>r.z>STUNT_AREA.top&&r.z<STUNT_AREA.bottom))assert.ok(r.x-r.shape.width/2>STUNT_AREA.left&&r.x+r.shape.width/2<STUNT_AREA.right,r.id);
});

test('the kicker launches a car airborne, and the mega ramp launches a car higher than the standard jump',()=>{
  const launch=id=>{
    const r=RAMPS.find(r=>r.id===id),world=createDrivingWorld();addRampColliders(world);
    const car=world.addVehicle({x:r.x-r.fx*8,z:r.z-r.fz*8,heading:r.heading,height:1.3});
    const stunts=new StuntSystem(r.shape,storage());stunts.reset(car);
    car.setPose({x:car.x,z:car.z,heading:r.heading,vx:r.fx*28,vz:r.fz*28});car.setControls({throttle:1});
    let maximum=0,airborne=false;
    for(let i=0;i<5*120;i++){world.step(1/120,()=>stunts.beginStep(car),dt=>stunts.step(car,dt));maximum=Math.max(maximum,car.elevation);airborne||=car.isAirborne;}
    return {maximum,airborne,landings:stunts.landings,distance:stunts.lastDistance};
  };
  const kicker=launch('kicker'),mega=launch('mega'),jump=launch('ocean');
  assert.ok(kicker.airborne&&kicker.landings===1);
  assert.ok(mega.maximum>jump.maximum+1,`mega ${mega.maximum.toFixed(2)} vs jump ${jump.maximum.toFixed(2)}`);
  assert.ok(kicker.maximum>RAMP_SHAPES.kicker.height&&kicker.maximum<2.5,`kicker peak ${kicker.maximum}`);
});

test('a mega ramp that is not climbed is still a solid obstacle with the mega height',()=>{
  const r=RAMPS.find(r=>r.id==='mega'),world=createDrivingWorld();addRampColliders(world);
  const car=world.addVehicle({x:r.x,z:r.z+8,heading:Math.PI,height:1.3});
  const stunts=new StuntSystem(r.shape,storage());stunts.reset(car);
  car.setPose({x:r.x,z:r.z+8,heading:Math.PI,vz:0,vx:0});
  // Driving into the high lip from behind: it must stop the car, not let it through.
  car.setPose({x:r.x,z:r.z-r.shape.length-3,heading:Math.PI,vx:0,vz:20});car.setControls({throttle:1});
  for(let i=0;i<2*120;i++)world.step(1/120,()=>stunts.beginStep(car),dt=>stunts.step(car,dt));
  assert.ok(car.z<r.z-r.shape.length-2,'the lip stops the car');
  near(rampSurface(r.shape,0),0);
});

test('the standard profile is 6 m wide (widened from 4.6 m for edge entries) and the spin variants are tagged',()=>{
  assert.equal(RAMP_SHAPES.standard.width,6);
  assert.deepEqual(RAMPS.filter(r=>r.variant==='spin').map(r=>r.id).sort(),['civic','roadspin']);
});

test('every trick ramp has a boost pad on its approach, within 25 m in front of the toe, and says so in its hint',()=>{
  for(const r of RAMPS.filter(r=>r.trick)){
    assert.equal(r.hintPad,true,`${r.id} hint should name the boost pad`);
    const pads=BOOST_PADS.filter(p=>Math.abs(p.x-r.x)<1&&p.z>r.z&&p.z-r.z<=25);
    assert.ok(pads.length>=1,`${r.id} has no approach pad`);
  }
});

test('the perimeter spin ramp keeps clear of the traffic lane (x = -445.7)',()=>{
  const r=RAMPS.find(r=>r.id==='roadspin');
  const gap=Math.abs(r.x+445.7)-r.shape.width/2-.95;
  assert.ok(gap>2,`gap to the traffic lane ${gap.toFixed(2)} m`);
});

test('the barrel roll now has its own approach pad, so its speed hint is true',()=>{
  const roll=RAMPS.find(r=>r.id==='east');
  assert.equal(roll.hintPad,true);
  assert.ok(BOOST_PADS.some(p=>Math.abs(p.x-roll.x)<1&&p.z>roll.z&&p.z-roll.z<=25),'a pad before the roll');
});
