// Local dev server for dist/. Sends no-store so edited modules are never served stale from the browser cache
// (python's http.server allows heuristic caching, which hid code changes after a reload).
import {createServer} from 'node:http';
import {createReadStream,statSync} from 'node:fs';
import {extname,join,normalize,resolve} from 'node:path';

const root=resolve(import.meta.dirname,'../dist'),port=Number(process.env.PORT||4173);
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.md':'text/markdown; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.ktx2':'image/ktx2','.svg':'image/svg+xml','.glb':'model/gltf-binary','.hdr':'application/octet-stream','.wasm':'application/wasm','.woff2':'font/woff2','.txt':'text/plain; charset=utf-8'};

createServer((req,res)=>{
  const path=decodeURIComponent(new URL(req.url,'http://localhost').pathname),file=normalize(join(root,path.endsWith('/')?path+'index.html':path));
  if(!file.startsWith(root)){res.writeHead(403).end();return;}
  let stat;try{stat=statSync(file);}catch{res.writeHead(404).end('Not found');return;}
  if(!stat.isFile()){res.writeHead(404).end('Not found');return;}
  res.writeHead(200,{'Content-Type':types[extname(file).toLowerCase()]||'application/octet-stream','Content-Length':stat.size,'Cache-Control':'no-store'});
  createReadStream(file).pipe(res);
}).listen(port,'127.0.0.1',()=>console.log(`Speed for Need dev server: http://127.0.0.1:${port}`));
