import {fileURLToPath} from 'node:url';
import {NodeIO} from '/tmp/la-opt-tools/node_modules/@gltf-transform/core/dist/index.js';
import {ALL_EXTENSIONS} from '/tmp/la-opt-tools/node_modules/@gltf-transform/extensions/dist/index.js';
import {flatten,dedup,prune,getBounds} from '/tmp/la-opt-tools/node_modules/@gltf-transform/functions/dist/index.js';
import {createRequire} from 'node:module';
const sharp=createRequire('/tmp/la-opt-tools/package.json')('sharp');
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const out=new URL('../dist/assets/street-real/',import.meta.url);await mkdir(out,{recursive:true});
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS),report=[];
for(const [source,name,author,url] of [
 ['narrow_street_photorealistic','street-frontages','MushyDay','https://sketchfab.com/3d-models/narrow-street-photorealistic-622b27d146ec4d5b8ca865d0531fe6c6'],
 ['city_buildings_-_blackthornprod_video','city-skyline','Tiko','https://sketchfab.com/3d-models/city-buildings-blackthornprod-video-24e68bfc7c63479d8dc6b19570073b51']]){
 const path=new URL('../../'+source+'.glb',import.meta.url),original=await readFile(path),d=await io.read(fileURLToPath(path));await d.transform(flatten(),dedup(),prune());
 for(const t of d.getRoot().listTextures()){const raw=t.getImage();if(!raw)continue;const meta=await sharp(raw).metadata();const stats=meta.hasAlpha?await sharp(raw).stats():null;const alpha=stats&&stats.channels.at(-1).min<255;const p=sharp(raw).resize({width:1024,height:1024,fit:'inside',withoutEnlargement:true});t.setImage(await(alpha?p.png():p.removeAlpha().jpeg({quality:92,chromaSubsampling:'4:4:4'})).toBuffer()).setMimeType(alpha?'image/png':'image/jpeg').setURI('');}
 const binary=await io.writeBinary(d);await writeFile(new URL(name+'.glb',out),binary);report.push({file:name+'.glb',author,url,license:'CC BY 4.0',licenseUrl:'https://creativecommons.org/licenses/by/4.0/',changes:'Flattened hierarchy; lossless geometry retained; textures recompressed for browser delivery.',bytes:binary.length,sourceSha256:createHash('sha256').update(original).digest('hex'),sha256:createHash('sha256').update(binary).digest('hex'),bounds:getBounds(d.getRoot().listScenes()[0])});
}
await writeFile(new URL('provenance.json',out),JSON.stringify(report,null,2));console.log(report);
