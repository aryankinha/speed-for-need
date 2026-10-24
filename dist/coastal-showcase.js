import * as T from './vendor/three.module.js';
// A presentation set, separate from every playable map. All scenery is static
// except the existing water-normal technique; repeated details are instanced.
export async function loadShowcaseTextures(){
 const loader=new T.TextureLoader(),names=['asphalt-diffuse.jpg','asphalt-normal.jpg','beach-sand.jpg','sea-normal.jpg'];
 const maps=await Promise.all(names.map(name=>loader.loadAsync('assets/'+name)));
 maps.forEach((map,i)=>{map.wrapS=map.wrapT=T.RepeatWrapping;map.anisotropy=4;if(i===0||i===2)map.colorSpace=T.SRGBColorSpace;});
 maps[0].repeat.set(5,430);maps[1].repeat.set(5,430);maps[2].repeat.set(5,300);return {asphalt:maps[0],asphaltNormal:maps[1],sand:maps[2],waterNormal:maps[3]};
}
function box(parent,geometry,material,x,y,z){const mesh=new T.Mesh(geometry,material);mesh.position.set(x,y,z);mesh.castShadow=true;mesh.receiveShadow=true;parent.add(mesh);return mesh;}
function instances(parent,name,geometry,material,placements){
 const mesh=new T.InstancedMesh(geometry,material,placements.length),m=new T.Matrix4();mesh.name=name;placements.forEach(([x,y,z],i)=>mesh.setMatrixAt(i,m.makeTranslation(x,y,z)));mesh.instanceMatrix.needsUpdate=true;mesh.receiveShadow=true;parent.add(mesh);return mesh;
}
export class CoastalShowcase{
 constructor(parent,{textures={},palm=null,lamp=null}={}){
  this.root=new T.Group();this.root.name='Pacific motorway — dedicated home set';parent.add(this.root);
  const root=this.root,roadMaterial=new T.MeshStandardMaterial({color:0x737a7c,map:textures.asphalt||null,normalMap:textures.asphaltNormal||null,normalScale:new T.Vector2(.65,.65),roughness:.9});
  const road=new T.Mesh(new T.PlaneGeometry(19,2400),roadMaterial);road.rotation.x=-Math.PI/2;road.position.set(0,0,600);road.receiveShadow=true;road.name='Five lane asphalt';root.add(road);
  const concrete=new T.MeshStandardMaterial({color:0xb3b8b7,roughness:.86}),metal=new T.MeshStandardMaterial({color:0xb0bcc5,roughness:.36,metalness:.65}),paint=new T.MeshStandardMaterial({color:0xe6e5d8,roughness:.82}),amber=new T.MeshBasicMaterial({color:0xe9ad46});
  const dashes=[];for(const x of [-4.35,-1.45,1.45,4.35])for(let z=-120;z<1500;z+=8)dashes.push([x,.009,z]);
  instances(root,'Four dashed lane dividers',new T.BoxGeometry(.085,.008,3.5),paint,dashes);
  for(const side of [-1,1]){
   box(root,new T.BoxGeometry(.11,.009,2400),paint,side*7.3,.009,600);
   box(root,new T.BoxGeometry(.09,.009,2400),amber,side*8.9,.009,600);
   box(root,new T.BoxGeometry(.65,.55,2400),concrete,side*9.5,-.23,600);
   box(root,new T.BoxGeometry(.09,.12,2400),metal,side*9.5,.65,600);
   box(root,new T.BoxGeometry(.09,.10,2400),metal,side*9.5,.96,600);
  }
  const posts=[],reflectors=[];for(const side of [-1,1])for(let z=-125;z<1500;z+=5){posts.push([side*9.5,.44,z]);reflectors.push([side*9.44,.85,z]);}
  instances(root,'Highway guardrail posts',new T.BoxGeometry(.10,1,.10),metal,posts);
  instances(root,'Amber safety reflectors',new T.BoxGeometry(.045,.08,.11),amber,reflectors);
  // Quiet tarmac shoulders with diagonal hatch markings at the far entrance.
  const hatches=[];for(const side of [-1,1])for(let z=20;z<1500;z+=6)hatches.push([side*8.15,.012,z]);
  const hatch=instances(root,'Shoulder guide marks',new T.BoxGeometry(.55,.008,.10),paint,hatches);hatch.userData.decorative=true;
  const sandMaterial=new T.MeshStandardMaterial({color:0xe6d5ac,map:textures.sand||null,roughness:1});
  for(const side of [-1,1]){const beach=new T.Mesh(new T.PlaneGeometry(25,2400),sandMaterial);beach.rotation.x=-Math.PI/2;beach.position.set(side*22,-.65,600);beach.name='Beach shoulder';beach.receiveShadow=true;root.add(beach);}
  this.sea=new T.Mesh(new T.PlaneGeometry(3600,3600),new T.ShaderMaterial({uniforms:{time:{value:0},normalMap:{value:textures.waterNormal||null},hasNormal:{value:textures.waterNormal?1:0}},vertexShader:`varying vec2 p;varying vec3 world;void main(){p=position.xy;world=(modelMatrix*vec4(position,1.)).xyz;gl_Position=projectionMatrix*viewMatrix*vec4(world,1.);}`,fragmentShader:`varying vec2 p;varying vec3 world;uniform float time;uniform sampler2D normalMap;uniform float hasNormal;void main(){vec2 uv=p*.023;vec3 a=texture2D(normalMap,uv+vec2(time*.009,time*.005)).rgb;vec3 b=texture2D(normalMap,uv*1.7-vec2(time*.007,time*.009)).rgb;float ripple=(a.x+b.y-1.)*hasNormal;float shore=abs(p.x)-34.5;float shallow=1.-smoothstep(0.,35.,shore);vec3 c=mix(vec3(.055,.24,.30),vec3(.23,.57,.58),shallow*.8);c+=ripple*.055;float foam=(1.-smoothstep(0.,2.8,abs(shore-1.2)))*pow(max(0.,sin(shore*2.-time*1.2+ripple*4.)),6.)*.45;c=mix(c,vec3(.85,.90,.85),foam);float haze=1.-exp(-length(world.xz-cameraPosition.xz)*.0025);c=mix(c,vec3(.70,.78,.81),haze);gl_FragColor=vec4(c,1.);}` }));
  this.sea.name='Showcase ocean';this.sea.rotation.x=-Math.PI/2;this.sea.position.set(0,-.72,600);root.add(this.sea);
  // Reuse the shipped palm mesh; never scatter any props between the cars.
  if(palm){const b=new T.Box3().setFromObject(palm,true),height=b.max.y-b.min.y;if(height>0)for(const side of [-1,1])for(const [i,z]of [18,48,86,140].entries()){const tree=palm.clone(true),k=(7+i*.35)/height;tree.scale.multiplyScalar(k);tree.position.set(0,0,0);tree.rotation.y=side*.8+i*1.7;const fitted=new T.Box3().setFromObject(tree,true),center=fitted.getCenter(new T.Vector3());tree.position.set(side*(14+i*.6)-center.x,-.65-fitted.min.y,z-center.z);root.add(tree);}}
  if(lamp)for(const side of [-1,1])for(const z of [20,54,108]){const light=lamp.clone(true);light.position.set(0,0,0);light.rotation.y+=side<0?Math.PI:0;const b=new T.Box3().setFromObject(light,true),height=b.max.y-b.min.y;if(height<=0)continue;light.scale.multiplyScalar(6.5/height);const fitted=new T.Box3().setFromObject(light,true),center=fitted.getCenter(new T.Vector3());light.position.set(side*8.7-center.x,-fitted.min.y,z-center.z);root.add(light);}
  // A restrained portal gives the road a deliberate vanishing point.
  const gantry=new T.Group();gantry.name='Coastal highway portal';gantry.position.z=75;root.add(gantry);
  for(const side of [-1,1])box(gantry,new T.BoxGeometry(.3,6,.3),metal,side*9,3,0);
  box(gantry,new T.BoxGeometry(18.3,.34,.32),metal,0,6,0);
  const panel=new T.MeshStandardMaterial({color:0x153a43,roughness:.55});box(gantry,new T.BoxGeometry(7.8,1.05,.12),panel,0,5.38,0);
  const markers=[];for(let i=-2;i<=2;i++)markers.push([i*1.35,5.38,-.08]);instances(gantry,'Five lane portal markers',new T.BoxGeometry(.42,.05,.025),amber,markers);
  this.stats={lanes:5,palms:palm?8:0,lamps:lamp?6:0,playable:false};
 }
 update(dt){if(this.root.parent?.visible&&Number.isFinite(dt)&&dt>0)this.sea.material.uniforms.time.value+=Math.min(dt,.05);}
}
