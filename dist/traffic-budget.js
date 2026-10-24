// Park distant traffic at its actual last pose. Re-entry never teleports it.
// Hysteresis avoids repeatedly rebuilding broadphase proxies near the boundary.
export function updateTrafficBudget(traffic,player){
 for(let i=0;i<traffic.length;i++){
  const car=traffic[i],a=car.actor,dx=a.x-player.x,dz=a.z-player.z,d2=dx*dx+dz*dz,active=a.body.isActive();
  const near=d2<(active?240*240:220*220);
  if(active!==near)a.body.setActive(near);
  a.body.setBullet(d2<70*70);car.mesh.visible=near;
 }
}
