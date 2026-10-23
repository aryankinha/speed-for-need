import test from 'node:test';
import assert from 'node:assert/strict';
import {MAPS,MAP_STORAGE_KEY,readSelectedMap,mapUrl} from '../dist/map-selection.js';
test('three distinct map identities preserve the existing coast default',()=>{
  assert.deepEqual(MAPS.map(map=>map.id),['default','coast','la']);
  assert.equal(readSelectedMap(''),'coast');
  assert.ok(Object.isFrozen(MAPS));
});
test('explicit URL map wins over the saved map',()=>{
  const storage={getItem:key=>key===MAP_STORAGE_KEY?'default':null};
  assert.equal(readSelectedMap('?map=la',storage),'la');
  assert.equal(readSelectedMap('?map=coast',storage),'coast');
  assert.equal(readSelectedMap('?map=invalid',storage),'default');
});
test('invalid and inaccessible storage leave the current map usable',()=>{
  assert.equal(readSelectedMap('?map=__proto__',{getItem:()=>'<script>'}),'coast');
  assert.equal(readSelectedMap('',{getItem(){throw new Error('blocked');}}),'coast');
  assert.equal(readSelectedMap('?map=default',{getItem(){throw new Error('blocked');}}),'default');
});
test('map navigation preserves other parameters, hash, and Electron file URLs',()=>{
  assert.equal(mapUrl('https://example.com/play/?camera=2&map=coast#home','la'),'https://example.com/play/?camera=2&map=la#home');
  assert.equal(mapUrl('file:///game/dist/index.html','default'),'file:///game/dist/index.html?map=default');
  assert.throws(()=>mapUrl('https://example.com','bad'),RangeError);
});
