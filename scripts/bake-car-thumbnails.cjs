// Run with Electron while the local dev server is running. Renders the imported
// cars through the game's existing thumbnail renderer, never a screen capture.
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const ids=['concept','roadster','bmw','nsx','porsche'];
app.whenReady().then(async()=>{
 const win=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false,partition:'offline-car-thumbnails'}});
 try{
  await win.loadURL('http://127.0.0.1:4173/?map=drift&bake-thumbnails');
  let pictures;const start=Date.now();
  while(Date.now()-start<90000){pictures=await win.webContents.executeJavaScript("document.querySelector('#game')?.dataset.ready==='true'?Array.from(document.querySelectorAll('[data-ride]')).map(b=>({id:b.dataset.ride,src:b.querySelector('img')?.src})):null");if(pictures?.length===5)break;await new Promise(r=>setTimeout(r,250));}
  if(pictures?.length!==5)throw Error('Game thumbnails did not finish loading');
  const output=path.resolve(__dirname,'../dist/assets/car-thumbnails');await fs.mkdir(output,{recursive:true});
  for(const image of pictures){if(!ids.includes(image.id)||!image.src?.startsWith('data:image/webp;base64,'))throw Error('Unexpected thumbnail');await fs.writeFile(path.join(output,image.id+'.webp'),Buffer.from(image.src.split(',')[1],'base64'));}
  const files=['concept-gt','tesla-roadster','bmw-e36-m3','honda-nsx','porsche-911'];const source={};for(const name of files)source[name]=crypto.createHash('sha256').update(await fs.readFile(path.resolve(__dirname,'../dist/assets/'+name+'.glb'))).digest('hex');
  await fs.writeFile(path.join(output,'source.json'),JSON.stringify(source,null,2)+'\n');console.log('Baked five sourced-car WebP thumbnails.');app.exit(0);
 }catch(error){console.error(error);app.exit(1);}
});
