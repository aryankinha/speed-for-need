// A compact original Southern California layout, not a traced GTA or GIS map.
// One shared definition feeds visual streets, clearance checks and both maps.
export const MAP_NAME='SOLANA COAST';
export const CITY_MODELS=Object.freeze(['la-house-a','la-house-c','la-house-f','la-house-h','la-house-m','la-house-q','la-industry-a','la-industry-c','la-industry-g','la-industry-j','la-industry-water-tower','la-industry-shipping-container-a']);
export const SUNSET=Object.freeze({ax:-300,az:-150,bx:150,bz:-600,width:26,sidewalk:5});
export const DESTINATIONS=Object.freeze([
  {id:'coast',name:'Pacific Boardwalk',x:-445.7,z:110,heading:0},
  {id:'sunset',name:'Sunset Mile',x:-275,z:-175,heading:-Math.PI/4},
  {id:'downtown',name:'Downtown Solana',x:4.3,z:-110,heading:0},
  {id:'park',name:'Garden Park',x:-184,z:75,heading:Math.PI/2},
  {id:'gardens',name:'Palm Gardens',x:-145.7,z:-565,heading:Math.PI},
  {id:'arts',name:'Arts & Warehouse',x:154.3,z:380,heading:0},
]);
export function mapDistrict(x,z){if(x>-278&&x<-172&&z>22&&z<128)return'Garden Park';if(x>-438&&x<-312&&z>312&&z<588)return'Stunt Park';if(x<-300)return'Pacific Boardwalk';if(z<-300)return'Palm Gardens';if(z>300)return'Arts & Warehouse';if(x>=0)return'Downtown Solana';return'Sunset Mile';}
export function sunsetDistance(x,z){const dx=SUNSET.bx-SUNSET.ax,dz=SUNSET.bz-SUNSET.az,t=Math.max(0,Math.min(1,((x-SUNSET.ax)*dx+(z-SUNSET.az)*dz)/(dx*dx+dz*dz)));return Math.hypot(x-SUNSET.ax-t*dx,z-SUNSET.az-t*dz);}
export function clearOfSunset(bounds,margin=0){
  // Segment crosses the four northern blocks. A conservative support radius
  // keeps even rotated building corners off both road and sidewalks.
  const x=(bounds.minX+bounds.maxX)/2,z=(bounds.minZ+bounds.maxZ)/2;
  return sunsetDistance(x,z)>SUNSET.width/2+SUNSET.sidewalk+margin+Math.hypot(bounds.maxX-bounds.minX,bounds.maxZ-bounds.minZ)/2;
}
// Sutherland–Hodgman half-plane clipping. Split the block on either side of
// x+z=-450, leaving a real diagonal road corridor rather than painting over lots.
export function blockPolygons(minX,maxX,minZ,maxZ,clearance=SUNSET.width/2){
  const rect=[[minX,minZ],[maxX,minZ],[maxX,maxZ],[minX,maxZ]];
  if(maxX<SUNSET.ax-clearance||minX>SUNSET.bx+clearance||maxZ<SUNSET.bz-clearance||minZ>SUNSET.az+clearance)return[rect];
  const clip=(sign)=>{const limit=-450+sign*clearance*Math.SQRT2,out=[];for(let i=0;i<rect.length;i++){const a=rect[i],b=rect[(i+1)%rect.length],da=sign*(a[0]+a[1]-limit),db=sign*(b[0]+b[1]-limit);if(da>=0)out.push(a);if((da>=0)!==(db>=0)){const t=da/(da-db);out.push([a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t]);}}return out;};
  return[clip(-1),clip(1)].filter(p=>p.length>=3);
}
export function drawMapDistricts(ctx){
  for(const [x,z,w,h,color]of [[-438,-588,126,876,'#42696b'],[-288,-588,726,276,'#4b6251'],[12,-288,426,576,'#414b61'],[-288,312,726,276,'#675949']]){ctx.fillStyle=color;ctx.fillRect(x,z,w,h);}
}
export function drawSunsetMap(ctx){
  ctx.strokeStyle='#f0f2f5';ctx.lineWidth=SUNSET.width;ctx.beginPath();ctx.moveTo(SUNSET.ax,SUNSET.az);ctx.lineTo(SUNSET.bx,SUNSET.bz);ctx.stroke();
}
