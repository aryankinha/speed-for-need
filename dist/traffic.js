// Constant-distance paths from line segments and circular arcs. No teleporting corners.
// Arc length s=r*theta: https://mathworld.wolfram.com/ArcLength.html
export function roundedRoute({left,right,top,bottom,radius=11,clockwise=true,lane=4.3}){
  const offset=clockwise?lane:-lane,L=left+offset,R=right-offset,T=top+offset,B=bottom-offset,r=radius;
  const segments=[];let length=0;
  function line(x,z,dx,dz,len){segments.push({start:length,len,sample(s,target){const out=target||{};out.x=x+dx*s;out.z=z+dz*s;out.dx=dx;out.dz=dz;out.curvature=0;return out;}});length+=len;}
  function arc(cx,cz,start){const len=Math.PI*r/2;segments.push({start:length,len,sample(s,target){const a=start+s/r;const out=target||{};out.x=cx+r*Math.cos(a);out.z=cz+r*Math.sin(a);out.dx=-Math.sin(a);out.dz=Math.cos(a);out.curvature=1/r;return out;}});length+=len;}
  line(L,B-r,0,-1,B-T-2*r);arc(L+r,T+r,Math.PI);line(L+r,T,1,0,R-L-2*r);arc(R-r,T+r,-Math.PI/2);line(R,T+r,0,1,B-T-2*r);arc(R-r,B-r,0);line(R-r,B,-1,0,R-L-2*r);arc(L+r,B-r,Math.PI/2);
  const _sampleA={x:0,z:0,dx:0,dz:0,curvature:0,heading:0},_sampleB={x:0,z:0,dx:0,dz:0,curvature:0,heading:0};
  return {length,clockwise,sample(distance,target){let d=((clockwise?distance:-distance)%length+length)%length;let seg=segments[segments.length-1];for(let i=0;i<segments.length;i++){const s=segments[i];if(d<s.start+s.len){seg=s;break;}}const p=seg.sample(d-seg.start,target);if(!clockwise){p.dx*=-1;p.dz*=-1;p.curvature*=-1;}p.heading=Math.atan2(-p.dx,-p.dz);return p;},nearest(x,z,around){let best=around,dist=Infinity;for(let d=-16;d<=16;d+=2){const s=around+d,p=this.sample(s,_sampleA),dd=(p.x-x)**2+(p.z-z)**2;if(dd<dist){dist=dd;best=s;}}// Refine the coarse local minimum via ternary search without object allocations.
    let lo=best-2,hi=best+2;for(let i=0;i<15;i++){const a=lo+(hi-lo)/3,b=hi-(hi-lo)/3,pa=this.sample(a,_sampleA),pb=this.sample(b,_sampleB);if((pa.x-x)**2+(pa.z-z)**2<(pb.x-x)**2+(pb.z-z)**2)hi=b;else lo=a;}return(lo+hi)/2;}};
}

const _near={x:0,z:0,dx:0,dz:0,curvature:0,heading:0};
const _look={x:0,z:0,dx:0,dz:0,curvature:0,heading:0};
const _curv={x:0,z:0,dx:0,dz:0,curvature:0,heading:0};
const _trafficTarget={vx:0,vz:0,heading:0,maxAcceleration:7};

export function followTraffic(traffic,player,dt){
  const px=player.x??player.state?.x??0,pz=player.z??player.state?.z??0;
  for(const car of traffic){
    const a=car.actor,sx=a.x??a.state?.x??0,sz=a.z??a.state?.z??0,sSpeed=a.speed??a.state?.speed??0;
    car.progress=car.route.nearest(sx,sz,car.progress);const near=car.route.sample(car.progress,_near),look=car.route.sample(car.progress+Math.max(3.5,Math.min(6,sSpeed*.45)),_look);let targetSpeed=car.cruise;
    // Brake before a bend and keep the limit through the entire bend. The old
    // single preview point accelerated again while the car was still cornering.
    const preview=8+sSpeed*sSpeed/(2*4);
    for(let d=-4;d<=preview;d+=2){const c=car.route.sample(car.progress+d,_curv);const curvature=Math.abs(c.curvature);if(curvature>.001)targetSpeed=Math.min(targetSpeed,Math.sqrt(3.2/curvature));}
    for(const other of traffic){if(other===car||other.route!==car.route)continue;const gap=((other.progress-car.progress)%car.route.length+car.route.length)%car.route.length;if(gap<22)targetSpeed=Math.min(targetSpeed,Math.max(0,(gap-6)*.75));}
    const dx=px-sx,dz=pz-sz,ahead=dx*near.dx+dz*near.dz,lateral=Math.abs(dx*near.dz-dz*near.dx);
    if(ahead>0&&ahead<25&&lateral<2.7)targetSpeed=Math.min(targetSpeed,Math.max(0,(ahead-6)*.8));
    let tx=look.x-sx,tz=look.z-sz,n=Math.hypot(tx,tz);if(n<.01){tx=near.dx;tz=near.dz;n=1;}
    _trafficTarget.vx=tx/n*targetSpeed;_trafficTarget.vz=tz/n*targetSpeed;_trafficTarget.heading=Math.atan2(-tx,-tz);
    a.setTarget(_trafficTarget);
  }
}
