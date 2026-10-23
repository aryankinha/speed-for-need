// Segment/slab collision for lightweight debris. Static world AABBs are conservative; cars keep Planck contacts.
export function sweepProp(start,end,r,boxes,minY=0,maxY=Infinity){
 let earliest=null;
 for(const box of boxes){if(box.max.y<minY+.01||box.min.y>maxY-.01)continue;const minX=box.min.x-r,maxX=box.max.x+r,minZ=box.min.z-r,maxZ=box.max.z+r;
  // A prop may originate beside a conservative tree bounds box. Don't trap an already-overlapping source.
  if(start.x>minX&&start.x<maxX&&start.z>minZ&&start.z<maxZ)continue;
  let enter=0,exit=1,nx=0,nz=0,valid=true;
  for(const [axis,lo,hi]of [['x',minX,maxX],['z',minZ,maxZ]]){const d=end[axis]-start[axis];if(Math.abs(d)<1e-9){if(start[axis]<lo||start[axis]>hi)valid=false;continue;}
   let a=(lo-start[axis])/d,b=(hi-start[axis])/d,sign=-Math.sign(d);if(a>b)[a,b]=[b,a];if(a>enter){enter=a;nx=axis==='x'?sign:0;nz=axis==='z'?sign:0;}exit=Math.min(exit,b);if(enter>exit)valid=false;
  }
  if(valid&&enter>=0&&enter<=1&&exit>=0&&(nx||nz)&&(!earliest||enter<earliest.t))earliest={t:enter,nx,nz};
 }return earliest;
}
export class PropObstacles{
 constructor(obstacles,cell=30){this.cell=cell;this.cells=new Map();for(const o of obstacles){const b=o.box;if(!b)continue;for(let x=Math.floor(b.min.x/cell);x<=Math.floor(b.max.x/cell);x++)for(let z=Math.floor(b.min.z/cell);z<=Math.floor(b.max.z/cell);z++){const k=x+','+z;if(!this.cells.has(k))this.cells.set(k,[]);this.cells.get(k).push(b);}}}
 sweep(a,b,r,minY,maxY){const boxes=new Set();for(let x=Math.floor((Math.min(a.x,b.x)-r)/this.cell);x<=Math.floor((Math.max(a.x,b.x)+r)/this.cell);x++)for(let z=Math.floor((Math.min(a.z,b.z)-r)/this.cell);z<=Math.floor((Math.max(a.z,b.z)+r)/this.cell);z++)for(const box of this.cells.get(x+','+z)||[])boxes.add(box);return sweepProp(a,b,r,boxes,minY,maxY);}
}
