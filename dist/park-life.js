import * as THREE from './vendor/three.module.js';
import {seeded} from './street-props.js';
// Authored CC0 vegetation, instanced per park. One shared trail field bends plants; no blade colliders.
export function parkPlants(plots,random=seeded(7203)){
 const grass=[],shrubs=[];
 for(const plot of plots){
  for(let i=0;i<6500;i++){const dx=(random()-.5)*(plot.width-8),dz=(random()-.5)*(plot.length-8);if(Math.abs(dx)<5||Math.abs(dz)<5)continue;grass.push({x:plot.x+dx,z:plot.z+dz,ground:plot.ground,scale:1.5+random()*1.3,rot:random()*Math.PI*2,park:plot});}
  for(const sx of [-1,1])for(const sz of [-1,1])for(let i=0;i<7;i++)shrubs.push({x:plot.x+sx*(15+i*4),z:plot.z+sz*44,ground:plot.ground,scale:1.6+random()*.6,rot:random()*6.28,park:plot});
 }
 return {grass,shrubs};
}
export class ParkLife{
 constructor({scene,plots}){this.scene=scene;this.plots=plots;this.groups=[];this.time=0;this.cursor=0;this.clock=1;this.trails=Array.from({length:16},()=>new THREE.Vector4(1e6,1e6,-100,0));this.uniforms={parkTime:{value:0},parkTrails:{value:this.trails}};}
 async load(loader){if(!this.plots.length)return;const layout=parkPlants(this.plots);
  for(const [kind,asset]of [['grass','grass'],['shrubs','shrub']]){const root=(await loader.loadAsync(`assets/park/${asset}.glb`)).scene;root.updateMatrixWorld(true);
   for(const plot of this.plots){const items=layout[kind].filter(p=>p.park===plot),group=new THREE.Group();this.scene.add(group);this.groups.push({plot,group});
    root.traverse(o=>{if(!o.isMesh)return;const geometry=o.geometry.clone().applyMatrix4(o.matrixWorld),material=o.material.clone();material.roughness=1;material.aoMap=null;if(kind==='grass'){material.color.setScalar(2.1);material.emissiveMap=material.map;material.emissive.setScalar(.25);}
     material.onBeforeCompile=shader=>{Object.assign(shader.uniforms,this.uniforms);if(kind==='grass')shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>','#include <map_fragment>\nif(max(diffuseColor.r,max(diffuseColor.g,diffuseColor.b))<.025)discard;diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.13,.18,.065),.45);');shader.vertexShader='uniform float parkTime;uniform vec4 parkTrails[16];\n'+shader.vertexShader;
      shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>',`#include <begin_vertex>
vec3 parkBase=(modelMatrix*instanceMatrix*vec4(0.,0.,0.,1.)).xyz;
vec2 parkPush=vec2(0.);float parkFlatten=0.;
for(int i=0;i<16;i++){vec2 delta=parkBase.xz-parkTrails[i].xy;float d=length(delta);float k=(1.-smoothstep(0.,parkTrails[i].w,d))*exp(-max(0.,parkTime-parkTrails[i].z)*1.8);parkPush+=delta/max(d,.12)*k;parkFlatten=max(parkFlatten,k);}
float parkTip=clamp(position.y/${kind==='grass'?'0.1':'0.38'},0.,1.);
vec3 parkWorldPush=vec3(parkPush.x,0.,parkPush.y)*${kind==='grass'?'.11':'.16'}*parkTip;
transformed.x+=dot(parkWorldPush,normalize(instanceMatrix[0].xyz))/length(instanceMatrix[0].xyz);
transformed.z+=dot(parkWorldPush,normalize(instanceMatrix[2].xyz))/length(instanceMatrix[2].xyz);
transformed.y*=1.-min(.75,parkFlatten*.7);transformed.x+=sin(parkTime*1.5+parkBase.x*.35+parkBase.z*.1)*.012*parkTip;`);
     };material.customProgramCacheKey=()=>`park-bend-${kind}`;
     const mesh=new THREE.InstancedMesh(geometry,material,items.length),dummy=new THREE.Object3D();items.forEach((p,i)=>{dummy.position.set(p.x,p.ground??.105,p.z);dummy.rotation.y=p.rot;dummy.scale.setScalar(p.scale);dummy.updateMatrix();mesh.setMatrixAt(i,dummy.matrix);});mesh.computeBoundingSphere();mesh.castShadow=false;mesh.receiveShadow=true;mesh.name='park-'+kind;group.add(mesh);
    });
   }
  }
 }
 update(dt,car){this.time+=dt;this.uniforms.parkTime.value=this.time;this.clock+=dt;for(const {plot,group}of this.groups)group.visible=Math.hypot(car.x-plot.x,car.z-plot.z)<145;
  if(!car.isAirborne&&(car.groundElevation||0)<.5&&this.clock>.14){this.clock=0;const s=Math.sin(car.heading),c=Math.cos(car.heading),rear=(car.length||4.5)*.3;for(const side of [-1,1]){this.trails[this.cursor].set(car.x+s*rear+c*side*.75,car.z+c*rear-s*side*.75,this.time,.65);this.cursor=(this.cursor+1)%this.trails.length;}}
 }
}
