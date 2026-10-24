// Constant-distance paths from line segments and circular arcs. No teleporting corners.
// Arc length s=r*theta: https://mathworld.wolfram.com/ArcLength.html
export function roundedRoute({left,right,top,bottom,radius=11,clockwise=true,lane=4.3}){
  const offset=clockwise?lane:-lane,L=left+offset,R=right-offset,T=top+offset,B=bottom-offset,r=radius;
  const segments=[];let length=0;const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  function line(x,z,dx,dz,len){segments.push({start:length,len,project(px,pz){return clamp((px-x)*dx+(pz-z)*dz,0,len);},sample(s,target){const out=target||{};out.x=x+dx*s;out.z=z+dz*s;out.dx=dx;out.dz=dz;out.curvature=0;return out;}});length+=len;}
  function arc(cx,cz,start){const len=Math.PI*r/2;segments.push({start:length,len,project(x,z){const angle=((Math.atan2(z-cz,x-cx)-start)%(Math.PI*2)+Math.PI*2)%(Math.PI*2);if(angle<=Math.PI/2)return angle*r;const ax=cx+r*Math.cos(start),az=cz+r*Math.sin(start),bx=cx+r*Math.cos(start+Math.PI/2),bz=cz+r*Math.sin(start+Math.PI/2);return (x-ax)**2+(z-az)**2<(x-bx)**2+(z-bz)**2?0:len;},sample(s,target){const a=start+s/r;const out=target||{};out.x=cx+r*Math.cos(a);out.z=cz+r*Math.sin(a);out.dx=-Math.sin(a);out.dz=Math.cos(a);out.curvature=1/r;return out;}});length+=len;}
  line(L,B-r,0,-1,B-T-2*r);arc(L+r,T+r,Math.PI);line(L+r,T,1,0,R-L-2*r);arc(R-r,T+r,-Math.PI/2);line(R,T+r,0,1,B-T-2*r);arc(R-r,B-r,0);line(R-r,B,-1,0,R-L-2*r);arc(L+r,B-r,Math.PI/2);
  const _sampleA={x:0,z:0,dx:0,dz:0,curvature:0,heading:0};
  return {length,clockwise,sample(distance,target){let d=((clockwise?distance:-distance)%length+length)%length;let seg=segments[segments.length-1];for(let i=0;i<segments.length;i++){const s=segments[i];if(d<s.start+s.len){seg=s;break;}}const p=seg.sample(d-seg.start,target);if(!clockwise){p.dx*=-1;p.dz*=-1;p.curvature*=-1;}p.heading=Math.atan2(-p.dx,-p.dz);return p;},nearest(x,z,around){
    // Exact projection onto line/quarter-circle segments replaces 47 repeated
    // route samples. Keep the old local search window so a crash cannot snap a
    // traffic car to a different stretch of its route (including the loop seam).
    let best=around,dist=Infinity;
    for(let offset=-18;offset<=18;offset+=18){const p=this.sample(around+offset,_sampleA),d=(p.x-x)**2+(p.z-z)**2;if(d<dist){dist=d;best=around+offset;}}
    for(const segment of segments){const raw=segment.start+segment.project(x,z),candidate=clockwise?raw:-raw;
      const delta=((candidate-around+length/2)%length+length)%length-length/2;
      if(Math.abs(delta)>18)continue;const progress=around+delta,p=this.sample(progress,_sampleA),d=(p.x-x)**2+(p.z-z)**2;
      if(d<dist){dist=d;best=progress;}
    }
    return best;
  }};
}

const _near={x:0,z:0,dx:0,dz:0,curvature:0,heading:0};
const _look={x:0,z:0,dx:0,dz:0,curvature:0,heading:0};
const _curv={x:0,z:0,dx:0,dz:0,curvature:0,heading:0};
const _trafficTarget={vx:0,vz:0,heading:0,maxAcceleration:7};

export function followTraffic(traffic,player,dt){
  const px=player.x??player.state?.x??0,pz=player.z??player.state?.z??0;
  for(const car of traffic){
    const a=car.actor;if(a.body&&!a.body.isActive())continue;const sx=a.x??a.state?.x??0,sz=a.z??a.state?.z??0,sSpeed=a.speed??a.state?.speed??0;
    car.progress=car.route.nearest(sx,sz,car.progress);const near=car.route.sample(car.progress,_near),look=car.route.sample(car.progress+Math.max(3.5,Math.min(6,sSpeed*.45)),_look);let targetSpeed=car.cruise;
    // Brake before a bend and keep the limit through the entire bend. The old
    // single preview point accelerated again while the car was still cornering.
    const preview=8+sSpeed*sSpeed/(2*4);
    for(let d=-4;d<=preview;d+=2){const c=car.route.sample(car.progress+d,_curv);const curvature=Math.abs(c.curvature);if(curvature>.001)targetSpeed=Math.min(targetSpeed,Math.sqrt(3.2/curvature));}
    for(const other of traffic){if(other===car||other.route!==car.route||(other.actor.body&&!other.actor.body.isActive()))continue;const gap=((other.progress-car.progress)%car.route.length+car.route.length)%car.route.length;if(gap<22)targetSpeed=Math.min(targetSpeed,Math.max(0,(gap-6)*.75));}
    const dx=px-sx,dz=pz-sz,ahead=dx*near.dx+dz*near.dz,lateral=Math.abs(dx*near.dz-dz*near.dx);
    if(ahead>0&&ahead<25&&lateral<2.7)targetSpeed=Math.min(targetSpeed,Math.max(0,(ahead-6)*.8));
    let tx=look.x-sx,tz=look.z-sz,n=Math.hypot(tx,tz);if(n<.01){tx=near.dx;tz=near.dz;n=1;}
    _trafficTarget.vx=tx/n*targetSpeed;_trafficTarget.vz=tz/n*targetSpeed;_trafficTarget.heading=Math.atan2(-tx,-tz);
    a.setTarget(_trafficTarget);
  }
}
