import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {drivingControls} from '../dist/touch-driving.js';
import {VEHICLES} from '../dist/vehicles.js';
import {DriveHint} from '../dist/drive-hint.js';

const read=f=>readFileSync(new URL(`../dist/${f}`,import.meta.url),'utf8');
const idle={steer:0,throttle:0,reverse:0,handbrake:false,boost:false};

test('AZERTY Z and Q drive and steer like W and A',()=>{
  assert.equal(drivingControls(new Set(['z']),idle).throttle,1);
  assert.equal(drivingControls(new Set(['q']),idle).steer,1);
  assert.equal(drivingControls(new Set(['q','d']),idle).steer,0);
});

test('P pauses alongside Esc, and Z/Q are default-prevented input keys',()=>{
  const game=read('game.js');
  assert.match(game,/key==='escape'\|\|key==='\?'\|\|key==='p'/);
  assert.match(game,/const inputKeys=\['w','a','s','d','z','q'/);
});

test('no real manufacturer names in player-facing vehicle names or descriptions',()=>{
  for(const v of VEHICLES)assert.doesNotMatch(`${v.name} ${v.category} ${v.era} ${v.description}`,/tesla|bmw|honda|nsx|porsche|e36|\b911\b/i,v.id);
});

test('credits open in an in-game dialog, not a raw .md link',()=>{
  const html=read('index.html');
  assert.ok(!/href="[^"]*\.md"/.test(html),'no .md anchors');
  assert.ok((html.match(/data-credits/g)||[]).length>=3);
});

test('drive hint shows once, then hides after its timeout or on pause',()=>{
  const el={hidden:true};let fire;
  const hint=new DriveHint(el,{setTimer:fn=>{fire=fn;return 1;},clearTimer:()=>{}});
  assert.equal(hint.show(),true);assert.equal(el.hidden,false);
  fire();assert.equal(el.hidden,true);
  assert.equal(hint.show(),false);
});

import {createCrazyGames} from '../dist/crazygames.js';

function fakeWindow(env='crazygames',extra={}){
  const calls=[];let settingsListener=null;
  const SDK={environment:env,init:async()=>{calls.push('init');},
    game:{settings:{muteAudio:false},addSettingsChangeListener:fn=>{settingsListener=fn;},gameplayStart:()=>calls.push('start'),gameplayStop:()=>calls.push('stop'),loadingStart:()=>calls.push('loadStart'),loadingStop:()=>calls.push('loadStop'),happytime:()=>calls.push('happy')},
    ad:{requestAd:(type,cb)=>{calls.push('ad:'+type);extra.adResult==='error'?cb.adError({code:'adsDisabledBasicLaunch'}):(cb.adStarted(),cb.adFinished());}}};
  return {win:{CrazyGames:{SDK},document:{createElement:()=>({}),head:{appendChild(){}}},...extra.win},calls,fire:s=>settingsListener(s)};
}

test('SDK wrapper: queues in order, dedupes start/stop, and mirrors muteAudio',async()=>{
  const f=fakeWindow();const sdk=createCrazyGames(f.win);
  sdk.loadingStart();sdk.loadingStop();sdk.gameplayStop();sdk.gameplayStart();sdk.gameplayStart();sdk.gameplayStop();
  await sdk.ready;await new Promise(r=>setTimeout(r,0));
  assert.deepEqual(f.calls,['init','loadStart','loadStop','start','stop']);
  const seen=[];sdk.onMuteChange(m=>seen.push(m));f.fire({muteAudio:true});assert.equal(sdk.muted,true);assert.deepEqual(seen,[true]);
});

test('SDK wrapper: midgame ad restores game on finish and on adError (Basic Launch)',async()=>{
  for(const adResult of ['ok','error']){
    const f=fakeWindow('crazygames',{adResult});const sdk=createCrazyGames(f.win);const log=[];
    sdk.midgameAd({onStart:()=>log.push('s'),onEnd:()=>log.push('e')});
    await sdk.ready;await new Promise(r=>setTimeout(r,0));
    assert.deepEqual(log,adResult==='ok'?['s','e']:['e'],adResult);
  }
});

test('SDK wrapper: disabled domain and Electron are silent no-ops and still restore after an ad',async()=>{
  for(const f of [fakeWindow('disabled'),fakeWindow('crazygames',{win:{electronAPI:{isElectron:true}}})]){
    const sdk=createCrazyGames(f.win);let ended=false;
    sdk.gameplayStart();sdk.midgameAd({onEnd:()=>{ended=true;}});
    await sdk.ready;await new Promise(r=>setTimeout(r,0));
    assert.ok(!f.calls.includes('start')&&!f.calls.includes('ad:midgame'));assert.ok(ended);assert.equal(sdk.active,false);
  }
});

test('game wires SDK: gameplay start/stop on pause, focus loss does not stop, mute respected',()=>{
  const game=read('game.js');
  assert.match(game,/function setPause\(value,fromFocus=false\)/);
  assert.match(game,/sdk\.gameplayStart\(\)/);assert.match(game,/sdk\.loadingStop\(\)/);
  assert.match(game,/setPause\(true,true\)/);
  assert.match(game,/if\(sdk\.muted\)return;soundOn=!soundOn/);
});
