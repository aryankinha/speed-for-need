// A bounded street study. All lengths are metres; this is NYC-inspired, not a surveyed city replica.
export const STREET_WORLD=Object.freeze({left:-65,right:135,top:-130,bottom:130,shore:-65,roadsX:[0,70],roadsZ:[-110,110],spawn:{x:3.5,z:84,heading:0}});
export const STREET_MODELS=['street-real/street-frontages','street-real/city-skyline','la-real/la-building-small','la-real/la-building-medium','la-real/la-palm','la-real/la-street-lamp-lod'];
export const STREET_DESTINATIONS=[{id:'street',name:'City Street',x:3.5,z:84,heading:0},{id:'return',name:'Return Boulevard',x:73.5,z:-80,heading:Math.PI}];
export const streetDistrict=()=> 'City Street Study';
export function drawStreetMap(ctx){ctx.fillStyle='#7e827d';ctx.fillRect(-65,-130,200,260);ctx.fillStyle='#e0e2dd';for(const x of [0,70])ctx.fillRect(x-8,-118,16,236);for(const z of [-110,110])ctx.fillRect(-8,z-8,86,16);}
