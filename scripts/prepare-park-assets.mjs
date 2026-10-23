/** Prepare authored Poly Haven CC0 models; retains native metre dimensions.
 * Run download script /tmp/park-assets/download.mjs first, or reproduce downloads
 * from the URLs and MD5 values recorded in dist/assets/park/source-manifest.json.
 * Tools: @gltf-transform/{core,functions,extensions}, meshoptimizer and sharp.
 */
import {createRequire} from 'node:module';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const req=createRequire(join(process.env.PARK_ASSET_TOOLS||'/tmp/la-opt-tools','package.json'));
const {NodeIO}=await import(pathToFileURL(req.resolve('@gltf-transform/core')));
const {prune,dedup,weld,simplify,flatten,join:joinMeshes,getBounds,compactPrimitive}=await import(pathToFileURL(req.resolve('@gltf-transform/functions')));
const {ALL_EXTENSIONS,EXTTextureWebP}=await import(pathToFileURL(req.resolve('@gltf-transform/extensions')));
const {MeshoptSimplifier}=await import(pathToFileURL(req.resolve('meshoptimizer')));
const sharp=req('sharp');await MeshoptSimplifier.ready;
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS);
const input=process.env.PARK_ASSET_INPUT||'/tmp/park-assets';
const output=fileURLToPath(new URL('../dist/assets/park/',import.meta.url));await mkdir(output,{recursive:true});
const downloads=JSON.parse(await readFile(join(input,'download-manifest.json'),'utf8'));
const report={license:'CC0-1.0',licenseUrl:'https://polyhaven.com/license',sources:[]};
for(const [id,file,selected] of [
 ['grass_bermuda_01','grass','grass_bermuda_01_medium_a'],
 ['shrub_01','shrub','shrub_01_a'],
 ['potted_plant_01','pot',null],
 ['painted_wooden_bench','bench',null],
 ['wooden_picnic_table','picnic',null]
]){
 const doc=await io.read(join(input,id,id+'_1k.gltf'));const root=doc.getRoot();
 const selectedNodes=root.listNodes().filter(n=>!selected||n.getName()===selected).map(n=>n.getName());
 if(selected){for(const node of [...root.listNodes()]){if(node.getName()!==selected)node.dispose();else node.setTranslation([0,0,0]);}}
 await doc.transform(prune(),dedup(),flatten(),joinMeshes({keepNamed:false}),weld());
 // The shrub export combines a display row into one node. Keep its isolated
 // rightmost authored shrub only; no triangles cross the selection boundary.
 if(file==='shrub') for(const mesh of root.listMeshes())for(const p of mesh.listPrimitives()){
   const pos=p.getAttribute('POSITION').getArray(), ind=p.getIndices(), a=ind.getArray();const kept=[];let crossing=0;
   for(let i=0;i<a.length;i+=3){const flags=[a[i],a[i+1],a[i+2]].map(v=>pos[v*3]>-.15);if(flags.every(Boolean))kept.push(a[i],a[i+1],a[i+2]);else if(flags.some(Boolean))crossing++;}
   if(crossing)throw Error('Shrub selection would cut authored triangles');
   ind.setArray(new Uint32Array(kept));compactPrimitive(p);
 }
 const nativeBounds=getBounds(root.listScenes()[0]);
 const tris=()=>root.listMeshes().reduce((s,m)=>s+m.listPrimitives().reduce((t,p)=>t+(p.getIndices()?.getCount()||p.getAttribute('POSITION').getCount())/3,0),0);
 const nativeTriangles=tris();
 if(file!=='grass'&&nativeTriangles>1500){await doc.transform(simplify({simplifier:MeshoptSimplifier,ratio:1450/nativeTriangles,error:.05,lockBorder:false}));}
 // Center the authored model without changing its real-world scale. Bake the
 // offset into positions so instanced copies can bend or topple around the base.
 const bounds=getBounds(root.listScenes()[0]);const offset=[-(bounds.min[0]+bounds.max[0])/2,-bounds.min[1],-(bounds.min[2]+bounds.max[2])/2];
 for(const mesh of root.listMeshes())for(const p of mesh.listPrimitives()){
  const a=p.getAttribute('POSITION');const arr=a.getArray();for(let i=0;i<arr.length;i+=3){arr[i]+=offset[0];arr[i+1]+=offset[1];arr[i+2]+=offset[2];}a.setArray(arr);
 }
 const baseTextures=new Set(root.listMaterials().map(m=>m.getBaseColorTexture()));
 for(const tex of root.listTextures()){
  const isBase=baseTextures.has(tex);const n=isBase?512:256;
  tex.setImage(await sharp(tex.getImage()).resize(n,n,{fit:'inside',withoutEnlargement:true}).webp({quality:isBase?84:90,alphaQuality:100}).toBuffer()).setMimeType('image/webp').setURI('');
 }
 doc.createExtension(EXTTextureWebP).setRequired(true);
 await doc.transform(prune(),dedup());
 const data=await io.writeBinary(doc);await writeFile(join(output,file+'.glb'),data);
 report.sources.push({asset:id,page:'https://polyhaven.com/a/'+id,file:file+'.glb',selectedNodes,selectionNote:file==='shrub'?'Rightmost isolated shrub in the single-node display row, triangles wholly x > -0.15m; checked no crossing triangles.':file==='grass'?'One medium_a variant; display-grid translation removed.':file==='pot'?'One complete plant assembly including pot, stem, pebbles and leaves.':'Complete authored furniture assembly.',nativeBounds,nativeTriangles,outputBounds:getBounds(root.listScenes()[0]),triangles:tris(),bytes:data.length,sha256:createHash('sha256').update(data).digest('hex'),downloads:downloads.filter(d=>d.asset===id)});
 console.log(file,JSON.stringify(report.sources.at(-1),null,2));
}
await writeFile(join(output,'source-manifest.json'),JSON.stringify(report,null,2)+'\n');
