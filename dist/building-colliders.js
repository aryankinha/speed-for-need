import * as THREE from './vendor/three.module.js';

// Compile the visible surfaces once per template, before render batching. A small
// horizontal grid is unioned and merged into rectangles; it never fills an entire
// lot or takes a convex hull across courtyards, recesses or separate buildings.
// Height slices preserve drive-under clearance instead of projecting roofs down.
// Convex fixtures on a shared static body use the existing Box2D solver:
// https://box2d.org/documentation/md_simulation.html
const CELL=.2,SKIN=.012,cache=new Map();
const levels=[.18,.7,1.2,1.7,2.2,3,5,9,17,33,65,129,257,513];
const p=new THREE.Vector3();
function clip(poly,axis,bound,greater){
 const out=[];if(!poly.length)return out;
 let a=poly[poly.length-1],insideA=greater?a[axis]>=bound:a[axis]<=bound;
 for(const b of poly){const insideB=greater?b[axis]>=bound:b[axis]<=bound;
  if(insideA!==insideB){const t=(bound-a[axis])/(b[axis]-a[axis]);out.push(a.map((v,i)=>v+(b[i]-v)*t));}
  if(insideB)out.push(b);a=b;insideA=insideB;
 }return out;
}
function profile(root){
 root.updateMatrixWorld(true);
 const inverse=root.matrixWorld.clone().invert(),meshes=[];
 root.traverseVisible(m=>{if(!m.isMesh||!m.geometry?.attributes.position)return;
  // Invisible material primitives must not produce invisible collision.
  const materials=Array.isArray(m.material)?m.material:[m.material];
  const matrix=inverse.clone().multiply(m.matrixWorld);
  meshes.push({m,materials,matrix});
 });
 const key=meshes.map(({m,materials,matrix})=>m.geometry.uuid+':'+materials.map(v=>`${v?.visible!==false}:${!!v?.transparent}:${v?.opacity??1}`).join(',')+':'+matrix.elements.map(n=>n.toFixed(6)).join(',')).join('|');
 if(cache.has(key))return cache.get(key);
 const bands=levels.slice(1).map(()=>new Map());
 for(const {m,materials,matrix} of meshes){
  const geometry=m.geometry,position=geometry.attributes.position,index=geometry.index,count=index?.count??position.count;
  const start=geometry.drawRange.start,end=Math.min(count,start+geometry.drawRange.count);
  for(let i=start;i+2<end;i+=3){
   const group=geometry.groups.find(g=>i>=g.start&&i<g.start+g.count),material=materials[Array.isArray(m.material)?group?.materialIndex??0:0];
   if(material?.visible===false||(material?.transparent&&material.opacity<.05))continue;
   const tri=[];for(let j=0;j<3;j++){p.fromBufferAttribute(position,index?index.getX(i+j):i+j).applyMatrix4(matrix);tri.push([p.x,p.y,p.z]);}
   const minY=Math.min(...tri.map(v=>v[1])),maxY=Math.max(...tri.map(v=>v[1]));
   if(maxY<levels[0])continue; // Ground slabs/plinths remain driveable.
   for(let band=0;band<bands.length;band++){
    const lo=levels[band],hi=levels[band+1];if(maxY<lo||minY>hi)continue;
    const poly=clip(clip(tri,1,lo,true),1,hi,false);if(!poly.length)continue;
    const low=Math.min(...poly.map(v=>v[1])),high=Math.max(...poly.map(v=>v[1]));
    const minX=Math.floor((Math.min(...poly.map(v=>v[0]))-SKIN)/CELL),maxX=Math.floor((Math.max(...poly.map(v=>v[0]))+SKIN)/CELL);
    const minZ=Math.floor((Math.min(...poly.map(v=>v[2]))-SKIN)/CELL),maxZ=Math.floor((Math.max(...poly.map(v=>v[2]))+SKIN)/CELL);
    for(let z=minZ;z<=maxZ;z++)for(let x=minX;x<=maxX;x++){
     let cut=clip(poly,0,x*CELL-SKIN,true);cut=clip(cut,0,(x+1)*CELL+SKIN,false);cut=clip(cut,2,z*CELL-SKIN,true);cut=clip(cut,2,(z+1)*CELL+SKIN,false);if(!cut.length)continue;
     const key=x+','+z,old=bands[band].get(key);
     if(old){old.minY=Math.min(old.minY,low);old.maxY=Math.max(old.maxY,high);}else bands[band].set(key,{x,z,minY:low,maxY:high});
    }
   }
  }
 }
 const rectangles=[];
 for(const cells of bands){
  // Row runs, then merge equal adjacent runs. Internal triangle edges disappear.
  const rows=new Map();for(const cell of cells.values()){const height=cell.minY.toFixed(3)+':'+cell.maxY.toFixed(3),key=cell.z+'|'+height;if(!rows.has(key))rows.set(key,[]);rows.get(key).push(cell);}
  const runs=[];
  for(const row of rows.values()){row.sort((a,b)=>a.x-b.x);let run;
   for(const cell of row){if(run&&cell.x===run.x1)run.x1++;else{run={x0:cell.x,x1:cell.x+1,z0:cell.z,z1:cell.z+1,minY:cell.minY,maxY:cell.maxY};runs.push(run);}}
  }
  runs.sort((a,b)=>a.z0-b.z0);const active=new Map();
  for(const r of runs){const key=[r.x0,r.x1,r.minY.toFixed(3),r.maxY.toFixed(3)].join(':'),last=active.get(key);if(last&&last.z1===r.z0)last.z1=r.z1;else{rectangles.push(r);active.set(key,r);}}
 }
 // Repeated wall slices share one fixture when their x/z rectangle is identical.
 rectangles.sort((a,b)=>a.minY-b.minY);const merged=[],lastByFootprint=new Map();
 for(const r of rectangles){const key=[r.x0,r.x1,r.z0,r.z1].join(':'),last=lastByFootprint.get(key);if(last&&r.minY<=last.maxY+.002)last.maxY=Math.max(last.maxY,r.maxY);else{const copy={...r};merged.push(copy);lastByFootprint.set(key,copy);}}
 const parts=merged.map(r=>({x:(r.x0+r.x1)*CELL/2,z:(r.z0+r.z1)*CELL/2,width:(r.x1-r.x0)*CELL,length:(r.z1-r.z0)*CELL,minY:r.minY,maxY:Math.max(r.minY+.02,r.maxY)}));
 cache.set(key,parts);return parts;
}

export function addBuildingColliders(root,physics,obstacles){
 const parts=profile(root),bounds=new THREE.Box3().setFromObject(root,true);if(!parts.length)return bounds;
 const position=new THREE.Vector3(),scale=new THREE.Vector3(),rotation=new THREE.Quaternion();root.matrixWorld.decompose(position,rotation,scale);
 const heading=new THREE.Euler().setFromQuaternion(rotation,'YXZ').y;
 const scaled=parts.map(r=>({...r,x:r.x*scale.x,z:r.z*scale.z,width:r.width*Math.abs(scale.x),length:r.length*Math.abs(scale.z),minY:position.y+r.minY*scale.y,maxY:position.y+r.maxY*scale.y}));
 const actor=physics.addCompound({x:position.x,z:position.z,heading,parts:scaled,userData:{kind:'building'}});
 for(const r of parts){const box=new THREE.Box3(new THREE.Vector3(r.x-r.width/2,r.minY,r.z-r.length/2),new THREE.Vector3(r.x+r.width/2,r.maxY,r.z+r.length/2)).applyMatrix4(root.matrixWorld);obstacles.push({actor,box});}
 return bounds;
}
