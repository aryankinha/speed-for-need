import * as THREE from './vendor/three.module.js';
// An open rectangle ring, triangulated with Three.js ShapeGeometry/Earcut.
// https://threejs.org/docs/pages/ShapeGeometry.html
export function makeBeachGeometry({left,right,top,bottom},margin=66){
  const outline=new THREE.Shape();outline.moveTo(left-margin,-top+margin);outline.lineTo(right+margin,-top+margin);outline.lineTo(right+margin,-bottom-margin);outline.lineTo(left-margin,-bottom-margin);outline.closePath();
  const hole=new THREE.Path();hole.moveTo(left,-top);hole.lineTo(left,-bottom);hole.lineTo(right,-bottom);hole.lineTo(right,-top);hole.closePath();outline.holes.push(hole);
  const geometry=new THREE.ShapeGeometry(outline),vertices=geometry.attributes.position,uv=geometry.attributes.uv;
  for(let i=0;i<vertices.count;i++){const x=vertices.getX(i),z=-vertices.getY(i),distance=Math.max(left-x,x-right,top-z,z-bottom,0);vertices.setXYZ(i,x,.02-distance*.009,z);uv.setXY(i,x/6,z/6);}geometry.computeVertexNormals();return geometry;
}
