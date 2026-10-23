// Metres throughout: source modules, cars, roads and physics share one coordinate system.
export const LA_WORLD=Object.freeze({left:-1200,right:1200,top:-1200,bottom:1200,shore:-1200,roadsX:[-1050,-750,-450,-150,150,450,750,1050],roadsZ:[-1050,-750,-450,-150,150,450,750,1050],spawn:{x:-1045.7,z:100,heading:0}});
export const LA_MODELS=Object.freeze(['la-real/la-building-small','la-real/la-building-medium','la-real/la-building-large','la-real/la-building-small-lod','la-real/la-building-medium-lod','la-real/la-building-large-lod']);
export const LA_DESTINATIONS=Object.freeze([
 {id:'pch',name:'Pacific Coast Highway',x:-1045.7,z:100,heading:0},
 {id:'vinewood',name:'Vinewood Boulevard',x:154.3,z:-960,heading:Math.PI},
 {id:'downtown',name:'Downtown LA',x:754.3,z:550,heading:0},
 {id:'river',name:'LA River Channel',x:-600,z:1000,heading:0},
]);
export function laDistrict(x,z){if(x<-900)return'Pacific Coast Highway';if(x<-300&&z>150)return'LA River Channel';if(z<0)return'Vinewood Boulevard';return'Downtown LA';}
// Deterministic metric placement, no building normalization against car length.
export function laBuildingPlacements(){const placements=[];for(let i=0;i<7;i++)for(let j=0;j<7;j++){
 const bx=(LA_WORLD.roadsX[i]+LA_WORLD.roadsX[i+1])/2,bz=(LA_WORLD.roadsZ[j]+LA_WORLD.roadsZ[j+1])/2;
 if(bx<-300&&bz>150)continue; // channel plus existing stunt apron
 const offsets=[];for(const d of [-90,-30,30,90])offsets.push([d,-120],[d,120]);for(const d of [-30,30])offsets.push([-120,d],[120,d]);
 for(const [dx,dz]of offsets){
 const x=bx+dx,z=bz+dz;if(x<-925)continue;
 placements.push({x,z,model:(i+j+(dx>0?1:0))%3,heading:Math.abs(dx)>110?(dx<0?-Math.PI/2:Math.PI/2):(dz<0?Math.PI:0),district:laDistrict(x,z)});
 }}return placements;}
export function drawLAMap(ctx){
 ctx.fillStyle='#34454d';ctx.fillRect(-1200,-1200,2400,2400);ctx.fillStyle='#7a786e';ctx.fillRect(-680,150,160,1000);
 ctx.fillStyle='#ecece2';for(const x of LA_WORLD.roadsX)ctx.fillRect(x-17,-1200,34,2400);for(const z of LA_WORLD.roadsZ)ctx.fillRect(-1200,z-17,2400,34);
 // Channel is continuous underneath the bridge crossings; show it as a dark route.
 ctx.fillStyle='#a0a09a';ctx.fillRect(-650,300,100,750);for(const z of [450,750]){ctx.fillStyle='#ecece2';ctx.fillRect(-690,z-18,180,36);}
}
