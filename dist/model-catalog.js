import {VEHICLES} from './vehicles.js';
import {CITY_MODELS} from './map-layout.js';
export const SHARED_MODELS=Object.freeze([...VEHICLES.map(v=>v.asset),'garage-interior','cockpit/savino-wheel','tree-palmdetailedtall','light-curved']);
export const COAST_MODELS=Object.freeze([...Array.from({length:14},(_,i)=>`building-${String.fromCharCode(97+i)}`),...[...'abcdefg'].map(c=>'la-real/la-tower-'+c),'la-real/la-palm-coconut','stunt-ramp','sedan','suv','taxi','traffic-light','bench','planter','dumpster','construction-cone','construction-barrier','road-sign-stop','sign-highway-detailed','rock-largea',...CITY_MODELS]);
export function initialModelNames(map,coastActors=[]){return map==='drift'?[...SHARED_MODELS]:[...new Set([...COAST_MODELS,...SHARED_MODELS,...coastActors])];}
