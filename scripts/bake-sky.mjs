// Linear-light HDR downsample; no exposure/tone mapping or LDR conversion.
// node --loader ./scripts/offline-three-loader.mjs scripts/bake-sky.mjs
import {readFile,writeFile,mkdir} from 'node:fs/promises';import {fileURLToPath} from 'node:url';
import * as T from '../dist/vendor/three.module.js';import {RGBELoader} from '../dist/vendor/loaders/RGBELoader.js';
const dir=fileURLToPath(new URL('../source-assets/sky/',import.meta.url));await mkdir(dir,{recursive:true});
const input=dir+'/kloofendal-puresky-2k.hdr';let bytes;try{bytes=await readFile(input);}catch{bytes=await readFile(new URL('../dist/assets/sky-midday/kloofendal-puresky-2k.hdr',import.meta.url));await writeFile(input,bytes);}
const image=new RGBELoader().setDataType(T.FloatType).parse(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
const width=image.width/2,height=image.height/2;const chunks=[Buffer.from('#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y '+height+' +X '+width+'\n')],row=new Uint8Array(width*4);
for(let y=0;y<height;y++){
 for(let x=0;x<width;x++){
  let r=0,g=0,b=0;for(let j=0;j<2;j++)for(let i=0;i<2;i++){const at=((y*2+j)*image.width+x*2+i)*4;r+=image.data[at]*.25;g+=image.data[at+1]*.25;b+=image.data[at+2]*.25;}
  const value=Math.max(r,g,b),e=value>1e-32?Math.floor(Math.log2(value))+1:-128,scale=256/2**e;row[x*4]=Math.min(255,r*scale);row[x*4+1]=Math.min(255,g*scale);row[x*4+2]=Math.min(255,b*scale);row[x*4+3]=e+128;
 }
 chunks.push(Buffer.from([2,2,width>>8,width&255]));
 for(let c=0;c<4;c++){
  const channel=Uint8Array.from({length:width},(_,x)=>row[x*4+c]);let x=0;
  while(x<width){let run=1;while(run<127&&x+run<width&&channel[x+run]===channel[x])run++;
   if(run>=4){chunks.push(Buffer.from([128+run,channel[x]]));x+=run;continue;}
   const start=x;x++;while(x<width&&x-start<128){let next=1;while(next<4&&x+next<width&&channel[x+next]===channel[x])next++;if(next>=4)break;x++;}
   chunks.push(Buffer.from([x-start]),Buffer.from(channel.subarray(start,x)));
  }
 }
}
const output=Buffer.concat(chunks);await writeFile(new URL('../dist/assets/sky-midday/kloofendal-puresky-1k.hdr',import.meta.url),output);
const decoded=new RGBELoader().setDataType(T.FloatType).parse(output.buffer.slice(output.byteOffset,output.byteOffset+output.byteLength));
const mean=data=>{let sum=0;for(let i=0;i<data.length;i+=4)sum+=data[i]+data[i+1]+data[i+2];return sum/(data.length/4);};
console.log({sourceBytes:bytes.length,bytes:output.length,width,height,relativeEnergyError:Math.abs(mean(decoded.data)/mean(image.data)-1)});
