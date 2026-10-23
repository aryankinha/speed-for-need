import * as THREE from './vendor/three.module.js';

// Ambient coastal life for the Solana maps: seagull flocks over the shore and beach umbrellas with towels on the sand.
// Everything is instanced (gulls: 1 draw, umbrellas: 3 draws); wing flapping runs in the vertex shader, so the CPU
// only writes one matrix per gull per frame.
export const BEACH={inner:493,outer:528,zMin:-630,zMax:630};
export const sandHeight=x=>.02-(Math.abs(x)-490)*.009;
const UMBRELLA_COLORS=[0xe94b3c,0xf5b82e,0x2f8fd8,0x1fa67a,0xf06aa0,0xffffff,0xff7f2a];

/** Deterministic beach layout: umbrella spots in loose clusters on both sand strips, kept off the beach access roads. */
export function beachSpots(random,{count=90,roadsZ=[]}={}){
  const spots=[];let guard=0;
  while(spots.length<count&&guard++<count*20){
    const side=random()<.5?-1:1,x=side*(BEACH.inner+3+random()*(BEACH.outer-BEACH.inner-8)),z=BEACH.zMin+random()*(BEACH.zMax-BEACH.zMin);
    if(roadsZ.some(r=>Math.abs(z-r)<9))continue;
    if(spots.some(s=>Math.hypot(s.x-x,s.z-z)<4.5))continue;
    spots.push({x,z,side,yaw:random()*Math.PI*2,tilt:(random()-.5)*.25,color:UMBRELLA_COLORS[Math.floor(random()*UMBRELLA_COLORS.length)],towel:UMBRELLA_COLORS[Math.floor(random()*UMBRELLA_COLORS.length)]});
  }
  return spots;
}

/** Flock state: each flock circles a drifting centre; gulls hold an offset, phase and height. Pure so it can be tested. */
export function createFlocks(random,{flocks=6,perFlock=7}={}){
  const birds=[],centres=[];
  for(let f=0;f<flocks;f++){
    const side=f%2?1:-1,c={x:side*(BEACH.outer+10+random()*40),z:BEACH.zMin+120+random()*(BEACH.zMax-BEACH.zMin-240),r:14+random()*16,speed:(.25+random()*.2)*(random()<.5?-1:1),drift:(random()-.5)*2.4,y:16+random()*14};
    centres.push(c);
    for(let i=0;i<perFlock;i++)birds.push({flock:f,angle:random()*Math.PI*2,radius:c.r*(.6+random()*.6),dy:(random()-.5)*5,phase:random()*Math.PI*2,rate:7+random()*3});
  }
  return {birds,centres};
}
export function stepFlocks(state,dt){
  for(const c of state.centres){c.z+=c.drift*dt;if(c.z<BEACH.zMin+80||c.z>BEACH.zMax-80)c.drift*=-1;}
  for(const b of state.birds){const c=state.centres[b.flock];b.angle+=c.speed*dt*(18/b.radius);}
}

function gullGeometry(){
  // Body plus two two-segment wings; `flap` marks how much each vertex follows the wing beat (0 body, 1 tip).
  const p=[],flap=[],tri=(a,b,c,fa,fb,fc)=>{p.push(...a,...b,...c);flap.push(fa,fb,fc);};
  const nose=[0,0,.32],tail=[0,.02,-.38],top=[0,.09,0],bot=[0,-.07,0],l=[-.07,0,0],r=[.07,0,0];
  tri(nose,top,l,0,0,0);tri(nose,r,top,0,0,0);tri(nose,l,bot,0,0,0);tri(nose,bot,r,0,0,0);tri(tail,l,top,0,0,0);tri(tail,top,r,0,0,0);tri(tail,bot,l,0,0,0);tri(tail,r,bot,0,0,0);
  for(const s of [-1,1]){const root1=[s*.06,.02,.12],root2=[s*.06,.02,-.12],mid1=[s*.5,.04,.08],mid2=[s*.5,.04,-.14],tip=[s*.95,.0,-.18];
    tri(root1,mid1,root2,0,.5,0);tri(root2,mid1,mid2,0,.5,.5);tri(mid1,tip,mid2,.5,1,.5);}
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(p,3));g.setAttribute('flap',new THREE.Float32BufferAttribute(flap,1));g.computeVertexNormals();return g;
}

export class CoastalAmbient{
  constructor(scene,{random=Math.random,roadsZ=[]}={}){
    this.scene=scene;this.time=0;this.root=new THREE.Group();this.root.name='ambient';scene.add(this.root);
    // Seagulls: one InstancedMesh; per-instance phase drives the wing beat in the vertex shader.
    this.flocks=createFlocks(random);const n=this.flocks.birds.length,geometry=gullGeometry(),phase=new Float32Array(n);
    this.flocks.birds.forEach((b,i)=>{phase[i]=b.phase;});geometry.setAttribute('phase',new THREE.InstancedBufferAttribute(phase,1));
    const gullMaterial=new THREE.MeshStandardMaterial({color:0xeef0f2,roughness:.8,side:THREE.DoubleSide});this.uniforms={time:{value:0}};
    gullMaterial.onBeforeCompile=shader=>{shader.uniforms.time=this.uniforms.time;shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nattribute float flap;attribute float phase;uniform float time;').replace('#include <begin_vertex>','#include <begin_vertex>\nfloat beat=sin(time*8.5+phase);float glide=step(.55,fract((time+phase)*.13));transformed.y+=flap*mix(beat*.38,.05,glide)*abs(transformed.x)*1.6;');};
    this.gulls=new THREE.InstancedMesh(geometry,gullMaterial,n);this.gulls.instanceMatrix.setUsage(THREE.DynamicDrawUsage);this.gulls.frustumCulled=false;this.gulls.scale.setScalar(1);this.root.add(this.gulls);
    // Beach umbrellas: pole, striped canopy (instance colour) and towel, each a single InstancedMesh.
    const spots=beachSpots(random,{roadsZ});this.spots=spots;const m=spots.length;
    const pole=new THREE.InstancedMesh(new THREE.CylinderGeometry(.035,.035,2.3,5).translate(0,1.15,0),new THREE.MeshStandardMaterial({color:0xdcd6c8,roughness:.6}),m);
    const canopyGeometry=new THREE.ConeGeometry(1.25,.55,8,1,true).translate(0,2.2,0),stripe=[];const pos=canopyGeometry.attributes.position;
    for(let i=0;i<pos.count;i++){const a=Math.atan2(pos.getZ(i),pos.getX(i));stripe.push(Math.floor((a+Math.PI)/(Math.PI/4)+.5)%2?1:.88);}
    canopyGeometry.setAttribute('color',new THREE.Float32BufferAttribute(stripe.flatMap(v=>[v,v,v]),3));
    const canopy=new THREE.InstancedMesh(canopyGeometry,new THREE.MeshStandardMaterial({vertexColors:true,roughness:.85,side:THREE.DoubleSide}),m);
    const towel=new THREE.InstancedMesh(new THREE.PlaneGeometry(.9,1.9).rotateX(-Math.PI/2),new THREE.MeshStandardMaterial({roughness:1,polygonOffset:true,polygonOffsetFactor:-2}),m);
    const mat=new THREE.Matrix4(),q=new THREE.Quaternion(),e=new THREE.Euler(),v=new THREE.Vector3(),one=new THREE.Vector3(1,1,1),color=new THREE.Color();
    spots.forEach((s,i)=>{const y=sandHeight(s.x);e.set(s.tilt,s.yaw,0);q.setFromEuler(e);mat.compose(v.set(s.x,y,s.z),q,one);pole.setMatrixAt(i,mat);canopy.setMatrixAt(i,mat);canopy.setColorAt(i,color.setHex(s.color));
      e.set(0,s.yaw+.4,0);q.setFromEuler(e);mat.compose(v.set(s.x+Math.cos(s.yaw)*1.1,sandHeight(s.x+Math.cos(s.yaw)*1.1)+.05,s.z+Math.sin(s.yaw)*1.1),q,one);towel.setMatrixAt(i,mat);towel.setColorAt(i,color.setHex(s.towel));});
    for(const mesh of [pole,canopy,towel]){mesh.castShadow=mesh!==towel;mesh.receiveShadow=true;mesh.computeBoundingSphere();this.root.add(mesh);}
    this.matrix=mat;this.quat=q;this.euler=e;this.vec=v;this.scale=new THREE.Vector3(1.6,1.6,1.6);
  }
  update(dt){
    this.time+=dt;this.uniforms.time.value=this.time;stepFlocks(this.flocks,dt);
    const {birds,centres}=this.flocks;
    for(let i=0;i<birds.length;i++){const b=birds[i],c=centres[b.flock],dir=Math.sign(c.speed)||1;
      const x=c.x+Math.cos(b.angle)*b.radius,z=c.z+Math.sin(b.angle)*b.radius,y=c.y+b.dy+Math.sin(this.time*.6+b.phase)*1.2;
      // Heading is the circle tangent; bank into the turn.
      this.euler.set(0,-b.angle+(dir>0?Math.PI:0),-.35*dir);this.quat.setFromEuler(this.euler);this.matrix.compose(this.vec.set(x,y,z),this.quat,this.scale);this.gulls.setMatrixAt(i,this.matrix);}
    this.gulls.instanceMatrix.needsUpdate=true;
  }
  setVisible(value){this.root.visible=value;}
  dispose(){this.scene.remove(this.root);this.root.traverse(o=>{if(o.isMesh){o.geometry.dispose();o.material.dispose();}});}
}
