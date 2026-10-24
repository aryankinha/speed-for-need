import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {initialModelNames,SHARED_MODELS} from '../dist/model-catalog.js';
import {STREET_CAR_ASSETS} from '../dist/street-cars.js';
const root=new URL('../dist/',import.meta.url);
test('each retained map has its startup models; Drift excludes Coast actors',()=>{
 const actors=[...STREET_CAR_ASSETS,'peds/ped-male','peds/ped-female','peds/ped-anims'];
 for(const map of ['coast','drift'])for(const name of initialModelNames(map,actors))assert.ok(existsSync(new URL('assets/'+name+'.glb',root)),name);
 assert.deepEqual(initialModelNames('drift',actors),[...SHARED_MODELS]);
 assert.ok(initialModelNames('coast',actors).length>SHARED_MODELS.length);
});
test('retired maps, exclusive packs and raw Drift source stay outside shipping files',()=>{
 for(const path of ['world-default.js','world-street.js','street-layout.js','world-la.js','la-layout.js','la-decks.js','physics-cells.js','assets/street-real','assets/roadster.glb','assets/sky.hdr','assets/park/grass.glb','assets/drift-track/drift_race_track_free.glb'])assert.equal(existsSync(new URL(path,root)),false,path);
 assert.ok(existsSync(new URL('../source-assets/drift-track/drift_race_track_free.glb',root)));
});
