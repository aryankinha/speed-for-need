// Roof light bar for the police cars: dark housing, red and blue lenses, a white centre lens and a 5 Hz flash.
// Pure helpers plus buildLightBar(THREE, shared). THREE is passed in rather than imported so tests/police-lights.test.mjs
// can import this file in node without WebGL. Geometry and materials are built once (makeLightBarShared) and reused by
// every cop, so each cop adds four meshes and no new buffers.

export const FLASH_HZ=5;
export const LIGHT_BAR={width:1,housingHeight:.12,depth:.3,sink:.03,lensWidth:.4,lensHeight:.05,lensOffsetX:.27,centreWidth:.14};
const BRIGHT=7,DIM=.35;

/**
 * Flash state at a given time. The lit lens runs at BRIGHT (>1 so it blooms), the other at DIM; the two swap
 * FLASH_HZ times per second. Unlit bars return zero for both lenses. Output is always within [0, BRIGHT].
 */
export function lightBarState(time,lit){
  if(!lit)return {red:0,blue:0};
  const toggles=Math.floor(time*FLASH_HZ),redOn=((toggles%2)+2)%2===0;
  return {red:redOn?BRIGHT:DIM,blue:redOn?DIM:BRIGHT};
}

/** Height (local to the car) of the light bar's centre, so its housing sits just into the roof of a body this tall. */
export function lightBarY(bodyHeight){
  return bodyHeight-LIGHT_BAR.sink+LIGHT_BAR.housingHeight/2;
}

/** Geometry and materials shared by every light bar. redMat and blueMat are the materials the flash logic mutates. */
export function makeLightBarShared(THREE,redMat,blueMat){
  const L=LIGHT_BAR,lensDepth=L.depth*.86;
  return {
    housingGeo:new THREE.BoxGeometry(L.width,L.housingHeight,L.depth),
    lensGeo:new THREE.BoxGeometry(L.lensWidth,L.lensHeight,lensDepth),
    centreGeo:new THREE.BoxGeometry(L.centreWidth,L.lensHeight,lensDepth),
    housingMat:new THREE.MeshStandardMaterial({color:0x15171b,roughness:.55,metalness:.2}),
    centreMat:new THREE.MeshBasicMaterial({color:new THREE.Color(1.6,1.6,1.5)}),
    redMat,
    blueMat,
  };
}

/** Light bar group centred on its housing. The caller positions it with lightBarY() and the car's z offset. */
export function buildLightBar(THREE,shared){
  const L=LIGHT_BAR,group=new THREE.Group();group.name='light-bar';
  const lensY=L.housingHeight/2+L.lensHeight/2-.005;
  const add=(geo,mat,x,y)=>{const m=new THREE.Mesh(geo,mat);m.position.set(x,y,0);group.add(m);};
  add(shared.housingGeo,shared.housingMat,0,0);
  add(shared.lensGeo,shared.redMat,-L.lensOffsetX,lensY);
  add(shared.lensGeo,shared.blueMat,L.lensOffsetX,lensY);
  add(shared.centreGeo,shared.centreMat,0,lensY);
  return group;
}
