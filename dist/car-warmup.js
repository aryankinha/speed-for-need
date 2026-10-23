import * as THREE from './vendor/three.module.js';
// Car switching used to hitch the first time each car became visible in a lighting setup: three.js only links a shader
// program when a material is first drawn, and uploads geometry/textures at that same moment. The driving world, the
// showroom and the garage each have a different light set (different shader permutations), and every car is hidden until
// chosen. This renders every car once per setup into a tiny half-float target (the same target format the post-processing
// chain uses, so the program keys match) while the loading screen is still up, so a later switch is only a visibility toggle.
export function warmVehicleRenderPaths({renderer,scene,camera,rides,player,showroom,garageScene}){
  const ids=Object.keys(rides);if(!ids.length)return false;
  const target=new THREE.WebGLRenderTarget(4,4,{type:THREE.HalfFloatType}),previousTarget=renderer.getRenderTarget();
  const saved={player:player?.visible,rides:ids.map(id=>rides[id].group.visible),showroom:showroom?.root.visible,showroomCars:ids.map(id=>showroom?.cars[id]?.visible),garage:garageScene?.root.visible,garageCars:ids.map(id=>garageScene?.cars[id]?.visible)};
  const pose={position:camera.position.clone(),quaternion:camera.quaternion.clone(),fov:camera.fov};
  const hideAll=()=>{ids.forEach(id=>{rides[id].group.visible=false;if(showroom?.cars[id])showroom.cars[id].visible=false;if(garageScene?.cars[id])garageScene.cars[id].visible=false;});};
  const draw=()=>{renderer.shadowMap.needsUpdate=true;renderer.render(scene,camera);};
  try{
    renderer.setRenderTarget(target);
    // Driving setup: player lights on, one ride at a time.
    if(player)player.visible=true;if(showroom)showroom.root.visible=false;if(garageScene)garageScene.root.visible=false;
    for(const id of ids){hideAll();rides[id].group.visible=true;draw();}
    // Showroom setup (player and its headlights hidden, showroom fill light on).
    if(showroom){if(player)player.visible=false;showroom.root.visible=true;showroom.frame();for(const id of ids){hideAll();showroom.cars[id].visible=true;draw();}showroom.root.visible=false;}
    // Garage setup (garage key/rim lights on).
    if(garageScene){if(player)player.visible=false;garageScene.root.visible=true;garageScene.frame();for(const id of ids){hideAll();garageScene.cars[id].visible=true;draw();}garageScene.root.visible=false;}
  }catch(error){console.warn('Car render warm-up skipped',error);}
  finally{
    renderer.setRenderTarget(previousTarget);target.dispose();
    if(player)player.visible=saved.player;ids.forEach((id,i)=>{rides[id].group.visible=saved.rides[i];if(showroom?.cars[id])showroom.cars[id].visible=saved.showroomCars[i];if(garageScene?.cars[id])garageScene.cars[id].visible=saved.garageCars[i];});
    if(showroom)showroom.root.visible=saved.showroom;if(garageScene)garageScene.root.visible=saved.garage;
    camera.position.copy(pose.position);camera.quaternion.copy(pose.quaternion);camera.fov=pose.fov;camera.updateProjectionMatrix();renderer.shadowMap.needsUpdate=true;
  }
  return true;
}
