import * as THREE from 'three';
// Static snapshots of the actual imported geometry, using the existing renderer.
// No extra WebGL context, no repeated per-frame thumbnail renders, no duplicate textures.
export function vehicleThumbnails(renderer,rides,environment){
  const thumbnails={},scene=new THREE.Scene();scene.background=new THREE.Color(0x191d23);scene.environment=environment;scene.environmentIntensity=.9;
  scene.add(new THREE.HemisphereLight(0xe3ebff,0x44433b,2));const key=new THREE.DirectionalLight(0xffe1b9,3);key.position.set(-4,6,4);scene.add(key);
  const camera=new THREE.PerspectiveCamera(34,256/144,.1,50);camera.position.set(-6,2.3,-6);camera.lookAt(0,.6,0);
  const target=new THREE.WebGLRenderTarget(256,144);target.texture.colorSpace=THREE.SRGBColorSpace;
  const previous=renderer.getRenderTarget(),shadows=renderer.shadowMap.enabled;renderer.shadowMap.enabled=false;
  const pixels=new Uint8Array(256*144*4),canvas=document.createElement('canvas');canvas.width=256;canvas.height=144;const ctx=canvas.getContext('2d'),image=ctx.createImageData(256,144);
  try{for(const [id,ride] of Object.entries(rides)){const car=ride.group.clone(true);car.visible=true;scene.add(car);renderer.setRenderTarget(target);renderer.render(scene,camera);renderer.readRenderTargetPixels(target,0,0,256,144,pixels);for(let row=0;row<144;row++)image.data.set(pixels.subarray(row*256*4,(row+1)*256*4),(143-row)*256*4);ctx.putImageData(image,0,0);thumbnails[id]=canvas.toDataURL('image/webp',.84);scene.remove(car);}}
  finally{renderer.setRenderTarget(previous);renderer.shadowMap.enabled=shadows;target.dispose();scene.clear();}return thumbnails;
}
