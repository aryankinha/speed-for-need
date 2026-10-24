// Offline only. Install @gltf-transform/{core,extensions,functions}, meshoptimizer
// and sharp in ASSET_TOOLS (a folder containing package.json), then run this file.
import {createRequire} from 'node:module';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const req=createRequire(join(process.env.ASSET_TOOLS||'/tmp/roadster-perf-tools','package.json'));
const {NodeIO}=await import(pathToFileURL(req.resolve('@gltf-transform/core')));
const {ALL_EXTENSIONS}=await import(pathToFileURL(req.resolve('@gltf-transform/extensions')));
const {weld,simplifyPrimitive,meshopt,prune,dedup,textureCompress}=await import(pathToFileURL(req.resolve('@gltf-transform/functions')));
const {MeshoptEncoder,MeshoptDecoder,MeshoptSimplifier}=await import(pathToFileURL(req.resolve('meshoptimizer')));
const sharp=req('sharp');await Promise.all([MeshoptEncoder.ready,MeshoptDecoder.ready,MeshoptSimplifier.ready]);
const base=fileURLToPath(new URL('../',import.meta.url)),source=join(base,'source-assets/hero-cars');await mkdir(source,{recursive:true});
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'meshopt.encoder':MeshoptEncoder,'meshopt.decoder':MeshoptDecoder});
const report=[];
for(const name of ['concept-gt','tesla-roadster']){
 const input=join(source,name+'.glb'),output=join(base,'dist/assets',name+'.glb');
 try{await readFile(input);}catch{await writeFile(input,await readFile(output));}
 const bytes=await readFile(input),doc=await io.read(input),root=doc.getRoot(),triangles=()=>root.listMeshes().reduce((n,m)=>n+m.listPrimitives().reduce((s,p)=>s+(p.getIndices()?.getCount()||p.getAttribute('POSITION').getCount())/3,0),0),before=triangles();
 // Protect authored cockpit, glass and steering assemblies. Node hierarchy,
 // wheel pivots, source names, materials and all transforms are left intact.
 const protectedMeshes=new Set();for(const node of root.listNodes())if(/Interior|Windshield$|Window$|roadster\.0(?:07|08|09|14|19)_/i.test(node.getName()))if(node.getMesh())protectedMeshes.add(node.getMesh());
 await doc.transform(weld());
 for(const mesh of root.listMeshes())if(!protectedMeshes.has(mesh))for(const primitive of mesh.listPrimitives()){
  const normal=primitive.getAttribute('NORMAL'),uv=primitive.getAttribute('TEXCOORD_0'),stride=(normal?3:0)+(uv?2:0),count=primitive.getAttribute('POSITION').getCount(),attributes=new Float32Array(count*stride),row=[];
  for(let i=0;i<count;i++){let at=i*stride;if(normal){normal.getElement(i,row);for(let j=0;j<3;j++)attributes[at++]=row[j];}if(uv){uv.getElement(i,row);for(let j=0;j<2;j++)attributes[at++]=row[j];}}
  const weights=[...(normal?[.1,.1,.1]:[]),...(uv?[.2,.2]:[])];
  const simplifier={simplify(indices,positions,positionStride,target,error){return MeshoptSimplifier.simplifyWithAttributes(indices,positions,positionStride,attributes,stride,weights,null,target,error,['Permissive']);}};
  simplifyPrimitive(primitive,{simplifier,ratio:.10,error:.005,lockBorder:false});
 }
 await doc.transform(dedup(),prune({keepLeaves:true,keepSolidTextures:true}),textureCompress({encoder:sharp,targetFormat:'webp',quality:92}),meshopt({encoder:MeshoptEncoder,level:'high',quantizePosition:16,quantizeNormal:12,quantizeTexcoord:16}));
 await io.write(output,doc);const optimized=await readFile(output);
 report.push({asset:name,source:'source-assets/hero-cars/'+name+'.glb',sourceSha256:createHash('sha256').update(bytes).digest('hex'),sourceBytes:bytes.length,bytes:optimized.length,beforeTriangles:before,triangles:triangles(),protectedMeshes:protectedMeshes.size});
 console.log(report.at(-1));
}
await writeFile(join(base,'dist/assets/hero-cars-optimization.json'),JSON.stringify(report,null,2)+'\n');
