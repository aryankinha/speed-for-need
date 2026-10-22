import * as THREE from './vendor/three.module.js';

function meshCount(root){let count=0;root.traverse(node=>{if(node.isMesh)count++;});return count;}
function bakedGeometry(source,matrix){
  const geometry=new THREE.BufferGeometry();
  // GLTF's quantized and interleaved buffers cannot be transformed in place:
  // writing world positions back into normalized integer attributes clamps them.
  for(const [name,attribute]of Object.entries(source.attributes)){
    const values=new Float32Array(attribute.count*attribute.itemSize);
    for(let i=0;i<attribute.count;i++)for(let component=0;component<attribute.itemSize;component++)values[i*attribute.itemSize+component]=attribute.getComponent(i,component);
    geometry.setAttribute(name,new THREE.BufferAttribute(values,attribute.itemSize));
  }
  if(source.index)geometry.setIndex(source.index.clone());else geometry.setIndex(Array.from({length:source.attributes.position.count},(_,i)=>i));
  geometry.applyMatrix4(matrix);
  if(matrix.determinant()<0){
    const indices=geometry.index.array;for(let i=0;i<indices.length;i+=3){const value=indices[i+1];indices[i+1]=indices[i+2];indices[i+2]=value;}
    const tangent=geometry.attributes.tangent;if(tangent?.itemSize===4)for(let i=0;i<tangent.count;i++)tangent.setW(i,-tangent.getW(i));
  }
  return geometry;
}
function mergeGeometry(entries){
  const geometry=new THREE.BufferGeometry(),parts=entries.map(({node,matrix})=>bakedGeometry(node.geometry,matrix));
  for(const [name,attribute]of Object.entries(parts[0].attributes)){
    const count=parts.reduce((sum,part)=>sum+part.attributes[name].array.length,0),values=new Float32Array(count);let offset=0;
    for(const part of parts){values.set(part.attributes[name].array,offset);offset+=part.attributes[name].array.length;}
    geometry.setAttribute(name,new THREE.BufferAttribute(values,attribute.itemSize));
  }
  const indices=new Uint32Array(parts.reduce((sum,part)=>sum+part.index.count,0));let vertexOffset=0,indexOffset=0;
  for(const part of parts){for(let i=0;i<part.index.count;i++)indices[indexOffset++]=part.index.getX(i)+vertexOffset;vertexOffset+=part.attributes.position.count;part.dispose();}
  geometry.setIndex(new THREE.BufferAttribute(indices,1));geometry.computeBoundingBox();geometry.computeBoundingSphere();return geometry;
}

/** Batch only static opaque meshes. Animated and individually selectable nodes
 * keep their names, geometry, materials and hierarchy. All transforms are captured
 * before mutation, so nested parent/child meshes are never applied twice. */
export function batchStaticMeshes(root,{pinnedNames=[],preserveNames=[]}={}){
  const before=meshCount(root),protectedNames=new Set([...pinnedNames,...preserveNames]),groups=new Map();root.updateWorldMatrix(true,true);
  const inverseRoot=root.matrixWorld.clone().invert();
  root.traverse(node=>{
    if(!node.isMesh||node.isSkinnedMesh||node.isInstancedMesh||Array.isArray(node.material)||node.material.transparent||!node.geometry.attributes.position||Object.keys(node.geometry.morphAttributes).length||node.geometry.groups.length>1)return;
    for(let ancestor=node;ancestor;ancestor=ancestor.parent){if(protectedNames.has(ancestor.name)||ancestor.userData.paint||!ancestor.visible)return;if(ancestor===root)break;}
    const layout=Object.entries(node.geometry.attributes).sort(([a],[b])=>a.localeCompare(b)).map(([name,attribute])=>`${name}:${attribute.itemSize}`).join('|');
    const key=[node.material.uuid,layout,node.castShadow,node.receiveShadow,node.renderOrder,node.layers.mask,node.frustumCulled].join(';');
    if(!groups.has(key))groups.set(key,[]);groups.get(key).push({node,matrix:new THREE.Matrix4().multiplyMatrices(inverseRoot,node.matrixWorld)});
  });
  let mergedGroups=0,removedMeshes=0;
  for(const entries of groups.values()){
    if(entries.length<2)continue;
    const original=entries[0].node,merged=new THREE.Mesh(mergeGeometry(entries),original.material);merged.name=`StaticBatch_${mergedGroups++}`;merged.castShadow=original.castShadow;merged.receiveShadow=original.receiveShadow;merged.renderOrder=original.renderOrder;merged.layers.mask=original.layers.mask;merged.frustumCulled=original.frustumCulled;root.add(merged);
    for(const {node}of entries){
      const parent=node.parent;if(node.children.length){const holder=new THREE.Group();holder.name=`${node.name}_transform`;holder.matrixAutoUpdate=false;holder.matrix.copy(node.matrix);while(node.children.length)holder.add(node.children[0]);parent.add(holder);}node.removeFromParent();removedMeshes++;
    }
  }
  root.updateWorldMatrix(true,true);return {before,after:meshCount(root),mergedGroups,removedMeshes};
}
