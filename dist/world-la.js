import * as THREE from 'three';
import {addBuildingColliders} from './building-colliders.js';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {normalize} from './world.js';
import {LA_WORLD,laBuildingPlacements} from './la-layout.js';
import {LA_CHANNEL,LA_BRIDGES,getDeckHeight,getDeckPose} from './la-decks.js';
import {RAMPS,STUNT_AREA,addRampColliders} from './stunts.js';
import {prepareRampModel} from './ramp-model.js';
import {BOOST_PADS} from './boost-pads.js';
import {batchStaticMeshes} from './mesh-batching.js';
const CELL=300;
export async function buildLAWorld({scene,physics,models,anisotropy=4}){
 const root=new THREE.Group();root.name='SolanaLA';scene.add(root);const bins=new Map(),obstacles=[],buildingLots=[],cells=new Map(),instances=new Map();
 const rough=new THREE.MeshStandardMaterial({color:0x91918a,roughness:.94}),paint=new THREE.MeshStandardMaterial({color:0xe5d9b1,roughness:.9}),white=new THREE.MeshStandardMaterial({color:0xbfc2bd,roughness:.9});
 const load=async(name,srgb=false)=>{const t=await new THREE.TextureLoader().loadAsync(`assets/${name}`);if(srgb)t.colorSpace=THREE.SRGBColorSpace;t.wrapS=t.wrapT=THREE.RepeatWrapping;t.anisotropy=Math.min(8,anisotropy);return t;};
 const [road,roadNormal,concrete,concreteNormal]=await Promise.all([load('asphalt-diffuse.jpg',true),load('asphalt-normal.jpg'),load('la-real/concrete-diffuse.jpg',true),load('la-real/concrete-normal.jpg')]);
 const asphalt=new THREE.MeshStandardMaterial({map:road,normalMap:roadNormal,normalScale:new THREE.Vector2(.28,.28),roughness:.88,color:0x969b9f});asphalt.userData.tiled=3;
 const cement=new THREE.MeshStandardMaterial({map:concrete,normalMap:concreteNormal,normalScale:new THREE.Vector2(.45,.45),roughness:.93});cement.userData.tiled=3;
 function bake(mesh,x=mesh.position.x,z=mesh.position.z){mesh.updateWorldMatrix(true,false);let geo=mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
  // Common attribute set keeps authored PBR modules mergeable without changing UVs.
  for(const name of Object.keys(geo.attributes))if(!['position','normal','uv','uv1'].includes(name))geo.deleteAttribute(name);
  if(!geo.attributes.uv)geo.setAttribute('uv',new THREE.Float32BufferAttribute(new Float32Array(geo.attributes.position.count*2),2));
  if(mesh.material.userData.tiled){const p=geo.attributes.position,uv=geo.attributes.uv,s=mesh.material.userData.tiled;const n=geo.attributes.normal;for(let i=0;i<p.count;i++){const nx=Math.abs(n.getX(i)),ny=Math.abs(n.getY(i)),nz=Math.abs(n.getZ(i));uv.setXY(i,(nx>ny&&nx>nz?p.getZ(i):p.getX(i))/s,(ny>=nx&&ny>=nz?p.getZ(i):p.getY(i))/s);}}
  const key=`${Math.floor(x/CELL)},${Math.floor(z/CELL)}|${mesh.material.uuid}|${!!geo.index}|${Object.keys(geo.attributes).sort().join(',')}|${mesh.castShadow}`;
  if(!bins.has(key))bins.set(key,{geometries:[],material:mesh.material,casts:mesh.castShadow,x,z});bins.get(key).geometries.push(geo);
 }
 function slab(w,h,l,x,y,z,material,collision=false,kind='prop'){const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,l),material);m.position.set(x,y,z);m.castShadow=h>.3;m.receiveShadow=true;bake(m);m.geometry.dispose();if(collision){const actor=physics.addBox({x,z,width:w,length:l,userData:{kind}});actor.minY=y-h/2;actor.maxY=y+h/2;obstacles.push({actor,box:new THREE.Box3(new THREE.Vector3(x-w/2,y-h/2,z-l/2),new THREE.Vector3(x+w/2,y+h/2,z+l/2))});}return m;}
 function sourced(template,x,z,heading=0,scale=1,collision=false,kind='prop',y=0){const m=template.clone(true);m.position.set(x,y,z);m.rotation.y=heading;m.scale.multiplyScalar(scale);m.updateMatrixWorld(true);const box=new THREE.Box3().setFromObject(m,true);if(collision&&kind==='building'){addBuildingColliders(m,physics,obstacles);buildingLots.push({bounds:box,minX:box.min.x,maxX:box.max.x,minZ:box.min.z,maxZ:box.max.z});}else if(collision){const size=box.getSize(new THREE.Vector3()),c=box.getCenter(new THREE.Vector3()),actor=physics.addBox({x:c.x,z:c.z,width:size.x,length:size.z,userData:{kind}});actor.minY=box.min.y;actor.maxY=box.max.y;obstacles.push({actor,box});if(kind==='building')buildingLots.push({bounds:box,minX:box.min.x,maxX:box.max.x,minZ:box.min.z,maxZ:box.max.z});}
  m.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true;if(kind==='building'||kind==='building-lod'){const tier=kind==='building'?'near':'far',key=`${Math.floor(x/CELL)},${Math.floor(z/CELL)}|${o.geometry.uuid}|${o.material.uuid}|${tier}`;if(!instances.has(key))instances.set(key,{geometry:o.geometry,material:o.material,matrices:[],x,z,tier});instances.get(key).matrices.push(o.matrixWorld.clone());}else bake(o,x,z);}});return box;}
 // Ground meshes are spatial tiles, not one always-visible city-sized draw.
 function landTile(x,z){const l=Math.max(x,-680),r=Math.min(x+300,-520),t=Math.max(z,150),b=Math.min(z+300,1150);if(l>=r||t>=b){slab(300,.12,300,x+150,-.1,z+150,rough);return;}for(const [a,c,d,e]of [[x,x+300,z,t],[x,x+300,b,z+300],[x,l,t,b],[r,x+300,t,b]])if(c>a&&e>d)slab(c-a,.12,e-d,(a+c)/2,-.1,(d+e)/2,rough);}
 for(let x=-1200;x<1200;x+=300)for(let z=-1200;z<1200;z+=300)landTile(x,z);
 for(const x of LA_WORLD.roadsX)for(let z=-1200;z<1200;z+=300)slab(34,.04,300,x,-.01,z+150,asphalt);
 for(const z of LA_WORLD.roadsZ)for(let x=-1200;x<1200;x+=300){if(z===450||z===750){for(const [l,r]of [[x,Math.min(x+300,-690)],[Math.max(x,-510),x+300]])if(r>l)slab(r-l,.04,34,(l+r)/2,-.005,z,asphalt);}else slab(300,.04,34,x+150,-.005,z,asphalt);}
 const strip=[];for(const x of LA_WORLD.roadsX)for(let z=-1170;z<1180;z+=12)if(LA_WORLD.roadsZ.every(k=>Math.abs(k-z)>22))for(const s of [-1,1])strip.push({x:x+s*.2,z,w:.12,l:6});
 for(const z of LA_WORLD.roadsZ)for(let x=-1170;x<1180;x+=12)if(LA_WORLD.roadsX.every(k=>Math.abs(k-x)>22)&&!(x>-690&&x<-510&&(z===450||z===750)))for(const s of [-1,1])strip.push({x,z:z+s*.2,w:6,l:.12});
 const marks=new THREE.InstancedMesh(new THREE.BoxGeometry(1,.01,1),paint,strip.length),dummy=new THREE.Object3D();strip.forEach((a,i)=>{dummy.position.set(a.x,.026,a.z);dummy.scale.set(a.w,1,a.l);dummy.updateMatrix();marks.setMatrixAt(i,dummy.matrix);});marks.computeBoundingSphere();root.add(marks);
 const wrap=name=>{if(!models[name])throw new Error(`Missing LA architecture asset: ${name}`);const g=new THREE.Group();g.add(models[name]);return g;},templates=['small','medium','large'].map(name=>wrap(`la-real/la-building-${name}`)),farTemplates=['small','medium','large'].map(name=>wrap(`la-real/la-building-${name}-lod`));
 if(templates.some(t=>!t))throw new Error('Missing realistic architecture assets');
 // Materials refer to one shared set of downloaded PBR maps across repeated buildings.
 const shared=new Map();for(const t of [...templates,...farTemplates])t.traverse(o=>{if(o.isMesh){for(const m of Array.isArray(o.material)?o.material:[o.material]){if(m.transmission>0||m.name.toLowerCase().includes('glass')){m.transmission=0;m.transparent=false;m.opacity=1;m.metalness=0;m.roughness=.18;}const key=m.name;if(!shared.has(key))shared.set(key,m);}if(!Array.isArray(o.material))o.material=shared.get(o.material.name);}});
 for(const t of [...templates,...farTemplates]){t.updateMatrixWorld(true);const b=new THREE.Box3().setFromObject(t,true),c=b.getCenter(new THREE.Vector3());t.children[0].position.x-=c.x;t.children[0].position.z-=c.z;t.children[0].position.y-=b.min.y;t.updateMatrixWorld(true);batchStaticMeshes(t);}
 const placements=laBuildingPlacements();for(const p of placements){
  // Actual authored building size is retained. Lots are generous enough for service alleys.
  sourced(templates[p.model],p.x,p.z,p.heading,1,true,'building');sourced(farTemplates[p.model],p.x,p.z,p.heading,1,false,'building-lod');
  slab(26,.15,26,p.x,-.03,p.z,cement); // 15 cm sidewalk plinth, with driveable road-level approaches
 }
 // Downtown landmark assemblies reuse entire authored building modules at their native scale.
 // Floor spacing stays authored; additional tiers are stacked, never height-stretched.
 for(const [x,z,tiers]of [[570,540,5],[900,840,4],[540,900,3],[870,240,3]]){const t=templates[2],b=new THREE.Box3().setFromObject(t,true),h=b.max.y-b.min.y;
  for(let i=0;i<tiers;i++){sourced(t,x,z,0,1,true,'building',i*h);sourced(farTemplates[2],x,z,0,1,false,'building-lod',i*h);}
 }
 // Sourced palms and lamps provide human/car scale along PCH and Vinewood.
 const palm=normalize(models['tree-palmdetailedtall'],12,'y'),lamp=normalize(models['light-curved'],8,'y');
 for(let z=-1140;z<1160;z+=45)for(const x of [-1080,-1021])sourced(palm,x,z,0,1,false);
 for(let x=-970;x<1150;x+=55){sourced(palm,x,-1025,0,.95,false);sourced(lamp,x,-1072,0,1,false);}
 // Channel surface is a continuous sampled profile, with two real bridge decks.
 const ch=LA_CHANNEL;const width=160,segments=100,geo=new THREE.PlaneGeometry(width,1000,8,segments);geo.rotateX(-Math.PI/2);const positions=geo.attributes.position;
 for(let i=0;i<positions.count;i++){const x=positions.getX(i)+ch.x,z=positions.getZ(i)+650;positions.setXYZ(i,x,getDeckHeight(x,z,{groundElevation:-5,heading:0})-.04,z);}geo.computeVertexNormals();
 const river=new THREE.Mesh(geo,cement);river.updateMatrixWorld();river.castShadow=false;bake(river,-600,650);geo.dispose();
 // Visually open channel sides retain below-ground cars; street/bridge cars clear these walls.
 for(const x of [-680,-520])for(let z=300;z<1050;z+=150)slab(1,5,150,x,-2.55,z+75,cement,true,'channel-wall');
 for(const bridge of LA_BRIDGES){const z=bridge.z;slab(180,.65,36,-600,-.375,z,cement,true,'bridge-deck');for(const side of [-1,1])slab(180,.85,.45,-600,.425,z+side*18,cement,true,'bridge-rail');}
 // Connect every public street across the channel and keep the two grade-separated bridges.
 for(const z of [150,1050])slab(180,.05,34,-600,-.02,z,asphalt);
 // A flat stunt apron preserves the established jump/roll controls off public streets.
 slab(STUNT_AREA.right-STUNT_AREA.left,.03,STUNT_AREA.bottom-STUNT_AREA.top,(STUNT_AREA.left+STUNT_AREA.right)/2,.005,(STUNT_AREA.top+STUNT_AREA.bottom)/2,asphalt);
 const rampActors=addRampColliders(physics);for(let i=0;i<RAMPS.length;i++){const r=RAMPS[i],t=prepareRampModel(models['stunt-ramp'],r.shape),box=sourced(t,r.x,r.z,r.heading,1,false);obstacles.push({actor:rampActors[i],box});}
 // Pier deck is reachable directly from the west highway via its street crossing.
 slab(140,.25,30,-1125,-.12,-450,cement);for(const z of [-465,-435])slab(140,1,.35,-1125,.5,z,rough,true,'pier-rail');
 for(const x of [-1200,1200])slab(.6,1,2400,x,.4,0,cement,true,'boundary');for(const z of [-1200,1200])slab(2400,1,.6,0,.4,z,cement,true,'boundary');
 const sea=new THREE.Mesh(new THREE.PlaneGeometry(4000,6500),new THREE.ShaderMaterial({uniforms:{time:{value:0}},vertexShader:'varying vec3 p;void main(){p=(modelMatrix*vec4(position,1.)).xyz;gl_Position=projectionMatrix*viewMatrix*vec4(p,1.);}',fragmentShader:'varying vec3 p;uniform float time;void main(){float w=sin(p.x*.09+time)*sin(p.z*.07-time*.7);gl_FragColor=vec4(vec3(.08,.22,.27)+w*.015,1.);}' }));sea.rotation.x=-Math.PI/2;sea.position.set(-3200,-.4,0);scene.add(sea);
 // Warm sand is terrain, architecture always comes from the downloaded authored kits.
 slab(140,.15,2400,-1270,-.15,0,new THREE.MeshStandardMaterial({color:0xb5a98d,roughness:1}));
 for(const entry of instances.values()){const mesh=new THREE.InstancedMesh(entry.geometry,entry.material,entry.matrices.length);entry.matrices.forEach((m,i)=>mesh.setMatrixAt(i,m));mesh.computeBoundingBox();mesh.computeBoundingSphere();mesh.castShadow=entry.tier==='near';mesh.receiveShadow=true;mesh.userData.tier=entry.tier;root.add(mesh);const key=`${Math.floor(entry.x/CELL)},${Math.floor(entry.z/CELL)}`;if(!cells.has(key))cells.set(key,[]);cells.get(key).push(mesh);}
 for(const bin of bins.values()){const g=mergeGeometries(bin.geometries,false);if(!g)throw new Error('LA spatial batching failed');const m=new THREE.Mesh(g,bin.material);m.castShadow=bin.casts;m.receiveShadow=true;m.updateMatrix();m.matrixAutoUpdate=false;root.add(m);for(const item of bin.geometries)item.dispose();const key=`${Math.floor(bin.x/CELL)},${Math.floor(bin.z/CELL)}`;if(!cells.has(key))cells.set(key,[]);cells.get(key).push(m);}
 return {root,sea,obstacles,buildingLots,ramps:RAMPS,stuntArea:STUNT_AREA,getDeckHeight,getDeckPose,updateVisible(x,z){for(const [key,meshes]of cells){const [cx,cz]=key.split(',').map(Number),distance=Math.hypot((cx+.5)*CELL-x,(cz+.5)*CELL-z);for(const m of meshes)m.visible=m.userData.tier==='near'?distance<270:m.userData.tier==='far'?distance>=270&&distance<1100:distance<1100;}},stats:{map:'Solana LA',buildings:placements.length+15,props:0,colliders:physics.objects.length,areaKm2:'5.76',placementErrors:0,cells:cells.size}};
}
