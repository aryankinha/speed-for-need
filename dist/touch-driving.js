// Pointer capture keeps each thumb independent, including outside its control.
// https://developer.mozilla.org/en-US/docs/Web/API/Pointer_events
const clamp=(v,min,max)=>Math.max(min,Math.min(max,v));
export function joystickAxes(dx,dy,radius,deadZone=.12){
 if(!(radius>0&&Number.isFinite(dx)&&Number.isFinite(dy)))return {x:0,y:0,steer:0,throttle:0,reverse:0};
 const length=Math.hypot(dx,dy),scale=length>radius?radius/length:1,x=dx*scale/radius,y=dy*scale/radius;
 const axis=v=>Math.sign(v)*clamp((Math.abs(v)-deadZone)/(1-deadZone),0,1);
 const steer=-Math.sign(x)*Math.abs(axis(x))**1.25||0,drive=-axis(y);
 return {x,y,steer,throttle:Math.max(0,drive),reverse:Math.max(0,-drive)};
}
export function drivingControls(keys,touch,out={}){
 const keyboardTurn=Number(keys.has('a')||keys.has('q')||keys.has('arrowleft'))-Number(keys.has('d')||keys.has('arrowright'));
 out.steer=clamp(keyboardTurn+touch.steer,-1,1);
 out.throttle=Math.max(Number(keys.has('w')||keys.has('z')||keys.has('arrowup')),touch.throttle);
 out.reverse=Math.max(Number(keys.has('s')||keys.has('arrowdown')),touch.reverse);
 // Opposed input brakes rather than commanding forward and reverse together.
 if(out.reverse>0)out.throttle=0;
 out.handbrake=keys.has(' ')||touch.handbrake;out.boost=keys.has('shift')||touch.boost;return out;
}
export class TouchDriving {
 constructor({stick,buttons,events=window,document:doc=window.document}){
  this.stick=stick;this.buttons=Array.from(buttons);this.active=false;this.pointer=null;this.held=new Map();
  this.state={steer:0,throttle:0,reverse:0,handbrake:false,boost:false};
  this.paint=(x=0,y=0)=>{stick.style.setProperty('--stick-x',`${x*this.radius||0}px`);stick.style.setProperty('--stick-y',`${y*this.radius||0}px`);};
  stick.addEventListener('pointerdown',e=>{
   if(!this.active||this.pointer!==null||(e.pointerType==='mouse'&&e.button!==0))return;e.preventDefault();
   const bounds=stick.getBoundingClientRect();this.radius=bounds.width*.31;this.cx=bounds.left+bounds.width/2;this.cy=bounds.top+bounds.height/2;this.pointer=e.pointerId;
   stick.setPointerCapture(e.pointerId);stick.classList.add('is-held');this.move(e);
  });
  stick.addEventListener('pointermove',e=>this.move(e));
  const release=e=>this.release(e.pointerId);
  for(const name of ['pointerup','pointercancel','lostpointercapture'])stick.addEventListener(name,release);
  for(const button of this.buttons){
   button.addEventListener('pointerdown',e=>{if(!this.active||(e.pointerType==='mouse'&&e.button!==0))return;e.preventDefault();this.held.set(e.pointerId,button);button.setPointerCapture(e.pointerId);this.syncButtons();});
   for(const name of ['pointerup','pointercancel','lostpointercapture'])button.addEventListener(name,release);
   button.addEventListener('contextmenu',e=>e.preventDefault());
  }
  stick.addEventListener('contextmenu',e=>e.preventDefault());
  for(const name of ['pointerup','pointercancel'])events.addEventListener(name,release);
  for(const name of ['blur','resize','orientationchange'])events.addEventListener(name,()=>this.clear());
  doc.addEventListener('visibilitychange',()=>{if(doc.hidden)this.clear();});
 }
 move(e){
  if(!this.active||e.pointerId!==this.pointer)return;e.preventDefault();
  const axes=joystickAxes(e.clientX-this.cx,e.clientY-this.cy,this.radius);
  this.state.steer=axes.steer;this.state.throttle=axes.throttle;this.state.reverse=axes.reverse;this.paint(axes.x,axes.y);
 }
 syncButtons(){
  this.state.handbrake=false;this.state.boost=false;
  for(const button of this.held.values())this.state[button.dataset.action]=true;
  for(const button of this.buttons){const held=[...this.held.values()].includes(button);button.classList.toggle('is-held',held);button.setAttribute('aria-pressed',String(held));}
 }
 release(id){
  if(this.pointer===id){this.pointer=null;this.state.steer=0;this.state.throttle=0;this.state.reverse=0;this.paint();this.stick.classList.remove('is-held');if(this.stick.hasPointerCapture(id))this.stick.releasePointerCapture(id);}
  const button=this.held.get(id);if(button){this.held.delete(id);this.syncButtons();if(button.hasPointerCapture(id))button.releasePointerCapture(id);}
 }
 clear(){if(this.pointer!==null)this.release(this.pointer);for(const id of [...this.held.keys()])this.release(id);}
 setActive(value){this.clear();this.active=!!value;}
}
