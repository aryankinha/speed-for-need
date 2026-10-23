import test from 'node:test';
import assert from 'node:assert/strict';
import {SUNSET,DESTINATIONS,blockPolygons,clearOfSunset,sunsetDistance,mapDistrict} from '../dist/map-layout.js';
test('diagonal boulevard cuts genuine clearance through the blocks rather than crossing sidewalks',()=>{
 for(const [x,z]of [[-225,-225],[-225,-375],[-75,-375],[-75,-525],[75,-525]]){
  const polygons=blockPolygons(x-63,x+63,z-63,z+63,18);assert.ok(polygons.length);
  for(const polygon of polygons){assert.ok(polygon.length>=3);for(const [px,pz]of polygon)assert.ok(Math.abs(px+pz+450)>=18*Math.SQRT2-1e-8);}
 }
 assert.equal(clearOfSunset({minX:-230,maxX:-220,minZ:-230,maxZ:-220}),false);
 assert.ok(sunsetDistance(500,500)>100);
 assert.equal(sunsetDistance(SUNSET.ax,SUNSET.az),0);
});
test('district destinations agree with their displayed neighborhoods and correct driving heading',()=>{
 for(const d of DESTINATIONS)assert.equal(mapDistrict(d.x,d.z),d.name);
 assert.ok(Math.abs(Math.sin(DESTINATIONS[1].heading)+Math.SQRT1_2)<1e-8);
 assert.equal(mapDistrict(-445,450),'Pacific Boardwalk');
 assert.equal(mapDistrict(-375,450),'Stunt Park');
});
