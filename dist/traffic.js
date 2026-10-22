// Constant-distance paths from line segments and circular arcs. No teleporting corners.
// Arc length s=r*theta: https://mathworld.wolfram.com/ArcLength.html
export function roundedRoute({left,right,top,bottom,radius=11,clockwise=true,lane=4.3}){
  const offset=clockwise?lane:-lane,L=left+offset,R=right-offset,T=top+offset,B=bottom-offset,r=radius;
  const segments=[];let length=0;
  function line(x,z,dx,dz,len){segments.push({start:length,len,sample(s){return{x:x+dx*s,z:z+dz*s,dx,dz,curvature:0};}});length+=len;}
  function arc(cx,cz,start){const len=Math.PI*r/2;segments.push({start:length,len,sample(s){const a=start+s/r;return{x:cx+r*Math.cos(a),z:cz+r*Math.sin(a),dx:-Math.sin(a),dz:Math.cos(a),curvature:1/r};}});length+=len;}
  line(L,B-r,0,-1,B-T-2*r);arc(L+r,T+r,Math.PI);line(L+r,T,1,0,R-L-2*r);arc(R-r,T+r,-Math.PI/2);line(R,T+r,0,1,B-T-2*r);arc(R-r,B-r,0);line(R-r,B,-1,0,R-L-2*r);arc(L+r,B-r,Math.PI/2);
  return {length,clockwise,sample(distance){let d=((clockwise?distance:-distance)%length+length)%length;const seg=segments.find(s=>d<s.start+s.len)||segments.at(-1);const p=seg.sample(d-seg.start);if(!clockwise){p.dx*=-1;p.dz*=-1;p.curvature*=-1;}p.heading=Math.atan2(-p.dx,-p.dz);return p;},nearest(x,z,around){let best=around,dist=Infinity;for(let d=-16;d<=16;d+=2){const s=around+d,p=this.sample(s),dd=(p.x-x)**2+(p.z-z)**2;if(dd<dist){dist=dd;best=s;}}// Refine the coarse local minimum so slow cars do not jump between 2 m bins.
    let lo=best-2,hi=best+2;for(let i=0;i<15;i++){const a=lo+(hi-lo)/3,b=hi-(hi-lo)/3,pa=this.sample(a),pb=this.sample(b);if((pa.x-x)**2+(pa.z-z)**2<(pb.x-x)**2+(pb.z-z)**2)hi=b;else lo=a;}return(lo+hi)/2;}};
}

export function followTraffic(traffic,player,dt){
  for(const car of traffic){const s=car.actor.state;car.progress=car.route.nearest(s.x,s.z,car.progress);const near=car.route.sample(car.progress),look=car.route.sample(car.progress+Math.max(3.5,Math.min(6,s.speed*.45)));let targetSpeed=car.cruise;
    // Brake before a bend and keep the limit through the entire bend. The old
    // single preview point accelerated again while the car was still cornering.
    const preview=8+s.speed*s.speed/(2*4);
    for(let d=-4;d<=preview;d+=2){const curvature=Math.abs(car.route.sample(car.progress+d).curvature);if(curvature>.001)targetSpeed=Math.min(targetSpeed,Math.sqrt(3.2/curvature));}
    for(const other of traffic){if(other===car||other.route!==car.route)continue;const gap=((other.progress-car.progress)%car.route.length+car.route.length)%car.route.length;if(gap<22)targetSpeed=Math.min(targetSpeed,Math.max(0,(gap-6)*.75));}
    const p=player.state,dx=p.x-s.x,dz=p.z-s.z,ahead=dx*near.dx+dz*near.dz,lateral=Math.abs(dx*near.dz-dz*near.dx);
    if(ahead>0&&ahead<25&&lateral<2.7)targetSpeed=Math.min(targetSpeed,Math.max(0,(ahead-6)*.8));
    let tx=look.x-s.x,tz=look.z-s.z,n=Math.hypot(tx,tz);if(n<.01){tx=near.dx;tz=near.dz;n=1;}
    car.actor.setTarget({vx:tx/n*targetSpeed,vz:tz/n*targetSpeed,heading:Math.atan2(-tx,-tz),maxAcceleration:7});
  }
}
