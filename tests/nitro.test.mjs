import test from 'node:test';
import assert from 'node:assert/strict';
import {PickupField,fillNitro,drainNitro,regenNitro,nextBoost,nitroFraction,NitroHud,NITRO_MAX,NITRO_DRAIN,NITRO_REGEN,NITRO_BOTTLE,NITRO_INITIAL,NITRO_BOOST_MIN,NITRO_PICKUP_MAX,NITRO_PICKUP_COUNT,PICKUP_BLOCKED} from '../dist/nitro.js';
const roadsX=[-450,-300,-150,0,150,300,450],roadsZ=[-600,-450,-300,-150,0,150,300,450,600];
function make(seed=533){return new PickupField({roadsX,roadsZ,random:()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;}});}

test('eighteen randomly placed bottles stay on lanes away from intersections and from each other',()=>{const f=make();assert.equal(NITRO_PICKUP_COUNT,18);assert.equal(f.items.length,18);for(const p of f.items){assert.ok(p.active);const vx=roadsX.some(x=>Math.abs(Math.abs(p.x-x)-4.3)<1e-6),hz=roadsZ.some(z=>Math.abs(Math.abs(p.z-z)-4.3)<1e-6);assert.ok(vx||hz);if(vx)assert.ok(roadsZ.every(z=>Math.abs(p.z-z)>=28));else assert.ok(roadsX.every(x=>Math.abs(p.x-x)>=28));for(const q of f.items)if(p!==q)assert.ok(Math.hypot(p.x-q.x,p.z-q.z)>=30);}});
test('collecting one bottle stores one tank segment and disables it immediately',()=>{const f=make(),p=f.items[0];assert.equal(f.collectAt(p),NITRO_BOTTLE);assert.equal(p.active,false);assert.equal(p.cooldown,15);assert.equal(f.collected,1);assert.equal(f.collectAt(p),0);});
test('pickup cooldown waits fifteen simulated seconds and respawns away from the player',()=>{const f=make(),p=f.items[0],old={x:p.x,z:p.z};f.collectAt(old);f.update(14.9,old);assert.equal(p.active,false);f.update(.11,old);assert.ok(p.active);assert.ok(Math.hypot(p.x-old.x,p.z-old.z)>=35);});
test('driving past a pickup outside collect radius does not recharge',()=>{const f=make(),p=f.items[0];assert.equal(f.collectAt({x:p.x+3.6,z:p.z}),0);assert.ok(p.active);});
test('a bottle is taken only when a whole bottle fits, so every bottle gives exactly twenty percent',()=>{assert.equal(NITRO_PICKUP_MAX,80);assert.equal(NITRO_PICKUP_MAX+NITRO_BOTTLE,NITRO_MAX);const f=make(),p=f.items[0];assert.equal(f.collectAt(p,NITRO_MAX),PICKUP_BLOCKED);assert.equal(f.collectAt(p,80.5),PICKUP_BLOCKED);assert.equal(p.active,true);assert.equal(f.collected,0);assert.equal(f.collectAt({x:p.x+50,z:p.z},NITRO_MAX),0);assert.equal(f.collectAt(p,NITRO_PICKUP_MAX),NITRO_BOTTLE);assert.equal(p.active,false);});
test('non-finite time steps add or remove nothing',()=>{assert.equal(drainNitro(50,NaN),50);assert.equal(regenNitro(50,NaN),50);assert.equal(drainNitro(50,Infinity),50);assert.equal(regenNitro(50,-Infinity),50);});
test('repeatable seed yields repeatable pickup locations',()=>{assert.deepEqual(make().items,make().items);});

test('120 Hz collection samples do not skip a pickup at 140 metres per second',()=>{const f=make(),p=f.items[0],x=p.x,z=p.z;let gained=0;for(let frame=0;frame<25;frame++)gained+=f.collectAt({x:x-12+frame*140/120,z});assert.equal(gained,NITRO_BOTTLE);assert.equal(p.active,false);assert.equal(f.collected,1);});

test('each bottle adds exactly twenty percent and five fill the tank without overflow',()=>{assert.equal(NITRO_BOTTLE,20);assert.equal(fillNitro(0,NITRO_BOTTLE)/NITRO_MAX,.2);let tank=0;for(let i=0;i<6;i++)tank=fillNitro(tank,NITRO_BOTTLE);assert.equal(tank,NITRO_MAX);assert.equal(NITRO_BOTTLE*5,NITRO_MAX);});
test('fill ignores negative amounts and stays within the tank',()=>{assert.equal(fillNitro(40,-10),40);assert.equal(fillNitro(90,50),NITRO_MAX);assert.equal(fillNitro(0,0),0);});
test('holding boost drains the tank at the configured rate and stops at empty',()=>{assert.equal(drainNitro(NITRO_MAX,1),NITRO_MAX-NITRO_DRAIN);assert.equal(drainNitro(10,1),0);assert.equal(drainNitro(0,.1),0);assert.equal(drainNitro(50,-1),50);});
test('a full tank lasts a few seconds of boost at 120 Hz and never goes negative',()=>{let tank=NITRO_MAX,steps=0;while(tank>0&&steps<10000){tank=drainNitro(tank,1/120);steps++;assert.ok(tank>=0);}const seconds=steps/120;assert.ok(seconds>6.8&&seconds<7.5,`took ${seconds}s`);});
const DT=1/120;
/** Holds Shift through the same gate game.js uses. Each burst records its starting charge and length in seconds. */
function holdShift(amount,seconds){
  const gate={boosting:false,locked:false},bursts=[];let open=null,boosted=0;
  for(let i=0;i<Math.round(seconds/DT);i++){
    const before=amount;amount=nextBoost(gate,amount,true,DT);
    if(gate.boosting){boosted+=DT;if(!open)open={start:before,length:0};open.length+=DT;}
    else if(open){bursts.push(open);open=null;}
  }
  if(open)bursts.push(open);
  return{boosted,bursts,amount};
}
test('holding Shift on an empty tank refills instead of freezing, and after a dry burn waits for a whole bottle',()=>{const r=holdShift(0,10);assert.ok(r.bursts.length>=2,`${r.bursts.length} bursts`);assert.ok(Math.abs(r.bursts[0].start-NITRO_BOOST_MIN)<.1,`fresh press bursts at ${r.bursts[0].start}`);assert.ok(Math.abs(r.bursts[1].start-NITRO_BOTTLE)<.1,`relock releases at ${r.bursts[1].start}`);for(const b of r.bursts.slice(1))assert.ok(b.length>1.3,`${b.length}s`);});
test('a tank just under the start threshold refills while Shift is held and never bursts below the threshold',()=>{const r=holdShift(NITRO_BOOST_MIN-.1,1);assert.ok(r.bursts.length>=1);assert.ok(r.bursts[0].start>=NITRO_BOOST_MIN-1e-9);});
test('every burst starts at or above the threshold and runs the tank to empty, so there is no chatter',()=>{const r=holdShift(NITRO_INITIAL,30);for(const b of r.bursts){assert.ok(b.start>=NITRO_BOOST_MIN-1e-9);assert.ok(Math.abs(b.length-b.start/NITRO_DRAIN)<.02,`${b.length}s from ${b.start}`);}});
test('one bottle gives about 1.4 seconds of boost before it runs dry',()=>{const r=holdShift(NITRO_BOTTLE,10);assert.equal(r.bursts[0].start,NITRO_BOTTLE);assert.ok(r.bursts[0].length>=1.3&&r.bursts[0].length<=1.5,`${r.bursts[0].length}s`);});
test('a full tank gives about seven seconds of boost in one held press',()=>{const r=holdShift(NITRO_MAX,10);assert.equal(r.bursts[0].start,NITRO_MAX);assert.ok(r.bursts[0].length>=6.8&&r.bursts[0].length<=7.5,`${r.bursts[0].length}s`);});
test('the initial charge gives a real first burst of about 2.9 seconds',()=>{const r=holdShift(NITRO_INITIAL,10);assert.ok(r.bursts[0].length>2.8&&r.bursts[0].length<2.95,`${r.bursts[0].length}s`);});
test('a locked burn restarts only after release or after refilling to the start threshold',()=>{
  const idle={boosting:false,locked:false};assert.ok(nextBoost(idle,0,true,DT)>0);assert.equal(idle.boosting,false);
  const locked={boosting:false,locked:true};const refilled=nextBoost(locked,NITRO_BOOST_MIN,true,DT);assert.ok(refilled>NITRO_BOOST_MIN);assert.equal(locked.boosting,false);assert.equal(locked.locked,true);
  assert.ok(nextBoost(locked,NITRO_BOTTLE,true,DT)<NITRO_BOTTLE);assert.equal(locked.boosting,true);assert.equal(locked.locked,false);
  const released={boosting:false,locked:true};nextBoost(released,0,false,DT);assert.equal(released.locked,false);assert.equal(released.boosting,false);
});
test('regen runs when no boost is wanted, and also when a wanted boost cannot start yet',()=>{
  const gate={boosting:false,locked:false};
  assert.equal(nextBoost(gate,0,false,1),NITRO_REGEN);
  assert.equal(nextBoost(gate,0,true,1),NITRO_REGEN);
  assert.equal(nextBoost(gate,NITRO_MAX,false,1),NITRO_MAX);
});
test('passive regen refills an empty tank in about twenty-five seconds at 120 Hz and stops at full',()=>{assert.equal(NITRO_REGEN,4);let tank=0,steps=0;while(tank<NITRO_MAX&&steps<100000){tank=regenNitro(tank,1/120);steps++;assert.ok(tank<=NITRO_MAX);}assert.ok(Math.abs(steps/120-25)<.1,`took ${steps/120}s`);assert.equal(regenNitro(NITRO_MAX,5),NITRO_MAX);});
test('regen adds 4 per second, ignores negative time and never exceeds the tank',()=>{assert.equal(regenNitro(0,1),4);assert.equal(regenNitro(99,10),NITRO_MAX);assert.equal(regenNitro(50,-1),50);assert.equal(regenNitro(0,0),0);});
test('fraction maps the tank onto 0..1 and clamps outside the range',()=>{assert.equal(nitroFraction(0),0);assert.equal(nitroFraction(50),.5);assert.equal(nitroFraction(NITRO_MAX),1);assert.equal(nitroFraction(150),1);assert.equal(nitroFraction(-5),0);});
test('HUD toggles the locked tag only on change, and the FULL flash is debounced and times out',()=>{
  const classes=new Set();let toggles=0;const fill={style:{set width(v){}}};const percent={set textContent(v){}};
  const root={hidden:true,setAttribute(){},classList:{add:c=>classes.add(c),remove:(...cs)=>cs.forEach(c=>classes.delete(c)),toggle:(c,on)=>{toggles++;return on?classes.add(c):classes.delete(c);}},querySelector:s=>s==='.nitro-fill'?fill:percent};
  const hud=new NitroHud(root);
  hud.update(0,DT,false,true);assert.ok(classes.has('locked'));const afterFirst=toggles;
  hud.update(0,DT,false,true);hud.update(0,DT,false,true);assert.equal(toggles,afterFirst);
  hud.update(0,DT,false,false);assert.equal(classes.has('locked'),false);
  hud.flash();assert.ok(classes.has('flash'));hud.update(50,.5);assert.ok(classes.has('flash'));
  hud.flash();hud.update(50,.5);assert.equal(classes.has('flash'),false);
  hud.flash();hud.hide();assert.equal(classes.has('flash'),false);assert.equal(classes.has('locked'),false);
});
test('HUD writes the bar and percent only when the displayed value changes',()=>{const writes={fill:0,text:0};const classes=new Set();const fill={style:{set width(v){writes.fill++;this._t=v;}}};const percent={set textContent(v){writes.text++;this._t=v;}};const root={hidden:true,setAttribute(){},classList:{add:c=>classes.add(c),remove:(...cs)=>cs.forEach(c=>classes.delete(c)),toggle:(c,on)=>on?classes.add(c):classes.delete(c)},querySelector:s=>s==='.nitro-fill'?fill:percent};const hud=new NitroHud(root);hud.update(50,1/60);const after=writes.fill+writes.text;hud.update(50,1/60);hud.update(50,1/60,false);assert.equal(writes.fill+writes.text,after);hud.update(50,1/60,true);assert.ok(classes.has('burning'));hud.update(100,0);assert.equal(percent._t,'100%');assert.equal(root.hidden,false);hud.hide();assert.equal(root.hidden,true);assert.equal(classes.has('burning'),false);});

test('jumping above a ground bottle does not collect or disable it',()=>{
  const field=make(),bottle=field.items[0];
  assert.equal(field.collectAt({x:bottle.x,z:bottle.z,elevation:10},0),0);
  assert.equal(bottle.active,true);assert.equal(field.collected,0);
  assert.equal(field.collectAt({x:bottle.x,z:bottle.z,elevation:0},0),NITRO_BOTTLE);
});
