import test from 'node:test';
import assert from 'node:assert/strict';
import {joystickAxes,TouchDriving,drivingControls} from '../dist/touch-driving.js';
import {createDrivingWorld} from '../dist/physics.js';
import {smoothSteering} from '../dist/driving-input.js';
class Control extends EventTarget{
 constructor(action){super();this.dataset={action};this.props=new Map();this.style={setProperty:(k,v)=>this.props.set(k,v)};this.classes=new Set();this.classList={add:k=>this.classes.add(k),remove:k=>this.classes.delete(k),toggle:(k,on)=>on?this.classes.add(k):this.classes.delete(k)};this.captured=new Set();this.attributes=new Map();}
 getBoundingClientRect(){return {left:10,top:20,width:140,height:140};}
 setPointerCapture(id){this.captured.add(id);}hasPointerCapture(id){return this.captured.has(id);}releasePointerCapture(id){this.captured.delete(id);send(this,'lostpointercapture',id);}
 setAttribute(k,v){this.attributes.set(k,v);}
}
function send(target,type,id=1,x=80,y=90){const e=new Event(type,{cancelable:true});Object.assign(e,{pointerId:id,clientX:x,clientY:y,pointerType:'touch',button:0});target.dispatchEvent(e);return e;}
function setup(){const stick=new Control(),boost=new Control('boost'),drift=new Control('handbrake'),events=new EventTarget(),doc=new EventTarget();doc.hidden=false;const controls=new TouchDriving({stick,buttons:[boost,drift],events,document:doc});controls.setActive(true);return {stick,boost,drift,events,doc,controls};}

test('joystick is proportional, has a neutral dead zone, clamps outside its radius and steers in the right direction',()=>{
 assert.equal(joystickAxes(3,-4,50).throttle,0);assert.equal(joystickAxes(3,-4,50).steer,0);
 const partial=joystickAxes(-20,-20,50);assert.ok(partial.steer>0&&partial.steer<1);assert.ok(partial.throttle>0&&partial.throttle<1);
 assert.equal(joystickAxes(0,-500,50).throttle,1);assert.equal(joystickAxes(0,500,50).reverse,1);
 assert.equal(joystickAxes(500,0,50).steer,-1);assert.equal(joystickAxes(-500,0,50).steer,1);
 const diagonal=joystickAxes(500,-500,50);assert.ok(Math.hypot(diagonal.x,diagonal.y)<=1.000001);
 assert.deepEqual(joystickAxes(NaN,0,50),{x:0,y:0,steer:0,throttle:0,reverse:0});
});
test('stick captures one finger, follows outside its bounds and recenters on release',()=>{
 const {stick,controls}=setup();assert.ok(send(stick,'pointerdown',4,80,30).defaultPrevented);assert.equal(controls.state.throttle,1);
 send(stick,'pointerdown',5,80,150);assert.equal(controls.state.reverse,0,'second finger cannot take over stick');
 send(stick,'pointermove',4,400,90);assert.equal(controls.state.steer,-1);assert.equal(controls.state.throttle,0);
 send(stick,'pointerup',5);assert.equal(controls.state.steer,-1);send(stick,'pointerup',4);
 assert.equal(controls.state.steer,0);assert.equal(stick.props.get('--stick-x'),'0px');assert.equal(stick.hasPointerCapture(4),false);
});
test('steering, nitro and drift support independent simultaneous fingers without corrupting keyboard keys',()=>{
 const {stick,boost,drift,controls}=setup();send(stick,'pointerdown',1,60,30);send(boost,'pointerdown',2);send(drift,'pointerdown',3);
 assert.ok(controls.state.throttle>0&&controls.state.steer>0&&controls.state.boost&&controls.state.handbrake);
 send(boost,'pointerup',2);assert.equal(controls.state.boost,false);assert.equal(controls.state.handbrake,true);assert.ok(controls.state.throttle>0);
 send(stick,'pointercancel',1);assert.equal(controls.state.throttle,0);assert.equal(controls.state.handbrake,true);
 const keys=new Set(['w','shift']);const input=drivingControls(keys,controls.state);assert.equal(input.throttle,1);assert.equal(input.boost,true);assert.deepEqual([...keys],['w','shift']);
});
test('two fingers on one action release only after both finish; capture loss never leaves an action held',()=>{
 const {boost,controls}=setup();send(boost,'pointerdown',2);send(boost,'pointerdown',3);send(boost,'pointerup',2);assert.equal(controls.state.boost,true);
 send(boost,'lostpointercapture',3);assert.equal(controls.state.boost,false);assert.equal(boost.attributes.get('aria-pressed'),'false');
});
test('pause, hiding, rotation, resizing and focus loss clear every held input',()=>{
 for(const scenario of ['pause','hidden','orientationchange','resize','blur']){
  const {stick,boost,events,doc,controls}=setup();send(stick,'pointerdown',1,50,30);send(boost,'pointerdown',2);
  if(scenario==='pause')controls.setActive(false);else if(scenario==='hidden'){doc.hidden=true;doc.dispatchEvent(new Event('visibilitychange'));}else events.dispatchEvent(new Event(scenario));
  assert.deepEqual(controls.state,{steer:0,throttle:0,reverse:0,handbrake:false,boost:false},scenario);
  send(stick,'pointermove',1,80,30);assert.equal(controls.state.throttle,0,'old touch cannot resume driving');
  if(scenario==='pause'){send(stick,'pointerdown',4,80,30);assert.equal(controls.state.throttle,0);}
 }
});
test('input mixing preserves analog strength, keyboard support and safe brake priority',()=>{
 const touch={steer:.23,throttle:.38,reverse:0,handbrake:false,boost:false},out={};
 assert.equal(drivingControls(new Set(),touch,out),out);assert.equal(out.throttle,.38);assert.equal(out.steer,.23);
 drivingControls(new Set(['arrowright']),touch,out);assert.equal(out.steer,-.77);
 drivingControls(new Set(['s']),touch,out);assert.equal(out.throttle,0);assert.equal(out.reverse,1);
});
test('analog joystick drives actual physics, gives gentler partial acceleration, turns and brakes into reverse',()=>{
 const world=createDrivingWorld(),car=world.addVehicle();let steer=0;const keys=new Set();
 const step=(touch,frames)=>{for(let i=0;i<frames;i++){const input=drivingControls(keys,touch);steer=smoothSteering(steer,input.steer,car.speed,1/120);world.step(1/120,()=>car.setControls({...input,steer}));}};
 step({...joystickAxes(0,-25,50),boost:false,handbrake:false},120);const partial=car.speed;assert.ok(partial>1);
 car.setPose({});step({...joystickAxes(0,-50,50),boost:false,handbrake:false},120);assert.ok(car.speed>partial*1.5);
 step({...joystickAxes(-25,-40,50),boost:false,handbrake:false},120);assert.ok(car.heading>.1);
 step({...joystickAxes(0,50,50),boost:false,handbrake:false},600);assert.ok(car.forwardSpeed<-.5,'downward joystick must brake then reverse');
});
