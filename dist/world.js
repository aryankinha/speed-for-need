import * as THREE from 'three';
import {makeBeachGeometry} from './coast.js';
import {RAMPS} from './stunts.js';
import {prepareRampModel,RAMP_SHAPE} from './ramp-model.js';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
// Static meshes are merged per material within square spatial cells of this size (metres) so frustum culling still works.
const BATCH_CELL_M=220;
export const WORLD={left:-490,right:490,top:-670,bottom:670,shore:-486,roadsX:[-450,-300,-150,0,150,300,450],roadsZ:[-600,-450,-300,-150,0,150,300,450,600],spawn:{x:-445.7,z:110,heading:0}};
export function normalize(root,length,axis='z'){
  root.updateMatrixWorld(true);let b=new THREE.Box3().setFromObject(root,true);const dimensions=b.getSize(new THREE.Vector3());const group=new THREE.Group();group.add(root);root.scale.multiplyScalar(length/dimensions[axis]);root.updateMatrixWorld(true);b=new THREE.Box3().setFromObject(root,true);const center=b.getCenter(new THREE.Vector3());root.position.x-=center.x;root.position.z-=center.z;root.position.y-=b.min.y;group.updateMatrixWorld(true);return group;
}
export async function buildWorld({scene,physics,models,random}){
  const {left,right,top,bottom,roadsX,roadsZ}=WORLD;
  const obstacles=[],buildingLots=[],batches=new Map();const temp=new THREE.Vector3();let cityMaterial;
  const material=(color,roughness=.9)=>new THREE.MeshStandardMaterial({color,roughness});
  const pavement=material(0xb3b3a6),grass=material(0x69765a),sand=material(0xb5a38a),white=new THREE.MeshStandardMaterial({color:0xc9cabb}),yellow=new THREE.MeshStandardMaterial({color:0xc3b474});
  function batchMesh(mesh){
    mesh.updateWorldMatrix(true,false);if(!mesh.geometry)return;
    const cell=`${Math.floor(mesh.matrixWorld.elements[12]/BATCH_CELL_M)},${Math.floor(mesh.matrixWorld.elements[14]/BATCH_CELL_M)}`;
    const geo=mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);let material=mesh.material;
    if(material.userData.cityAtlas){const colors=new Float32Array(geo.attributes.position.count*3);for(let i=0;i<colors.length;i+=3){colors[i]=material.color.r;colors[i+1]=material.color.g;colors[i+2]=material.color.b;}geo.setAttribute('color',new THREE.BufferAttribute(colors,3));material=cityMaterial;}
    const casts=mesh.userData.surface!==true;const key=cell+'|'+material.uuid+'|'+casts+'|'+(geo.index?'i':'n')+'|'+Object.keys(geo.attributes).join(',');let bin=batches.get(key);if(!bin)batches.set(key,bin={material,casts,geometries:[]});bin.geometries.push(geo);
  }
  function slab(width,height,length,x,y,z,mat){const mesh=new THREE.Mesh(new THREE.BoxGeometry(width,height,length),mat);mesh.position.set(x,y,z);mesh.userData.surface=true;mesh.updateMatrixWorld();batchMesh(mesh);mesh.geometry.dispose();}
  function place(template,x,z,rotation=0,scale=1){const clone=template.clone(true);clone.position.set(x,0,z);clone.rotation.y=rotation;clone.scale.multiplyScalar(scale);clone.updateMatrixWorld(true);return clone;}
  function staticBox(root,name,{baseOnly=false}={}){root.updateMatrixWorld(true);let bounds=new THREE.Box3().setFromObject(root,true);const fullBounds=bounds.clone();if(baseOnly){const low=new THREE.Box3();root.traverse(o=>{if(o.isMesh){const p=o.geometry.attributes.position;for(let i=0;i<p.count;i++){temp.fromBufferAttribute(p,i).applyMatrix4(o.matrixWorld);if(temp.y<.8)low.expandByPoint(temp);}}});if(!low.isEmpty())bounds=low;}const size=bounds.getSize(new THREE.Vector3()),c=bounds.getCenter(new THREE.Vector3());if(size.x>.02&&size.z>.02){const actor=physics.addBox({x:c.x,z:c.z,width:size.x,length:size.z,userData:{kind:name}});actor.minY=fullBounds.min.y;actor.maxY=fullBounds.max.y;obstacles.push({box:bounds.clone(),actor});}return bounds;}
  function addStatic(root,name,collision=true,baseOnly=false){root.updateMatrixWorld(true);if(collision)staticBox(root,name,{baseOnly});root.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true;batchMesh(o);}});}
  // Surface details are layout geometry; all cars, buildings, vegetation and props are sourced GLBs.
  const roadCanvas=document.createElement('canvas');roadCanvas.width=roadCanvas.height=128;const rc=roadCanvas.getContext('2d'),pixels=rc.createImageData(128,128);for(let i=0;i<pixels.data.length;i+=4){const shade=58+random()*18;pixels.data[i]=shade;pixels.data[i+1]=shade+2;pixels.data[i+2]=shade+3;pixels.data[i+3]=255;}rc.putImageData(pixels,0,0);const texture=new THREE.CanvasTexture(roadCanvas);texture.wrapS=texture.wrapT=THREE.RepeatWrapping;texture.repeat.set(220,280);texture.colorSpace=THREE.SRGBColorSpace;const asphalt=new THREE.MeshStandardMaterial({map:texture,color:0xb2b3af,roughness:.88});
  slab(980,.4,1340,0,-.2,0,asphalt);slab(24,.16,1340,-478,-.05,0,pavement);slab(24,.16,1340,478,-.05,0,pavement);slab(932,.16,24,0,-.05,-658,pavement);slab(932,.16,24,0,-.05,658,pavement);
  const markings=[];const line=(x,z,w,l,material)=>markings.push({x,z,w,l,material});
  for(const x of roadsX)for(let z=top+29;z<bottom-29;z+=10){if(roadsZ.every(r=>Math.abs(z-r)>16)){line(x-.2,z,.13,5,yellow);line(x+.2,z,.13,5,yellow);line(x-9.5,z,.1,10,white);line(x+9.5,z,.1,10,white);}}
  for(const z of roadsZ)for(let x=left+29;x<right-29;x+=10){if(roadsX.every(r=>Math.abs(x-r)>16)){line(x,z-.2,5,.13,yellow);line(x,z+.2,5,.13,yellow);line(x,z-9.5,10,.1,white);line(x,z+9.5,10,.1,white);}}
  for(const x of roadsX)for(const z of roadsZ)for(const side of [-1,1])for(let i=-4;i<=4;i++){line(x+i*1.8,z+side*14,1,3,white);line(x+side*14,z+i*1.8,3,1,white);}
  for(const m of [white,yellow]){const items=markings.filter(x=>x.material===m);const instanced=new THREE.InstancedMesh(new THREE.BoxGeometry(1,.015,1),m,items.length),dummy=new THREE.Object3D();items.forEach((a,i)=>{dummy.position.set(a.x,.012,a.z);dummy.scale.set(a.w,1,a.l);dummy.updateMatrix();instanced.setMatrixAt(i,dummy.matrix);});instanced.receiveShadow=true;scene.add(instanced);}
  const buildingNames=Object.keys(models).filter(n=>n.startsWith('building-'));
  models[buildingNames[0]].traverse(o=>{if(o.isMesh&&!cityMaterial){cityMaterial=o.material.clone();cityMaterial.color.set(0xffffff);cityMaterial.vertexColors=true;}});
  const templates=buildingNames.map((name,i)=>{const root=models[name];const t=normalize(root,name.includes('skyscraper')?48+random()*30:14+random()*17,'y');const b=new THREE.Box3().setFromObject(t,true).getSize(new THREE.Vector3());const fit=Math.min(1,46/b.x,46/b.z);t.scale.multiplyScalar(fit);root.traverse(o=>{if(o.isMesh){o.material=o.material.clone();o.material.userData.cityAtlas=true;o.material.color.multiply(new THREE.Color([0xcbd0c6,0xcabfac,0xc3c9ce,0xd8cec0,0xb5c2b7][i%5]));}});return {template:t,tall:name.includes('skyscraper')};});
  let buildingCount=0,propCount=0;
  const bench=normalize(models.bench,2,'x'),planter=normalize(models.planter,2,'x'),dumpster=normalize(models.dumpster,1.8,'z'),cone=normalize(models['construction-cone'],.75,'y'),barrier=normalize(models['construction-barrier'],2.4,'z'),rock=normalize(models['rock-largea'],3,'z');
  const palm=models['tree-palmdetailedtall'];palm.traverse(o=>{if(o.isMesh){o.material.metalness=0;if(o.material.name.startsWith('leaf'))o.material.color.set(0x4d6b50);}});const palmT=normalize(palm,10.5,'y'),lampT=normalize(models['light-curved'],7,'y'),signalT=normalize(models['traffic-light'],4.8,'y');
  for(let i=0;i<roadsX.length-1;i++)for(let j=0;j<roadsZ.length-1;j++){
    const bx=(roadsX[i]+roadsX[i+1])/2,bz=(roadsZ[j]+roadsZ[j+1])/2;slab(126,.16,126,bx,-.02,bz,pavement);slab(114,.04,114,bx,.08,bz,grass);
    const park=(i===1&&j===4)||(i===4&&j===2)||(i===2&&j===6);
    if(park){slab(7,.02,116,bx,.115,bz,pavement);slab(116,.02,7,bx,.116,bz,pavement);for(const dx of [-28,28])for(const dz of [-30,30]){addStatic(place(palmT,bx+dx,bz+dz,random()*6), 'tree',true,true);addStatic(place(bench,bx+dx+4,bz+dz,Math.PI/2),'bench');propCount+=2;}continue;}
    for(const dx of [-33,33])for(const dz of [-33,33]){const tall=i>2&&j>1&&j<7&&random()>.35;const options=templates.filter(t=>t.tall===tall),template=options[Math.floor(random()*options.length)].template;const m=place(template,bx+dx,bz+dz,Math.floor(random()*4)*Math.PI/2,.8+random()*.2);const bounds=staticBox(m,'building');buildingLots.push({minX:bx+dx-25,maxX:bx+dx+25,minZ:bz+dz-25,maxZ:bz+dz+25,bounds});m.traverse(o=>{if(o.isMesh)batchMesh(o);});buildingCount++;}
    for(const side of [-1,1]){addStatic(place(planter,bx+side*58,bz,Math.PI/2),'planter');addStatic(place(bench,bx,bz+side*58,side>0?Math.PI:0),'bench');propCount+=2;}
    if((i+j)%3===0){addStatic(place(dumpster,bx+55,bz+52,Math.PI/2),'dumpster');propCount++;}
  }
  for(let z=top+10;z<bottom;z+=30){if(roadsZ.every(r=>Math.abs(z-r)>19)){for(const side of [-1,1]){addStatic(place(palmT,side*478,z,random()*6,.9+random()*.2),'tree',true,true);addStatic(place(lampT,side*462.5,z,side<0?-Math.PI/2:Math.PI/2),'lamp',true,true);if(Math.round(z)%3===0)addStatic(place(bench,side*479,z+5,Math.PI/2),'bench');}}}
  for(const x of roadsX.slice(1))for(let z=top+20;z<bottom;z+=65){if(roadsZ.every(r=>Math.abs(z-r)>20)){for(const side of [-1,1]){addStatic(place(palmT,x+side*15.2,z,random()*6,.7),'tree',true,true);addStatic(place(lampT,x+side*12.5,z+9,side<0?-Math.PI/2:Math.PI/2),'lamp',true,true);}}}
  for(const x of roadsX)for(const z of roadsZ)for(const sx of [-1,1])for(const sz of [-1,1]){addStatic(place(signalT,x+sx*13,z+sz*13,sx>0?Math.PI:0),'signal',true,true);addStatic(place(signalT,x+sx*13,z+sz*13.9,sz>0?Math.PI/2:-Math.PI/2),'signal',false);}
  for(let z=top;z<bottom;z+=24)addStatic(place(rock,-502-random()*4,z,random()*6,.7+random()*1.2),'coastal-rock',false);
  for(let i=0;i<5;i++){addStatic(place(cone,165+i*3,166.5),'cone');propCount++;}for(let i=0;i<3;i++){addStatic(place(barrier,172+i*3,163.8,Math.PI/2),'barrier');propCount++;}
  const stopT=normalize(models['road-sign-stop'],2.8,'y');for(const x of roadsX.slice(1))for(const z of roadsZ.filter((_,i)=>i%2===0))addStatic(place(stopT,x+12.5,z+19,Math.PI),'stop-sign',true,true);const highway=normalize(models['sign-highway-detailed'],5,'y');addStatic(place(highway,-429,-135,Math.PI/2),'highway-sign',true,true);
  // The downloaded Kenney ramp is reused three times. Toe and deck profile
  // share dimensions with the fixed-step jump layer; no generated ramp model.
  const rampTemplate=prepareRampModel(models['stunt-ramp']);
  for(const r of RAMPS){
    const model=place(rampTemplate,r.x,r.z,r.heading);model.position.y=.025;model.updateMatrixWorld(true);
    model.traverse(o=>{if(o.isMesh)batchMesh(o);});
    const actor=physics.addBox({x:r.x+r.fx*RAMP_SHAPE.length/2,z:r.z+r.fz*RAMP_SHAPE.length/2,width:RAMP_SHAPE.width,length:RAMP_SHAPE.length,heading:r.heading,userData:{kind:'stunt-ramp',rampId:r.id}});actor.maxY=RAMP_SHAPE.height+.025;
    // Cones mark the entry from either side, outside the drivable ramp width.
    for(const side of [-1,1])addStatic(place(cone,r.x+Math.cos(r.heading)*side*3.3-r.fx*2,r.z-Math.sin(r.heading)*side*3.3-r.fz*2),'stunt-cone');
    const half=RAMP_SHAPE.width/2;
    if(obstacles.some(o=>o.actor.userData.kind!=='stunt-cone'&&o.box.max.x>r.x-half&&o.box.min.x<r.x+half&&o.box.max.z>Math.min(r.z,r.z+r.fz*RAMP_SHAPE.length)&&o.box.min.z<Math.max(r.z,r.z+r.fz*RAMP_SHAPE.length)))throw new Error(`Stunt ramp ${r.id} overlaps a world obstacle`);
  }
  // Physical boundaries coincide with visible waterfront / outer retaining curbs.
  for(const x of [left,right]){slab(.4,.7,1340,x,.25,0,pavement);physics.addBox({x,z:0,width:.4,length:1340,userData:{kind:'boundary'}});}for(const z of [top,bottom]){slab(980,.7,.4,0,.25,z,pavement);physics.addBox({x:0,z,width:980,length:.4,userData:{kind:'boundary'}});}
  // Four continuous beach sides and one ocean surface beneath the island.
  // Normal sampling follows the layered scrolling approach in Three.js Water.
  // Reflection uses the existing HDR environment, avoiding an extra full-scene mirror pass.
  const sandTexture=await new THREE.TextureLoader().loadAsync('assets/beach-sand.jpg');sandTexture.colorSpace=THREE.SRGBColorSpace;sandTexture.wrapS=sandTexture.wrapT=THREE.RepeatWrapping;sandTexture.anisotropy=4;
  const beachGeometry=makeBeachGeometry(WORLD);
  const beach=new THREE.Mesh(beachGeometry,new THREE.MeshStandardMaterial({map:sandTexture,color:0xd8c39d,roughness:1,side:THREE.DoubleSide}));beach.receiveShadow=true;scene.add(beach);
  // Palms and sourced rocks finish the north, south and east promenades too.
  for(let z=top+20;z<bottom;z+=80){addStatic(place(rock,right+25+random()*5,z,random()*6,.8+random()*.5),'coast-rock',false);}
  for(const z of [top,bottom])for(let x=left+25;x<right;x+=75){addStatic(place(palmT,x,z+(z<0?12:-12),random()*6,.8),'coast-tree',false);addStatic(place(rock,x,z+(z<0?-26:26),random()*6,.8+random()*.5),'coast-rock',false);const nearRoad=d=>roadsX.some(r=>Math.abs(x+d-r)<13);if(x+37.5<440&&!nearRoad(37.5))addStatic(place(lampT,x+37.5,z+(z<0?27:-27),z<0?Math.PI:0),'lamp',true,true);if(x+20<440&&!nearRoad(20))addStatic(place(bench,x+20,z+(z<0?12:-12)),'bench',true);}
  // Merge each cell/material bin exactly once, after every static piece (including shoreline props) has been added.
  for(const bin of batches.values())if(bin.geometries.length){const geo=mergeGeometries(bin.geometries,false);if(!geo)throw new Error('Static geometry batching failed');const m=new THREE.Mesh(geo,bin.material);m.castShadow=bin.casts;m.receiveShadow=true;scene.add(m);for(const g of bin.geometries)g.dispose();bin.geometries=[];}
  const normal=await new THREE.TextureLoader().loadAsync('assets/sea-normal.jpg');normal.wrapS=normal.wrapT=THREE.RepeatWrapping;
  const sea=new THREE.Mesh(new THREE.PlaneGeometry(5000,5400),new THREE.ShaderMaterial({uniforms:{time:{value:0},normalMap:{value:normal}},vertexShader:`varying vec3 worldP;void main(){worldP=(modelMatrix*vec4(position,1.)).xyz;gl_Position=projectionMatrix*viewMatrix*vec4(worldP,1.);}`,fragmentShader:`varying vec3 worldP;uniform float time;uniform sampler2D normalMap;void main(){vec2 p=worldP.xz;vec3 n1=texture2D(normalMap,p*.018+vec2(time*.012,time*.007)).rgb;vec3 n2=texture2D(normalMap,p*.032-vec2(time*.008,time*.011)).rgb;float ripple=(n1.x+n2.y-1.);float edge=max(abs(p.x)-490.,abs(p.y)-670.);float shallow=1.-smoothstep(25.,100.,edge);vec3 c=mix(vec3(.10,.25,.30),vec3(.30,.52,.49),shallow*.7+ripple*.12);float wave=sin(edge*.65-time*1.5+n1.x*1.2);float foam=(1.-smoothstep(31.,42.,abs(edge-36.)))*pow(max(0.,wave),12.)*.38;c=mix(c,vec3(.83,.84,.73),foam);float gleam=pow(max(0.,ripple*.7+.2),8.)*2.;c+=vec3(.7,.44,.22)*gleam;float haze=1.-exp(-length(p-cameraPosition.xz)*.0006);gl_FragColor=vec4(mix(c,vec3(.64,.61,.59),haze),1.);}`}));sea.rotation.x=-Math.PI/2;sea.position.set(0,-.30,0);scene.add(sea);
  const placementErrors=buildingLots.filter(l=>l.bounds.min.x<l.minX||l.bounds.max.x>l.maxX||l.bounds.min.z<l.minZ||l.bounds.max.z>l.maxZ).length;
  if(placementErrors)throw new Error(`${placementErrors} buildings escaped their allocated lots`);
  return {obstacles,sea,buildingLots,ramps:RAMPS,stats:{buildings:buildingCount,props:propCount,colliders:physics.objects.length,areaKm2:((right-left)*(bottom-top)/1e6).toFixed(2),placementErrors}};
}
